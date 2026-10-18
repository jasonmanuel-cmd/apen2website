// The assistant's brain: one conversation turn against the Anthropic Messages API, with four tools.
// Shared by the web chat (api/chat.js) and, later, texting. Tool arguments are model output, so every
// handler validates them server-side; the model can only write to its own conversation's lead and appointments.
const API = 'https://api.anthropic.com/v1/messages';
const MAX_STEPS = 4;      // model calls per visitor message (tool round trips included)
const MAX_TOKENS = 500;   // a chat reply is short; this also caps cost per message
const CALL_TIMEOUT_MS = 20000;

export const TOOLS = [
  {
    name: 'save_contact',
    description: 'Save the visitor as a lead. Call only once you have their full name, a phone number with area code, and an email address, all provided by the visitor in this chat.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Full name: first AND last name' },
        phone: { type: 'string', description: 'Phone number including area code' },
        email: { type: 'string', description: 'Email address' },
        interest: { type: 'string', description: 'One short line: what they want (plan, tour, financing, timeline)' },
        notes: { type: 'string', description: 'Anything else useful for the team, in plain words' }
      },
      required: ['name', 'phone', 'email']
    }
  },
  {
    name: 'request_appointment',
    description: 'Request a tour or phone call. Requires save_contact to have succeeded. This is a request the team confirms, not a booking.',
    input_schema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['tour', 'call'] },
        date: { type: 'string', description: 'Preferred date, YYYY-MM-DD, Tehachapi local time' },
        time: { type: 'string', description: 'Preferred start time, 24-hour HH:MM, Tehachapi local time' },
        notes: { type: 'string', description: 'Optional: which plan or topic' }
      },
      required: ['kind', 'date', 'time']
    }
  },
  {
    name: 'request_callback',
    description: 'Leave a message for the team to call the visitor back. Use when the visitor wants a person, asks something you cannot answer, or the chat is ending. Needs the visitor\'s first AND last name and a phone number with area code, given in this chat. Ask for their email too; only if they decline, pass email_declined true.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Full name: first AND last name' },
        phone: { type: 'string', description: 'Phone number including area code' },
        email: { type: 'string', description: 'Email address' },
        email_declined: { type: 'boolean', description: 'True only if the visitor was asked for an email and said no' },
        message: { type: 'string', description: 'What they want the team to know or answer, in plain words' },
        best_time: { type: 'string', description: 'When they prefer a call, if they said' }
      },
      required: ['name', 'phone', 'message']
    }
  },
  {
    name: 'handoff',
    description: 'Flag this conversation for a human to follow up. Use for questions you cannot answer from the facts, complaints, existing buyers, deposits and contracts, or when the visitor asks for a person.',
    input_schema: {
      type: 'object',
      properties: { reason: { type: 'string', description: 'One short sentence for the team' } },
      required: ['reason']
    }
  }
];

// The API needs strictly alternating roles starting with the user. Stored history can have gaps
// (a failed turn leaves two user messages in a row), so merge neighbours of the same role.
export function normalizeHistory(rows) {
  const out = [];
  for (const { role, content } of rows) {
    if (role !== 'user' && role !== 'assistant') continue;
    const last = out[out.length - 1];
    if (last && last.role === role) last.content += `\n${content}`;
    else out.push({ role, content });
  }
  while (out.length && out[0].role !== 'user') out.shift();
  return out;
}

const textOf = (blocks) => blocks.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();

/**
 * history: stored rows ending with the visitor's new message.
 * handlers: { save_contact, request_callback, request_appointment, handoff } (each takes the tool input) -> plain object result.
 * Returns the assistant's final text. Throws on API failure; the caller decides what the visitor sees.
 */
export async function runTurn({ system, history, handlers, maxTokens }) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw Object.assign(new Error('no key'), { code: 'NO_KEY' });
  const model = process.env.CHAT_MODEL || 'claude-haiku-5-5';
  const messages = normalizeHistory(history);

  for (let step = 0; step < MAX_STEPS; step++) {
    const res = await fetch(API, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      // `system` is { stable, dynamic }: the long, unchanging part is cached by the API, the per-request state is not.
      body: JSON.stringify({
        model, max_tokens: maxTokens || MAX_TOKENS, tools: TOOLS, messages,
        system: typeof system === 'string' ? system : [
          { type: 'text', text: system.stable, cache_control: { type: 'ephemeral' } },
          { type: 'text', text: system.dynamic }
        ]
      }),
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS)
    });
    if (!res.ok) throw Object.assign(new Error('model request failed'), { code: `HTTP_${res.status}` });
    const data = await res.json();
    const content = Array.isArray(data.content) ? data.content : [];

    const calls = content.filter((b) => b.type === 'tool_use');
    if (data.stop_reason !== 'tool_use' || !calls.length) return textOf(content);

    messages.push({ role: 'assistant', content });
    const results = [];
    for (const call of calls) {
      let result;
      try {
        const fn = handlers[call.name];
        result = fn ? await fn(call.input && typeof call.input === 'object' ? call.input : {}) : { error: 'Unknown tool.' };
      } catch (err) {
        console.error('Chat tool failed:', call.name, String(err?.code || err?.name || 'error'));
        result = { error: 'That did not work. Ask the visitor to call the office.' };
      }
      results.push({ type: 'tool_result', tool_use_id: call.id, content: JSON.stringify(result) });
    }
    messages.push({ role: 'user', content: results });
  }
  // Ran out of steps without a plain-text answer.
  return '';
}
