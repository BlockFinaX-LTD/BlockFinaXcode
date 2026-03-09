/**
 * Database Storage Interface and Implementation
 * 
 * Provides comprehensive CRUD operations for all database entities
 * including wallets, referrals, and user profiles.
 */

import { 
  wallets, 
  networks, 
  transactions, 
  balances,
  userProfiles,
  referralCodes,
  referrals,
  userPoints,
  pointTransactions,
  userRoles,
  waitlist,
  type Waitlist,
  type InsertWaitlist,
  type Wallet, 
  type InsertWallet,
  type Network,
  type InsertNetwork,
  type Transaction,
  type InsertTransaction,
  type Balance,
  type InsertBalance,
  type UserProfile,
  type InsertUserProfile,
  type ReferralCode,
  type InsertReferralCode,
  type Referral,
  type InsertReferral,
  type UserPoints,
  type InsertUserPoints,
  type PointTransaction,
  type InsertPointTransaction,
  type UserRole,
  type InsertUserRole,
  hedgeEvents,
  type HedgeEvent,
  type InsertHedgeEvent,
  hedgePositions,
  type HedgePosition,
  type InsertHedgePosition,
  hedgeLpDeposits,
  type HedgeLpDeposit,
  type InsertHedgeLpDeposit,
  articles,
  type Article,
  type InsertArticle,
  rateSnapshots,
  type RateSnapshot,
  type InsertRateSnapshot
} from "@shared/schema";
import { db } from "./db";
import { eq, desc, or, and, sql, lt, lte } from "drizzle-orm";

/**
 * Storage interface defining all database operations
 * Ensures consistent data access patterns across the application
 */
export interface IStorage {
  // ═══════════════════════════════════════════════════════
  // TABLE OF CONTENTS
  // ═══════════════════════════════════════════════════════
  // [WALLET]                  Wallet Management
  // [NETWORK]                 Network Management
  // [TRANSACTION]             Transaction Management
  // [BALANCE]                 Balance Management
  // [PROFILES]                User Profiles
  // [REFERRALS]               Referral System
  // [USER-ROLES]              User Roles
  // [PORTFOLIO]               Portfolio Stats
  // [HEDGE]                   P2P Trade Hedge
  // [ARTICLES]                Articles
  // ═══════════════════════════════════════════════════════

  // Wallet operations
  getWallet(id: number): Promise<Wallet | undefined>;
  getWalletByAddress(address: string): Promise<Wallet | undefined>;
  getAllWallets(): Promise<Wallet[]>;
  createWallet(wallet: InsertWallet): Promise<Wallet>;
  updateWallet(id: number, updates: Partial<InsertWallet>): Promise<Wallet | undefined>;
  deleteWallet(id: number): Promise<boolean>;

  // Network operations
  getNetwork(id: number): Promise<Network | undefined>;
  getNetworkByChainId(chainId: number): Promise<Network | undefined>;
  getAllNetworks(): Promise<Network[]>;
  createNetwork(network: InsertNetwork): Promise<Network>;
  updateNetwork(id: number, updates: Partial<InsertNetwork>): Promise<Network | undefined>;

  // Transaction operations
  getTransaction(id: number): Promise<Transaction | undefined>;
  getTransactionByHash(hash: string): Promise<Transaction | undefined>;
  getTransactions(filters: {
    walletId?: number;
    networkId?: number;
    status?: string;
    limit?: number;
  }): Promise<Transaction[]>;
  createTransaction(transaction: InsertTransaction): Promise<Transaction>;
  updateTransaction(hash: string, updates: Partial<InsertTransaction>): Promise<Transaction | undefined>;

  // Balance operations
  getBalance(id: number): Promise<Balance | undefined>;
  getBalances(filters: {
    walletId?: number;
    networkId?: number;
  }): Promise<Balance[]>;
  createBalance(balance: InsertBalance): Promise<Balance>;
  updateBalance(id: number, updates: Partial<InsertBalance>): Promise<Balance | undefined>;

  // Profile operations
  getUserProfile(walletAddress: string): Promise<UserProfile | undefined>;
  createUserProfile(profile: InsertUserProfile): Promise<UserProfile>;
  updateUserProfile(walletAddress: string, updates: Partial<InsertUserProfile>): Promise<UserProfile | undefined>;
  deleteUserProfile(walletAddress: string): Promise<boolean>;

  // Referral operations
  createReferralCode(code: InsertReferralCode): Promise<ReferralCode>;
  getReferralCode(code: string): Promise<ReferralCode | undefined>;
  getReferralCodesByWallet(walletAddress: string): Promise<ReferralCode[]>;
  updateReferralCodeUses(code: string): Promise<ReferralCode | undefined>;
  
  createReferral(referral: InsertReferral): Promise<Referral>;
  getReferralsByWallet(walletAddress: string): Promise<Referral[]>;
  getAllReferrals(): Promise<Referral[]>;
  updateReferralStatus(id: number, status: string): Promise<Referral | undefined>;
  
  getUserPoints(walletAddress: string): Promise<UserPoints | undefined>;
  getAllUserPoints(): Promise<UserPoints[]>;
  createUserPoints(points: InsertUserPoints): Promise<UserPoints>;
  updateUserPoints(walletAddress: string, points: number): Promise<UserPoints | undefined>;
  
  createPointTransaction(transaction: InsertPointTransaction): Promise<PointTransaction>;
  getPointTransactions(walletAddress: string): Promise<PointTransaction[]>;

  // User Role operations
  getUserRole(walletAddress: string): Promise<UserRole | undefined>;
  getAllUserRoles(): Promise<UserRole[]>;
  createUserRole(role: InsertUserRole): Promise<UserRole>;
  updateUserRole(walletAddress: string, updates: Partial<InsertUserRole>): Promise<UserRole | undefined>;

