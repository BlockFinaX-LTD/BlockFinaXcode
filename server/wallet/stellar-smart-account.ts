/**
 * Stellar passkey smart accounts (moved from the Stellar wallet server, Architecture v2.0
 * stage 8). The account is Stellar's open-source Passkey Kit wallet, pinned by WASM hash;
 * the user's passkey is its persistent signer. The platform fee payer pays deployment.
 */
import { Keypair, hash } from "@stellar/stellar-sdk";
import { Api, Server } from "@stellar/stellar-sdk/rpc";
import { Client } from "passkey-kit-sdk";

export const PASSKEY_WALLET_WASM =
  process.env.WALLET_WASM_HASH || "fdefad64b96837147e1c333e51f537b696eab925e9f147e63d597c04e3c903f0";

/** The most the fee payer spends on one deployment (30 XLM, as in the Stellar wallet). */
const MAX_DEPLOY_FEE_STROOPS = BigInt(300_000_000);

export async function deployStellarSmartAccount(input: {
  rpcUrl: string;
  networkPassphrase: string;
  feePayerSecret: string;
  credentialId: string;
  publicKey: Uint8Array;
}): Promise<{ contract: string; hash: string }> {
  const payer = Keypair.fromSecret(input.feePayerSecret);
  const server = new Server(input.rpcUrl);
  const tx = await Client.deploy(
    {
      signer: {
        tag: "Secp256r1",
        values: [
          Buffer.from(input.credentialId, "base64url"),
          Buffer.from(input.publicKey),
          [undefined],
          [undefined],
          { tag: "Persistent", values: undefined },
        ],
      },
    } as any,
    {
      rpcUrl: input.rpcUrl,
      wasmHash: PASSKEY_WALLET_WASM,
      networkPassphrase: input.networkPassphrase,
      publicKey: payer.publicKey(),
      salt: hash(Buffer.from(input.credentialId, "base64url")),
      timeoutInSeconds: 60,
    },
  );
  if (!tx.built) throw new Error("Stellar wallet deployment was not assembled");
  if (BigInt(tx.built.fee) > MAX_DEPLOY_FEE_STROOPS) throw new Error("Stellar deployment fee is above the sponsorship cap");
  tx.built.sign(payer);
  const sent = await server.sendTransaction(tx.built);
  if (sent.status === "ERROR") throw new Error("Stellar rejected the wallet deployment");
  for (let i = 0; i < 30; i++) {
    const found = await server.getTransaction(sent.hash);
    if (found.status === Api.GetTransactionStatus.SUCCESS) return { contract: tx.result.options.contractId, hash: sent.hash };
    if (found.status === Api.GetTransactionStatus.FAILED) throw new Error("Stellar wallet deployment failed");
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`Stellar wallet deployment is still pending: ${sent.hash}`);
}

