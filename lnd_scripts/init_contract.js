const { ethers } = require("ethers");

const provider = new ethers.providers.JsonRpcProvider("http://127.0.0.1:8545/");

const signer = provider.getSigner("0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266");

const zzLightningAddress = "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512";
const zzLightningAbi = require("./out/BTCBridge.sol/ZigZagBTCBridge.json").abi;

const zzLNContract = new ethers.Contract(
  zzLightningAddress,
  zzLightningAbi,
  signer
);

const tokenAddress = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
const tokenAbi = require("./out/MintableToken.sol/MintableToken.json").abi;

const tokenContract = new ethers.Contract(tokenAddress, tokenAbi, signer);

async function initMint() {}

async function testLP() {}

async function init() {
  let txRes = await tokenContract.mint(
    1000n * 10n ** 18n,
    "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
    {
      gasLimit: 3000000,
    }
  );
  await txRes.wait();

  // Provide liquidity for 500 WBTC

  txRes = await tokenContract.approve(zzLightningAddress, 500n * 10n ** 18n, {
    gasLimit: 3000000,
  });
  await txRes.wait();

  txRes = await zzLNContract.depositWBTCToLP(500n * 10n ** 18n, {
    gasLimit: 3000000,
  });
  await txRes.wait();

  let res = await tokenContract.balanceOf(zzLightningAddress);
  console.log("DEX bal: ", res.toString());
}

init();
