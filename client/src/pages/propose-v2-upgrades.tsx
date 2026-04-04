import { useState, useEffect, useCallback } from "react";
import { ethers } from "ethers";
import { Button } from "@/components/ui/button";
import { CheckCircle, Loader2, ShieldCheck, AlertTriangle, Clock } from "lucide-react";

// ── Addresses ────────────────────────────────────────────────────────────────
const DIAMOND             = "0x885E663645173a0791b82f0e6608921D31E3D700";
const SAFE                = "0xfce89FA90Ee1C78B15eE0f12f62B03153814699D";
const TIMELOCK_V2         = "0x56e10850a90751c80c500C6aF10da36D95A85D86";
const HEDGE_V7            = "0x3af3275eC30Ad5F3c1DBd47EfF69c6dF4196DEd5";
const LISK_CHAIN_ID       = 1135;

// The broken proposal that was queued with wrong selectors — must be cancelled first
const BROKEN_PROPOSAL_ID  = "0x79db66158c2bac1201f23f5bd3caf4fcb6e4db166f9e5902811ec64ceee955ce";

const SAFE_OWNERS = [
  "0xc69352C36562ce2D4C57B38baf47cE7D1eF6b891",
  "0x6C0e8E46728953322C83cD2A0c3eDa122F077723",
  "0x331B1ce9250b53e807935F65D5cd04C2234af3a0",
];

// ── Correct upgrade calldata ─────────────────────────────────────────────────
// Actual selectors currently installed in Diamond's TimelockCutFacet v1
const TIMELOCK_SELECTORS_REPLACE = [
  "0x1f931c1c", // diamondCut
  "0x5ba1c1a9", // TIMELOCK_DELAY
  "0xa73829f9", // getAllCutIds
  "0x4b71162f", // getPendingCutIds
  "0x303aad29", // getPendingCutInfo
  "0xb6b5d65f", // PROPOSAL_EXPIRY (30 days)
  "0x55cb2751", // cancelCut(bytes32)
  "0xe9143174", // executeCut(bytes32)
  "0x430694cf", // getProposal(bytes32)
];

const DIAMOND_CUT_ABI_IFACE = new ethers.Interface([
  "function diamondCut((address facetAddress, uint8 action, bytes4[] functionSelectors)[] _diamondCut, address _init, bytes _calldata) external",
]);

const UPGRADE_CUTS = [
  { facetAddress: TIMELOCK_V2, action: 1, functionSelectors: TIMELOCK_SELECTORS_REPLACE },
  { facetAddress: HEDGE_V7,    action: 1, functionSelectors: ["0xd06be38e"] }, // recoverExpiredPayouts
];

const PROPOSE_DATA = DIAMOND_CUT_ABI_IFACE.encodeFunctionData("diamondCut", [
  UPGRADE_CUTS, ethers.ZeroAddress, "0x",
]);

// executeCut(bytes32) = 0xe9143174 — the ACTUAL execute function in the installed Timelock
const EXEC_CUT_IFACE = new ethers.Interface([
  "function executeCut(bytes32 _proposalId) external",
]);

// cancelCut(bytes32) = 0x55cb2751
const CANCEL_CUT_IFACE = new ethers.Interface([
  "function cancelCut(bytes32 _proposalId) external",
]);

const CANCEL_DATA = CANCEL_CUT_IFACE.encodeFunctionData("cancelCut", [BROKEN_PROPOSAL_ID]);

// ── Safe ABI ─────────────────────────────────────────────────────────────────
const SAFE_ABI = [
  "function nonce() view returns (uint256)",
  "function getTransactionHash(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,uint256) view returns (bytes32)",
  "function approveHash(bytes32) external",
  "function approvedHashes(address,bytes32) view returns (uint256)",
  "function execTransaction(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,bytes) external payable returns (bool)",
];

const TIMELOCK_ABI = [
  "function getPendingCutIds() view returns (bytes32[])",
  "function getPendingCutInfo(bytes32) view returns (uint256 eta, bool executed, bool cancelled)",
];

function shortAddr(a: string) { return a.slice(0,10) + "…" + a.slice(-6); }

type Phase = "cancel" | "propose" | "waiting" | "execute" | "done";

interface SafeApprovalState {
  txHash: string;
  approvals: boolean[];
  nonce: number;
}

