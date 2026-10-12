// Staff email through Resend, shared by the chat endpoints. Same environment variables as api/lead.js.
// One email per recipient, so one rejected address can't block the others. Never throws: a notification
// failure must not break a conversation. Returns true when at least one email was accepted.
export const esc = (s = '') =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export async function notifyStaff({ subject, html, replyTo }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) { console.error('RESEND_API_KEY is not set; staff not emailed.'); return false; }
  const from = process.env.RESEND_FROM || 'Aspen II Homes <onboarding@resend.dev>';
  const to = (process.env.NOTIFICATION_EMAIL || 'Aspen2homes@gmail.com').split(',').map((s) => s.trim()).filter(Boolean);
  const results = await Promise.all(to.map(async (addr) => {
    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({ from, to: [addr], subject, html, ...(replyTo && { reply_to: replyTo }) }),
        signal: AbortSignal.timeout(5000)
      });
      if (!r.ok) console.error('Resend rejected the email:', r.status);
      return r.ok;
    } catch (err) {
      console.error('Resend dispatch error:', String(err?.name || 'error'));
      return false;
    }
  }));
  return results.some(Boolean);
}
