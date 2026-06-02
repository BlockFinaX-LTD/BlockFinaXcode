import type { Express } from "express";
import { timingSafeEqual, randomBytes } from "crypto";
import multer from "multer";
import path from "path";
import fs from "fs";
import { storage } from "../storage";

const investorSessions = new Map<string, number>();
const investorEditSessions = new Set<string>();
const investorLoginAttempts = new Map<string, { count: number; resetAt: number }>();
const EDIT_ACCESS_CODE = process.env.EDIT_ACCESS_CODE || "";

function generateInvestorToken(): string {
  return randomBytes(32).toString("hex");
}

/**
 * Mint an investor session and store it. Used by other routes (e.g. the
 * docs-gate shared-key bypass) to grant admins data-room access without
 * forcing them to retype the investor password.
 */
export function mintInvestorSession(opts: { editEnabled?: boolean; ttlMs?: number } = {}): {
  token: string;
  expiresAt: number;
} {
  const token = generateInvestorToken();
  // 60 days by default. Investor sessions are in-memory so they get wiped on
  // server restart, but the gate auto-mints fresh ones on every docs-token
  // verify — so the user never sees the password screen on a return visit.
  const expiry = Date.now() + (opts.ttlMs ?? 60 * 24 * 60 * 60_000);
  investorSessions.set(token, expiry);
  if (opts.editEnabled) investorEditSessions.add(token);
  return { token, expiresAt: expiry };
}

function safeEqual(a: string, b: string): boolean {
  if (!a || !b) return false;
  try {
    const aBuf = Buffer.from(a, "utf8");
    const bBuf = Buffer.from(b, "utf8");
    if (aBuf.length !== bBuf.length) return false;
    return timingSafeEqual(aBuf, bBuf);
  } catch {
    return false;
  }
}

setInterval(() => {
  const now = Date.now();
  for (const [token, expiry] of investorSessions.entries()) {
    if (now > expiry) investorSessions.delete(token);
  }
}, 3600_000);

const UPLOAD_DIR = path.join(process.cwd(), "server", "uploads", "compliance");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const complianceStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
    cb(null, `${Date.now()}_${safe}`);
  },
});

const complianceUpload = multer({
  storage: complianceStorage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = [
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-powerpoint",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "text/plain",
    ];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error("Only PDF, Word, Excel, PowerPoint, and text files are allowed"));
  },
});

