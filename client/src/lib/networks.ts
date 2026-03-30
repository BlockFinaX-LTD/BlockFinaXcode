/**
 * Networks - Blockchain network configurations
 *
 * Defines supported networks with RPC URLs and metadata.
 * Lisk Sepolia is the testnet. Lisk Mainnet (chainId 1135) is the production network.
 * Network mode controlled by VITE_NETWORK_MODE env var (default: "testnet").
 * Set VITE_NETWORK_MODE=mainnet before building for production.
 * Exports: NETWORKS, TESTNET_NETWORKS, MAINNET_NETWORKS, NetworkConfig,
 *          getNetworkById, getNetworkByChainId, DEFAULT_NETWORK, isMainnet, getNetworkMode
 */
export interface NetworkConfig {
  id: number;
  name: string;
  chainId: number;
  rpcUrl: string;
  symbol: string;
  blockExplorerUrl: string;
  isTestnet: boolean;
  color: string;
  icon: string;
}

export type NetworkMode = "testnet" | "mainnet";

export function getNetworkMode(): NetworkMode {
  const mode = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_NETWORK_MODE) || "mainnet";
  return mode === "mainnet" ? "mainnet" : "testnet";
}

export function isMainnet(): boolean {
  return getNetworkMode() === "mainnet";
}

export const TESTNET_NETWORKS: NetworkConfig[] = [
  {
    id: 2,
    name: "Lisk Sepolia",
    chainId: 4202,
    rpcUrl: "https://rpc.sepolia-api.lisk.com",
    symbol: "ETH",
    blockExplorerUrl: "https://sepolia-blockscout.lisk.com",
    isTestnet: true,
    color: "#4070F4",
    icon: "fas fa-cube"
  }
];

export const MAINNET_NETWORKS: NetworkConfig[] = [
  {
    id: 1,
    name: "Lisk",
    chainId: 1135,
    rpcUrl: "https://rpc.api.lisk.com",
    symbol: "ETH",
    blockExplorerUrl: "https://blockscout.lisk.com",
    isTestnet: false,
    color: "#4070F4",
    icon: "fas fa-cube"
  }
];

export const NETWORKS: NetworkConfig[] = getNetworkMode() === "mainnet"
  ? MAINNET_NETWORKS
  : TESTNET_NETWORKS;

export const getNetworkById = (id: number): NetworkConfig | undefined => {
  return NETWORKS.find(network => network.id === id);
};

export const getNetworkByChainId = (chainId: number): NetworkConfig | undefined => {
  return NETWORKS.find(network => network.chainId === chainId);
};

export const DEFAULT_NETWORK = NETWORKS[0];