  // Statistics
  getPortfolioStats(walletId: number): Promise<{
    totalValue: number;
    networkBreakdown: Array<{
      networkId: number;
      balance: string;
      usdValue: number;
      percentage: number;
    }>;
    transactionCount: number;
    lastActivity: Date | null;
  }>;

  // Hedge Event operations
  createHedgeEvent(event: InsertHedgeEvent): Promise<HedgeEvent>;
  getHedgeEvent(id: number): Promise<HedgeEvent | undefined>;
  getAllHedgeEvents(): Promise<HedgeEvent[]>;
  getOpenHedgeEvents(): Promise<HedgeEvent[]>;
  updateHedgeEvent(id: number, updates: Partial<HedgeEvent>): Promise<HedgeEvent | undefined>;

  // Hedge Position operations
  createHedgePosition(position: InsertHedgePosition): Promise<HedgePosition>;
  getHedgePosition(id: number): Promise<HedgePosition | undefined>;
  getHedgePositionsByEvent(eventId: number): Promise<HedgePosition[]>;
  getHedgePositionsByWallet(wallet: string): Promise<HedgePosition[]>;
  updateHedgePosition(id: number, updates: Partial<HedgePosition>): Promise<HedgePosition | undefined>;

  // Hedge LP Deposit operations
  createHedgeLpDeposit(deposit: InsertHedgeLpDeposit): Promise<HedgeLpDeposit>;
  getHedgeLpDeposit(id: number): Promise<HedgeLpDeposit | undefined>;
  getHedgeLpDepositsByEvent(eventId: number): Promise<HedgeLpDeposit[]>;
  getHedgeLpDepositsByWallet(wallet: string): Promise<HedgeLpDeposit[]>;
  updateHedgeLpDeposit(id: number, updates: Partial<HedgeLpDeposit>): Promise<HedgeLpDeposit | undefined>;

  // Article operations
  getArticles(onlyPublished?: boolean): Promise<Article[]>;
  getArticleBySlug(slug: string): Promise<Article | undefined>;
  getArticle(id: number): Promise<Article | undefined>;
  createArticle(article: InsertArticle): Promise<Article>;
  updateArticle(id: number, updates: Partial<InsertArticle>): Promise<Article | undefined>;
  deleteArticle(id: number): Promise<boolean>;

  // Rate Snapshot operations
  saveRateSnapshots(snapshots: InsertRateSnapshot[]): Promise<void>;
  getRateSnapshotBefore(pair: string, beforeMs: number): Promise<RateSnapshot | undefined>;
  pruneOldRateSnapshots(olderThanMs: number): Promise<void>;
}

export class MemStorage implements IStorage {
  private wallets: Map<number, Wallet>;
  private networks: Map<number, Network>;
  private transactions: Map<number, Transaction>;
  private balances: Map<number, Balance>;
  private profiles: Map<string, UserProfile>;
  private transactionsByHash: Map<string, Transaction>;
  private referralCodes: Map<string, ReferralCode>;
  private referrals: Map<number, Referral>;
  private userPoints: Map<string, UserPoints>;
  private pointTransactions: Map<number, PointTransaction>;
  private userRoles: Map<string, UserRole>;
  private currentWalletId: number;
  private currentNetworkId: number;
  private currentTransactionId: number;
  private currentBalanceId: number;
  private currentProfileId: number;
  private currentReferralId: number;
  private currentPointTransactionId: number;
  private currentUserRoleId: number;

  constructor() {
    this.wallets = new Map();
    this.networks = new Map();
    this.transactions = new Map();
    this.balances = new Map();
    this.profiles = new Map();
    this.transactionsByHash = new Map();
    this.referralCodes = new Map();
    this.referrals = new Map();
    this.userPoints = new Map();
    this.pointTransactions = new Map();
    this.userRoles = new Map();
    this.currentWalletId = 1;
    this.currentNetworkId = 1;
    this.currentTransactionId = 1;
    this.currentBalanceId = 1;
    this.currentProfileId = 1;
    this.currentReferralId = 1;
    this.currentPointTransactionId = 1;
    this.currentUserRoleId = 1;

    // Initialize with default testnet networks
    this.initializeDefaultNetworks();
  }

  private async initializeDefaultNetworks(): Promise<void> {
    const defaultNetworks: InsertNetwork[] = [
      {
        name: "Lisk Sepolia",
        chainId: 4202,
        rpcUrl: "https://rpc.sepolia-api.lisk.com",
        symbol: "ETH",
        blockExplorerUrl: "https://sepolia-blockscout.lisk.com",
        isTestnet: true
      }
    ];

    for (const network of defaultNetworks) {
      await this.createNetwork(network);
    }
  }

  // Wallet operations
  async getWallet(id: number): Promise<Wallet | undefined> {
    return this.wallets.get(id);
  }

  async getWalletByAddress(address: string): Promise<Wallet | undefined> {
    return Array.from(this.wallets.values()).find(
      wallet => wallet.address.toLowerCase() === address.toLowerCase()
    );
  }

  async getAllWallets(): Promise<Wallet[]> {
    return Array.from(this.wallets.values());
  }

  async createWallet(insertWallet: InsertWallet): Promise<Wallet> {
    const id = this.currentWalletId++;
    const wallet: Wallet = {
      ...insertWallet,
      id,
      email: insertWallet.email || null,
      encryptedMnemonic: insertWallet.encryptedMnemonic || null,
      isImported: insertWallet.isImported || false,
      createdAt: new Date()
    };
    this.wallets.set(id, wallet);
    return wallet;
  }

  async updateWallet(id: number, updates: Partial<InsertWallet>): Promise<Wallet | undefined> {
    const wallet = this.wallets.get(id);
    if (!wallet) return undefined;

    const updatedWallet = { ...wallet, ...updates };
    this.wallets.set(id, updatedWallet);
    return updatedWallet;
  }

