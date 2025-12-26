// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.27;

import {ERC7984} from "@openzeppelin/confidential-contracts/token/ERC7984/ERC7984.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {FHE, euint64} from "@fhevm/solidity/lib/FHE.sol";

contract MockUSDT is ERC7984, ZamaEthereumConfig {
    address public controller;
    address public stakingContract;

    event ControllerUpdated(address indexed newController);
    event StakingContractUpdated(address indexed newStakingContract);

    error Unauthorized();
    error InvalidController();

    constructor() ERC7984("mUSDT", "mUSDT", "") {
        controller = msg.sender;
    }

    modifier onlyController() {
        if (msg.sender != controller) {
            revert Unauthorized();
        }
        _;
    }

    modifier onlyMinter() {
        if (msg.sender != controller && msg.sender != stakingContract) {
            revert Unauthorized();
        }
        _;
    }

    function setController(address newController) external onlyController {
        if (newController == address(0)) {
            revert InvalidController();
        }
        controller = newController;
        emit ControllerUpdated(newController);
    }

    function setStakingContract(address newStakingContract) external onlyController {
        stakingContract = newStakingContract;
        emit StakingContractUpdated(newStakingContract);
    }

    function mint(address to, uint64 amount) public onlyController returns (euint64 minted) {
        euint64 encryptedAmount = FHE.asEuint64(amount);
        minted = _mint(to, encryptedAmount);
    }

    function mintEncrypted(address to, euint64 encryptedAmount) external onlyMinter returns (euint64 minted) {
        minted = _mint(to, encryptedAmount);
    }
}
