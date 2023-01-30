const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");
const { randomBytes } = require("crypto");
const fs = require("fs");
const crypto = require("crypto");
const path = require("path");

process.env.GRPC_SSL_CIPHER_SUITES = "HIGH+ECDSA";

const GRPC_HOST = "localhost:10001";
const SSL_PATH = "/home/snojj25/.lnd/tls.cert";
const MACAROON_PATH =
  "/home/snojj25/go/dev/alice/data/chain/bitcoin/simnet/admin.macaroon";

/**
 * This is used to communicate with the lnd node over gRPC
 */
function initGrpcConnections() {
  const loaderOptions = {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  };

  const PROTOS_PATH = path.join(path.dirname(__filename), "protos");
  const packageDefinition = protoLoader.loadSync(
    [
      path.join(PROTOS_PATH, "lightning.proto"),
      path.join(PROTOS_PATH, "walletunlocker.proto"),
      path.join(PROTOS_PATH, "router.proto"),
    ],
    loaderOptions
  );

  let lnrpcDescriptor = grpc.loadPackageDefinition(packageDefinition);

  let lnrpc = lnrpcDescriptor.lnrpc;
  const routerrpc = lnrpcDescriptor.routerrpc;

  let credentials = getCredentials();
  let lightning = new lnrpc.Lightning(GRPC_HOST, credentials);
  let router = new routerrpc.Router(GRPC_HOST, credentials);

  return {
    lightning,
    router,
  };
}

/**
 * Decodes a payment request
 */
async function decodeInvoice(lightning, payReq) {
  return new Promise((resolve) => {
    setTimeout(() => {
      let buff = Buffer.from(payReq, "utf-8");

      let request = {
        pay_req: buff.valueOf(),
      };

      lightning.decodePayReq(request, function (err, response) {
        if (err) {
          console.log("Error: " + err);
          resolve(null);
        }

        resolve(response);
      });
    }, 2000);
  });
}

async function sendPayment(router, paymentReq) {
  return new Promise((resolve) => {
    setTimeout(() => {
      let request = {
        payment_request: paymentReq,
        timeout_seconds: 60,
        fee_limit_sat: 1000,
      };

      let call = router.sendPaymentV2(request);
      call.on("data", function (response) {
        // A response was received from the server.

        if (response.status == "SUCCEEDED" || response.status == 2) {
          // Send a sucessful result

          resolve({ response, err_msg: null });
        } else if (response.status == "FAILED" || response.status == 3) {
          // Send a failed result

          resolve({ response: null, err_msg: response.failure_reason });
        }
      });
      call.on("status", function () {});
      call.on("end", function () {});
    }, 2000);
  });
}

async function subscribeToInvoices(lightning, db) {
  let call = lightning.subscribeInvoices({});
  call
    .on("data", function (invoice) {
      if (invoice.state == "SETTLED") {
        console.log("Invoice SETTLED: ", invoice);

        let payment_hash = invoice.r_hash.valueOf().toString("hex");
        let preimage = invoice.r_preimage.valueOf().toString("hex");
        let wbtc_amount = Number.parseInt(invoice.value);
        let settle_date = Number.parseInt(invoice.settle_date);

        db.query(
          "INSERT INTO settled_invoices VALUES ($1, $2, $3, $4) ON DUPLICATE KEY UPDATE preimage = VALUES(preimage), wbtc_amount = VALUES(wbtc_amount), settle_date = VALUES(settle_date) ",
          [payment_hash, preimage, wbtc_amount, settle_date]
        ).catch((err) => console.log(err));

        //
      } else if (invoice.state == "CANCELED") {
        // Probably reclaim the withdrawal onchain if this happens or send the invoice again?
      } else if (invoice.state == "ACCEPTED") {
        // Whats the difference between accepted and settled?
      }
    })
    .on("end", function () {})
    .on("status", function (status) {});
}

async function connectPeer(lightning) {
  let lightningAddress = {
    pubkey:
      "03ee2815e38e62777cfa29f3bdc1c850c39259d8585260562512f27be344677fe6",
    host: "localhost:10012",
  };

  lightning.connectPeer({ addr: lightningAddress }, function (err, response) {
    console.log(response);

    console.log(err);
  });
}

