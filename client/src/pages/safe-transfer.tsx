import { useState, useEffect, useCallback } from "react";
import { ethers } from "ethers";
import { Button } from "@/components/ui/button";
import { CheckCircle, Loader2, Shield, AlertTriangle, Clock } from "lucide-react";

const DIAMOND        = "0x3eDfA00a1E3C158A591097de2FA1756aCD66860D";
const SAFE           = "0xfce89FA90Ee1C78B15eE0f12f62B03153814699D";
const OWNER_1        = "0xc69352C36562ce2D4C57B38baf47cE7D1eF6b891";
const OWNER_2        = "0x6C0e8E46728953322C83cD2A0c3eDa122F077723";
const LISK_CHAIN_ID  = 1135;

const DIAMOND_ABI = [
  "function transferOwnership(address _newOwner) external",
  "function pendingOwner() view returns (address)",
];

// contractOwner lives at DiamondStorage base slot + 4
// base = keccak256("diamond.standard.diamond.storage")
async function readDiamondOwner(provider: ethers.JsonRpcProvider): Promise<string> {
  const base = BigInt(ethers.keccak256(ethers.toUtf8Bytes("diamond.standard.diamond.storage")));
  const slot  = ethers.toBeHex(base + 4n, 32);
  const raw   = await provider.getStorage(DIAMOND, slot);
  return ethers.getAddress("0x" + raw.slice(-40));
}

const SAFE_ABI = [
  "function approveHash(bytes32 hashToApprove) external",
  "function approvedHashes(address,bytes32) view returns (uint256)",
  "function nonce() view returns (uint256)",
  "function getTransactionHash(address to,uint256 value,bytes calldata data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,uint256 _nonce) view returns (bytes32)",
  "function execTransaction(address to,uint256 value,bytes calldata data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address payable refundReceiver,bytes memory signatures) external payable returns (bool)",
];

const ACCEPT_DATA = new ethers.Interface(["function acceptOwnership() external"])
  .encodeFunctionData("acceptOwnership");

function shortAddr(a: string) { return a.slice(0, 10) + "…" + a.slice(-6); }

interface Status {
  diamondOwner: string;
  pendingOwner: string;
  safeNonce: number;
  txHash: string;
  owner1Approved: boolean;
  owner2Approved: boolean;
}

