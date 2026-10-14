# Text auto-reply on a number you own (Telnyx)

Someone texts the number, the same AI assistant as the website chat answers in a few seconds, asks for their name,
takes a message for the team, and logs everything in HQ (Chats and Callbacks) and your inbox. No Google, no Gmail script.

```
person texts your Telnyx number
  -> Telnyx POSTs a webhook to https://aspen2homes.com/api/telnyx?k=<secret>     (api/telnyx.js)
  -> we answer 200 straight away (Telnyx needs it within 2 seconds)
  -> in the background: the assistant writes the reply (lib/sms-core.js, lib/chat-core.js)
  -> we send it back through Telnyx's API
```

Sending texts in the US needs carrier registration whoever you use. Plan on about 7 to 10 business days
for approval (sources vary). Do the registration first; everything else can be set up while you wait.

## 1. Account, number, registration (you)

1. Create a Telnyx account and buy a **661** local number with SMS enabled.
2. **Register the business that is sending.** That should be the legal entity customers deal with
   (Aspen II Homes, Inc., CSLB #1004058, with its own EIN), not Chaotically Organized AI. Confirm with the owner.
3. In the Telnyx portal, register a **brand** and a **campaign** under Messaging (the 10DLC section; menu names change, see
   Telnyx's 10DLC guide: https://support.telnyx.com/en/articles/5634625-10dlc-fees-and-charges). A draft for the campaign form is at the bottom of this file.
4. Create a **messaging profile**, attach the number to it, and attach the approved campaign to the number.

## 2. Keys and settings (you)

- Telnyx portal > API Keys: create a **v2 API key**.
- Telnyx portal > Account Settings > Keys & Credentials: copy the **public key** (used to check that webhooks really come from Telnyx).
- Make up a long random string (20+ characters) for `TELNYX_WEBHOOK_SECRET`.
- In the messaging profile, set the **inbound webhook URL** to
  `https://aspen2homes.com/api/telnyx?k=YOUR_TELNYX_WEBHOOK_SECRET` (the same random string). Leave the API version on v2.
- Vercel > Settings > Environment Variables, then redeploy:

| Name | Value |
|---|---|
| `TELNYX_API_KEY` | the v2 API key |
| `TELNYX_PUBLIC_KEY` | the public key from Keys & Credentials |
| `TELNYX_WEBHOOK_SECRET` | the random string, same as in the webhook URL |

`ANTHROPIC_API_KEY`, `SUPABASE_*`, `RESEND_*` are already set for the website chat.

- Supabase SQL editor: run `supabase/chat-schema.sql` again (safe; it adds `sms_seen`, so a retried webhook is not answered twice).

## 3. Test (you, then me)

1. From another phone, text **HOMES** to the new number. Expect an answer in a few seconds starting "Aspen II Homes automated assistant here."
2. Reply with a name and "please have someone call me back". Check your inbox for `[Callback Request]` and HQ > Callbacks.
3. Text **STOP**: you should get one confirmation and then silence. Text **START** to turn it back on.
4. If nothing arrives: Vercel > project > Logs, filter for `Telnyx`. Telnyx's portal also shows webhook delivery attempts for the message.

Until the campaign is approved, carriers may block or heavily filter messages; that is expected, not a bug.

## 4. Put the new number on the site (me)

Tell me the number. The site's "Text HOMES to ..." links and the assistant's facts use `src/data/site.ts` and
`lib/chat-knowledge.js`; I will change both and the tests will check they agree. Decide whether calls keep going to the
current number or also move to the new one (Telnyx can forward calls to a cell phone).

## What it does and does not do

- Only answers a text someone sent first. Never starts a conversation. First reply says it is an automated assistant. Replies are short.
- **STOP, UNSUBSCRIBE, CANCEL, END, QUIT** are honoured and remembered; **START** reverses it; **HELP** gets a fixed answer. Telnyx also handles
  opt-out keywords at the carrier level, so a person may see Telnyx's own confirmation as well.
- Silent for short codes, non-US numbers, your own number, picture-only texts, and anything that looks automated (no robot loops).
- One thread per number per month, at most 7 texts from the person, at most 10 replies an hour to one number, then it goes quiet and the team follows up.
- Security: the secret in the URL is required, and Telnyx's signature is checked when `TELNYX_PUBLIC_KEY` is set. If the platform has
  already parsed the request body, the signature cannot be checked; the URL secret still applies and a warning is logged.
- Cost (third-party figures, confirm on Telnyx's pricing page): roughly 0.4 cents plus carrier fees per outbound text, and a small monthly campaign fee.

## Draft answers for the campaign form (review before submitting; not legal advice)

- **Use case:** customer care / low-volume mixed (answering inbound questions and scheduling tours).
- **Description:** Aspen II Homes, Inc. is a licensed California home builder in Tehachapi. Prospective buyers text our number to ask about homes,
  floor plans and tours. An automated assistant replies to those inbound texts, collects a name and callback request, and our staff follow up.
  We only reply to people who text us first.
- **How people opt in:** They text our number first (the website invites them to "Text HOMES to [number]"). Our privacy policy at
  https://aspen2homes.com/privacy/ describes text messaging. No one is added to a marketing list.
- **Opt-out / help:** Replying STOP ends all texts immediately; HELP returns our company name, license number, phone number and hours.
- **Sample messages:**
  1. "Aspen II Homes automated assistant here. Happy to help. Are you looking for a tour, floor plans or financing info?"
  2. "Got it, the team will call you back. You can also call (661) 241-0306, 7am-7pm daily. Reply STOP to stop texts."
  3. "Aspen II Homes (CSLB #1004058), new homes in Tehachapi. Call (661) 241-0306, 7am-7pm daily. Reply STOP to stop texts."
