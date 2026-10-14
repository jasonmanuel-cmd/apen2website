/**
 * Aspen II Homes: Google Voice text auto-reply bridge.
 *
 * Runs inside the owner's Google account (script.google.com), NOT on the website. Every minute it:
 *   1. finds new "text message" notification emails from Google Voice,
 *   2. sends the sender's number and message to https://aspen2homes.com/api/sms,
 *   3. emails the answer back to Google Voice's reply address, which Google Voice delivers as a text.
 *
 * Google Voice has no API; this works only because Voice can forward texts to email and turn an email reply
 * into a text. See docs/google-voice-bridge.md for setup, limits and the kill switch.
 *
 * Setup in short: paste this file, add the script property BRIDGE_SECRET (the same value as SMS_BRIDGE_SECRET in
 * Vercel), run preview(), check the log, then run setup(). Run status() any time to see if it is on.
 */
var CONFIG = {
  API_URL: 'https://aspen2homes.com/api/sms',
  OUR_NUMBER: '6612410306',         // the Google Voice number people text, digits only
  LOOKBACK: 'newer_than:1d',        // never look at anything older than a day
  MAX_PER_RUN: 10,                  // at most this many texts per minute
  KEEP_IDS: 150,                    // how many answered message ids to remember
  REQUIRE_DKIM: true                // only trust emails Google actually signed (blocks forged "Google Voice" emails)
};

var SEARCH = 'from:voice-noreply@google.com subject:"text message"';

/* ------------------------------------------------------------------ entry points */

/**
 * Run once. Authorizes the script, remembers the moment it was switched on (older texts are never answered),
 * and creates the 1-minute trigger.
 */
function setup() {
  teardown();
  var props = PropertiesService.getScriptProperties();
  props.setProperty('INSTALLED_AT', String(Date.now()));
  props.setProperty('DONE_IDS', '[]');
  ScriptApp.newTrigger('processTexts').timeBased().everyMinutes(1).create();
  Logger.log('Auto-reply is ON for texts that arrive from now on. Run teardown() to turn it off.');
}

/** Kill switch: removes the trigger. Nothing is answered until you run setup() again. */
function teardown() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'processTexts') ScriptApp.deleteTrigger(t);
  });
  Logger.log('Auto-reply is OFF.');
}

/** Dry run: shows how the 5 most recent Google Voice text emails would be read. Sends nothing, changes nothing. */
function preview() {
  var threads = GmailApp.search(SEARCH, 0, 5);
  if (!threads.length) { Logger.log('No Google Voice text emails found. Is "Forward messages to email" turned on in Google Voice settings?'); return; }
  threads.forEach(function (thread) {
    var msg = lastMessage_(thread);
    var parsed = parseGoogleVoiceEmail_(describe_(msg));
    Logger.log(JSON.stringify(parsed, null, 2));
  });
}

/** Shows whether it is on and what it has done. */
function status() {
  var props = PropertiesService.getScriptProperties();
  var at = Number(props.getProperty('INSTALLED_AT') || 0);
  Logger.log('Trigger on: ' + ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'processTexts'; }));
  Logger.log('Switched on: ' + (at ? new Date(at).toString() : 'never (run setup)'));
  Logger.log('Texts answered or skipped so far (last ' + CONFIG.KEEP_IDS + '): ' + JSON.parse(props.getProperty('DONE_IDS') || '[]').length);
}

/** The 1-minute job. */
function processTexts() {
  var props = PropertiesService.getScriptProperties();
  var installedAt = Number(props.getProperty('INSTALLED_AT') || 0);
  if (!installedAt) return;                                  // setup() has not been run
  var done = JSON.parse(props.getProperty('DONE_IDS') || '[]');

  // Every message of every recent Google Voice thread: several texts from one person share one Gmail thread.
  var items = [];
  GmailApp.search(SEARCH + ' ' + CONFIG.LOOKBACK, 0, 20).forEach(function (thread) {
    thread.getMessages().forEach(function (m) { items.push({ id: m.getId(), dateMs: m.getDate().getTime(), msg: m }); });
  });

  var todo = pickNewMessages_(items, done, installedAt, CONFIG.MAX_PER_RUN);
  for (var i = 0; i < todo.length; i++) {
    var msg = todo[i].msg;
    var parsed = parseGoogleVoiceEmail_(describe_(msg));
    if (!parsed.ok) { Logger.log('Skipped: ' + parsed.why); done.push(todo[i].id); continue; }
    var resp = UrlFetchApp.fetch(CONFIG.API_URL, {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: { 'x-bridge-secret': secret_() },
      payload: JSON.stringify({ from: parsed.from, text: parsed.text })
    });
    var code = resp.getResponseCode();
    if (code === 429 || code >= 500) break;                  // not answered: leave it, the next run tries again
    done.push(todo[i].id);
    if (code !== 200) { Logger.log('API said ' + code + '; skipped.'); continue; }
    var data = JSON.parse(resp.getContentText());
    if (data.reply) GmailApp.sendEmail(parsed.replyTo, 'Re: text message', data.reply);
  }
  props.setProperty('DONE_IDS', JSON.stringify(done.slice(-CONFIG.KEEP_IDS)));
}

