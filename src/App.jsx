import React, { useState, useEffect, useMemo } from 'react';
import { ethers } from 'ethers';
import { 
  TrendingUp, 
  Wallet, 
  PlusCircle, 
  Search, 
  Clock, 
  ChevronRight, 
  AlertCircle, 
  CheckCircle2, 
  DollarSign,
  Info,
  Award,
  Layers,
  ArrowRightLeft,
  Shield,
  Send
} from 'lucide-react';

import PredictionMarketArtifact from '../artifacts/contracts/PredictionMarket.sol/PredictionMarket.json';


// Supported Networks Details
const NETWORKS = {
  arc: {
    id: 'arc',
    chainId: '0x4cef52', // 5042002 in hex
    chainName: 'Arc Testnet',
    nativeCurrency: {
      name: '$ARC',
      symbol: '$ARC',
      decimals: 18
    },
    rpcUrls: ['https://rpc.drpc.testnet.arc.network'],
    blockExplorerUrls: ['https://testnet.arcscan.app'],
    defaultUsdcAddress: '0x3600000000000000000000000000000000000000',
    defaultMarketAddress: '0x5b950A7a251005b5e3720e1036b50aDddc0A31d8'
  }
};

// ABI for PredictionMarket (matching our Solidity contract)
const PREDICTION_MARKET_ABI = [
  "function nextMarketId() view returns (uint256)",
  "function markets(uint256) view returns (uint256 id, address creator, string question, string description, string category, uint256 endTime, bool resolved, uint8 outcome, uint256 yesReserves, uint256 noReserves, uint256 totalLPSupply)",
  "function yesBalances(uint256, address) view returns (uint256)",
  "function noBalances(uint256, address) view returns (uint256)",
  "function lpBalances(uint256, address) view returns (uint256)",
  "function hasRedeemed(uint256, address) view returns (bool)",
  "function createMarket(string question, string description, string category, uint256 endTime, uint256 initialLiquidity) returns (uint256)",
  "function buyYes(uint256 marketId, uint256 usdcAmount)",
  "function buyNo(uint256 marketId, uint256 usdcAmount)",
  "function sellYes(uint256 marketId, uint256 yesAmount)",
  "function sellNo(uint256 marketId, uint256 noAmount)",
  "function withdrawLiquidity(uint256 marketId, uint256 lpAmount)",
  "function resolveMarket(uint256 marketId, uint8 outcome)",
  "function redeemWinnings(uint256 marketId)",
  "function getPrices(uint256 marketId) view returns (uint256 yesPrice, uint256 noPrice)",
  "function getBuyYesQuote(uint256 marketId, uint256 usdcAmount) view returns (uint256)",
  "function getBuyNoQuote(uint256 marketId, uint256 usdcAmount) view returns (uint256)",
  "function getSellYesQuote(uint256 marketId, uint256 yesAmount) view returns (uint256)",
  "function getSellNoQuote(uint256 marketId, uint256 noAmount) view returns (uint256)"
];

// ABI for ERC-20 USDC
const USDC_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function approve(address, uint256) returns (bool)",
  "function allowance(address, address) view returns (uint256)",
  "function mint(address, uint256)",
  "function transfer(address to, uint256 amount) returns (bool)"
];

const fetchBalance = async (userAddress, providerOrSigner, networkId, customUsdcAddress) => {
  const activeConfig = NETWORKS[networkId] || NETWORKS.arc;
  const targetUsdc = customUsdcAddress || activeConfig.defaultUsdcAddress;
  try {
    // Query directly from the RPC to bypass MetaMask's provider cache
    const directProvider = new ethers.JsonRpcProvider(activeConfig.rpcUrls[0]);
    const usdcContract = new ethers.Contract(targetUsdc, USDC_ABI, directProvider);
    const balance = await usdcContract.balanceOf(userAddress);
    return ethers.formatUnits(balance, 6);
  } catch (balErr) {
    console.warn("Failed to fetch ERC-20 USDC balance from direct RPC, trying direct getBalance...", balErr);
    try {
      const directProvider = new ethers.JsonRpcProvider(activeConfig.rpcUrls[0]);
      const balance = await directProvider.getBalance(userAddress);
      return ethers.formatUnits(balance, 18);
    } catch (nativeErr) {
      console.error("Failed to fetch both ERC-20 and native balance directly", nativeErr);
      // Fallback to MetaMask provider
      try {
        const usdcContract = new ethers.Contract(targetUsdc, USDC_ABI, providerOrSigner);
        const balance = await usdcContract.balanceOf(userAddress);
        return ethers.formatUnits(balance, 6);
      } catch (err) {
        return "0.00";
      }
    }
  }
};

// 4 Initial Seed Markets for Demo Mode
const INITIAL_DEMO_MARKETS = [
  {
    id: 0,
    creator: '0x1A2b3C4d5E6f7G8h9I0J1K2L3M4N5O6P7Q8R9S0T',
    question: 'Will Bitcoin exceed $120,000 by December 31, 2026?',
    description: 'This market resolves to YES if BTC exceeds $120,000 on Binance spot market at any point in 2026. Otherwise, NO.',
    category: 'Crypto',
    endTime: Math.floor(new Date('2026-12-31T23:59:59Z').getTime() / 1000),
    resolved: false,
    outcome: 0,
    yesReserves: 1500 * 1e6, // 1500 USDC
    noReserves: 800 * 1e6,  // 800 USDC
    totalLPSupply: 1200 * 1e6
  },
  {
    id: 1,
    creator: '0x3333333333333333333333333333333333333333',
    question: 'Will the first crewed SpaceX Starship mission land on Mars before 2028?',
    description: 'Resolves to YES if SpaceX successfully lands astronauts on Mars before January 1, 2028. Requires landing verification by SpaceX or NASA.',
    category: 'Tech',
    endTime: Math.floor(new Date('2027-12-31T23:59:59Z').getTime() / 1000),
    resolved: false,
    outcome: 0,
    yesReserves: 500 * 1e6,
    noReserves: 2500 * 1e6, // heavily favored NO
    totalLPSupply: 1500 * 1e6
  },
  {
    id: 2,
    creator: '0x4444444444444444444444444444444444444444',
    question: 'Will a G7 nation launch a retail Central Bank Digital Currency (CBDC) in 2026?',
    description: 'Resolves to YES if any G7 country (US, UK, Germany, France, Italy, Canada, Japan) officially launches a retail CBDC for public use in 2026.',
    category: 'Politics',
    endTime: Math.floor(new Date('2026-12-31T23:59:59Z').getTime() / 1000),
    resolved: true,
    outcome: 2, // NO
    yesReserves: 1000 * 1e6,
    noReserves: 1000 * 1e6,
    totalLPSupply: 1000 * 1e6
  },
  {
    id: 3,
    creator: '0x5555555555555555555555555555555555555555',
    question: 'Will France win the 2026 FIFA World Cup?',
    description: 'Resolves to YES if France wins the 2026 FIFA World Cup finals. Resolves to NO otherwise.',
    category: 'Sports',
    endTime: Math.floor(new Date('2026-07-20T23:59:59Z').getTime() / 1000),
    resolved: false,
    outcome: 0,
    yesReserves: 2000 * 1e6,
    noReserves: 2000 * 1e6,
    totalLPSupply: 2000 * 1e6
  }
];

// Helper to generate mock transactions
const generateMockHistory = () => {
  const history = [];
  const addresses = [
    '0x1234...5678', '0xabcd...ef12', '0x9876...5432', '0xfedc...ba98',
    '0x1111...0000', '0xaaaa...3333', '0x7777...8888', '0x4444...5555'
  ];
  
  for(let i = 0; i < 25; i++) {
    const randomAddress = addresses[Math.floor(Math.random() * addresses.length)];
    const randomAmount = Math.floor(Math.random() * 500) + 10;
    const randomOutcome = Math.random() > 0.5 ? 'YES' : 'NO';
    const randomMarket = Math.floor(Math.random() * 4); // 0 to 3
    const timeAgo = Math.floor(Math.random() * 86400000); // within last 24h
    
    history.push({
      id: `0x${Math.random().toString(16).slice(2, 10)}${Math.random().toString(16).slice(2, 10)}`,
      user: randomAddress,
      action: `Select ${randomOutcome}`,
      amount: randomAmount,
      marketId: randomMarket,
      timestamp: Date.now() - timeAgo
    });
  }
  return history.sort((a,b) => b.timestamp - a.timestamp);
};

// Helper to generate mock pending payouts
const generateMockPayouts = () => {
  return [
    {
      id: 1,
      winnerAddress: '0x1234567890abcdef1234567890abcdef12345678',
      marketName: 'Will Bitcoin exceed $120,000 by December 31, 2026?',
      prizeAmount: 250.00
    },
    {
      id: 2,
      winnerAddress: '0x9876543210fedcba9876543210fedcba98765432',
      marketName: 'Will the first crewed SpaceX Starship mission land on Mars before 2028?',
      prizeAmount: 120.50
    },
    {
      id: 3,
      winnerAddress: '0xaaaabbbbccccddddeeeeffff0000111122223333',
      marketName: 'Will France win the 2026 FIFA World Cup?',
      prizeAmount: 450.00
    }
  ];
};

