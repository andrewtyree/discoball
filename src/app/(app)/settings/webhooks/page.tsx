import Link from "next/link";
import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { PageHeader } from "@/components/phase-notice";
import { getSessionUser } from "@/lib/auth";
import { can } from "@/lib/rbac";
import {
  createWebhook,
  deleteWebhook,
  redeliverWebhook,
  sendTestEvent,
  toggleWebhook,
} from "@/lib/webhooks/actions";
import { WEBHOOK_EVENTS } from "@/lib/webhooks/dispatch";
import { listDeliveries, listWebhooks } from "@/lib/webhooks/queries";

const ERRORS: Record<string, string> = {
  forbidden: "Your role doesn’t allow changing configuration (Admin or Owner required).",
  invalid: "Please check the values and try again.",
  url: "That webhook URL isn't allowed.",
  no_events: "Pick at least one event to subscribe to.",
  rate_limited: "Too many webhook tests in the last hour — try again later.",
};

function Banner({ error, detail, ok, tested }: { error?: string; detail?: string; ok?: string; tested?: string }) {
  if (error) {
    return (
      <p
        role="alert"
        className="mb-4 rounded-[var(--radius)] border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-600"
      >
        {error === "url" && detail ? `${ERRORS.url} ${detail}` : (ERRORS[error] ?? "Something went wrong.")}
      </p>
    );
  }
  if (ok || tested) {
    return (
      <p
        role="status"
        className="mb-4 rounded-[var(--radius)] border border-green-600/40 bg-green-600/10 px-3 py-2 text-sm text-green-700"
      >
        {tested ? "Delivery attempted — the outcome is in the history below." : "Saved."}
      </p>
    );
  }
  return null;
}

