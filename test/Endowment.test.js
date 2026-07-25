const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("WillVault economics", function () {
  let vault, owner, heir;
  beforeEach(async function () {
    [owner, heir] = await ethers.getSigners();
    const F = await ethers.getContractFactory("WillVault");
    vault = await F.deploy(); await vault.waitForDeployment();
    await vault.createVault(1000);
  });
  it("awards $LEGACY for engagement and grows supply/participants", async function () {
    expect(await vault.legacyBalance(owner.address)).to.equal(100n); // create vault
    await vault.checkIn(); // +10
    expect(await vault.legacyBalance(owner.address)).to.equal(110n);
    const eco = await vault.ecosystem();
    expect(eco[1]).to.equal(110n);      // legacyMinted
    expect(eco[2]).to.equal(1n);        // participants
  });
  it("accepts a deposit, tracks TVL, and projects yield", async function () {
    await vault.deposit({ value: ethers.parseEther("1") });
    expect(await vault.endowment(owner.address)).to.equal(ethers.parseEther("1"));
    expect(await vault.totalValueLocked()).to.equal(ethers.parseEther("1"));
    await time.increase(365 * 24 * 3600); // 1 year
    const e = await vault.getEndowment(owner.address);
    // ~8% APR projection
    expect(e.projectedValue).to.be.gt(ethers.parseEther("1.07"));
    expect(e.projectedValue).to.be.lt(ethers.parseEther("1.09"));
  });
  it("owner can withdraw before release", async function () {
    await vault.deposit({ value: ethers.parseEther("1") });
    await vault.withdrawEndowment();
    expect(await vault.endowment(owner.address)).to.equal(0n);
    expect(await vault.totalValueLocked()).to.equal(0n);
  });
  it("pays the endowment to the first heir who claims after release", async function () {
    await vault.deposit({ value: ethers.parseEther("2") });
    await vault.addHeir(heir.address, "wrapped", "ephem");
    await time.increase(1001); // release
    const before = await ethers.provider.getBalance(heir.address);
    const tx = await vault.connect(heir).claim(owner.address);
    const rc = await tx.wait();
    const gas = rc.gasUsed * rc.gasPrice;
    const after = await ethers.provider.getBalance(heir.address);
    expect(after + gas - before).to.equal(ethers.parseEther("2"));
    expect(await vault.endowment(owner.address)).to.equal(0n);
  });
  it("cannot withdraw after release", async function () {
    await vault.deposit({ value: ethers.parseEther("1") });
    await time.increase(1001);
    await expect(vault.withdrawEndowment()).to.be.revertedWith("released");
  });
});
