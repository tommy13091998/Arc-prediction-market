import hre from "hardhat";

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying contracts with the account:", deployer.address);

  let usdcAddress;
  const networkName = hre.network.name;

  if (networkName === "localhost" || networkName === "hardhat") {
    console.log("Local network detected. Deploying MockUSDC...");
    const MockUSDC = await hre.ethers.getContractFactory("MockUSDC");
    const mockUSDC = await MockUSDC.deploy();
    await mockUSDC.waitForDeployment();
    usdcAddress = await mockUSDC.getAddress();
    console.log("MockUSDC deployed to:", usdcAddress);

    // Mint some USDC for local testing if needed
    const balance = await mockUSDC.balanceOf(deployer.address);
    console.log("Deployer USDC balance:", hre.ethers.formatUnits(balance, 6));
  } else if (networkName === "arcTestnet") {
    // Arc Testnet USDC address
    usdcAddress = "0x3600000000000000000000000000000000000000";
    console.log("Arc Testnet detected. Using standard USDC address:", usdcAddress);
  } else {
    throw new Error(`Unsupported network: ${networkName}`);
  }

  console.log("Deploying PredictionMarket...");
  const PredictionMarket = await hre.ethers.getContractFactory("PredictionMarket");
  const predictionMarket = await PredictionMarket.deploy(usdcAddress);
  await predictionMarket.waitForDeployment();

  const pmAddress = await predictionMarket.getAddress();
  console.log("PredictionMarket deployed to:", pmAddress);

  console.log("Deployment completed successfully.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
