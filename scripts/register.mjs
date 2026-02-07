import { createPublicClient, createWalletClient, http, parseAbi } from 'viem';
import { mainnet } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

const IDENTITY_REGISTRY = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432';
const RPC_URL = process.env.ETH_RPC_URL || 'https://eth.llamarpc.com';
const PRIVATE_KEY = process.env.AGENT_WALLET_PRIVATE_KEY;
const AGENT_URI = 'https://commodities-pulse-production.up.railway.app/.well-known/agent-registration.json';

if (!PRIVATE_KEY) {
  console.error('Error: AGENT_WALLET_PRIVATE_KEY environment variable required');
  process.exit(1);
}

const abi = parseAbi([
  'function register(string agentURI) external returns (uint256 agentId)',
]);

async function main() {
  const account = privateKeyToAccount(PRIVATE_KEY);
  console.log(`Registering from wallet: ${account.address}`);
  
  const publicClient = createPublicClient({
    chain: mainnet,
    transport: http(RPC_URL),
  });

  const walletClient = createWalletClient({
    account,
    chain: mainnet,
    transport: http(RPC_URL),
  });

  const balance = await publicClient.getBalance({ address: account.address });
  console.log(`Balance: ${Number(balance) / 1e18} ETH`);

  console.log(`Registering URI: ${AGENT_URI}`);
  
  const hash = await walletClient.writeContract({
    address: IDENTITY_REGISTRY,
    abi,
    functionName: 'register',
    args: [AGENT_URI],
  });

  console.log(`Tx: ${hash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  
  const transferLog = receipt.logs.find(log => 
    log.address.toLowerCase() === IDENTITY_REGISTRY.toLowerCase() && 
    log.topics.length === 4
  );
  
  if (transferLog?.topics[3]) {
    const agentId = parseInt(transferLog.topics[3], 16);
    console.log(`✅ Agent ID: ${agentId}`);
    console.log(`\nUpdate agent-registration.json with:`);
    console.log(`"registrations": [{"agentId": ${agentId}, "agentRegistry": "eip155:1:0x8004A169FB4a3325136EB29fA0ceB6D2e539a432"}]`);
  }
}

main().catch(console.error);
