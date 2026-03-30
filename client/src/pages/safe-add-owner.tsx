import { useState, useEffect, useCallback } from "react";
import { ethers } from "ethers";
import { Button } from "@/components/ui/button";
import { CheckCircle, Loader2, Users, AlertTriangle, Clock } from "lucide-react";

const SAFE      = "0xfce89FA90Ee1C78B15eE0f12f62B03153814699D";
const OWNER_1   = "0xc69352C36562ce2D4C57B38baf47cE7D1eF6b891";
const OWNER_2   = "0x6C0e8E46728953322C83cD2A0c3eDa122F077723";
const NEW_OWNER = "0x331B1ce9250b53e807935F65D5cd04C2234af3a0";
const THRESHOLD = 2; // stays 2-of-3
const LISK_CHAIN_ID = 1135;

const SAFE_ABI = [
  "function nonce() view returns (uint256)",
  "function getOwners() view returns (address[])",
  "function getThreshold() view returns (uint256)",
  "function getTransactionHash(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,uint256) view returns (bytes32)",
  "function approveHash(bytes32) external",
  "function approvedHashes(address,bytes32) view returns (uint256)",
  "function execTransaction(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,bytes) external payable returns (bool)",
];

const ADD_OWNER_DATA = new ethers.Interface([
  "function addOwnerWithThreshold(address owner, uint256 _threshold) external",
]).encodeFunctionData("addOwnerWithThreshold", [NEW_OWNER, THRESHOLD]);

function shortAddr(a: string) { return a.slice(0, 10) + "…" + a.slice(-6); }

interface Status {
  owners: string[];
  threshold: number;
  nonce: number;
  txHash: string;
  owner1Approved: boolean;
  owner2Approved: boolean;
  alreadyAdded: boolean;
}