async function openChannel(lightning) {
  let request = {
    node_pubkey: Buffer.from(
      "03ee2815e38e62777cfa29f3bdc1c850c39259d8585260562512f27be344677fe6",
      "hex"
    ),
    local_funding_amount: 1000000,
  };

  let call = lightning.openChannel(request);
  call.on("data", function (response) {
    // A response was received from the server.
    console.log(response);

    if (response.update === "chan_pending") {
      console.log("Channel pending");
    } else if (response.update === "chan_open") {
      console.log("Channel open");
    }
  });
  call.on("status", function (status) {
    // The current status of the stream.
  });
  call.on("end", function () {
    // The server has closed the stream.
  });
}

async function allowOpenChannel(lightning) {
  let request = {
    accept: true,
    error: "",
    upfront_shutdown: "upfront_shutdown",
    csv_delay: 144,
    reserve_sat: 1000,
    in_flight_max_msat: 10000000000,
    max_htlc_count: 100,
    min_htlc_in: 1000,
    min_accept_depth: 1,
    zero_conf: true,
  };

  let channelAcceptor = lightning.channelAcceptor();
  channelAcceptor.on("data", async function (response) {
    // A response was received from the server.
    console.log(response);

    await channelAcceptor.write({ accept: true });
  });
  channelAcceptor.on("error", function (err) {
    // The current status of the stream.
    console.log(err);
  });
  channelAcceptor.on("end", function () {
    // The server has closed the stream.
  });
}

async function subscribeChannels(lightning) {
  let call = lightning.subscribeChannelEvents({});
  call.on("data", function (response) {
    // A response was received from the server.
    console.log(response);

    if (response.type === "OPEN_CHANNEL") {
      console.log("Channel opened");
    } else if (response.type === "CLOSE_CHANNEL") {
      console.log("Channel closed");
    }
  });
  call.on("status", function (status) {
    // The current status of the stream.
  });
  call.on("end", function () {
    // The server has closed the stream.
  });
}

function createInvoice(lightning, amountSats, memo, expiry) {
  return new Promise((resolve) => {
    setTimeout(() => {
      const preimage = crypto.randomBytes(32).valueOf();
      const hash = crypto
        .createHash("sha256")
        .update(preimage.toString("hex"), "hex")
        .digest()
        .valueOf();

      let request = {
        memo,
        r_preimage: preimage,
        r_hash: hash,
        value: amountSats,
        expiry: expiry,
        private: false,
      };

      lightning.addInvoice(request, function (err, response) {
        if (err) {
          console.log("Error: " + err);
          resolve(null);
        } else {
          resolve(response);
        }
      });
    }, 2000);
  });
}

function getCredentials() {
  //  Lnd cert is at ~/.lnd/tls.cert on Linux and
  //  ~/Library/Application Support/Lnd/tls.cert on Mac
  let lndCert = fs.readFileSync(SSL_PATH);
  let sslCreds = grpc.credentials.createSsl(lndCert);

  const macaroon = fs.readFileSync(MACAROON_PATH).toString("hex");
  const macaroonCreds = grpc.credentials.createFromMetadataGenerator(function (
    args,
    callback
  ) {
    let metadata = new grpc.Metadata();
    metadata.add("macaroon", macaroon);
    callback(null, metadata);
  });
  let creds = grpc.credentials.combineChannelCredentials(
    sslCreds,
    macaroonCreds
  );

  return creds;
}

function unlockWallet() {
  const string = "janchejanche";
  const bytes = new Uint8Array(string.length);
  for (let i = 0; i < string.length; i++) {
    bytes[i] = string.charCodeAt(i);
  }

  let client = new lnrpc.WalletUnlocker("localhost:10009", credentials);
  let request = {
    wallet_password: randomBytes(1000000),
  };
  client.unlockWallet(request, function (err, response) {
    console.log("Error: " + err);
  });
}

module.exports = {
  initGrpcConnections,
  decodeInvoice,
  sendPayment,
  subscribeToInvoices,
  createInvoice,
  getCredentials,
  unlockWallet,
};
