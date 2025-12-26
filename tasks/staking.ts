import { FhevmType } from "@fhevm/hardhat-plugin";
import { task } from "hardhat/config";
import type { TaskArguments } from "hardhat/types";

task("task:staking-addresses", "Prints deployed staking contract addresses").setAction(async (_args, hre) => {
  const { deployments } = hre;
  const staking = await deployments.get("EncryptedStaking");
  const musdt = await deployments.get("MockUSDT");

  console.log(`EncryptedStaking address: ${staking.address}`);
  console.log(`MockUSDT address: ${musdt.address}`);
});

task("task:decrypt-eth-stake", "Decrypts a user's staked ETH amount using public decryption")
  .addParam("user", "User address to inspect")
  .setAction(async (taskArguments: TaskArguments, hre) => {
    const { deployments, ethers, fhevm } = hre;
    await fhevm.initializeCLIApi();

    const stakingDeployment = await deployments.get("EncryptedStaking");
    const staking = await ethers.getContractAt("EncryptedStaking", stakingDeployment.address);

    const [ethStake] = await staking.getPosition(taskArguments.user);
    if (ethStake === ethers.ZeroHash) {
      console.log("Encrypted stake is empty. Clear stake: 0");
      return;
    }

    const publicResult = await fhevm.publicDecrypt([ethStake]);
    const decoded = ethers.AbiCoder.defaultAbiCoder().decode(["uint256"], publicResult.abiEncodedClearValues)[0];

    console.log(`Encrypted handle: ${ethStake}`);
    console.log(`Clear stake   : ${decoded.toString()}`);
  });

task("task:decrypt-rewards", "Decrypts a user's pending rewards")
  .addParam("user", "User address to inspect")
  .setAction(async (taskArguments: TaskArguments, hre) => {
    const { deployments, ethers, fhevm } = hre;
    await fhevm.initializeCLIApi();

    const stakingDeployment = await deployments.get("EncryptedStaking");
    const staking = await ethers.getContractAt("EncryptedStaking", stakingDeployment.address);

    const [, , pendingRewards] = await staking.getPosition(taskArguments.user);
    if (pendingRewards === ethers.ZeroHash) {
      console.log("Encrypted rewards are empty. Clear rewards: 0");
      return;
    }

    const clearValue = await fhevm.publicDecryptEuint(FhevmType.euint128, pendingRewards);
    console.log(`Encrypted rewards: ${pendingRewards}`);
    console.log(`Clear rewards    : ${clearValue.toString()}`);
  });
