import { ethers } from "ethers";
import solc from "solc";

const provider = new ethers.JsonRpcProvider("https://rpc.sepolia-api.lisk.com");
const deployer = new ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY, provider);

console.log("Deployer:", deployer.address);

const SOURCE = `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract TestUSDC {
    string public name = "Test USDC";
    string public symbol = "USDC";
    uint8 public decimals = 6;
    uint256 public totalSupply;
    address public owner;
    
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    
    constructor() {
        owner = msg.sender;
    }
    
    function mint(address to, uint256 amount) external {
        require(msg.sender == owner, "Only owner");
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }
    
    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "Insufficient balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        emit Transfer(msg.sender, to, amount);
        return true;
    }
    
    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }
    
    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount, "Insufficient balance");
        require(allowance[from][msg.sender] >= amount, "Insufficient allowance");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        allowance[from][msg.sender] -= amount;
        emit Transfer(from, to, amount);
        return true;
    }
}
`;

const input = {
  language: "Solidity",
  sources: { "TestUSDC.sol": { content: SOURCE } },
  settings: { outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } } }
};

console.log("Compiling contract...");
const output = JSON.parse(solc.compile(JSON.stringify(input)));

if (output.errors) {
  const errors = output.errors.filter(e => e.severity === "error");
  if (errors.length > 0) {
    console.error("Compilation errors:", errors);
    process.exit(1);
  }
}

const compiled = output.contracts["TestUSDC.sol"]["TestUSDC"];
const abi = compiled.abi;
const bytecode = "0x" + compiled.evm.bytecode.object;

console.log("Deploying to Lisk Sepolia...");
const factory = new ethers.ContractFactory(abi, bytecode, deployer);
const contract = await factory.deploy();
await contract.waitForDeployment();
const address = await contract.getAddress();
console.log("Test USDC deployed at:", address);

console.log("Minting 10,000,000 USDC to deployer...");
const mintTx = await contract.mint(deployer.address, ethers.parseUnits("10000000", 6));
await mintTx.wait();

const balance = await contract.balanceOf(deployer.address);
console.log("Deployer USDC balance:", ethers.formatUnits(balance, 6));
console.log("\nDone! Update USDC_ADDRESS in hedge-contract.ts to:", address);