  async deleteWallet(id: number): Promise<boolean> {
    return this.wallets.delete(id);
  }

  // Network operations
  async getNetwork(id: number): Promise<Network | undefined> {
    return this.networks.get(id);
  }

  async getNetworkByChainId(chainId: number): Promise<Network | undefined> {
    return Array.from(this.networks.values()).find(
      network => network.chainId === chainId
    );
  }

  async getAllNetworks(): Promise<Network[]> {
    return Array.from(this.networks.values());
  }

  async createNetwork(insertNetwork: InsertNetwork): Promise<Network> {
    const id = this.currentNetworkId++;
    const network: Network = { 
      ...insertNetwork, 
      id,
      blockExplorerUrl: insertNetwork.blockExplorerUrl || null,
      usdcContractAddress: insertNetwork.usdcContractAddress || null,
      isTestnet: insertNetwork.isTestnet || false
    };
    this.networks.set(id, network);
    return network;
  }

  async updateNetwork(id: number, updates: Partial<InsertNetwork>): Promise<Network | undefined> {
    const network = this.networks.get(id);
    if (!network) return undefined;

    const updatedNetwork = { ...network, ...updates };
    this.networks.set(id, updatedNetwork);
    return updatedNetwork;
  }

  // Transaction operations
  async getTransaction(id: number): Promise<Transaction | undefined> {
    return this.transactions.get(id);
  }

  async getTransactionByHash(hash: string): Promise<Transaction | undefined> {
    return this.transactionsByHash.get(hash);
  }

  async getTransactions(filters: {
    walletId?: number;
    networkId?: number;
    status?: string;
    limit?: number;
  }): Promise<Transaction[]> {
    let result = Array.from(this.transactions.values());

    if (filters.walletId) {
      result = result.filter(tx => tx.walletId === filters.walletId);
    }

    if (filters.networkId) {
      result = result.filter(tx => tx.networkId === filters.networkId);
    }

    if (filters.status) {
      result = result.filter(tx => tx.status === filters.status);
    }

    // Sort by timestamp, newest first
    result.sort((a, b) => {
      const aTime = a.timestamp ? new Date(a.timestamp).getTime() : 0;
      const bTime = b.timestamp ? new Date(b.timestamp).getTime() : 0;
      return bTime - aTime;
    });

    if (filters.limit) {
      result = result.slice(0, filters.limit);
    }

    return result;
  }

  async createTransaction(insertTransaction: InsertTransaction): Promise<Transaction> {
    const id = this.currentTransactionId++;
    const transaction: Transaction = {
      ...insertTransaction,
      id,
      walletId: insertTransaction.walletId || null,
      networkId: insertTransaction.networkId || null,
      gasPrice: insertTransaction.gasPrice || null,
      gasUsed: insertTransaction.gasUsed || null,
      blockNumber: insertTransaction.blockNumber || null,
      timestamp: new Date()
    };
    
    this.transactions.set(id, transaction);
    this.transactionsByHash.set(transaction.hash, transaction);
    return transaction;
  }

  async updateTransaction(hash: string, updates: Partial<InsertTransaction>): Promise<Transaction | undefined> {
    const transaction = this.transactionsByHash.get(hash);
    if (!transaction) return undefined;

    const updatedTransaction = { ...transaction, ...updates };
    this.transactions.set(transaction.id, updatedTransaction);
    this.transactionsByHash.set(hash, updatedTransaction);
    return updatedTransaction;
  }

  // Balance operations
  async getBalance(id: number): Promise<Balance | undefined> {
    return this.balances.get(id);
  }

  async getBalances(filters: {
    walletId?: number;
    networkId?: number;
  }): Promise<Balance[]> {
    let result = Array.from(this.balances.values());

    if (filters.walletId) {
      result = result.filter(balance => balance.walletId === filters.walletId);
    }

    if (filters.networkId) {
      result = result.filter(balance => balance.networkId === filters.networkId);
    }

    return result;
  }

  async createBalance(insertBalance: InsertBalance): Promise<Balance> {
    const id = this.currentBalanceId++;
    const balance: Balance = {
      ...insertBalance,
      id,
      walletId: insertBalance.walletId || null,
      networkId: insertBalance.networkId || null,
      usdValue: insertBalance.usdValue || null,
      lastUpdated: new Date()
    };
    this.balances.set(id, balance);
    return balance;
  }

  async updateBalance(id: number, updates: Partial<InsertBalance>): Promise<Balance | undefined> {
    const balance = this.balances.get(id);
    if (!balance) return undefined;

    const updatedBalance = { 
      ...balance, 
      ...updates,
      lastUpdated: new Date()
    };
    this.balances.set(id, updatedBalance);
    return updatedBalance;
  }

  // Statistics
  async getPortfolioStats(walletId: number): Promise<{
    totalValue: number;
    networkBreakdown: Array<{
      networkId: number;
      balance: string;
      usdValue: number;
      percentage: number;
    }>;
    transactionCount: number;
    lastActivity: Date | null;
  }> {
    const balances = await this.getBalances({ walletId });
    const transactions = await this.getTransactions({ walletId });

    const totalValue = balances.reduce((sum, balance) => {
      return sum + (balance.usdValue ? parseFloat(balance.usdValue) : 0);
    }, 0);

    const networkBreakdown = balances.map(balance => {
      const usdValue = balance.usdValue ? parseFloat(balance.usdValue) : 0;
      return {
        networkId: balance.networkId!,
        balance: balance.balance,
        usdValue,
        percentage: totalValue > 0 ? (usdValue / totalValue) * 100 : 0
      };
    });

    const lastActivity = transactions.length > 0 
      ? transactions.reduce((latest, tx) => {
          const txTime = tx.timestamp ? new Date(tx.timestamp) : new Date(0);
          return txTime > latest ? txTime : latest;
        }, new Date(0))
      : null;

    return {
      totalValue,
      networkBreakdown,
      transactionCount: transactions.length,
      lastActivity
    };
  }

