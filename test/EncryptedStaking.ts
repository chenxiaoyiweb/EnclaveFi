import { time } from "@nomicfoundation/hardhat-network-helpers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers, fhevm } from "hardhat";
import { FhevmType } from "@fhevm/hardhat-plugin";

import { EncryptedStaking, EncryptedStaking__factory, MockUSDT, MockUSDT__factory } from "../types";

const SECONDS_PER_DAY = 86_400;

type FixtureResult = {
  staking: EncryptedStaking;
  mockUsdt: MockUSDT;
  deployer: HardhatEthersSigner;
  alice: HardhatEthersSigner;
  bob: HardhatEthersSigner;
};

async function deployFixture(): Promise<FixtureResult> {
  const [deployer, alice, bob] = await ethers.getSigners();

  const mockUsdtFactory = (await ethers.getContractFactory("MockUSDT")) as MockUSDT__factory;
  const mockUsdt = (await mockUsdtFactory.deploy()) as MockUSDT;

  const stakingFactory = (await ethers.getContractFactory("EncryptedStaking")) as EncryptedStaking__factory;
  const staking = (await stakingFactory.deploy(await mockUsdt.getAddress())) as EncryptedStaking;
  await mockUsdt.setStakingContract(await staking.getAddress());

  return { staking, mockUsdt, deployer, alice, bob };
}

describe("EncryptedStaking", function () {
  before(function () {
    if (!fhevm.isMock) {
      console.warn("Skipping EncryptedStaking tests on non-mock network");
      this.skip();
    }
  });

  it("accrues daily mUSDT rewards for ETH stakes and allows claiming", async function () {
    const { staking, mockUsdt, alice } = await deployFixture();
    const deposit = ethers.parseEther("1");

    await staking.connect(alice).stakeEth({ value: deposit });
    await time.increase(SECONDS_PER_DAY);
    await staking.connect(alice).syncRewards();

    const [, , pendingRewards] = await staking.getPosition(alice.getAddress());
    const clearPending = await fhevm.publicDecryptEuint(FhevmType.euint128, pendingRewards);
    expect(clearPending).to.equal(1_000_000n); // 1 mUSDT in base units

    await staking.connect(alice).claimRewards();
    const balanceHandle = await mockUsdt.confidentialBalanceOf(alice.getAddress());
    const clearBalance = await fhevm.userDecryptEuint(
      FhevmType.euint64,
      balanceHandle,
      await mockUsdt.getAddress(),
      alice,
    );
    expect(clearBalance).to.equal(1_000_000n);
  });

  it("earns percentage rewards on mUSDT stake", async function () {
    const { staking, mockUsdt, alice, deployer } = await deployFixture();
    const stakeAmount = 1_000_000n; // 1 mUSDT with 6 decimals

    await mockUsdt.connect(deployer).mint(await alice.getAddress(), Number(stakeAmount * 2n));

    const now = BigInt(await time.latest());
    const operatorExpiry = now + BigInt(SECONDS_PER_DAY * 30);
    await mockUsdt.connect(alice).setOperator(await staking.getAddress(), operatorExpiry);
    expect(await mockUsdt.isOperator(await alice.getAddress(), await staking.getAddress())).to.equal(true);

    const input = fhevm.createEncryptedInput(await staking.getAddress(), await alice.getAddress());
    input.add64(stakeAmount);
    const encrypted = await input.encrypt();

    await staking.connect(alice).stakeMusdt(encrypted.handles[0], encrypted.inputProof);

    await time.increase(SECONDS_PER_DAY);
    await staking.connect(alice).syncRewards();

    const [, , pendingRewards] = await staking.getPosition(alice.getAddress());
    const clearPending = await fhevm.publicDecryptEuint(FhevmType.euint128, pendingRewards);
    expect(clearPending).to.equal(10_000n); // 1% of 1 mUSDT
  });

  it("allows withdrawing ETH using a public decryption proof", async function () {
    const { staking, alice } = await deployFixture();
    const deposit = ethers.parseEther("0.5");
    await staking.connect(alice).stakeEth({ value: deposit });

    const [ethStake] = await staking.getPosition(alice.getAddress());
    const publicResult = await fhevm.publicDecrypt([ethStake]);
    const abiCoder = ethers.AbiCoder.defaultAbiCoder();
    const decodedStake = abiCoder.decode(["uint256"], publicResult.abiEncodedClearValues)[0] as bigint;

    const withdrawAmount = decodedStake / 2n;

    await staking
      .connect(alice)
      .withdrawEth(withdrawAmount, publicResult.abiEncodedClearValues, publicResult.decryptionProof);

    const [remainingStake] = await staking.getPosition(alice.getAddress());
    const afterDecrypt = await fhevm.publicDecrypt([remainingStake]);
    const decodedRemaining = abiCoder.decode(["uint256"], afterDecrypt.abiEncodedClearValues)[0] as bigint;

    expect(decodedRemaining).to.equal(decodedStake - withdrawAmount);
  });
});
