const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");
const { randomBytes } = require("crypto");
const fs = require("fs");
const crypto = require("crypto");

// Due to updated ECDSA generated tls.cert we need to let gprc know that
// we need to use that cipher suite otherwise there will be a handhsake
// error when we communicate with the lnd rpc server.
process.env.GRPC_SSL_CIPHER_SUITES = "HIGH+ECDSA";

// We need to give the proto loader some extra options, otherwise the code won't
// fully work with lnd.
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
let lightning = new lnrpc.Lightning("localhost:10001", credentials);
let router = new routerrpc.Router("localhost:10001", credentials);

// TODO: TEST ROUTER PAYMENT V2

main();

// console.log(request);

// * =======================================================================================
// * =======================================================================================
// * =======================================================================================

/**
 * [bar description]
//  * @param  {[type]} foo [description]
//  * @return {[type]}     [description]
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
  let request = {
    payment_request: paymentReq,
    timeout_seconds: 60,
    fee_limit_sat: 1000,
  };

  let call = router.sendPaymentV2(request);
  call.on("data", function (response) {
    // A response was received from the server.
    console.log("res: ", response);
  });
  call.on("status", function (status) {
    // The current status of the stream.
    console.log("status: ", status);
  });
  call.on("end", function () {
    // The server has closed the stream.
    console.log("end");
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
    } else {
      console.log("Response added: ", response);
    }
  });
}

function getCredentials() {
  const SSL_PATH = "/home/snojj25/.lnd/tls.cert";
  const MACAROON_PATH =
    "/home/snojj25/go/dev/alice/data/chain/bitcoin/simnet/admin.macaroon";

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