export default function SafeAddOwner() {
  const [wallet, setWallet]   = useState("");
  const [status, setStatus]   = useState<Status | null>(null);
  const [busy, setBusy]       = useState(false);
  const [error, setError]     = useState("");
  const [success, setSuccess] = useState("");
  const [onLisk, setOnLisk]   = useState(false);

  const loadStatus = useCallback(async () => {
    try {
      const provider = new ethers.JsonRpcProvider("https://rpc.api.lisk.com");
      const safe     = new ethers.Contract(SAFE, SAFE_ABI, provider);

      const [owners, threshold, nonce] = await Promise.all([
        safe.getOwners(),
        safe.getThreshold(),
        safe.nonce(),
      ]);

      const alreadyAdded = (owners as string[]).map((o: string) => o.toLowerCase()).includes(NEW_OWNER.toLowerCase());

      const txHash = await safe.getTransactionHash(
        SAFE, 0, ADD_OWNER_DATA, 0, 0, 0, 0,
        ethers.ZeroAddress, ethers.ZeroAddress, nonce
      );

      const [a1, a2] = await Promise.all([
        safe.approvedHashes(OWNER_1, txHash),
        safe.approvedHashes(OWNER_2, txHash),
      ]);

      setStatus({
        owners: owners as string[],
        threshold: Number(threshold),
        nonce: Number(nonce),
        txHash,
        owner1Approved: a1 > 0n,
        owner2Approved: a2 > 0n,
        alreadyAdded,
      });
    } catch (e: any) {
      setError("Could not load status: " + e.message);
    }
  }, []);

  useEffect(() => { loadStatus(); }, [loadStatus]);

  // Auto-detect MetaMask account switches
  useEffect(() => {
    if (!window.ethereum) return;
    const handler = (accounts: string[]) => {
      setWallet(accounts[0] ?? "");
      setError(""); setSuccess("");
    };
    window.ethereum.on("accountsChanged", handler);
    return () => window.ethereum.removeListener("accountsChanged", handler);
  }, []);

  async function connect() {
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
    const chain   = await provider.getNetwork();
    setWallet(address);
    setOnLisk(Number(chain.chainId) === LISK_CHAIN_ID);
  }

  async function approve() {
    setBusy(true); setError(""); setSuccess("");
    try {
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer   = await provider.getSigner();
      const safe     = new ethers.Contract(SAFE, SAFE_ABI, signer);
      const tx = await safe.approveHash(status!.txHash);
      await tx.wait();
      setSuccess("Approved! Waiting for the other signer.");
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
        SAFE, 0, ADD_OWNER_DATA, 0, 0, 0, 0,
        ethers.ZeroAddress, ethers.ZeroAddress, sigs
      );
      await tx.wait();
      setSuccess("Done! Third owner added. Safe is now 2-of-3.");
      await loadStatus();
    } catch (e: any) { setError(e.message); }
    setBusy(false);
  }

  const isOwner1 = wallet.toLowerCase() === OWNER_1.toLowerCase();
  const isOwner2 = wallet.toLowerCase() === OWNER_2.toLowerCase();
  const isKnown  = isOwner1 || isOwner2;
  const myApproved = isOwner1 ? status?.owner1Approved : isOwner2 ? status?.owner2Approved : false;
  const bothApproved = status?.owner1Approved && status?.owner2Approved;

  function stepDot(done?: boolean, active?: boolean) {
    if (done)   return <CheckCircle className="w-4 h-4 text-green-500 shrink-0 mt-0.5" />;
    if (active) return <Clock className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />;
    return <Clock className="w-4 h-4 text-gray-300 shrink-0 mt-0.5" />;
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-lg border border-gray-100 p-8">

        <div className="text-center mb-6">
          <div className="w-12 h-12 rounded-full bg-purple-50 flex items-center justify-center mx-auto mb-3">
            <Users className="w-6 h-6 text-purple-600" />
          </div>
          <h1 className="text-xl font-bold text-gray-900">Upgrade Safe to 2-of-3</h1>
          <p className="text-sm text-gray-500 mt-1">Add a third signer so losing one key doesn't lock the Safe</p>
        </div>

        <div className="mb-6 space-y-1.5 text-xs">
          {[
            ["Safe", shortAddr(SAFE)],
            ["Current setup", "2-of-2"],
            ["New setup", "2-of-3"],
            ["Adding", shortAddr(NEW_OWNER)],
            ["Threshold", "stays at 2"],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between py-1.5 border-b border-gray-50">
              <span className="text-gray-500">{k}</span>
              <span className="font-mono text-gray-700">{v}</span>
            </div>
          ))}
        </div>

        {status?.alreadyAdded ? (
          <div className="text-center space-y-3">
            <CheckCircle className="w-12 h-12 text-green-500 mx-auto" />
            <p className="font-semibold text-gray-900">Safe is already 2-of-3</p>
            <p className="text-sm text-gray-500">
              {shortAddr(NEW_OWNER)} is already an owner with threshold {status.threshold}.
            </p>
            <a href={`https://blockscout.lisk.com/address/${SAFE}`} target="_blank" rel="noopener noreferrer"
              className="text-xs text-blue-600 underline block">View Safe on Blockscout</a>
          </div>
        ) : (
          <>
            {status && (
              <div className="mb-5 space-y-3 text-sm">
                <div className={`flex items-start gap-3 ${status.owner1Approved ? "text-green-700" : "text-blue-600 font-medium"}`}>
                  {stepDot(status.owner1Approved, !status.owner1Approved)}
                  <div>
                    <p className="font-medium">Owner 1 approves</p>
                    <p className="text-xs text-gray-400">{shortAddr(OWNER_1)}</p>
                  </div>
                </div>
                <div className={`flex items-start gap-3 ${status.owner2Approved ? "text-green-700" : status.owner1Approved ? "text-blue-600 font-medium" : "text-gray-400"}`}>
                  {stepDot(status.owner2Approved, status.owner1Approved && !status.owner2Approved)}
                  <div>
                    <p className="font-medium">Owner 2 approves</p>
                    <p className="text-xs text-gray-400">{shortAddr(OWNER_2)}</p>
                  </div>
                </div>
                <div className={`flex items-start gap-3 ${status.alreadyAdded ? "text-green-700" : bothApproved ? "text-blue-600 font-medium" : "text-gray-400"}`}>
                  {stepDot(status.alreadyAdded, !!bothApproved && !status.alreadyAdded)}
                  <div>
                    <p className="font-medium">Execute</p>
                    <p className="text-xs text-gray-400">Either owner submits the transaction</p>
                  </div>
                </div>
              </div>
            )}

            {!wallet ? (
              <Button className="w-full" size="lg" onClick={connect}>Connect Wallet</Button>
            ) : !onLisk ? (
              <div className="space-y-3">
                <div className="flex gap-2 p-3 bg-amber-50 rounded-lg text-sm text-amber-700">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>Switch to Lisk Mainnet first.</span>
                </div>
                <Button className="w-full" onClick={connect}>Reconnect</Button>
              </div>
            ) : !isKnown ? (
              <div className="space-y-3">
                <div className="flex gap-2 p-3 bg-red-50 rounded-lg text-sm text-red-700">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>Wrong wallet. Connect Owner 1 or Owner 2.</span>
                </div>
                <Button className="w-full" onClick={connect}>Switch wallet</Button>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-gray-500">Connected: {shortAddr(wallet)}</p>
                  <button onClick={connect} className="text-xs text-blue-500 underline">Switch wallet</button>
                </div>

                {!myApproved && (
                  <Button className="w-full bg-purple-600 hover:bg-purple-700 text-white" size="lg" onClick={approve} disabled={busy}>
                    {busy ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Working…</> : `Approve as ${isOwner1 ? "Owner 1" : "Owner 2"}`}
                  </Button>
                )}
                {myApproved && !bothApproved && (
                  <div className="p-3 bg-green-50 rounded-lg text-sm text-green-700 text-center">
                    ✓ You approved — waiting for the other signer
                  </div>
                )}
                {bothApproved && (
                  <Button className="w-full bg-green-600 hover:bg-green-700 text-white" size="lg" onClick={execute} disabled={busy}>
                    {busy ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Executing…</> : "Execute — both approved ✓"}
                  </Button>
                )}
              </div>
            )}
          </>
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

        <button onClick={loadStatus} className="mt-4 text-xs text-gray-400 underline w-full text-center">
          Refresh status
        </button>
      </div>
    </div>
  );
}
