import hre from "hardhat";

async function main() {
  // Get the target address from command line argument
  const targetAddress = process.env.TARGET_ADDRESS;
  if (!targetAddress || !hre.ethers.isAddress(targetAddress)) {
    console.error("Please specify a valid TARGET_ADDRESS env variable.");
    process.exit(1);
  }

  const [deployer] = await hre.ethers.getSigners();
  console.log(`Funding address: ${targetAddress}`);
  console.log(`Deployer balance: ${hre.ethers.formatEther(await hre.ethers.provider.getBalance(deployer.address))} ETH`);

  // 1. Send 10 ETH for Gas
  const tx = await deployer.sendTransaction({
    to: targetAddress,
    value: hre.ethers.parseEther("10.0")
  });
  await tx.wait();
  console.log(`Successfully sent 10.0 ETH to ${targetAddress} for gas.`);

  // 2. Mint 5,000 MockUSDC
  try {
    const MockUSDC = await hre.ethers.getContractFactory("MockUSDC");
    // Hardhat default MockUSDC address
    const mockUSDC = MockUSDC.attach("0x5FbDB2315678afecb367f032d93F642f64180aa3");
    const mintTx = await mockUSDC.mint(targetAddress, hre.ethers.parseUnits("5000", 6));
    await mintTx.wait();
    console.log(`Successfully minted 5,000 MockUSDC to ${targetAddress}.`);
  } catch (err) {
    console.error("Failed to mint MockUSDC. Make sure the contract is deployed at the correct address.", err);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
