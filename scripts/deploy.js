const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying WillVault with account:", deployer.address);

  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log("Balance:", hre.ethers.formatEther(balance), "MON");

  const WillVault = await hre.ethers.getContractFactory("WillVault");
  const vault = await WillVault.deploy();
  await vault.waitForDeployment();

  const address = await vault.getAddress();
  console.log("\n✅ WillVault deployed to:", address);
  console.log("Explorer: https://testnet.monadexplorer.com/address/" + address);
  console.log("\nPaste this address into frontend/index.html (CONTRACT_ADDRESS).");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
