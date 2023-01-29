const express = require("express");
const app = express();
const LNInvoice = require("@node-lightning/invoice");
const { Pool } = require("pg");
const crypto = require("crypto");
const dotenv = require("dotenv");
const {
  InitiateOnChainWithdrawal,
  listenToDepositProcessed,
  listenToWithdrawalsClaimed,
  listenToDepositCreated,
} = require("../lnd_scripts/ethers_utils");
const { createPaymentInvoice } = require("../lnd_scripts/bridging_scripts");
const {
  initGrpcConnections,
  subscribeToInvoices,
} = require("../lnd_scripts/grpcConnection");

dotenv.config();

const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function runDbMigration() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS hashes (
      hash UNIQUE TEXT PRIMARY KEY,
      paymentRequest TEXT
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS settled_invoices (
      hash UNIQUE TEXT PRIMARY KEY,
      preimage TEXT,
      wbtc_amount INTEGER,
      settle_date INTEGER
    )
  `);
}

// runDbMigration();

// NOTE: For testing just use a hashmap
const INVOICES = {};

const { lightning, router } = initGrpcConnections();

// CORS
app.use("/", (req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept"
  );
  res.header("Access-Control-Allow-Methods", "GET, POST");
  next();
});

app.use(express.json());

// ETH TO BTC  =============================================================
/**
 * If the user is bridging from ETH to BTC, he sends us an invoice before he deposits on ETH.
 * We store the invoice in the database and send a success response to the user \
 * so that he can deposit on ETH.
 */
app.post("/Eth2Btc", async (req, res, next) => {
  const hash = req.body.hash.toString("hex");
  const paymentRequest = req.body.paymentRequest;
  try {
    // await db.query(
    //   "INSERT INTO hashes VALUES ($1, $2) ON DUPLICATE KEY UPDATE paymentRequest = VALUES(paymentRequest) ",
    //   [hash, paymentRequest]
    // );

    INVOICES[hash] = paymentRequest;
  } catch (e) {
    return next(e.detail);
  }
  res.status(200).json({ success: true });
});

app.get("/hash/:hash", async (req, res, next) => {
  // const hashes = await db.query("SELECT * FROM hashes WHERE hash=$1", [
  //   req.params.hash,
  // ]);

  // if (hashes.rows.length > 0)
  //   res.status(200).json(hashes.rows[0].paymentRequest);
  // else next("Hash not found");

  if (INVOICES[req.params.hash]) {
    res.status(200).json(INVOICES[req.params.hash]);
  } else next("Hash not found");
});
// ==============================================================================

// BTC TO ETH  —————————————————————————————————————————————————————————————————
/**
 * If the user is bridging from BTC to ETH, we need to create an invoice
 * First we createWithdrawHash on ethereum and then we create an invoice on lightning
 * We send the invoice to the user and the user can pay for it and use the hash to withdraw from ethereum
 */
app.post("/Btc2Eth", async (req, res, next) => {
  const {
    ethAddress, // The users ETH address
    wbtc_amount, // The amount of WBTC to bridge
    memo, // The memo to include in the invoice
  } = req.body;

  let expiry = 86400; // 24 hours

  let { paymentRequest, hash } = await createPaymentInvoice(
    memo,
    wbtc_amount,
    expiry,
    lightning
  );

  let txReceipt = await InitiateOnChainWithdrawal(
    ethAddress,
    wbtc_amount,
    hash,
    expiry
  );
  if (txReceipt.status != 1) {
    return next("Transaction failed");
  }

  res.status(200).json({
    success: true,
    paymentRequest,
  });
});

// The user can get the preimage if the invoice has elready been settled
app.get("/preimage/:hash", async (req, res, next) => {
  const settled_invoice = await db.query(
    "SELECT * FROM settled_invoices WHERE hash=$1",
    [req.params.hash]
  );

  if (settled_invoice.rows.length > 0)
    res.status(200).json(settled_invoice.rows[0].preimage);
  else next("Hash not found");
});

// ————————————————————————————————————————————————————————————————————————————————

let CHANNELS = [];
app.post("/channels", async (req, res, next) => {
  CHANNELS = req.body;
  res.status(200).json({ success: true });
});

app.get("/channels", async (req, res, next) => {
  res.status(200).json(CHANNELS);
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ err });
});

// SUBSCRIPTIONS ----------------------------------------------------------------

listenToDepositCreated(lightning, router);
listenToDepositProcessed();
listenToWithdrawalsClaimed();
subscribeToInvoices(lightning, db);

module.exports = { app, db, runDbMigration };
