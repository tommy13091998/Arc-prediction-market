import { expect } from "chai";
import hre from "hardhat";

describe("PredictionMarket", function () {
  let mockUSDC;
  let predictionMarket;
  let owner;
  let user1;
  let user2;

  beforeEach(async function () {
    [owner, user1, user2] = await hre.ethers.getSigners();

    // Deploy MockUSDC
    const MockUSDC = await hre.ethers.getContractFactory("MockUSDC");
    mockUSDC = await MockUSDC.deploy();
    await mockUSDC.waitForDeployment();

    // Deploy PredictionMarket
    const PredictionMarket = await hre.ethers.getContractFactory("PredictionMarket");
    predictionMarket = await PredictionMarket.deploy(await mockUSDC.getAddress());
    await predictionMarket.waitForDeployment();

    // Distribute USDC to user1 and user2
    const amount = hre.ethers.parseUnits("1000", 6); // 1000 USDC
    await mockUSDC.transfer(user1.address, amount);
    await mockUSDC.transfer(user2.address, amount);

    // Approve PredictionMarket to spend USDC
    await mockUSDC.approve(await predictionMarket.getAddress(), hre.ethers.MaxUint256);
    await mockUSDC.connect(user1).approve(await predictionMarket.getAddress(), hre.ethers.MaxUint256);
    await mockUSDC.connect(user2).approve(await predictionMarket.getAddress(), hre.ethers.MaxUint256);
  });

  it("should create a market with initial liquidity", async function () {
    const question = "Will Bitcoin exceed $100k in 2026?";
    const description = "Resolves to YES if BTC exceeds $100k on Binance anytime in 2026, otherwise NO.";
    const category = "Crypto";
    const endTime = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now
    const initialLiquidity = hre.ethers.parseUnits("100", 6); // 100 USDC

    await predictionMarket.createMarket(question, description, category, endTime, initialLiquidity);

    const market = await predictionMarket.markets(0);
    expect(market.id).to.equal(0);
    expect(market.creator).to.equal(owner.address);
    expect(market.question).to.equal(question);
    expect(market.yesReserves).to.equal(initialLiquidity);
    expect(market.noReserves).to.equal(initialLiquidity);
    expect(market.totalLPSupply).to.equal(initialLiquidity);

    const lpBalance = await predictionMarket.lpBalances(0, owner.address);
    expect(lpBalance).to.equal(initialLiquidity);
  });

  it("should allow buying YES and NO shares with correct pricing", async function () {
    const endTime = Math.floor(Date.now() / 1000) + 3600;
    const initialLiquidity = hre.ethers.parseUnits("100", 6); // 100 USDC (y=100, n=100)
    await predictionMarket.createMarket("Q", "D", "C", endTime, initialLiquidity);

    // User1 buys YES with 10 USDC
    const buyAmount = hre.ethers.parseUnits("10", 6);
    
    // Check quote
    const expectedShares = await predictionMarket.getBuyYesQuote(0, buyAmount);
    // Math:
    // k = 100 * 100 = 10000
    // newNoReserves = 100 + 10 = 110
    // newYesReserves = 10000 / 110 = 90.909090
    // user gets: 10 + 100 - 90.909090 = 19.090909 (approx 19.09 shares)
    expect(expectedShares).to.be.closeTo(hre.ethers.parseUnits("19.090909", 6), 1000);

    // Perform buy
    await predictionMarket.connect(user1).buyYes(0, buyAmount);

    // Check balances
    const yesBalance = await predictionMarket.yesBalances(0, user1.address);
    expect(yesBalance).to.equal(expectedShares);

    // Check reserves
    const market = await predictionMarket.markets(0);
    expect(market.noReserves).to.equal(hre.ethers.parseUnits("110", 6));
    expect(market.yesReserves).to.be.closeTo(hre.ethers.parseUnits("90.909090", 6), 10);
  });

  it("should allow selling YES shares and return correct USDC amount", async function () {
    const endTime = Math.floor(Date.now() / 1000) + 3600;
    const initialLiquidity = hre.ethers.parseUnits("100", 6);
    await predictionMarket.createMarket("Q", "D", "C", endTime, initialLiquidity);

    // User1 buys YES with 10 USDC
    const buyAmount = hre.ethers.parseUnits("10", 6);
    await predictionMarket.connect(user1).buyYes(0, buyAmount);

    const yesBalance = await predictionMarket.yesBalances(0, user1.address);
    
    // User1 sells all YES shares
    const sellQuote = await predictionMarket.getSellYesQuote(0, yesBalance);
    expect(sellQuote).to.be.closeTo(buyAmount, 10); // Should return approx 10 USDC (what we put in)

    const initialUsdc = await mockUSDC.balanceOf(user1.address);
    await predictionMarket.connect(user1).sellYes(0, yesBalance);
    const finalUsdc = await mockUSDC.balanceOf(user1.address);

    expect(finalUsdc - initialUsdc).to.equal(sellQuote);
    expect(await predictionMarket.yesBalances(0, user1.address)).to.equal(0);
  });

  it("should resolve market and allow claiming winnings", async function () {
    const endTime = Math.floor(Date.now() / 1000) + 3600;
    const initialLiquidity = hre.ethers.parseUnits("100", 6);
    await predictionMarket.createMarket("Q", "D", "C", endTime, initialLiquidity);

    // User1 buys YES with 10 USDC -> gets ~19.09 YES shares
    await predictionMarket.connect(user1).buyYes(0, hre.ethers.parseUnits("10", 6));
    
    // User2 buys NO with 20 USDC
    // Current pool: y=90.909, n=110. Product k = 10000
    // User2 buys NO with 20 USDC:
    // Mint 20 YES and 20 NO. Deposit 20 YES into pool.
    // pool YES becomes 90.909 + 20 = 110.909.
    // pool NO becomes 10000 / 110.909 = 90.163.
    // Pool releases 110 - 90.163 = 19.837 NO shares.
    // User2 gets 20 + 19.837 = 39.837 NO shares.
    await predictionMarket.connect(user2).buyNo(0, hre.ethers.parseUnits("20", 6));

    // Resolve market to YES (outcome = 1)
    await predictionMarket.resolveMarket(0, 1);

    const market = await predictionMarket.markets(0);
    expect(market.resolved).to.be.true;
    expect(market.outcome).to.equal(1);

    // User1 claims winnings
    const user1YesBefore = await predictionMarket.yesBalances(0, user1.address);
    const user1UsdcBefore = await mockUSDC.balanceOf(user1.address);
    
    await predictionMarket.connect(user1).redeemWinnings(0);

    const user1UsdcAfter = await mockUSDC.balanceOf(user1.address);
    // User1 should get 1 USDC per YES share
    expect(user1UsdcAfter - user1UsdcBefore).to.equal(user1YesBefore);

    // LP (owner) claims winnings
    const ownerUsdcBefore = await mockUSDC.balanceOf(owner.address);
    await predictionMarket.redeemWinnings(0);
    const ownerUsdcAfter = await mockUSDC.balanceOf(owner.address);

    // Owner gets their portion of remaining yesReserves in the pool
    // In this case, since owner has 100% of LP, they get all of pool's yesReserves
    expect(ownerUsdcAfter - ownerUsdcBefore).to.equal(market.yesReserves);
  });
});
