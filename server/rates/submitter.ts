/**
 * Oracle node submission: puts locked official values on chain (oracle architecture section 7).
 *
 * Only values past their revision cutoff are submitted, so a fixing never forms on a number
 * the administrator may still correct. Each node signs with its own key and submits the
 * identity (benchmark, observation day) with the value; the contract forms the fixing once
 * the quorum matches exactly.
 *
 * Testnet runs both nodes in this one server, so they are not independent: production needs
 * separate operators running the same adapters against the official source.
 *
 * Env: STELLAR_RATE_ORACLE_CONTRACT, RATE_ORACLE_NODE_SECRETS (comma-separated S... keys).
 */
import { BASE_FEE, Keypair, Operation, TransactionBuilder, nativeToScVal, rpc, scValToNative, xdr } from "@stellar/stellar-sdk";
import { getBenchmark, type BenchmarkId } from "@shared/rates/benchmarks";
import { addDays, localParts } from "./calendar";
import type { RateRepository } from "./service";
import { epochDay, isLocked } from "./validate";

const TESTNET_RPC = "https://soroban-testnet.stellar.org";
const TESTNET_PASSPHRASE = "Test SDF Network ; September 2015";
/** Must not exceed the contract's per-benchmark max_age_days (30). */
const LOOKBACK_DAYS = 25;

export interface SubmitterConfig {
  contractId: string;
  nodes: Keypair[];
  rpcUrl?: string;
  networkPassphrase?: string;
}

export function submitterConfigFromEnv(): SubmitterConfig | null {
  const contractId = process.env.STELLAR_RATE_ORACLE_CONTRACT;
  const secrets = (process.env.RATE_ORACLE_NODE_SECRETS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!contractId || secrets.length === 0) return null;
  return { contractId, nodes: secrets.map((s) => Keypair.fromSecret(s)) };
}

interface ChainFixing { rate_micro_percent: bigint; round: number; status: number }

export class RateOracleSubmitter {
  private readonly server: rpc.Server;
  private readonly passphrase: string;

  constructor(private readonly cfg: SubmitterConfig) {
    this.server = new rpc.Server(cfg.rpcUrl ?? TESTNET_RPC);
    this.passphrase = cfg.networkPassphrase ?? TESTNET_PASSPHRASE;
  }

  private async invoke(source: Keypair, method: string, args: xdr.ScVal[], send: boolean): Promise<{ value: unknown; hash?: string }> {
    const account = await this.server.getAccount(source.publicKey());
    const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: this.passphrase })
      .addOperation(Operation.invokeContractFunction({ contract: this.cfg.contractId, function: method, args }))
      .setTimeout(60)
      .build();
    const sim = await this.server.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(sim)) throw new Error(`${method} simulation failed: ${sim.error}`);
    const simValue = sim.result?.retval ? scValToNative(sim.result.retval) : undefined;
    if (!send) return { value: simValue };

    const prepared = rpc.assembleTransaction(tx, sim).build();
    prepared.sign(source);
    const sent = await this.server.sendTransaction(prepared);
    if (sent.status === "ERROR") throw new Error(`${method} rejected: ${sent.errorResult?.result().switch().name ?? "unknown"}`);
    for (let i = 0; i < 30; i++) {
      const r = await this.server.getTransaction(sent.hash);
      if (r.status === rpc.Api.GetTransactionStatus.SUCCESS) {
        return { value: r.returnValue ? scValToNative(r.returnValue) : undefined, hash: sent.hash };
      }
      if (r.status === rpc.Api.GetTransactionStatus.FAILED) throw new Error(`${method} failed on chain (${sent.hash})`);
      await new Promise((ok) => setTimeout(ok, 2_000));
    }
    throw new Error(`${method} not confirmed in time (${sent.hash})`);
  }

  async getFixing(benchmark: BenchmarkId, observationDate: string): Promise<ChainFixing | null> {
    const { value } = await this.invoke(this.cfg.nodes[0], "get_fixing", [
      nativeToScVal(benchmark, { type: "symbol" }),
      nativeToScVal(epochDay(observationDate), { type: "u32" }),
    ], false);
    return (value as ChainFixing | undefined) ?? null;
  }

  /** Submit one observation from every node until the fixing forms. Returns the round and hash. */
  async submit(benchmark: BenchmarkId, observationDate: string, rateMicroPercent: number): Promise<{ round: number; hash: string } | null> {
    const args = [
      nativeToScVal(benchmark, { type: "symbol" }),
      nativeToScVal(epochDay(observationDate), { type: "u32" }),
      nativeToScVal(BigInt(rateMicroPercent), { type: "i64" }),
    ];
    for (const node of this.cfg.nodes) {
      const { value, hash } = await this.invoke(node, "submit", [nativeToScVal(node.publicKey(), { type: "address" }), ...args], true);
      const fixing = value as ChainFixing | undefined;
      if (fixing) return { round: Number(fixing.round), hash: hash! };
    }
    return null;
  }

  /**
   * Put every locked, not-yet-on-chain observation of the last few weeks on chain.
   * A fixing already formed (by an earlier run or other nodes) is recorded, not resubmitted.
   */
  async sync(repo: RateRepository, benchmark: BenchmarkId, now = new Date()): Promise<{ submitted: number; recorded: number; errors: string[] }> {
    const b = getBenchmark(benchmark);
    const today = localParts(now, b.timeZone).date;
    const rows = await repo.range(benchmark, addDays(today, -LOOKBACK_DAYS), today);
    const out = { submitted: 0, recorded: 0, errors: [] as string[] };
    for (const o of rows) {
      if (o.onChainRound !== null || !isLocked(b, o.observationDate, now)) continue;
      try {
        const existing = await this.getFixing(benchmark, o.observationDate);
        if (existing) {
          if (Number(existing.rate_micro_percent) !== o.rateMicroPercent) {
            out.errors.push(`${benchmark} ${o.observationDate}: on-chain ${existing.rate_micro_percent} differs from stored ${o.rateMicroPercent}`);
          }
          await repo.markOnChain(benchmark, o.observationDate, Number(existing.round), "existing");
          out.recorded++;
          continue;
        }
        const result = await this.submit(benchmark, o.observationDate, o.rateMicroPercent);
        if (result) {
          await repo.markOnChain(benchmark, o.observationDate, result.round, result.hash);
          out.submitted++;
        } else {
          out.errors.push(`${benchmark} ${o.observationDate}: quorum not reached`);
        }
      } catch (err) {
        out.errors.push(`${benchmark} ${o.observationDate}: ${(err as Error).message}`);
      }
    }
    return out;
  }
}