  // Profile operations (MemStorage placeholders)
  async getUserProfile(walletAddress: string): Promise<UserProfile | undefined> {
    return this.profiles.get(walletAddress);
  }

  async createUserProfile(insertProfile: InsertUserProfile): Promise<UserProfile> {
    const profile: UserProfile = {
      id: this.currentProfileId++,
      walletAddress: insertProfile.walletAddress,
      displayName: insertProfile.displayName || null,
      firstName: insertProfile.firstName || null,
      lastName: insertProfile.lastName || null,
      email: insertProfile.email || null,
      phoneNumber: insertProfile.phoneNumber || null,
      companyName: insertProfile.companyName || null,
      jobTitle: insertProfile.jobTitle || null,
      country: insertProfile.country || null,
      city: insertProfile.city || null,
      address: insertProfile.address || null,
      postalCode: insertProfile.postalCode || null,
      dateOfBirth: insertProfile.dateOfBirth || null,
      nationality: insertProfile.nationality || null,
      idType: insertProfile.idType || null,
      idNumber: insertProfile.idNumber || null,
      taxId: insertProfile.taxId || null,
      website: insertProfile.website || null,
      linkedin: insertProfile.linkedin || null,
      twitter: insertProfile.twitter || null,
      bio: insertProfile.bio || null,
      avatar: insertProfile.avatar || null,
      kycStatus: insertProfile.kycStatus || "pending",
      kycDocuments: insertProfile.kycDocuments || null,
      isPublic: insertProfile.isPublic || false,
      createdAt: new Date(),
      lastUpdated: new Date()
    };
    this.profiles.set(profile.walletAddress, profile);
    return profile;
  }

  async updateUserProfile(walletAddress: string, updates: Partial<InsertUserProfile>): Promise<UserProfile | undefined> {
    const profile = this.profiles.get(walletAddress);
    if (profile) {
      Object.assign(profile, { ...updates, lastUpdated: new Date() });
    }
    return profile;
  }

  async deleteUserProfile(walletAddress: string): Promise<boolean> {
    return this.profiles.delete(walletAddress);
  }

  // Referral operations (minimal stubs for MemStorage)
  async createReferralCode(code: InsertReferralCode): Promise<ReferralCode> {
    const newCode: ReferralCode = {
      id: this.currentReferralId++,
      code: code.code,
      referrerWalletAddress: code.referrerWalletAddress,
      description: code.description || "Invite your partners",
      isActive: code.isActive !== undefined ? code.isActive : true,
      maxUses: code.maxUses || null,
      currentUses: 0,
      createdAt: new Date(),
      expiresAt: code.expiresAt || null
    };
    this.referralCodes.set(newCode.code, newCode);
    return newCode;
  }

  async getReferralCode(code: string): Promise<ReferralCode | undefined> {
    return this.referralCodes.get(code);
  }

  async getReferralCodesByWallet(walletAddress: string): Promise<ReferralCode[]> {
    return Array.from(this.referralCodes.values()).filter(c => c.referrerWalletAddress === walletAddress);
  }

  async updateReferralCodeUses(code: string): Promise<ReferralCode | undefined> {
    const referralCode = this.referralCodes.get(code);
    if (referralCode) {
      referralCode.currentUses++;
    }
    return referralCode;
  }

  async createReferral(referral: InsertReferral): Promise<Referral> {
    const newReferral: Referral = {
      id: this.currentReferralId++,
      referralCode: referral.referralCode,
      referrerWalletAddress: referral.referrerWalletAddress,
      referredWalletAddress: referral.referredWalletAddress,
      status: referral.status || "pending",
      pointsEarned: referral.pointsEarned || 50,
      createdAt: new Date(),
      completedAt: null
    };
    this.referrals.set(newReferral.id, newReferral);
    return newReferral;
  }

  async getReferralsByWallet(walletAddress: string): Promise<Referral[]> {
    return Array.from(this.referrals.values()).filter(r => r.referrerWalletAddress === walletAddress);
  }

  async getAllReferrals(): Promise<Referral[]> {
    return Array.from(this.referrals.values());
  }

  async updateReferralStatus(id: number, status: string): Promise<Referral | undefined> {
    const referral = this.referrals.get(id);
    if (referral) {
      referral.status = status;
      referral.completedAt = status === 'completed' ? new Date() : null;
    }
    return referral;
  }

  async getUserPoints(walletAddress: string): Promise<UserPoints | undefined> {
    return this.userPoints.get(walletAddress);
  }

  async getAllUserPoints(): Promise<UserPoints[]> {
    return Array.from(this.userPoints.values());
  }

  async createUserPoints(points: InsertUserPoints): Promise<UserPoints> {
    const newPoints: UserPoints = {
      id: this.currentReferralId++,
      walletAddress: points.walletAddress,
      totalPoints: points.totalPoints || 0,
      referralPoints: points.referralPoints || 0,
      lastUpdated: new Date()
    };
    this.userPoints.set(newPoints.walletAddress, newPoints);
    return newPoints;
  }

  async updateUserPoints(walletAddress: string, points: number): Promise<UserPoints | undefined> {
    const userPoints = this.userPoints.get(walletAddress);
    if (userPoints) {
      userPoints.totalPoints += points;
      userPoints.referralPoints += points;
      userPoints.lastUpdated = new Date();
    }
    return userPoints;
  }

  async createPointTransaction(transaction: InsertPointTransaction): Promise<PointTransaction> {
    const newTransaction: PointTransaction = {
      id: this.currentPointTransactionId++,
      walletAddress: transaction.walletAddress,
      type: transaction.type,
      points: transaction.points,
      description: transaction.description,
      referenceId: transaction.referenceId || null,
      createdAt: new Date()
    };
    this.pointTransactions.set(newTransaction.id, newTransaction);
    return newTransaction;
  }

