
forge create --rpc-url http://127.0.0.1:8545 --out contracts/out --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 contracts/src/MintableToken.sol:MintableToken

forge create --rpc-url http://127.0.0.1:8545 --out contracts/out \
    --constructor-args 0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266  0x5FbDB2315678afecb367f032d93F642f64180aa3 \
    --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
    contracts/src/BTCBridge.sol:ZigZagBTCBridge


node ./contracts/init_contract.js