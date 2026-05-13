/**
 * Database Storage Interface and Implementation
 * 
 * Provides comprehensive CRUD operations for all database entities
 * including wallets, referrals, and user profiles.
 */

import { 
  wallets, 
  networks, 
  userProfiles,
  referralCodes,
  referrals,
  userPoints,
  pointTransactions,
  type Wallet, 
  type InsertWallet,
  type Network,
  type InsertNetwork,
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
  hedgeEvents,
  type HedgeEvent,
  type InsertHedgeEvent,
  hedgePositions,
  type HedgePosition,
  type InsertHedgePosition,
  hedgeLpDeposits,
  type HedgeLpDeposit,
  type InsertHedgeLpDeposit,
  hedgeActivity,
  type HedgeActivity,
  type InsertHedgeActivity,
  dailyTasks,
  userTaskCompletions,
  platformSettings,
  rateSnapshots,
  type RateSnapshot,
  type InsertRateSnapshot,
  dataRoomContent,
  articles,
  type Article,
  type InsertArticle,
} from "@shared/schema";
import { db } from "./db";
import { eq, desc, or, and, sql, lt, lte, gt } from "drizzle-orm";

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

  // Hedge Event operations
  createHedgeEvent(event: InsertHedgeEvent): Promise<HedgeEvent>;
  getHedgeEvent(id: number): Promise<HedgeEvent | undefined>;
  getHedgeEventByChain(chainId: number, onChainEventId: number): Promise<HedgeEvent | undefined>;
  getAllHedgeEvents(): Promise<HedgeEvent[]>;
  getOpenHedgeEvents(): Promise<HedgeEvent[]>;
  updateHedgeEvent(id: number, updates: Partial<HedgeEvent>): Promise<HedgeEvent | undefined>;
  upsertHedgeEventFromChain(chainId: number, onChainEventId: number, event: InsertHedgeEvent): Promise<{ event: HedgeEvent; created: boolean }>;
  setHedgeEventDescription(chainId: number, onChainEventId: number, description: string): Promise<void>;

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

  // Rate Snapshot operations
  saveRateSnapshots(snapshots: InsertRateSnapshot[]): Promise<void>;
  getRateSnapshotBefore(pair: string, beforeMs: number): Promise<RateSnapshot | undefined>;
  pruneOldRateSnapshots(olderThanMs: number): Promise<void>;

  // Data Room Content operations
  getDataRoomContent(docId: string): Promise<Record<string, string>>;
  setDataRoomContent(docId: string, data: Record<string, string>): Promise<void>;

  // Article CMS operations
  getAllArticles(onlyPublished?: boolean): Promise<Article[]>;
  getArticleBySlug(slug: string): Promise<Article | undefined>;
  getArticleById(id: number): Promise<Article | undefined>;
  createArticle(article: InsertArticle): Promise<Article>;
  updateArticle(id: number, updates: Partial<InsertArticle>): Promise<Article | undefined>;
  deleteArticle(id: number): Promise<boolean>;
}

export class MemStorage implements IStorage {
  private wallets: Map<number, Wallet>;
  private networks: Map<number, Network>;
  private profiles: Map<string, UserProfile>;
  private referralCodes: Map<string, ReferralCode>;
  private referrals: Map<number, Referral>;
  private userPoints: Map<string, UserPoints>;
  private pointTransactions: Map<number, PointTransaction>;
  private currentWalletId: number;
  private currentNetworkId: number;
  private currentProfileId: number;
  private currentReferralId: number;
  private currentPointTransactionId: number;

