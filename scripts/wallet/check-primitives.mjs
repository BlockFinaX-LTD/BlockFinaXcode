/**
 * check-primitives.js: are the pieces a passkey-signed smart account needs
 * actually deployed on each chain we support?
 *
 * Read-only. No keys, no signing, public RPCs only. Re-run before relying on
 * the deployment table in docs/architecture/wallet-infrastructure-design.md.
 *
 * Usage: node scripts/wallet/check-primitives.mjs
 */
import { ethers } from "ethers";

const CONTRACTS = {
  "EntryPoint v0.7":      "0x0000000071727De22E5E9d8BAf0edAc6f37da032",
  "EntryPoint v0.6":      "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789",
  "Safe4337Module":       "0x75cf11467937ce3F2f357CE24ffc3DBF8fD5c226",
  "Safe singleton 1.4.1": "0x41675C099F32341bf84BFc5382aF534df5C7461a",
  "SafeProxyFactory":     "0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67",
  "Daimo P256Verifier":   "0xc2b78104907F722DABAc4C69f826a522B2754De4",
};

const CHAINS = [
  ["Base", "https://mainnet.base.org"],
  ["BSC",  "https://bsc-dataseed.bnbchain.org"],
  ["Lisk", "https://rpc.api.lisk.com"],
];

// RIP-7212 returns empty bytes for an invalid signature, which is exactly what
// a missing precompile returns, so a garbage probe proves nothing.
//
// TODO before relying on this: replace VECTOR with a published valid
// secp256r1 test vector (hash || r || s || x || y, 160 bytes). The value below
// is a PLACEHOLDER and is not a valid signature, so this check currently
// reports "not confirmed" on every chain whether or not the precompile exists.
// Until it is replaced, assume the Solidity verifier path and treat the
// precompile purely as an optimisation to be measured later.
const P256 = "0x0000000000000000000000000000000000000100";
const VECTOR =
  "0x4cee90eb86eaa050036147a12d49004b6b9c72bd725d39d4785011fe190f0b4d" + // hash
  "a73bd4903f0ce3b639bbbf6e8e80d16931ff4bcf5993d58468e8fb19086e8cac" + // r
  "36dbcd03009df8c59286b162af3bd7fcc0450c9aa81be5d10d312af6c66b1d60" + // s
  "7ad2d0d3d6f7f0a2a4e9b4c3f5f9c3b1d6ebb6e7e5fbf5b5e6a8a7c8d9e0f1a2" + // x
  "5e78d1c0b6b2f5c3a4d9e8f7b6c5a4938271605f4e3d2c1b0a9f8e7d6c5b4a39";  // y

(async () => {
  for (const [name, rpc] of CHAINS) {
    console.log("\n=== " + name);
    const p = new ethers.JsonRpcProvider(rpc);
    for (const [label, addr] of Object.entries(CONTRACTS)) {
      let code = "0x";
      try { code = await p.getCode(addr); } catch {}
      const n = code.length / 2 - 1;
      console.log("  " + label.padEnd(22) + (n > 0 ? "present  " + n + " bytes" : "ABSENT"));
    }
    try {
      const r = await p.call({ to: P256, data: VECTOR });
      const ok = /^0x0{63}1$/.test(r);
      console.log("  " + "RIP-7212 precompile".padEnd(22)
        + (ok ? "present, use it (~3.4k gas)"
              : "NOT CONFIRMED (placeholder vector, see TODO) - assume ~300k gas"));
    } catch {
      console.log("  " + "RIP-7212 precompile".padEnd(22) + "not confirmed");
    }
  }
  console.log("\nAbsent pieces must be deployed before that chain can carry a");
  console.log("passkey-signed account. All of these have deterministic deployments.\n");
})();
