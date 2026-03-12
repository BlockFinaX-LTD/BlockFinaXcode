const hre = require("hardhat");

const DIAMOND_ADDRESS = "0x3582D8f5f88ef557ce10Af26834FAC8B8e1445bf";

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Upgrading with account:", deployer.address);

  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log("Balance:", hre.ethers.formatEther(balance), "ETH\n");

  console.log("Deploying new BlockFinaXHedgeFacet (v2 - reentrancy fix)...");
  const HedgeFacet = await hre.ethers.getContractFactory("BlockFinaXHedgeFacet");
  const newHedgeFacet = await HedgeFacet.deploy();
  await newHedgeFacet.waitForDeployment();
  const newHedgeAddress = await newHedgeFacet.getAddress();
  console.log("New HedgeFacet deployed at:", newHedgeAddress);

  const selectors = [
    newHedgeFacet.interface.getFunction("initializeHedgeFees").selector,
    newHedgeFacet.interface.getFunction("setOracleAdmin").selector,
    newHedgeFacet.interface.getFunction("withdrawPlatformFees").selector,
    newHedgeFacet.interface.getFunction("createEvent").selector,
    newHedgeFacet.interface.getFunction("setPoolSettings").selector,
    newHedgeFacet.interface.getFunction("deposit").selector,
    newHedgeFacet.interface.getFunction("buyProtection").selector,
    newHedgeFacet.interface.getFunction("settleEvent").selector,
    newHedgeFacet.interface.getFunction("claimPayout").selector,
    newHedgeFacet.interface.getFunction("claimPremiums").selector,
    newHedgeFacet.interface.getFunction("withdrawCapital").selector,
    newHedgeFacet.interface.getFunction("withdrawCreatorEarnings").selector,
    newHedgeFacet.interface.getFunction("getHedgeEventCore").selector,
    newHedgeFacet.interface.getFunction("getHedgeEventStats").selector,
    newHedgeFacet.interface.getFunction("getHedgePosition").selector,
    newHedgeFacet.interface.getFunction("getHedgeLpDeposit").selector,
    newHedgeFacet.interface.getFunction("getEventPositionIds").selector,
    newHedgeFacet.interface.getFunction("getEventDepositIds").selector,
    newHedgeFacet.interface.getFunction("getCreatorEventIds").selector,
    newHedgeFacet.interface.getFunction("getHedgerPositionIds").selector,
    newHedgeFacet.interface.getFunction("getLpDepositIds").selector,
    newHedgeFacet.interface.getFunction("getHedgeFeeConfig").selector,
    newHedgeFacet.interface.getFunction("getHedgePlatformFees").selector,
    newHedgeFacet.interface.getFunction("getTotalHedgeEvents").selector,
    newHedgeFacet.interface.getFunction("getPoolUtilization").selector,
  ];

  console.log("\nReplacing HedgeFacet functions via diamondCut...");

  const diamondCut = await hre.ethers.getContractAt(
    "BlockFinaXDiamondCutFacet",
    DIAMOND_ADDRESS
  );

  const tx = await diamondCut.diamondCut(
    [{
      facetAddress: newHedgeAddress,
      action: 1, // Replace
      functionSelectors: selectors
    }],
    hre.ethers.ZeroAddress,
    "0x"
  );

  await tx.wait();
  console.log("Diamond upgrade complete. Transaction:", tx.hash);

  console.log("\n" + "=".repeat(60));
  console.log("UPGRADE SUMMARY");
  console.log("=".repeat(60));
  console.log("Diamond (unchanged):    ", DIAMOND_ADDRESS);
  console.log("New HedgeFacet:         ", newHedgeAddress);
  console.log("Functions replaced:     ", selectors.length);
  console.log("All existing data:       Preserved");
  console.log("=".repeat(60));

  console.log("\nVerify new facet:");
  console.log(`npx hardhat verify --network liskSepolia ${newHedgeAddress}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Upgrade failed:", error);
    process.exit(1);
  });
