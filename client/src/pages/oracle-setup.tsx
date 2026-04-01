import { useState } from "react";
import { ethers } from "ethers";
import { Button } from "@/components/ui/button";
import { CheckCircle, Loader2, Radio, AlertTriangle } from "lucide-react";

const DIAMOND   = "0x885E663645173a0791b82f0e6608921D31E3D700";
const OWNER     = "0xc69352C36562ce2D4C57B38baf47cE7D1eF6b891";
const LISK_CHAIN_ID = 1135;

const ORACLES = [
  "0xf4Ad53C78b93Ce346BBF16bF3131019549fB7be2",
  "0x208fb5D8CebCC0A02d9Ae4280657Aa33EbafEfCF",
  "0x4A864f7d32FbdC3c09975fbd1B6715b4d1Fa0c5c",
];

const ABI = [
  "function addOracle(address _oracle) external",
  "function setRequiredSigners(uint256 _required) external",
  "function activateOracleV2() external",
  "function getOracles() view returns (address[])",
  "function getOracleConfig() view returns (uint256 requiredSigners, uint256 toleranceBps, bool v2Active)",
];

type Phase = "idle" | "connecting" | "wrong-network" | "wrong-wallet" | "ready" | "running" | "done" | "error";

interface LogEntry { text: string; ok: boolean; }

export default function OracleSetup() {
  const [phase, setPhase]   = useState<Phase>("idle");
  const [logs, setLogs]     = useState<LogEntry[]>([]);
  const [error, setError]   = useState("");

  function log(text: string, ok = true) {
    setLogs(prev => [...prev, { text, ok }]);
  }

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

      const signer = await provider.getSigner();
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

  async function runSetup() {
    setPhase("running");
    setLogs([]);
    setError("");
    try {
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer   = await provider.getSigner();
      const contract = new ethers.Contract(DIAMOND, ABI, signer);

      for (const oracle of ORACLES) {
        log(`Adding oracle ${oracle.slice(0, 10)}…`, true);
        const tx = await contract.addOracle(oracle);
        await tx.wait();
        log(`✓ Added ${oracle.slice(0, 10)}…${oracle.slice(-6)}`, true);
      }

      log("Setting required signers to 2…");
      const tx2 = await contract.setRequiredSigners(2);
      await tx2.wait();
      log("✓ Required signers set to 2", true);

      log("Activating oracle v2…");
      const tx3 = await contract.activateOracleV2();
      await tx3.wait();
      log("✓ Oracle v2 activated", true);

      setPhase("done");
    } catch (e: any) {
      const msg = e.message || "Transaction failed";
      log("✗ " + msg.slice(0, 120), false);
      setError(msg);
      setPhase("error");
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-lg border border-gray-100 p-8">
        <div className="text-center mb-6">
          <div className="w-12 h-12 rounded-full bg-purple-50 flex items-center justify-center mx-auto mb-4">
            <Radio className="w-6 h-6 text-purple-600" />
          </div>
          <h1 className="text-xl font-bold text-gray-900">Oracle Setup</h1>
          <p className="text-sm text-gray-500 mt-1">Register oracles, set 2 required signers, and activate v2</p>
        </div>

        <div className="mb-6 space-y-1">
          {ORACLES.map((o, i) => (
            <div key={o} className="flex items-center gap-2 text-xs py-1.5 border-b border-gray-50">
              <span className="w-5 h-5 rounded-full bg-purple-100 text-purple-700 flex items-center justify-center font-semibold shrink-0">{i + 1}</span>
              <span className="font-mono text-gray-600 break-all">{o.slice(0, 12)}…{o.slice(-8)}</span>
            </div>
          ))}
        </div>

        {logs.length > 0 && (
          <div className="mb-6 bg-gray-50 rounded-lg p-3 space-y-1">
            {logs.map((l, i) => (
              <p key={i} className={`text-xs font-mono ${l.ok ? "text-gray-700" : "text-red-600"}`}>{l.text}</p>
            ))}
          </div>
        )}

        {phase === "done" ? (
          <div className="text-center space-y-2">
            <CheckCircle className="w-12 h-12 text-green-500 mx-auto" />
            <p className="font-semibold text-gray-900">Oracles are live</p>
            <p className="text-sm text-gray-500">3 oracles registered, 2-of-3 consensus required, v2 active.</p>
          </div>
        ) : phase === "wrong-network" ? (
          <div className="space-y-4">
            <div className="flex gap-2 p-3 bg-amber-50 rounded-lg text-sm text-amber-700">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>Switched to Lisk. Tap Connect again to continue.</span>
            </div>
            <Button className="w-full" onClick={connect}>Try Again</Button>
          </div>
        ) : phase === "wrong-wallet" ? (
          <div className="space-y-4">
            <div className="flex gap-2 p-3 bg-red-50 rounded-lg text-sm text-red-700">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <div>
                <p className="font-medium">Wrong wallet — switch to owner wallet:</p>
                <p className="font-mono text-xs mt-1 break-all">{OWNER}</p>
              </div>
            </div>
            <Button className="w-full" onClick={connect}>Try Again</Button>
          </div>
        ) : phase === "ready" ? (
          <Button className="w-full bg-purple-600 hover:bg-purple-700 text-white" size="lg" onClick={runSetup}>
            Run Oracle Setup (5 transactions)
          </Button>
        ) : phase === "running" ? (
          <Button className="w-full" size="lg" disabled>
            <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Working… approve each transaction
          </Button>
        ) : phase === "error" ? (
          <div className="space-y-4">
            <div className="flex gap-2 p-3 bg-red-50 rounded-lg text-sm text-red-700">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error.slice(0, 200)}</span>
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
