/** Outcome banners for the settings editors, driven by ?ok / ?error params
 *  (the config actions are plain form actions that redirect back). */

const ERRORS: Record<string, string> = {
  forbidden: "Your role doesn’t allow changing configuration (Admin or Owner required).",
  invalid: "Please check the values and try again.",
  duplicate: "One with that name (or key) already exists.",
  "in-use": "It’s still used by existing records — deactivate it instead of deleting.",
};

export function ConfigBanner({ ok, error }: { ok?: string; error?: string }) {
  if (error) {
    return (
      <p
        role="alert"
        className="mb-4 rounded-[var(--radius)] border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-600"
      >
        {ERRORS[error] ?? "Something went wrong. Please try again."}
      </p>
    );
  }
  if (ok) {
    return (
      <p
        role="status"
        className="mb-4 rounded-[var(--radius)] border border-green-600/40 bg-green-600/10 px-3 py-2 text-sm text-green-700"
      >
        Saved.
      </p>
    );
  }
  return null;
}
