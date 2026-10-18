// Downloads the pinned official circom release and verifies its SHA-256.
// Hashes were computed from the iden3/circom v2.2.3 release assets on
// 2026-10-14; re-verify against a source you trust when bumping VERSION.
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const VERSION = "v2.2.3";
const ASSETS = {
  win32: { file: "circom-windows-amd64.exe", out: "circom.exe", sha256: "E43F132EE6F0AA79B705BECEB59C2A7E6A54D7BDEAB917CA34E9FC1951D185E1" },
  linux: { file: "circom-linux-amd64", out: "circom", sha256: "85342C7FF332D948DF7C0C50ECF201E6129349AEF550CE873F3C811B79FE53A3" },
  darwin: { file: "circom-macos-amd64", out: "circom", sha256: "E006332B3FE225F11C3B87BD2DEBBF5D7F568D6EFBDE25E5A6A12CD6988C8ECB" },
};

async function main() {
  const asset = ASSETS[process.platform];
  if (!asset) throw new Error(`unsupported platform ${process.platform}`);
  const dir = path.join(__dirname, "..", "tools", "circom");
  const dest = path.join(dir, asset.out);
  const sha = (buf) => crypto.createHash("sha256").update(buf).digest("hex").toUpperCase();

  if (fs.existsSync(dest) && sha(fs.readFileSync(dest)) === asset.sha256) {
    console.log("circom already present and verified");
    return;
  }
  const url = `https://github.com/iden3/circom/releases/download/${VERSION}/${asset.file}`;
  console.log("downloading", url);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (sha(buf) !== asset.sha256) throw new Error("circom checksum mismatch, refusing to install");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(dest, buf, { mode: 0o755 });
  console.log("circom installed and verified");
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
