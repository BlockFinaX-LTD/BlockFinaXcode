/**
 * StellarDeposit / StellarDepositFactory on a local EVM, with a real-shaped USDC, a fake
 * "USDC" an attacker controls, and a TokenMessenger mock that records what it was asked to burn.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { ethers } from "ethers";

const require_ = createRequire(import.meta.url);
const solc = require_("solc");
const vmPkg = require_("@ethereumjs/vm");
const util = createRequire(require_.resolve("@ethereumjs/vm"))("@ethereumjs/util");

const MOCKS = `
pragma solidity 0.8.34;
contract MockToken {
  mapping(address => uint256) public balanceOf;
  mapping(address => mapping(address => uint256)) public allowance;
  function mint(address to, uint256 a) external { balanceOf[to] += a; }
  function approve(address s, uint256 a) external returns (bool) { allowance[msg.sender][s] = a; return true; }
  function transfer(address to, uint256 a) external returns (bool) { balanceOf[msg.sender] -= a; balanceOf[to] += a; return true; }
  function transferFrom(address f, address t, uint256 a) external returns (bool) {
    allowance[f][msg.sender] -= a; balanceOf[f] -= a; balanceOf[t] += a; return true;
  }
}
contract MockMessenger {
  uint256 public calls; uint256 public amount; uint32 public domain; bytes32 public mintRecipient; address public burnToken;
  bytes32 public destinationCaller; uint256 public maxFee; uint32 public finality; bytes public hookData;
  function depositForBurnWithHook(uint256 a, uint32 d, bytes32 r, address t, bytes32 c, uint256 f, uint32 m, bytes calldata h) external {
    MockToken(t).transferFrom(msg.sender, address(this), a);
    calls++; amount = a; domain = d; mintRecipient = r; burnToken = t; destinationCaller = c; maxFee = f; finality = m; hookData = h;
  }
}`;

function compile() {
  const src = readFileSync(path.join(process.cwd(), "contracts/evm/StellarDeposit.sol"), "utf8");
  const out = JSON.parse(solc.compile(JSON.stringify({
    language: "Solidity",
    sources: { "StellarDeposit.sol": { content: src }, "Mocks.sol": { content: "// SPDX-License-Identifier: MIT\n" + MOCKS } },
    settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "cancun", outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } } },
  })));
  const errs = (out.errors ?? []).filter((e: any) => e.severity === "error");
  if (errs.length) throw new Error(errs.map((e: any) => e.formattedMessage).join("\n"));
  const get = (f: string, n: string) => ({ abi: out.contracts[f][n].abi, bytecode: "0x" + out.contracts[f][n].evm.bytecode.object });
  return {
    factory: get("StellarDeposit.sol", "StellarDepositFactory"),
    deposit: get("StellarDeposit.sol", "StellarDeposit"),
    token: get("Mocks.sol", "MockToken"),
    messenger: get("Mocks.sol", "MockMessenger"),
  };
}

const ART = compile();
const FORWARDER = "0x" + "ab".repeat(32);
const WALLET = "CB4IWMDLPUPCFNMQH4KLEFWX6PEN5M2OGNY25E5YA7DUTPOYD4E2YWXU";
const OTHER = "GDDHDXGNMHSRPGP2GF6NJYGNZ22XYOR2PMWGF4TKZVFX6SHWQUUUEKI7";

async function chain() {
  const vm = await vmPkg.createVM();
  const caller = util.createAddressFromString("0x" + "11".repeat(20));
  const attacker = util.createAddressFromString("0x" + "66".repeat(20));
  async function deploy(art: { abi: any; bytecode: string }, args: unknown[] = []) {
    const data = ethers.concat([art.bytecode, new ethers.Interface(art.abi).encodeDeploy(args)]);
    const r = await vm.evm.runCall({ caller, data: ethers.getBytes(data), gasLimit: BigInt(30_000_000) });
    if (r.execResult.exceptionError) throw new Error(`deploy failed: ${r.execResult.exceptionError.error}`);
    return { address: r.createdAddress!.toString(), iface: new ethers.Interface(art.abi) };
  }
  async function call(c: { address: string; iface: ethers.Interface }, fn: string, args: unknown[] = [], from = caller) {
    const r = await vm.evm.runCall({
      caller: from, to: util.createAddressFromString(c.address), data: ethers.getBytes(c.iface.encodeFunctionData(fn, args)), gasLimit: BigInt(10_000_000),
    });
    if (r.execResult.exceptionError) {
      const ret = ethers.hexlify(r.execResult.returnValue);
      let reason = r.execResult.exceptionError.error;
      try { reason = ethers.AbiCoder.defaultAbiCoder().decode(["string"], ethers.dataSlice(ret, 4))[0]; } catch { /* not an Error(string) */ }
      throw new Error(`revert: ${reason}`);
    }
    const out = c.iface.decodeFunctionResult(fn, r.execResult.returnValue);
    return out.length === 1 ? out[0] : out;
  }
  const usdc = await deploy(ART.token);
  const fake = await deploy(ART.token);
  const messenger = await deploy(ART.messenger);
  const implementation = await deploy(ART.deposit);
  const factory = await deploy(ART.factory, [implementation.address, usdc.address, messenger.address, FORWARDER, 27, BigInt(10_000_000), BigInt(10)]);
  return { vm, deploy, call, usdc, fake, messenger, factory, implementation, attacker };
}

