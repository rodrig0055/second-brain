import { signIn } from "@/auth";
import { BrainCircuit, LockKeyhole } from "lucide-react";
import { Button } from "@astryxdesign/core/Button";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-50 px-4 py-10">
      <div className="animate-enter w-full max-w-sm">
        <div className="mb-8 text-center">
          <span className="mx-auto flex size-11 items-center justify-center rounded-xl bg-zinc-900 text-zinc-50 shadow-card">
            <BrainCircuit className="size-5" />
          </span>
          <h1 className="mt-4 text-2xl font-semibold tracking-tight text-zinc-900">Second Brain</h1>
          <p className="mt-1 text-sm text-zinc-500">The operating workspace for our brands.</p>
        </div>

        <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-elevated sm:p-7">
          {error && (
            <div role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
              {error === "AccessDenied"
                ? "This Google account isn't on the allowlist. Ask an admin to add you."
                : "Sign-in failed. Please try again."}
            </div>
          )}

          <form
            action={async () => {
              "use server";
              await signIn("google", { redirectTo: "/" });
            }}
          >
            <Button type="submit" label="Continue with Google" variant="primary" size="lg" width="100%" />
          </form>

          <p className="mt-5 flex items-center justify-center gap-1.5 text-xs text-zinc-500">
            <LockKeyhole className="size-3.5" />
            Invited team members only
          </p>
        </div>
      </div>
    </main>
  );
}
