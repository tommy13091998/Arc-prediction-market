// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract PredictionMarket {
    // IERC20 USDC token address
    address public immutable usdcToken;
    
    // Counter for market IDs
    uint256 public nextMarketId;
    
    // Market details stored in contract
    struct Market {
        uint256 id;
        address creator;
        string question;
        string description;
        string category;
        uint256 endTime;
        bool resolved;
        uint8 outcome; // 0: Unresolved, 1: YES, 2: NO, 3: INVALID
        uint256 yesReserves; // YES shares in the AMM pool
        uint256 noReserves;  // NO shares in the AMM pool
        uint256 totalLPSupply;
    }
    
    // Mapping from market ID to Market details
    mapping(uint256 => Market) public markets;
    
    // Mappings for balances: marketId => user => amount
    mapping(uint256 => mapping(address => uint256)) public yesBalances;
    mapping(uint256 => mapping(address => uint256)) public noBalances;
    mapping(uint256 => mapping(address => uint256)) public lpBalances;
    
    // Track if a user has redeemed for a specific market
    mapping(uint256 => mapping(address => bool)) public hasRedeemed;

    // Events for frontend tracking
    event MarketCreated(
        uint256 indexed marketId,
        address indexed creator,
        string question,
        string category,
        uint256 endTime,
        uint256 initialLiquidity
    );
    event SharesBought(
        uint256 indexed marketId,
        address indexed buyer,
        bool isYes,
        uint256 usdcAmount,
        uint256 sharesMinted
    );
    event SharesSold(
        uint256 indexed marketId,
        address indexed seller,
        bool isYes,
        uint256 sharesSold,
        uint256 usdcReturned
    );
    event MarketResolved(uint256 indexed marketId, uint8 outcome);
    event Redeemed(
        uint256 indexed marketId,
        address indexed redeemer,
        uint256 usdcAmount
    );
    event LiquidityWithdrawn(
        uint256 indexed marketId,
        address indexed lp,
        uint256 lpAmount,
        uint256 yesShares,
        uint256 noShares
    );

    constructor(address _usdcToken) {
        require(_usdcToken != address(0), "Invalid USDC address");
        usdcToken = _usdcToken;
    }

    /**
     * @dev Helper to compute square root (Uniswap V2 style)
     */
    function sqrt(uint256 y) internal pure returns (uint256 z) {
        if (y > 3) {
            z = y;
            uint256 x = y / 2 + 1;
            while (x < z) {
                z = x;
                x = (y / x + x) / 2;
            }
        } else if (y != 0) {
            z = 1;
        }
    }

    /**
     * @notice Create a new prediction market
     * @param question The main yes/no query of the market
     * @param description Detailed context or guidelines for resolution
     * @param category Market category (e.g. Crypto, Politics, Sports, Tech)
     * @param endTime Timestamp after which trading stops and resolution can occur
     * @param initialLiquidity Initial USDC collateral provided by the creator to seed the AMM pool
     */
    function createMarket(
        string calldata question,
        string calldata description,
        string calldata category,
        uint256 endTime,
        uint256 initialLiquidity
    ) external returns (uint256) {
        require(endTime > block.timestamp, "End time must be in the future");
        require(initialLiquidity >= 1e6, "Initial liquidity must be at least 1 USDC");

        // Transfer USDC from creator to this contract
        require(
            IERC20(usdcToken).transferFrom(msg.sender, address(this), initialLiquidity),
            "USDC transfer failed"
        );

        uint256 marketId = nextMarketId++;
        
        // Setup market info
        Market storage newMarket = markets[marketId];
        newMarket.id = marketId;
        newMarket.creator = msg.sender;
        newMarket.question = question;
        newMarket.description = description;
        newMarket.category = category;
        newMarket.endTime = endTime;
        newMarket.resolved = false;
        newMarket.outcome = 0;
        
        // Seed AMM pool: initially 1 YES share and 1 NO share per USDC
        newMarket.yesReserves = initialLiquidity;
        newMarket.noReserves = initialLiquidity;
        newMarket.totalLPSupply = initialLiquidity;
        
        // Mint LP tokens to creator
        lpBalances[marketId][msg.sender] = initialLiquidity;

        emit MarketCreated(
            marketId,
            msg.sender,
            question,
            category,
            endTime,
            initialLiquidity
        );

        return marketId;
    }

    /**
     * @notice Get current prices of YES and NO shares (6 decimals, representing USDC value per 1.00 share)
     */
    function getPrices(uint256 marketId) public view returns (uint256 yesPrice, uint256 noPrice) {
        Market storage market = markets[marketId];
        uint256 y = market.yesReserves;
        uint256 n = market.noReserves;
        if (y + n == 0) {
            return (0, 0);
        }
        // Price of YES = n / (y + n)
        // Price of NO = y / (y + n)
        // Scaling to 6 decimals (USDC standard)
        yesPrice = (n * 1e6) / (y + n);
        noPrice = (y * 1e6) / (y + n);
    }

    /**
     * @notice Calculate how many YES shares a user will receive for buying with a specific USDC amount
     */
    function getBuyYesQuote(uint256 marketId, uint256 usdcAmount) public view returns (uint256) {
        Market storage market = markets[marketId];
        uint256 y = market.yesReserves;
        uint256 n = market.noReserves;
        if (y == 0 || n == 0) return 0;
        
        // Product invariant: k = y * n
        uint256 k = y * n;
        
        // If we add usdcAmount NO shares to the pool
        uint256 newNoReserves = n + usdcAmount;
        uint256 newYesReserves = k / newNoReserves;
        
        // User gets: usdcAmount (from mint) + yesShares pulled from pool (y - newYesReserves)
        return usdcAmount + y - newYesReserves;
    }

    /**
     * @notice Calculate how many NO shares a user will receive for buying with a specific USDC amount
     */
    function getBuyNoQuote(uint256 marketId, uint256 usdcAmount) public view returns (uint256) {
        Market storage market = markets[marketId];
        uint256 y = market.yesReserves;
        uint256 n = market.noReserves;
        if (y == 0 || n == 0) return 0;
        
        uint256 k = y * n;
        uint256 newYesReserves = y + usdcAmount;
        uint256 newNoReserves = k / newYesReserves;
        
        return usdcAmount + n - newNoReserves;
    }

    /**
     * @notice Buy YES shares
     */
    function buyYes(uint256 marketId, uint256 usdcAmount) external {
        Market storage market = markets[marketId];
        require(!market.resolved, "Market already resolved");
        require(block.timestamp < market.endTime, "Market trading ended");
        require(usdcAmount > 0, "Amount must be greater than zero");

        // Calculate YES shares to issue
        uint256 sharesToMint = getBuyYesQuote(marketId, usdcAmount);
        require(sharesToMint > 0, "Insufficient liquidity to complete swap");

        // Transfer USDC to contract
        require(
            IERC20(usdcToken).transferFrom(msg.sender, address(this), usdcAmount),
            "USDC transfer failed"
        );

        // Update pool reserves
        uint256 k = market.yesReserves * market.noReserves;
        market.noReserves += usdcAmount;
        market.yesReserves = k / market.noReserves;

        // Credit user YES balances
        yesBalances[marketId][msg.sender] += sharesToMint;

        emit SharesBought(marketId, msg.sender, true, usdcAmount, sharesToMint);
    }

    /**
     * @notice Buy NO shares
     */
    function buyNo(uint256 marketId, uint256 usdcAmount) external {
        Market storage market = markets[marketId];
        require(!market.resolved, "Market already resolved");
        require(block.timestamp < market.endTime, "Market trading ended");
        require(usdcAmount > 0, "Amount must be greater than zero");

        uint256 sharesToMint = getBuyNoQuote(marketId, usdcAmount);
        require(sharesToMint > 0, "Insufficient liquidity to complete swap");

        require(
            IERC20(usdcToken).transferFrom(msg.sender, address(this), usdcAmount),
            "USDC transfer failed"
        );

        uint256 k = market.yesReserves * market.noReserves;
        market.yesReserves += usdcAmount;
        market.noReserves = k / market.yesReserves;

        noBalances[marketId][msg.sender] += sharesToMint;

        emit SharesBought(marketId, msg.sender, false, usdcAmount, sharesToMint);
    }

    /**
     * @notice Calculate USDC returned when selling a specific amount of YES shares
     * @dev Solves quadratic equation: dx^2 - (y + n + dy)dx + n * dy = 0
     */
    function getSellYesQuote(uint256 marketId, uint256 yesAmount) public view returns (uint256) {
        Market storage market = markets[marketId];
        uint256 y = market.yesReserves;
        uint256 n = market.noReserves;
        if (yesAmount == 0 || y == 0 || n == 0) return 0;

        uint256 term1 = y + n + yesAmount;
        uint256 term2 = term1 * term1;
        uint256 term3 = 4 * n * yesAmount;
        
        // Ensure square root doesn't error due to rounding
        if (term2 < term3) return 0;
        
        uint256 sqrtVal = sqrt(term2 - term3);
        uint256 usdcReturned = (term1 - sqrtVal) / 2;
        
        return usdcReturned;
    }

    /**
     * @notice Calculate USDC returned when selling a specific amount of NO shares
     * @dev Solves quadratic equation: dx^2 - (y + n + dn)dx + y * dn = 0
     */
    function getSellNoQuote(uint256 marketId, uint256 noAmount) public view returns (uint256) {
        Market storage market = markets[marketId];
        uint256 y = market.yesReserves;
        uint256 n = market.noReserves;
        if (noAmount == 0 || y == 0 || n == 0) return 0;

        uint256 term1 = y + n + noAmount;
        uint256 term2 = term1 * term1;
        uint256 term3 = 4 * y * noAmount;
        
        if (term2 < term3) return 0;
        
        uint256 sqrtVal = sqrt(term2 - term3);
        uint256 usdcReturned = (term1 - sqrtVal) / 2;
        
        return usdcReturned;
    }

    /**
     * @notice Sell YES shares back to the AMM pool for USDC
     */
    function sellYes(uint256 marketId, uint256 yesAmount) external {
        Market storage market = markets[marketId];
        require(!market.resolved, "Market already resolved");
        require(block.timestamp < market.endTime, "Market trading ended");
        require(yesBalances[marketId][msg.sender] >= yesAmount, "Insufficient YES balance");
        
        uint256 usdcReturned = getSellYesQuote(marketId, yesAmount);
        require(usdcReturned > 0, "Invalid sell quote");
        require(usdcReturned < market.noReserves, "Not enough pool liquidity");

        // Deduct user YES shares
        yesBalances[marketId][msg.sender] -= yesAmount;

        // Update pool reserves
        // Pool YES increases by (yesAmount - usdcReturned)
        // Pool NO decreases by usdcReturned
        market.yesReserves += (yesAmount - usdcReturned);
        market.noReserves -= usdcReturned;

        // Transfer USDC to user
        require(
            IERC20(usdcToken).transfer(msg.sender, usdcReturned),
            "USDC payout failed"
        );

        emit SharesSold(marketId, msg.sender, true, yesAmount, usdcReturned);
    }

    /**
     * @notice Sell NO shares back to the AMM pool for USDC
     */
    function sellNo(uint256 marketId, uint256 noAmount) external {
        Market storage market = markets[marketId];
        require(!market.resolved, "Market already resolved");
        require(block.timestamp < market.endTime, "Market trading ended");
        require(noBalances[marketId][msg.sender] >= noAmount, "Insufficient NO balance");

        uint256 usdcReturned = getSellNoQuote(marketId, noAmount);
        require(usdcReturned > 0, "Invalid sell quote");
        require(usdcReturned < market.yesReserves, "Not enough pool liquidity");

        noBalances[marketId][msg.sender] -= noAmount;

        market.noReserves += (noAmount - usdcReturned);
        market.yesReserves -= usdcReturned;

        require(
            IERC20(usdcToken).transfer(msg.sender, usdcReturned),
            "USDC payout failed"
        );

        emit SharesSold(marketId, msg.sender, false, noAmount, usdcReturned);
    }

    /**
     * @notice Withdraw LP shares before resolution
     * @dev Returns user's share of YES and NO reserves in the AMM pool
     */
    function withdrawLiquidity(uint256 marketId, uint256 lpAmount) external {
        Market storage market = markets[marketId];
        require(!market.resolved, "Market already resolved");
        require(lpBalances[marketId][msg.sender] >= lpAmount, "Insufficient LP balance");
        require(market.totalLPSupply > 0, "No LP supply");

        uint256 yesToWithdraw = (lpAmount * market.yesReserves) / market.totalLPSupply;
        uint256 noToWithdraw = (lpAmount * market.noReserves) / market.totalLPSupply;

        // Deduct LP tokens
        lpBalances[marketId][msg.sender] -= lpAmount;
        market.totalLPSupply -= lpAmount;

        // Deduct from pool reserves
        market.yesReserves -= yesToWithdraw;
        market.noReserves -= noToWithdraw;

        // Add YES and NO shares to user's user-level wallet mapping
        yesBalances[marketId][msg.sender] += yesToWithdraw;
        noBalances[marketId][msg.sender] += noToWithdraw;

        emit LiquidityWithdrawn(marketId, msg.sender, lpAmount, yesToWithdraw, noToWithdraw);
    }

    /**
     * @notice Resolve a market's outcome (Only creator/oracle can resolve)
     * @param outcome 1 for YES, 2 for NO, 3 for INVALID
     */
    function resolveMarket(uint256 marketId, uint8 outcome) external {
        Market storage market = markets[marketId];
        require(!market.resolved, "Market already resolved");
        require(msg.sender == market.creator, "Only creator can resolve");
        require(outcome == 1 || outcome == 2 || outcome == 3, "Invalid outcome");
        // We allow early resolution if creator decides outcome is final, or after endTime.

        market.resolved = true;
        market.outcome = outcome;

        emit MarketResolved(marketId, outcome);
    }

    /**
     * @notice Claim winnings after market resolution
     * @dev Redemptions payout 1:1 for winning shares, and proportional for LPs.
     */
    function redeemWinnings(uint256 marketId) external {
        Market storage market = markets[marketId];
        require(market.resolved, "Market not resolved yet");
        require(!hasRedeemed[marketId][msg.sender], "Winnings already redeemed");

        uint256 usdcPayout = 0;
        uint8 outcome = market.outcome;

        if (outcome == 1) {
            // YES won: user gets 1 USDC per YES share, 0 for NO
            uint256 yesAmount = yesBalances[marketId][msg.sender];
            usdcPayout += yesAmount;
            yesBalances[marketId][msg.sender] = 0;
            noBalances[marketId][msg.sender] = 0; // Clear losing shares

            // LP holders get their share of the pool's YES shares (each worth 1 USDC)
            uint256 lpAmount = lpBalances[marketId][msg.sender];
            if (lpAmount > 0 && market.totalLPSupply > 0) {
                usdcPayout += (lpAmount * market.yesReserves) / market.totalLPSupply;
                lpBalances[marketId][msg.sender] = 0;
            }
        } 
        else if (outcome == 2) {
            // NO won: user gets 1 USDC per NO share, 0 for YES
            uint256 noAmount = noBalances[marketId][msg.sender];
            usdcPayout += noAmount;
            yesBalances[marketId][msg.sender] = 0; // Clear losing shares
            noBalances[marketId][msg.sender] = 0;

            // LP holders get their share of the pool's NO shares (each worth 1 USDC)
            uint256 lpAmount = lpBalances[marketId][msg.sender];
            if (lpAmount > 0 && market.totalLPSupply > 0) {
                usdcPayout += (lpAmount * market.noReserves) / market.totalLPSupply;
                lpBalances[marketId][msg.sender] = 0;
            }
        } 
        else if (outcome == 3) {
            // INVALID: both YES and NO shares are worth 0.5 USDC
            uint256 yesAmount = yesBalances[marketId][msg.sender];
            uint256 noAmount = noBalances[marketId][msg.sender];
            
            usdcPayout += (yesAmount + noAmount) / 2;
            yesBalances[marketId][msg.sender] = 0;
            noBalances[marketId][msg.sender] = 0;

            // LP holders get their share of the pool's total USDC value divided by 2
            uint256 lpAmount = lpBalances[marketId][msg.sender];
            if (lpAmount > 0 && market.totalLPSupply > 0) {
                uint256 totalPoolShares = market.yesReserves + market.noReserves;
                usdcPayout += (lpAmount * totalPoolShares) / (2 * market.totalLPSupply);
                lpBalances[marketId][msg.sender] = 0;
            }
        }

        require(usdcPayout > 0, "No winnings or LP reserves to redeem");
        hasRedeemed[marketId][msg.sender] = true;

        // Transfer USDC to user
        require(
            IERC20(usdcToken).transfer(msg.sender, usdcPayout),
            "USDC payout failed"
        );

        emit Redeemed(marketId, msg.sender, usdcPayout);
    }
}