export default function SafeTransfer() {
  const [wallet, setWallet]     = useState("");
  const [status, setStatus]     = useState<Status | null>(null);
  const [busy, setBusy]         = useState(false);
  const [error, setError]       = useState("");
  const [success, setSuccess]   = useState("");
  const [network, setNetwork]   = useState(false);

  const getProvider = useCallback(() => new ethers.JsonRpcProvider("https://rpc.api.lisk.com"), []);

  const loadStatus = useCallback(async () => {
    try {
      const provider = getProvider();
      const diamond  = new ethers.Contract(DIAMOND, DIAMOND_ABI, provider);
      const safe     = new ethers.Contract(SAFE, SAFE_ABI, provider);

      const [diamondOwner, pendingOwner, safeNonce] = await Promise.all([
        readDiamondOwner(provider),
        diamond.pendingOwner(),
        safe.nonce(),
      ]);

      const txHash = await safe.getTransactionHash(
        DIAMOND, 0, ACCEPT_DATA, 0, 0, 0, 0,
        ethers.ZeroAddress, ethers.ZeroAddress, safeNonce
      );

      const [a1, a2] = await Promise.all([
        safe.approvedHashes(OWNER_1, txHash),
        safe.approvedHashes(OWNER_2, txHash),
      ]);

      setStatus({
        diamondOwner,
        pendingOwner,
        safeNonce: Number(safeNonce),
        txHash,
        owner1Approved: a1 > 0n,
        owner2Approved: a2 > 0n,
      });
    } catch (e: any) {
      setError("Could not load on-chain status: " + e.message);
    }
  }, [getProvider]);

  useEffect(() => { loadStatus(); }, [loadStatus]);

  async function connectWallet() {
    setError("");
    if (!window.ethereum) { setError("Open inside MetaMask's browser."); return; }
    const provider = new ethers.BrowserProvider(window.ethereum);
    await provider.send("eth_requestAccounts", []);
    const net = await provider.getNetwork();
    if (Number(net.chainId) !== LISK_CHAIN_ID) {
      try { await provider.send("wallet_switchEthereumChain", [{ chainId: "0x46F" }]); }
      catch { await provider.send("wallet_addEthereumChain", [{ chainId: "0x46F", chainName: "Lisk", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: ["https://rpc.api.lisk.com"], blockExplorerUrls: ["https://blockscout.lisk.com"] }]); }
    }
    const signer  = await provider.getSigner();
    const address = await signer.getAddress();
    setWallet(address);
    setNetwork(Number((await provider.getNetwork()).chainId) === LISK_CHAIN_ID);
  }

  async function transferToSafe() {
    setBusy(true); setError(""); setSuccess("");
    try {
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer   = await provider.getSigner();
      const diamond  = new ethers.Contract(DIAMOND, DIAMOND_ABI, signer);
      const tx = await diamond.transferOwnership(SAFE);
      await tx.wait();
      setSuccess("transferOwnership sent. Safe is now pending owner.");
      await loadStatus();
    } catch (e: any) { setError(e.message); }
    setBusy(false);
  }

  async function approveHash() {
    setBusy(true); setError(""); setSuccess("");
    try {
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer   = await provider.getSigner();
      const safe     = new ethers.Contract(SAFE, SAFE_ABI, signer);
      const tx = await safe.approveHash(status!.txHash);
      await tx.wait();
      setSuccess("Hash approved. Waiting for second signer.");
      await loadStatus();
    } catch (e: any) { setError(e.message); }
    setBusy(false);
  }

  async function execute() {
    setBusy(true); setError(""); setSuccess("");
    try {
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer   = await provider.getSigner();
      const safe     = new ethers.Contract(SAFE, SAFE_ABI, signer);

      const owners = [OWNER_1, OWNER_2].sort((a, b) =>
        a.toLowerCase() < b.toLowerCase() ? -1 : 1
      );
      const sigs = ethers.concat(owners.map(o =>
        ethers.concat([ethers.zeroPadValue(o, 32), ethers.zeroPadValue("0x00", 32), "0x01"])
      ));

      const tx = await safe.execTransaction(
        DIAMOND, 0, ACCEPT_DATA, 0, 0, 0, 0,
        ethers.ZeroAddress, ethers.ZeroAddress, sigs
      );
      await tx.wait();
      setSuccess("Done! Diamond is now owned by the Safe.");
      await loadStatus();
    } catch (e: any) { setError(e.message); }
    setBusy(false);
  }

  const isOwner1 = wallet.toLowerCase() === OWNER_1.toLowerCase();
  const isOwner2 = wallet.toLowerCase() === OWNER_2.toLowerCase();
  const safeIsPending = status?.pendingOwner.toLowerCase() === SAFE.toLowerCase();
  const safeIsOwner   = status?.diamondOwner.toLowerCase() === SAFE.toLowerCase();
  const bothApproved  = status?.owner1Approved && status?.owner2Approved;
  const myApproved    = isOwner1 ? status?.owner1Approved : isOwner2 ? status?.owner2Approved : false;

  function stepStatus(done: boolean, active: boolean) {
    if (done)   return "text-green-600";
    if (active) return "text-blue-600 font-semibold";
    return "text-gray-400";
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-lg border border-gray-100 p-8">
        <div className="text-center mb-6">
          <div className="w-12 h-12 rounded-full bg-blue-50 flex items-center justify-center mx-auto mb-3">
            <Shield className="w-6 h-6 text-blue-600" />
          </div>
          <h1 className="text-xl font-bold text-gray-900">Transfer Ownership to Safe</h1>
          <p className="text-sm text-gray-500 mt-1">2-of-2 multisig — both wallets must approve</p>
        </div>

        {/* Safe info */}
        <div className="mb-6 space-y-1.5 text-xs">
          {[["Safe address", shortAddr(SAFE)], ["Owner 1", shortAddr(OWNER_1)], ["Owner 2", shortAddr(OWNER_2)], ["Threshold", "2 of 2"]].map(([k, v]) => (
            <div key={k} className="flex justify-between py-1.5 border-b border-gray-50">
              <span className="text-gray-500">{k}</span>
              <span className="font-mono text-gray-700">{v}</span>
            </div>
          ))}
        </div>

        {/* Steps */}
        {status && (
          <div className="mb-6 space-y-3">
            <div className={`flex items-start gap-3 text-sm ${stepStatus(safeIsPending || safeIsOwner, !safeIsPending && !safeIsOwner)}`}>
              {safeIsPending || safeIsOwner ? <CheckCircle className="w-4 h-4 mt-0.5 shrink-0" /> : <Clock className="w-4 h-4 mt-0.5 shrink-0" />}
              <div><p className="font-medium">Step 1 — Propose transfer</p><p className="text-xs text-gray-500">Owner 1 calls transferOwnership(Safe)</p></div>
            </div>
            <div className={`flex items-start gap-3 text-sm ${stepStatus(status.owner1Approved, safeIsPending && !status.owner1Approved && !safeIsOwner)}`}>
              {status.owner1Approved ? <CheckCircle className="w-4 h-4 mt-0.5 shrink-0" /> : <Clock className="w-4 h-4 mt-0.5 shrink-0" />}
              <div><p className="font-medium">Step 2 — Owner 1 approves</p><p className="text-xs text-gray-500">{shortAddr(OWNER_1)}</p></div>
            </div>
            <div className={`flex items-start gap-3 text-sm ${stepStatus(status.owner2Approved, safeIsPending && !status.owner2Approved && !safeIsOwner)}`}>
              {status.owner2Approved ? <CheckCircle className="w-4 h-4 mt-0.5 shrink-0" /> : <Clock className="w-4 h-4 mt-0.5 shrink-0" />}
              <div><p className="font-medium">Step 3 — Owner 2 approves</p><p className="text-xs text-gray-500">{shortAddr(OWNER_2)}</p></div>
            </div>
            <div className={`flex items-start gap-3 text-sm ${stepStatus(safeIsOwner, !!bothApproved && !safeIsOwner)}`}>
              {safeIsOwner ? <CheckCircle className="w-4 h-4 mt-0.5 shrink-0" /> : <Clock className="w-4 h-4 mt-0.5 shrink-0" />}
              <div><p className="font-medium">Step 4 — Execute</p><p className="text-xs text-gray-500">Either owner executes the Safe transaction</p></div>
            </div>
          </div>
        )}

        {safeIsOwner ? (
          <div className="text-center space-y-2">
            <CheckCircle className="w-10 h-10 text-green-500 mx-auto" />
            <p className="font-semibold text-gray-900">Safe owns the Diamond</p>
            <p className="text-sm text-gray-500">Multisig is active. Both signers required for all owner actions.</p>
            <a href={`https://blockscout.lisk.com/address/${SAFE}`} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 underline block">View Safe on Blockscout</a>
          </div>
        ) : !wallet ? (
          <Button className="w-full" size="lg" onClick={connectWallet}>Connect Wallet</Button>
        ) : !network ? (
          <div className="space-y-3">
            <div className="flex gap-2 p-3 bg-amber-50 rounded-lg text-sm text-amber-700">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>Switch to Lisk Mainnet in MetaMask first.</span>
            </div>
            <Button className="w-full" onClick={connectWallet}>Reconnect</Button>
          </div>
        ) : !isOwner1 && !isOwner2 ? (
          <div className="p-3 bg-red-50 rounded-lg text-sm text-red-700">
            <AlertTriangle className="w-4 h-4 inline mr-1" />
            Wrong wallet. Connect Owner 1 or Owner 2.
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-center text-gray-500">Connected: {shortAddr(wallet)}</p>

            {/* Step 1 */}
            {!safeIsPending && isOwner1 && (
              <Button className="w-full bg-blue-600 hover:bg-blue-700 text-white" size="lg" onClick={transferToSafe} disabled={busy}>
                {busy ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Working…</> : "Step 1 — Propose transfer to Safe"}
              </Button>
            )}
            {!safeIsPending && !isOwner1 && (
              <div className="p-3 bg-gray-50 rounded-lg text-sm text-gray-500 text-center">Waiting for Owner 1 to complete Step 1</div>
            )}

            {/* Steps 2 & 3 */}
            {safeIsPending && !safeIsOwner && !myApproved && (
              <Button className="w-full bg-blue-600 hover:bg-blue-700 text-white" size="lg" onClick={approveHash} disabled={busy}>
                {busy ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Working…</> : `${isOwner1 ? "Step 2" : "Step 3"} — Approve`}
              </Button>
            )}
            {safeIsPending && !safeIsOwner && myApproved && !bothApproved && (
              <div className="p-3 bg-green-50 rounded-lg text-sm text-green-700 text-center">✓ You approved — waiting for the other signer</div>
            )}

            {/* Step 4 */}
            {bothApproved && !safeIsOwner && (
              <Button className="w-full bg-green-600 hover:bg-green-700 text-white" size="lg" onClick={execute} disabled={busy}>
                {busy ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Executing…</> : "Step 4 — Execute (both approved ✓)"}
              </Button>
            )}
          </div>
        )}

        {error && (
          <div className="mt-4 flex gap-2 p-3 bg-red-50 rounded-lg text-xs text-red-700">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span className="break-all">{error.slice(0, 300)}</span>
          </div>
        )}
        {success && (
          <div className="mt-4 p-3 bg-green-50 rounded-lg text-xs text-green-700">{success}</div>
        )}

        <button onClick={loadStatus} className="mt-4 text-xs text-gray-400 underline w-full text-center">Refresh status</button>
      </div>
    </div>
  );
}