  async getPointTransactions(walletAddress: string): Promise<PointTransaction[]> {
    return Array.from(this.pointTransactions.values()).filter(t => t.walletAddress === walletAddress);
  }

  // User Role operations
  async getUserRole(walletAddress: string): Promise<UserRole | undefined> {
    return this.userRoles.get(walletAddress);
  }

  async getAllUserRoles(): Promise<UserRole[]> {
    return Array.from(this.userRoles.values());
  }

  async createUserRole(role: InsertUserRole): Promise<UserRole> {
    const newRole: UserRole = {
      id: this.currentUserRoleId++,
      walletAddress: role.walletAddress,
      role: role.role,
      kycStatus: role.kycStatus || 'pending',
      kycDocuments: role.kycDocuments || null,
      lastActivity: new Date(),
      referralSource: role.referralSource || null,
      isActive: role.isActive !== undefined ? role.isActive : true,
      createdAt: new Date()
    };
    this.userRoles.set(newRole.walletAddress, newRole);
    return newRole;
  }

  async updateUserRole(walletAddress: string, updates: Partial<InsertUserRole>): Promise<UserRole | undefined> {
    const userRole = this.userRoles.get(walletAddress);
    if (userRole) {
      Object.assign(userRole, { ...updates, lastActivity: new Date() });
    }
    return userRole;
  }

  // Hedge operations (stubs)
  async createHedgeEvent(event: InsertHedgeEvent): Promise<HedgeEvent> { throw new Error("MemStorage: Hedge not implemented - use DatabaseStorage"); }
  async getHedgeEvent(id: number): Promise<HedgeEvent | undefined> { return undefined; }
  async getAllHedgeEvents(): Promise<HedgeEvent[]> { return []; }
  async getOpenHedgeEvents(): Promise<HedgeEvent[]> { return []; }
  async updateHedgeEvent(id: number, updates: Partial<HedgeEvent>): Promise<HedgeEvent | undefined> { return undefined; }
  async createHedgePosition(position: InsertHedgePosition): Promise<HedgePosition> { throw new Error("MemStorage: Hedge not implemented - use DatabaseStorage"); }
  async getHedgePosition(id: number): Promise<HedgePosition | undefined> { return undefined; }
  async getHedgePositionsByEvent(eventId: number): Promise<HedgePosition[]> { return []; }
  async getHedgePositionsByWallet(wallet: string): Promise<HedgePosition[]> { return []; }
  async updateHedgePosition(id: number, updates: Partial<HedgePosition>): Promise<HedgePosition | undefined> { return undefined; }
  async createHedgeLpDeposit(deposit: InsertHedgeLpDeposit): Promise<HedgeLpDeposit> { throw new Error("MemStorage: Hedge not implemented - use DatabaseStorage"); }
  async getHedgeLpDeposit(id: number): Promise<HedgeLpDeposit | undefined> { return undefined; }
  async getHedgeLpDepositsByEvent(eventId: number): Promise<HedgeLpDeposit[]> { return []; }
  async getHedgeLpDepositsByWallet(wallet: string): Promise<HedgeLpDeposit[]> { return []; }
  async updateHedgeLpDeposit(id: number, updates: Partial<HedgeLpDeposit>): Promise<HedgeLpDeposit | undefined> { return undefined; }

  async getArticles(onlyPublished?: boolean): Promise<Article[]> { return []; }
  async getArticleBySlug(slug: string): Promise<Article | undefined> { return undefined; }
  async getArticle(id: number): Promise<Article | undefined> { return undefined; }
  async createArticle(article: InsertArticle): Promise<Article> { throw new Error("MemStorage: Articles not implemented"); }
  async updateArticle(id: number, updates: Partial<InsertArticle>): Promise<Article | undefined> { return undefined; }
  async deleteArticle(id: number): Promise<boolean> { return false; }

  async saveRateSnapshots(_snapshots: InsertRateSnapshot[]): Promise<void> {}
  async getRateSnapshotBefore(_pair: string, _beforeMs: number): Promise<RateSnapshot | undefined> { return undefined; }
  async pruneOldRateSnapshots(_olderThanMs: number): Promise<void> {}
}

export class DatabaseStorage implements IStorage {
  // ═══════════════════════════════════════════════════════
  // [WALLET] Wallet Management
  // ═══════════════════════════════════════════════════════

  async getWallet(id: number): Promise<Wallet | undefined> {
    const [wallet] = await db.select().from(wallets).where(eq(wallets.id, id));
    return wallet || undefined;
  }

  async getWalletByAddress(address: string): Promise<Wallet | undefined> {
    const [wallet] = await db.select().from(wallets).where(eq(wallets.address, address));
    return wallet || undefined;
  }

  async getAllWallets(): Promise<Wallet[]> {
    return await db.select().from(wallets);
  }

  async createWallet(insertWallet: InsertWallet): Promise<Wallet> {
    const [wallet] = await db
      .insert(wallets)
      .values(insertWallet)
      .returning();
    return wallet;
  }

  async updateWallet(id: number, updates: Partial<InsertWallet>): Promise<Wallet | undefined> {
    const [wallet] = await db
      .update(wallets)
      .set(updates)
      .where(eq(wallets.id, id))
      .returning();
    return wallet || undefined;
  }

  async deleteWallet(id: number): Promise<boolean> {
    const result = await db.delete(wallets).where(eq(wallets.id, id));
    return (result.rowCount ?? 0) > 0;
  }

  // ═══════════════════════════════════════════════════════
  // [NETWORK] Network Management
  // ═══════════════════════════════════════════════════════

  async getNetwork(id: number): Promise<Network | undefined> {
    const [network] = await db.select().from(networks).where(eq(networks.id, id));
    return network || undefined;
  }

