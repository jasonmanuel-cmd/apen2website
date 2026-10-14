# Telnyx brand and campaign registration: what to type

Telnyx's menu names change, so match fields by meaning. In the portal this is under Messaging > 10DLC (brand first, then campaign).
Carrier reviewers compare four things and reject when they disagree: the **legal name and EIN**, the **website**, the **campaign description**,
and the **sample messages**. Keep the same company name everywhere.

Before you start, have: the IRS letter with the EIN (CP 575 or 147C), the exact legal name as it appears on it, and the owner's name, email and phone.
Publish first: the page https://aspen2homes.com/sms-terms/ must be live (merge the pull request that adds it) before you submit.

## Part 1. Brand (the company)

| Field | What to enter |
|---|---|
| Entity type | Private company (for-profit) |
| Legal company name | **Aspen II Homes, Inc.** (copy it exactly as printed on the IRS letter) |
| DBA / brand name | Aspen II Homes |
| Tax ID / EIN | from the IRS letter. Must match the legal name or vetting fails |
| Country / state | United States / California |
| Industry (vertical) | Real Estate (Construction also fits; pick one and keep it) |
| Website | https://aspen2homes.com |
| Street address | 785 Tucker Road G295, Tehachapi, CA 93561 (should match the address the IRS has; if the IRS address differs, use that one or fix it first) |
| Contact name, title | the owner or officer who can answer carrier emails |
| Contact email | an address at your own domain is best (for example name@aspen2homes.com). A Gmail address often draws extra questions |
| Contact phone | a number that answers |
| Stock symbol / exchange | leave empty (private company) |

## Part 2. Campaign (the texting program)

| Field | What to enter |
|---|---|
| Brand | Aspen II Homes |
| Use case | **Low Volume Mixed** (cheapest; fits a small business answering inbound texts). If not offered, Customer Care |
| Expected volume | under 500 messages a month |
| Subscriber opt-in | Yes |
| Subscriber opt-out | Yes |
| Subscriber help | Yes |
| Embedded links in messages | **No** (the assistant is told not to send links) |
| Embedded phone numbers | **Yes** (our office number appears in some replies) |
| Age-gated content | No |
| Direct lending or loan arrangement | **No** (we are a home builder; we do not offer or arrange loans, and texts do not quote loan terms) |
| Affiliate marketing | No |
| Number pool | No |
| Privacy policy URL | https://aspen2homes.com/privacy/ |
| Terms and conditions URL | https://aspen2homes.com/sms-terms/ |

**Campaign description** (paste):

> Aspen II Homes, Inc. is a licensed California home builder in Tehachapi, CA (CSLB #1004058). Prospective buyers text our business number to ask about our new homes, floor plans, financing programs and tours. An automated assistant replies to those inbound texts, answers common questions, takes the person's name and a callback request or tour request, and our staff follow up. We only send texts in reply to a message the person sent us first. We do not send marketing or promotional texts, and we do not text anyone who has not texted us.

**How people opt in / call to action** (paste):

> The person starts the conversation by texting our number first, for example the keyword HOMES or any question. Our website (https://aspen2homes.com) invites visitors to "Text HOMES to [our number]" and describes the program at https://aspen2homes.com/sms-terms/ and in our privacy notice at https://aspen2homes.com/privacy/. We reply only to people who have texted us. Nobody is added to a list or sent promotional messages. Message and data rates may apply. Replying STOP ends the conversation and HELP returns our contact details.

**Keywords**

| Type | Keywords |
|---|---|
| Opt-in | HOMES, HOME, START |
| Opt-out | STOP, UNSUBSCRIBE, CANCEL, END, QUIT |
| Help | HELP, INFO |

**Messages the system sends for those keywords** (paste):

- Opt-in / first reply: `Aspen II Homes automated assistant here. Happy to help. Are you looking for a tour, floor plans or financing info? Msg&data rates may apply. Reply STOP to stop, HELP for help.`
- Opt-out: `You're unsubscribed and will get no more texts from this number. Call (661) 241-0306 any time.`
- Help: `Aspen II Homes (CSLB #1004058), new homes in Tehachapi. Call (661) 241-0306, 7am-7pm daily. Reply STOP to stop texts.`

The live first reply of every text thread ends with that "Msg&data rates may apply. Reply STOP to stop." sentence automatically.

**Sample messages** (use 3 to 5; each must match the description):

1. `Aspen II Homes automated assistant here. Happy to help. Are you looking for a tour, floor plans or financing info?`
2. `Sunset Retreat in Tehachapi starts at $459,000: 3 bed, 2 bath, 1,715 sq ft. Want me to take your name so our team can set up a tour?`
3. `Thanks, Pat. I passed your message to our team and they will call you back. You can also call (661) 241-0306, 7am-7pm daily.`
4. `Aspen II Homes (CSLB #1004058), new homes in Tehachapi. Call (661) 241-0306, 7am-7pm daily. Reply STOP to stop texts.`
5. `You're unsubscribed and will get no more texts from this number. Call (661) 241-0306 any time.`

## Common reasons for rejection (and how this answer avoids them)

- Missing or vague opt-in description: ours states the person texts first and nothing is sent otherwise.
- No privacy policy or terms with texting language: both pages exist and say it.
- Website does not match the brand: the site names the company, license and address.
- Sample messages that read like marketing: these are replies to questions.
- Mentioning loans or lending: the answers say we do not offer or arrange loans. Keep staff from texting loan offers on this number.

## Rules after approval

- Use this number only to answer people who texted it. Do not use it to text people who only filled in a form; that is outside what you registered.
- If the program changes (for example you want to send reminders), update the campaign first.
