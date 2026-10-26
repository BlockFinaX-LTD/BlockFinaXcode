/**
 * A customer reading and changing their own notification settings.
 *
 * requireUser resolves the caller from their session, so the wallet address the
 * preferences are stored under comes from a verified session and never from
 * the request body. Accepting an address from the client would let anyone
 * silence anyone else's email.
 */

import type { Express, Request, Response } from "express";
import { z } from "zod";
import { requireUser } from "../middleware/session-auth";
import { getPrefs, setPrefs } from "../notifications/prefs";
import { DEFAULT_PREFS, NOTIFICATION_CATEGORIES } from "@shared/notification-schema";

const bodySchema = z.object({
  transactions: z.boolean().optional(),
  cover: z.boolean().optional(),
  product: z.boolean().optional(),
});

export function registerNotificationRoutes(app: Express) {
  app.get("/api/notifications/prefs", requireUser, async (req: Request, res: Response) => {
    const address = req.sessionUser!.address;
    const row = await getPrefs(address);
    res.json({
      categories: NOTIFICATION_CATEGORIES,
      prefs: row
        ? { transactions: row.transactions, cover: row.cover, product: row.product }
        : DEFAULT_PREFS,
    });
  });

  app.put("/api/notifications/prefs", requireUser, async (req: Request, res: Response) => {
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid settings" });
    try {
      const row = await setPrefs(req.sessionUser!.address, parsed.data);
      res.json({
        prefs: row
          ? { transactions: row.transactions, cover: row.cover, product: row.product }
          : DEFAULT_PREFS,
      });
    } catch (err: any) {
      console.error("[notifications] save failed:", err?.message);
      res.status(500).json({ message: "Couldn't save that. Please try again." });
    }
  });
}