  async getNetworkByChainId(chainId: number): Promise<Network | undefined> {
    const [network] = await db.select().from(networks).where(eq(networks.chainId, chainId));
    return network || undefined;
  }

  async getAllNetworks(): Promise<Network[]> {
    return await db.select().from(networks);
  }

  async createNetwork(insertNetwork: InsertNetwork): Promise<Network> {
    const [network] = await db
      .insert(networks)
      .values(insertNetwork)
      .returning();
    return network;
  }

  async updateNetwork(id: number, updates: Partial<InsertNetwork>): Promise<Network | undefined> {
    const [network] = await db
      .update(networks)
      .set(updates)
      .where(eq(networks.id, id))
      .returning();
    return network || undefined;
  }

  // ═══════════════════════════════════════════════════════
  // [TRANSACTION] Transaction Management
  // ═══════════════════════════════════════════════════════

  async getTransaction(id: number): Promise<Transaction | undefined> {
    const [transaction] = await db.select().from(transactions).where(eq(transactions.id, id));
    return transaction || undefined;
  }

  async getTransactionByHash(hash: string): Promise<Transaction | undefined> {
    const [transaction] = await db.select().from(transactions).where(eq(transactions.hash, hash));
    return transaction || undefined;
  }

  async getTransactions(filters: {
    walletId?: number;
    networkId?: number;
    status?: string;
    limit?: number;
  }): Promise<Transaction[]> {
    let query = db.select().from(transactions);
    
    if (filters.walletId) {
      query = query.where(eq(transactions.walletId, filters.walletId)) as any;
    }
    if (filters.networkId) {
      query = query.where(eq(transactions.networkId, filters.networkId)) as any;
    }
    if (filters.status) {
      query = query.where(eq(transactions.status, filters.status)) as any;
    }
    
    query = query.orderBy(desc(transactions.timestamp)) as any;
    
    if (filters.limit) {
      query = query.limit(filters.limit) as any;
    }
    
    return await query;
  }

  async createTransaction(insertTransaction: InsertTransaction): Promise<Transaction> {
    const [transaction] = await db
      .insert(transactions)
      .values(insertTransaction)
      .returning();
    return transaction;
  }

  async updateTransaction(hash: string, updates: Partial<InsertTransaction>): Promise<Transaction | undefined> {
    const [transaction] = await db
      .update(transactions)
      .set(updates)
      .where(eq(transactions.hash, hash))
      .returning();
    return transaction || undefined;
  }

  // ═══════════════════════════════════════════════════════
  // [BALANCE] Balance Management
  // ═══════════════════════════════════════════════════════

  async getBalance(id: number): Promise<Balance | undefined> {
    const [balance] = await db.select().from(balances).where(eq(balances.id, id));
    return balance || undefined;
  }

  async getBalances(filters: {
    walletId?: number;
    networkId?: number;
  }): Promise<Balance[]> {
    let query = db.select().from(balances);
    
    if (filters.walletId) {
      query = query.where(eq(balances.walletId, filters.walletId)) as any;
    }
    if (filters.networkId) {
      query = query.where(eq(balances.networkId, filters.networkId)) as any;
    }
    
    return await query;
  }

  async createBalance(insertBalance: InsertBalance): Promise<Balance> {
    const [balance] = await db
      .insert(balances)
      .values(insertBalance)
      .returning();
    return balance;
  }

  async updateBalance(id: number, updates: Partial<InsertBalance>): Promise<Balance | undefined> {
    const [balance] = await db
      .update(balances)
      .set(updates)
      .where(eq(balances.id, id))
      .returning();
    return balance || undefined;
  }

  // ═══════════════════════════════════════════════════════
  // [PORTFOLIO] Portfolio Stats
  // ═══════════════════════════════════════════════════════

  async getPortfolioStats(walletId: number): Promise<{
    totalValue: number;
    networkBreakdown: Array<{
      networkId: number;
      balance: string;
      usdValue: number;
      percentage: number;
    }>;
    transactionCount: number;
    lastActivity: Date | null;
  }> {
    const walletBalances = await this.getBalances({ walletId });
    const walletTransactions = await this.getTransactions({ walletId });

    const totalValue = walletBalances.reduce((sum, balance) => {
      return sum + (balance.usdValue ? parseFloat(balance.usdValue) : 0);
    }, 0);

    const networkBreakdown = walletBalances.map(balance => {
      const usdValue = balance.usdValue ? parseFloat(balance.usdValue) : 0;
      return {
        networkId: balance.networkId!,
        balance: balance.balance,
        usdValue,
        percentage: totalValue > 0 ? (usdValue / totalValue) * 100 : 0
      };
    });

    const lastActivity = walletTransactions.length > 0 
      ? walletTransactions.reduce((latest, tx) => {
          const txTime = tx.timestamp ? new Date(tx.timestamp) : new Date(0);
          return txTime > latest ? txTime : latest;
        }, new Date(0))
      : null;

    return {
      totalValue,
      networkBreakdown,
      transactionCount: walletTransactions.length,
      lastActivity
    };
  }

  // ═══════════════════════════════════════════════════════
  // [PROFILES] User Profiles
  // ═══════════════════════════════════════════════════════

  async getUserProfile(walletAddress: string): Promise<UserProfile | undefined> {
    const [profile] = await db.select().from(userProfiles).where(eq(userProfiles.walletAddress, walletAddress));
    return profile || undefined;
  }

  async createUserProfile(insertProfile: InsertUserProfile): Promise<UserProfile> {
    const [profile] = await db
      .insert(userProfiles)
      .values(insertProfile)
      .returning();
    return profile;
  }

  async updateUserProfile(walletAddress: string, updates: Partial<InsertUserProfile>): Promise<UserProfile | undefined> {
    const [profile] = await db
      .update(userProfiles)
      .set({ ...updates, lastUpdated: new Date() })
      .where(eq(userProfiles.walletAddress, walletAddress))
      .returning();
    return profile || undefined;
  }

