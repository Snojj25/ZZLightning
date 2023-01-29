const { default: axios } = require("axios");
const { ethers } = require("ethers");

const provider = new ethers.providers.JsonRpcProvider("http://127.0.0.1:8545/");

const signer = provider.getSigner("0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266");

const zzLightningAddress = "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512";
const zzLightningAbi =
  require("../../contracts/out/BTCBridge.sol/ZigZagBTCBridge.json").abi;
const zzLNContract = new ethers.Contract(
  zzLightningAddress,
  zzLightningAbi,
  signer
);
const tokenAddress = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
const tokenAbi =
  require("../../contracts/out/MintableToken.sol/MintableToken.json").abi;
const tokenContract = new ethers.Contract(tokenAddress, tokenAbi, signer);

const lightningPayReq = require("bolt11");
const { Eth2Btc, Btc2Eth } = require("../../frontend/helpers/Interaction");

// GOING FROM ETH TO BTC ———————————————————————————————————————————————————————————

// NOTE: For now there needs to be a channel open between the user and the exchnage ahead of time,
// NOTE: where the exchange has the funds to pay out the user
async function testEth2Btc() {
  // Note: This is the payment request from the user
  let payment_request =
    "lnsb100u1p3adfmwpp58pnxruaet76q5q59m5klq8dewmzxpyr2fewknrcfavds0ecsjdhqdqqcqzpgxqyz5vqsp53ceqy6yweqlq8wge72xd54lhtejctthqla3xqgkds6wkusdu84rs9qyyssqc40d63v2ezgh350489lgcld7lctj52h92hxhrgjexgtnquj6xvjq62t5yug5ku7lk8v53q5g5ggcl0emdgswh2wnansud6y5d9za4ysqtxfhzn";

  let e2bSwap = new Eth2Btc(payment_request);

  await e2bSwap.registerInvoice();

  if (e2bSwap.invoiceRegistered) {
    let receipt1 = await e2bSwap.approveDeposit();
    if (receipt1.status != 1) throw new Error("Deposit approval failed");

    let receipt2 = await e2bSwap.createDepositHash();
    if (receipt2.status != 1) throw new Error("Deposit Hash creation failed");

    console.log("The funds should now have been payed out to the user.");
  }
}

// testEth2Btc();

// GOING FROM BTC TO ETH =================================================================================================

// NOTE: For now there needs to be a channel open between the user and the exchnage ahead of time,
// NOTE: where the user has the funds to pay out the exchange
async function testBtc2Eth() {
  let ethAddress = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266";
  let wbtc_amount = 10_000;
  let memo = "test";

  let b2eSwap = new Btc2Eth(ethAddress, wbtc_amount, memo);
  let paymentReq = await b2eSwap.startSwap();

  if (!paymentReq) {
    throw new Error("Swap failed");
  }

  console.log("The payment request is: ", paymentReq);

  // TODO: The user has to now pay the invoice and than he could unlock the withdrawal below

  // let preimage = ""; // if not defined the function queries the backend for it first
  // let receipt = await b2eSwap.unlockWithdrawal(preimage);

  // if (receipt.status != 1) throw new Error("Unlocking failed");
}

// testBtc2Eth();
