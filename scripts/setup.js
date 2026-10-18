// Compiles circuits and runs a DEVELOPMENT-ONLY trusted setup.
//
// !! The keys produced here are for local/testnet use. A single local
// !! contribution means whoever ran this knows the toxic waste. Before any
// !! real-value deployment, run a multi-party ceremony (see docs/CEREMONY.md)
// !! and replace build/*.zkey, build/*_vkey.json and contracts/PayVerifier.sol.
const { execFileSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const build = path.join(root, "build");
const circom = path.join(root, "tools", "circom", process.platform === "win32" ? "circom.exe" : "circom");
const snarkjs = path.join(root, "node_modules", "snarkjs", "build", "cli.cjs");
const PTAU_POWER = 15;
const CIRCUITS = ["pay", "receipt"];

const run = (cmd, args) => execFileSync(cmd, args, { cwd: root, stdio: "inherit" });
const sj = (...args) => run(process.execPath, [snarkjs, ...args]);
const entropy = () => crypto.randomBytes(32).toString("hex");

fs.mkdirSync(build, { recursive: true });

for (const c of CIRCUITS) {
  run(circom, [`circuits/${c}.circom`, "--r1cs", "--wasm", "--sym", "-o", "build", "-l", "node_modules", "-l", "circuits"]);
}

const ptau = path.join(build, "pot_final.ptau");
if (!fs.existsSync(ptau)) {
  sj("powersoftau", "new", "bn128", String(PTAU_POWER), "build/pot_0.ptau");
  sj("powersoftau", "contribute", "build/pot_0.ptau", "build/pot_1.ptau", "--name=dev", `-e=${entropy()}`);
  sj("powersoftau", "prepare", "phase2", "build/pot_1.ptau", "build/pot_final.ptau");
  fs.rmSync(path.join(build, "pot_0.ptau"), { force: true });
  fs.rmSync(path.join(build, "pot_1.ptau"), { force: true });
}

for (const c of CIRCUITS) {
  sj("groth16", "setup", `build/${c}.r1cs`, "build/pot_final.ptau", `build/${c}_0.zkey`);
  sj("zkey", "contribute", `build/${c}_0.zkey`, `build/${c}.zkey`, "--name=dev", `-e=${entropy()}`);
  fs.rmSync(path.join(build, `${c}_0.zkey`), { force: true });
  sj("zkey", "export", "verificationkey", `build/${c}.zkey`, `build/${c}_vkey.json`);
}

// On-chain verifier is only needed for the pay circuit.
sj("zkey", "export", "solidityverifier", "build/pay.zkey", "build/PayVerifier.sol");
const sol = fs
  .readFileSync(path.join(build, "PayVerifier.sol"), "utf8")
  .replace(/contract Groth16Verifier/, "contract PayVerifier");
fs.mkdirSync(path.join(root, "contracts", "generated"), { recursive: true });
fs.writeFileSync(path.join(root, "contracts", "generated", "PayVerifier.sol"), sol);
console.log("setup complete");
