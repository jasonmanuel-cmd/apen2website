// Vercel Serverless Function: /api/lead.js
// Receives the website's consultation form and emails it via Resend.
// Same-origin only: no CORS headers, so other websites can't post leads through it.

const esc = (s = '') =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Coerce any input to a trimmed, length-capped string (bots send numbers, arrays, huge payloads).
const str = (v, max = 200) => (v == null ? '' : String(v)).trim().slice(0, max);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const CALL = 'Please call (661) 238-3136.';

// A plain HTML form post (JavaScript off or blocked) gets a page back instead of raw JSON.
const isFormPost = (req) => /application\/x-www-form-urlencoded|multipart\/form-data/i.test(req.headers?.['content-type'] || '');

const reply = (req, res, code, body) => {
  if (!isFormPost(req)) return res.status(code).json(body);
  if (body.success) {
    res.setHeader('Location', '/thank-you/');
    return res.status(303).end();
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.status(code).end(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Request not sent | Aspen II Homes</title>` +
    `<body style="font:18px/1.6 Georgia,serif;max-width:36rem;margin:15vh auto;padding:0 20px;color:#15302A;background:#F7F2E8">` +
    `<h1>Your request didn't go through.</h1><p>${esc(body.error)}</p>` +
    `<p><a href="tel:+16612383136">Call (661) 238-3136</a> or <a href="/contact-us/">go back to the form</a>.</p></body>`
  );
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  let data;
  try {
    data = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch {
    return res.status(400).json({ success: false, error: 'Invalid request.' });
  }
  data = data && typeof data === 'object' ? data : {};

  try {
    const name = str(data.name, 100);
    const phone = str(data.phone, 40);
    const rawEmail = str(data.email, 150);
    const email = EMAIL.test(rawEmail) ? rawEmail : '';
    const community = str(data.community, 100);
    const timeline = str(data.timeline, 150);
    const plan = str(data.plan, 100);
    const notes = str(data.notes, 3000);
    const source = str(data.source, 100) || 'Website';
    const contactPref = str(data.contactPref, 20);
    const stage = str(data.stage, 60);
    const when = str(data.when, 40);
    const budget = str(data.budget, 40);
    const firstTime = str(data.firstTime, 5) === 'yes';
    const military = str(data.military, 5) === 'yes';
    // Short routing tags for the subject line, so the team can sort leads at a glance.
    const tags = [
      /reserve/i.test(timeline) && 'Sunset Retreat',
      /model/i.test(timeline) && 'Model pricing',
      /fully custom/i.test(timeline) && 'Custom',
      (/own lot/i.test(timeline) || /own lot/i.test(stage)) && 'Own lot',
      (/financ/i.test(timeline) || firstTime) && 'Financing',
      (/military|heroes/i.test(timeline) || military) && 'Military/VA',
    ].filter(Boolean);

    // 1. Bot trap: if the hidden honeypot field is filled, pretend success.
    if (str(data.honeypot)) {
      return reply(req, res, 200, { success: true, message: 'Received' });
    }

    // 2. Validate required inputs
    if (!name || !phone) {
      return reply(req, res, 400, {
        success: false,
        error: 'Missing required fields: name and phone number are required.'
      });
    }

    const leadPayload = { timestamp: new Date().toISOString(), name, phone, email, community, timeline, plan, notes, source };

    // Log only non-identifying fields; names, phones, emails and notes stay out of hosting logs.
    console.log('[ASPEN II LEAD]', JSON.stringify({ timestamp: leadPayload.timestamp, source, plan, community }));

    // 3. Email the lead via Resend (see .env.example).
    // Until the domain is verified in Resend, RESEND_FROM must stay onboarding@resend.dev,
    // and Resend only delivers to the email address that owns the Resend account.
    const resendKey = process.env.RESEND_API_KEY;
    const destinationEmail = process.env.NOTIFICATION_EMAIL || 'Aspen2homes@gmail.com';
    const from = process.env.RESEND_FROM || 'Aspen II Homes <onboarding@resend.dev>';

    let emailSent = false;

    if (resendKey) {
      const message = {
        from,
        ...(email && { reply_to: email }),
        subject: `[New Lead]${tags.map((t) => `[${t}]`).join('')} ${name} - ${plan || community || 'General Inquiry'}`,
        html: `
          <h2>New Aspen II Homes Lead</h2>
          <p><strong>Name:</strong> ${esc(name)}</p>
          <p><strong>Phone:</strong> <a href="tel:${esc(phone)}">${esc(phone)}</a></p>
          <p><strong>Email:</strong> ${email ? `<a href="mailto:${esc(email)}">${esc(email)}</a>` : 'Not provided'}</p>
          <p><strong>Interested in:</strong> ${esc(timeline)}</p>
          <p><strong>Model:</strong> ${esc(plan) || 'Not sure yet'}</p>
          <p><strong>Community:</strong> ${esc(community) || 'Not sure yet'}</p>
          <p><strong>Best way to reach:</strong> ${esc(contactPref) || 'Any'}</p>
          <p><strong>Stage:</strong> ${esc(stage) || 'Not given'} · <strong>Timeline:</strong> ${esc(when) || 'Not given'} · <strong>Budget:</strong> ${esc(budget) || 'Not given'}</p>
          <p><strong>Ask about:</strong> ${[firstTime && 'First-time buyer options', military && 'VA / military options'].filter(Boolean).join(', ') || 'Nothing extra'}</p>
          <p><strong>Notes:</strong><br>${notes ? esc(notes).replace(/\n/g, '<br>') : 'None'}</p>
          <hr>
          <small>From ${esc(source)} at ${leadPayload.timestamp}. Reply to this email to answer the buyer directly.</small>
        `
      };
      // One email per recipient, so one rejected address (e.g. Resend's test sender only
      // reaches the account owner) can't block delivery to the others.
      const recipients = destinationEmail.split(',').map((s) => s.trim()).filter(Boolean);
      const results = await Promise.all(recipients.map(async (to) => {
        try {
          const resendRes = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resendKey}` },
            body: JSON.stringify({ ...message, to: [to] })
          });
          if (!resendRes.ok) console.error('Resend rejected the email:', resendRes.status, await resendRes.text());
          return resendRes.ok;
        } catch (err) {
          console.error('Resend dispatch error:', err.message);
          return false;
        }
      }));
      emailSent = results.some(Boolean);

      // Key is set but sending failed: tell the visitor to call rather than silently losing the lead.
      if (!emailSent) {
        return reply(req, res, 502, { success: false, error: `Could not deliver your request. ${CALL}` });
      }
    } else {
      // No RESEND_API_KEY: nothing can be delivered, so don't tell the visitor it was.
      console.error('RESEND_API_KEY is not set; lead not delivered.');
      return reply(req, res, 503, { success: false, error: `Our form is temporarily unavailable. ${CALL}` });
    }

    return reply(req, res, 200, {
      success: true,
      message: 'Consultation request received successfully.',
      emailDispatched: emailSent
    });
  } catch (error) {
    console.error('Lead processing error:', error);
    return reply(req, res, 500, { success: false, error: `Something went wrong. ${CALL}` });
  }
}
