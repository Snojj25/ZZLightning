const { ethers } = require("ethers");
const { sendPayment } = require("./utils");
const { default: sendPaymentOnLightning } = require("./eth_to_btc");

const provider = new ethers.providers.JsonRpcProvider("http://127.0.0.1:8545/");

const signer = provider.getSigner("0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266");

const zzLightningAddress = "";
const zzLightningAbi = null; // require(""").abi;

const zzLNContract = new ethers.Contract(
  zzLightningAddress,
  zzLightningAbi,
  signer
);

async function listenToDepositCreated(lightning, router) {
  zzLNContract.on("DepositCreated", (intiator, wbtc_amount, expiry, hash) => {
    console.log("DepositCreated: ", intiator, wbtc_amount, expiry, hash);

    sendPaymentOnLightning(
      intiator,
      wbtc_amount,
      expiry,
      hash,
      lightning,
      router
    ).then((res) => {
      if (res.err_msg) {
        console.log(res.err_msg);
      } else {
        let preimage = res.preimage;

        UnlockDepositOnchain(preimage, hash).then((receipt) => {
          // Todo: what to do with the receipt?
        });
      }
    });
  });
}

async function listenToDepositProcessed() {
  zzLNContract.on(
    "DepositProcessed",
    (intiator, wbtc_amount, preimage, hash) => {
      console.log("DepositProcessed: ", intiator, wbtc_amount, expiry, hash);

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
  // bytes32 hash, bytes memory preimage
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
  let txRes = await zzLNContract.createWithdrawHash(
    counterparty,
    wbtc_amount,
    hash,
    expiry,
    {
      gasLimit: 3000000,
    }
  );

  let receipt = await txRes.wait();

  return receipt;
}

module.exports = {
  listenToDepositCreated,
  listenToDepositProcessed,
  listenToWithdrawalsClaimed,
  UnlockDepositOnchain,
  InitiateOnChainWithdrawal,
};
