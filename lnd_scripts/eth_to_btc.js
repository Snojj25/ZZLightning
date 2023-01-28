const { default: axios } = require("axios");
const { decodeInvoice, sendPayment } = require("./utils");

module.exports = async function sendPaymentOnLightning(
  intiator,
  wbtc_amount,
  expiry,
  hash,
  lightning,
  router
) {
  let expirationTime = expiry - Math.floor(Date.now() / 1000); // in seconds

  // Todo: Is 5 minutes enough? Maybe too much?
  if (expirationTime < 300) {
    let err_msg = "Expiration should be at least 5 minutes from now";
    console.log(err_msg);
    return { err_msg };
  }

  // Get the payment request for this hash from the server
  let paymentRequest;
  try {
    paymentRequest = await axios.get(`http://localhost:4000/hash/${hash}`);
  } catch (error) {
    // TODO: if this fails, we should have a way for a user to retry
    console.log("Deposit failed with error: \n" + error);
  }

  let decodedInvoice = await decodeInvoice(lightning, paymentRequest);

  if (decodedInvoice.num_satoshis !== wbtc_amount) {
    let err_msg = "Amounts do not match";
    return { err_msg };
  }
  if (decodedInvoice.expiry !== expiry) {
    let err_msg = "Expirations do not match";
    return { err_msg };
  }
  if (decodeInvoice.payment_hash !== hash) {
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
};

// module.exports = {
//   sendPaymentOnLightning,
// };