/** Outbound webhooks — signed JSON POSTs on record events. */
export default async function WebhooksSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/sign-in");
  const canConfig = can(user.role, "config:write");

  const sp = await searchParams;
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

  const [hooks, deliveries] = await Promise.all([
    listWebhooks(user.orgId),
    listDeliveries(user.orgId),
  ]);

  return (
    <>
      <div className="mb-6 flex items-center justify-between">
        <PageHeader
          title="Webhooks"
          subtitle="POST signed JSON to your systems when records change."
        />
        <Link href="/settings" className="text-sm underline">
          All settings
        </Link>
      </div>

      <Banner
        error={first(sp.error)}
        detail={first(sp.detail)}
        ok={first(sp.ok)}
        tested={first(sp.tested)}
      />

      <div className="mb-6 grid gap-6 lg:grid-cols-[minmax(0,420px)_1fr]">
        <Card>
          <CardTitle className="text-base">Add a webhook</CardTitle>
          <CardDescription className="mb-4">
            Deliveries carry an <code>X-Discoball-Signature</code> header —
            HMAC-SHA256 of the body with the webhook&rsquo;s secret. Verify it
            before trusting a payload.
          </CardDescription>
          {canConfig ? (
            <form action={createWebhook} className="flex flex-col gap-4">
              <Field label="Payload URL" htmlFor="wh-url">
                <Input
                  id="wh-url"
                  name="url"
                  type="url"
                  required
                  placeholder="https://example.com/hooks/discoball"
                />
              </Field>
              <fieldset className="flex flex-col gap-2">
                <legend className="text-xs font-medium text-[var(--muted-foreground)]">
                  Events
                </legend>
                {WEBHOOK_EVENTS.map((e) => (
                  <label key={e.event} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      name="events"
                      value={e.event}
                      defaultChecked={e.event === "record.created"}
                    />
                    {e.label}
                    <code className="text-xs text-[var(--muted-foreground)]">{e.event}</code>
                  </label>
                ))}
              </fieldset>
              <div>
                <Button type="submit">Add webhook</Button>
              </div>
            </form>
          ) : (
            <CardDescription>
              Your role ({user.role}) can view webhooks but not change them.
            </CardDescription>
          )}
        </Card>

        <Card>
          <CardTitle className="text-base">Configured webhooks</CardTitle>
          {hooks.length === 0 ? (
            <CardDescription>None yet.</CardDescription>
          ) : (
            <ul className="mt-3 flex flex-col gap-4">
              {hooks.map((hook) => (
                <li
                  key={hook.id}
                  className="rounded-[var(--radius)] border border-[var(--border)] p-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-mono text-sm">{hook.url}</p>
                      <p className="text-xs text-[var(--muted-foreground)]">
                        {hook.isActive ? "Active" : "Disabled"} ·{" "}
                        {hook.events.join(", ") || "no events"}
                      </p>
                    </div>
                    {canConfig ? (
                      <div className="flex items-center gap-2">
                        <form action={sendTestEvent}>
                          <input type="hidden" name="id" value={hook.id} />
                          <Button type="submit" variant="outline" className="px-3 py-1.5 text-xs">
                            Send test
                          </Button>
                        </form>
                        <form action={toggleWebhook}>
                          <input type="hidden" name="id" value={hook.id} />
                          <Button type="submit" variant="outline" className="px-3 py-1.5 text-xs">
                            {hook.isActive ? "Disable" : "Enable"}
                          </Button>
                        </form>
                        <form action={deleteWebhook}>
                          <input type="hidden" name="id" value={hook.id} />
                          <Button type="submit" variant="ghost" className="px-3 py-1.5 text-xs text-red-600">
                            Delete
                          </Button>
                        </form>
                      </div>
                    ) : null}
                  </div>
                  {canConfig ? (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-xs text-[var(--muted-foreground)]">
                        Reveal signing secret
                      </summary>
                      <code className="mt-1 block break-all text-xs">{hook.secret}</code>
                    </details>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card>
        <CardTitle className="text-base">Recent deliveries</CardTitle>
        <CardDescription className="mb-3">
          Every attempt is recorded — there are no silent retries. Failed
          deliveries can be re-sent.
        </CardDescription>
        {deliveries.length === 0 ? (
          <CardDescription>No deliveries yet.</CardDescription>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-left text-xs text-[var(--muted-foreground)]">
                  <th className="p-2">Event</th>
                  <th className="p-2">Webhook</th>
                  <th className="p-2">Status</th>
                  <th className="p-2">HTTP</th>
                  <th className="p-2">Attempt</th>
                  <th className="p-2">When</th>
                  <th className="p-2">Detail</th>
                  {canConfig ? <th className="p-2" /> : null}
                </tr>
              </thead>
              <tbody>
                {deliveries.map((d) => (
                  <tr key={d.id} className="border-b border-[var(--border)]/60">
                    <td className="p-2 font-mono text-xs">{d.event}</td>
                    <td className="max-w-56 truncate p-2 font-mono text-xs">{d.url}</td>
                    <td className="p-2 text-xs">
                      <span
                        className={
                          d.status === "SUCCESS"
                            ? "text-green-700"
                            : d.status === "FAILED"
                              ? "text-red-600"
                              : "text-[var(--muted-foreground)]"
                        }
                      >
                        {d.status}
                      </span>
                    </td>
                    <td className="p-2 font-mono text-xs">{d.responseStatus ?? "—"}</td>
                    <td className="p-2 font-mono text-xs">{d.attempt}</td>
                    <td className="p-2 font-mono text-xs">
                      {d.createdAt.toISOString().replace("T", " ").slice(0, 19)}
                    </td>
                    <td className="max-w-64 truncate p-2 text-xs text-[var(--muted-foreground)]">
                      {d.error ?? "—"}
                    </td>
                    {canConfig ? (
                      <td className="p-2">
                        {d.status === "FAILED" ? (
                          <form action={redeliverWebhook}>
                            <input type="hidden" name="deliveryId" value={d.id} />
                            <Button type="submit" variant="outline" className="px-2 py-1 text-xs">
                              Redeliver
                            </Button>
                          </form>
                        ) : null}
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
