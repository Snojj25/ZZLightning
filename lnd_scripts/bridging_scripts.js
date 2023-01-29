const { createInvoice } = require("./grpcConnection");
const { default: axios } = require("axios");
const { decodeInvoice, sendPayment } = require("./grpcConnection");

// ETH TO BTC  =============================================================

async function sendPaymentOnLightning(
  intiator,
  wbtc_amount,
  expirationTime,
  hash,
  lightning,
  router
) {
  // Get the payment request for this hash from the server
  let paymentRequest;
  try {
    let response = await axios.get(`http://localhost:4000/hash/${hash}`);
    paymentRequest = response.data;
  } catch (error) {
    console.log("Deposit failed with error: \n" + error);
  }

  let decodedInvoice = await decodeInvoice(lightning, paymentRequest);

  // TODO: make sure the amount being swapped is valid (not too small or too large)

  if (decodedInvoice.num_satoshis != wbtc_amount) {
    let err_msg = "Amounts do not match";
    return { err_msg };
  }
  // Assert the htlc expiry is at least 3 hours from now and that
  // the onchain expiry is at least 5 hours from that
  let now = Math.floor(Date.now() / 1000);
  if (
    Number.parseInt(decodedInvoice.expiry) < 10000 ||
    expirationTime - now < Number.parseInt(decodedInvoice.expiry) + 17000
  ) {
    let err_msg = "Expiration time is invalid";
    return { err_msg };
  }

  if (decodedInvoice.payment_hash != hash.substring(2)) {
    let err_msg = "Hashes do not match";
    return { err_msg };
  }

  let payment = await sendPayment(router, paymentRequest);

  if (payment.err_msg) {
    return { err_msg: payment.err_msg };
  }

  const preimage = payment.response.payment_preimage;

  return { preimage };

  // Claim the deposit oncahin
}

// BTC TO ETH  =============================================================

async function createPaymentInvoice(memo, wbtc_amount, expiry, lightning) {
  // The user should be able to decrypt the invoice and verify the amounts against the hash

  let InvoiceResult = await createInvoice(lightning, wbtc_amount, memo, expiry);

  if (!InvoiceResult) {
    return { err_msg: "Failed to create invoice" };
  }

  let paymentRequest = InvoiceResult.payment_request;
  let hash = InvoiceResult.r_hash;

  return { paymentRequest, hash };
}

module.exports = { sendPaymentOnLightning, createPaymentInvoice };
