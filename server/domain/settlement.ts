/**
 * Settlement results in one shape for every chain. Base settles inside the oracle
 * submission and Stellar in a separate call; either way the hedger sees this.
 */
import { formatResourceId, type ProtectionPosition, type SettlementResult } from "@shared/domain/types";
import { fromUnits, payoutAfterFee, toUnits } from "@shared/domain/pool-economics";

export function settlementResult(position: ProtectionPosition, payoutFeeRateE6: number, decimals: number): SettlementResult {
  const gross = toUnits(position.payout, decimals);
  const { fee, net } = payoutAfterFee(gross, BigInt(payoutFeeRateE6));
  const status: SettlementResult["status"] =
    position.status === "active" ? "pending"
      : position.status === "claimed" ? "claimed"
        : position.status === "voided" ? "voided"
        : gross === BigInt(0) ? "settled_no_payout" : "settled_claimable";
  return {
    position: formatResourceId(position.ref),
    settlementPrice: position.settlementPrice,
    grossPayout: fromUnits(gross, decimals),
    fee: fromUnits(fee, decimals),
    netPayout: fromUnits(net, decimals),
    status,
  };
}