  constructor() {
    this.wallets = new Map();
    this.networks = new Map();
    this.profiles = new Map();
    this.referralCodes = new Map();
    this.referrals = new Map();
    this.userPoints = new Map();
    this.pointTransactions = new Map();
    this.currentWalletId = 1;
    this.currentNetworkId = 1;
    this.currentProfileId = 1;
    this.currentReferralId = 1;
    this.currentPointTransactionId = 1;

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

  // Hedge operations (stubs)
  async createHedgeEvent(event: InsertHedgeEvent): Promise<HedgeEvent> { throw new Error("MemStorage: Hedge not implemented - use DatabaseStorage"); }
  async getHedgeEvent(id: number): Promise<HedgeEvent | undefined> { return undefined; }
  async getHedgeEventByChain(chainId: number, onChainEventId: number): Promise<HedgeEvent | undefined> { return undefined; }
  async getAllHedgeEvents(): Promise<HedgeEvent[]> { return []; }
  async getOpenHedgeEvents(): Promise<HedgeEvent[]> { return []; }
  async updateHedgeEvent(id: number, updates: Partial<HedgeEvent>): Promise<HedgeEvent | undefined> { return undefined; }
  async upsertHedgeEventFromChain(chainId: number, onChainEventId: number, event: InsertHedgeEvent): Promise<{ event: HedgeEvent; created: boolean }> { throw new Error("MemStorage: not implemented"); }
  async setHedgeEventDescription(_chainId: number, _onChainEventId: number, _description: string): Promise<void> { /* no-op in mem storage */ }
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

  async saveRateSnapshots(_snapshots: InsertRateSnapshot[]): Promise<void> {}
  async getRateSnapshotBefore(_pair: string, _beforeMs: number): Promise<RateSnapshot | undefined> { return undefined; }
  async pruneOldRateSnapshots(_olderThanMs: number): Promise<void> {}

  private _dataRoomContent: Map<string, Record<string, string>> = new Map();
  async getDataRoomContent(docId: string): Promise<Record<string, string>> { return this._dataRoomContent.get(docId) || {}; }
  async setDataRoomContent(docId: string, data: Record<string, string>): Promise<void> { this._dataRoomContent.set(docId, data); }
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

  async getHedgeEventByChain(chainId: number, onChainEventId: number): Promise<HedgeEvent | undefined> {
    const [event] = await db.select().from(hedgeEvents)
      .where(and(eq(hedgeEvents.chainId, chainId), eq(hedgeEvents.onChainEventId, onChainEventId)));
    return event;
  }

  async upsertHedgeEventFromChain(chainId: number, onChainEventId: number, event: InsertHedgeEvent): Promise<{ event: HedgeEvent; created: boolean }> {
    const existing = await this.getHedgeEventByChain(chainId, onChainEventId);
    if (existing) {
      const [updated] = await db.update(hedgeEvents)
        .set({ status: event.status, expiryDate: event.expiryDate, poolOpen: event.poolOpen })
        .where(eq(hedgeEvents.id, existing.id))
        .returning();
      return { event: updated, created: false };
    }
    const [created] = await db.insert(hedgeEvents)
      .values({ ...event, chainId, onChainEventId })
      .returning();
    return { event: created, created: true };
  }

  async setHedgeEventDescription(chainId: number, onChainEventId: number, description: string): Promise<void> {
    const existing = await this.getHedgeEventByChain(chainId, onChainEventId);
    if (existing) {
      await db.update(hedgeEvents)
        .set({ description })
        .where(eq(hedgeEvents.id, existing.id));
    } else {
      console.warn(`[setHedgeEventDescription] event ${onChainEventId} on chain ${chainId} not yet synced — description queued for next sync`);
    }
  }

  async getAllHedgeEvents(): Promise<HedgeEvent[]> {
    return await db.select().from(hedgeEvents).orderBy(desc(hedgeEvents.createdAt));
  }

  async getOpenHedgeEvents(): Promise<HedgeEvent[]> {
    // Only return events that:
    //   1. are still 'open' in the DB
    //   2. haven't passed their expiry date (on-chain status may lag)
    //   3. have the pool open — if poolOpen=false nobody can buy, so skip them
    return await db.select().from(hedgeEvents)
      .where(and(
        eq(hedgeEvents.status, "open"),
        eq(hedgeEvents.poolOpen, true),
        gt(hedgeEvents.expiryDate, new Date()),
      ))
      .orderBy(desc(hedgeEvents.createdAt));
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

  async getDataRoomContent(docId: string): Promise<Record<string, string>> {
    const [row] = await db.select().from(dataRoomContent).where(eq(dataRoomContent.docId, docId)).limit(1);
    return (row?.data as Record<string, string>) || {};
  }

  async setDataRoomContent(docId: string, data: Record<string, string>): Promise<void> {
    await db.insert(dataRoomContent).values({ docId, data })
      .onConflictDoUpdate({ target: dataRoomContent.docId, set: { data, updatedAt: new Date() } });
  }

  async getAllArticles(onlyPublished = false): Promise<Article[]> {
    const query = db.select().from(articles).orderBy(desc(articles.publishedAt));
    if (onlyPublished) {
      return query.where(eq(articles.published, true));
    }
    return query;
  }

  async getArticleBySlug(slug: string): Promise<Article | undefined> {
    const [row] = await db.select().from(articles).where(eq(articles.slug, slug)).limit(1);
    return row;
  }

  async getArticleById(id: number): Promise<Article | undefined> {
    const [row] = await db.select().from(articles).where(eq(articles.id, id)).limit(1);
    return row;
  }

  async createArticle(article: InsertArticle): Promise<Article> {
    const [row] = await db.insert(articles).values({ ...article, updatedAt: new Date() }).returning();
    return row;
  }

  async updateArticle(id: number, updates: Partial<InsertArticle>): Promise<Article | undefined> {
    const [row] = await db.update(articles).set({ ...updates, updatedAt: new Date() }).where(eq(articles.id, id)).returning();
    return row;
  }

  async deleteArticle(id: number): Promise<boolean> {
    const result = await db.delete(articles).where(eq(articles.id, id)).returning();
    return result.length > 0;
  }

  // ── Hedge activity feed ─────────────────────────────────────────────────
  // Idempotent: composite unique on (chainId, txHash, actionType) means we
  // can call this from the client without worrying about double-submits
  // (StrictMode, network retries, etc).
  async recordHedgeActivity(activity: InsertHedgeActivity): Promise<HedgeActivity> {
    const [row] = await db
      .insert(hedgeActivity)
      .values({
        ...activity,
        walletAddress: activity.walletAddress.toLowerCase(),
      })
      .onConflictDoNothing({ target: [hedgeActivity.chainId, hedgeActivity.txHash, hedgeActivity.actionType] })
      .returning();
    if (row) return row;
    // If insert was a no-op (already exists), fetch and return the existing row
    const [existing] = await db
      .select()
      .from(hedgeActivity)
      .where(and(
        eq(hedgeActivity.chainId, activity.chainId),
        eq(hedgeActivity.txHash, activity.txHash),
        eq(hedgeActivity.actionType, activity.actionType),
      ));
    return existing;
  }

  async getHedgeActivityByWallet(walletAddress: string, opts: { limit?: number; chainId?: number } = {}): Promise<HedgeActivity[]> {
    const { limit = 50, chainId } = opts;
    const wallet = walletAddress.toLowerCase();
    const where = chainId
      ? and(eq(hedgeActivity.walletAddress, wallet), eq(hedgeActivity.chainId, chainId))
      : eq(hedgeActivity.walletAddress, wallet);
    return await db
      .select()
      .from(hedgeActivity)
      .where(where)
      .orderBy(desc(hedgeActivity.createdAt))
      .limit(limit);
  }

  /**
   * Checks whether a wallet has at least one confirmed `hedge_activity` row of
   * the given action type. Used by the task-claim endpoint to enforce
   * on-chain verifiers (verifier='onchain:buy_protection' etc.) without
   * trusting the client.
   */
  async hasHedgeAction(walletAddress: string, actionType: string): Promise<boolean> {
    const wallet = walletAddress.toLowerCase();
    const rows = await db
      .select({ id: hedgeActivity.id })
      .from(hedgeActivity)
      .where(and(
        eq(hedgeActivity.walletAddress, wallet),
        eq(hedgeActivity.actionType, actionType),
      ))
      .limit(1);
    return rows.length > 0;
  }

  // ── Platform settings (key/value) ───────────────────────────────────────
  async getSetting(key: string): Promise<string | null> {
    const [row] = await db.select().from(platformSettings).where(eq(platformSettings.key, key));
    return row?.value ?? null;
  }

  async setSetting(key: string, value: string, updatedBy: string | null = null): Promise<void> {
    await db
      .insert(platformSettings)
      .values({ key, value, updatedBy })
      .onConflictDoUpdate({
        target: platformSettings.key,
        set: { value, updatedBy, updatedAt: new Date() },
      });
  }

  // ── Task-completion payouts ─────────────────────────────────────────────
  /**
   * Admin queue: returns task completions joined with task metadata, plus a
   * `paid` flag derived from the presence of `paidTxHash`. The admin UI uses
   * this to populate the Payouts table.
   */
  async listTaskCompletions(opts: { status?: 'paid' | 'unpaid' | 'pending' | 'rejected' | 'all'; limit?: number } = {}) {
    const { status = 'unpaid', limit = 100 } = opts;
    const baseQuery = db
      .select({
        completionId: userTaskCompletions.id,
        walletAddress: userTaskCompletions.walletAddress,
        completedAt: userTaskCompletions.completedAt,
        pointsEarned: userTaskCompletions.pointsEarned,
        reviewStatus: userTaskCompletions.reviewStatus,
        evidenceUrl: userTaskCompletions.evidenceUrl,
        evidenceImage: userTaskCompletions.evidenceImage,
        evidenceText: userTaskCompletions.evidenceText,
        reviewedBy: userTaskCompletions.reviewedBy,
        reviewedAt: userTaskCompletions.reviewedAt,
        reviewNotes: userTaskCompletions.reviewNotes,
        paidTxHash: userTaskCompletions.paidTxHash,
        paidAmount: userTaskCompletions.paidAmount,
        paidToken: userTaskCompletions.paidToken,
        paidChainId: userTaskCompletions.paidChainId,
        paidAt: userTaskCompletions.paidAt,
        paidBy: userTaskCompletions.paidBy,
        taskId: dailyTasks.id,
        taskKey: dailyTasks.taskKey,
        taskTitle: dailyTasks.title,
        taskCategory: dailyTasks.category,
        taskVerifier: dailyTasks.verifier,
        taskIsDaily: dailyTasks.isDaily,
      })
      .from(userTaskCompletions)
      .innerJoin(dailyTasks, eq(dailyTasks.id, userTaskCompletions.taskId));

    // Payout filters operate on `paidTxHash`; review filters operate on
    // `reviewStatus`. Mutually exclusive view-modes for the admin queue.
    const filtered =
      status === 'paid'     ? baseQuery.where(sql`${userTaskCompletions.paidTxHash} IS NOT NULL`)
    : status === 'unpaid'   ? baseQuery.where(sql`${userTaskCompletions.paidTxHash} IS NULL AND ${userTaskCompletions.reviewStatus} IN ('auto', 'approved')`)
    : status === 'pending'  ? baseQuery.where(eq(userTaskCompletions.reviewStatus, 'pending'))
    : status === 'rejected' ? baseQuery.where(eq(userTaskCompletions.reviewStatus, 'rejected'))
    : baseQuery;

    return await filtered.orderBy(desc(userTaskCompletions.completedAt)).limit(limit);
  }

  /**
   * Approve a pending submission: flip status to 'approved' and credit the
   * earned points (insert/update userPoints + log a pointTransaction).
   * Idempotent: a no-op if the row is no longer 'pending'.
   */
  async approveTaskSubmission(completionId: number, reviewer: string, notes?: string): Promise<boolean> {
    // Load the row + task in one shot so we know what points to credit
    const [row] = await db
      .select({
        id: userTaskCompletions.id,
        walletAddress: userTaskCompletions.walletAddress,
        pointsEarned: userTaskCompletions.pointsEarned,
        reviewStatus: userTaskCompletions.reviewStatus,
        taskId: userTaskCompletions.taskId,
        taskTitle: dailyTasks.title,
      })
      .from(userTaskCompletions)
      .innerJoin(dailyTasks, eq(dailyTasks.id, userTaskCompletions.taskId))
      .where(eq(userTaskCompletions.id, completionId));

    if (!row || row.reviewStatus !== 'pending') return false;
    const wallet = row.walletAddress.toLowerCase();

    // 1. Flip the row to 'approved' atomically (CAS — refuses if no longer pending)
    const updated = await db
      .update(userTaskCompletions)
      .set({
        reviewStatus: 'approved',
        reviewedBy: reviewer.toLowerCase(),
        reviewedAt: new Date(),
        reviewNotes: notes ?? null,
      })
      .where(and(
        eq(userTaskCompletions.id, completionId),
        eq(userTaskCompletions.reviewStatus, 'pending'),
      ))
      .returning({ id: userTaskCompletions.id });
    if (updated.length === 0) return false;

    // 2. Credit points (insert/update userPoints + log pointTransaction)
    const existing = await db.select().from(userPoints).where(eq(userPoints.walletAddress, wallet));
    if (existing.length === 0) {
      await db.insert(userPoints).values({ walletAddress: wallet, totalPoints: row.pointsEarned, referralPoints: 0 });
    } else {
      await db.update(userPoints)
        .set({ totalPoints: sql`${userPoints.totalPoints} + ${row.pointsEarned}`, lastUpdated: new Date() })
        .where(eq(userPoints.walletAddress, wallet));
    }
    await db.insert(pointTransactions).values({
      walletAddress: wallet,
      type: 'task_reward',
      points: row.pointsEarned,
      description: `Approved: ${row.taskTitle}`,
      referenceId: `task_${row.taskId}`,
    });

    return true;
  }

  async rejectTaskSubmission(completionId: number, reviewer: string, notes?: string): Promise<boolean> {
    const result = await db
      .update(userTaskCompletions)
      .set({
        reviewStatus: 'rejected',
        reviewedBy: reviewer.toLowerCase(),
        reviewedAt: new Date(),
        reviewNotes: notes ?? null,
      })
      .where(and(
        eq(userTaskCompletions.id, completionId),
        eq(userTaskCompletions.reviewStatus, 'pending'),
      ))
      .returning({ id: userTaskCompletions.id });
    return result.length > 0;
  }

  async recordTaskPayout(
    completionId: number,
    payout: { txHash: string; amount: string; token: string; chainId: number; paidBy: string },
  ): Promise<boolean> {
    const result = await db
      .update(userTaskCompletions)
      .set({
        paidTxHash: payout.txHash,
        paidAmount: payout.amount,
        paidToken: payout.token,
        paidChainId: payout.chainId,
        paidBy: payout.paidBy.toLowerCase(),
        paidAt: new Date(),
      })
      .where(and(
        eq(userTaskCompletions.id, completionId),
        sql`${userTaskCompletions.paidTxHash} IS NULL`,  // idempotency — never overwrite
      ))
      .returning({
        id: userTaskCompletions.id,
        walletAddress: userTaskCompletions.walletAddress,
        pointsEarned: userTaskCompletions.pointsEarned,
        taskId: userTaskCompletions.taskId,
      });
    if (result.length === 0) return false;

    // After the row is paid, surface the event in the two user-facing feeds:
    //   1. point_transactions  → renders on the Earn page History tab
    //   2. hedge_activity      → renders on the wallet Activity tab + home page
    // Both are best-effort — payout itself already succeeded on-chain; if the
    // log fails the user can still see the points balance + tx in the explorer.
    const row = result[0];
    const userWallet = row.walletAddress.toLowerCase();
    const [task] = await db.select().from(dailyTasks).where(eq(dailyTasks.id, row.taskId));
    const amountNum = parseFloat(payout.amount);

    try {
      await db.insert(pointTransactions).values({
        walletAddress: userWallet,
        type: 'task_payout',
        // Mirror the points cashed out so the history row carries enough context
        // to show "100 pts → $5.00". We don't debit totalPoints; admins treat
        // points as lifetime-earned and pay against unpaid completions.
        points: row.pointsEarned,
        description: `Reward: ${task?.title ?? 'task payout'} → $${amountNum.toFixed(2)} ${payout.token}`,
        referenceId: payout.txHash,
      });
    } catch (e) {
      console.warn('[recordTaskPayout] point_transactions log failed:', e);
    }

    try {
      await db.insert(hedgeActivity).values({
        walletAddress: userWallet,
        chainId: payout.chainId,
        txHash: payout.txHash,
        actionType: 'reward_payout',
        amount: payout.amount,
        token: payout.token,
        metadata: JSON.stringify({
          taskId: row.taskId,
          taskTitle: task?.title ?? null,
          points: row.pointsEarned,
          paidBy: payout.paidBy.toLowerCase(),
        }),
        status: 'confirmed',
      }).onConflictDoNothing();
    } catch (e) {
      console.warn('[recordTaskPayout] hedge_activity log failed:', e);
    }

    return true;
  }
}

export const storage = new DatabaseStorage();