/* ------------------------------------------------------------------ helpers */

function secret_() {
  var s = PropertiesService.getScriptProperties().getProperty('BRIDGE_SECRET');
  if (!s) throw new Error('Add BRIDGE_SECRET under Project Settings > Script properties.');
  return s;
}
function lastMessage_(thread) { var m = thread.getMessages(); return m[m.length - 1]; }
function describe_(msg) {
  return { from: msg.getFrom(), replyTo: msg.getReplyTo(), subject: msg.getSubject(), body: msg.getPlainBody(), raw: CONFIG.REQUIRE_DKIM ? msg.getRawContent() : '' };
}

/**
 * Pure function, so it can be tested. Which messages still need an answer: not older than the moment the bot was
 * switched on, not already handled, oldest first, at most `max`. Works per message (not per Gmail thread), because
 * a second text from the same person arrives in the same thread as the first.
 */
function pickNewMessages_(items, doneIds, installedAtMs, max) {
  var seen = {};
  doneIds.forEach(function (id) { seen[id] = true; });
  return items
    .filter(function (it) { return it.dateMs >= installedAtMs && !seen[it.id]; })
    .sort(function (a, b) { return a.dateMs - b.dateMs; })
    .slice(0, max);
}

/**
 * Pure function (no Gmail calls), so it can be tested. Input: { from, replyTo, subject, body, raw }.
 * Output: { ok: true, from, text, replyTo } or { ok: false, why }.
 */
function parseGoogleVoiceEmail_(m) {
  // The address must be exactly Google's, not merely start with it (voice-noreply@google.com.evil.io).
  if (!/(^|<|\s)voice-noreply@google\.com(>|\s|$)/i.test(m.from || '')) return { ok: false, why: 'not from Google Voice' };
  if (!/text message/i.test(m.subject || '')) return { ok: false, why: 'not a text message email' };
  if (/\b(picture|photo|image|video|attachment)\b/i.test(m.subject || '')) return { ok: false, why: 'picture or media message' };
  if (CONFIG.REQUIRE_DKIM && !/dkim=pass[^;\n]*header\.[id]=@?google\.com(?![\w.-])/i.test(m.raw || '')) return { ok: false, why: 'email is not signed by Google (dkim)' };

  // Where an email reply must go for Google Voice to deliver it as a text. Anything else could be a forged email.
  var rt = /([^<>\s,;]+@txt\.voice\.google\.com)(?=$|[>\s,;])/i.exec(m.replyTo || '');
  if (!rt) return { ok: false, why: 'no Google Voice reply address' };
  var replyTo = rt[1];

  // The sender's number is one of the long digit groups in the reply address (the other is our own number).
  var ours = digits_(CONFIG.OUR_NUMBER);
  var groups = (replyTo.split('@')[0].match(/\d{10,15}/g) || []).map(digits_);
  var from = '';
  for (var i = 0; i < groups.length; i++) if (groups[i] !== ours) { from = groups[i]; break; }
  if (!from) { var sub = /(\+?1?[\s.-]?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})/.exec(m.subject || ''); if (sub) from = digits_(sub[1]); }
  if (!from) return { ok: false, why: 'could not find the sender number' };
  if (from === ours) return { ok: false, why: 'sender is our own number' };

  // The message: everything before Google's footer. Some versions begin with "Name: " (the contact name in the subject).
  var text = String(m.body || '').split(/\n\s*To respond to this text message/i)[0];
  var nameInSubject = /text message from\s+(.+?)\s*$/i.exec(m.subject || '');
  if (nameInSubject) {
    var name = nameInSubject[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    text = text.replace(new RegExp('^\\s*' + name + '\\s*:\\s*', 'i'), '');
  }
  text = text.replace(/\s+/g, ' ').trim().slice(0, 600);
  if (!text) return { ok: false, why: 'no message text found' };
  return { ok: true, from: from, text: text, replyTo: replyTo };
}

function digits_(s) {
  var d = String(s || '').replace(/\D/g, '');
  return d.length === 11 && d.charAt(0) === '1' ? d.slice(1) : d;
}