export default function ProposeV2Upgrades() {
  const [wallet, setWallet]     = useState("");
  const [onLisk, setOnLisk]     = useState(false);
  const [phase, setPhase]       = useState<Phase>("propose");
  const [proposalId, setProposalId] = useState("");
  const [eta, setEta]           = useState(0);
  const [cancelApproval, setCancelApproval]   = useState<SafeApprovalState | null>(null);
  const [proposeApproval, setProposeApproval] = useState<SafeApprovalState | null>(null);
  const [execApproval, setExecApproval]       = useState<SafeApprovalState | null>(null);
  const [busy, setBusy]         = useState(false);
  const [error, setError]       = useState("");
  const [success, setSuccess]   = useState("");
  const [canExecuteTimelock, setCanExecuteTimelock] = useState(false);

  const loadSafeApproval = useCallback(async (calldata: string): Promise<SafeApprovalState> => {
    const provider = new ethers.JsonRpcProvider("https://rpc.api.lisk.com");
    const safe     = new ethers.Contract(SAFE, SAFE_ABI, provider);
    const nonce    = await safe.nonce();
    const txHash   = await safe.getTransactionHash(
      DIAMOND, 0, calldata, 0, 0, 0, 0,
      ethers.ZeroAddress, ethers.ZeroAddress, nonce
    );
    const approvals = await Promise.all(
      SAFE_OWNERS.map(o => safe.approvedHashes(o, txHash).then((v: bigint) => v > 0n))
    );
    return { txHash, approvals, nonce: Number(nonce) };
  }, []);

  const loadTimelockState = useCallback(async () => {
    try {
      const provider = new ethers.JsonRpcProvider("https://rpc.api.lisk.com");
      const tl = new ethers.Contract(DIAMOND, TIMELOCK_ABI, provider);

      // First check if the broken proposal still needs cancelling
      const brokenInfo = await tl.getPendingCutInfo(BROKEN_PROPOSAL_ID);
      const brokenExecuted  = brokenInfo[1];
      const brokenCancelled = brokenInfo[2];

      if (!brokenExecuted && !brokenCancelled) {
        setPhase("cancel");
        return;
      }

      // Broken proposal gone — look for new proposals
      const ids: string[] = await tl.getPendingCutIds();
      // Filter out the broken one
      const others = ids.filter(id => id.toLowerCase() !== BROKEN_PROPOSAL_ID.toLowerCase());

      if (others.length === 0) {
        setPhase("propose");
        return;
      }

      const latest = others[others.length - 1];
      const info = await tl.getPendingCutInfo(latest);
      const eta  = Number(info[0]);
      const executed  = info[1];
      const cancelled = info[2];

      if (executed) {
        setPhase("done");
      } else if (!cancelled) {
        setProposalId(latest);
        setEta(eta);
        setPhase(eta > 0 ? (Date.now()/1000 >= eta ? "execute" : "waiting") : "propose");
      } else {
        setPhase("propose");
      }
    } catch (e) {
      console.warn("[loadTimelockState]", e);
    }
  }, []);

  const refreshAll = useCallback(async () => {
    await loadTimelockState();
    loadSafeApproval(CANCEL_DATA).then(setCancelApproval).catch(() => {});
    loadSafeApproval(PROPOSE_DATA).then(setProposeApproval).catch(() => {});
  }, [loadTimelockState, loadSafeApproval]);

  useEffect(() => { refreshAll(); }, [refreshAll]);

  // Load exec approval when we have a proposal and are in execute/waiting phase
  useEffect(() => {
    if ((phase === "waiting" || phase === "execute") && proposalId) {
      const execData = EXEC_CUT_IFACE.encodeFunctionData("executeCut", [proposalId]);
      loadSafeApproval(execData).then(setExecApproval).catch(() => {});
    }
  }, [phase, proposalId, loadSafeApproval]);

  // Auto-poll exec approval every 15s in execute phase
  useEffect(() => {
    if (phase !== "execute" || !proposalId) return;
    const execData = EXEC_CUT_IFACE.encodeFunctionData("executeCut", [proposalId]);
    const interval = setInterval(() => {
      loadSafeApproval(execData).then(setExecApproval).catch(() => {});
    }, 15000);
    return () => clearInterval(interval);
  }, [phase, proposalId, loadSafeApproval]);

  useEffect(() => {
    if (!eta) return;
    const check = () => setCanExecuteTimelock(Date.now()/1000 >= eta);
    check();
    const t = setInterval(check, 15000);
    return () => clearInterval(t);
  }, [eta]);

  useEffect(() => {
    if (!window.ethereum) return;
    const h = (accounts: string[]) => { setWallet(accounts[0] ?? ""); setError(""); setSuccess(""); };
    window.ethereum.on("accountsChanged", h);
    return () => window.ethereum.removeListener("accountsChanged", h);
  }, []);

  async function connect() {
    setError("");
    if (!window.ethereum) { setError("Open in MetaMask browser."); return; }
    const provider = new ethers.BrowserProvider(window.ethereum);
    await provider.send("eth_requestAccounts", []);
    const net = await provider.getNetwork();
    if (Number(net.chainId) !== LISK_CHAIN_ID) {
      try { await provider.send("wallet_switchEthereumChain", [{ chainId: "0x46F" }]); }
      catch { await provider.send("wallet_addEthereumChain", [{ chainId: "0x46F", chainName: "Lisk", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: ["https://rpc.api.lisk.com"], blockExplorerUrls: ["https://blockscout.lisk.com"] }]); }
    }
    const signer  = await provider.getSigner();
    const address = await signer.getAddress();
    const chain   = await provider.getNetwork();
    setWallet(address);
    setOnLisk(Number(chain.chainId) === LISK_CHAIN_ID);
  }

  async function approveCancel() {
    if (!cancelApproval) return;
    setBusy(true); setError(""); setSuccess("");
    try {
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer   = await provider.getSigner();
      const safe     = new ethers.Contract(SAFE, SAFE_ABI, signer);
      const tx = await safe.approveHash(cancelApproval.txHash);
      await tx.wait();
      await new Promise(r => setTimeout(r, 2000));
      const updated = await loadSafeApproval(CANCEL_DATA);
      setCancelApproval(updated);
      const count = updated.approvals.filter(Boolean).length;
      setSuccess(count >= 2 ? "Both approved — ready to cancel!" : "Approved. Need one more signer.");
    } catch (e: any) { setError(e.message); }
    setBusy(false);
  }

  async function executeCancel() {
    if (!cancelApproval) return;
    setBusy(true); setError(""); setSuccess("");
    try {
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer   = await provider.getSigner();
      const safe     = new ethers.Contract(SAFE, SAFE_ABI, signer);
      const sortedOwners = [...SAFE_OWNERS].sort((a,b) => a.toLowerCase() < b.toLowerCase() ? -1 : 1);
      const approvedOwners = sortedOwners.filter(o =>
        cancelApproval.approvals[SAFE_OWNERS.indexOf(o)]
      ).slice(0, 2);
      const sigs = ethers.concat(approvedOwners.map(o =>
        ethers.concat([ethers.zeroPadValue(o, 32), ethers.zeroPadValue("0x00", 32), "0x01"])
      ));
      const tx = await safe.execTransaction(
        DIAMOND, 0, CANCEL_DATA, 0, 0, 0, 0,
        ethers.ZeroAddress, ethers.ZeroAddress, sigs
      );
      await tx.wait();
      setSuccess("Broken proposal cancelled. Now propose the corrected upgrade.");
      await refreshAll();
    } catch (e: any) { setError(e.message); }
    setBusy(false);
  }

  async function approvePropose() {
    if (!proposeApproval) return;
    setBusy(true); setError(""); setSuccess("");
    try {
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer   = await provider.getSigner();
      const safe     = new ethers.Contract(SAFE, SAFE_ABI, signer);
      const tx = await safe.approveHash(proposeApproval.txHash);
      await tx.wait();
      await new Promise(r => setTimeout(r, 2000));
      const updated = await loadSafeApproval(PROPOSE_DATA);
      setProposeApproval(updated);
      const count = updated.approvals.filter(Boolean).length;
      setSuccess(count >= 2 ? "Both approved — ready to submit!" : "Approved. Need one more signer.");
    } catch (e: any) { setError(e.message); }
    setBusy(false);
  }

  async function executePropose() {
    if (!proposeApproval) return;
    setBusy(true); setError(""); setSuccess("");
    try {
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer   = await provider.getSigner();
      const safe     = new ethers.Contract(SAFE, SAFE_ABI, signer);
      const sortedOwners = [...SAFE_OWNERS].sort((a,b) => a.toLowerCase() < b.toLowerCase() ? -1 : 1);
      const approvedOwners = sortedOwners.filter(o =>
        proposeApproval.approvals[SAFE_OWNERS.indexOf(o)]
      ).slice(0, 2);
      const sigs = ethers.concat(approvedOwners.map(o =>
        ethers.concat([ethers.zeroPadValue(o, 32), ethers.zeroPadValue("0x00", 32), "0x01"])
      ));
      const tx = await safe.execTransaction(
        DIAMOND, 0, PROPOSE_DATA, 0, 0, 0, 0,
        ethers.ZeroAddress, ethers.ZeroAddress, sigs
      );
      await tx.wait();
      setSuccess("New proposal submitted! 48h timelock running.");
      await refreshAll();
    } catch (e: any) { setError(e.message); }
    setBusy(false);
  }

  async function approveExecute() {
    if (!execApproval || !proposalId) return;
    setBusy(true); setError(""); setSuccess("");
    try {
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer   = await provider.getSigner();
      const safe     = new ethers.Contract(SAFE, SAFE_ABI, signer);
      const tx = await safe.approveHash(execApproval.txHash);
      await tx.wait();
      await new Promise(r => setTimeout(r, 2000));
      const execData = EXEC_CUT_IFACE.encodeFunctionData("executeCut", [proposalId]);
      const updated  = await loadSafeApproval(execData);
      setExecApproval(updated);
      const count = updated.approvals.filter(Boolean).length;
      setSuccess(count >= 2 ? "Both owners approved — ready to execute!" : "Approved. Need one more signer.");
    } catch (e: any) { setError(e.message); }
    setBusy(false);
  }

  async function executeUpgrade() {
    if (!execApproval || !proposalId) return;
    setBusy(true); setError(""); setSuccess("");
    try {
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer   = await provider.getSigner();
      const safe     = new ethers.Contract(SAFE, SAFE_ABI, signer);
      const execData = EXEC_CUT_IFACE.encodeFunctionData("executeCut", [proposalId]);
      const sortedOwners = [...SAFE_OWNERS].sort((a,b) => a.toLowerCase() < b.toLowerCase() ? -1 : 1);
      const approvedOwners = sortedOwners.filter(o =>
        execApproval.approvals[SAFE_OWNERS.indexOf(o)]
      ).slice(0, 2);
      const sigs = ethers.concat(approvedOwners.map(o =>
        ethers.concat([ethers.zeroPadValue(o, 32), ethers.zeroPadValue("0x00", 32), "0x01"])
      ));
      const tx = await safe.execTransaction(
        DIAMOND, 0, execData, 0, 0, 0, 0,
        ethers.ZeroAddress, ethers.ZeroAddress, sigs
      );
      await tx.wait();
      setSuccess("Upgrade applied! All audit fixes are now live.");
      setPhase("done");
    } catch (e: any) { setError(e.message); }
    setBusy(false);
  }

  const ownerIndex  = SAFE_OWNERS.findIndex(o => o.toLowerCase() === wallet.toLowerCase());
  const isOwner     = ownerIndex >= 0;
  const etaDate     = eta ? new Date(eta*1000).toLocaleString() : "";
  const hoursLeft   = eta ? Math.max(0, Math.ceil((eta - Date.now()/1000)/3600)) : 0;

  const cancelApprovalCount  = cancelApproval?.approvals.filter(Boolean).length ?? 0;
  const proposeApprovalCount = proposeApproval?.approvals.filter(Boolean).length ?? 0;
  const execApprovalCount    = execApproval?.approvals.filter(Boolean).length ?? 0;
  const myCancelApproved  = cancelApproval?.approvals[ownerIndex] ?? false;
  const myProposeApproved = proposeApproval?.approvals[ownerIndex] ?? false;
  const myExecApproved    = execApproval?.approvals[ownerIndex] ?? false;

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-lg border border-gray-100 p-8">
        <div className="text-center mb-6">
          <div className="w-12 h-12 rounded-full bg-blue-50 flex items-center justify-center mx-auto mb-3">
            <ShieldCheck className="w-6 h-6 text-blue-600" />
          </div>
          <h1 className="text-xl font-bold text-gray-900">Apply Audit Fixes (v2)</h1>
          <p className="text-sm text-gray-500 mt-1">Two facet upgrades — requires 2-of-3 Safe signers + 48h timelock</p>
        </div>

        <div className="mb-5 p-3 bg-gray-50 rounded-lg text-xs space-y-1">
          <p className="font-medium text-gray-700 mb-2">Changes in this upgrade:</p>
          <p className="text-gray-600">✓ TimelockCutFacet v2 — 30-day proposal expiry + getAllCutIds()</p>
          <p className="text-gray-600">✓ HedgeFacet v7 — recoverExpiredPayouts() is now permissionless</p>
        </div>

        {phase === "done" ? (
          <div className="text-center space-y-3">
            <CheckCircle className="w-12 h-12 text-green-500 mx-auto" />
            <p className="font-semibold text-gray-900">All audit fixes applied</p>
            <p className="text-sm text-gray-500">Protocol is now fully upgraded.</p>
          </div>
        ) : (
          <>
            {/* Phase indicator */}
            <div className="mb-5 space-y-2 text-sm">
              <div className={`flex items-center gap-2 ${phase === "cancel" ? "text-red-600 font-semibold" : "text-green-600"}`}>
                {phase === "cancel" ? <AlertTriangle className="w-4 h-4" /> : <CheckCircle className="w-4 h-4" />}
                Phase 0 — Cancel broken proposal
                {cancelApprovalCount > 0 && phase === "cancel" && <span className="text-xs text-gray-400">({cancelApprovalCount}/2 approved)</span>}
              </div>
              <div className={`flex items-center gap-2 ${phase === "propose" ? "text-blue-600 font-semibold" : phase !== "cancel" ? "text-green-600" : "text-gray-300"}`}>
                {phase !== "cancel" && phase !== "propose" ? <CheckCircle className="w-4 h-4" /> : <Clock className="w-4 h-4" />}
                Phase 1 — Propose corrected upgrade via Safe
                {proposeApprovalCount > 0 && phase === "propose" && <span className="text-xs text-gray-400">({proposeApprovalCount}/2 approved)</span>}
              </div>
              <div className={`flex items-center gap-2 ${phase === "waiting" ? "text-amber-600 font-semibold" : phase === "execute" || phase === "done" ? "text-green-600" : "text-gray-300"}`}>
                {phase === "execute" || phase === "done" ? <CheckCircle className="w-4 h-4" /> : <Clock className="w-4 h-4" />}
                Phase 2 — Wait 48 hours
                {phase === "waiting" && eta > 0 && <span className="text-xs">(~{hoursLeft}h left)</span>}
              </div>
              <div className={`flex items-center gap-2 ${phase === "execute" ? "text-blue-600 font-semibold" : phase === "done" ? "text-green-600" : "text-gray-300"}`}>
                {phase === "done" ? <CheckCircle className="w-4 h-4" /> : <Clock className="w-4 h-4" />}
                Phase 3 — Execute upgrade via Safe
                {execApprovalCount > 0 && phase === "execute" && <span className="text-xs text-gray-400">({execApprovalCount}/2 approved)</span>}
              </div>
            </div>

            {phase === "cancel" && (
              <div className="mb-4 p-4 bg-red-50 rounded-lg text-sm text-red-700 space-y-1">
                <p className="font-medium">⚠ Broken proposal must be cancelled first</p>
                <p className="text-xs text-red-600">The previous proposal used incorrect function selectors and will revert. Both Safe owners must sign to cancel it before proposing the corrected upgrade.</p>
                <p className="text-xs font-mono break-all text-red-400 mt-1">ID: {BROKEN_PROPOSAL_ID}</p>
              </div>
            )}

            {phase === "waiting" && (
              <div className="mb-4 p-4 bg-blue-50 rounded-lg text-sm text-blue-700 space-y-1">
                <p className="font-medium">Timelock running</p>
                <p>Executable from: <strong>{etaDate}</strong></p>
                <p className="text-xs font-mono break-all text-blue-500">ID: {proposalId}</p>
                <p className="text-xs mt-2 text-blue-600">Come back in ~{hoursLeft} hours. Both owners sign once more to execute.</p>
              </div>
            )}

            {!wallet ? (
              <Button className="w-full" size="lg" onClick={connect}>Connect Wallet</Button>
            ) : !onLisk ? (
              <div className="space-y-2">
                <div className="flex gap-2 p-3 bg-amber-50 rounded-lg text-sm text-amber-700"><AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /><span>Switch to Lisk Mainnet.</span></div>
                <Button className="w-full" onClick={connect}>Reconnect</Button>
              </div>
            ) : !isOwner ? (
              <div className="space-y-2">
                <div className="flex gap-2 p-3 bg-red-50 rounded-lg text-sm text-red-700"><AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /><span>Wrong wallet. Connect one of the 3 Safe owners.</span></div>
                <Button className="w-full" onClick={connect}>Switch wallet</Button>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-gray-500">Connected: {shortAddr(wallet)}</p>
                  <button onClick={connect} className="text-xs text-blue-500 underline">Switch wallet</button>
                </div>

                {/* Phase 0: Cancel broken proposal */}
                {phase === "cancel" && cancelApproval && (
                  <>
                    {!myCancelApproved && (
                      <Button className="w-full bg-red-600 hover:bg-red-700 text-white" size="lg" onClick={approveCancel} disabled={busy}>
                        {busy ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Working…</> : "Approve cancel (Phase 0)"}
                      </Button>
                    )}
                    {myCancelApproved && cancelApprovalCount < 2 && (
                      <div className="p-3 bg-green-50 rounded-lg text-sm text-green-700 text-center">✓ You approved cancel — need one more signer</div>
                    )}
                    {cancelApprovalCount >= 2 && (
                      <Button className="w-full bg-red-600 hover:bg-red-700 text-white" size="lg" onClick={executeCancel} disabled={busy}>
                        {busy ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Cancelling…</> : "Cancel broken proposal ✓"}
                      </Button>
                    )}
                  </>
                )}

                {/* Phase 1: Propose corrected upgrade */}
                {phase === "propose" && proposeApproval && (
                  <>
                    {!myProposeApproved && (
                      <Button className="w-full bg-blue-600 hover:bg-blue-700 text-white" size="lg" onClick={approvePropose} disabled={busy}>
                        {busy ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Working…</> : "Approve proposal (Phase 1)"}
                      </Button>
                    )}
                    {myProposeApproved && proposeApprovalCount < 2 && (
                      <div className="p-3 bg-green-50 rounded-lg text-sm text-green-700 text-center">✓ You approved — need one more signer</div>
                    )}
                    {proposeApprovalCount >= 2 && (
                      <Button className="w-full bg-green-600 hover:bg-green-700 text-white" size="lg" onClick={executePropose} disabled={busy}>
                        {busy ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Submitting…</> : "Submit corrected proposal ✓"}
                      </Button>
                    )}
                  </>
                )}

                {/* Phase 3: Execute upgrade */}
                {phase === "execute" && execApproval && (
                  <>
                    {!myExecApproved && (
                      <Button className="w-full bg-blue-600 hover:bg-blue-700 text-white" size="lg" onClick={approveExecute} disabled={busy}>
                        {busy ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Working…</> : "Approve execution (Phase 3)"}
                      </Button>
                    )}
                    {myExecApproved && execApprovalCount < 2 && (
                      <div className="p-3 bg-green-50 rounded-lg text-sm text-green-700 text-center">✓ You approved — need one more signer</div>
                    )}
                    {execApprovalCount >= 2 && canExecuteTimelock && (
                      <Button className="w-full bg-green-600 hover:bg-green-700 text-white" size="lg" onClick={executeUpgrade} disabled={busy}>
                        {busy ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Executing…</> : "Apply upgrade ✓"}
                      </Button>
                    )}
                    {execApprovalCount >= 2 && !canExecuteTimelock && (
                      <div className="p-3 bg-amber-50 rounded-lg text-sm text-amber-700 text-center">Both approved — waiting for timelock (~{hoursLeft}h)</div>
                    )}
                  </>
                )}
              </div>
            )}
          </>
        )}

        {error && (
          <div className="mt-4 flex gap-2 p-3 bg-red-50 rounded-lg text-xs text-red-700">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span className="break-all">{error.slice(0, 400)}</span>
          </div>
        )}
        {success && <div className="mt-4 p-3 bg-green-50 rounded-lg text-xs text-green-700">{success}</div>}

        <button onClick={() => refreshAll()} className="mt-4 text-xs text-gray-400 underline w-full text-center">Refresh status</button>
      </div>
    </div>
  );
}
