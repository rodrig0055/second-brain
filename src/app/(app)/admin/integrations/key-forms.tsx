"use client";

import { useActionState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { saveCustomModel, saveLlmKey, type FormState } from "./actions";

const INITIAL: FormState = {};

const inputCls =
  "rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-500/20";

function Feedback({ state, okText }: { state: FormState; okText: string }) {
  if (state.error) {
    return (
      <p className="mt-2 rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs leading-relaxed text-red-600">
        {state.error}
      </p>
    );
  }
  if (state.ok) {
    return (
      <p className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs text-emerald-700">
        {okText}
      </p>
    );
  }
  return null;
}

/** Save/replace a provider API key. Errors render inline instead of crashing. */
export function LlmKeyForm({
  provider,
  placeholder,
  hasDbKey,
  encReady,
}: {
  provider: string;
  placeholder: string;
  hasDbKey: boolean;
  encReady: boolean;
}) {
  const [state, action, pending] = useActionState(saveLlmKey, INITIAL);
  return (
    <div className="flex-1">
      <form action={action} className="flex items-end gap-2">
        <input type="hidden" name="provider" value={provider} />
        <label className="flex flex-1 flex-col gap-1 text-xs text-zinc-500">
          API key
          <input
            name="apiKey"
            type="password"
            required
            placeholder={placeholder}
            className={inputCls}
          />
        </label>
        <Button
          label={pending ? "Saving…" : hasDbKey ? "Replace" : "Save"}
          variant="primary"
          type="submit"
          isDisabled={!encReady || pending}
        />
      </form>
      <Feedback state={state} okText="Key saved." />
    </div>
  );
}

/** Add an OpenAI-compatible custom model. Errors render inline. */
export function CustomModelForm({ encReady }: { encReady: boolean }) {
  const [state, action, pending] = useActionState(saveCustomModel, INITIAL);
  return (
    <form
      action={action}
      className="mt-3 space-y-3 rounded-xl border border-zinc-200 bg-white p-4 shadow-card"
    >
      <label className="flex flex-col gap-1 text-xs text-zinc-500">
        Display name
        <input name="label" required placeholder="OpenRouter, Llama 3.3 70B" className={inputCls} />
      </label>
      <label className="flex flex-col gap-1 text-xs text-zinc-500">
        Base URL
        <input name="baseUrl" required type="url" placeholder="https://openrouter.ai/api/v1" className={inputCls} />
      </label>
      <label className="flex flex-col gap-1 text-xs text-zinc-500">
        Model name
        <input name="modelName" required placeholder="meta-llama/llama-3.3-70b-instruct" className={inputCls} />
      </label>
      <label className="flex flex-col gap-1 text-xs text-zinc-500">
        API key
        <input name="apiKey" required type="password" placeholder="sk-…" className={inputCls} />
      </label>
      <Button
        label={pending ? "Saving…" : "Save custom model"}
        variant="primary"
        type="submit"
        isDisabled={!encReady || pending}
      />
      <Feedback state={state} okText="Custom model added." />
    </form>
  );
}
