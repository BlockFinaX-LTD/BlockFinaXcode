import { ethers } from 'ethers';
import { execSync } from 'child_process';
import { readFileSync } from 'fs';

const DIAMOND_ADDRESS = '0x1bba706e69F3a49c971E7e639b039fcBd4447E86';
const NEW_USDC_ADDRESS = '0xf52Ad63619Bf9cFeF510341ac6b4038554399562';
const LISK_SEPOLIA_RPC = 'https://rpc.sepolia-api.lisk.com';

async function main() {
  const provider = new ethers.JsonRpcProvider(LISK_SEPOLIA_RPC);
  const deployerKey = process.env.DEPLOYER_PRIVATE_KEY;
  if (!deployerKey) throw new Error('DEPLOYER_PRIVATE_KEY not set');
  const deployer = new ethers.Wallet(deployerKey, provider);
  console.log('Deployer:', deployer.address);

  console.log('\nStep 1: Compile GovernanceFacet with Hardhat...');
  execSync('npx hardhat compile', { cwd: 'contracts', stdio: 'inherit' });

  console.log('\nStep 2: Load compiled artifact...');
  const artifact = JSON.parse(
    readFileSync('contracts/artifacts/src/facets/BlockFinaXGovernanceFacet.sol/BlockFinaXGovernanceFacet.json', 'utf8')
  );

  console.log('\nStep 3: Deploy updated GovernanceFacet...');
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, deployer);
  const govFacet = await factory.deploy();
  await govFacet.waitForDeployment();
  const govAddress = await govFacet.getAddress();
  console.log('New GovernanceFacet deployed at:', govAddress);

  console.log('\nStep 4: Prepare Diamond Cut...');
  const govInterface = new ethers.Interface(artifact.abi);
  const setUSDCSelector = govInterface.getFunction('setUSDCToken').selector;
  const getUSDCSelector = govInterface.getFunction('getUSDCToken').selector;
  console.log('setUSDCToken selector:', setUSDCSelector);
  console.log('getUSDCToken selector:', getUSDCSelector);

  const DIAMOND_CUT_ABI = [
    'function diamondCut(tuple(address facetAddress, uint8 action, bytes4[] functionSelectors)[] _diamondCut, address _init, bytes _calldata)',
  ];

  const diamondCut = new ethers.Contract(DIAMOND_ADDRESS, DIAMOND_CUT_ABI, deployer);

  const facetCuts = [
    {
      facetAddress: govAddress,
      action: 0, // Add
      functionSelectors: [setUSDCSelector, getUSDCSelector]
    }
  ];

  console.log('\nStep 5: Execute Diamond Cut to add new selectors...');
  const cutTx = await diamondCut.diamondCut(facetCuts, ethers.ZeroAddress, '0x');
  await cutTx.wait();
  console.log('Diamond Cut tx:', cutTx.hash);

  console.log('\nStep 6: Call setUSDCToken to update USDC address...');
  const diamond = new ethers.Contract(DIAMOND_ADDRESS, [
    'function setUSDCToken(address _newUsdcToken)',
    'function getUSDCToken() view returns (address)',
  ], deployer);

  const tx = await diamond.setUSDCToken(NEW_USDC_ADDRESS);
  await tx.wait();
  console.log('setUSDCToken tx:', tx.hash);

  const currentUsdc = await diamond.getUSDCToken();
  console.log('\nVerification - USDC token on Diamond:', currentUsdc);
  console.log('Expected:', NEW_USDC_ADDRESS);
  console.log('Match:', currentUsdc.toLowerCase() === NEW_USDC_ADDRESS.toLowerCase());

  console.log('\nDone! Diamond now uses Test USDC for all operations.');
}

main().catch(err => { console.error('Error:', err.message); process.exit(1); });
