const express = require('express')
const app = express()
const LNInvoice = require("@node-lightning/invoice");
const { Pool } = require('pg');
const crypto = require('crypto');
const dotenv = require('dotenv');

dotenv.config()

const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
})

async function runDbMigration () {
  await db.query(`
    CREATE TABLE IF NOT EXISTS hashes (
      hash TEXT PRIMARY KEY,
      invoice TEXT,
      preimage TEXT,
      expiry INTEGER
    )
  `);
}

runDbMigration();

// CORS
app.use('/', (req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*')
  res.header(
    'Access-Control-Allow-Headers',
    'Origin, X-Requested-With, Content-Type, Accept'
  )
  res.header('Access-Control-Allow-Methods', 'GET, POST')
  next()
})

app.use(express.json());

app.post('/invoice', async (req, res, next) => {
  const invoice = req.body.invoice;
  let decodedInvoice;
  try {
    decodedInvoice = LNInvoice.decode(invoice);
  } catch (e) {
    return next("Bad invoice: " + e.message);
  }
  const now = parseInt(Date.now() / 1000)
  const unix_expiry = decodedInvoice.timestamp + decodedInvoice.expiry;
  if (unix_expiry < now + 600) {
    return next("Bad expiry. Expiry should be 1 hour");
  }
  const hash = decodedInvoice.paymentHash.toString('hex');
  try {
    await db.query("INSERT INTO hashes (hash, invoice, expiry) VALUES ($1, $2, $3)", [hash, invoice, unix_expiry]);
  }
  catch (e) {
    return next(e.detail);
  }
  res.status(200).json({"success": true });
})

app.get('/invoices', async (req, res) => {
  const invoices = await db.query("SELECT * FROM hashes WHERE invoice IS NOT NULL AND expiry > EXTRACT(EPOCH FROM NOW())");
  res.status(200).json(invoices.rows);
});

app.get('/hash/:hash', async (req, res, next) => {
  const hashes = await db.query("SELECT * FROM hashes WHERE hash=$1", [payment_hash]);
  if (hashes.rows.length > 0) res.status(200).json(hashes.rows[0]);
  else next("Hash not found");
})

app.post('/hash/preimage', async (req, res, next) => {
  const preimage = req.body.preimage;
  const hash = req.body.hash;
  const computedHash = crypto.createHash('sha256').update(preimage, 'hex').digest('hex');
  if (hash !== computedHash) return next("preimage does not match hash");
  await db.query("INSERT INTO hashes (hash, preimage) VALUES ($1,$2) ON CONFLICT (hash) DO UPDATE SET preimage=$2", [hash, preimage]);
  res.status(200).json({"success": true });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ err })
})

module.exports = { app, db, runDbMigration }