  async deleteUserProfile(walletAddress: string): Promise<boolean> {
    const result = await db
      .delete(userProfiles)
      .where(eq(userProfiles.walletAddress, walletAddress));
    return (result.rowCount || 0) > 0;
  }

  // ═══════════════════════════════════════════════════════
  // [REFERRALS] Referral System
  // ═══════════════════════════════════════════════════════

  async createReferralCode(insertCode: InsertReferralCode): Promise<ReferralCode> {
    const [code] = await db
      .insert(referralCodes)
      .values(insertCode)
      .returning();
    return code;
  }

  async getReferralCode(code: string): Promise<ReferralCode | undefined> {
    const [referralCode] = await db
      .select()
      .from(referralCodes)
      .where(eq(referralCodes.code, code));
    return referralCode;
  }

  async getReferralCodesByWallet(walletAddress: string): Promise<ReferralCode[]> {
    return await db
      .select()
      .from(referralCodes)
      .where(eq(referralCodes.referrerWalletAddress, walletAddress))
      .orderBy(desc(referralCodes.createdAt));
  }

  async updateReferralCodeUses(code: string): Promise<ReferralCode | undefined> {
    const [updated] = await db
      .update(referralCodes)
      .set({ currentUses: sql`${referralCodes.currentUses} + 1` })
      .where(eq(referralCodes.code, code))
      .returning();
    return updated;
  }

  async createReferral(insertReferral: InsertReferral): Promise<Referral> {
    const [referral] = await db
      .insert(referrals)
      .values(insertReferral)
      .returning();
    return referral;
  }

  async getReferralsByWallet(walletAddress: string): Promise<Referral[]> {
    return await db
      .select()
      .from(referrals)
      .where(eq(referrals.referrerWalletAddress, walletAddress))
      .orderBy(desc(referrals.createdAt));
  }

  async getAllReferrals(): Promise<Referral[]> {
    return await db
      .select()
      .from(referrals)
      .orderBy(desc(referrals.createdAt));
  }

  async updateReferralStatus(id: number, status: string): Promise<Referral | undefined> {
    const [updated] = await db
      .update(referrals)
      .set({ 
        status,
        completedAt: status === 'completed' ? new Date() : null
      })
      .where(eq(referrals.id, id))
      .returning();
    return updated;
  }

  async getUserPoints(walletAddress: string): Promise<UserPoints | undefined> {
    const [points] = await db
      .select()
      .from(userPoints)
      .where(eq(userPoints.walletAddress, walletAddress));
    return points;
  }

  async getAllUserPoints(): Promise<UserPoints[]> {
    return await db.select().from(userPoints);
  }

  async createUserPoints(insertPoints: InsertUserPoints): Promise<UserPoints> {
    const [points] = await db
      .insert(userPoints)
      .values({ ...insertPoints, walletAddress: insertPoints.walletAddress.toLowerCase() })
      .returning();
    return points;
  }

  async updateUserPoints(walletAddress: string, points: number): Promise<UserPoints | undefined> {
    const [updated] = await db
      .update(userPoints)
      .set({ 
        totalPoints: sql`${userPoints.totalPoints} + ${points}`,
        referralPoints: sql`${userPoints.referralPoints} + ${points}`,
        lastUpdated: new Date()
      })
      .where(eq(userPoints.walletAddress, walletAddress.toLowerCase()))
      .returning();
    return updated;
  }

  async createPointTransaction(insertTransaction: InsertPointTransaction): Promise<PointTransaction> {
    const [transaction] = await db
      .insert(pointTransactions)
      .values(insertTransaction)
      .returning();
    return transaction;
  }

  async getPointTransactions(walletAddress: string): Promise<PointTransaction[]> {
    return await db
      .select()
      .from(pointTransactions)
      .where(eq(pointTransactions.walletAddress, walletAddress))
      .orderBy(desc(pointTransactions.createdAt));
  }

  async getPointTransactionsByWallet(walletAddress: string): Promise<PointTransaction[]> {
    return this.getPointTransactions(walletAddress);
  }

  // User Role operations
  async getUserRole(walletAddress: string): Promise<UserRole | undefined> {
    const [role] = await db
      .select()
      .from(userRoles)
      .where(eq(userRoles.walletAddress, walletAddress));
    return role;
  }

  async getAllUserRoles(): Promise<UserRole[]> {
    return await db.select().from(userRoles);
  }

  async createUserRole(insertRole: InsertUserRole): Promise<UserRole> {
    const [role] = await db
      .insert(userRoles)
      .values(insertRole)
      .returning();
    return role;
  }

  async updateUserRole(walletAddress: string, updates: Partial<InsertUserRole>): Promise<UserRole | undefined> {
    const [updated] = await db
      .update(userRoles)
      .set({ ...updates, lastActivity: new Date() })
      .where(eq(userRoles.walletAddress, walletAddress))
      .returning();
    return updated;
  }

  // Waitlist operations
  async createWaitlistEntry(entry: InsertWaitlist): Promise<Waitlist> {
    const [created] = await db
      .insert(waitlist)
      .values(entry)
      .returning();
    return created;
  }

  async getWaitlistByEmail(email: string): Promise<Waitlist | undefined> {
    const [entry] = await db
      .select()
      .from(waitlist)
      .where(eq(waitlist.email, email.toLowerCase()));
    return entry;
  }

  async getAllWaitlistEntries(): Promise<Waitlist[]> {
    return await db
      .select()
      .from(waitlist)
      .orderBy(desc(waitlist.createdAt));
  }

  async getWaitlistCount(): Promise<number> {
    const result = await db
      .select()
      .from(waitlist);
    return result.length;
  }

  // ═══════════════════════════════════════════════════════
  // [HEDGE] P2P Trade Hedge
  // ═══════════════════════════════════════════════════════

