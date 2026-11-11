import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";

// AES-256-GCM encryption for integration credentials stored at rest in the DB.
// Key comes from INTEGRATIONS_ENC_KEY (base64-encoded 32 bytes). Generate with:
//   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
// Format of the stored blob: `v1:` + base64(iv(12) || authTag(16) || ciphertext).
//
// ROTATION. This key is not a bearer token that can simply be replaced: it
// encrypts data at rest, so the moment it changes, every credential already in
// the database becomes unreadable. Changing the variable alone does not rotate
// anything, it orphans everything.
//
// Three variables, because on Vercel a secret can be written but never read
// back. That rules out the obvious ceremony of "copy the old value into a
// second variable", so the old value instead stays exactly where it is and the
// NEW key arrives alongside it:
//
//   INTEGRATIONS_ENC_KEY_NEXT      optional. The key being rotated TO. While it
//                                  is set, everything is written with it.
//   INTEGRATIONS_ENC_KEY           the standing key. Writes when NEXT is absent,
//                                  and is always accepted for reading.
//   INTEGRATIONS_ENC_KEY_PREVIOUS  optional, accepted for reading only.
//
// So a rotation never requires anyone to read the value being replaced:
//
//   1. set INTEGRATIONS_ENC_KEY_NEXT to the new key and deploy. The app now
//      writes with the new key and still reads everything written with the old.
//   2. re-encrypt every stored secret (Admin → Integrations, or
//      `npm run rotate:enc-key -- --apply`). Everything is now under the new key.
//   3. set INTEGRATIONS_ENC_KEY to the new key, which is a write and needs no
//      read, remove INTEGRATIONS_ENC_KEY_NEXT, and deploy.
//
// Skip step 1 and there is a window in which the running app holds a key that
// fits nothing in the database, and every integration fails at once.
//
// AES-GCM authenticates, so the wrong key fails loudly rather than returning
// plausible nonsense. That is what lets the rotation tell "already rotated"
// from "cannot be read at all".

const PREFIX = "v1:";

function parseKey(raw: string | undefined, name: string): Buffer | null {
  if (!raw) return null;
  const key = Buffer.from(raw.trim(), "base64");
  if (key.length !== 32) {
    throw new Error(`${name} must decode to 32 bytes (base64-encoded).`);
  }
  return key;
}

/** The key everything is written with: the incoming one if a rotation is on. */
function getKey(): Buffer {
  const next = parseKey(
    process.env.INTEGRATIONS_ENC_KEY_NEXT,
    "INTEGRATIONS_ENC_KEY_NEXT",
  );
  if (next) return next;
  const key = parseKey(process.env.INTEGRATIONS_ENC_KEY, "INTEGRATIONS_ENC_KEY");
  if (!key) {
    throw new Error("INTEGRATIONS_ENC_KEY is not set — cannot encrypt/decrypt credentials.");
  }
  return key;
}

/** Every key a stored blob might have been written with, write key first. */
function decryptionKeys(): Buffer[] {
  const keys: Buffer[] = [getKey()];
  const add = (raw: string | undefined, name: string) => {
    const key = parseKey(raw, name);
    // A duplicate is not an error, just useless: skip it rather than pay for a
    // second identical authentication failure on every miss.
    if (key && !keys.some((held) => held.equals(key))) keys.push(key);
  };
  add(process.env.INTEGRATIONS_ENC_KEY, "INTEGRATIONS_ENC_KEY");
  add(process.env.INTEGRATIONS_ENC_KEY_PREVIOUS, "INTEGRATIONS_ENC_KEY_PREVIOUS");
  return keys;
}

/** How many distinct keys can open a stored secret right now. */
export function decryptionKeyCount(): number {
  return decryptionKeys().length;
}

/** Whether a key other than the write key is accepted for reading. */
export function previousKeyConfigured(): boolean {
  return decryptionKeys().length > 1;
}

/** Whether a rotation is in flight, i.e. writes use INTEGRATIONS_ENC_KEY_NEXT. */
export function rotationInFlight(): boolean {
  return Boolean(
    parseKey(process.env.INTEGRATIONS_ENC_KEY_NEXT, "INTEGRATIONS_ENC_KEY_NEXT"),
  );
}

export function encryptSecret(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, ciphertext]).toString("base64");
}

export function decryptSecret(blob: string): string {
  if (!blob.startsWith(PREFIX)) {
    throw new Error("Unrecognized credential format.");
  }
  const buf = Buffer.from(blob.slice(PREFIX.length), "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ciphertext = buf.subarray(28);

  // Current key first, previous only as a fallback, so a rotation in flight
  // costs one failed authentication per stale row and nothing else. The error
  // never carries the blob: it would be a ciphertext in a log.
  for (const key of decryptionKeys()) {
    try {
      const decipher = createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
      ]).toString("utf8");
    } catch {
      // Authentication failed: wrong key. Try the next one.
    }
  }
  throw new Error(
    `Could not decrypt this credential with any of the ${decryptionKeyCount()} ` +
      "configured key(s). It was written with a key that is no longer set, so " +
      "the integration has to be reconnected.",
  );
}

/** True when a 32-byte key is configured (so the UI can warn before connecting). */
export function encryptionConfigured(): boolean {
  try {
    getKey();
    return true;
  } catch {
    return false;
  }
}
