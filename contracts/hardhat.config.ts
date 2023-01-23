import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "@nomiclabs/hardhat-etherscan";


const config: HardhatUserConfig = {
  solidity: "0.8.17",
  etherscan: {
    apiKey: ""
  },
  networks: {
    goerli: {
      url: "https://goerli.infura.io/v3/3c7f5083c38943ea95aa49278ddeba53",
      accounts: []
    }
  },
};

export default config;