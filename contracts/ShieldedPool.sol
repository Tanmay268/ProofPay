// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IPoseidon2 {
    function poseidon(uint256[2] calldata input) external pure returns (uint256);
}

interface IPoseidon3 {
    function poseidon(uint256[3] calldata input) external pure returns (uint256);
}

interface IPayVerifier {
    function verifyProof(
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c,
        uint256[9] calldata pubSignals
    ) external view returns (bool);
}

/// @notice Optional deposit screening hook (compliance v1). Return false to reject a depositor.
interface IDepositPolicy {
    function isDepositAllowed(address depositor) external view returns (bool);
}

/// @title ProofPay shielded pool (single asset: native currency)
/// @notice Users deposit into a Poseidon Merkle tree of note commitments and
///         later pay invoices from a note with a zero-knowledge proof. The
///         payer is not revealed. Each payment also inserts a hidden payment
///         record leaf from which unlinkable, verifier-scoped receipts can be
///         proven off-chain (see circuits/receipt.circom).
contract ShieldedPool is Ownable2Step, Pausable, ReentrancyGuard {
    // ---- constants ----
    uint256 public constant FIELD_SIZE =
        21888242871839275222246405745257275088548364400416034343698204186575808495617;
    uint256 public constant TREE_DEPTH = 20;
    uint256 public constant ROOT_HISTORY_SIZE = 100;
    uint256 public constant MAX_AMOUNT = (1 << 96) - 1;
    uint256 internal constant TAG_NOTE = 1; // must match circuits/lib/common.circom

    // ---- immutables ----
    IPoseidon2 public immutable hasher2;
    IPoseidon3 public immutable hasher3;
    IPayVerifier public immutable payVerifier;

    // ---- config (owner) ----
    uint256 public maxDeposit;
    IDepositPolicy public depositPolicy; // address(0) = no screening

    // ---- tree state ----
    uint32 public nextIndex;
    uint32 public currentRootIndex;
    uint256[TREE_DEPTH] public filledSubtrees;
    uint256[TREE_DEPTH] public zeros;
    uint256[ROOT_HISTORY_SIZE] public roots;

    mapping(uint256 => bool) public nullifierSpent;

    // ---- events ----
    event Deposit(uint256 indexed commitment, uint32 leafIndex, uint256 amount);
    event Payment(
        uint256 indexed invoiceId,
        address indexed merchant,
        uint256 amount,
        uint256 nullifier,
        uint256 changeCommitment,
        uint32 changeIndex,
        uint256 recordCommitment,
        uint32 recordIndex
    );
    /// @notice ERC-5564-style announcement so the merchant can detect stealth payments.
    event StealthAnnouncement(address indexed stealthAddress, bytes1 viewTag, bytes ephemeralPubKey, uint256 invoiceId);
    /// @notice Every root ever produced; verifiers sync this log instead of querying per receipt.
    event RootAdded(uint256 root);
    event MaxDepositUpdated(uint256 maxDeposit);
    event DepositPolicyUpdated(address policy);

    // ---- errors ----
    error InvalidAmount();
    error ExceedsMaxDeposit();
    error FieldOverflow();
    error UnknownRoot();
    error NullifierAlreadySpent();
    error InvalidProof();
    error TreeFull();
    error TransferFailed();
    error DepositNotAllowed();

    constructor(
        address initialOwner,
        IPoseidon2 _hasher2,
        IPoseidon3 _hasher3,
        IPayVerifier _payVerifier,
        uint256 _maxDeposit
    ) Ownable(initialOwner) {
        hasher2 = _hasher2;
        hasher3 = _hasher3;
        payVerifier = _payVerifier;
        maxDeposit = _maxDeposit;

        uint256 z = uint256(keccak256("ProofPay")) % FIELD_SIZE;
        for (uint256 i = 0; i < TREE_DEPTH; i++) {
            zeros[i] = z;
            filledSubtrees[i] = z;
            z = _hash2(z, z);
        }
        roots[0] = z;
        emit RootAdded(z);
    }

    // -------------------------------------------------------------- deposit

    /// @param ownerCommit Poseidon(TAG_OWNER, secret) computed by the depositor.
    ///        The contract binds msg.value into the note itself, so the value
    ///        inside a note always equals what was paid in.
    function deposit(uint256 ownerCommit) external payable whenNotPaused nonReentrant {
        if (msg.value == 0 || msg.value > MAX_AMOUNT) revert InvalidAmount();
        if (msg.value > maxDeposit) revert ExceedsMaxDeposit();
        if (ownerCommit >= FIELD_SIZE) revert FieldOverflow();
        if (address(depositPolicy) != address(0) && !depositPolicy.isDepositAllowed(msg.sender)) {
            revert DepositNotAllowed();
        }

        uint256 commitment = hasher3.poseidon([TAG_NOTE, msg.value, ownerCommit]);
        uint32 index = _insert(commitment);
        emit Deposit(commitment, index, msg.value);
    }

    // ------------------------------------------------------------------ pay

    struct StealthInfo {
        bytes1 viewTag;
        bytes ephemeralPubKey;
    }

    /// @notice Pay `amount` to `merchant` for `invoiceId` from a shielded note.
    ///         msg.sender is the proof's bound relayer and receives `fee`.
    /// @dev Public signal order MUST match circuits/pay.circom:
    ///      [root, nullifier, payAmount, invoiceId, merchant, relayer, fee,
    ///       changeCommitment, recordCommitment]
    function pay(
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c,
        uint256 root,
        uint256 nullifier,
        uint256 amount,
        uint256 invoiceId,
        address payable merchant,
        uint256 fee,
        uint256 changeCommitment,
        uint256 recordCommitment,
        StealthInfo calldata stealth
    ) external whenNotPaused nonReentrant {
        if (amount == 0 || amount > MAX_AMOUNT || fee > MAX_AMOUNT) revert InvalidAmount();
        if (
            nullifier >= FIELD_SIZE || invoiceId >= FIELD_SIZE || changeCommitment >= FIELD_SIZE
                || recordCommitment >= FIELD_SIZE
        ) revert FieldOverflow();
        if (!isKnownRoot(root)) revert UnknownRoot();
        if (nullifierSpent[nullifier]) revert NullifierAlreadySpent();

        uint256[9] memory pub = [
            root,
            nullifier,
            amount,
            invoiceId,
            uint256(uint160(address(merchant))),
            uint256(uint160(msg.sender)),
            fee,
            changeCommitment,
            recordCommitment
        ];
        if (!payVerifier.verifyProof(a, b, c, pub)) revert InvalidProof();

        nullifierSpent[nullifier] = true;

        uint32 changeIndex;
        uint32 recordIndex;
        if (nextIndex % 2 == 0) {
            changeIndex = nextIndex;
            recordIndex = nextIndex + 1;
            _insertPair(changeCommitment, recordCommitment);
        } else {
            changeIndex = _insert(changeCommitment);
            recordIndex = _insert(recordCommitment);
        }

        (bool ok,) = merchant.call{value: amount}("");
        if (!ok) revert TransferFailed();
        if (fee > 0) {
            (bool ok2,) = payable(msg.sender).call{value: fee}("");
            if (!ok2) revert TransferFailed();
        }

        if (stealth.ephemeralPubKey.length > 0) {
            emit StealthAnnouncement(merchant, stealth.viewTag, stealth.ephemeralPubKey, invoiceId);
        }
        emit Payment(
            invoiceId, merchant, amount, nullifier, changeCommitment, changeIndex, recordCommitment, recordIndex
        );
    }

    // ---------------------------------------------------------------- admin

    function setMaxDeposit(uint256 _maxDeposit) external onlyOwner {
        maxDeposit = _maxDeposit;
        emit MaxDepositUpdated(_maxDeposit);
    }

    function setDepositPolicy(IDepositPolicy policy) external onlyOwner {
        depositPolicy = policy;
        emit DepositPolicyUpdated(address(policy));
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // ----------------------------------------------------------------- views

    function getLastRoot() external view returns (uint256) {
        return roots[currentRootIndex];
    }

    function isKnownRoot(uint256 root) public view returns (bool) {
        if (root == 0) return false;
        uint32 i = currentRootIndex;
        do {
            if (roots[i] == root) return true;
            if (i == 0) i = uint32(ROOT_HISTORY_SIZE);
            i--;
        } while (i != currentRootIndex);
        return false;
    }

    // -------------------------------------------------------------- internal

    function _hash2(uint256 l, uint256 r) internal view returns (uint256) {
        return hasher2.poseidon([l, r]);
    }

    function _pushRoot(uint256 newRoot) internal {
        uint32 idx = (currentRootIndex + 1) % uint32(ROOT_HISTORY_SIZE);
        currentRootIndex = idx;
        roots[idx] = newRoot;
        emit RootAdded(newRoot);
    }

    function _insert(uint256 leaf) internal returns (uint32 index) {
        index = nextIndex;
        if (index >= uint32(1 << TREE_DEPTH)) revert TreeFull();
        uint32 cur = index;
        uint256 node = leaf;
        for (uint256 i = 0; i < TREE_DEPTH; i++) {
            if (cur % 2 == 0) {
                filledSubtrees[i] = node;
                node = _hash2(node, zeros[i]);
            } else {
                node = _hash2(filledSubtrees[i], node);
            }
            cur >>= 1;
        }
        _pushRoot(node);
        nextIndex = index + 1;
    }

    /// @dev Inserts two sibling leaves with one fewer tree level of hashing.
    ///      Requires nextIndex to be even.
    function _insertPair(uint256 leaf1, uint256 leaf2) internal {
        uint32 index = nextIndex;
        if (index + 1 >= uint32(1 << TREE_DEPTH)) revert TreeFull();
        uint256 node = _hash2(leaf1, leaf2);
        uint32 cur = index >> 1;
        for (uint256 i = 1; i < TREE_DEPTH; i++) {
            if (cur % 2 == 0) {
                filledSubtrees[i] = node;
                node = _hash2(node, zeros[i]);
            } else {
                node = _hash2(filledSubtrees[i], node);
            }
            cur >>= 1;
        }
        _pushRoot(node);
        nextIndex = index + 2;
    }
}
