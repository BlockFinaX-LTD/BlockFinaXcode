import { useState, useEffect } from "react";
import { ethers } from "ethers";
import { Button } from "@/components/ui/button";
import { CheckCircle, Loader2, ShieldCheck, AlertTriangle, Clock } from "lucide-react";

const DIAMOND           = "0x885E663645173a0791b82f0e6608921D31E3D700";
const OWNERSHIP_FACET   = "0xBf3229c324A18Ab71743eE469c3dbD2214c0DA2E";
const OWNER             = "0xc69352C36562ce2D4C57B38baf47cE7D1eF6b891";
const LISK_CHAIN_ID     = 1135;
const OWNER_SELECTOR    = "0x8da5cb5b"; // owner()

const CUT_ABI = [
  "function diamondCut(tuple(address facetAddress, uint8 action, bytes4[] functionSelectors)[] _diamondCut, address _init, bytes _calldata) external",
];

const TIMELOCK_ABI = [
  "event CutProposed(bytes32 indexed proposalId, uint256 eta)",
  "function getPendingCutIds() view returns (bytes32[])",
  "function getPendingCutInfo(bytes32) view returns (uint256 eta, bool executed, bool cancelled)",
  "function executePendingCut(bytes32 _proposalId) external",
];

type Phase = "idle" | "connecting" | "wrong-network" | "wrong-wallet" | "ready" | "proposing" | "proposed" | "executing" | "done" | "error";

