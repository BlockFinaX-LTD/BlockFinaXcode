// The server fixes the network to Stellar testnet. Deployment includes storage
// costs and needs a separate budget from an ordinary token transfer.
const LIMITS = { deployment: 30_0000000, payment: 10_0000000 } as const;
export function checkSponsorshipFee(fee: string, kind: keyof typeof LIMITS) {
  const value = Number(fee);
  if (!/^\d+$/.test(fee) || !Number.isSafeInteger(value) || value <= 0 || value > LIMITS[kind])
    throw Error(`${kind === "deployment" ? "Deployment" : "Transaction"} exceeds sponsorship fee limit (${LIMITS[kind] / 1e7} test XLM)`);
}