export function registerInvestorRoutes(app: Express) {
  app.post("/api/investor/auth", (req, res) => {
    const ip = req.ip || "unknown";
    const now = Date.now();

    const attempts = investorLoginAttempts.get(ip);
    if (attempts) {
      if (now < attempts.resetAt && attempts.count >= 5) {
        return res.status(429).json({ message: "Too many attempts. Try again in 15 minutes." });
      }
      if (now >= attempts.resetAt) investorLoginAttempts.delete(ip);
    }

    const { password } = req.body;
    const investorPassword = process.env.INVESTOR_PASSWORD || process.env.ADMIN_PASSWORD;
    const isEditCode = safeEqual(password, EDIT_ACCESS_CODE);
    const isInvestorCode = investorPassword ? safeEqual(password, investorPassword) : false;

    if (!isEditCode && !isInvestorCode) {
      const current = investorLoginAttempts.get(ip) || { count: 0, resetAt: now + 15 * 60_000 };
      investorLoginAttempts.set(ip, { count: current.count + 1, resetAt: current.resetAt });
      return res.status(401).json({ message: "Invalid access code" });
    }

    investorLoginAttempts.delete(ip);
    const token = generateInvestorToken();
    const expiry = now + 24 * 60 * 60_000;
    investorSessions.set(token, expiry);
    if (isEditCode) investorEditSessions.add(token);

    res.json({ token, expiresAt: expiry, editEnabled: isEditCode });
  });

  app.get("/api/investor/verify", (req, res) => {
    const token = req.headers["x-investor-token"] as string;
    if (!token) return res.status(401).json({ valid: false });
    const expiry = investorSessions.get(token);
    if (!expiry || Date.now() > expiry) {
      investorSessions.delete(token);
      investorEditSessions.delete(token);
      return res.status(401).json({ valid: false });
    }
    res.json({ valid: true, editEnabled: investorEditSessions.has(token) });
  });

  app.post("/api/investor/unlock-edit", (req, res) => {
    const token = req.headers["x-investor-token"] as string;
    const expiry = investorSessions.get(token);
    if (!expiry || Date.now() > expiry) return res.status(401).json({ success: false, message: "Session expired" });
    const { password } = req.body;
    if (!safeEqual(password, EDIT_ACCESS_CODE)) return res.status(403).json({ success: false, message: "Incorrect edit password" });
    investorEditSessions.add(token);
    res.json({ success: true });
  });

  app.post("/api/verify-edit-code", (req, res) => {
    const { password } = req.body;
    if (!safeEqual(password, EDIT_ACCESS_CODE)) return res.status(403).json({ success: false });
    res.json({ success: true });
  });

  app.post("/api/investor/logout", (req, res) => {
    const token = req.headers["x-investor-token"] as string;
    if (token) { investorSessions.delete(token); investorEditSessions.delete(token); }
    res.json({ success: true });
  });

  app.get("/api/investor/content/:docId", async (req, res) => {
    const token = req.headers["x-investor-token"] as string;
    const expiry = investorSessions.get(token);
    if (!expiry || Date.now() > expiry) { investorSessions.delete(token); return res.status(401).json({ error: "Unauthorized" }); }
    const data = await storage.getDataRoomContent(req.params.docId);
    res.json(data);
  });

  app.post("/api/investor/content/:docId", async (req, res) => {
    const token = req.headers["x-investor-token"] as string;
    const expiry = investorSessions.get(token);
    if (!expiry || Date.now() > expiry) { investorSessions.delete(token); return res.status(401).json({ error: "Unauthorized" }); }
    if (!investorEditSessions.has(token)) return res.status(403).json({ error: "Edit access required" });
    if (typeof req.body !== "object" || Array.isArray(req.body)) return res.status(400).json({ error: "Invalid data" });
    await storage.setDataRoomContent(req.params.docId, req.body as Record<string, string>);
    res.json({ ok: true });
  });

  app.post("/api/investor/upload", (req, res) => {
    const token = req.headers["x-investor-token"] as string;
    const expiry = investorSessions.get(token);
    if (!expiry || Date.now() > expiry) { investorSessions.delete(token); return res.status(401).json({ error: "Unauthorized" }); }
    if (!investorEditSessions.has(token)) return res.status(403).json({ error: "Edit access required" });

    complianceUpload.single("file")(req, res, (err) => {
      if (err) return res.status(400).json({ error: err.message });
      if (!req.file) return res.status(400).json({ error: "No file provided" });
      res.json({
        filename: req.file.filename,
        originalName: req.file.originalname,
        size: req.file.size,
        mimeType: req.file.mimetype,
        url: `/api/investor/files/${encodeURIComponent(req.file.filename)}`,
      });
    });
  });

  app.get("/api/investor/files/:filename", (req, res) => {
    const token = req.headers["x-investor-token"] as string;
    const expiry = investorSessions.get(token);
    if (!expiry || Date.now() > expiry) { investorSessions.delete(token); return res.status(401).json({ error: "Unauthorized" }); }

    const raw = path.basename(decodeURIComponent(req.params.filename));
    if (!/^[\w.\-]+$/.test(raw)) return res.status(400).json({ error: "Invalid filename" });
    const filepath = path.resolve(UPLOAD_DIR, raw);
    const resolvedBase = path.resolve(UPLOAD_DIR);
    if (!filepath.startsWith(resolvedBase + path.sep) && filepath !== resolvedBase) return res.status(400).json({ error: "Invalid path" });
    if (!fs.existsSync(filepath)) return res.status(404).json({ error: "File not found" });
    res.download(filepath, raw.replace(/^\d+_/, ""));
  });

  app.delete("/api/investor/files/:filename", (req, res) => {
    const token = req.headers["x-investor-token"] as string;
    const expiry = investorSessions.get(token);
    if (!expiry || Date.now() > expiry) { investorSessions.delete(token); return res.status(401).json({ error: "Unauthorized" }); }
    if (!investorEditSessions.has(token)) return res.status(403).json({ error: "Edit access required" });

    const raw = path.basename(decodeURIComponent(req.params.filename));
    if (!/^[\w.\-]+$/.test(raw)) return res.status(400).json({ error: "Invalid filename" });
    const filepath = path.resolve(UPLOAD_DIR, raw);
    const resolvedBase = path.resolve(UPLOAD_DIR);
    if (!filepath.startsWith(resolvedBase + path.sep) && filepath !== resolvedBase) return res.status(400).json({ error: "Invalid path" });
    if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
    res.json({ ok: true });
  });
}
