const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("WillVault", function () {
  let vault, owner, heir, stranger;

  beforeEach(async function () {
    [owner, heir, stranger] = await ethers.getSigners();
    const WillVault = await ethers.getContractFactory("WillVault");
    vault = await WillVault.deploy();
    await vault.waitForDeployment();
  });

  const docHash = ethers.keccak256(ethers.toUtf8Bytes("Last Will and Testament of Alice"));

  describe("Notarization", function () {
    it("records a document hash with author and timestamp", async function () {
      await expect(vault.notarize(docHash, "My Will", "will"))
        .to.emit(vault, "DocumentNotarized");
      const [exists, author, ts, title, category] = await vault.verify(docHash);
      expect(exists).to.equal(true);
      expect(author).to.equal(owner.address);
      expect(title).to.equal("My Will");
      expect(category).to.equal("will");
      expect(ts).to.be.gt(0);
    });

    it("rejects a duplicate hash", async function () {
      await vault.notarize(docHash, "My Will", "will");
      await expect(vault.notarize(docHash, "x", "y")).to.be.revertedWith("already notarized");
    });

    it("rejects the empty hash", async function () {
      await expect(vault.notarize(ethers.ZeroHash, "x", "y")).to.be.revertedWith("empty hash");
    });

    it("returns exists=false for an unknown hash", async function () {
      const [exists] = await vault.verify(ethers.keccak256(ethers.toUtf8Bytes("nope")));
      expect(exists).to.equal(false);
    });
  });

  describe("Vault & dead-man's switch", function () {
    it("creates a vault and reports info", async function () {
      await expect(vault.createVault(3600)).to.emit(vault, "VaultCreated");
      const info = await vault.getVaultInfo(owner.address);
      expect(info.exists).to.equal(true);
      expect(info.checkInInterval).to.equal(3600n);
      expect(info.released).to.equal(false);
    });

    it("is not released while owner checks in", async function () {
      await vault.createVault(1000);
      await time.increase(500);
      expect(await vault.isReleased(owner.address)).to.equal(false);
      await vault.checkIn();
      await time.increase(500);
      expect(await vault.isReleased(owner.address)).to.equal(false); // timer reset
    });

    it("releases after silence beyond the interval", async function () {
      await vault.createVault(1000);
      await time.increase(1001);
      expect(await vault.isReleased(owner.address)).to.equal(true);
    });

    it("supports manual release", async function () {
      await vault.createVault(100000);
      await vault.releaseNow();
      expect(await vault.isReleased(owner.address)).to.equal(true);
    });

    it("adds a document and auto-notarizes it", async function () {
      await vault.createVault(1000);
      await vault.addDocument(docHash, "Will", "will", "ipfs://cid123");
      const docs = await vault.getDocuments(owner.address);
      expect(docs.length).to.equal(1);
      expect(docs[0].encryptedURI).to.equal("ipfs://cid123");
      const [exists, author] = await vault.verify(docHash);
      expect(exists).to.equal(true);
      expect(author).to.equal(owner.address);
    });
  });

  describe("Heirs & claiming", function () {
    beforeEach(async function () {
      await vault.createVault(1000);
      await vault.addDocument(docHash, "Will", "will", "ipfs://cid123");
      await vault.addHeir(heir.address, "wrapped-key-blob", "ephemeral-pub");
    });

    it("lists the heir", async function () {
      const list = await vault.getHeirs(owner.address);
      expect(list).to.deep.equal([heir.address]);
      expect(await vault.isHeir(owner.address, heir.address)).to.equal(true);
    });

    it("blocks key retrieval before release", async function () {
      await expect(
        vault.connect(heir).getMyKeyMaterial(owner.address)
      ).to.be.revertedWith("not released yet");
    });

    it("blocks a stranger even after release", async function () {
      await time.increase(1001);
      await expect(
        vault.connect(stranger).getMyKeyMaterial(owner.address)
      ).to.be.revertedWith("not an heir");
    });

    it("lets the heir retrieve key material and claim after release", async function () {
      await time.increase(1001);
      const [wrapped, ephem] = await vault.connect(heir).getMyKeyMaterial(owner.address);
      expect(wrapped).to.equal("wrapped-key-blob");
      expect(ephem).to.equal("ephemeral-pub");
      await expect(vault.connect(heir).claim(owner.address))
        .to.emit(vault, "VaultClaimed")
        .withArgs(owner.address, heir.address, anyUint);
    });

    it("cannot claim before release", async function () {
      await expect(vault.connect(heir).claim(owner.address)).to.be.revertedWith("not released yet");
    });

    it("can remove an heir before release", async function () {
      await vault.removeHeir(heir.address);
      expect(await vault.isHeir(owner.address, heir.address)).to.equal(false);
      expect(await vault.getHeirs(owner.address)).to.deep.equal([]);
    });
  });
});

// small helper matcher for the timestamp arg
const anyUint = require("@nomicfoundation/hardhat-chai-matchers/withArgs").anyUint;