const dep = (address: string) => ({ address, iface: new ethers.Interface(ART.deposit.abi) });

test("the deposit address is fixed by the Stellar wallet, before and after it exists", async () => {
  const c = await chain();
  const a = await c.call(c.factory, "addressFor", [WALLET]);
  assert.notEqual(a, await c.call(c.factory, "addressFor", [OTHER]));
  await c.call(c.usdc, "mint", [a, BigInt(25_000_000)]);
  await c.call(c.factory, "flush", [WALLET, BigInt(0), 1000]);
  assert.equal(await c.call(dep(a), "factory"), ethers.getAddress(c.factory.address));
  assert.equal(await c.call(c.factory, "addressFor", [WALLET]), a);
});

test("flush burns all real USDC to Circle's forwarder with the user's wallet in the hook", async () => {
  const c = await chain();
  const a = await c.call(c.factory, "addressFor", [WALLET]);
  await c.call(c.usdc, "mint", [a, BigInt(25_000_000)]);
  // Anyone may trigger it, an attacker included: it can only go to the user.
  await c.call(c.factory, "flush", [WALLET, BigInt(2_500), 1000], c.attacker);
  assert.equal(await c.call(c.messenger, "amount"), BigInt(25_000_000));
  assert.equal(await c.call(c.messenger, "domain"), BigInt(27));
  assert.equal(await c.call(c.messenger, "mintRecipient"), FORWARDER);
  assert.equal(await c.call(c.messenger, "destinationCaller"), FORWARDER);
  assert.equal(await c.call(c.messenger, "burnToken"), ethers.getAddress(c.usdc.address));
  const hook = ethers.getBytes(await c.call(c.messenger, "hookData"));
  assert.equal(ethers.toUtf8String(hook.slice(32)), WALLET);
  assert.equal(await c.call(c.usdc, "balanceOf", [a]), BigInt(0));
});

test("a fake USDC sent to the address is never moved or burned", async () => {
  const c = await chain();
  const a = await c.call(c.factory, "addressFor", [WALLET]);
  await c.call(c.fake, "mint", [a, BigInt(1_000_000_000)], c.attacker);
  await assert.rejects(c.call(c.factory, "flush", [WALLET, BigInt(0), 1000], c.attacker), /below minimum/);
  assert.equal(await c.call(c.messenger, "calls"), BigInt(0));
  // Real USDC arriving later is burned alone; the fake stays where it is.
  await c.call(c.usdc, "mint", [a, BigInt(12_000_000)]);
  await c.call(c.factory, "flush", [WALLET, BigInt(0), 1000]);
  assert.equal(await c.call(c.messenger, "burnToken"), ethers.getAddress(c.usdc.address));
  assert.equal(await c.call(c.messenger, "amount"), BigInt(12_000_000));
  assert.equal(await c.call(c.fake, "balanceOf", [a]), BigInt(1_000_000_000));
});

