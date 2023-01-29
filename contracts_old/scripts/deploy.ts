import { ethers } from "hardhat";

async function main() {
  const manager = "0x5D735e9fFA69d0a77eE18363B5B8ce05e2f9eE2d";
  const wbtc_address = "0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f";
  const Bridge = await ethers.getContractFactory("ZigZagBTCBridge");
  const bridge = await Bridge.deploy(manager, wbtc_address);

  await bridge.deployed();

  console.log(`Bridge deployed to ${bridge.address}`);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
