const path = require("path");
const { default: axios } = require("axios");
const crypto = require("crypto");
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
  require("../../contracts/out/BTCBridge.sol/ZigZagBTCBridge.json").abi;
const tokenContract = new ethers.Contract(tokenAddress, tokenAbi, signer);

const lightningPayReq = require("bolt11");
const { Module } = require("module");

// GOING FROM ETH TO BTC =================================================================================================
class Eth2Btc {
  constructor(paymentRequest) {
    let decoded = lightningPayReq.decode(paymentRequest);
    this.paymentRequest = paymentRequest;
    this.wbtc_amount = decoded.satoshis;
    this.expiry = decoded.timeExpireDate - decoded.timestamp;
    this.payment_hash =
      "0x" + decoded.tags.find((tag) => tag.tagName == "payment_hash").data;

    this.invoiceRegistered = false; // Note: When this is set to true the user can start the deposit on ETH
  }

  // First he creates an invoice for what he wants to bridge
  // Then he sends the invoice to the backend which registers and accepts it
  async registerInvoice() {
    let res = await axios
      .post("http://localhost:4000/Eth2Btc", {
        hash: this.payment_hash,
        paymentRequest: this.paymentRequest,
      })
      .catch((err) => {
        throw new Error(err);
      });

    if (res.data.success) {
      this.invoiceRegistered = true;
    }
  }

  // The user then approves the deposit on ETH
  async approveDeposit() {
    if (!this.invoiceRegistered)
      throw new Error("Registered the invoice with the exchange first");

    let txRes = await tokenContract.approve(
      zzLightningAddress,
      this.wbtc_amount,
      {
        gasLimit: 3000000,
      }
    );
    let receipt = await txRes.wait();

    return receipt;
  }

  // Then he depositis on ETH using the hash from the invoice
  // Then the backend listens for the DepositProcessed event and sends him the htlc
  // The users accept the htlc and the exchange uses the preimage to unlock the deposit on ETH (or makes the user do it)
  async createDepositHash() {
    if (!this.invoiceRegistered)
      throw new Error("Registered the invoice with the exchange first");

    let onChainExpiration = Math.floor(Date.now() / 1000) + this.expiry + 18000; // Curernt time + expiry + 5 hours - so the exchange has enough time to claim the deposit

    let txRes = await zzLNContract.createDepositHash(
      this.wbtc_amount,
      this.payment_hash,
      onChainExpiration,
      {
        gasLimit: 3000000,
      }
    );
    let receipt = await txRes.wait();

    return receipt;
  }
}

// GOING FROM BTC TO ETH =================================================================================================
class Btc2Eth {
  constructor(ethAddress, wbtc_amount, memo) {
    this.ethAddress = ethAddress; // The users ETH address
    this.wbtc_amount = wbtc_amount; // The amount of WBTC to bridge
    this.memo = memo; // Optional memo to attach to the transaction
    //
    this.decodedAmount = null;
    this.decodedHash = null;
    this.decodedExpirationTime = null;

    this.withdrawalClaimable = false; // Note: When this is set to true the user can start the withdrawal on ETH
  }

  // First he sends the request to the backend with the amount he wants to bridge,
  // the address he wants to receive the tokens to and a memo(optional)
  // The backend creates an invoice and sends it back to the user
  async startSwap() {
    let res = await axios
      .post("http://localhost:4000/Btc2Eth", {
        ethAddress: this.ethAddress,
        wbtc_amount: this.wbtc_amount,
        memo: this.memo,
      })
      .catch((err) => {
        throw new Error(err);
      });

    if (res.data.success) {
      this.paymentRequest = res.data.paymentRequest;
    } else {
      throw new Error("Error geting invoice");
    }

    let decoded = lightningPayReq.decode(this.paymentRequest);
    this.decodedAmount = decoded.satoshis;
    this.decodedExpirationTime = decoded.timeExpireDate;
    this.decodedHash =
      "0x" + decoded.tags.find((tag) => tag.tagName == "payment_hash").data;

    return await this.listenForWithdrawalHashEvent();
  }

  // The user listens for the onchain event WithdrawCreated
  // Then he pays the invoice and receives back the preimage
  // The user uses the preimage to withdraw on ethereum
  async listenForWithdrawalHashEvent() {
    return new Promise((resolve) => {
      setTimeout(() => {
        zzLNContract.on(
          "WithdrawCreated",
          (counterparty, wbtc_amount, onChainExpiry, hash) => {
            console.log(
              "WithdrawCreated: ",
              counterparty,
              wbtc_amount,
              onChainExpiry,
              hash
            );

            if (hash != this.decodedHash) {
              return this.listenForWithdrawalHashEvent();
            }

            if (counterparty.toLowerCase() != this.ethAddress.toLowerCase()) {
              throw new Error("Wrong counterparty");
            }
            if (
              this.wbtc_amount != wbtc_amount ||
              wbtc_amount != this.decodedAmount
            ) {
              throw new Error("Wrong amount");
            }

            // Assert the htlc expiry is at least 3 hours from now and that
            // the onchain expiry is about 2 days from that
            let now = Math.floor(Date.now() / 1000);
            if (
              Number.parseInt(this.decodedExpirationTime) - now < 10000 ||
              Number.parseInt(onChainExpiry) <
                Number.parseInt(this.decodedExpirationTime) + 170_000
            ) {
              throw new Error("Expiration time is invalid");
            }

            // If all that passes, then the user can pay the invoice
            resolve(this.paymentRequest);
          }
        );
      }, 500);
    });
  }

  // After the user pays and receives the preimage he can withdraw on ETH
  async unlockWithdrawal(preimage) {
    if (!preimage) {
      let response = await axios
        .get(`http://localhost:4000/hash/${hash}`)
        .catch((err) => {
          throw new Error(err);
        });
      preimage = response.data;
    }

    const hash_check = crypto
      .createHash("sha256")
      .update(preimage.toString("hex"), "hex")
      .digest()
      .valueOf()
      .toString("hex");

    if (hash_check != this.decodedHash) {
      throw new Error("Preimage is incorrect");
    }

    let txRes = await zzLNContract.unlockWithdrawHash(
      this.decodedHash,
      preimage.toString("hex"),
      {
        gasLimit: 3000000,
      }
    );

    let receipt = await txRes.wait();

    return receipt;
  }
}

module.exports = {
  Eth2Btc,
  Btc2Eth,
};