  async createHedgeEvent(event: InsertHedgeEvent): Promise<HedgeEvent> {
    const [created] = await db.insert(hedgeEvents).values(event).returning();
    return created;
  }

  async getHedgeEvent(id: number): Promise<HedgeEvent | undefined> {
    const [event] = await db.select().from(hedgeEvents).where(eq(hedgeEvents.id, id));
    return event;
  }

  async getAllHedgeEvents(): Promise<HedgeEvent[]> {
    return await db.select().from(hedgeEvents).orderBy(desc(hedgeEvents.createdAt));
  }

  async getOpenHedgeEvents(): Promise<HedgeEvent[]> {
    return await db.select().from(hedgeEvents).where(eq(hedgeEvents.status, "open")).orderBy(desc(hedgeEvents.createdAt));
  }

  async updateHedgeEvent(id: number, updates: Partial<HedgeEvent>): Promise<HedgeEvent | undefined> {
    const [updated] = await db.update(hedgeEvents).set(updates).where(eq(hedgeEvents.id, id)).returning();
    return updated;
  }

  // Hedge Position operations
  async createHedgePosition(position: InsertHedgePosition): Promise<HedgePosition> {
    const [created] = await db.insert(hedgePositions).values(position).returning();
    return created;
  }

  async getHedgePosition(id: number): Promise<HedgePosition | undefined> {
    const [position] = await db.select().from(hedgePositions).where(eq(hedgePositions.id, id));
    return position;
  }

  async getHedgePositionsByEvent(eventId: number): Promise<HedgePosition[]> {
    return await db.select().from(hedgePositions).where(eq(hedgePositions.eventId, eventId)).orderBy(desc(hedgePositions.createdAt));
  }

  async getHedgePositionsByWallet(wallet: string): Promise<HedgePosition[]> {
    return await db.select().from(hedgePositions).where(eq(hedgePositions.hedgerWallet, wallet)).orderBy(desc(hedgePositions.createdAt));
  }

  async updateHedgePosition(id: number, updates: Partial<HedgePosition>): Promise<HedgePosition | undefined> {
    const [updated] = await db.update(hedgePositions).set(updates).where(eq(hedgePositions.id, id)).returning();
    return updated;
  }

  // Hedge LP Deposit operations
  async createHedgeLpDeposit(deposit: InsertHedgeLpDeposit): Promise<HedgeLpDeposit> {
    const [created] = await db.insert(hedgeLpDeposits).values(deposit).returning();
    return created;
  }

  async getHedgeLpDeposit(id: number): Promise<HedgeLpDeposit | undefined> {
    const [deposit] = await db.select().from(hedgeLpDeposits).where(eq(hedgeLpDeposits.id, id));
    return deposit;
  }

  async getHedgeLpDepositsByEvent(eventId: number): Promise<HedgeLpDeposit[]> {
    return await db.select().from(hedgeLpDeposits).where(eq(hedgeLpDeposits.eventId, eventId)).orderBy(desc(hedgeLpDeposits.createdAt));
  }

  async getHedgeLpDepositsByWallet(wallet: string): Promise<HedgeLpDeposit[]> {
    return await db.select().from(hedgeLpDeposits).where(eq(hedgeLpDeposits.lpWallet, wallet)).orderBy(desc(hedgeLpDeposits.createdAt));
  }

  async updateHedgeLpDeposit(id: number, updates: Partial<HedgeLpDeposit>): Promise<HedgeLpDeposit | undefined> {
    const [updated] = await db.update(hedgeLpDeposits).set(updates).where(eq(hedgeLpDeposits.id, id)).returning();
    return updated;
  }

  async getArticles(onlyPublished = false): Promise<Article[]> {
    if (onlyPublished) {
      return await db.select().from(articles).where(eq(articles.isPublished, true)).orderBy(articles.sortOrder, desc(articles.createdAt));
    }
    return await db.select().from(articles).orderBy(articles.sortOrder, desc(articles.createdAt));
  }

  async getArticleBySlug(slug: string): Promise<Article | undefined> {
    const [article] = await db.select().from(articles).where(eq(articles.slug, slug));
    return article;
  }

  async getArticle(id: number): Promise<Article | undefined> {
    const [article] = await db.select().from(articles).where(eq(articles.id, id));
    return article;
  }

  async createArticle(article: InsertArticle): Promise<Article> {
    const [created] = await db.insert(articles).values(article).returning();
    return created;
  }

  async updateArticle(id: number, updates: Partial<InsertArticle>): Promise<Article | undefined> {
    const [updated] = await db.update(articles).set({ ...updates, updatedAt: new Date() }).where(eq(articles.id, id)).returning();
    return updated;
  }

  async deleteArticle(id: number): Promise<boolean> {
    const result = await db.delete(articles).where(eq(articles.id, id));
    return (result.rowCount ?? 0) > 0;
  }

  async saveRateSnapshots(snapshots: InsertRateSnapshot[]): Promise<void> {
    if (snapshots.length === 0) return;
    await db.insert(rateSnapshots).values(snapshots);
  }

  async getRateSnapshotBefore(pair: string, beforeMs: number): Promise<RateSnapshot | undefined> {
    const beforeDate = new Date(beforeMs);
    const [row] = await db
      .select()
      .from(rateSnapshots)
      .where(and(eq(rateSnapshots.pair, pair), lte(rateSnapshots.recordedAt, beforeDate)))
      .orderBy(desc(rateSnapshots.recordedAt))
      .limit(1);
    return row;
  }

  async pruneOldRateSnapshots(olderThanMs: number): Promise<void> {
    const cutoff = new Date(olderThanMs);
    await db.delete(rateSnapshots).where(lt(rateSnapshots.recordedAt, cutoff));
  }
}

export const storage = new DatabaseStorage();
