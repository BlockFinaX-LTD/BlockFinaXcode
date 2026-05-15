/**
 * POST /v1/tx/broadcast — relay a pre-signed raw transaction.
 *
 * Caller signs locally (with their own wallet) and we just forward the
 * bytes to the chain's RPC. We never sign anything here — this is purely
 * a convenience for integrators who'd rather not run an RPC connection
 * of their own.
 */

import { Router } from "express";
import { z } from "zod";
import { providerFor } from "../lib/chains";
import { ok } from "../lib/respond";
import { asyncHandler, errors } from "../lib/errors";
import { validate } from "../lib/validate";
import { openapi, standardErrorResponses } from "../lib/openapi";

const router = Router();

const BroadcastBody = z.object({
  chainId: z.number().int(),
  signedTx: z.string().regex(/^0x[a-fA-F0-9]+$/, "must be a 0x-prefixed hex string"),
}).openapi("BroadcastBody");

router.post("/broadcast", validate({ body: BroadcastBody }),
  asyncHandler(async (req, res) => {
    const { chainId, signedTx } = req.body as z.infer<typeof BroadcastBody>;
    try {
      const provider = providerFor(chainId);
      const txResponse = await provider.broadcastTransaction(signedTx);
      ok(res, {
        chainId,
        txHash: txResponse.hash,
        from: txResponse.from,
        to: txResponse.to,
        nonce: txResponse.nonce,
        gasLimit: txResponse.gasLimit?.toString() ?? null,
      });
    } catch (e: any) {
      // Common cases: "nonce too low", "insufficient funds", "replacement underpriced"
      throw errors.upstream(`RPC rejected the transaction: ${e?.shortMessage || e?.message || "unknown error"}`);
    }
  }),
);

openapi.registerPath({
  method: "post", path: "/tx/broadcast", tags: ["Tx · Broadcast"],
  summary: "Relay a signed raw transaction to the chain RPC",
  description: "Optional convenience. The server never signs — you sign locally with your own wallet, then POST the bytes here for relay.",
  request: { body: { content: { "application/json": { schema: BroadcastBody } } } },
  responses: {
    200: { description: "Transaction broadcast", content: { "application/json": { schema: z.object({ data: z.any() }) } } },
    ...standardErrorResponses,
  },
});

export default router;
