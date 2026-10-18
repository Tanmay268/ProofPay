// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IDepositPolicy} from "./ShieldedPool.sol";

/// @title Owner-curated deposit blocklist (compliance v1)
/// @notice Intended for a sanctions-list oracle or a DAO/multisig. Blocking
///         only affects NEW deposits; it cannot touch existing notes.
contract BlocklistPolicy is IDepositPolicy, Ownable2Step {
    mapping(address => bool) public blocked;

    event BlockedSet(address indexed account, bool blocked);

    constructor(address initialOwner) Ownable(initialOwner) {}

    function setBlocked(address account, bool value) external onlyOwner {
        blocked[account] = value;
        emit BlockedSet(account, value);
    }

    function isDepositAllowed(address depositor) external view returns (bool) {
        return !blocked[depositor];
    }
}