test("a caller cannot set a fee above the cap", async () => {
  const c = await chain();
  const a = await c.call(c.factory, "addressFor", [WALLET]);
  await c.call(c.usdc, "mint", [a, BigInt(20_000_000)]);
  // Cap is 10 bps: 20 USDC allows at most 0.02 USDC.
  await assert.rejects(c.call(c.factory, "flush", [WALLET, BigInt(20_001), 1000], c.attacker), /fee above cap/);
  await c.call(c.factory, "flush", [WALLET, BigInt(20_000), 1000]);
  assert.equal(await c.call(c.messenger, "maxFee"), BigInt(20_000));
});

test("dust below the minimum is left until more arrives", async () => {
  const c = await chain();
  const a = await c.call(c.factory, "addressFor", [WALLET]);
  await c.call(c.usdc, "mint", [a, BigInt(9_999_999)]);
  await assert.rejects(c.call(c.factory, "flush", [WALLET, BigInt(0), 1000]), /below minimum/);
});

test("only Fast or Standard finality is accepted", async () => {
  const c = await chain();
  const a = await c.call(c.factory, "addressFor", [WALLET]);
  await c.call(c.usdc, "mint", [a, BigInt(20_000_000)]);
  await assert.rejects(c.call(c.factory, "flush", [WALLET, BigInt(0), 500]), /bad finality/);
  await c.call(c.factory, "flush", [WALLET, BigInt(0), 2000]);
});

test("malformed Stellar recipients are refused, so no USDC can be minted to nowhere", async () => {
  const c = await chain();
  await assert.rejects(c.call(c.factory, "hookFor", [WALLET.slice(0, 10) + WALLET.slice(10).toLowerCase()]), /recipient charset/);
  await assert.rejects(c.call(c.factory, "hookFor", [WALLET.slice(1)]), /recipient length/);
  await assert.rejects(c.call(c.factory, "hookFor", ["M" + WALLET.slice(1)]), /recipient type/);
  const bad = WALLET.slice(0, 55) + "1";
  const a = await c.call(c.factory, "addressFor", [bad]);
  await c.call(c.usdc, "mint", [a, BigInt(20_000_000)]);
  await assert.rejects(c.call(c.factory, "flush", [bad, BigInt(0), 1000]), /create failed|recipient charset/);
});

test("a second deposit to the same address flushes again", async () => {
  const c = await chain();
  const a = await c.call(c.factory, "addressFor", [WALLET]);
  await c.call(c.usdc, "mint", [a, BigInt(15_000_000)]);
  await c.call(c.factory, "flush", [WALLET, BigInt(0), 1000]);
  await c.call(c.usdc, "mint", [a, BigInt(30_000_000)]);
  await c.call(dep(a), "flush", [BigInt(0), 1000], c.attacker);
  assert.equal(await c.call(c.messenger, "calls"), BigInt(2));
  assert.equal(await c.call(c.messenger, "amount"), BigInt(30_000_000));
});

test("nobody can re-point a deposit address or use the implementation as one", async () => {
  const c = await chain();
  const a = await c.call(c.factory, "addressFor", [WALLET]);
  await c.call(c.usdc, "mint", [a, BigInt(20_000_000)]);
  await c.call(c.factory, "flush", [WALLET, BigInt(0), 1000]);
  const evil = new ethers.Interface(ART.deposit.abi).encodeFunctionData("initialize", [ethers.toUtf8Bytes("attacker")]);
  await assert.rejects(c.call(dep(a), "initialize", [ethers.toUtf8Bytes("attacker")], c.attacker), /initialized/);
  await assert.rejects(c.call(c.implementation, "initialize", [ethers.toUtf8Bytes("attacker")], c.attacker), /initialized/);
  await c.call(c.usdc, "mint", [c.implementation.address, BigInt(20_000_000)]);
  await assert.rejects(c.call(c.implementation, "flush", [BigInt(0), 1000], c.attacker), /not a deposit address/);
  assert.ok(evil.length > 0);
});

test("the server computes the same deposit address as the factory", async () => {
  const c = await chain();
  const { depositAddressFor } = await import("../deposit-addresses");
  assert.equal(depositAddressFor(c.factory.address, c.implementation.address, WALLET), await c.call(c.factory, "addressFor", [WALLET]));
});