export default function ProposeOwnershipFacet() {
  const [phase, setPhase]       = useState<Phase>("idle");
  const [error, setError]       = useState("");
  const [proposalId, setProposalId] = useState("");
  const [eta, setEta]           = useState(0);
  const [canExecute, setCanExecute] = useState(false);
  const [txHash, setTxHash]     = useState("");

  useEffect(() => {
    if (!eta) return;
    const check = () => setCanExecute(Date.now() / 1000 >= eta);
    check();
    const t = setInterval(check, 10000);
    return () => clearInterval(t);
  }, [eta]);

  async function connect() {
    setPhase("connecting"); setError("");
    try {
      if (!window.ethereum) throw new Error("Open inside MetaMask's browser.");
      const provider = new ethers.BrowserProvider(window.ethereum);
      await provider.send("eth_requestAccounts", []);
      const net = await provider.getNetwork();
      if (Number(net.chainId) !== LISK_CHAIN_ID) {
        try { await provider.send("wallet_switchEthereumChain", [{ chainId: "0x46F" }]); }
        catch { await provider.send("wallet_addEthereumChain", [{ chainId: "0x46F", chainName: "Lisk", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: ["https://rpc.api.lisk.com"], blockExplorerUrls: ["https://blockscout.lisk.com"] }]); }
        setPhase("wrong-network"); return;
      }
      const signer  = await provider.getSigner();
      const address = await signer.getAddress();
      if (address.toLowerCase() !== OWNER.toLowerCase()) { setPhase("wrong-wallet"); return; }
      setPhase("ready");
    } catch (e: any) { setError(e.message); setPhase("error"); }
  }

  async function propose() {
    setPhase("proposing"); setError("");
    try {
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer   = await provider.getSigner();
      const diamond  = new ethers.Contract(DIAMOND, CUT_ABI, signer);

      const cut = [{ facetAddress: OWNERSHIP_FACET, action: 0, functionSelectors: [OWNER_SELECTOR] }];
      const tx  = await diamond.diamondCut(cut, ethers.ZeroAddress, "0x");
      const receipt = await tx.wait();

      // Find CutProposed event (timelock) or DiamondCut event (no timelock)
      const timelockIface = new ethers.Interface(TIMELOCK_ABI);
      let foundProposal = false;
      for (const log of receipt.logs) {
        try {
          const parsed = timelockIface.parseLog({ topics: log.topics, data: log.data });
          if (parsed?.name === "CutProposed") {
            setProposalId(parsed.args.proposalId);
            setEta(Number(parsed.args.eta));
            setPhase("proposed");
            foundProposal = true;
            break;
          }
        } catch {}
      }
      if (!foundProposal) {
        // No timelock — executed immediately
        setTxHash(tx.hash);
        setPhase("done");
      }
    } catch (e: any) { setError(e.message); setPhase("error"); }
  }

  async function execute() {
    setPhase("executing"); setError("");
    try {
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer   = await provider.getSigner();
      const diamond  = new ethers.Contract(DIAMOND, TIMELOCK_ABI, signer);
      const tx = await diamond.executePendingCut(proposalId);
      setTxHash(tx.hash);
      await tx.wait();
      setPhase("done");
    } catch (e: any) { setError(e.message); setPhase("error"); }
  }

  const etaDate = eta ? new Date(eta * 1000).toLocaleString() : "";
  const hoursLeft = eta ? Math.max(0, Math.ceil((eta - Date.now() / 1000) / 3600)) : 0;

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-lg border border-gray-100 p-8">
        <div className="text-center mb-6">
          <div className="w-12 h-12 rounded-full bg-indigo-50 flex items-center justify-center mx-auto mb-3">
            <ShieldCheck className="w-6 h-6 text-indigo-600" />
          </div>
          <h1 className="text-xl font-bold text-gray-900">Add owner() to Diamond</h1>
          <p className="text-sm text-gray-500 mt-1">Registers the standard ownership facet so auditors and tools can read the owner directly</p>
        </div>

        <div className="mb-6 space-y-1.5 text-xs">
          {[
            ["Action", "Add owner() function"],
            ["New facet", "0xBf3229…DA2E (OwnershipFacet)"],
            ["Selector added", "0x8da5cb5b (owner())"],
            ["Delay", "48 hours (timelock)"],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between py-1.5 border-b border-gray-50">
              <span className="text-gray-500">{k}</span>
              <span className="font-mono text-gray-700">{v}</span>
            </div>
          ))}
        </div>

        {phase === "done" ? (
          <div className="text-center space-y-3">
            <CheckCircle className="w-12 h-12 text-green-500 mx-auto" />
            <p className="font-semibold text-gray-900">owner() is now live on the Diamond</p>
            <p className="text-sm text-gray-500">Auditors and block explorers can now read the Diamond owner via the standard owner() call.</p>
            {txHash && (
              <a href={`https://blockscout.lisk.com/tx/${txHash}`} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 underline block">View on Blockscout</a>
            )}
          </div>
        ) : phase === "proposed" ? (
          <div className="space-y-4">
            <div className="p-4 bg-blue-50 rounded-lg space-y-2">
              <div className="flex items-center gap-2 text-blue-700 font-medium text-sm">
                <Clock className="w-4 h-4" /> Upgrade proposed — 48-hour timelock running
              </div>
              <p className="text-xs text-blue-600">Executable at: <strong>{etaDate}</strong></p>
              {hoursLeft > 0 && <p className="text-xs text-blue-600">{hoursLeft}h remaining</p>}
              <p className="text-xs text-gray-500 font-mono break-all">ID: {proposalId}</p>
            </div>
            <Button
              className="w-full bg-green-600 hover:bg-green-700 text-white"
              size="lg"
              onClick={execute}
              disabled={!canExecute || phase === "executing"}
            >
              {phase === "executing"
                ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Executing…</>
                : canExecute
                  ? "Execute Upgrade"
                  : `Come back in ${hoursLeft}h to execute`}
            </Button>
            <p className="text-xs text-center text-gray-400">Bookmark this page — you'll return here in 48 hours to complete the upgrade.</p>
          </div>
        ) : phase === "wrong-network" ? (
          <div className="space-y-3">
            <div className="flex gap-2 p-3 bg-amber-50 rounded-lg text-sm text-amber-700"><AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /><span>Switched to Lisk. Tap Connect again.</span></div>
            <Button className="w-full" onClick={connect}>Try Again</Button>
          </div>
        ) : phase === "wrong-wallet" ? (
          <div className="space-y-3">
            <div className="flex gap-2 p-3 bg-red-50 rounded-lg text-sm text-red-700"><AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /><div><p className="font-medium">Wrong wallet. Switch to owner:</p><p className="font-mono text-xs mt-1 break-all">{OWNER}</p></div></div>
            <Button className="w-full" onClick={connect}>Try Again</Button>
          </div>
        ) : phase === "ready" ? (
          <Button className="w-full bg-indigo-600 hover:bg-indigo-700 text-white" size="lg" onClick={propose}>
            Propose Upgrade
          </Button>
        ) : phase === "proposing" ? (
          <Button className="w-full" size="lg" disabled>
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />Proposing…
          </Button>
        ) : phase === "error" ? (
          <div className="space-y-3">
            <div className="flex gap-2 p-3 bg-red-50 rounded-lg text-xs text-red-700"><AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /><span className="break-all">{error.slice(0, 300)}</span></div>
            <Button className="w-full" onClick={connect}>Try Again</Button>
          </div>
        ) : (
          <Button className="w-full" size="lg" onClick={connect} disabled={phase === "connecting"}>
            {phase === "connecting" ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Connecting…</> : "Connect Wallet"}
          </Button>
        )}
      </div>
    </div>
  );
}
