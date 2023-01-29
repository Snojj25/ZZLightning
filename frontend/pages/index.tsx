import Head from 'next/head'
import Image from 'next/image'
import { Inter } from '@next/font/google'
import styles from '../styles/Home.module.css'
import React, { useState, useEffect } from 'react'
import { connectWallet } from '../helpers/wallet'
import { satsToBitcoin, bitcoinToSats } from '../helpers/utils'
import { ethers } from 'ethers'
import { OPEN_CHANNEL_FEE, NETWORK_FEE, CHAIN_CONFIG } from '../helpers/constants'
import Link from 'next/link'
let LNInvoice = require("@node-lightning/invoice");

const lightningPayReq = require("bolt11");


const ERC20_ABI = require('../helpers/ERC20.abi.json');
const BRIDGE_ABI = require('../helpers/BTCBridge.abi.json');

export default function Home() {
  
  const [userInvoice, setUserInvoice] = useState(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [myOrders, setMyOrders] = useState([] as any[]);

  async function updateOrders() {
    const wallets = await connectWallet();
    const ethersProvider = new ethers.providers.Web3Provider(wallets[0].provider, Number(wallets[0].chains[0].id))
    const address = wallets[0].accounts[0].address;
    const Bridge = new ethers.Contract(CHAIN_CONFIG.arbitrum.wbtcVaultAddress, BRIDGE_ABI, ethersProvider);
    const orders = await Bridge.queryFilter("DepositCreated");
    const orderArgs  = orders.map(o => ({ ...o.args, hash: o.args?.hash.slice(2) })); // Remove 0x in front of payment hash
    setMyOrders([ ...orderArgs]);
  }

  function handleTextAreaChange(e: any) {
    setUserInvoice(e.target?.value);
  }

  function getDecodedInvoice () {
    try {
      return LNInvoice.decode(userInvoice);
    } catch (e) {
      return {
        valueSat: 0,
        timestamp: Math.floor(Date.now() / 1000),
        expiry: 0,
        paymentHash: Buffer.alloc(0)
      }
    }
  }

  async function lockWBTC() {
    const decodedInvoice = getDecodedInvoice();
    const wbtc_amount = ethers.BigNumber.from(Math.floor(decodedInvoice.valueSat) + NETWORK_FEE);
    const payment_hash = decodedInvoice.paymentHash.toString('hex');
    if (payment_hash.length < 32) {
      return setErrorMessage('Payment hash is invalid');
    }

    const wallets = await connectWallet();
    const ethersProvider = new ethers.providers.Web3Provider(wallets[0].provider, Number(wallets[0].chains[0].id))
    const address = wallets[0].accounts[0].address;
    const WBTC = new ethers.Contract(CHAIN_CONFIG.arbitrum.wbtcAddress, ERC20_ABI, ethersProvider);
    const WBTCSigner = WBTC.connect(ethersProvider.getSigner());


    const allowance = await WBTC.allowance(address, CHAIN_CONFIG.arbitrum.wbtcVaultAddress);
    const balance = await WBTC.balanceOf(address);
    if (wbtc_amount.gt(balance)) {
      const max_send = balance.sub(NETWORK_FEE);
      return setErrorMessage(`Amount + Fee exceeds balance. Max invoice amount should be ${max_send} sats`);
    }
    if (wbtc_amount.gt(allowance)) {
      const approveTx = await WBTCSigner.approve(CHAIN_CONFIG.arbitrum.wbtcVaultAddress, ethers.constants.MaxUint256);
    }

    const expiry = Math.floor(Date.now() / 1000) + 7200;
    const Bridge = new ethers.Contract(CHAIN_CONFIG.arbitrum.wbtcVaultAddress, BRIDGE_ABI);
    const BridgeSigner = Bridge.connect(ethersProvider.getSigner());
    const hashStatus = await BridgeSigner.DEPOSIT_HASHES('0x' + payment_hash);
    if (hashStatus.wbtc_amount.gt(0)) {
      return setErrorMessage("Hash is already funded");
    }
    try {
      console.log(wbtc_amount.toString(), '0x' + payment_hash, expiry);
      const depositTx = await BridgeSigner.createDepositHash(wbtc_amount.toString(), '0x' + payment_hash, expiry);
      await submitInvoice();
      const depositResponse = await depositTx.wait();
      const newOrder = { hash: payment_hash, wbtc_amount, expiry, intiator: address };
      setMyOrders([ ...myOrders, newOrder ]);
    } catch (e: any) {
      return setErrorMessage(e.message);
    }

  }

  async function submitInvoice() {
    const response = await fetch('https://api.bitcoin.zigzag.exchange/invoice', {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        invoice: userInvoice
      })
    });
    const json = await response.json();
    if (response.status != 200) {
      throw new Error(json.err);
    }
  }

  function getExpiryMinutes (unix_timestamp: number) {
    const now = Math.floor(Date.now() / 1000);
    return Math.floor((unix_timestamp - now) / 60)
  }

  async function reclaimHash(payment_hash: string) {
    const wallets = await connectWallet();
    const ethersProvider = new ethers.providers.Web3Provider(wallets[0].provider, Number(wallets[0].chains[0].id))
    const address = wallets[0].accounts[0].address;
    const Bridge = new ethers.Contract(CHAIN_CONFIG.arbitrum.wbtcVaultAddress, BRIDGE_ABI, ethersProvider);
    const BridgeSigner = Bridge.connect(ethersProvider.getSigner());
    const deposit_info = await Bridge.DEPOSIT_HASHES('0x' + payment_hash);
    if (deposit_info.wbtc_amount.eq(0)) return setErrorMessage("Swap was successful. Nothing to claim.");
    try {
      const reclaimTx = await BridgeSigner.reclaimDepositHash('0x' + payment_hash);
    } catch (e: any) {
      return setErrorMessage(e.message);
    }
  }

  const decodedInvoice = getDecodedInvoice();
  const orderRows = []
  for (let i in myOrders) {
    const order = myOrders[i];
    const expiry_minutes = getExpiryMinutes(order.expiry);
    const expiry_text = expiry_minutes > 0 ? expiry_minutes + "m" : "expired";
    const reclaim_disabled = expiry_minutes > 0;
    orderRows.push((    
       <tr>
          <td>{order.hash}</td>
          <td>{satsToBitcoin(order.wbtc_amount.toString())} WBTC</td>
          <td>{expiry_text}</td>
          <td><button disabled={reclaim_disabled} onClick={e => reclaimHash(order.hash)}>Reclaim</button></td>
        </tr>
    ));
  }
  return (
    <>
      <Head>
        <title>Lightning DEX</title>
        <meta name="description" content="The Lightning to Ethereum Exchange" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.ico" />
      </Head>
      <main className={styles.main}>
        <nav>
          <Link href="/">Swap</Link>&nbsp;
          <Link href="/pool">Pool</Link>&nbsp;
          <Link href="/help">Help</Link>
        </nav>

        <h1>Swap WBTC for BTC</h1>

        <textarea placeholder="Paste lightning invoice here..." rows={5} onChange={handleTextAreaChange}></textarea>
        <div>Receive: {satsToBitcoin(decodedInvoice.valueSat)} BTC</div>
        <div>Send: {satsToBitcoin(Number(decodedInvoice.valueSat) + NETWORK_FEE)} WBTC</div>
        <div>Payment Hash: {decodedInvoice.paymentHash.toString('hex')}</div>
        <p><button onClick={lockWBTC}>Send Order</button></p>
        <p className={styles.errormessage}>{errorMessage}</p>

        <div><button onClick={updateOrders}>Refresh Orders</button></div>
        <h3>My Orders</h3>
        <table className="my-orders-table">
          <thead>
            <tr>
              <th>Payment Hash</th>
              <th>Amount</th>
              <th>Expires</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {orderRows}
          </tbody>
        </table>
      </main>
    </>
  )
}
