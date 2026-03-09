import { ethers } from 'ethers';

const DIAMOND_ADDRESS = '0x7e2322f7cE4C80fE9a030444de8037Cc3f984F9C';
const LISK_SEPOLIA_RPC = 'https://rpc.sepolia-api.lisk.com';

const ABI = [
  'function initializeHedgeFees(uint256,uint256,uint256,uint256,uint256)',
  'function setOracleAdmin(address)',
  'function getHedgeFeeConfig() view returns (uint256,uint256,uint256,uint256,uint256)',
  'function getTotalHedgeEvents() view returns (uint256)',
];

async function main() {
  const privateKey = process.env.DEPLOYER_PRIVATE_KEY;
  if (!privateKey) {
    console.error('DEPLOYER_PRIVATE_KEY not set');
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(LISK_SEPOLIA_RPC);
  const signer = new ethers.Wallet(privateKey, provider);
  const contract = new ethers.Contract(DIAMOND_ADDRESS, ABI, signer);

  console.log(`Deployer address: ${signer.address}`);
  console.log(`Diamond address: ${DIAMOND_ADDRESS}`);

  const feeConfig = await contract.getHedgeFeeConfig();
  const creationFee = feeConfig[0];
  console.log(`\nCurrent fee config: creation=${ethers.formatUnits(creationFee, 6)}, hedger=${ethers.formatUnits(feeConfig[1], 6)}, payout=${ethers.formatUnits(feeConfig[2], 6)}, lp=${ethers.formatUnits(feeConfig[3], 6)}, creator=${ethers.formatUnits(feeConfig[4], 6)}`);

  if (creationFee === 0n) {
    console.log('\nInitializing hedge fees...');
    const creationFeeWei = ethers.parseUnits('25', 6);
    const hedgerFeeRate = ethers.parseUnits('0.005', 6);
    const payoutFeeRate = ethers.parseUnits('0.01', 6);
    const lpFeeRate = ethers.parseUnits('0.01', 6);
    const creatorLoyaltyRate = ethers.parseUnits('0.05', 6);

    const tx = await contract.initializeHedgeFees(
      creationFeeWei, hedgerFeeRate, payoutFeeRate, lpFeeRate, creatorLoyaltyRate
    );
    console.log(`  TX: ${tx.hash}`);
    await tx.wait();
    console.log('  Fees initialized successfully');
  } else {
    console.log('Fees already initialized, skipping');
  }

  console.log('\nSetting oracle admin to deployer...');
  try {
    const tx2 = await contract.setOracleAdmin(signer.address);
    console.log(`  TX: ${tx2.hash}`);
    await tx2.wait();
    console.log(`  Oracle admin set to ${signer.address}`);
  } catch (error: any) {
    if (error.message?.includes('already')) {
      console.log('  Oracle admin already set');
    } else {
      console.log(`  Note: ${error.reason || error.message}`);
    }
  }

  const totalEvents = await contract.getTotalHedgeEvents();
  console.log(`\nTotal hedge events on-chain: ${totalEvents}`);
  console.log('\nSetup complete!');
}

main().catch(console.error);
