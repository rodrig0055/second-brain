"use client";

import { useActionState } from "react";
import { Button } from "@astryxdesign/core/Button";

import { rotateEncryptionKey, type RotationState } from "./actions";

/**
 * Running a key rotation from inside the deployment.
 *
 * The whole reason this is a button and not a script: Vercel lets a secret be
 * written but never read back, so the key being rotated away from cannot be
 * copied to a laptop. It exists here, in the process, and nowhere else a person
 * can reach.
 *
 * Dry run first, deliberately. The count it reports is the thing to check
 * before writing: it should match the number of connected integrations, and
 * anything unreadable means a key is missing rather than a row is broken.
 */
export function RotationPanel() {
  const [state, action, pending] = useActionState<RotationState, FormData>(
    rotateEncryptionKey,
    {},
  );

  return (
    <div className="mt-6 rounded-xl border border-zinc-200 bg-white p-4 shadow-card">
      <h3 className="text-sm font-semibold text-zinc-800">Encryption key</h3>
      <p className="mt-1 text-xs leading-relaxed text-zinc-500">
        Re-encrypts every stored credential with the current write key. Run this
        after setting <code className="font-mono">INTEGRATIONS_ENC_KEY_NEXT</code>{" "}
        and deploying, then set{" "}
        <code className="font-mono">INTEGRATIONS_ENC_KEY</code> to the new value
        and remove <code className="font-mono">INTEGRATIONS_ENC_KEY_NEXT</code>.
      </p>

      <div className="mt-3 flex gap-2">
        <form action={action}>
          <input type="hidden" name="apply" value="false" />
          <Button
            label={pending ? "Checking…" : "Dry run"}
            size="sm"
            type="submit"
            isDisabled={pending}
          />
        </form>
        <form action={action}>
          <input type="hidden" name="apply" value="true" />
          <Button
            label="Re-encrypt now"
            variant="destructive"
            size="sm"
            type="submit"
            isDisabled={pending}
          />
        </form>
      </div>

      {state.error && (
        <p className="mt-3 text-xs text-red-600">{state.error}</p>
      )}

      {state.ok && (
        <div className="mt-3 space-y-1 text-xs text-zinc-600">
          <p>
            Writing with{" "}
            <code className="font-mono">{state.writeKey}</code>, {state.keyCount}{" "}
            key(s) accepted for reading.
          </p>
          <p className="font-medium text-zinc-800">
            {state.rewritten} secret(s){" "}
            {state.applied ? "re-encrypted" : "would be re-encrypted"}
            {state.unreadable ? `, ${state.unreadable} unreadable` : ""}.
          </p>
          {state.lines && state.lines.length > 0 && (
            <ul className="mt-1 space-y-0.5 font-mono text-[11px] text-zinc-500">
              {state.lines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}
          {(state.unreadable ?? 0) > 0 && (
            <p className="text-amber-700">
              An unreadable secret was sealed with a key that is no longer set.
              Add it as{" "}
              <code className="font-mono">INTEGRATIONS_ENC_KEY_PREVIOUS</code>,
              or reconnect that integration above.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
