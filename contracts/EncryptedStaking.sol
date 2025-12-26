// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {MockUSDT} from "./MockUSDT.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {FHE, euint64, euint128, externalEuint64} from "@fhevm/solidity/lib/FHE.sol";

contract EncryptedStaking is ZamaEthereumConfig {
    uint64 private constant SECONDS_PER_DAY = 86_400;
    uint64 private constant PERCENT_DENOMINATOR = 100;

    MockUSDT public immutable musdt;

    struct StakeInfo {
        euint128 ethStake;
        euint128 musdtStake;
        euint128 pendingRewards;
        uint64 lastUpdated;
    }

    mapping(address => StakeInfo) private stakes;

    event EthStaked(address indexed user, uint256 amount, bytes32 newBalance);
    event MusdtStaked(address indexed user, bytes32 encryptedAmount, bytes32 newBalance);
    event EthWithdrawn(address indexed user, uint256 amount, bytes32 remainingBalance);
    event RewardsClaimed(address indexed user, bytes32 encryptedAmount);
    event RewardsSynced(address indexed user, bytes32 pendingRewards, uint64 timestamp);

    error InvalidAmount();
    error NoRewardsAvailable();
    error TransferFailed();

    constructor(address musdtAddress) {
        require(musdtAddress != address(0), "mUSDT required");
        musdt = MockUSDT(musdtAddress);
    }

    function stakeEth() external payable {
        if (msg.value == 0 || msg.value > type(uint128).max) {
            revert InvalidAmount();
        }

        StakeInfo storage info = stakes[msg.sender];
        _accrue(msg.sender, info);

        euint128 addition = FHE.asEuint128(uint128(msg.value));
        info.ethStake = FHE.isInitialized(info.ethStake) ? FHE.add(info.ethStake, addition) : addition;
        _shareValue(info.ethStake, msg.sender, true);

        info.lastUpdated = uint64(block.timestamp);
        emit EthStaked(msg.sender, msg.value, FHE.toBytes32(info.ethStake));
    }

    function stakeMusdt(externalEuint64 encryptedAmount, bytes calldata inputProof) external {
        StakeInfo storage info = stakes[msg.sender];
        _accrue(msg.sender, info);

        euint64 validatedAmount = FHE.fromExternal(encryptedAmount, inputProof);
        FHE.allow(validatedAmount, address(this));
        FHE.allow(validatedAmount, address(musdt));

        euint64 transferred = musdt.confidentialTransferFrom(msg.sender, address(this), validatedAmount);
        euint128 stakeIncrement = FHE.asEuint128(transferred);
        info.musdtStake = FHE.isInitialized(info.musdtStake) ? FHE.add(info.musdtStake, stakeIncrement) : stakeIncrement;
        _shareValue(info.musdtStake, msg.sender, true);

        info.lastUpdated = uint64(block.timestamp);
        emit MusdtStaked(msg.sender, FHE.toBytes32(transferred), FHE.toBytes32(info.musdtStake));
    }

    function withdrawEth(
        uint128 amount,
        bytes calldata abiEncodedClearValue,
        bytes calldata decryptionProof
    ) external {
        if (amount == 0) {
            revert InvalidAmount();
        }

        StakeInfo storage info = stakes[msg.sender];
        _accrue(msg.sender, info);
        if (!FHE.isInitialized(info.ethStake)) {
            revert InvalidAmount();
        }

        bytes32[] memory handles = new bytes32[](1);
        handles[0] = FHE.toBytes32(info.ethStake);

        FHE.checkSignatures(handles, abiEncodedClearValue, decryptionProof);

        uint256 decryptedStake = abi.decode(abiEncodedClearValue, (uint256));
        if (amount > decryptedStake || amount > type(uint128).max) {
            revert InvalidAmount();
        }

        euint128 amountEncrypted = FHE.asEuint128(amount);
        euint128 remaining = FHE.sub(info.ethStake, amountEncrypted);
        info.ethStake = remaining;
        _shareValue(info.ethStake, msg.sender, true);
        info.lastUpdated = uint64(block.timestamp);

        (bool sent, ) = msg.sender.call{value: amount}("");
        if (!sent) {
            revert TransferFailed();
        }

        emit EthWithdrawn(msg.sender, amount, FHE.toBytes32(info.ethStake));
    }

    function claimRewards() external {
        StakeInfo storage info = stakes[msg.sender];
        _accrue(msg.sender, info);

        if (!FHE.isInitialized(info.pendingRewards)) {
            revert NoRewardsAvailable();
        }

        euint64 rewards = FHE.asEuint64(info.pendingRewards);
        FHE.allowThis(rewards);
        FHE.allow(rewards, msg.sender);
        FHE.allow(rewards, address(musdt));
        info.pendingRewards = FHE.asEuint128(0);
        _shareValue(info.pendingRewards, msg.sender, true);
        info.lastUpdated = uint64(block.timestamp);

        musdt.mintEncrypted(msg.sender, rewards);
        emit RewardsClaimed(msg.sender, FHE.toBytes32(rewards));
    }

    function syncRewards() external returns (euint128) {
        StakeInfo storage info = stakes[msg.sender];
        _accrue(msg.sender, info);
        emit RewardsSynced(msg.sender, FHE.toBytes32(info.pendingRewards), info.lastUpdated);
        return info.pendingRewards;
    }

    function getPosition(
        address user
    ) external view returns (euint128 ethStake, euint128 musdtStake, euint128 pendingRewards, uint64 lastUpdated) {
        StakeInfo storage info = stakes[user];
        return (info.ethStake, info.musdtStake, info.pendingRewards, info.lastUpdated);
    }

    function getRewardToken() external view returns (address) {
        return address(musdt);
    }

    function _accrue(address user, StakeInfo storage info) private {
        if (info.lastUpdated == 0) {
            info.lastUpdated = uint64(block.timestamp);
            return;
        }

        uint64 elapsed = uint64(block.timestamp - info.lastUpdated);
        if (elapsed == 0) {
            return;
        }

        // Exclude the current block to prevent overcounting when blocks advance without time passing
        unchecked {
            elapsed -= 1;
        }

        if (elapsed == 0) {
            return;
        }

        euint128 ethAccrued = FHE.mul(info.ethStake, elapsed);
        ethAccrued = FHE.div(ethAccrued, SECONDS_PER_DAY);
        ethAccrued = FHE.div(ethAccrued, 1_000_000_000_000);

        euint128 musdtInterest = FHE.div(
            FHE.mul(info.musdtStake, elapsed),
            SECONDS_PER_DAY * PERCENT_DENOMINATOR
        );
        euint128 totalInterest = FHE.add(ethAccrued, musdtInterest);

        if (!FHE.isInitialized(totalInterest)) {
            info.lastUpdated = uint64(block.timestamp);
            return;
        }

        if (FHE.isInitialized(info.pendingRewards)) {
            info.pendingRewards = FHE.add(info.pendingRewards, totalInterest);
        } else {
            info.pendingRewards = totalInterest;
        }
        _shareValue(info.pendingRewards, user, true);
        info.lastUpdated = uint64(block.timestamp);
    }

    function _shareValue(euint128 value, address user, bool makePublic) private {
        if (!FHE.isInitialized(value)) {
            return;
        }
        FHE.allowThis(value);
        FHE.allow(value, user);
        if (makePublic) {
            FHE.makePubliclyDecryptable(value);
        }
    }
}
