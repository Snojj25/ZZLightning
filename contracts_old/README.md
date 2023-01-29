# Lightning DEX

This DEX allows atomic swaps between EVM chains and Lightning.

# Arbitrum

Arbitrum is the first target EVM chain. 

Because both Arbitrum and Lightning settle instantly, this exchange should be able to settle swaps from native Bitcoin to native Ethereum or ERC-20 USDC in under 3 seconds. 

The first implementation of this exchange will feature BTC <> WBTC swaps, with ETH, USDC, USDT, and DAI support to come soon after.

# Ethereum 

15s block times on Ethereum mean a swap could take as much as 1-2 minutes to complete. Pricing swaps for that long will be difficult, so likely only BTC <> WBTC swaps will be offered at first with the possibiliy of higher fee (0.5%) swaps being added later for ETH and USDC.

Technically, it is not difficult to implement however, so this should follow soon after the Arbitrum DEX.  

# Bitcoin Base Layer

Support for base layer atmoci swaps will be added later since it's slightly more complex. Because of slow block settlement times, BTC <> WBTC will be the only pair offered at first. 

# Roadmap

This repo is under development and more info will be added soon. 

Until then check out the `contracts` folder for the implementation and the `test` folder for examples. 
