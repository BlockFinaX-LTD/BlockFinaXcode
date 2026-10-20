// Compile contracts/evm/StellarDeposit.sol with solc-js into contracts/evm/artifacts/StellarDeposit.json.
const fs = require("fs");
const path = require("path");
const solc = require("solc");
const file = path.join(__dirname, "../contracts/evm/StellarDeposit.sol");
const input = {
  language: "Solidity",
  sources: { "StellarDeposit.sol": { content: fs.readFileSync(file, "utf8") } },
  settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "cancun", outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } } },
};
const out = JSON.parse(solc.compile(JSON.stringify(input)));
const errors = (out.errors || []).filter((e) => e.severity === "error");
for (const e of out.errors || []) console.error(e.formattedMessage);
if (errors.length) process.exit(1);
const c = out.contracts["StellarDeposit.sol"];
const result = {
  compiler: solc.version(),
  StellarDepositFactory: { abi: c.StellarDepositFactory.abi, bytecode: "0x" + c.StellarDepositFactory.evm.bytecode.object },
  StellarDeposit: { abi: c.StellarDeposit.abi, bytecode: "0x" + c.StellarDeposit.evm.bytecode.object },
};
fs.writeFileSync(path.join(__dirname, "../contracts/evm/artifacts/StellarDeposit.json"), JSON.stringify(result, null, 2) + "\n");
console.log("compiled with", result.compiler, "factory bytes", (result.StellarDepositFactory.bytecode.length - 2) / 2);
