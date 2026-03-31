/**
 * KYC Provider Abstraction Layer
 *
 * Swap providers by setting environment variables — no code changes needed:
 *
 *   KYC_PROVIDER=manual     Local, admin-reviewed flow (default)
 *   KYC_PROVIDER=sumsub     Sumsub — widely used in Africa/MENA
 *   KYC_PROVIDER=onfido     Onfido — strong document + face match
 *   KYC_PROVIDER=didit      Didit.me — blockchain-native KYC
 *
 * Required env vars per provider:
 *   manual   — none
 *   sumsub   — KYC_API_KEY, KYC_API_SECRET, KYC_WEBHOOK_SECRET, KYC_SUMSUB_LEVEL_NAME
 *   onfido   — KYC_API_KEY, KYC_WEBHOOK_SECRET
 *   didit    — KYC_API_KEY, KYC_API_SECRET, KYC_WEBHOOK_SECRET
 */

import { createHmac, timingSafeEqual } from "crypto";

// ─── Shared types ─────────────────────────────────────────────────────────────

export type KycStatus = "not_started" | "pending" | "approved" | "rejected";

export interface KycUserInfo {
  walletAddress: string;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  dateOfBirth?: string | null;
  country?: string | null;
  nationality?: string | null;
}

export interface KycSessionResult {
  ref: string;
  redirectUrl?: string;
  sdkToken?: string;
  expiresAt?: Date;
}

export interface KycWebhookResult {
  status: KycStatus;
  tier: number;
  providerRef?: string;
  notes?: string;
  rawData?: any;
}

export interface KycProvider {
  readonly name: string;
  createSession(user: KycUserInfo): Promise<KycSessionResult>;
  verifyWebhook(rawBody: string, signature: string): boolean;
  parseWebhook(payload: any): KycWebhookResult;
  getApplicantStatus?(ref: string): Promise<KycWebhookResult>;
}

// ─── Manual Provider (default — admin reviews via dashboard) ──────────────────

class ManualKycProvider implements KycProvider {
  readonly name = "manual";

  async createSession(user: KycUserInfo): Promise<KycSessionResult> {
    return {
      ref: `manual_${user.walletAddress}_${Date.now()}`,
    };
  }

  verifyWebhook(_rawBody: string, _signature: string): boolean {
    return false;
  }

  parseWebhook(_payload: any): KycWebhookResult {
    return { status: "pending", tier: 0 };
  }
}

// ─── Sumsub Provider ──────────────────────────────────────────────────────────
// Docs: https://developers.sumsub.com/api-reference/
// Flow: createApplicant → generateToken → embed SDK → receive webhook

class SumsubKycProvider implements KycProvider {
  readonly name = "sumsub";
  private readonly baseUrl = "https://api.sumsub.com";
  private readonly appToken: string;
  private readonly secretKey: string;
  private readonly webhookSecret: string;
  private readonly levelName: string;

  constructor() {
    this.appToken = process.env.KYC_API_KEY || "";
    this.secretKey = process.env.KYC_API_SECRET || "";
    this.webhookSecret = process.env.KYC_WEBHOOK_SECRET || "";
    this.levelName = process.env.KYC_SUMSUB_LEVEL_NAME || "basic-kyc-level";
  }

  private sign(ts: number, method: string, url: string, body?: string): string {
    const msg = `${ts}${method.toUpperCase()}${url}${body || ""}`;
    return createHmac("sha256", this.secretKey).update(msg).digest("hex");
  }

