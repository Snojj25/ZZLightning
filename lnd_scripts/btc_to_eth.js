import axios from "axios";
import { createInvoice } from "./utils";

export default async function createPaymentInvoice(
  memo,
  wbtc_amount,
  expiry,
  lightning
) {
  // The user should be able to decrypt the invoice and verify the amounts against the hash

  let InvoiceResult = await createInvoice(lightning, wbtc_amount, memo, expiry);

  if (!InvoiceResult) {
    return { err_msg: "Failed to create invoice" };
  }

  let paymentRequest = InvoiceResult.payment_request;
  let hash = InvoiceResult.r_hash;

  return { paymentRequest, hash };
}
