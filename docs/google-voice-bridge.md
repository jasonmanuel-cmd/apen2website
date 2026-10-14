# Google Voice auto-reply (no Twilio)

> Stopgap. For a number you own, use `docs/telnyx-setup.md` instead; both share the same assistant and safety rules (`lib/sms-core.js`).

When someone texts the Google Voice number, the same AI assistant as the website chat answers, collects their
name and a message for the team, and logs everything in HQ.

**Read this first.** Google Voice has no API. This works by a trick: Google Voice emails you each text, and an email
reply to that message is delivered back as a text. It is unofficial, so Google can change it, and it is the
rented-land version of a text line. It is a good stopgap. When texting becomes a real revenue channel, move the number
to a carrier you own (Twilio, Telnyx or Bandwidth); `api/sms.js` is built so only the small bridge script changes.

```
person texts the Google Voice number
  -> Google Voice emails the text to your Gmail
  -> Apps Script (runs every minute in your Google account) reads it
  -> POST https://aspen2homes.com/api/sms        (api/sms.js: the assistant, lead capture, STOP handling)
  -> the answer comes back; the script emails it to Google Voice's reply address
  -> Google Voice sends it as a text
```

## One-time setup

1. **Google Voice:** voice.google.com > Settings > Messages > turn on **Forward messages to email** (use the Gmail you will run the script in).
2. **Supabase:** SQL editor > run `supabase/chat-schema.sql` again (safe to re-run; it adds the `sms_optouts` table).
3. **Vercel:** Settings > Environment Variables > add `SMS_BRIDGE_SECRET` (any long random string, 20+ characters; save it). Redeploy.
   `ANTHROPIC_API_KEY`, `SUPABASE_*` and `RESEND_*` are already set for the website chat.
4. **Apps Script:** script.google.com > New project > paste `scripts/google-voice-bridge.gs`.
   - Project Settings > Script properties > add `BRIDGE_SECRET` = the same value as `SMS_BRIDGE_SECRET`.
   - If your Google Voice number is not (661) 241-0306, change `OUR_NUMBER` at the top of the file.
5. **Check it reads your real emails:** have someone text the number, then run `preview` and open **Execution log**.
   You should see `"ok": true`, the sender's number and the text. If it says `ok: false`, the `why` line tells you what
   did not match (the Google Voice email format is the one thing I could not verify from here). Send me that log, with the
   phone numbers blanked out, and I will adjust the parser.
6. **Turn it on:** run `setup` once (it asks for Gmail and external-request permission). It records the moment it was switched on, so texts that arrived earlier are never answered. Run `status` any time to see whether it is on. Text HOMES from another phone and
   expect an answer in one to two minutes.
7. **Kill switch:** run `teardown`, or remove `SMS_BRIDGE_SECRET` in Vercel (the endpoint then refuses everything).

## What it does and does not do

- It only answers a text someone sent first. It never starts a conversation.
- Every first reply says it is the automated assistant. It answers in one or two short sentences.
- **STOP, UNSUBSCRIBE, CANCEL, END and QUIT** are honoured immediately and remembered; **START** turns it back on; **HELP** gets a fixed answer.
- It stays silent for short codes, non-US numbers, your own number, picture messages, and anything that looks automated, so it cannot get into a loop with another robot.
- One thread per number per month, at most 7 texts from the person, and at most 10 replies an hour to one number. After that it goes quiet and the team follows up.
- When someone leaves a message or a number, you get the same email as from the website chat (`[Callback Request]`, with tap-to-call and tap-to-text), and the conversation is in **HQ > Chats** and **HQ > Callbacks**.
- It cannot read pictures or group texts.

## Limits you should know about

- **Speed:** the script runs once a minute and Google Voice's email takes a moment, so replies arrive in about 1 to 2 minutes.
- **Volume:** a free Gmail account may send about 100 emails a day through Apps Script (Workspace accounts about 1,500). Each reply is one email.
- **Google's rules:** Google's Voice terms restrict automated and bulk messaging. I have not checked the current wording, so read it. This bridge is one-to-one and only answers inbound texts, but Google could still restrict the number. Keep the number you give out on a line you can afford to lose, or move to a carrier you own.
- **Legal:** I am not a lawyer. Replying to a text someone just sent is the lowest-risk kind of automated text, but have a California attorney review the wording and the privacy notice.
- **Per message, not per thread:** several texts from one person land in one Gmail thread; the script answers each new message and remembers which it has handled, so it does not matter whether you open or read the emails.
- **Format risk:** if Google changes its notification emails, the parser stops matching and the bridge goes quiet (it skips, it does not guess). Run `preview` to see why.

## Updating the facts the assistant knows

`lib/chat-knowledge.js` (shared with the website chat). `tests/chat.test.mjs` fails if those facts drift from `src/data/site.ts`.
