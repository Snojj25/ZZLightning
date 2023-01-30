const { ethers } = require("ethers");
const { sendPayment } = require("./grpcConnection");
const { sendPaymentOnLightning } = require("./bridging_scripts");

// let privKey =
//   "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

const provider = new ethers.providers.JsonRpcProvider("http://127.0.0.1:8545/");

const signer = provider.getSigner("0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266");

const zzLightningAddress = "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512"; // NOTE: This has to be changed if the address changes
const zzLightningAbi =
  require("../contracts/out/BTCBridge.sol/ZigZagBTCBridge.json").abi;
const zzLNContract = new ethers.Contract(
  zzLightningAddress,
  zzLightningAbi,
  signer
);

const tokenAddress = "0x5FbDB2315678afecb367f032d93F642f64180aa3"; // NOTE: This has to be changed if the address changes
const tokenAbi =
  require("../contracts/out/MintableToken.sol/MintableToken.json").abi;
const tokenContract = new ethers.Contract(tokenAddress, tokenAbi, signer);

let invalidHashes = [
  "0x621095376926ce77b351872978c551b6a191f2850c73fb7b3008910074015273",
];

async function listenToDepositCreated(lightning, router) {
  zzLNContract.on(
    "DepositCreated",
    (intiator, wbtc_amount, expirationTime, hash) => {
      if (invalidHashes.includes(hash)) {
        return;
      }

      sendPaymentOnLightning(
        intiator,
        wbtc_amount,
        expirationTime,
        hash,
        lightning,
        router
      ).then((res) => {
        if (res.err_msg) {
          console.log(res.err_msg);
        } else {
          let preimage = "0x" + res.preimage;

          UnlockDepositOnchain(preimage, hash).then((receipt) => {
            // Todo: what to do with the receipt?
            console.log(
              "UnlockDepositOnchain tx_hash: ",
              receipt.transactionHash
            );
            console.log(
              "UnlockDepositOnchain status: ",
              receipt.status == 1 ? "success" : "failed"
            );
          });
        }
      });
    }
  );
}

async function listenToDepositProcessed() {
  zzLNContract.on(
    "DepositProcessed",
    (intiator, wbtc_amount, preimage, hash) => {
      console.log("DepositProcessed: ", intiator, wbtc_amount, preimage, hash);

      // TODO: Removes the hash from the exchange's list of pending swaps
    }
  );
}

async function listenToWithdrawalsClaimed() {
  zzLNContract.on(
    "WithdrawProcessed",
    (receiver, wbtc_amount, preimage, hash) => {
      console.log("WithdrawProcessed: ", receiver, wbtc_amount, preimage, hash);

      // TODO: Do we need to do anything here?
    }
  );
}

async function UnlockDepositOnchain(preimage, hash) {
  let txRes = await zzLNContract.unlockDepositHash(hash, preimage, {
    gasLimit: 3000000,
  });

  let receipt = await txRes.wait();

  return receipt;
}

async function InitiateOnChainWithdrawal(
  counterparty,
  wbtc_amount,
  hash,
  expiry
) {
  // We want to give the user around 3 days to claim the funds
  let onChainExpiration = Math.floor(Date.now() / 1000) + expiry + 172_800; // now + expiry + 2 days

  let txRes = await zzLNContract.createWithdrawHash(
    counterparty,
    wbtc_amount,
    hash,
    onChainExpiration,
    {
      gasLimit: 3000000,
    }
  );

  let receipt = await txRes.wait();

  console.log(
    "InitiateOnChainWithdrawal status: ",
    receipt.status == 1 ? "success" : "failed"
  );

  return receipt;
}

module.exports = {
  listenToDepositCreated,
  listenToDepositProcessed,
  listenToWithdrawalsClaimed,
  UnlockDepositOnchain,
  InitiateOnChainWithdrawal,
};
