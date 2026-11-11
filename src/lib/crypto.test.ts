import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";

import {
  decryptSecret,
  encryptSecret,
  encryptionConfigured,
  previousKeyConfigured,
} from "./crypto";

const KEY_A = randomBytes(32).toString("base64");
const KEY_B = randomBytes(32).toString("base64");

/** Run `fn` with a given key pair, then put the environment back. */
function withKeys<T>(
  current: string | undefined,
  previous: string | undefined,
  fn: () => T,
): T {
  const before = {
    cur: process.env.INTEGRATIONS_ENC_KEY,
    prev: process.env.INTEGRATIONS_ENC_KEY_PREVIOUS,
  };
  if (current === undefined) delete process.env.INTEGRATIONS_ENC_KEY;
  else process.env.INTEGRATIONS_ENC_KEY = current;
  if (previous === undefined) delete process.env.INTEGRATIONS_ENC_KEY_PREVIOUS;
  else process.env.INTEGRATIONS_ENC_KEY_PREVIOUS = previous;
  try {
    return fn();
  } finally {
    if (before.cur === undefined) delete process.env.INTEGRATIONS_ENC_KEY;
    else process.env.INTEGRATIONS_ENC_KEY = before.cur;
    if (before.prev === undefined) delete process.env.INTEGRATIONS_ENC_KEY_PREVIOUS;
    else process.env.INTEGRATIONS_ENC_KEY_PREVIOUS = before.prev;
  }
}

test("a secret round-trips under one key", () => {
  withKeys(KEY_A, undefined, () => {
    const blob = encryptSecret("EAAsystemusertoken");
    assert.ok(blob.startsWith("v1:"));
    assert.ok(!blob.includes("EAAsystemusertoken"));
    assert.equal(decryptSecret(blob), "EAAsystemusertoken");
  });
});

test("the new key alone cannot read what the old key wrote", () => {
  // The whole reason rotation is not a variable swap. Without this failing,
  // nobody would believe the rest of the ceremony is necessary.
  const sealed = withKeys(KEY_A, undefined, () => encryptSecret("old-secret"));
  withKeys(KEY_B, undefined, () => {
    assert.throws(() => decryptSecret(sealed), /reconnected/);
  });
});

test("during a rotation both keys read, and the new one writes", () => {
  const sealedWithOld = withKeys(KEY_A, undefined, () => encryptSecret("old-secret"));

  withKeys(KEY_B, KEY_A, () => {
    // Step 1 of the ceremony: old blobs still readable.
    assert.equal(decryptSecret(sealedWithOld), "old-secret");
    assert.equal(previousKeyConfigured(), true);

    // Anything written now uses the new key only.
    const fresh = encryptSecret("new-secret");
    withKeys(KEY_B, undefined, () => {
      assert.equal(decryptSecret(fresh), "new-secret");
    });
    withKeys(KEY_A, undefined, () => {
      assert.throws(() => decryptSecret(fresh));
    });
  });
});

test("after re-encrypting, the previous key can be dropped", () => {
  // Step 3: what the rotation script leaves behind must survive the old key
  // going away, or the rotation was not finished.
  const sealedWithOld = withKeys(KEY_A, undefined, () => encryptSecret("secret"));
  const rotated = withKeys(KEY_B, KEY_A, () =>
    encryptSecret(decryptSecret(sealedWithOld)),
  );
  withKeys(KEY_B, undefined, () => {
    assert.equal(decryptSecret(rotated), "secret");
  });
});

test("a previous key identical to the current one is harmless", () => {
  withKeys(KEY_A, KEY_A, () => {
    assert.equal(previousKeyConfigured(), false);
    assert.equal(decryptSecret(encryptSecret("x")), "x");
  });
});

test("a key of the wrong length is rejected rather than padded", () => {
  withKeys(Buffer.from("too short").toString("base64"), undefined, () => {
    assert.throws(() => encryptSecret("x"), /32 bytes/);
  });
  withKeys(KEY_A, Buffer.from("short").toString("base64"), () => {
    assert.throws(() => decryptSecret(encryptSecret("x")), /32 bytes/);
  });
});

test("a missing key is reported as missing, not as a bad credential", () => {
  withKeys(undefined, undefined, () => {
    assert.equal(encryptionConfigured(), false);
    assert.throws(() => encryptSecret("x"), /is not set/);
  });
  withKeys(KEY_A, undefined, () => {
    assert.equal(encryptionConfigured(), true);
  });
});

test("a failure message never carries the ciphertext", () => {
  const sealed = withKeys(KEY_A, undefined, () => encryptSecret("secret"));
  withKeys(KEY_B, undefined, () => {
    try {
      decryptSecret(sealed);
      assert.fail("should have thrown");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      assert.ok(!message.includes(sealed.slice(3, 20)));
    }
  });
});

test("a blob in an unknown format is refused before any key is tried", () => {
  withKeys(KEY_A, undefined, () => {
    assert.throws(() => decryptSecret("plaintext"), /Unrecognized/);
  });
});

test("a rotation writes with the incoming key without reading the old one", async () => {
  // The constraint that shapes the whole ceremony: on Vercel the standing key
  // can be written but never read back, so it must stay where it is while the
  // new key arrives beside it.
  const { rotationInFlight, decryptionKeyCount } = await import("./crypto");

  const sealedWithOld = withKeys(KEY_A, undefined, () => encryptSecret("secret"));

  // Step 1: NEXT is set, the standing key is untouched.
  const before = process.env.INTEGRATIONS_ENC_KEY_NEXT;
  try {
    process.env.INTEGRATIONS_ENC_KEY_NEXT = KEY_B;
    withKeys(KEY_A, undefined, () => {
      assert.equal(rotationInFlight(), true);
      assert.equal(decryptionKeyCount(), 2);
      // Old blobs still open.
      assert.equal(decryptSecret(sealedWithOld), "secret");
      // Step 2: anything rewritten now is written with the incoming key.
      const rotated = encryptSecret(decryptSecret(sealedWithOld));
      // Step 3: the standing key becomes the new one and NEXT goes away.
      delete process.env.INTEGRATIONS_ENC_KEY_NEXT;
      withKeys(KEY_B, undefined, () => {
        assert.equal(rotationInFlight(), false);
        assert.equal(decryptSecret(rotated), "secret");
      });
      process.env.INTEGRATIONS_ENC_KEY_NEXT = KEY_B;
    });
  } finally {
    if (before === undefined) delete process.env.INTEGRATIONS_ENC_KEY_NEXT;
    else process.env.INTEGRATIONS_ENC_KEY_NEXT = before;
  }
});

test("without the incoming key, the standing key still writes", async () => {
  const { rotationInFlight } = await import("./crypto");
  withKeys(KEY_A, undefined, () => {
    assert.equal(rotationInFlight(), false);
    const blob = encryptSecret("x");
    withKeys(KEY_A, undefined, () => assert.equal(decryptSecret(blob), "x"));
  });
});
