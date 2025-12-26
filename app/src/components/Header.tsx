import { ConnectButton } from '@rainbow-me/rainbowkit';
import '../styles/Header.css';

export function Header() {
  return (
    <header className="header">
      <div className="header-inner">
        <div>
          <div className="brand-row">
            <span className="brand-mark">EnclaveFi</span>
            <span className="badge">Encrypted Yield</span>
          </div>
          <p className="brand-subtitle">Stake privately, earn in mUSDT, and decrypt on your terms.</p>
        </div>
        <div className="header-actions">
          <div className="network-chip">Sepolia · FHE</div>
          <ConnectButton />
        </div>
      </div>
    </header>
  );
}
