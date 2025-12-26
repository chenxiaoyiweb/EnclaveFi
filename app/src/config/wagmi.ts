import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { sepolia } from 'wagmi/chains';

export const config = getDefaultConfig({
  appName: 'EnclaveFi',
  projectId: '7a111e7c1a0146b3af1207b3f88d6674',
  chains: [sepolia],
  ssr: false,
});
