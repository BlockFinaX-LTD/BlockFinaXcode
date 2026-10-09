import {
  Address,
  StrKey,
  scValToNative,
  TransactionBuilder,
  xdr,
  Transaction,
} from "@stellar/stellar-sdk";
export function inspectPayment(
  envelope: string,
  network: string,
  from: string,
  token: string,
) {
  const tx = TransactionBuilder.fromXDR(envelope, network);
  if (!(tx instanceof Transaction) || tx.operations.length !== 1)
    throw Error("Only one token payment is permitted");
  const op = tx.operations[0];
  if (
    op.type !== "invokeHostFunction" ||
    op.func.switch().name !== "hostFunctionTypeInvokeContract"
  )
    throw Error("Only token transfers are permitted");
  const invoke = op.func.invokeContract();
  if (
    Address.fromScAddress(invoke.contractAddress()).toString() !== token ||
    invoke.functionName().toString() !== "transfer" ||
    invoke.args().length !== 3
  )
    throw Error("Token or function is not approved");
  const [sender, recipient, amount] = invoke.args().map(scValToNative);
  if (
    sender !== from ||
    typeof recipient !== "string" ||
    !(
      StrKey.isValidEd25519PublicKey(recipient) ||
      StrKey.isValidContract(recipient)
    ) ||
    recipient === from ||
    typeof amount !== "bigint" ||
    amount <= 0n ||
    amount > 1000_0000000n
  )
    throw Error(
      "Invalid payment. Send between 0 and 1,000 test XLM to another Stellar account.",
    );
  const auth = op.auth ?? [];
  if (
    auth.length !== 1 ||
    auth[0].credentials().switch().name !== "sorobanCredentialsAddressV2" ||
    Address.fromScAddress(
      auth[0].credentials().addressV2().address(),
    ).toString() !== from
  )
    throw Error("Payment must be authorized by your wallet");
  const root = auth[0].rootInvocation();
  if (
    root.function().switch().name !==
      "sorobanAuthorizedFunctionTypeContractFn" ||
    !root.function().contractFn().toXDR().equals(invoke.toXDR()) ||
    root.subInvocations().length !== 0
  )
    throw Error("Unexpected payment authorization");
  return { func: op.func, auth, recipient, amount };
}
export function validateRecipient(value: string) {
  if (!StrKey.isValidEd25519PublicKey(value) && !StrKey.isValidContract(value))
    throw Error("Enter a valid Stellar G or C address");
  return value;
}
