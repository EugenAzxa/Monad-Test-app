// Proves the exact crypto scheme used in frontend/index.html round-trips correctly.
// Uses the SAME Web Crypto API available in browsers (globalThis.crypto.subtle).
const subtle = globalThis.crypto.subtle;

const b64 = (buf) => Buffer.from(new Uint8Array(buf)).toString("base64");
const unb64 = (s) => new Uint8Array(Buffer.from(s, "base64"));

// --- Owner: derive a reproducible master AES key from a passphrase ---
async function deriveMasterKey(passphrase, saltB64) {
  const salt = unb64(saltB64);
  const baseKey = await subtle.importKey("raw", new TextEncoder().encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 200000, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );
}

// --- Encrypt / decrypt a document with the master key ---
async function encryptDoc(masterKey, bytes) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await subtle.encrypt({ name: "AES-GCM", iv }, masterKey, bytes);
  return `aesgcm:${b64(iv)}:${b64(ct)}`;
}
async function decryptDoc(masterKey, uri) {
  const [, ivB64, ctB64] = uri.split(":");
  const pt = await subtle.decrypt({ name: "AES-GCM", iv: unb64(ivB64) }, masterKey, unb64(ctB64));
  return new Uint8Array(pt);
}

// --- Heir keypair (ECDH P-256) ---
async function genHeirKeypair() {
  const kp = await subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveKey", "deriveBits"]);
  const pub = b64(await subtle.exportKey("raw", kp.publicKey));   // heir shares this
  const priv = b64(await subtle.exportKey("pkcs8", kp.privateKey)); // heir keeps this
  return { pub, priv };
}

// --- Owner wraps master key to an heir's public key via ephemeral ECDH ---
async function wrapMasterForHeir(masterKey, heirPubB64) {
  const heirPub = await subtle.importKey("raw", unb64(heirPubB64), { name: "ECDH", namedCurve: "P-256" }, false, []);
  const eph = await subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveKey"]);
  const wrapKey = await subtle.deriveKey(
    { name: "ECDH", public: heirPub }, eph.privateKey,
    { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]
  );
  const rawMaster = await subtle.exportKey("raw", masterKey);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await subtle.encrypt({ name: "AES-GCM", iv }, wrapKey, rawMaster);
  const ephPub = b64(await subtle.exportKey("raw", eph.publicKey));
  return { wrappedKey: `${b64(iv)}:${b64(ct)}`, ephemeralPubKey: ephPub };
}

// --- Heir unwraps master key ---
async function unwrapMaster(heirPrivB64, ephemeralPubB64, wrappedKey) {
  const heirPriv = await subtle.importKey("pkcs8", unb64(heirPrivB64), { name: "ECDH", namedCurve: "P-256" }, false, ["deriveKey"]);
  const ephPub = await subtle.importKey("raw", unb64(ephemeralPubB64), { name: "ECDH", namedCurve: "P-256" }, false, []);
  const wrapKey = await subtle.deriveKey(
    { name: "ECDH", public: ephPub }, heirPriv,
    { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]
  );
  const [ivB64, ctB64] = wrappedKey.split(":");
  const rawMaster = await subtle.decrypt({ name: "AES-GCM", iv: unb64(ivB64) }, wrapKey, unb64(ctB64));
  return subtle.importKey("raw", rawMaster, { name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
}

async function main() {
  const salt = b64(crypto.getRandomValues(new Uint8Array(16)));
  const masterKey = await deriveMasterKey("correct horse battery staple", salt);

  const original = new TextEncoder().encode("LAST WILL: I leave everything to my dog. Signed, Alice.");
  const uri = await encryptDoc(masterKey, original);

  // Heir onboarding
  const heir = await genHeirKeypair();
  const { wrappedKey, ephemeralPubKey } = await wrapMasterForHeir(masterKey, heir.pub);

  // ...time passes, owner "dies", vault releases...
  const recoveredMaster = await unwrapMaster(heir.priv, ephemeralPubKey, wrappedKey);
  const decrypted = await decryptDoc(recoveredMaster, uri);
  const text = new TextDecoder().decode(decrypted);

  const ok = text === new TextDecoder().decode(original);
  console.log("Decrypted by heir:", JSON.stringify(text));
  console.log(ok ? "\n✅ CRYPTO SELF-TEST PASSED — heir recovered the document." : "\n❌ FAILED");

  // Negative test: wrong passphrase must NOT decrypt
  let failedAsExpected = false;
  try {
    const wrongMaster = await deriveMasterKey("wrong passphrase", salt);
    await decryptDoc(wrongMaster, uri);
  } catch (_) { failedAsExpected = true; }
  console.log(failedAsExpected ? "✅ Wrong passphrase correctly rejected." : "❌ Wrong passphrase leaked data!");

  if (!ok || !failedAsExpected) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
