import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;

  const deployedMockUsdt = await deploy("MockUSDT", {
    from: deployer,
    log: true,
  });

  const deployedStaking = await deploy("EncryptedStaking", {
    from: deployer,
    args: [deployedMockUsdt.address],
    log: true,
  });

  const mockUsdt = await hre.ethers.getContractAt("MockUSDT", deployedMockUsdt.address);
  const staking = await hre.ethers.getContractAt("EncryptedStaking", deployedStaking.address);

  const stakeTx = await mockUsdt.setStakingContract(await staking.getAddress());
  await stakeTx.wait();

  console.log(`MockUSDT contract: ${deployedMockUsdt.address}`);
  console.log(`EncryptedStaking contract: ${deployedStaking.address}`);
};
export default func;
func.id = "deploy_staking"; // id required to prevent reexecution
func.tags = ["MockUSDT", "EncryptedStaking"];
