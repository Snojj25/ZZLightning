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
const { default: createPaymentInvoice } = require("../lnd_scripts/btc_to_eth");
const { initGrpcConnections } = require("../lnd_scripts/utils");

dotenv.config();

// const db = new Pool({
//   connectionString: process.env.DATABASE_URL,
//   ssl: { rejectUnauthorized: false },
// });

// Note: For testing
const db = new Pool({
  host: "localhost",
  user: "database-user",
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

async function runDbMigration() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS hashes (
      hash UNIQUE TEXT PRIMARY KEY,
      paymentRequest TEXT
    )
  `);
}

// runDbMigration();

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
    await db.query(
      "INSERT INTO hashes VALUES ($1, $2) ON DUPLICATE KEY UPDATE paymentRequest = VALUES(paymentRequest) ",
      [hash, paymentRequest]
    );
  } catch (e) {
    return next(e.detail);
  }
  res.status(200).json({ success: true });
});

app.get("/hash/:hash", async (req, res, next) => {
  const hashes = await db.query("SELECT * FROM hashes WHERE hash=$1", [
    req.params.hash,
  ]);
  if (hashes.rows.length > 0)
    res.status(200).json(hashes.rows[0].paymentRequest);
  else next("Hash not found");
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
    expiry, // The expiry of the invoice
  } = req.body;

  let txReceipt = await InitiateOnChainWithdrawal(
    ethAddress,
    wbtc_amount,
    memo,
    expiry
  );
  // Todo: Check if successful

  let { paymentRequest, hash } = await createPaymentInvoice(
    memo,
    wbtc_amount,
    expiry,
    lightning
  );

  res.status(200).json({ success: true, paymentRequest, hash });
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

module.exports = { app, db, runDbMigration };