  private async request<T>(method: string, path: string, body?: any): Promise<T> {
    const ts = Math.floor(Date.now() / 1000);
    const bodyStr = body ? JSON.stringify(body) : undefined;
    const sig = this.sign(ts, method, path, bodyStr);

    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        "X-App-Token": this.appToken,
        "X-App-Access-Ts": String(ts),
        "X-App-Access-Sig": sig,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: bodyStr,
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Sumsub API error ${res.status}: ${err}`);
    }
    return res.json() as Promise<T>;
  }

  async createSession(user: KycUserInfo): Promise<KycSessionResult> {
    const externalId = user.walletAddress;

    // 1. Create applicant (idempotent by externalUserId)
    const applicant = await this.request<{ id: string }>(
      "POST",
      `/resources/applicants?levelName=${encodeURIComponent(this.levelName)}`,
      {
        externalUserId: externalId,
        email: user.email || undefined,
        fixedInfo: {
          firstName: user.firstName || undefined,
          lastName: user.lastName || undefined,
          dob: user.dateOfBirth || undefined,
          country: user.country || undefined,
          nationality: user.nationality || undefined,
        },
      }
    );

    // 2. Generate SDK access token (valid ~1h)
    const tokenRes = await this.request<{ token: string; userId: string }>(
      "POST",
      `/resources/accessTokens?userId=${encodeURIComponent(externalId)}&levelName=${encodeURIComponent(this.levelName)}`
    );

    const expiresAt = new Date(Date.now() + 55 * 60 * 1000);
    return { ref: applicant.id, sdkToken: tokenRes.token, expiresAt };
  }

  verifyWebhook(rawBody: string, signature: string): boolean {
    if (!this.webhookSecret) return false;
    const expected = createHmac("sha256", this.webhookSecret)
      .update(rawBody, "utf8")
      .digest("hex");
    try {
      return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(signature, "hex"));
    } catch {
      return false;
    }
  }

  parseWebhook(payload: any): KycWebhookResult {
    const reviewStatus: string = payload?.reviewResult?.reviewAnswer || "";
    const rejectLabels: string[] = payload?.reviewResult?.rejectLabels || [];

    let status: KycStatus = "pending";
    if (reviewStatus === "GREEN") status = "approved";
    else if (reviewStatus === "RED") status = "rejected";

    const notes = rejectLabels.length > 0 ? `Reject reasons: ${rejectLabels.join(", ")}` : undefined;
    const tier = status === "approved" ? 2 : 0;

    return { status, tier, providerRef: payload?.applicantId, notes, rawData: payload };
  }

  async getApplicantStatus(ref: string): Promise<KycWebhookResult> {
    const data = await this.request<any>("GET", `/resources/applicants/${ref}/requiredIdDocsStatus`);
    return this.parseWebhook(data);
  }
}

// ─── Onfido Provider ──────────────────────────────────────────────────────────
// Docs: https://documentation.onfido.com/
// Flow: createApplicant → createWorkflowRun or SDK token → receive webhook

class OnfidoKycProvider implements KycProvider {
  readonly name = "onfido";
  private readonly baseUrl = "https://api.eu.onfido.com/v3.6";
  private readonly apiToken: string;
  private readonly webhookSecret: string;

  constructor() {
    this.apiToken = process.env.KYC_API_KEY || "";
    this.webhookSecret = process.env.KYC_WEBHOOK_SECRET || "";
  }

  private async request<T>(method: string, path: string, body?: any): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Token token=${this.apiToken}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Onfido API error ${res.status}: ${err}`);
    }
    return res.json() as Promise<T>;
  }

  async createSession(user: KycUserInfo): Promise<KycSessionResult> {
    // 1. Create applicant
    const applicant = await this.request<{ id: string }>("POST", "/applicants", {
      first_name: user.firstName || "Unknown",
      last_name: user.lastName || "User",
      email: user.email || undefined,
      dob: user.dateOfBirth || undefined,
      nationality: user.nationality || undefined,
      address: { country: user.country || undefined },
    });

    // 2. Generate SDK token
    const tokenRes = await this.request<{ token: string }>("POST", "/sdk_token", {
      applicant_id: applicant.id,
      referrer: process.env.APP_URL ? `${process.env.APP_URL}/*` : "*",
    });

    return { ref: applicant.id, sdkToken: tokenRes.token, expiresAt: new Date(Date.now() + 90 * 60 * 1000) };
  }

  verifyWebhook(rawBody: string, signature: string): boolean {
    if (!this.webhookSecret) return false;
    const expected = createHmac("sha256", this.webhookSecret)
      .update(rawBody, "utf8")
      .digest("hex");
    try {
      return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(signature, "hex"));
    } catch {
      return false;
    }
  }

  parseWebhook(payload: any): KycWebhookResult {
    const result: string = payload?.payload?.object?.result || "";
    const subResult: string = payload?.payload?.object?.sub_result || "";

    let status: KycStatus = "pending";
    if (result === "clear") status = "approved";
    else if (result === "consider" || result === "unidentified") status = "rejected";

    const notes = subResult ? `Sub-result: ${subResult}` : undefined;
    const tier = status === "approved" ? 2 : 0;
    return { status, tier, providerRef: payload?.payload?.object?.applicant_id, notes, rawData: payload };
  }
}

