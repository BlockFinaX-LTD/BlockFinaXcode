import { useState } from "react";
import { ethers } from "ethers";
import { Button } from "@/components/ui/button";
import { CheckCircle, Loader2, Wallet, AlertTriangle } from "lucide-react";

const DIAMOND   = "0x885E663645173a0791b82f0e6608921D31E3D700";
const NEW_OWNER = "0xc69352C36562ce2D4C57B38baf47cE7D1eF6b891";
const LISK_CHAIN_ID = 1135;

const ABI = ["function acceptOwnership() external", "function pendingOwner() view returns (address)"];

type Step = "idle" | "connecting" | "wrong-network" | "wrong-wallet" | "ready" | "submitting" | "done" | "error";

export default function AcceptOwnership() {
  const [step, setStep]   = useState<Step>("idle");
  const [txHash, setTxHash] = useState("");
  const [error, setError]   = useState("");

  async function connect() {
    setStep("connecting");
    setError("");
    try {
      if (!window.ethereum) throw new Error("No wallet detected. Open this page inside MetaMask's browser.");
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
        setStep("wrong-network");
        return;
      }

      const signer = await provider.getSigner();
      const address = await signer.getAddress();
      if (address.toLowerCase() !== NEW_OWNER.toLowerCase()) {
        setStep("wrong-wallet");
        return;
      }

      setStep("ready");
    } catch (e: any) {
      setError(e.message || "Connection failed");
      setStep("error");
    }
  }

  async function accept() {
    setStep("submitting");
    setError("");
    try {
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer   = await provider.getSigner();
      const contract = new ethers.Contract(DIAMOND, ABI, signer);
      const tx = await contract.acceptOwnership();
      setTxHash(tx.hash);
      await tx.wait();
      setStep("done");
    } catch (e: any) {
      setError(e.message || "Transaction failed");
      setStep("error");
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-lg border border-gray-100 p-8">
        <div className="text-center mb-8">
          <div className="w-12 h-12 rounded-full bg-blue-50 flex items-center justify-center mx-auto mb-4">
            <Wallet className="w-6 h-6 text-blue-600" />
          </div>
          <h1 className="text-xl font-bold text-gray-900">Accept Protocol Ownership</h1>
          <p className="text-sm text-gray-500 mt-1">One-time admin action — transfers Diamond ownership to your wallet</p>
        </div>

        <div className="space-y-3 mb-8 text-sm">
          <div className="flex justify-between py-2 border-b border-gray-100">
            <span className="text-gray-500">Diamond</span>
            <span className="font-mono text-gray-700 text-xs">{DIAMOND.slice(0,10)}…{DIAMOND.slice(-6)}</span>
          </div>
          <div className="flex justify-between py-2 border-b border-gray-100">
            <span className="text-gray-500">New owner</span>
            <span className="font-mono text-gray-700 text-xs">{NEW_OWNER.slice(0,10)}…{NEW_OWNER.slice(-6)}</span>
          </div>
          <div className="flex justify-between py-2">
            <span className="text-gray-500">Network</span>
            <span className="text-gray-700">Lisk Mainnet</span>
          </div>
        </div>

        {step === "done" ? (
          <div className="text-center space-y-3">
            <CheckCircle className="w-12 h-12 text-green-500 mx-auto" />
            <p className="font-semibold text-gray-900">Ownership transferred successfully</p>
            <p className="text-sm text-gray-500">Your wallet now owns the BlockFinaX Diamond.</p>
            {txHash && (
              <a href={`https://blockscout.lisk.com/tx/${txHash}`} target="_blank" rel="noopener noreferrer"
                className="text-xs text-blue-600 underline block">
                View transaction on Blockscout
              </a>
            )}
          </div>
        ) : step === "wrong-network" ? (
          <div className="space-y-4">
            <div className="flex gap-2 p-3 bg-amber-50 rounded-lg text-sm text-amber-700">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>Network switched to Lisk. Tap Connect again to continue.</span>
            </div>
            <Button className="w-full" onClick={connect}>Try Again</Button>
          </div>
        ) : step === "wrong-wallet" ? (
          <div className="space-y-4">
            <div className="flex gap-2 p-3 bg-red-50 rounded-lg text-sm text-red-700">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <div>
                <p className="font-medium">Wrong wallet connected</p>
                <p className="mt-1">Switch to:<br />
                  <span className="font-mono break-all">{NEW_OWNER}</span>
                </p>
              </div>
            </div>
            <Button className="w-full" onClick={connect}>Try Again</Button>
          </div>
        ) : step === "ready" ? (
          <Button className="w-full bg-blue-600 hover:bg-blue-700 text-white" size="lg" onClick={accept}>
            Accept Ownership
          </Button>
        ) : step === "submitting" ? (
          <Button className="w-full" size="lg" disabled>
            <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Submitting…
          </Button>
        ) : step === "error" ? (
          <div className="space-y-4">
            <div className="flex gap-2 p-3 bg-red-50 rounded-lg text-sm text-red-700">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
            <Button className="w-full" onClick={connect}>Try Again</Button>
          </div>
        ) : (
          <Button className="w-full" size="lg" onClick={connect} disabled={step === "connecting"}>
            {step === "connecting" ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Connecting…</> : "Connect Wallet"}
          </Button>
        )}
      </div>
    </div>
  );
}