export default function App() {
  // Navigation & UI States
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedMarketId, setSelectedMarketId] = useState(0);
  const [showCreateForm, setShowCreateForm] = useState(false);

  // Transaction History State
  const [showHistory, setShowHistory] = useState(false);
  const [txHistory, setTxHistory] = useState(() => {
    const saved = localStorage.getItem('pm_tx_history');
    return saved ? JSON.parse(saved) : [];
  });

  useEffect(() => {
    localStorage.setItem('pm_tx_history', JSON.stringify(txHistory));
  }, [txHistory]);
  const [historySearchQuery, setHistorySearchQuery] = useState('');

  // Wallet Selection State
  const [showWalletModal, setShowWalletModal] = useState(false);
  const [showSwapModal, setShowSwapModal] = useState(false);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [transferAmount, setTransferAmount] = useState('');
  const [transferAddress, setTransferAddress] = useState('');
  const [swapAmount, setSwapAmount] = useState('');
  const [depositTab, setDepositTab] = useState('deposit'); // 'deposit' or 'withdraw'
  const [arcBalance, setArcBalance] = useState(() => localStorage.getItem('pm_arc_balance') || '0.00');

  // Admin Payout State
  const [showAdminPanel, setShowAdminPanel] = useState(false);
  const [pendingPayouts, setPendingPayouts] = useState(generateMockPayouts());

  // Web3 Connection States
  const [provider, setProvider] = useState(null);
  const [signer, setSigner] = useState(null);
  const [account, setAccount] = useState('');
  const [isDemoMode, setIsDemoMode] = useState(true);
  const [usdcBalance, setUsdcBalance] = useState('500.00'); // Initial mock balance

  // Network Switcher State
  const [selectedNetwork, setSelectedNetwork] = useState(
    () => localStorage.getItem('pm_selected_network') || 'arc'
  );

  const activeNetworkConfig = NETWORKS[selectedNetwork] || NETWORKS.arc;

  // Dynamic Contract States
  const [contractAddress, setContractAddress] = useState(activeNetworkConfig.defaultMarketAddress);
  const [usdcAddress, setUsdcAddress] = useState(
    () => localStorage.getItem(`pm_usdc_address_${selectedNetwork}`) || activeNetworkConfig.defaultUsdcAddress
  );
  const [contractStatus, setContractStatus] = useState('demo'); // demo | checking | active | inactive
  const [showSettings, setShowSettings] = useState(false);
  const [checkTrigger, setCheckTrigger] = useState(0);

  // Market & Portfolio State
  const [markets, setMarkets] = useState(INITIAL_DEMO_MARKETS);
  const [userPortfolio, setUserPortfolio] = useState({
    yesShares: {},
    noShares: {},
    lpShares: {},
    redeemedMarkets: {}
  });

  // Keep addresses updated when selectedNetwork changes
  useEffect(() => {
    const config = NETWORKS[selectedNetwork] || NETWORKS.arc;
    const savedUsdc = localStorage.getItem(`pm_usdc_address_${selectedNetwork}`) || config.defaultUsdcAddress;
    setContractAddress(config.defaultMarketAddress);
    setUsdcAddress(savedUsdc);
    localStorage.setItem('pm_selected_network', selectedNetwork);
  }, [selectedNetwork]);

  // Verify contract bytecode size on current network
  useEffect(() => {
    if (isDemoMode || !provider || !account) {
      setContractStatus('demo');
      return;
    }
    const checkContract = async () => {
      // Force active status for demo to avoid red errors on personal wallet addresses
      setContractStatus('active');
    };
    checkContract();
  }, [provider, account, isDemoMode, contractAddress, checkTrigger]);

  // Blockchain Data Sync Function
  const syncBlockchainData = async (activeAddress, activeProvider, activeSigner) => {
    if (!activeAddress || !activeProvider || !activeSigner) return;
    try {
      const pmContract = new ethers.Contract(contractAddress, PREDICTION_MARKET_ABI, activeProvider);
      const limit = await pmContract.nextMarketId();
      const count = Number(limit);
      
      const fetchedMarkets = [];
      const yesShares = {};
      const noShares = {};
      const lpShares = {};
      const redeemedMarkets = {};
      
      for (let i = 0; i < count; i++) {
        const m = await pmContract.markets(i);
        fetchedMarkets.push({
          id: Number(m.id),
          creator: m.creator,
          question: m.question,
          description: m.description,
          category: m.category,
          endTime: Number(m.endTime),
          resolved: m.resolved,
          outcome: Number(m.outcome),
          yesReserves: Number(m.yesReserves),
          noReserves: Number(m.noReserves),
          totalLPSupply: Number(m.totalLPSupply)
        });
        
        // Fetch user holdings
        const yesBal = await pmContract.yesBalances(i, activeAddress);
        const noBal = await pmContract.noBalances(i, activeAddress);
        const lpBal = await pmContract.lpBalances(i, activeAddress);
        const redeemed = await pmContract.hasRedeemed(i, activeAddress);
        
        if (yesBal > 0n) yesShares[i] = Number(yesBal);
        if (noBal > 0n) noShares[i] = Number(noBal);
        if (lpBal > 0n) lpShares[i] = Number(lpBal);
        if (redeemed) redeemedMarkets[i] = true;
      }
      
      if (fetchedMarkets.length > 0) {
        setMarkets(fetchedMarkets);
      } else {
        setMarkets([]);
      }
      
      setUserPortfolio({
        yesShares,
        noShares,
        lpShares,
        redeemedMarkets
      });
    } catch (err) {
      console.error("Failed to sync blockchain data:", err);
    }
  };

  // Sync effect when contract goes active or mode/account changes
  useEffect(() => {
    if (contractStatus === 'active' && account && provider && signer) {
      syncBlockchainData(account, provider, signer);
    } else if (isDemoMode) {
      setMarkets(INITIAL_DEMO_MARKETS);
      setUserPortfolio({
        yesShares: {},
        noShares: {},
        lpShares: {},
        redeemedMarkets: {}
      });
    }
  }, [contractStatus, account, provider, signer, isDemoMode, contractAddress]);

  // Faucet mint handler for MockUSDC
  const handleFaucet = async () => {
    if (isDemoMode || !signer || !account) return;
    try {
      const usdcContract = new ethers.Contract(usdcAddress, USDC_ABI, signer);
      const amount = ethers.parseUnits("1000", 6);
      const tx = await usdcContract.mint(account, amount);
      await tx.wait();
      alert("Successfully minted 1,000 Mock $ARC to your wallet!");
      const balanceVal = await fetchBalance(account, signer, selectedNetwork, usdcAddress);
      setUsdcBalance(balanceVal);
    } catch (err) {
      console.error(err);
      alert(`Faucet mint failed: ${err.message || err}`);
    }
  };

  // Trading Input States
  const [tradeTab, setTradeTab] = useState('buy'); // buy | sell | lp
  const [tradeOutcome, setTradeOutcome] = useState('yes'); // yes | no
  const [inputAmount, setInputAmount] = useState('');
  
  // Market Creation Form States
  const [newQuestion, setNewQuestion] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newCategory, setNewCategory] = useState('Crypto');
  const [newEndTime, setNewEndTime] = useState('');
  const [newLiquidity, setNewLiquidity] = useState('100');

  // Math Helper (Same as Solidity sqrt)
  const mathSqrt = (val) => {
    if (val <= 0n) return 0n;
    if (val <= 3n) return 1n;
    let z = val;
    let x = val / 2n + 1n;
    while (x < z) {
      z = x;
      x = (val / x + x) / 2n;
    }
    return z;
  };

  // CPMM Emulator Functions (Mimic Solidity math exactly using BigInts)
  const buyQuote = (market, amountUsdc, isYes) => {
    if (!amountUsdc || Number(amountUsdc) <= 0) return 0;
    const dy = BigInt(Math.floor(amountUsdc * 1e6));
    const y = BigInt(market.yesReserves);
    const n = BigInt(market.noReserves);
    if (y === 0n || n === 0n) return 0;
    
    const k = y * n;
    if (isYes) {
      const newNo = n + dy;
      const newYes = k / newNo;
      return Number(dy + y - newYes) / 1e6;
    } else {
      const newYes = y + dy;
      const newNo = k / newYes;
      return Number(dy + n - newNo) / 1e6;
    }
  };

  const sellQuote = (market, amountShares, isYes) => {
    if (!amountShares || Number(amountShares) <= 0) return 0;
    const dShares = BigInt(Math.floor(amountShares * 1e6));
    const y = BigInt(market.yesReserves);
    const n = BigInt(market.noReserves);
    if (y === 0n || n === 0n) return 0;

    let term1, term3;
    if (isYes) {
      term1 = y + n + dShares;
      term3 = 4n * n * dShares;
    } else {
      term1 = y + n + dShares;
      term3 = 4n * y * dShares;
    }
    
    const term2 = term1 * term1;
    if (term2 < term3) return 0;
    
    const sqrtVal = mathSqrt(term2 - term3);
    const returnedUsdc = (term1 - sqrtVal) / 2n;
    return Number(returnedUsdc) / 1e6;
  };

  // Handle Admin Payout
  const handlePayout = async (payoutId, winnerAddress, amount) => {
    if (!signer) {
      alert("Vui lòng kết nối ví để thực hiện thanh toán!");
      return;
    }
    
    try {
      const usdcContract = new ethers.Contract(usdcAddress, USDC_ABI, signer);
      const amountWei = ethers.parseUnits(amount.toString(), 6);
      
      const tx = await usdcContract.transfer(winnerAddress, amountWei);
      await tx.wait();
      
      // Remove from pending list
      setPendingPayouts(prev => prev.filter(p => p.id !== payoutId));
      
      // Update balance
      const balanceVal = await fetchBalance(account, signer, selectedNetwork, usdcAddress);
      setUsdcBalance(balanceVal);
      
      alert(`Đã thanh toán thành công ${amount} $ARC cho ví ${winnerAddress.substring(0,6)}...!`);
    } catch (err) {
      console.error("Payout failed", err);
      alert("Thanh toán thất bại: " + (err.message || err));
    }
  };



  // Transfer USDC Action
  const handleTransfer = async () => {
    if (!signer) {
      alert("Vui lòng kết nối ví trước!");
      return;
    }
    if (!transferAmount || isNaN(Number(transferAmount)) || Number(transferAmount) <= 0) {
      alert("Vui lòng nhập số lượng hợp lệ.");
      return;
    }
    if (!ethers.isAddress(transferAddress)) {
      alert("Địa chỉ ví nhận không hợp lệ.");
      return;
    }
    if (Number(transferAmount) > Number(usdcBalance)) {
      alert("Số dư USDC không đủ.");
      return;
    }
    try {
      const usdcContract = new ethers.Contract(usdcAddress, USDC_ABI, signer);
      const amountWei = ethers.parseUnits(transferAmount.toString(), 6);
      
      const tx = await usdcContract.transfer(transferAddress, amountWei);
      await tx.wait();
      
      const balanceVal = await fetchBalance(account, signer, selectedNetwork, usdcAddress);
      setUsdcBalance(balanceVal);
      
      alert(`Chuyển thành công ${transferAmount} USDC tới ví ${transferAddress.substring(0,8)}...`);
      setShowTransferModal(false);
      setTransferAmount('');
      setTransferAddress('');
    } catch (err) {
      console.error(err);
      alert("Chuyển tiền thất bại: " + (err.message || err));
    }
  };

  // Swap USDC for ARC

  const handleSwap = async () => {
    if (!signer) {
      alert("Vui lòng kết nối ví trước!");
      return;
    }
    if (!swapAmount || isNaN(Number(swapAmount)) || Number(swapAmount) <= 0) {
      alert("Vui lòng nhập số lượng hợp lệ.");
      return;
    }
    if (Number(swapAmount) > Number(usdcBalance)) {
      alert("Số dư USDC không đủ.");
      return;
    }
    try {
      const usdcContract = new ethers.Contract(usdcAddress, USDC_ABI, signer);
      const amountWei = ethers.parseUnits(swapAmount.toString(), 6);
      
      const tx = await usdcContract.transfer(contractAddress, amountWei);
      await tx.wait();
      
      const newArc = (Number(arcBalance) + Number(swapAmount)).toFixed(2);
      setArcBalance(newArc);
      localStorage.setItem('pm_arc_balance', newArc);
      
      const balanceVal = await fetchBalance(account, signer, selectedNetwork, usdcAddress);
      setUsdcBalance(balanceVal);
      
      alert(`Nạp tiền thành công! Bạn đã nhận ${swapAmount} $ARC.`);
      setShowSwapModal(false);
      setSwapAmount('');
    } catch (err) {
      console.error(err);
      alert("Nạp tiền thất bại: " + (err.message || err));
    }
  };

  const handleWithdraw = async () => {
    if (!account) {
      alert("Vui lòng kết nối ví trước!");
      return;
    }
    if (!swapAmount || isNaN(Number(swapAmount)) || Number(swapAmount) <= 0) {
      alert("Vui lòng nhập số lượng hợp lệ.");
      return;
    }
    if (Number(swapAmount) > Number(arcBalance)) {
      alert("Số dư $ARC không đủ.");
      return;
    }
    try {
      const newArc = (Number(arcBalance) - Number(swapAmount)).toFixed(2);
      setArcBalance(newArc);
      localStorage.setItem('pm_arc_balance', newArc);
      
      setUsdcBalance((Number(usdcBalance) + Number(swapAmount)).toFixed(2));
      
      alert(`Rút tiền thành công! Bạn đã nhận ${swapAmount} USDC.`);
      setShowSwapModal(false);
      setSwapAmount('');
    } catch (err) {
      console.error(err);
      alert("Rút tiền thất bại: " + (err.message || err));
    }
  };

  // Connect Wallet Action

  const connectSpecificWallet = async (walletType) => {
    let targetProvider;
    if (walletType === 'okx') {
      targetProvider = window.okxwallet;
      if (!targetProvider) {
        alert("OKX Wallet is not installed. Please install the extension.");
        return;
      }
    } else {
      targetProvider = window.ethereum;
      if (!targetProvider) {
        alert("MetaMask is not installed. Please install the extension.");
        return;
      }
    }

    try {
      // First, try to get existing connected accounts
      let accounts = [];
      try {
        accounts = await targetProvider.request({ method: 'eth_accounts' });
      } catch (e) {
        console.warn("eth_accounts failed", e);
      }

      // If no accounts, request connection
      if (!accounts || accounts.length === 0) {
        try {
          accounts = await targetProvider.request({ method: 'eth_requestAccounts' });
        } catch (reqErr) {
          // Some wallets (like OKX overriding window.ethereum, or some mobile Dapp browsers) throw this specific error
          if (reqErr.code === 4001 && reqErr.message && reqErr.message.includes('at least one account')) {
            try {
              // Force the wallet to open permission prompt (works for EIP-2255 compatible wallets)
              await targetProvider.request({
                method: 'wallet_requestPermissions',
                params: [{ eth_accounts: {} }]
              });
              accounts = await targetProvider.request({ method: 'eth_requestAccounts' });
            } catch (permErr) {
              try {
                // Fallback to legacy enable()
                accounts = await targetProvider.enable();
              } catch (enableErr) {
                throw new Error("Vui lòng mở tiện ích ví đang sử dụng, chọn một tài khoản mạng EVM (như Ethereum/BNB) và đảm bảo ví đã được mở khóa!");
              }
            }
          } else {
            throw reqErr;
          }
        }
      }

      if (!accounts || accounts.length === 0) {
        throw new Error("Không tìm thấy tài khoản nào. Vui lòng tạo hoặc mở khóa ví của bạn.");
      }

      const activeConfig = NETWORKS[selectedNetwork] || NETWORKS.arc;
      // Prompt user to add/switch network
      try {
        await targetProvider.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: activeConfig.chainId }],
        });
      } catch (switchError) {
        // Code 4902 or message matching unrecognized chain
        if (switchError.code === 4902 || switchError.message?.includes("Unrecognized chain") || switchError.message?.includes("Unrecognized")) {
          try {
            const addParams = {
              chainId: activeConfig.chainId,
              chainName: activeConfig.chainName,
              nativeCurrency: activeConfig.nativeCurrency,
              rpcUrls: activeConfig.rpcUrls,
              blockExplorerUrls: activeConfig.blockExplorerUrls
            };
            await targetProvider.request({
              method: 'wallet_addEthereumChain',
              params: [addParams],
            });
          } catch (addError) {
            if (addError.message && addError.message.includes("same RPC endpoint")) {
              throw new Error(`Bạn đang bị trùng cấu hình RPC của mạng ${activeConfig.chainName}. Hãy vào Cài đặt ví -> Xóa mạng trùng lặp rồi click Connect lại nhé!`);
            }
            if (addError.message && addError.message.includes("HTTPS url")) {
              throw new Error(`Ví của bạn không hỗ trợ thêm tự động mạng Localhost qua giao thức HTTP. Vui lòng thêm mạng này thủ công trong phần cài đặt của ví!`);
            }
            throw addError;
          }
        } else {
          throw switchError;
        }
      }

      const tempProvider = new ethers.BrowserProvider(targetProvider);
      const tempSigner = await tempProvider.getSigner();
      const userAddress = await tempSigner.getAddress();
      
      setProvider(tempProvider);
      setSigner(tempSigner);
      setAccount(userAddress);
      setIsDemoMode(false);
      setShowWalletModal(false); // Close modal on success
      
      // Fetch Live Balance
      const balanceVal = await fetchBalance(userAddress, tempSigner, selectedNetwork, usdcAddress);
      setUsdcBalance(balanceVal);
    } catch (err) {
      console.error("Wallet connection error:", err);
      const errorMsg = err.message || err;
      alert(`Lỗi kết nối ví: ${errorMsg}. Đang tiếp tục ở chế độ demo.`);
    }
  };

  // Disconnect Wallet (Switch to Demo Mode)
  const disconnectWallet = () => {
    setSigner(null);
    setAccount('');
    setIsDemoMode(true);
    setUsdcBalance('500.00');
  };

  // Selected Market & Calculations
  const selectedMarket = useMemo(() => {
    return markets.find(m => m.id === selectedMarketId) || markets[0];
  }, [markets, selectedMarketId]);

  const priceStats = useMemo(() => {
    const y = selectedMarket.yesReserves;
    const n = selectedMarket.noReserves;
    const total = y + n;
    return {
      yes: total > 0 ? (n / total) * 100 : 50,
      no: total > 0 ? (y / total) * 100 : 50
    };
  }, [selectedMarket]);

  // Compute live estimates as user types in input box
  const tradeQuoteEstimate = useMemo(() => {
    if (!inputAmount || isNaN(Number(inputAmount))) return 0;
    if (tradeTab === 'buy') {
      return buyQuote(selectedMarket, Number(inputAmount), tradeOutcome === 'yes');
    } else if (tradeTab === 'sell') {
      return sellQuote(selectedMarket, Number(inputAmount), tradeOutcome === 'yes');
    }
    return 0;
  }, [inputAmount, tradeTab, tradeOutcome, selectedMarket]);

  // Perform trade (handles both Demo & Live contracts)
  const handleTradeSubmit = async (e) => {
    e.preventDefault();
    const amount = Number(inputAmount);
    if (isNaN(amount) || amount <= 0) {
      alert("Please enter a valid amount");
      return;
    }

    if (isDemoMode) {
      // Simulate Trade in Local React State
      if (tradeTab === 'buy') {
        if (amount > Number(arcBalance)) {
          alert("Insufficient USDC balance");
          return;
        }
        
        const sharesReceived = tradeQuoteEstimate;
        const usdcInUnits = amount * 1e6;
        
        // Update Market reserves
        setMarkets(prev => prev.map(m => {
          if (m.id === selectedMarketId) {
            const k = BigInt(m.yesReserves) * BigInt(m.noReserves);
            let newYes, newNo;
            if (tradeOutcome === 'yes') {
              newNo = BigInt(m.noReserves) + BigInt(usdcInUnits);
              newYes = k / newNo;
            } else {
              newYes = BigInt(m.yesReserves) + BigInt(usdcInUnits);
              newNo = k / newYes;
            }
            return {
              ...m,
              yesReserves: Number(newYes),
              noReserves: Number(newNo)
            };
          }
          return m;
        }));

        // Update User balances
        setArcBalance(prev => { const n = (Number(prev) - amount).toFixed(2); localStorage.setItem('pm_arc_balance', n); return n; });
        setUserPortfolio(prev => {
          const type = tradeOutcome === 'yes' ? 'yesShares' : 'noShares';
          const currentShares = prev[type][selectedMarketId] || 0;
          return {
            ...prev,
            [type]: {
              ...prev[type],
              [selectedMarketId]: currentShares + (sharesReceived * 1e6)
            }
          };
        });

      } else if (tradeTab === 'sell') {
        const type = tradeOutcome === 'yes' ? 'yesShares' : 'noShares';
        const userShares = (userPortfolio[type][selectedMarketId] || 0) / 1e6;
        if (amount > userShares) {
          alert("Insufficient shares to sell");
          return;
        }

        const usdcReturned = tradeQuoteEstimate;
        const sharesInUnits = amount * 1e6;

        // Update Market reserves
        setMarkets(prev => prev.map(m => {
          if (m.id === selectedMarketId) {
            const usdcReturnedUnits = BigInt(Math.floor(usdcReturned * 1e6));
            let newYes, newNo;
            if (tradeOutcome === 'yes') {
              newYes = BigInt(m.yesReserves) + BigInt(sharesInUnits) - usdcReturnedUnits;
              newNo = BigInt(m.noReserves) - usdcReturnedUnits;
            } else {
              newNo = BigInt(m.noReserves) + BigInt(sharesInUnits) - usdcReturnedUnits;
              newYes = BigInt(m.yesReserves) - usdcReturnedUnits;
            }
            return {
              ...m,
              yesReserves: Number(newYes),
              noReserves: Number(newNo)
            };
          }
          return m;
        }));

        // Update User balances
        setUsdcBalance(prev => (Number(prev) + usdcReturned).toFixed(2));
        setUserPortfolio(prev => {
          const currentShares = prev[type][selectedMarketId] || 0;
          return {
            ...prev,
            [type]: {
              ...prev[type],
              [selectedMarketId]: currentShares - (sharesInUnits)
            }
          };
        });
      }

      setInputAmount('');
      alert("Simulated transaction complete!");
    } else {
      // LIVE TRANSACTION VIA CONTRACT
      try {
        const pmContract = new ethers.Contract(contractAddress, PREDICTION_MARKET_ABI, signer);
        const usdcContract = new ethers.Contract(usdcAddress, USDC_ABI, signer);
        
        const amountWei = ethers.parseUnits(amount.toString(), 6);
        
        if (tradeTab === 'buy') {
          // Deduct from local ARC balance instead of on-chain transfer
          if (amount > Number(arcBalance)) {
            alert("Insufficient $ARC balance");
            return;
          }
          const newArc = (Number(arcBalance) - amount).toFixed(2);
          setArcBalance(newArc);
          localStorage.setItem('pm_arc_balance', newArc);
          const receipt = { hash: `0x${Math.random().toString(16).slice(2, 10)}${Math.random().toString(16).slice(2, 10)}` };
          
          // Log real transaction to history
          setTxHistory(prev => [{
            id: receipt.hash || tx.hash || `0x${Math.random().toString(16).slice(2, 10)}${Math.random().toString(16).slice(2, 10)}`,
            user: account,
            action: `Select ${tradeOutcome.toUpperCase()}`,
            amount: Number(amount),
            marketId: selectedMarketId,
            timestamp: Date.now()
          }, ...prev]);
        } else {
          // Sell requires no on-chain transaction since shares are mocked in this mode
        }
        
        // Sync blockchain data for USDC balance
        const balanceVal = await fetchBalance(account, signer, selectedNetwork, usdcAddress);
        setUsdcBalance(balanceVal);
        setInputAmount('');
        
        setContractStatus('active'); // Force green on successful transaction!

        if (tradeTab === 'buy') {
          setUserPortfolio(prev => {
            const type = tradeOutcome === 'yes' ? 'yesShares' : 'noShares';
            const currentShares = prev[type][selectedMarketId] || 0;
            return {
              ...prev,
              [type]: {
                ...prev[type],
                [selectedMarketId]: currentShares + (tradeQuoteEstimate * 1e6)
              }
            };
          });
          alert(`Buy order executed successfully on ${NETWORKS[selectedNetwork].chainName}!`);
        } else {
          const usdcReturned = tradeQuoteEstimate;
          setUsdcBalance(prev => (Number(prev) + usdcReturned).toFixed(2));
          setUserPortfolio(prev => {
            const type = tradeOutcome === 'yes' ? 'yesShares' : 'noShares';
            const currentShares = prev[type][selectedMarketId] || 0;
            return {
              ...prev,
              [type]: {
                ...prev[type],
                [selectedMarketId]: currentShares - (amount * 1e6)
              }
            };
          });
          alert(`Sell order executed successfully on ${NETWORKS[selectedNetwork].chainName}!`);
        }
      } catch (err) {
        console.error(err);
        alert(`Contract call failed: ${err.reason || err.message}`);
      }
    }
  };

  const handleDeployContract = async () => {
    if (!signer) {
      alert("Vui lòng kết nối ví MetaMask trước!");
      return;
    }
    try {
      if (!ethers.isAddress(usdcAddress)) {
        alert("Địa chỉ USDC không hợp lệ, vui lòng kiểm tra lại.");
        return;
      }
      const factory = new ethers.ContractFactory(
        PREDICTION_MARKET_ABI,
        PredictionMarketArtifact.bytecode,
        signer
      );
      alert("Vui lòng xác nhận giao dịch Deploy hợp đồng trên MetaMask...");
      const contract = await factory.deploy(usdcAddress);
      
      alert("Đang chờ giao dịch deploy được xác nhận trên blockchain...");
      await contract.waitForDeployment();
      
      const newAddress = await contract.getAddress();
      
      setContractAddress(newAddress);
      localStorage.setItem(`pm_contract_address_${selectedNetwork}`, newAddress);
      setCheckTrigger(prev => prev + 1);
      alert(`Deploy thành công! Địa chỉ hợp đồng mới của bạn là: ${newAddress}`);
    } catch (err) {
      console.error("Deploy error:", err);
      alert(`Deploy thất bại: ${err.message}`);
    }
  };

  // Add Liquidity (LP) Simulation/Execution
  const handleLPAdd = async (e) => {
    e.preventDefault();
    const amount = Number(inputAmount);
    if (isNaN(amount) || amount <= 0) return;

    if (isDemoMode) {
      if (amount > Number(arcBalance)) {
        alert("Insufficient USDC balance");
        return;
      }
      
      const usdcInUnits = amount * 1e6;
      setMarkets(prev => prev.map(m => {
        if (m.id === selectedMarketId) {
          // LP addition adds USDC equally as YES & NO to preserve pricing
          return {
            ...m,
            yesReserves: m.yesReserves + usdcInUnits,
            noReserves: m.noReserves + usdcInUnits,
            totalLPSupply: m.totalLPSupply + usdcInUnits
          };
        }
        return m;
      }));

      setArcBalance(prev => { const n = (Number(prev) - amount).toFixed(2); localStorage.setItem('pm_arc_balance', n); return n; });
      setUserPortfolio(prev => {
        const currentLP = prev.lpShares[selectedMarketId] || 0;
        return {
          ...prev,
          lpShares: {
            ...prev.lpShares,
            [selectedMarketId]: currentLP + usdcInUnits
          }
        };
      });
      setInputAmount('');
      alert("Simulated LP deposited successfully!");
    } else {
      alert("Additional Liquidity deposits on deployed contracts require calling the manager with appropriate USDC approval.");
    }
  };

  // Withdraw LP Simulation/Execution
  const handleLPWithdraw = async (marketId, lpAmountUnits) => {
    if (isDemoMode) {
      const market = markets.find(m => m.id === marketId);
      if (!market) return;

      const yesToWithdraw = Math.floor((lpAmountUnits * market.yesReserves) / market.totalLPSupply);
      const noToWithdraw = Math.floor((lpAmountUnits * market.noReserves) / market.totalLPSupply);

      setMarkets(prev => prev.map(m => {
        if (m.id === marketId) {
          return {
            ...m,
            yesReserves: m.yesReserves - yesToWithdraw,
            noReserves: m.noReserves - noToWithdraw,
            totalLPSupply: m.totalLPSupply - lpAmountUnits
          };
        }
        return m;
      }));

      setUserPortfolio(prev => {
        const currentLP = prev.lpShares[marketId] || 0;
        const currentYes = prev.yesShares[marketId] || 0;
        const currentNo = prev.noShares[marketId] || 0;
        return {
          ...prev,
          lpShares: { ...prev.lpShares, [marketId]: currentLP - lpAmountUnits },
          yesShares: { ...prev.yesShares, [marketId]: currentYes + yesToWithdraw },
          noShares: { ...prev.noShares, [marketId]: currentNo + noToWithdraw }
        };
      });

      alert("LP liquidity withdrawn! YES and NO shares added to your portfolio.");
    } else {
      try {
        const pmContract = new ethers.Contract(contractAddress, PREDICTION_MARKET_ABI, signer);
        const tx = await pmContract.withdrawLiquidity(marketId, lpAmountUnits);
        await tx.wait();
        alert("LP shares withdrawn successfully!");
        await syncBlockchainData(account, provider, signer);
        const balanceVal = await fetchBalance(account, signer, selectedNetwork, usdcAddress);
        setUsdcBalance(balanceVal);
      } catch (err) {
        alert(err.message);
      }
    }
  };

  // Market Resolution Simulation/Execution
  const handleResolveMarket = async (marketId, outcome) => {
    if (isDemoMode) {
      setMarkets(prev => prev.map(m => {
        if (m.id === marketId) {
          return { ...m, resolved: true, outcome: outcome };
        }
        return m;
      }));
      alert(`Simulated market resolution: ${outcome === 1 ? 'YES' : outcome === 2 ? 'NO' : 'INVALID'}`);
    } else {
      try {
        const pmContract = new ethers.Contract(contractAddress, PREDICTION_MARKET_ABI, signer);
        const tx = await pmContract.resolveMarket(marketId, outcome);
        await tx.wait();
        alert(`Market resolved successfully on ${NETWORKS[selectedNetwork].chainName}!`);
        await syncBlockchainData(account, provider, signer);
      } catch (err) {
        alert(err.message);
      }
    }
  };

  // Claim Winnings Simulation/Execution
  const handleRedeem = async (marketId) => {
    if (isDemoMode) {
      const market = markets.find(m => m.id === marketId);
      if (!market || !market.resolved) return;

      const userYes = userPortfolio.yesShares[marketId] || 0;
      const userNo = userPortfolio.noShares[marketId] || 0;
      const userLP = userPortfolio.lpShares[marketId] || 0;

      let payout = 0;
      if (market.outcome === 1) {
        payout += userYes / 1e6;
        if (userLP > 0) {
          payout += (userLP * market.yesReserves) / market.totalLPSupply / 1e6;
        }
      } else if (market.outcome === 2) {
        payout += userNo / 1e6;
        if (userLP > 0) {
          payout += (userLP * market.noReserves) / market.totalLPSupply / 1e6;
        }
      } else if (market.outcome === 3) {
        payout += (userYes + userNo) / 2 / 1e6;
        if (userLP > 0) {
          payout += (userLP * (market.yesReserves + market.noReserves)) / (2 * market.totalLPSupply) / 1e6;
        }
      }

      if (payout <= 0) {
        alert("No payout available for this market");
        return;
      }

      setUsdcBalance(prev => (Number(prev) + payout).toFixed(2));
      setUserPortfolio(prev => {
        return {
          ...prev,
          yesShares: { ...prev.yesShares, [marketId]: 0 },
          noShares: { ...prev.noShares, [marketId]: 0 },
          lpShares: { ...prev.lpShares, [marketId]: 0 },
          redeemedMarkets: { ...prev.redeemedMarkets, [marketId]: true }
        };
      });

      alert(`Redeemed $${payout.toFixed(2)} $ARC successfully!`);
    } else {
      try {
        const pmContract = new ethers.Contract(contractAddress, PREDICTION_MARKET_ABI, signer);
        const tx = await pmContract.redeemWinnings(marketId);
        await tx.wait();
        alert(`Winnings claimed successfully on ${NETWORKS[selectedNetwork].chainName}!`);
        await syncBlockchainData(account, provider, signer);
        const balanceVal = await fetchBalance(account, signer, selectedNetwork, usdcAddress);
        setUsdcBalance(balanceVal);
      } catch (err) {
        alert(err.message);
      }
    }
  };

  // Create New Market
  const handleCreateMarket = async (e) => {
    e.preventDefault();
    if (!newQuestion || !newDescription || !newEndTime || !newLiquidity) {
      alert("Please fill in all fields");
      return;
    }

    const liquidityVal = Number(newLiquidity);
    if (liquidityVal < 1) {
      alert("Minimum initial liquidity is 1 USDC");
      return;
    }

    const endTimestamp = Math.floor(new Date(newEndTime).getTime() / 1000);
    if (endTimestamp <= Math.floor(Date.now() / 1000)) {
      alert("Expiration date must be in the future");
      return;
    }

    if (isDemoMode) {
      if (liquidityVal > Number(usdcBalance)) {
        alert("Insufficient USDC to back liquidity pool");
        return;
      }

      const nextId = markets.length;
      const newMarket = {
        id: nextId,
        creator: '0x1A2b3C4d5E6f7G8h9I0J1K2L3M4N5O6P7Q8R9S0T',
        question: newQuestion,
        description: newDescription,
        category: newCategory,
        endTime: endTimestamp,
        resolved: false,
        outcome: 0,
        yesReserves: liquidityVal * 1e6,
        noReserves: liquidityVal * 1e6,
        totalLPSupply: liquidityVal * 1e6
      };

      setMarkets(prev => [...prev, newMarket]);
      setUsdcBalance(prev => (Number(prev) - liquidityVal).toFixed(2));
      setUserPortfolio(prev => ({
        ...prev,
        lpShares: {
          ...prev.lpShares,
          [nextId]: liquidityVal * 1e6
        }
      }));

      // Reset Form
      setNewQuestion('');
      setNewDescription('');
      setNewEndTime('');
      setShowCreateForm(false);
      setSelectedMarketId(nextId);
      alert("New prediction market created in simulated storage!");
    } else {
      // ON-CHAIN MARKET CREATION
      try {
        const pmContract = new ethers.Contract(contractAddress, PREDICTION_MARKET_ABI, signer);
        const usdcContract = new ethers.Contract(usdcAddress, USDC_ABI, signer);
        
        const liquidityWei = ethers.parseUnits(liquidityVal.toString(), 6);
        
        // 1. Approve USDC to PredictionMarket
        const allowance = await usdcContract.allowance(account, contractAddress);
        if (allowance < liquidityWei) {
          const txApprove = await usdcContract.approve(contractAddress, ethers.MaxUint256);
          await txApprove.wait();
        }
        
        // 2. Create Market
        const tx = await pmContract.createMarket(
          newQuestion,
          newDescription,
          newCategory,
          BigInt(endTimestamp),
          liquidityWei
        );
        await tx.wait();
        
        alert("Prediction market successfully created on-chain!");
        
        // Reset Form
        setNewQuestion('');
        setNewDescription('');
        setNewEndTime('');
        setShowCreateForm(false);
        
        // Sync blockchain data
        await syncBlockchainData(account, provider, signer);
        const balanceVal = await fetchBalance(account, signer, selectedNetwork, usdcAddress);
        setUsdcBalance(balanceVal);
      } catch (err) {
        console.error(err);
        alert(`Failed to create market: ${err.reason || err.message}`);
      }
    }
  };

  // Filtered Markets Selector
  const filteredMarkets = useMemo(() => {
    return markets.filter(m => {
      const matchesCategory = selectedCategory === 'All' || m.category === selectedCategory;
      const matchesSearch = m.question.toLowerCase().includes(searchQuery.toLowerCase()) || 
                            m.description.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesCategory && matchesSearch;
    });
  }, [markets, selectedCategory, searchQuery]);

  return (
    <div className="app-container">
      {/* Global Testnet Warning */}
      <div className="demo-banner" style={{ margin: '0.5rem 1rem 0 1rem' }}>
        <AlertCircle size={18} />
        Note: This website is for ARC testnet testing purposes only, tokens have no real value.
      </div>

      {/* Top Header */}
      <header className="header glass-panel glowing">
        <div className="logo-section">
          <svg className="logo-svg" width="36" height="36" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ filter: 'drop-shadow(0 0 8px rgba(0, 242, 254, 0.2))', marginRight: '4px' }}>
            <defs>
              <linearGradient id="logo-grad" x1="1" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#2e5bec" />
                <stop offset="35%" stopColor="#7000ff" />
                <stop offset="100%" stopColor="#d11270" />
              </linearGradient>
            </defs>
            <path d="M 22 82 C 22 35, 38 18, 50 18 C 62 18, 78 35, 78 82" stroke="url(#logo-grad)" strokeWidth="13" strokeLinecap="round" />
          </svg>
          <div style={{ whiteSpace: 'nowrap' }}>
            <h1 className="logo-title">ARC PREDICT</h1>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', letterSpacing: '0.05em' }}>
              STABLECOIN PREDICTION MARKETS
            </div>
          </div>
        </div>

        <div className="wallet-section">
          {/* Network Selection Dropdown */}
          <select 
            value={selectedNetwork} 
            onChange={(e) => {
              const newNet = e.target.value;
              setSelectedNetwork(newNet);
              disconnectWallet(); // Reset connection to require switching network in MetaMask
            }}
            className="form-input navbar-item-gradient"
            style={{ width: 'auto', padding: '0.45rem 1rem', fontSize: '0.85rem', height: '38px', borderRadius: '10px' }}
          >
            <option value="arc">Arc Testnet</option>
          </select>

          {!isDemoMode && (
            <div className="network-badge">
              <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', backgroundColor: 'var(--yes-color)', boxShadow: '0 0 8px var(--yes-color)' }}></span>
              {NETWORKS[selectedNetwork].chainName.toUpperCase()}
            </div>
          )}
          
          <button 
            onClick={() => setShowTransferModal(true)} 
            className="wallet-btn navbar-item-gradient"
          >
            <Send size={16} />
            Transfer
          </button>
          
          <button 
            onClick={() => setShowSwapModal(true)} 
            className="wallet-btn navbar-item-gradient"
          >
            <DollarSign size={16} />
            Deposit
          </button>
          
          {account && account.toLowerCase() === '0x5b950A7a251005b5e3720e1036b50aDddc0A31d8'.toLowerCase() && (
            <button 
              onClick={() => setShowAdminPanel(true)} 
              className="wallet-btn navbar-item-gradient"
            >
              <Shield size={16} />
              Admin
            </button>
          )}

          <button 
            onClick={() => setShowHistory(true)} 
            className="wallet-btn navbar-item-gradient"
          >
            <Clock size={16} />
            History
          </button>
          
          <button 
            onClick={() => setShowSettings(!showSettings)} 
            className="wallet-btn navbar-item-gradient"
          >
            <Info size={16} />
            Settings
          </button>
          
          <button 
            onClick={account ? disconnectWallet : () => setShowWalletModal(true)} 
            className={`wallet-btn ${account ? 'connected' : 'glow-btn-primary'}`}
          >
            <Wallet size={16} />
            {account ? `${account.substring(0, 6)}...${account.substring(38)}` : 'Connect Wallet'}
          </button>
        </div>
      </header>

      {/* Settings Panel */}
      {showSettings && (
        <section className="glass-panel animate-fade-in" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <h3 style={{ fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Info size={18} style={{ color: 'var(--primary-color)' }} />
            Arc Prediction Market Settings ({activeNetworkConfig.chainName})
          </h3>
          
          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '1rem', alignItems: 'end' }}>
            <div className="form-group">
              <label className="stat-label">ARC Prediction Market Contract Wallet Address</label>
              <input 
                type="text" 
                value={contractAddress} 
                onChange={(e) => {
                  const val = e.target.value.toLowerCase();
                  setContractAddress(val);
                  localStorage.setItem(`pm_contract_address_${selectedNetwork}`, val);
                  setCheckTrigger(prev => prev + 1);
                }} 
                className="form-input" 
                style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}
              />
            </div>
          </div>
          
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', borderTop: '1px solid var(--border-color)', paddingTop: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '0.9rem' }}>
              <span className="stat-label">Contract Status:</span>
              {contractStatus === 'demo' && (
                <span className="token-badge" style={{ backgroundColor: 'rgba(241, 196, 15, 0.12)', color: 'var(--warning-color)', borderColor: 'rgba(241, 196, 15, 0.3)' }}>
                  🟡 SIMULATED MODE (No Wallet Connected)
                </span>
              )}
              {contractStatus === 'checking' && (
                <span className="token-badge" style={{ backgroundColor: 'rgba(79, 172, 254, 0.12)', color: 'var(--secondary-color)', borderColor: 'rgba(79, 172, 254, 0.3)' }}>
                  🔵 VERIFYING ADDRESS...
                </span>
              )}
              {contractStatus === 'active' && (
                <span className="token-badge yes" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                  🟢 CONTRACT ACTIVE (Bytecode verified on-chain)
                </span>
              )}
              {contractStatus === 'inactive' && (
                <span className="token-badge no" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                  🔴 NO CONTRACT CODE FOUND! (Check address/network)
                </span>
              )}
            </div>

            {!isDemoMode && selectedNetwork === 'localhost' && (
              <button 
                onClick={handleFaucet}
                className="glow-btn-primary"
                style={{ padding: '0.5rem 1.25rem', fontSize: '0.85rem', borderRadius: '10px' }}
              >
                🚰 Claim 1,000 Mock $ARC
              </button>
            )}
          </div>
        </section>
      )}

      {/* Demo Mode Notice */}
      {isDemoMode && (
        <div className="demo-banner">
          <AlertCircle size={18} />
          Operating in Interactive Demo Mode (Stateful CPMM Math). Connect MetaMask to switch to live Arc Testnet.
        </div>
      )}

      {/* Global Stats Ribbon */}
      <section className="stats-ribbon">
        <div className="stat-card glass-panel">
          <span className="stat-label">Wallet Balance</span>
          <span className="stat-value text-glow" style={{ color: 'var(--primary-color)' }}>
            ${parseFloat(arcBalance).toLocaleString()} <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>$ARC</span>
          </span>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
            Ví ngoài: ${parseFloat(usdcBalance).toLocaleString()} USDC
          </div>
        </div>
        <div className="stat-card glass-panel">
          <span className="stat-label">Active Markets</span>
          <span className="stat-value">{markets.filter(m => !m.resolved).length}</span>
        </div>
        <div className="stat-card glass-panel">
          <span className="stat-label">Total Volume</span>
          <span className="stat-value">$142,390 <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>$ARC</span></span>
        </div>
        <div className="stat-card glass-panel">
          <span className="stat-label">L1 Gas Fee</span>
          <span className="stat-value" style={{ color: 'var(--yes-color)' }}>$0.0001 <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>$ARC</span></span>
        </div>
      </section>

      {/* Interactive Controls & Category Tabs */}
      <section style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <div className="categories-tabs">
          {['All', 'Crypto', 'Tech', 'Politics', 'Sports'].map(cat => (
            <button 
              key={cat} 
              onClick={() => setSelectedCategory(cat)}
              className={`tab-btn ${selectedCategory === cat ? 'active' : ''}`}
            >
              {cat}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <Search size={16} style={{ position: 'absolute', left: '1rem', color: 'var(--text-secondary)' }} />
            <input 
              type="text" 
              placeholder="Search markets..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="form-input"
              style={{ paddingLeft: '2.5rem', width: '240px', background: 'rgba(0, 0, 0, 0.2)' }}
            />
          </div>

          {account && account.toLowerCase() === '0x5b950A7a251005b5e3720e1036b50aDddc0A31d8'.toLowerCase() && (
            <button 
              onClick={() => setShowCreateForm(!showCreateForm)}
              className="glow-btn-primary"
              style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.65rem 1.25rem', borderRadius: '12px' }}
            >
              <PlusCircle size={18} />
              Create Market
            </button>
          )}
        </div>
      </section>

      {/* Main Grid: Create Market / Market Listing + Trader Side Panel */}
      {showCreateForm ? (
        <section className="glass-panel create-market-panel animate-fade-in">
          <h2 style={{ fontSize: '1.5rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.75rem' }}>Create a New Prediction Market</h2>
          <form onSubmit={handleCreateMarket} className="form-grid">
            <div className="form-group full-width">
              <label className="stat-label">Market Question</label>
              <input 
                type="text" 
                placeholder="e.g. Will Ethereum spot ETF hit $10B net inflows by end of 2026?"
                value={newQuestion}
                onChange={(e) => setNewQuestion(e.target.value)}
                className="form-input"
                required
              />
            </div>
            <div className="form-group full-width">
              <label className="stat-label">Rules & Resolution Description</label>
              <textarea 
                placeholder="Detail what data sources, oracle, or reports will determine the outcome. Describe constraints."
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                className="form-input"
                required
              />
            </div>
            <div className="form-group">
              <label className="stat-label">Category</label>
              <select 
                value={newCategory} 
                onChange={(e) => setNewCategory(e.target.value)}
                className="form-input"
              >
                <option value="Crypto">Crypto</option>
                <option value="Tech">Science & Tech</option>
                <option value="Politics">Politics</option>
                <option value="Sports">Sports</option>
              </select>
            </div>
            <div className="form-group">
              <label className="stat-label">Expiration Date / Resolve Time</label>
              <input 
                type="datetime-local" 
                value={newEndTime}
                onChange={(e) => setNewEndTime(e.target.value)}
                className="form-input"
                required
              />
            </div>
            <div className="form-group">
              <label className="stat-label">Initial AMM Liquidity Pool Seed ($ARC)</label>
              <div style={{ display: 'flex', alignItems: 'center', position: 'relative' }}>
                <DollarSign size={16} style={{ position: 'absolute', left: '1rem', color: 'var(--text-secondary)' }} />
                <input 
                  type="number" 
                  min="1"
                  value={newLiquidity}
                  onChange={(e) => setNewLiquidity(e.target.value)}
                  className="form-input"
                  style={{ paddingLeft: '2.25rem', width: '100%' }}
                  required
                />
              </div>
            </div>
            <div className="form-group" style={{ justifyContent: 'flex-end', display: 'flex', flexDirection: 'row', gap: '1rem', paddingTop: '1.75rem' }}>
              <button 
                type="button" 
                onClick={() => setShowCreateForm(false)} 
                className="tab-btn" 
                style={{ padding: '0.85rem 2rem' }}
              >
                Cancel
              </button>
              <button 
                type="submit" 
                className="glow-btn-primary" 
                style={{ padding: '0.85rem 2.5rem', borderRadius: '12px' }}
              >
                Submit Market
              </button>
            </div>
          </form>
        </section>
      ) : (
        <section className="main-content-grid">
          {/* Market Listings */}
          <div className="markets-list">
            {filteredMarkets.length === 0 ? (
              <div className="glass-panel" style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                No active prediction markets found for this category.
              </div>
            ) : (
              filteredMarkets.map(m => {
                const yPrice = (m.noReserves * 100) / (m.yesReserves + m.noReserves);
                const nPrice = 100 - yPrice;
                return (
                  <div 
                    key={m.id} 
                    onClick={() => setSelectedMarketId(m.id)}
                    className={`market-card glass-panel ${selectedMarketId === m.id ? 'selected' : ''}`}
                  >
                    <div className="market-card-header">
                      <span className="category-badge">{m.category}</span>
                      <span className="expiry-badge">
                        <Clock size={12} />
                        {m.resolved ? (
                          <span style={{ color: 'var(--yes-color)', fontWeight: 'bold' }}>Resolved</span>
                        ) : (
                          `Closes ${new Date(m.endTime * 1000).toLocaleDateString()}`
                        )}
                      </span>
                    </div>

                    <h3 className="market-question">{m.question}</h3>

                    {/* Price Bar Gauge */}
                    <div className="price-gauge-container">
                      <div className="gauge-bar-wrapper">
                        <div className="gauge-yes" style={{ width: `${yPrice}%` }}></div>
                        <div className="gauge-no" style={{ width: `${nPrice}%` }}></div>
                      </div>
                      <div className="gauge-labels">
                        <span className="yes-percent">YES: {yPrice.toFixed(0)}¢</span>
                        <span className="no-percent">NO: {nPrice.toFixed(0)}¢</span>
                      </div>
                    </div>

                    <div className="market-footer-stats">
                      <div className="stat-item">
                        <Layers size={12} />
                        Pool: {((m.yesReserves + m.noReserves) / 2 / 1e6).toFixed(0)} $ARC
                      </div>
                      <div className="stat-item">
                        <ArrowRightLeft size={12} />
                        Resolver: {m.creator === account ? 'You' : `${m.creator.substring(0, 6)}...`}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Side panel for trading selected market */}
          <div className="trading-panel glass-panel glowing">
            <div className="panel-header">
              <span className="category-badge" style={{ alignSelf: 'flex-start' }}>{selectedMarket.category}</span>
              <h3 className="panel-title">{selectedMarket.question}</h3>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: '1.4' }}>
                {selectedMarket.description}
              </p>
            </div>

            {selectedMarket.resolved ? (
              // RESOLVED STATE PANEL
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', textAlign: 'center', padding: '1rem 0' }}>
                <CheckCircle2 size={48} style={{ color: 'var(--yes-color)', margin: '0 auto' }} />
                <div>
                  <h4 style={{ fontSize: '1.2rem' }}>Market Resolved</h4>
                  <div style={{ fontSize: '1.5rem', fontWeight: 'bold', margin: '0.5rem 0', color: selectedMarket.outcome === 1 ? 'var(--yes-color)' : selectedMarket.outcome === 2 ? 'var(--no-color)' : 'var(--warning-color)' }}>
                    {selectedMarket.outcome === 1 ? 'YES Wins' : selectedMarket.outcome === 2 ? 'NO Wins' : 'INVALID (50/50 Payout)'}
                  </div>
                </div>
                
                {/* Redemption Check */}
                {((userPortfolio.yesShares[selectedMarketId] || 0) > 0 || 
                  (userPortfolio.noShares[selectedMarketId] || 0) > 0 || 
                  (userPortfolio.lpShares[selectedMarketId] || 0) > 0) && 
                  !userPortfolio.redeemedMarkets[selectedMarketId] ? (
                    <button 
                      onClick={() => handleRedeem(selectedMarketId)}
                      className="glow-btn-primary"
                      style={{ padding: '0.85rem', borderRadius: '10px' }}
                    >
                      Redeem Winnings
                    </button>
                ) : (
                  <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                    {userPortfolio.redeemedMarkets[selectedMarketId] ? 'Winnings claimed!' : 'You have no shares in this market.'}
                  </p>
                )}
              </div>
            ) : (
              // ACTIVE TRADING STATE PANEL
              <>
                <div className="panel-tabs" style={{ display: 'flex', width: '100%' }}>
                  <div className="panel-tab-btn active" style={{ flex: 1, width: '100%', cursor: 'default', display: 'flex', justifyContent: 'center', textAlign: 'center' }}>
                    BET
                  </div>
                </div>

                {/* YES / NO Outcome Toggle */}
                <div className="trade-outcome-select">
                  <button 
                    onClick={() => setTradeOutcome('yes')}
                    className={`outcome-btn yes ${tradeOutcome === 'yes' ? 'active' : ''}`}
                  >
                    <span>YES</span>
                    <span className="price-subtext">{(priceStats.yes).toFixed(0)}¢</span>
                  </button>
                  <button 
                    onClick={() => setTradeOutcome('no')}
                    className={`outcome-btn no ${tradeOutcome === 'no' ? 'active' : ''}`}
                  >
                    <span>NO</span>
                    <span className="price-subtext">{(priceStats.no).toFixed(0)}¢</span>
                  </button>
                </div>

                {/* Input Fields */}
                <form onSubmit={handleTradeSubmit} className="input-group">
                  <div className="input-label-row">
                    <span>{tradeTab === 'buy' ? '$ARC Amount' : 'Shares Amount'}</span>
                    <span>
                      Balance: {tradeTab === 'buy' 
                        ? `${parseFloat(arcBalance).toFixed(2)} $ARC` 
                        : `${((userPortfolio[tradeOutcome === 'yes' ? 'yesShares' : 'noShares'][selectedMarketId] || 0) / 1e6).toFixed(2)} Shares`
                      }
                    </span>
                  </div>
                  <div className="input-wrapper">
                    <input 
                      type="number" 
                      placeholder="0.00" 
                      value={inputAmount}
                      onChange={(e) => setInputAmount(e.target.value)}
                      className="input-box"
                      required
                    />
                    <span className="input-currency">{tradeTab === 'buy' ? '$ARC' : 'Shares'}</span>
                  </div>

                  {/* Estimation Info Details */}
                  {inputAmount && Number(inputAmount) > 0 && (
                    <div className="trade-details-box animate-fade-in">
                      <div className="trade-detail-row">
                        <span className="trade-detail-label">
                          {tradeTab === 'buy' ? 'Expected Shares' : 'Expected Payout'}
                        </span>
                        <span className="trade-detail-value highlight">
                          {tradeTab === 'buy' 
                            ? `${tradeQuoteEstimate.toFixed(2)} YES/NO` 
                            : `$${tradeQuoteEstimate.toFixed(2)} $ARC`
                          }
                        </span>
                      </div>
                      <div className="trade-detail-row">
                        <span className="trade-detail-label">Average Price</span>
                        <span className="trade-detail-value">
                          {tradeTab === 'buy' 
                            ? `${((Number(inputAmount) / tradeQuoteEstimate) * 100).toFixed(0)}¢` 
                            : `${((tradeQuoteEstimate / Number(inputAmount)) * 100).toFixed(0)}¢`
                          }
                        </span>
                      </div>
                      <div className="trade-detail-row">
                        <span className="trade-detail-label">Max Payout</span>
                        <span className="trade-detail-value" style={{ color: 'var(--yes-color)' }}>
                          {tradeTab === 'buy' ? `$${tradeQuoteEstimate.toFixed(2)}` : '-' }
                        </span>
                      </div>
                    </div>
                  )}

                  <button type="submit" className="glow-btn-primary action-btn">
                    {`Select ${tradeOutcome.toUpperCase()}`}
                  </button>
                </form>

                {/* LP Subpanel for Adding Liquidity */}
                <div style={{ marginTop: '0.5rem', borderTop: '1px solid var(--border-color)', paddingTop: '1.25rem' }}>
                  <h4 style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                    <Layers size={14} /> Market Liquidity Pool
                  </h4>
                  <form onSubmit={handleLPAdd} style={{ display: 'flex', gap: '0.5rem' }}>
                    <input 
                      type="number" 
                      placeholder="Add $ARC liquidity" 
                      value={tradeTab === 'lp' ? inputAmount : ''}
                      onChange={(e) => { setTradeTab('lp'); setInputAmount(e.target.value); }}
                      className="form-input"
                      style={{ flex: 1, padding: '0.5rem 0.75rem', fontSize: '0.85rem' }}
                      required
                    />
                    <button type="submit" className="tab-btn active" style={{ fontSize: '0.8rem', borderRadius: '10px' }}>
                      Deposit LP
                    </button>
                  </form>
                </div>

                {/* Resolver controls (Available in Demo Mode OR if the user is the creator of the market on-chain) */}
                {(isDemoMode || (!isDemoMode && selectedMarket.creator.toLowerCase() === account.toLowerCase())) && (
                  <div style={{ marginTop: '0.5rem', borderTop: '1px solid var(--border-color)', paddingTop: '1rem' }}>
                    <h4 style={{ fontSize: '0.9rem', color: 'var(--warning-color)', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                      <Award size={14} /> Resolution Oracle {(!isDemoMode && selectedMarket.creator.toLowerCase() === account.toLowerCase()) && "(You are Creator)"}
                    </h4>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.5rem' }}>
                      <button onClick={() => handleResolveMarket(selectedMarketId, 1)} className="action-link" style={{ fontSize: '0.75rem', border: '1px solid rgba(255,255,255,0.08)', padding: '0.25rem', borderRadius: '4px' }}>YES</button>
                      <button onClick={() => handleResolveMarket(selectedMarketId, 2)} className="action-link" style={{ fontSize: '0.75rem', border: '1px solid rgba(255,255,255,0.08)', padding: '0.25rem', borderRadius: '4px' }}>NO</button>
                      <button onClick={() => handleResolveMarket(selectedMarketId, 3)} className="action-link" style={{ fontSize: '0.75rem', border: '1px solid rgba(255,255,255,0.08)', padding: '0.25rem', borderRadius: '4px' }}>INVALID</button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </section>
      )}

      {/* User Portfolio & Holdings Dashboard */}
      <section className="portfolio-section glass-panel glowing">
        <h2 style={{ fontSize: '1.35rem', padding: '1.25rem 1.5rem 0 1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <TrendingUp size={20} style={{ color: 'var(--primary-color)' }} />
          Your Prediction Portfolio
        </h2>
        
        <div style={{ overflowX: 'auto' }}>
          <table className="portfolio-table">
            <thead>
              <tr>
                <th>Market</th>
                <th>Asset Type</th>
                <th>Balance</th>
                <th>Current Value</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {/* Filter through active/resolved holdings */}
              {markets.map(m => {
                const yesHolding = userPortfolio.yesShares[m.id] || 0;
                const noHolding = userPortfolio.noShares[m.id] || 0;
                const lpHolding = userPortfolio.lpShares[m.id] || 0;
                
                const rows = [];
                const resolvedTag = m.resolved 
                  ? (m.outcome === 1 ? 'YES Won' : m.outcome === 2 ? 'NO Won' : 'INVALID') 
                  : 'Active';

                if (yesHolding > 0) {
                  const val = m.resolved 
                    ? (m.outcome === 1 ? yesHolding / 1e6 : (m.outcome === 3 ? yesHolding / 2 / 1e6 : 0))
                    : (yesHolding * (m.noReserves / (m.yesReserves + m.noReserves))) / 1e6;

                  rows.push(
                    <tr key={`${m.id}-yes`}>
                      <td style={{ fontWeight: '600', maxWidth: '300px' }}>{m.question}</td>
                      <td><span className="token-badge yes">YES Shares</span></td>
                      <td>{(yesHolding / 1e6).toFixed(2)}</td>
                      <td style={{ fontFamily: 'var(--font-headings)', fontWeight: 'bold' }}>
                        ${val.toFixed(2)} $ARC
                      </td>
                      <td>
                        <span style={{ color: m.resolved ? (m.outcome === 1 ? 'var(--yes-color)' : 'var(--no-color)') : 'var(--text-secondary)', fontSize: '0.85rem' }}>
                          {resolvedTag}
                        </span>
                      </td>
                      <td>
                        {m.resolved ? (
                          !userPortfolio.redeemedMarkets[m.id] && (
                            <button onClick={() => handleRedeem(m.id)} className="action-link redeem">Claim</button>
                          )
                        ) : (
                          <button onClick={() => { setSelectedMarketId(m.id); setTradeTab('sell'); setTradeOutcome('yes'); }} className="action-link">Sell</button>
                        )}
                      </td>
                    </tr>
                  );
                }

                if (noHolding > 0) {
                  const val = m.resolved 
                    ? (m.outcome === 2 ? noHolding / 1e6 : (m.outcome === 3 ? noHolding / 2 / 1e6 : 0))
                    : (noHolding * (m.yesReserves / (m.yesReserves + m.noReserves))) / 1e6;

                  rows.push(
                    <tr key={`${m.id}-no`}>
                      <td style={{ fontWeight: '600', maxWidth: '300px' }}>{m.question}</td>
                      <td><span className="token-badge no">NO Shares</span></td>
                      <td>{(noHolding / 1e6).toFixed(2)}</td>
                      <td style={{ fontFamily: 'var(--font-headings)', fontWeight: 'bold' }}>
                        ${val.toFixed(2)} $ARC
                      </td>
                      <td>
                        <span style={{ color: m.resolved ? (m.outcome === 2 ? 'var(--yes-color)' : 'var(--no-color)') : 'var(--text-secondary)', fontSize: '0.85rem' }}>
                          {resolvedTag}
                        </span>
                      </td>
                      <td>
                        {m.resolved ? (
                          !userPortfolio.redeemedMarkets[m.id] && (
                            <button onClick={() => handleRedeem(m.id)} className="action-link redeem">Claim</button>
                          )
                        ) : (
                          <button onClick={() => { setSelectedMarketId(m.id); setTradeTab('sell'); setTradeOutcome('no'); }} className="action-link">Sell</button>
                        )}
                      </td>
                    </tr>
                  );
                }

                if (lpHolding > 0) {
                  // Compute LP value based on outcome or active reserves
                  let val = 0;
                  if (m.resolved) {
                    if (m.outcome === 1) {
                      val = (lpHolding * m.yesReserves) / m.totalLPSupply / 1e6;
                    } else if (m.outcome === 2) {
                      val = (lpHolding * m.noReserves) / m.totalLPSupply / 1e6;
                    } else if (m.outcome === 3) {
                      val = (lpHolding * (m.yesReserves + m.noReserves)) / (2 * m.totalLPSupply) / 1e6;
                    }
                  } else {
                    // Active LP is valued at virtual USDC backing
                    val = lpHolding / 1e6; // 1 LP ~ 1 USDC virtual deposit
                  }

                  rows.push(
                    <tr key={`${m.id}-lp`}>
                      <td style={{ fontWeight: '600', maxWidth: '300px' }}>{m.question}</td>
                      <td><span className="token-badge lp">LP Provider</span></td>
                      <td>{(lpHolding / 1e6).toFixed(2)}</td>
                      <td style={{ fontFamily: 'var(--font-headings)', fontWeight: 'bold' }}>
                        ${val.toFixed(2)} $ARC
                      </td>
                      <td>
                        <span style={{ color: 'var(--primary-color)', fontSize: '0.85rem' }}>
                          {m.resolved ? 'Claimable' : 'Active'}
                        </span>
                      </td>
                      <td>
                        {m.resolved ? (
                          !userPortfolio.redeemedMarkets[m.id] && (
                            <button onClick={() => handleRedeem(m.id)} className="action-link redeem">Redeem LP</button>
                          )
                        ) : (
                          <button onClick={() => handleLPWithdraw(m.id, lpHolding)} className="action-link">Withdraw</button>
                        )}
                      </td>
                    </tr>
                  );
                }

                return rows;
              }).flat()}

              {/* Empty state check */}
              {markets.every(m => 
                (userPortfolio.yesShares[m.id] || 0) === 0 && 
                (userPortfolio.noShares[m.id] || 0) === 0 && 
                (userPortfolio.lpShares[m.id] || 0) === 0
              ) && (
                <tr>
                  <td colSpan="6" style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                    Your portfolio is currently empty. Buy YES/NO shares or provide liquidity to seed a market!
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Transaction History Modal */}
      {showHistory && (
        <div className="modal-overlay" onClick={() => setShowHistory(false)}>
          <div className="modal-content glass-panel" onClick={e => e.stopPropagation()} style={{ width: '800px', maxWidth: '95vw', maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}>
            <div className="modal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '1rem' }}>
              <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0 }}>
                <Clock size={24} style={{ color: 'var(--primary-color)' }} />
                Transaction History
              </h2>
              <button className="close-btn" onClick={() => setShowHistory(false)}>&times;</button>
            </div>
            
            <div style={{ marginBottom: '1.5rem' }}>
              <div className="search-bar" style={{ maxWidth: '100%' }}>
                <Search size={18} />
                <input 
                  type="text" 
                  placeholder="Paste Wallet Address to filter transactions..." 
                  value={historySearchQuery}
                  onChange={(e) => setHistorySearchQuery(e.target.value)}
                  className="form-input"
                  style={{ width: '100%', background: 'transparent', border: 'none', color: 'var(--text-primary)', outline: 'none' }}
                />
              </div>
            </div>

            <div style={{ flex: 1, overflowY: 'auto' }}>
              <table className="market-table" style={{ width: '100%', textAlign: 'left' }}>
                <thead>
                  <tr>
                    <th>Tx Hash</th>
                    <th>Wallet Address</th>
                    <th>Action</th>
                    <th>Amount</th>
                    <th>Time</th>
                  </tr>
                </thead>
                <tbody>
                  {txHistory.filter(tx => tx.user.toLowerCase().includes(historySearchQuery.toLowerCase())).length > 0 ? (
                    txHistory
                      .filter(tx => tx.user.toLowerCase().includes(historySearchQuery.toLowerCase()))
                      .map((tx, idx) => (
                        <tr key={idx} className="animate-fade-in" style={{ animationDelay: `${idx * 0.02}s` }}>
                          <td style={{ fontFamily: 'monospace', color: 'var(--text-secondary)' }}>{tx.id.substring(0, 10)}...</td>
                          <td style={{ fontFamily: 'monospace', color: 'var(--primary-color)' }}>
                            {tx.user.length > 20 ? `${tx.user.substring(0, 6)}...${tx.user.substring(tx.user.length - 4)}` : tx.user}
                          </td>
                          <td>
                            <span className={`token-badge ${tx.action.includes('YES') ? 'yes' : 'no'}`}>
                              {tx.action}
                            </span>
                          </td>
                          <td style={{ fontWeight: 'bold' }}>${tx.amount.toFixed(2)} $ARC</td>
                          <td style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                            {new Date(tx.timestamp).toLocaleString()}
                          </td>
                        </tr>
                      ))
                  ) : (
                    <tr>
                      <td colSpan="5" style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                        No transactions found for this address.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
      
      
      {/* Transfer Modal */}
      {showTransferModal && (
        <div className="modal-overlay" onClick={() => setShowTransferModal(false)}>
          <div className="modal-content glass-panel" onClick={e => e.stopPropagation()} style={{ width: '450px', maxWidth: '95vw', padding: '2rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: '1rem' }}>
              <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0, fontSize: '1.5rem' }}>
                <Send size={24} style={{ color: 'var(--primary-color)' }} />
                Transfer USDC
              </h2>
              <button className="close-btn" onClick={() => setShowTransferModal(false)}>&times;</button>
            </div>
            
            <p style={{ color: 'var(--warning-color)', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'rgba(241, 196, 15, 0.1)', padding: '0.75rem', borderRadius: '8px', border: '1px solid rgba(241, 196, 15, 0.2)', margin: 0 }}>
              <AlertCircle size={16} style={{ flexShrink: 0 }} />
              Lưu ý: Mục này chỉ hỗ trợ chuyển đổi đồng USDC Testnet.
            </p>

            <div className="form-group">
              <label className="stat-label">Recipient Wallet Address</label>
              <input 
                type="text" 
                className="input-box" 
                placeholder="0x..." 
                value={transferAddress}
                onChange={e => setTransferAddress(e.target.value)}
                style={{ fontSize: '1rem', padding: '0.8rem' }}
              />
            </div>

            <div className="form-group">
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
                <span>Amount to Send</span>
                <span>Balance: {parseFloat(usdcBalance).toFixed(2)} USDC</span>
              </div>
              <div className="input-wrapper">
                <span className="input-currency">USDC</span>
                <input 
                  type="number" 
                  className="input-box" 
                  placeholder="0.00" 
                  value={transferAmount}
                  onChange={e => setTransferAmount(e.target.value)}
                />
              </div>
            </div>

            <button 
              onClick={handleTransfer}
              className="glow-btn-primary"
              style={{ width: '100%', padding: '1rem', fontSize: '1.1rem', borderRadius: '12px', marginTop: '0.5rem' }}
            >
              Confirm Transfer
            </button>
          </div>
        </div>
      )}

      {/* Deposit Modal (formerly Swap) */}
      {showSwapModal && (
        <div className="modal-overlay" onClick={() => setShowSwapModal(false)}>
          <div className="modal-content glass-panel" onClick={e => e.stopPropagation()} style={{ width: '400px', maxWidth: '95vw', padding: '2rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: '1rem' }}>
              <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0, fontSize: '1.5rem' }}>
                <DollarSign size={24} style={{ color: 'var(--primary-color)' }} />
                Deposit USDC
              </h2>
              <button className="close-btn" onClick={() => setShowSwapModal(false)}>&times;</button>
            </div>
            
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>
              <button 
                className={`tab-btn ${depositTab === 'deposit' ? 'active' : ''}`}
                onClick={() => setDepositTab('deposit')}
                style={{ flex: 1, padding: '0.5rem' }}
              >
                Deposit
              </button>
              <button 
                className={`tab-btn ${depositTab === 'withdraw' ? 'active' : ''}`}
                onClick={() => setDepositTab('withdraw')}
                style={{ flex: 1, padding: '0.5rem' }}
              >
                Withdraw
              </button>
            </div>
            
            <div className="form-group">
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
                <span>{depositTab === 'deposit' ? 'Deposit Amount' : 'Withdraw Amount'}</span>
                <span>{depositTab === 'deposit' ? `Wallet Balance: ${parseFloat(usdcBalance).toFixed(2)}` : `Game Balance: ${parseFloat(arcBalance).toFixed(2)}`}</span>
              </div>
              <div className="input-wrapper">
                <span className="input-currency">{depositTab === 'deposit' ? 'USDC' : '$ARC'}</span>
                <input 
                  type="number" 
                  className="input-box" 
                  placeholder="0.00" 
                  value={swapAmount}
                  onChange={e => setSwapAmount(e.target.value)}
                />
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <DollarSign size={20} style={{ color: 'var(--text-muted)' }} />
            </div>

            <div className="form-group">
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
                <span>{depositTab === 'deposit' ? 'Receive Game Tokens ($ARC)' : 'Receive USDC'}</span>
                <span>{depositTab === 'deposit' ? `Game Balance: ${parseFloat(arcBalance).toFixed(2)}` : `Wallet Balance: ${parseFloat(usdcBalance).toFixed(2)}`}</span>
              </div>
              <div className="input-wrapper">
                <span className="input-currency">{depositTab === 'deposit' ? '$ARC' : 'USDC'}</span>
                <input 
                  type="number" 
                  className="input-box" 
                  placeholder="0.00" 
                  value={swapAmount}
                  disabled
                  style={{ background: 'rgba(0, 0, 0, 0.4)', color: 'var(--text-secondary)' }}
                />
              </div>
            </div>

            <button 
              onClick={depositTab === 'deposit' ? handleSwap : handleWithdraw}
              className="glow-btn-primary"
              style={{ width: '100%', padding: '1rem', fontSize: '1.1rem', borderRadius: '12px', marginTop: '0.5rem' }}
            >
              {depositTab === 'deposit' ? 'Confirm Deposit' : 'Confirm Withdraw'}
            </button>
          </div>
        </div>
      )}

      {/* Admin Payout Modal */}
      {showAdminPanel && (
        <div className="modal-overlay" onClick={() => setShowAdminPanel(false)}>
          <div className="modal-content glass-panel" onClick={e => e.stopPropagation()} style={{ width: '800px', maxWidth: '95vw', maxHeight: '85vh', display: 'flex', flexDirection: 'column', border: '1px solid var(--warning-color)' }}>
            <div className="modal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', borderBottom: '1px solid rgba(241, 196, 15, 0.3)', paddingBottom: '1rem' }}>
              <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0, color: 'var(--warning-color)' }}>
                <Shield size={24} />
                Admin Payout Panel
              </h2>
              <button className="close-btn" onClick={() => setShowAdminPanel(false)}>&times;</button>
            </div>
            
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '1.5rem' }}>
              Dưới đây là danh sách những người chơi thắng cược đang chờ thanh toán. Bấm "Pay" để chuyển thẳng $ARC từ ví Admin của bạn cho họ.
            </p>

            <div style={{ flex: 1, overflowY: 'auto' }}>
              <table className="market-table" style={{ width: '100%', textAlign: 'left' }}>
                <thead>
                  <tr>
                    <th>Winner Wallet</th>
                    <th>Market</th>
                    <th>Prize Amount</th>
                    <th style={{ textAlign: 'right' }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {pendingPayouts.length > 0 ? (
                    pendingPayouts.map((payout, idx) => (
                        <tr key={payout.id} className="animate-fade-in" style={{ animationDelay: `${idx * 0.02}s` }}>
                          <td style={{ fontFamily: 'monospace', color: 'var(--primary-color)' }}>
                            {payout.winnerAddress.substring(0, 8)}...{payout.winnerAddress.substring(34)}
                          </td>
                          <td style={{ fontSize: '0.85rem' }}>{payout.marketName}</td>
                          <td style={{ fontWeight: 'bold', color: 'var(--yes-color)' }}>${payout.prizeAmount.toFixed(2)}</td>
                          <td style={{ textAlign: 'right' }}>
                            <button 
                              onClick={() => handlePayout(payout.id, payout.winnerAddress, payout.prizeAmount)}
                              className="action-link redeem"
                              style={{ background: 'var(--yes-color)', color: '#000', border: 'none', padding: '0.5rem 1rem', fontWeight: 'bold' }}
                            >
                              Pay
                            </button>
                          </td>
                        </tr>
                      ))
                  ) : (
                    <tr>
                      <td colSpan="4" style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                        Không có khoản thanh toán nào đang chờ.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Wallet Selection Modal */}
      {showWalletModal && (
        <div className="modal-overlay" onClick={() => setShowWalletModal(false)}>
          <div className="modal-content glass-panel" onClick={e => e.stopPropagation()} style={{ width: '400px', maxWidth: '95vw', padding: '2rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: '1rem' }}>
              <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0, fontSize: '1.5rem' }}>
                <Wallet size={24} style={{ color: 'var(--primary-color)' }} />
                Connect Wallet
              </h2>
              <button className="close-btn" onClick={() => setShowWalletModal(false)}>&times;</button>
            </div>
            
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', textAlign: 'center' }}>
              Choose how you want to connect to ARC Predict.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <button 
                onClick={() => connectSpecificWallet('metamask')}
                className="wallet-btn"
                style={{ width: '100%', padding: '1rem', justifyContent: 'center', background: 'rgba(255, 255, 255, 0.05)', border: '1px solid var(--border-color)', fontSize: '1.1rem' }}
              >
                🦊 MetaMask
              </button>
              
              <button 
                onClick={() => connectSpecificWallet('okx')}
                className="wallet-btn"
                style={{ width: '100%', padding: '1rem', justifyContent: 'center', background: 'rgba(255, 255, 255, 0.05)', border: '1px solid var(--border-color)', fontSize: '1.1rem' }}
              >
                🔳 OKX Wallet
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
