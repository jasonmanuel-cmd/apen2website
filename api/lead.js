// Vercel Serverless Function: /api/lead.js
// Receives the website's consultation form and emails it via Resend.
// Same-origin only: no CORS headers, so other websites can't post leads through it.

const esc = (s = '') =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Coerce any input to a trimmed, length-capped string (bots send numbers, arrays, huge payloads).
const str = (v, max = 200) => (v == null ? '' : String(v)).trim().slice(0, max);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

    // 1. Bot trap: if the hidden honeypot field is filled, pretend success.
    if (str(data.honeypot)) {
      return res.status(200).json({ success: true, message: 'Received' });
    }

    // 2. Validate required inputs
    if (!name || !phone) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: name and phone number are required.'
      });
    }

    const leadPayload = { timestamp: new Date().toISOString(), name, phone, email, community, timeline, plan, notes, source };

    console.log('[ASPEN II LEAD CAPTURED]:', JSON.stringify(leadPayload, null, 2));

    // 3. Email the lead via Resend (see .env.example).
    // Until the domain is verified in Resend, RESEND_FROM must stay onboarding@resend.dev,
    // and Resend only delivers to the email address that owns the Resend account.
    const resendKey = process.env.RESEND_API_KEY;
    const destinationEmail = process.env.NOTIFICATION_EMAIL || 'Aspen2homes@gmail.com';
    const from = process.env.RESEND_FROM || 'Aspen II Homes <onboarding@resend.dev>';

    let emailSent = false;

    if (resendKey) {
      try {
        const resendRes = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${resendKey}`
          },
          body: JSON.stringify({
            from,
            to: destinationEmail.split(',').map((s) => s.trim()),
            ...(email && { reply_to: email }),
            subject: `[New Lead] ${name} - ${plan || community || 'General Inquiry'}`,
            html: `
              <h2>New Aspen II Homes Lead</h2>
              <p><strong>Name:</strong> ${esc(name)}</p>
              <p><strong>Phone:</strong> <a href="tel:${esc(phone)}">${esc(phone)}</a></p>
              <p><strong>Email:</strong> ${email ? `<a href="mailto:${esc(email)}">${esc(email)}</a>` : 'Not provided'}</p>
              <p><strong>Interested in:</strong> ${esc(timeline)}</p>
              <p><strong>Model:</strong> ${esc(plan) || 'Not sure yet'}</p>
              <p><strong>Community:</strong> ${esc(community) || 'Not sure yet'}</p>
              <p><strong>Notes:</strong><br>${notes ? esc(notes).replace(/\n/g, '<br>') : 'None'}</p>
              <hr>
              <small>From ${esc(source)} at ${leadPayload.timestamp}. Reply to this email to answer the buyer directly.</small>
            `
          })
        });
        if (resendRes.ok) emailSent = true;
        else console.error('Resend rejected the email:', resendRes.status, await resendRes.text());
      } catch (err) {
        console.error('Resend dispatch error:', err.message);
      }

      // Key is set but sending failed: tell the visitor to call rather than silently losing the lead.
      if (!emailSent) {
        return res.status(502).json({ success: false, error: 'Could not deliver your request. Please call (661) 238-3136.' });
      }
    }

    return res.status(200).json({
      success: true,
      message: 'Consultation request received successfully.',
      emailDispatched: emailSent
    });
  } catch (error) {
    console.error('Lead processing error:', error);
    return res.status(500).json({
      success: false,
      error: 'An error occurred while processing the consultation request.'
    });
  }
}
