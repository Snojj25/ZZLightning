import { ethers } from "hardhat";
import { expect } from "chai";
import { TESTRPC_PRIVATE_KEYS_STRINGS } from "./utils/PrivateKeyList"
import { Contract, Wallet } from "ethers";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import crypto from 'crypto'

describe("BTCBridge", function () {

    const WBTC_DECIMALS = 8;
    let bridgeContract: Contract;
    let WBTC: Contract;
    let wallets: Wallet[] = [];
    let manager: any;

    beforeEach(async function () {
        const Bridge = await ethers.getContractFactory("ZigZagBTCBridge");
        const Token = await ethers.getContractFactory("MintableToken");

        WBTC = await Token.deploy();
        let [owner] = await ethers.getSigners();

        for (let i = 0; i < 4; i++) {
            wallets[i] = new ethers.Wallet(TESTRPC_PRIVATE_KEYS_STRINGS[i], ethers.provider)

            await owner.sendTransaction({
                to: wallets[i].address,
                value: ethers.utils.parseEther("1") // 1 ether
            })
        }

        manager = wallets[3];
        bridgeContract = await Bridge.deploy(manager.address, WBTC.address);

        await WBTC.mint(ethers.utils.parseUnits("10000", WBTC_DECIMALS), wallets[0].address);
        await WBTC.mint(ethers.utils.parseUnits("10000", WBTC_DECIMALS), wallets[1].address);
        await WBTC.mint(ethers.utils.parseUnits("1", WBTC_DECIMALS), bridgeContract.address);
        await WBTC.connect(wallets[0]).approve(bridgeContract.address, ethers.utils.parseUnits("10000", WBTC_DECIMALS));
        await WBTC.connect(wallets[1]).approve(bridgeContract.address, ethers.utils.parseUnits("10000", WBTC_DECIMALS));
    });

    it("Manager should be able to set deposit rate", async function () {
        await bridgeContract.connect(manager).setDepositRate(370);
        const deposit_rate_numerator = await bridgeContract.DEPOSIT_RATE_NUMERATOR();
        await expect(deposit_rate_numerator).to.equal(370);
    });

    it("Non-manager should not be able to set deposit rate", async function () {
        await expect(bridgeContract.connect(wallets[0]).setDepositRate(370)).to.be.revertedWith("only manager can set deposit rate");
    });

    it("Should update LP price when deposit rate is set", async function () {
        await bridgeContract.connect(manager).setDepositRate(370);
        await time.increase(86400*180);
        await bridgeContract.connect(manager).updateLPPrice();
        const lp_price_numerator = await bridgeContract.LP_PRICE_NUMERATOR();
        expect(lp_price_numerator).to.equal(1e12 + 86400*180*370 + 370);
    });

    it("Anyone should be able to update LP Price", async function () {
        await bridgeContract.connect(manager).setDepositRate(370);
        await time.increase(86400*180);
        await bridgeContract.connect(wallets[0]).updateLPPrice();
    });

    it("Should allow manager to update manager", async function () {
        await bridgeContract.connect(manager).updateManager(wallets[1].address);
        await bridgeContract.connect(wallets[1]).updateManager(manager.address);
    });

    it("Non-manager should not be able to update manager", async function () {
        await expect(bridgeContract.connect(wallets[0]).updateManager(wallets[1].address)).to.be.revertedWith("only manager can update manager");
    });

    it("Deposit + withdraw LP w/ interest", async function () {
        await bridgeContract.connect(manager).setDepositRate(370);

        await bridgeContract.connect(wallets[0]).depositWBTCToLP(ethers.utils.parseUnits("1", WBTC_DECIMALS));
        let lp_balance = await bridgeContract.balanceOf(wallets[0].address);
        let wbtc_balance = await WBTC.balanceOf(wallets[0].address);
        expect(lp_balance.toString()).to.equal("999999999630000000");
        expect(wbtc_balance).to.equal(ethers.utils.parseUnits("9999", 8));

        await time.increase(86400);

        await bridgeContract.connect(wallets[0]).withdrawWBTCFromLP(lp_balance);
        wbtc_balance = await WBTC.balanceOf(wallets[0].address);
        lp_balance = await bridgeContract.balanceOf(wallets[0].address);
        expect(wbtc_balance.toString()).to.equal("1000000003196");
        expect(lp_balance.toString()).to.equal("0");
    });

    it("Deposit takes money", async function () {
        const beforeContractBalance = await WBTC.balanceOf(bridgeContract.address);
        const beforeUserBalance = await WBTC.balanceOf(wallets[0].address);

        const preimage = Buffer.from('check', "utf-8");
        const hash = '0x' + crypto.createHash('sha256').update(preimage).digest('hex');
        const deposit_amount = ethers.utils.parseUnits("1", 8);
        const expires = (await time.latest()) + 3600;
        await bridgeContract.connect(wallets[0]).createDepositHash(deposit_amount, hash, expires);

        const afterContractBalance = await WBTC.balanceOf(bridgeContract.address);
        const afterUserBalance = await WBTC.balanceOf(wallets[0].address);

        expect(afterContractBalance.sub(beforeContractBalance)).to.equal(deposit_amount);
        expect(beforeUserBalance.sub(afterUserBalance)).to.equal(deposit_amount);
    });

    it("Deposit and unlock hash", async function () {
        const preimage = Buffer.from('check check', "utf-8");
        const hash = '0x' + crypto.createHash('sha256').update(preimage).digest('hex');
        const deposit_amount = ethers.utils.parseUnits("1", 8);
        const expires = (await time.latest()) + 3600;
        await bridgeContract.connect(wallets[0]).createDepositHash(deposit_amount, hash, expires);
        await bridgeContract.connect(wallets[0]).unlockDepositHash(hash, '0x' + preimage.toString('hex'));
    });

    it("Deposit unlock fails with bad preimage", async function () {
        const preimage = Buffer.from('check check', "utf-8");
        const hash = '0x' + crypto.createHash('sha256').update(preimage).digest('hex');
        const deposit_amount = ethers.utils.parseUnits("1", 8);
        const expires = (await time.latest()) + 3600;
        await bridgeContract.connect(wallets[0]).createDepositHash(deposit_amount, hash, expires);
        await expect(bridgeContract.connect(wallets[0]).unlockDepositHash(hash, '0xab' + preimage.toString('hex'))).to.be.revertedWith("preimage does not match hash");
    });

    it("Deposit unlock fails when expired", async function () {
        const preimage = Buffer.from('check check', "utf-8");
        const hash = '0x' + crypto.createHash('sha256').update(preimage).digest('hex');
        const deposit_amount = ethers.utils.parseUnits("1", 8);
        const expires = (await time.latest()) + 3600;
        await bridgeContract.connect(wallets[0]).createDepositHash(deposit_amount, hash, expires);

        await time.increase(86400);

        await expect(bridgeContract.connect(wallets[0]).unlockDepositHash(hash, '0x' + preimage.toString('hex'))).to.be.revertedWith("HTLC is expired");
    });

    it("Reclaim expired deposit hash", async function () {
        const preimage = Buffer.from('check check', "utf-8");
        const hash = '0x' + crypto.createHash('sha256').update(preimage).digest('hex');
        const deposit_amount = ethers.utils.parseUnits("1", 8);
        const expires = (await time.latest()) + 3600;
        await bridgeContract.connect(wallets[0]).createDepositHash(deposit_amount, hash, expires);

        await time.increase(86400);

        await bridgeContract.connect(wallets[0]).reclaimDepositHash(hash)
    });

    it("Cannot reclaimed unexpired deposit hash", async function () {
        const preimage = Buffer.from('check check', "utf-8");
        const hash = '0x' + crypto.createHash('sha256').update(preimage).digest('hex');
        const deposit_amount = ethers.utils.parseUnits("1", 8);
        const expires = (await time.latest()) + 3600;
        await bridgeContract.connect(wallets[0]).createDepositHash(deposit_amount, hash, expires);
        await expect(bridgeContract.connect(wallets[0]).reclaimDepositHash(hash)).to.be.revertedWith("HTLC is active");
    });

    it("Create withdraw hash", async function () {
        const preimage = Buffer.from('check check', "utf-8");
        const hash = '0x' + crypto.createHash('sha256').update(preimage).digest('hex');
        const deposit_amount = ethers.utils.parseUnits("1", 8);
        const expires = (await time.latest()) + 3600;
        await bridgeContract.connect(manager).createWithdrawHash(wallets[0].address, deposit_amount, hash, expires);
    });

    it("Only manager can create withdraw hash", async function () {
        const preimage = Buffer.from('check check', "utf-8");
        const hash = '0x' + crypto.createHash('sha256').update(preimage).digest('hex');
        const deposit_amount = ethers.utils.parseUnits("1", 8);
        const expires = (await time.latest()) + 3600;
        await expect(bridgeContract.connect(wallets[1]).createWithdrawHash(wallets[0].address, deposit_amount, hash, expires))
          .to.be.revertedWith("only manager can create withdraw hashes")
    });

    it("Unlocking withdraw hash sends money", async function () {
        const beforeContractBalance = await WBTC.balanceOf(bridgeContract.address);
        const beforeUserBalance = await WBTC.balanceOf(wallets[0].address);

        const preimage = Buffer.from('check check', "utf-8");
        const hash = '0x' + crypto.createHash('sha256').update(preimage).digest('hex');
        const withdraw_amount = ethers.utils.parseUnits("1", 8);
        const expires = (await time.latest()) + 3600;
        await bridgeContract.connect(manager).createWithdrawHash(wallets[0].address, withdraw_amount, hash, expires);
        await bridgeContract.connect(wallets[0]).unlockWithdrawHash(hash, preimage);

        const afterContractBalance = await WBTC.balanceOf(bridgeContract.address);
        const afterUserBalance = await WBTC.balanceOf(wallets[0].address);

        expect(beforeContractBalance.sub(afterContractBalance)).to.equal(withdraw_amount);
        expect(afterUserBalance.sub(beforeUserBalance)).to.equal(withdraw_amount);
    });

    it("Cannot unlock withdraw hash with bad preimage", async function () {
        const preimage = Buffer.from('check check', "utf-8");
        const hash = '0x' + crypto.createHash('sha256').update(preimage).digest('hex');
        const withdraw_amount = ethers.utils.parseUnits("1", 8);
        const expires = (await time.latest()) + 3600;
        await bridgeContract.connect(manager).createWithdrawHash(wallets[0].address, withdraw_amount, hash, expires);
        await expect(bridgeContract.connect(wallets[0]).unlockWithdrawHash(hash, '0xab' + preimage.toString('hex')))
          .to.be.revertedWith("preimage does not match hash");
    });

    it("Cannot unlock expired withdraw hash", async function () {
        const preimage = Buffer.from('check check', "utf-8");
        const hash = '0x' + crypto.createHash('sha256').update(preimage).digest('hex');
        const withdraw_amount = ethers.utils.parseUnits("1", 8);
        const expires = (await time.latest()) + 3600;

        await time.increase(86400);

        await bridgeContract.connect(manager).createWithdrawHash(wallets[0].address, withdraw_amount, hash, expires);
        await expect(bridgeContract.connect(wallets[0]).unlockWithdrawHash(hash, preimage))
          .to.be.revertedWith("HTLC is expired");
    });

    it("Reclaim expired withdraw hash", async function () {
        const preimage = Buffer.from('check check', "utf-8");
        const hash = '0x' + crypto.createHash('sha256').update(preimage).digest('hex');
        const withdraw_amount = ethers.utils.parseUnits("1", 8);
        const expires = (await time.latest()) + 3600;

        await time.increase(86400);

        await bridgeContract.connect(manager).createWithdrawHash(wallets[0].address, withdraw_amount, hash, expires);
        await bridgeContract.connect(wallets[0]).reclaimWithdrawHash(hash)
    });

    it("Cannot reclaim unexpired withdraw hash", async function () {
        const preimage = Buffer.from('check check', "utf-8");
        const hash = '0x' + crypto.createHash('sha256').update(preimage).digest('hex');
        const withdraw_amount = ethers.utils.parseUnits("1", 8);
        const expires = (await time.latest()) + 3600;
        await bridgeContract.connect(manager).createWithdrawHash(wallets[0].address, withdraw_amount, hash, expires);
        await expect(bridgeContract.connect(wallets[0]).reclaimWithdrawHash(hash)).to.be.revertedWith("HTLC is active");
    });

    it("Cannot double fund withdraw hash", async function () {
        const preimage = Buffer.from('check check', "utf-8");
        const hash = '0x' + crypto.createHash('sha256').update(preimage).digest('hex');
        const withdraw_amount = ethers.utils.parseUnits("1", 8);
        const expires = (await time.latest()) + 3600;
        await bridgeContract.connect(manager).createWithdrawHash(wallets[0].address, withdraw_amount, hash, expires);
        await expect(bridgeContract.connect(manager).createWithdrawHash(wallets[0].address, withdraw_amount, hash, expires))
          .to.be.revertedWith("hash is already funded");
    });

    it("Cannot double reclaim withdraw hash", async function () {
        const preimage = Buffer.from('check check', "utf-8");
        const hash = '0x' + crypto.createHash('sha256').update(preimage).digest('hex');
        const withdraw_amount = ethers.utils.parseUnits("1", 8);
        const expires = (await time.latest()) + 3600;
        await bridgeContract.connect(manager).createWithdrawHash(wallets[0].address, withdraw_amount, hash, expires);
        
        await time.increase(86400)

        await bridgeContract.connect(wallets[0]).reclaimWithdrawHash(hash)
        await expect(bridgeContract.connect(wallets[0]).reclaimWithdrawHash(hash)).to.be.revertedWith("hash is not funded");
    });

    it("Cannot double unlock withdraw hash", async function () {
        const preimage = Buffer.from('check check', "utf-8");
        const hash = '0x' + crypto.createHash('sha256').update(preimage).digest('hex');
        const withdraw_amount = ethers.utils.parseUnits("1", 8);
        const expires = (await time.latest()) + 3600;

        await bridgeContract.connect(manager).createWithdrawHash(wallets[0].address, withdraw_amount, hash, expires);
        await bridgeContract.connect(wallets[0]).unlockWithdrawHash(hash, preimage);
        await expect(bridgeContract.connect(wallets[0]).unlockWithdrawHash(hash, preimage))
          .to.be.reverted
    });

    it("Cannot double fund deposit hash", async function () {
        const preimage = Buffer.from('check check', "utf-8");
        const hash = '0x' + crypto.createHash('sha256').update(preimage).digest('hex');
        const deposit_amount = ethers.utils.parseUnits("1", 8);
        const expires = (await time.latest()) + 3600;
        await bridgeContract.connect(wallets[0]).createDepositHash(deposit_amount, hash, expires);
        await expect(bridgeContract.connect(wallets[0]).createDepositHash(deposit_amount, hash, expires)).to.be.revertedWith("hash is already funded");
    });

    it("Cannot double reclaim deposit hash", async function () {
        const preimage = Buffer.from('check check', "utf-8");
        const hash = '0x' + crypto.createHash('sha256').update(preimage).digest('hex');
        const deposit_amount = ethers.utils.parseUnits("1", 8);
        const expires = (await time.latest()) + 3600;
        await bridgeContract.connect(wallets[0]).createDepositHash(deposit_amount, hash, expires);
        
        await time.increase(86400)

        await bridgeContract.connect(wallets[0]).reclaimDepositHash(hash)
        await expect(bridgeContract.connect(wallets[0]).reclaimDepositHash(hash)).to.be.revertedWith("hash is not funded");
    });

    it("Cannot double unlock deposit hash", async function () {
        const preimage = Buffer.from('check check', "utf-8");
        const hash = '0x' + crypto.createHash('sha256').update(preimage).digest('hex');
        const deposit_amount = ethers.utils.parseUnits("1", 8);
        const expires = (await time.latest()) + 3600;
        await bridgeContract.connect(wallets[0]).createDepositHash(deposit_amount, hash, expires);
        await bridgeContract.connect(wallets[0]).unlockDepositHash(hash, preimage)
        await expect(bridgeContract.connect(wallets[0]).unlockDepositHash(hash, preimage)).to.be.reverted
    });

    it("DepositCreated event", async function () {
        const preimage = Buffer.from('check233', "utf-8");
        const hash = '0x' + crypto.createHash('sha256').update(preimage).digest('hex');
        const deposit_amount = ethers.utils.parseUnits("1", 8);
        const expires = (await time.latest()) + 3600;
        const tx = await bridgeContract.connect(wallets[0]).createDepositHash(deposit_amount, hash, expires);
        await expect(tx).to.emit(bridgeContract, "DepositCreated").withArgs(wallets[0].address, deposit_amount, expires, hash);
    });

    it("DepositRevoked event", async function () {
        const preimage = Buffer.from('check234', "utf-8");
        const hash = '0x' + crypto.createHash('sha256').update(preimage).digest('hex');
        const deposit_amount = ethers.utils.parseUnits("1", 8);
        const expires = (await time.latest()) + 3600;
        await bridgeContract.connect(wallets[0]).createDepositHash(deposit_amount, hash, expires);

        await time.increase(86400);

        const tx = await bridgeContract.connect(wallets[0]).reclaimDepositHash(hash)
        await expect(tx).to.emit(bridgeContract, "DepositRevoked").withArgs(hash);
    });

    it("DepositProcessed event", async function () {
        const preimage = Buffer.from('check235', "utf-8");
        const hash = '0x' + crypto.createHash('sha256').update(preimage).digest('hex');
        const deposit_amount = ethers.utils.parseUnits("1", 8);
        const expires = (await time.latest()) + 3600;
        await bridgeContract.connect(wallets[0]).createDepositHash(deposit_amount, hash, expires);
        const tx = await bridgeContract.connect(wallets[0]).unlockDepositHash(hash, preimage);
        await expect(tx).to.emit(bridgeContract, "DepositProcessed").withArgs(wallets[0].address, deposit_amount, preimage, hash);
    });

    it("WithdrawCreated event", async function () {
        const preimage = Buffer.from('check233', "utf-8");
        const hash = '0x' + crypto.createHash('sha256').update(preimage).digest('hex');
        const deposit_amount = ethers.utils.parseUnits("1", 8);
        const expires = (await time.latest()) + 3600;
        const tx = await bridgeContract.connect(manager).createWithdrawHash(wallets[0].address, deposit_amount, hash, expires);
        await expect(tx).to.emit(bridgeContract, "WithdrawCreated").withArgs(wallets[0].address, deposit_amount, expires, hash);
    });

    it("WithdrawRevoked event", async function () {
        const preimage = Buffer.from('check234', "utf-8");
        const hash = '0x' + crypto.createHash('sha256').update(preimage).digest('hex');
        const deposit_amount = ethers.utils.parseUnits("1", 8);
        const expires = (await time.latest()) + 3600;
        await bridgeContract.connect(manager).createWithdrawHash(wallets[0].address, deposit_amount, hash, expires);

        await time.increase(86400);

        const tx = await bridgeContract.connect(manager).reclaimWithdrawHash(hash)
        await expect(tx).to.emit(bridgeContract, "WithdrawRevoked").withArgs(hash);
    });

    it("WithdrawProcessed event", async function () {
        const preimage = Buffer.from('check235', "utf-8");
        const hash = '0x' + crypto.createHash('sha256').update(preimage).digest('hex');
        const deposit_amount = ethers.utils.parseUnits("1", 8);
        const expires = (await time.latest()) + 3600;
        await bridgeContract.connect(manager).createWithdrawHash(wallets[0].address, deposit_amount, hash, expires);
        const tx = await bridgeContract.connect(wallets[0]).unlockWithdrawHash(hash, preimage);
        await expect(tx).to.emit(bridgeContract, "WithdrawProcessed").withArgs(wallets[0].address, deposit_amount, preimage, hash);
    });

});
