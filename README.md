# 🔐 WillVault — On-chain Digital Inheritance on Monad

**Monad Blitz submission.** A tamper-proof vault for wills, deeds, and important documents, with two novel mechanics:

1. **Notarization** — register the keccak256 fingerprint of any document on-chain. Anyone can later prove the file existed, unaltered, submitted by you, at a specific time. Change one byte and the hash no longer matches, so tampering is detectable forever. *Documents can't be secretly altered or forged.*
2. **Dead-man's-switch inheritance** — create a vault, add **encrypted** documents, name heirs, and periodically "check in" (proof of life). If you go silent for longer than your chosen interval, the vault **releases** and your named heirs automatically gain access to the keys you left them. *In case you die, your heirs inherit — no lawyer, no escrow.*

Everything sensitive is **encrypted in the browser** before it touches the chain. The blockchain stores only fingerprints, ciphertext references, and per-heir *wrapped* keys — never plaintext.

---

## How the cryptography works (and why it's safe on a public chain)

All blockchain storage is world-readable, so WillVault never stores anything secret in the clear:

- Each document is encrypted client-side with **AES-256-GCM** using a master key the owner derives from a passphrase (**PBKDF2**, 200k iterations). The passphrase never leaves the browser.
- The master key is **wrapped to each heir's public key** using **ECDH (P-256)** — an ephemeral key agreement so only that heir's private key can unwrap it.
- The dead-man's switch is an **access-control gate on top of cryptography that already protects the data**: `getMyKeyMaterial()` reverts until the vault releases, and the wrapped key is useless to anyone but the intended heir regardless.

This scheme is proven to round-trip correctly by `scripts/crypto-selftest.mjs` (run `npm run cryptotest`).

---

## Project layout

```
contracts/WillVault.sol        The smart contract (notarization + vault + dead-man's switch)
test/WillVault.test.js         15 passing tests
scripts/deploy.js              Deploy to Monad testnet
scripts/crypto-selftest.mjs    Proves the browser encryption scheme is correct
frontend/index.html            Complete dApp (ethers v6, Web Crypto, MetaMask) — single file
hardhat.config.js              Monad testnet config (chainId 10143)
```

---

## Quick start

### 1. Install & test
```bash
npm install
npm test            # 15 passing
npm run cryptotest  # crypto round-trip proof
```

### 2. Deploy to Monad testnet
Get testnet MON from the Monad faucet, then:
```bash
export PRIVATE_KEY=0xyour_test_wallet_private_key   # a throwaway test key
npm run deploy:monad
```
Copy the printed contract address.

**Monad Testnet network**
| | |
|---|---|
| Chain ID | `10143` |
| RPC | `https://testnet-rpc.monad.xyz` |
| Symbol | `MON` |
| Explorer | `https://testnet.monadexplorer.com` |

### 3. Run the frontend
Open `frontend/index.html` in a browser (or serve it — see Replit below), click **Connect Wallet**, click **+ Add Monad Testnet**, paste the deployed contract address into the field at the top, and you're live.

---

## Running on Replit

1. Create a new Replit → import this folder (or drag the files in).
2. In the Shell: `npm install` then `npm test` to confirm everything works.
3. To serve the frontend, add a static server, e.g. in the Shell:
   `npx serve frontend` (or open `frontend/index.html` with Replit's web preview).
4. Deploy the contract from the Shell with `npm run deploy:monad` after setting `PRIVATE_KEY` in Replit **Secrets**.

> The frontend is a single self-contained `index.html` — you can also just paste it into any static host.

---

## Live demo script (for judges)

1. **Notarize tab** → upload a "will" file → *Notarize*. Show the tx on the explorer. Re-upload the same file in *Verify* → ✓ verified. Change one byte → ✗ not on record.
2. **My Vault tab** → create a vault with a **60-second** interval → set a passphrase → add an encrypted document → add an heir (paste their public key from the Heir Panel).
3. **Heir Panel** (second wallet) → generate keypair, save private key. Owner adds that public key as heir.
4. Stop checking in. Watch the countdown hit zero → status flips to **RELEASED**.
5. Heir clicks **Claim**, then **Decrypt my documents** → the original file downloads, decrypted in the browser. 🎉

---

## Security notes / production hardening

- Demo stores small ciphertext directly on-chain; production should push ciphertext to **IPFS/Arweave** and store only the CID.
- Use a real, long check-in interval (weeks/months) in production, with reminder notifications.
- Consider multiple guardians / M-of-N release, and a grace period after the deadline before release.
- Audit before mainnet. This is a hackathon prototype.

Built for **Monad Blitz** — focused on novel mechanics, not polish.