// ─── Didit Provider ───────────────────────────────────────────────────────────
// Docs: https://docs.didit.me/
// Blockchain-native KYC — strong fit for Web3 products

class DiditKycProvider implements KycProvider {
  readonly name = "didit";
  private readonly baseUrl = "https://apx.didit.me";
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly webhookSecret: string;

  constructor() {
    this.clientId = process.env.KYC_API_KEY || "";
    this.clientSecret = process.env.KYC_API_SECRET || "";
    this.webhookSecret = process.env.KYC_WEBHOOK_SECRET || "";
  }

  private async getAccessToken(): Promise<string> {
    const res = await fetch(`${this.baseUrl}/auth/v2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: this.clientId,
        client_secret: this.clientSecret,
      }),
    });
    if (!res.ok) throw new Error(`Didit auth failed: ${await res.text()}`);
    const data = await res.json() as { access_token: string };
    return data.access_token;
  }

  async createSession(user: KycUserInfo): Promise<KycSessionResult> {
    const token = await this.getAccessToken();
    const res = await fetch(`${this.baseUrl}/v2/session/`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        vendor_data: user.walletAddress,
        callback: process.env.APP_URL ? `${process.env.APP_URL}/kyc/callback` : undefined,
        features: "OCR + FACE",
      }),
    });
    if (!res.ok) throw new Error(`Didit session failed: ${await res.text()}`);
    const data = await res.json() as { session_id: string; url: string; expires_at: string };
    return {
      ref: data.session_id,
      redirectUrl: data.url,
      expiresAt: new Date(data.expires_at),
    };
  }

  verifyWebhook(rawBody: string, signature: string): boolean {
    if (!this.webhookSecret) return false;
    const expected = createHmac("sha256", this.webhookSecret)
      .update(rawBody, "utf8")
      .digest("hex");
    try {
      return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(signature, "hex"));
    } catch {
      return false;
    }
  }

  parseWebhook(payload: any): KycWebhookResult {
    const decision: string = payload?.decision || "";
    let status: KycStatus = "pending";
    if (decision === "APPROVED") status = "approved";
    else if (decision === "DECLINED") status = "rejected";
    const tier = status === "approved" ? 2 : 0;
    return { status, tier, providerRef: payload?.session_id, rawData: payload };
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

let _provider: KycProvider | null = null;

export function getKycProvider(): KycProvider {
  if (_provider) return _provider;
  const name = (process.env.KYC_PROVIDER || "manual").toLowerCase();
  switch (name) {
    case "sumsub": _provider = new SumsubKycProvider(); break;
    case "onfido": _provider = new OnfidoKycProvider(); break;
    case "didit":  _provider = new DiditKycProvider();  break;
    default:       _provider = new ManualKycProvider(); break;
  }
  console.log(`[KYC] Provider: ${_provider.name}`);
  return _provider;
}
