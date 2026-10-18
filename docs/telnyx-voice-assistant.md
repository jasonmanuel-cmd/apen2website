# Phone assistant messages -> the CRM

The office phone line ((661) 776-8635) is answered by a Telnyx AI Assistant that takes messages. By itself, Telnyx keeps those
messages inside Telnyx. This connects them: when the assistant has a caller's details, it calls a small tool that posts to
`https://aspen2homes.com/api/voice`, and the website

- saves the caller in **HQ > Leads** (source "Phone call"; an existing lead with the same number is reused),
- saves the message in **HQ > Callbacks** (the list of messages left for the team),
- emails the staff list in `NOTIFICATION_EMAIL`, subject `[Phone Message] Name - (661) ...`, with tap-to-call and tap-to-text links.

Only Telnyx's tool can call the endpoint: it must send the secret in a header. A message with no valid callback number or no
message text is **not saved**; the endpoint answers with what is missing and the assistant asks the caller for it.

## 1. Set the secret in Vercel

Settings > Environment Variables: add `VOICE_WEBHOOK_SECRET` with 20 or more random characters (for example
`openssl rand -base64 24 | tr -d '/+='`). Redeploy. Until it is set the endpoint answers 503 and saves nothing.

## 2. Add the tool in Telnyx

AI Assistants > your assistant > Tools > add a **Webhook** tool. Menu names change; match fields by meaning.

| Field | Value |
|---|---|
| Name | `save_message` |
| Description | Save a message from the caller for the Aspen II Homes team. Call it once you have the caller's first and last name, a callback phone number and what they want the team to know. Ask for an email address too. |
| URL | `https://aspen2homes.com/api/voice` |
| Method | `POST` |
| Header | name `x-voice-secret`, value = the same secret you put in Vercel |
| Timeout | 10 seconds is plenty |

Body parameters (JSON schema):

```json
{
  "type": "object",
  "properties": {
    "name": { "type": "string", "description": "The caller's first and last name" },
    "callback_number": { "type": "string", "description": "Phone number to call back, with area code" },
    "email": { "type": "string", "description": "The caller's email address, if they give one" },
    "message": { "type": "string", "description": "What the caller wants the team to know or answer, in plain words" },
    "best_time": { "type": "string", "description": "When they prefer a call back, if they said" },
    "caller_number": { "type": "string", "description": "The number the caller is calling from. Use {{telnyx_end_user_target}}" }
  },
  "required": ["name", "message"]
}
```

## 3. Tell the assistant when to use it

Add to the assistant's instructions (adjust the wording to its voice):

> When someone wants to leave a message, ask for their first and last name, the best phone number to call back (confirm it
> back to them), their email address, and their message, one at a time. If they decline to give an email, that is fine.
> Then call `save_message`. If the tool answers that something is missing, ask for it and call it again. After it saves,
> tell the caller the team will call them back. Never promise a time. Anything urgent: tell them to call 911.

## 4. Test it without a phone call

```bash
curl -s -X POST https://aspen2homes.com/api/voice \
  -H 'content-type: application/json' -H 'x-voice-secret: <your secret>' \
  -d '{"name":"Test Caller","callback_number":"661-555-0199","message":"Test message, please ignore"}'
```

Expect `{"ok":true,"message":"Saved. ..."}`, a row in HQ > Callbacks and Leads, and an email. **Delete the test lead and
callback in HQ afterwards.** Telnyx's own "test tool" button in the assistant editor does the same thing.

## Notes

- The website chat and text assistant are separate from this phone assistant. The phone assistant's call recordings and
  transcripts stay in Telnyx; only the messages it saves arrive here.
- Calls that end without the assistant calling `save_message` leave nothing in the CRM. Check the Telnyx call history for
  those, or ask for a post-call summary hook as a follow-up.
