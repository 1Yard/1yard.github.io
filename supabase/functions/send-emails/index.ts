// 1Yard: sends queued emails from the email_outbox table through Resend.
// The database pokes this function whenever an email is queued (and every 5
// minutes for retries). It only ever sends what's already in the outbox, so
// calling it extra times is harmless.
//
// Secrets (Supabase → Edge Functions → Secrets):
//   RESEND_API_KEY   from resend.com → API Keys
//   EMAIL_FROM       e.g.  1Yard <hello@1yard.ca>
//   EMAIL_REPLY_TO   e.g.  1yardqueens@gmail.com
// SUPABASE_DB_URL is provided by Supabase automatically.
import postgres from "npm:postgres@3.4.5";

const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false, max: 1 });
const KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const FROM = Deno.env.get("EMAIL_FROM") ?? "1Yard <hello@1yard.ca>";
const REPLY_TO = Deno.env.get("EMAIL_REPLY_TO") ?? "1yardqueens@gmail.com";

const b64 = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

Deno.serve(async () => {
  if (!KEY) return Response.json({ error: "RESEND_API_KEY is not set" }, { status: 500 });
  const rows = await sql`select * from public.claim_emails(20)`;
  let sent = 0, failed = 0;
  for (const r of rows) {
    try {
      const body: Record<string, unknown> = { from: FROM, to: [r.to_email], reply_to: REPLY_TO, subject: r.subject, html: r.html, text: r.text_body };
      if (r.ics) body.attachments = [{ filename: "1yard-job.ics", content: b64(r.ics) }];
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        // Same key twice = Resend sends it once, even if we retry after a crash.
        headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json", "Idempotency-Key": String(r.dedupe_key).slice(0, 256) },
        body: JSON.stringify(body),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`${res.status} ${out.message ?? out.name ?? ""}`.trim());
      await sql`select public.mark_email(${r.id}, true, null, ${out.id ?? null})`;
      sent++;
    } catch (e) {
      await sql`select public.mark_email(${r.id}, false, ${String((e as Error).message ?? e)}, null)`;
      failed++;
    }
    await sleep(600); // stay under Resend's 2 requests/second limit
  }
  return Response.json({ sent, failed });
});
