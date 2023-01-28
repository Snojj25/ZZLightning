const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");
const { randomBytes } = require("crypto");
const fs = require("fs");
const crypto = require("crypto");

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
  const packageDefinition = protoLoader.loadSync(
    [
      "protos/lightning.proto",
      "protos/walletunlocker.proto",
      "protos/router.proto",
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

function subscribeToInvoices(lightning) {
  let call = lightning.subscribeInvoices({});
  call
    .on("data", function (invoice) {
      console.log(invoice);
    })
    .on("end", function () {
      // The server has finished sending
    })
    .on("status", function (status) {
      // Process status
      console.log("Current status" + status);
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
    console.log(response);

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
