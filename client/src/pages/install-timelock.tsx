import { useState } from "react";
import { ethers } from "ethers";
import { Button } from "@/components/ui/button";
import { CheckCircle, Loader2, ShieldCheck, AlertTriangle } from "lucide-react";

const DIAMOND          = "0x885E663645173a0791b82f0e6608921D31E3D700";
const OWNER            = "0xc69352C36562ce2D4C57B38baf47cE7D1eF6b891";
const TIMELOCK_FACET   = "0xAdf298592e50190BAbfd3a960C78bA9A78793757";
const OLD_CUT_FACET    = "0x3581E16414286AD77601f9489F26a11eD96A9Be4";
const LISK_CHAIN_ID    = 1135;

const DIAMOND_CUT_ABI = [
  "function diamondCut(tuple(address facetAddress, uint8 action, bytes4[] functionSelectors)[] _diamondCut, address _init, bytes _calldata) external",
];

const TIMELOCK_IFACE = new ethers.Interface([
  "function diamondCut(tuple(address,uint8,bytes4[])[] _facetCuts, address _init, bytes _callData)",
  "function executePendingCut(bytes32 _proposalId)",
  "function cancelPendingCut(bytes32 _proposalId)",
  "function getPendingCutIds() view returns (bytes32[])",
  "function getPendingCutInfo(bytes32 _proposalId) view returns (uint256 eta, bool executed, bool cancelled)",
  "function TIMELOCK_DELAY() view returns (uint256)",
]);

function getSelectors(iface: ethers.Interface): string[] {
  return iface.fragments
    .filter(f => f.type === "function")
    .map(f => iface.getFunction((f as ethers.FunctionFragment).name)!.selector);
}

const TIMELOCK_SELECTORS = getSelectors(TIMELOCK_IFACE);
const OLD_DIAMONDCUT_SELECTOR = "0x1f931c1c";

type Phase = "idle" | "connecting" | "wrong-network" | "wrong-wallet" | "ready" | "submitting" | "done" | "error";

export default function InstallTimelock() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [txHash, setTxHash] = useState("");
  const [error, setError]   = useState("");

  async function connect() {
    setPhase("connecting");
    setError("");
    try {
      if (!window.ethereum) throw new Error("No wallet detected. Open inside MetaMask's browser.");
      const provider = new ethers.BrowserProvider(window.ethereum);
      await provider.send("eth_requestAccounts", []);

      const network = await provider.getNetwork();
      if (Number(network.chainId) !== LISK_CHAIN_ID) {
        try {
          await provider.send("wallet_switchEthereumChain", [{ chainId: "0x46F" }]);
        } catch {
          await provider.send("wallet_addEthereumChain", [{
            chainId: "0x46F",
            chainName: "Lisk",
            nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
            rpcUrls: ["https://rpc.api.lisk.com"],
            blockExplorerUrls: ["https://blockscout.lisk.com"],
          }]);
        }
        setPhase("wrong-network");
        return;
      }

      const signer  = await provider.getSigner();
      const address = await signer.getAddress();
      if (address.toLowerCase() !== OWNER.toLowerCase()) {
        setPhase("wrong-wallet");
        return;
      }

      setPhase("ready");
    } catch (e: any) {
      setError(e.message || "Connection failed");
      setPhase("error");
    }
  }

  async function install() {
    setPhase("submitting");
    setError("");
    try {
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer   = await provider.getSigner();
      const diamond  = new ethers.Contract(DIAMOND, DIAMOND_CUT_ABI, signer);

      const cuts = [
        {
          facetAddress: ethers.ZeroAddress,
          action: 2,
          functionSelectors: [OLD_DIAMONDCUT_SELECTOR],
        },
        {
          facetAddress: TIMELOCK_FACET,
          action: 0,
          functionSelectors: TIMELOCK_SELECTORS,
        },
      ];

      const tx = await diamond.diamondCut(cuts, ethers.ZeroAddress, "0x");
      setTxHash(tx.hash);
      await tx.wait();
      setPhase("done");
    } catch (e: any) {
      setError(e.message || "Transaction failed");
      setPhase("error");
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-lg border border-gray-100 p-8">
        <div className="text-center mb-6">
          <div className="w-12 h-12 rounded-full bg-green-50 flex items-center justify-center mx-auto mb-4">
            <ShieldCheck className="w-6 h-6 text-green-600" />
          </div>
          <h1 className="text-xl font-bold text-gray-900">Install 48-hour Timelock</h1>
          <p className="text-sm text-gray-500 mt-1">
            After this, all future Diamond upgrades require a 48-hour waiting period.
          </p>
        </div>

        <div className="mb-6 space-y-3 text-sm">
          <div className="p-3 bg-blue-50 rounded-lg text-blue-800 text-xs space-y-1">
            <p className="font-semibold">What this does (1 transaction):</p>
            <p>① Removes the instant-upgrade function</p>
            <p>② Installs timelocked upgrade functions (propose → wait 48h → execute)</p>
            <p>③ Adds cancel function for emergencies</p>
          </div>
          <div className="flex justify-between py-1.5 border-b border-gray-100 text-xs">
            <span className="text-gray-500">Timelock facet</span>
            <span className="font-mono text-gray-700">{TIMELOCK_FACET.slice(0,10)}…{TIMELOCK_FACET.slice(-6)}</span>
          </div>
          <div className="flex justify-between py-1.5 text-xs">
            <span className="text-gray-500">Delay</span>
            <span className="text-gray-700 font-semibold">48 hours</span>
          </div>
        </div>

        {phase === "done" ? (
          <div className="text-center space-y-3">
            <CheckCircle className="w-12 h-12 text-green-500 mx-auto" />
            <p className="font-semibold text-gray-900">Timelock installed</p>
            <p className="text-sm text-gray-500">All future upgrades now require a 48-hour delay.</p>
            {txHash && (
              <a href={`https://blockscout.lisk.com/tx/${txHash}`} target="_blank" rel="noopener noreferrer"
                className="text-xs text-blue-600 underline block">
                View transaction on Blockscout
              </a>
            )}
          </div>
        ) : phase === "wrong-network" ? (
          <div className="space-y-4">
            <div className="flex gap-2 p-3 bg-amber-50 rounded-lg text-sm text-amber-700">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>Switched to Lisk. Tap Connect again.</span>
            </div>
            <Button className="w-full" onClick={connect}>Try Again</Button>
          </div>
        ) : phase === "wrong-wallet" ? (
          <div className="space-y-4">
            <div className="flex gap-2 p-3 bg-red-50 rounded-lg text-sm text-red-700">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <div>
                <p className="font-medium">Wrong wallet. Switch to:</p>
                <p className="font-mono text-xs mt-1 break-all">{OWNER}</p>
              </div>
            </div>
            <Button className="w-full" onClick={connect}>Try Again</Button>
          </div>
        ) : phase === "ready" ? (
          <Button className="w-full bg-green-600 hover:bg-green-700 text-white" size="lg" onClick={install}>
            Install Timelock (1 transaction)
          </Button>
        ) : phase === "submitting" ? (
          <Button className="w-full" size="lg" disabled>
            <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Installing…
          </Button>
        ) : phase === "error" ? (
          <div className="space-y-4">
            <div className="flex gap-2 p-3 bg-red-50 rounded-lg text-sm text-red-700">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span className="text-xs">{error.slice(0, 300)}</span>
            </div>
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
