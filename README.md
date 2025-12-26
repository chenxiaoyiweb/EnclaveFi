# EnclaveFi

EnclaveFi is an encrypted staking application for ETH and mUSDT built on Zama FHEVM. It keeps staking balances and
rewards confidential while still allowing users to earn, claim, and withdraw on-chain. The core idea is simple:
stake privately, accrue predictable interest, and decrypt only when you choose.

This repository contains:
- Solidity smart contracts for encrypted staking and a confidential ERC-7984 reward token.
- Hardhat deployment, tasks, and tests for local and Sepolia workflows.
- A React + Vite frontend that uses Zama's relayer SDK for encryption and decryption.

## Problem Statement
Traditional staking reveals balances and reward history on-chain, which exposes user strategies, sizes, and timing.
This project solves that privacy gap by moving stake balances and rewards into FHE-encrypted state while preserving
normal staking actions and reward collection.

## What This Project Solves
- Privacy leakage of staked balances and rewards.
- On-chain visibility of user behavior (stake size, frequency, and timing).
- The need to trust a custodian or off-chain database to hide balances.

## Advantages
- Encrypted balances: stake amounts are stored as FHE ciphertexts on-chain.
- User-controlled decryption: balances can be decrypted publicly (for proofs) or privately (for the user).
- Non-custodial design: assets stay in the smart contracts, not in a centralized wallet.
- Deterministic rewards: interest is accrued deterministically on-chain.
- Composable architecture: standard tooling for deployment, tasks, and frontend integration.

## Core Features
- Stake ETH with encrypted accounting.
- Stake mUSDT (confidential ERC-7984 token) using encrypted inputs.
- Continuous interest accrual:
  - 1 ETH staked for 1 day earns 1 mUSDT.
  - 1 mUSDT staked for 1 day earns 1% interest.
- Claim rewards at any time (minted as encrypted mUSDT).
- Withdraw ETH after providing a public decryption proof.
- Frontend display of encrypted balances and optional local decryption of mUSDT balance.

## How It Works

### Smart Contracts
1. `EncryptedStaking` stores encrypted stake balances and pending rewards.
2. `MockUSDT` is a confidential ERC-7984 token used as the reward asset (mUSDT).

Key state (all encrypted):
- `ethStake` (euint128)
- `musdtStake` (euint128)
- `pendingRewards` (euint128)

### Encryption Model
- Stakes are stored as FHE ciphertexts (euint128 / euint64).
- The contract shares ciphertext permissions with the user and optionally makes values publicly decryptable.
- Withdrawals require a public decryption proof to validate the clear ETH stake before sending ETH.

### Interest Model
Rewards are accrued when users interact with the contract:
- ETH interest:
  - `ethReward = ethStakeWei * elapsedSeconds / 86400 / 1e12`
  - This yields 1 mUSDT per ETH per day.
- mUSDT interest:
  - `musdtReward = musdtStake * elapsedSeconds / 86400 / 100`
  - This yields 1% per day on mUSDT.
- `pendingRewards` accumulates both sources and is minted as encrypted mUSDT.

### User Flows
- Stake ETH: call `stakeEth()` with ETH value.
- Stake mUSDT: call `stakeMusdt()` with encrypted input.
- Sync rewards: call `syncRewards()` to refresh pending rewards.
- Claim rewards: call `claimRewards()` to mint encrypted mUSDT.
- Withdraw ETH: call `withdrawEth()` with a public decryption proof of the encrypted stake handle.

## Frontend Behavior
- Uses Zama relayer SDK to create encrypted inputs and request decryption.
- Uses viem for on-chain reads and ethers for writes.
- Uses RainbowKit + wagmi for wallet connection and chain switching.
- Targets Sepolia only (no localhost chain configuration).
- Avoids local storage; state is kept in memory.
- No frontend environment variables; contract addresses and ABI live in TypeScript config.

## Tech Stack
- Smart contracts: Solidity 0.8.27, Zama FHEVM, OpenZeppelin Confidential ERC-7984
- Tooling: Hardhat, hardhat-deploy, TypeChain
- Frontend: React, Vite, TypeScript, RainbowKit, wagmi, viem, ethers
- Encryption: @zama-fhe/relayer-sdk

## Project Structure
```
contracts/                 Smart contracts
deploy/                    Hardhat deploy scripts
deployments/               Deployment outputs and ABI
tasks/                     Hardhat tasks for decryption and addresses
test/                      Contract tests
app/                       React frontend
```

## Setup

### Prerequisites
- Node.js 20+
- npm

### Install Dependencies
From the repository root:
```bash
npm install
```

From the frontend:
```bash
cd app
npm install
```

### Environment Configuration (Hardhat)
Create a `.env` file at the repository root:
```bash
INFURA_API_KEY=your_infura_key
PRIVATE_KEY=0x_your_private_key
ETHERSCAN_API_KEY=your_etherscan_key
```
Notes:
- Use a private key, not a mnemonic.
- The deployer account must have Sepolia ETH for gas.

## Build and Test
```bash
npm run compile
npm run test
```

## Deploy Workflow
Recommended flow:
1. Deploy locally and run tasks/tests.
2. Deploy to Sepolia with a private key.

### Local Deployment (Hardhat Network)
```bash
npx hardhat deploy
```

### Sepolia Deployment
```bash
npx hardhat deploy --network sepolia
```

### Verify on Sepolia
```bash
npx hardhat verify --network sepolia <CONTRACT_ADDRESS>
```

## Hardhat Tasks
```bash
npx hardhat task:staking-addresses
npx hardhat task:decrypt-eth-stake --user 0xYourAddress
npx hardhat task:decrypt-rewards --user 0xYourAddress
```

## Frontend Configuration
After deploying to Sepolia:
1. Copy contract addresses into `app/src/config/contracts.ts`.
2. Copy ABI entries from `deployments/sepolia/EncryptedStaking.json` and
   `deployments/sepolia/MockUSDT.json` into `app/src/config/contracts.ts`.
3. Ensure the chain ID remains Sepolia (11155111).

## Run Frontend
```bash
cd app
npm run dev
```

## Security and Privacy Notes
- This is a prototype and has not been audited.
- FHE-encrypted balances still require careful key handling in the client.
- Public decryption proofs are required to withdraw ETH.
- mUSDT is a mock reward token and is not a stablecoin.

## Future Roadmap
- Mainnet-ready deployment configuration.
- Support for multiple staking assets beyond ETH and mUSDT.
- Governance-controlled reward rates.
- Auto-compounding and restaking flows.
- Enhanced analytics with opt-in decryption.
- Permit-based approvals for confidential tokens.
- Extended test coverage and formal verification.
- Security audit and bug bounty.

## License
BSD-3-Clause-Clear. See `LICENSE`.

## Acknowledgements
Built with Zama FHEVM and the confidential contracts stack.
