import { useEffect, useMemo, useState } from 'react';
import { Contract, formatEther, formatUnits, parseEther, parseUnits } from 'ethers';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { decodeAbiParameters, isAddress } from 'viem';
import { useAccount, usePublicClient, useSwitchChain } from 'wagmi';

import {
  MUSDT_ABI,
  MUSDT_ADDRESS,
  MUSDT_DECIMALS,
  STAKING_ABI,
  STAKING_ADDRESS,
  TARGET_CHAIN_ID,
} from '../config/contracts';
import { useEthersSigner } from '../hooks/useEthersSigner';
import { useZamaInstance } from '../hooks/useZamaInstance';
import '../styles/Dashboard.css';

const ZERO_HANDLE = '0x0000000000000000000000000000000000000000000000000000000000000000';
const MAX_UINT64 = (1n << 64n) - 1n;

type Position = {
  ethStake: `0x${string}`;
  musdtStake: `0x${string}`;
  pendingRewards: `0x${string}`;
  lastUpdated: bigint;
};

type DecryptedPosition = {
  ethStake?: bigint;
  musdtStake?: bigint;
  pendingRewards?: bigint;
};

export function StakeDashboard() {
  const { address, chainId, isConnected } = useAccount();
  const signerPromise = useEthersSigner({ chainId: TARGET_CHAIN_ID });
  const { switchChain } = useSwitchChain();
  const publicClient = usePublicClient({ chainId: TARGET_CHAIN_ID });
  const { instance, isLoading: zamaLoading, error: zamaError } = useZamaInstance();
  const queryClient = useQueryClient();

  const [stakeEthInput, setStakeEthInput] = useState('');
  const [stakeMusdtInput, setStakeMusdtInput] = useState('');
  const [withdrawInput, setWithdrawInput] = useState('');
  const [musdtClearBalance, setMusdtClearBalance] = useState<string>('');
  const [decryptedPosition, setDecryptedPosition] = useState<DecryptedPosition>({});
  const [actionMessage, setActionMessage] = useState<string>('');
  const [actionTone, setActionTone] = useState<'info' | 'success' | 'error'>('info');

  const addressesReady = useMemo(
    () => isAddress(STAKING_ADDRESS) && isAddress(MUSDT_ADDRESS),
    []
  );
  const onTargetChain = chainId === TARGET_CHAIN_ID;
  const canQuery = Boolean(address && addressesReady && onTargetChain && publicClient);

  const positionQuery = useQuery({
    queryKey: ['position', address],
    enabled: canQuery,
    queryFn: async () => {
      const [ethStake, musdtStake, pendingRewards, lastUpdated] = (await publicClient!.readContract({
        address: STAKING_ADDRESS as `0x${string}`,
        abi: STAKING_ABI,
        functionName: 'getPosition',
        args: [address as `0x${string}`],
      })) as [Position['ethStake'], Position['musdtStake'], Position['pendingRewards'], bigint];

      return { ethStake, musdtStake, pendingRewards, lastUpdated };
    },
    refetchInterval: 15000,
  });

  const operatorQuery = useQuery({
    queryKey: ['operator', address],
    enabled: canQuery,
    queryFn: async () =>
      (await publicClient!.readContract({
        address: MUSDT_ADDRESS as `0x${string}`,
        abi: MUSDT_ABI,
        functionName: 'isOperator',
        args: [address as `0x${string}`, STAKING_ADDRESS as `0x${string}`],
      })) as boolean,
    refetchInterval: 20000,
  });

  const musdtBalanceHandleQuery = useQuery({
    queryKey: ['musdt-handle', address],
    enabled: canQuery,
    queryFn: async () =>
      (await publicClient!.readContract({
        address: MUSDT_ADDRESS as `0x${string}`,
        abi: MUSDT_ABI,
        functionName: 'confidentialBalanceOf',
        args: [address as `0x${string}`],
      })) as `0x${string}`,
    refetchInterval: 20000,
  });

  useEffect(() => {
    const decodePositions = async () => {
      if (!instance || !positionQuery.data) {
        setDecryptedPosition({});
        return;
      }

      const handles = [positionQuery.data.ethStake, positionQuery.data.musdtStake, positionQuery.data.pendingRewards].filter(
        (h) => h && h !== ZERO_HANDLE
      );
      if (!handles.length) {
        setDecryptedPosition({});
        return;
      }

      try {
        const result = await instance.publicDecrypt(handles);
        const pullValue = (handle: string) => {
          const raw = (result.clearValues as Record<string, string | number | bigint>)[handle];
          if (raw === undefined) return undefined;
          return BigInt(raw);
        };
        setDecryptedPosition({
          ethStake:
            positionQuery.data.ethStake !== ZERO_HANDLE ? pullValue(positionQuery.data.ethStake) : undefined,
          musdtStake:
            positionQuery.data.musdtStake !== ZERO_HANDLE ? pullValue(positionQuery.data.musdtStake) : undefined,
          pendingRewards:
            positionQuery.data.pendingRewards !== ZERO_HANDLE
              ? pullValue(positionQuery.data.pendingRewards)
              : undefined,
        });
      } catch (err) {
        console.error('Failed to decrypt position', err);
        setActionTone('error');
        setActionMessage('Unable to decrypt staking position right now.');
      }
    };

    decodePositions();
  }, [instance, positionQuery.data]);

  const notify = (type: 'info' | 'success' | 'error', message: string) => {
    setActionTone(type);
    setActionMessage(message);
  };

  const refreshPosition = () => {
    queryClient.invalidateQueries({ queryKey: ['position', address] });
    queryClient.invalidateQueries({ queryKey: ['musdt-handle', address] });
  };

  const parseMusdtInput = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return null;
    let parsed: bigint;
    try {
      parsed = parseUnits(trimmed, MUSDT_DECIMALS);
    } catch {
      return null;
    }
    if (parsed < 0 || parsed > MAX_UINT64) {
      return null;
    }
    return parsed;
  };

  const handleStakeEth = async () => {
    if (!isConnected || !onTargetChain || !addressesReady) {
      notify('error', 'Connect your wallet on Sepolia first.');
      return;
    }
    if (!stakeEthInput.trim()) {
      notify('error', 'Enter an ETH amount to stake.');
      return;
    }
    try {
      const signer = signerPromise ? await signerPromise : null;
      if (!signer) {
        notify('error', 'No signer available.');
        return;
      }
      const weiValue = parseEther(stakeEthInput);
      const staking = new Contract(STAKING_ADDRESS, STAKING_ABI, signer);
      notify('info', 'Staking ETH...');
      const tx = await staking.stakeEth({ value: weiValue });
      await tx.wait();
      notify('success', 'ETH staked and encrypted.');
      setStakeEthInput('');
      refreshPosition();
    } catch (err) {
      console.error(err);
      notify('error', 'Failed to stake ETH.');
    }
  };

  const handleStakeMusdt = async () => {
    if (!instance) {
      notify('error', 'Encryption service is still loading.');
      return;
    }
    if (!isConnected || !onTargetChain || !addressesReady) {
      notify('error', 'Connect your wallet on Sepolia first.');
      return;
    }
    const parsed = parseMusdtInput(stakeMusdtInput);
    if (parsed === null) {
      notify('error', 'Enter a valid mUSDT amount (max uint64).');
      return;
    }
    try {
      const signer = signerPromise ? await signerPromise : null;
      if (!signer || !address) {
        notify('error', 'No signer available.');
        return;
      }
      const buffer = instance.createEncryptedInput(STAKING_ADDRESS, address);
      buffer.add64(parsed);
      const encrypted = await buffer.encrypt();
      const staking = new Contract(STAKING_ADDRESS, STAKING_ABI, signer);
      notify('info', 'Submitting encrypted stake...');
      const tx = await staking.stakeMusdt(encrypted.handles[0], encrypted.inputProof);
      await tx.wait();
      notify('success', 'mUSDT staked and encrypted.');
      setStakeMusdtInput('');
      refreshPosition();
    } catch (err) {
      console.error(err);
      notify('error', 'Failed to stake mUSDT.');
    }
  };

  const handleAuthorizeOperator = async () => {
    if (!isConnected || !addressesReady) {
      notify('error', 'Connect your wallet on Sepolia first.');
      return;
    }
    try {
      const signer = signerPromise ? await signerPromise : null;
      if (!signer) {
        notify('error', 'No signer available.');
        return;
      }
      const mock = new Contract(MUSDT_ADDRESS, MUSDT_ABI, signer);
      const expiry = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30;
      notify('info', 'Authorizing staking contract to transfer mUSDT...');
      const tx = await mock.setOperator(STAKING_ADDRESS, expiry);
      await tx.wait();
      notify('success', 'Operator permission granted.');
      queryClient.invalidateQueries({ queryKey: ['operator', address] });
    } catch (err) {
      console.error(err);
      notify('error', 'Failed to set operator permission.');
    }
  };

  const handleSyncRewards = async () => {
    if (!isConnected || !addressesReady) {
      notify('error', 'Connect your wallet on Sepolia first.');
      return;
    }
    try {
      const signer = signerPromise ? await signerPromise : null;
      if (!signer) {
        notify('error', 'No signer available.');
        return;
      }
      const staking = new Contract(STAKING_ADDRESS, STAKING_ABI, signer);
      notify('info', 'Syncing rewards...');
      const tx = await staking.syncRewards();
      await tx.wait();
      notify('success', 'Rewards updated.');
      refreshPosition();
    } catch (err) {
      console.error(err);
      notify('error', 'Failed to sync rewards.');
    }
  };

  const handleClaimRewards = async () => {
    if (!isConnected || !addressesReady) {
      notify('error', 'Connect your wallet on Sepolia first.');
      return;
    }
    try {
      const signer = signerPromise ? await signerPromise : null;
      if (!signer) {
        notify('error', 'No signer available.');
        return;
      }
      const staking = new Contract(STAKING_ADDRESS, STAKING_ABI, signer);
      notify('info', 'Claiming encrypted rewards...');
      const tx = await staking.claimRewards();
      await tx.wait();
      notify('success', 'Rewards claimed to your mUSDT balance.');
      refreshPosition();
    } catch (err) {
      console.error(err);
      notify('error', 'Failed to claim rewards.');
    }
  };

  const handleWithdrawEth = async () => {
    if (!instance) {
      notify('error', 'Encryption service is still loading.');
      return;
    }
    if (!isConnected || !addressesReady || !positionQuery.data) {
      notify('error', 'Connect your wallet and load your position first.');
      return;
    }
    if (!withdrawInput.trim()) {
      notify('error', 'Enter an ETH amount to withdraw.');
      return;
    }
    try {
      const signer = signerPromise ? await signerPromise : null;
      if (!signer) {
        notify('error', 'No signer available.');
        return;
      }
      const requested = parseEther(withdrawInput);
      const handles = [positionQuery.data.ethStake];
      const publicResult = await instance.publicDecrypt(handles);
      const decoded = decodeAbiParameters([{ type: 'uint256' }], publicResult.abiEncodedClearValues)[0] as bigint;
      if (requested > decoded) {
        notify('error', 'Withdrawal exceeds your encrypted stake.');
        return;
      }
      const staking = new Contract(STAKING_ADDRESS, STAKING_ABI, signer);
      notify('info', 'Submitting withdrawal...');
      const tx = await staking.withdrawEth(requested, publicResult.abiEncodedClearValues, publicResult.decryptionProof);
      await tx.wait();
      notify('success', 'Withdrawal complete.');
      setWithdrawInput('');
      refreshPosition();
    } catch (err) {
      console.error(err);
      notify('error', 'Failed to withdraw ETH.');
    }
  };

  const handleDecryptBalance = async () => {
    if (!instance) {
      notify('error', 'Encryption service is still loading.');
      return;
    }
    if (!isConnected || !musdtBalanceHandleQuery.data || musdtBalanceHandleQuery.data === ZERO_HANDLE) {
      notify('error', 'No encrypted mUSDT balance to decrypt.');
      return;
    }
    try {
      const signer = signerPromise ? await signerPromise : null;
      if (!signer || !address) {
        notify('error', 'No signer available.');
        return;
      }
      const keypair = instance.generateKeypair();
      const handleContractPairs = [
        {
          handle: musdtBalanceHandleQuery.data,
          contractAddress: MUSDT_ADDRESS,
        },
      ];
      const startTime = Math.floor(Date.now() / 1000).toString();
      const durationDays = '7';
      const contractAddresses = [MUSDT_ADDRESS];
      const eip712 = instance.createEIP712(keypair.publicKey, contractAddresses, startTime, durationDays);
      const signature = await signer.signTypedData(
        eip712.domain,
        {
          UserDecryptRequestVerification: eip712.types.UserDecryptRequestVerification,
        },
        eip712.message
      );
      const result = await instance.userDecrypt(
        handleContractPairs,
        keypair.privateKey,
        keypair.publicKey,
        signature.replace('0x', ''),
        contractAddresses,
        address,
        startTime,
        durationDays
      );
      const decrypted = result[musdtBalanceHandleQuery.data];
      setMusdtClearBalance(formatUnits(BigInt(decrypted), MUSDT_DECIMALS));
      notify('success', 'Balance decrypted locally.');
    } catch (err) {
      console.error(err);
      notify('error', 'Failed to decrypt mUSDT balance.');
    }
  };

  const formatMusdt = (value?: bigint) => {
    if (value === undefined) return '–';
    return `${formatUnits(value, MUSDT_DECIMALS)} mUSDT`;
  };

  const formatEth = (value?: bigint) => {
    if (value === undefined) return '–';
    return `${formatEther(value)} ETH`;
  };

  const renderStatus = () => {
    if (!actionMessage) return null;
    return <div className={`status-badge status-${actionTone}`}>{actionMessage}</div>;
  };

  return (
    <div className="content">
      {!addressesReady && (
        <div className="warning">
          Contract addresses are empty. Deploy to Sepolia and update `STAKING_ADDRESS` and `MUSDT_ADDRESS` in
          src/config/contracts.ts.
        </div>
      )}

      {!onTargetChain && isConnected && (
        <div className="warning">
          <span>Switch to Sepolia to interact.</span>
          <button className="text-button" onClick={() => switchChain?.({ chainId: TARGET_CHAIN_ID })}>
            Switch network
          </button>
        </div>
      )}

      {zamaError && <div className="warning">Encryption service error: {zamaError}</div>}

      <div className="hero">
        <div>
          <p className="eyebrow">Encrypted staking</p>
          <h1>Stake ETH or mUSDT, earn private rewards.</h1>
          <p className="lede">
            EnclaveFi keeps your balances encrypted with Zama FHE. Read actions use viem, writes use ethers so you can
            inspect and act on your stake with confidence.
          </p>
          <div className="pill-row">
            <span className="pill">Sepolia only</span>
            <span className="pill">mUSDT 6 decimals</span>
            <span className="pill">Rewards: 1 mUSDT / ETH / day</span>
          </div>
        </div>
        <div className="status-panel">
          <div className="status-line">
            <span>Wallet</span>
            <strong>{isConnected ? 'Connected' : 'Not connected'}</strong>
          </div>
          <div className="status-line">
            <span>Zama relayer</span>
            <strong>{zamaLoading ? 'Starting...' : instance ? 'Ready' : 'Unavailable'}</strong>
          </div>
          <div className="status-line">
            <span>Operator</span>
            <strong>{operatorQuery.data ? 'Granted' : 'Not granted'}</strong>
          </div>
        </div>
      </div>

      <div className="stats-grid">
        <div className="stat-card">
          <p className="label">Encrypted ETH staked</p>
          <h3>{formatEth(decryptedPosition.ethStake)}</h3>
          <p className="muted">Publicly decryptable snapshot of your ETH stake.</p>
        </div>
        <div className="stat-card">
          <p className="label">Encrypted mUSDT staked</p>
          <h3>{formatMusdt(decryptedPosition.musdtStake)}</h3>
          <p className="muted">mUSDT locked in the staking pool.</p>
        </div>
        <div className="stat-card">
          <p className="label">Pending rewards</p>
          <h3>{formatMusdt(decryptedPosition.pendingRewards)}</h3>
          <p className="muted">Accrues continuously; sync before claiming.</p>
        </div>
      </div>

      {renderStatus()}

      <div className="grid-2">
        <div className="card">
          <div className="card-header">
            <div>
              <p className="label">Stake ETH</p>
              <h4>Encrypt and deposit ETH</h4>
            </div>
          </div>
          <div className="form-row">
            <input
              type="number"
              min="0"
              step="0.0001"
              placeholder="Amount in ETH"
              value={stakeEthInput}
              onChange={(e) => setStakeEthInput(e.target.value)}
            />
            <button className="primary" onClick={handleStakeEth} disabled={!addressesReady || zamaLoading}>
              Stake ETH
            </button>
          </div>
          <p className="muted small">1 ETH earns 1 mUSDT per day.</p>
        </div>

        <div className="card">
          <div className="card-header">
            <div>
              <p className="label">Stake mUSDT</p>
              <h4>Encrypt and deposit mUSDT</h4>
            </div>
            <button className="ghost" onClick={handleAuthorizeOperator} disabled={!addressesReady}>
              {operatorQuery.data ? 'Operator active' : 'Grant operator'}
            </button>
          </div>
          <div className="form-row">
            <input
              type="number"
              min="0"
              step="0.01"
              placeholder="Amount in mUSDT"
              value={stakeMusdtInput}
              onChange={(e) => setStakeMusdtInput(e.target.value)}
            />
            <button className="primary" onClick={handleStakeMusdt} disabled={!addressesReady || zamaLoading}>
              Stake mUSDT
            </button>
          </div>
          <p className="muted small">mUSDT yields 1% per day on this pool.</p>
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-header">
            <div>
              <p className="label">Rewards</p>
              <h4>Sync & claim</h4>
            </div>
            <div className="chip-row">
              <button className="ghost" onClick={handleSyncRewards} disabled={!addressesReady}>
                Sync rewards
              </button>
              <button className="secondary" onClick={handleClaimRewards} disabled={!addressesReady}>
                Claim to mUSDT
              </button>
            </div>
          </div>
          <p className="muted">
            Sync updates your pending rewards using on-chain timestamps, then mint encrypted mUSDT directly to your
            confidential balance.
          </p>
        </div>

        <div className="card">
          <div className="card-header">
            <div>
              <p className="label">Withdraw ETH</p>
              <h4>Decrypt proof and exit</h4>
            </div>
          </div>
          <div className="form-row">
            <input
              type="number"
              min="0"
              step="0.0001"
              placeholder="Amount in ETH"
              value={withdrawInput}
              onChange={(e) => setWithdrawInput(e.target.value)}
            />
            <button className="primary" onClick={handleWithdrawEth} disabled={!addressesReady || zamaLoading}>
              Withdraw
            </button>
          </div>
          <p className="muted small">
            A public decrypt proof is generated locally and sent with your withdrawal so the contract can verify the
            clear amount.
          </p>
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-header">
            <div>
              <p className="label">Encrypted mUSDT balance</p>
              <h4>Decrypt with your key</h4>
            </div>
            <button className="secondary" onClick={handleDecryptBalance} disabled={!addressesReady || zamaLoading}>
              Decrypt balance
            </button>
          </div>
          <p className="muted small">Uses user decryption with a local keypair so only you see the clear amount.</p>
          <div className="balance-output">
            <span>Encrypted handle</span>
            <code className="handle">
              {musdtBalanceHandleQuery.data && musdtBalanceHandleQuery.data !== ZERO_HANDLE
                ? `${musdtBalanceHandleQuery.data.slice(0, 10)}...${musdtBalanceHandleQuery.data.slice(-6)}`
                : 'None'}
            </code>
            <div className="clear-balance">{musdtClearBalance ? `${musdtClearBalance} mUSDT` : '—'}</div>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <div>
              <p className="label">Position meta</p>
              <h4>Last sync</h4>
            </div>
            <button className="ghost" onClick={refreshPosition}>
              Refresh
            </button>
          </div>
          <ul className="meta-list">
            <li>
              <span>Last updated</span>
              <strong>
                {positionQuery.data
                  ? new Date(Number(positionQuery.data.lastUpdated) * 1000).toLocaleString()
                  : '—'}
              </strong>
            </li>
            <li>
              <span>Operator granted</span>
              <strong>{operatorQuery.data ? 'Yes' : 'No'}</strong>
            </li>
            <li>
              <span>Relayer status</span>
              <strong>{zamaLoading ? 'Loading' : instance ? 'Ready' : 'Unavailable'}</strong>
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
