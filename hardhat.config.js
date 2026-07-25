require("@nomicfoundation/hardhat-toolbox");

// Load PRIVATE_KEY from .env if present (npm i dotenv, or just export it in your shell).
try { require("dotenv").config(); } catch (_) {}

const PRIVATE_KEY = process.env.PRIVATE_KEY || "";

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 },
    },
  },
  networks: {
    // Monad Testnet — Chain ID 10143
    monadTestnet: {
      url: "https://testnet-rpc.monad.xyz",
      chainId: 10143,
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
    },
  },
};
