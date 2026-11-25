// Translation providers. All translating is done by the provider's API; nothing is hard-coded.
import { normLang } from './shared.js';

const GOOGLE_URL = 'https://translate.googleapis.com/translate_a/t';
const DEEPL_URL = {
  free: 'https://api-free.deepl.com/v2/translate',
  pro: 'https://api.deepl.com/v2/translate',
};
// DeepL wants regional variants for a few target languages.
const DEEPL_TARGET = { en: 'EN-US', pt: 'PT-BR', 'zh-CN': 'ZH-HANS', 'zh-TW': 'ZH-HANT', no: 'NB' };

const MAX_TEXTS = 50; // per request
const MAX_CHARS = 5000; // per request

// Sentences split across inline elements arrive marked up as "<x0>…</x0><x1>…</x1>" (already XML-escaped).
const MARKED = /^<x0>/;

/**
 * Translate `texts` into language `to`. `from` is the source language if known ('' = auto-detect).
 * `platform` supplies { fetch, cache }.
 * Resolves to [{ text, from }] in the same order, where `from` is the (detected) source language.
 */
export async function translate(texts, to, from, settings, { fetch, cache }) {
  const deeplKey = settings.provider === 'deepl' ? settings.deeplKey.trim() : '';
  const provider = deeplKey ? 'deepl' : 'google'; // fall back to Google until a DeepL key is set
  const keys = texts.map((text) => `t|${provider}|${from}|${to}|${text}`);
  const results = await cache.getMany(keys);
  const missing = results.flatMap((hit, i) => (hit ? [] : [i]));
  const plain = missing.filter((i) => !MARKED.test(texts[i]));
  const marked = missing.filter((i) => MARKED.test(texts[i]));

  for (const [indices, xml] of [[plain, false], [marked, true]]) {
    for (const group of batches(indices, texts)) {
      const input = group.map((i) => texts[i]);
      const output = deeplKey ? await deepl(fetch, input, to, from, deeplKey, xml) : await google(fetch, input, to, from);
      group.forEach((i, j) => (results[i] = output[j]));
      cache.putMany(group.map((i) => [keys[i], results[i]]));
    }
  }
  return results;
}

/** Split indices into request-sized groups. */
function batches(indices, texts) {
  const groups = [];
  let group = [];
  let chars = 0;
  for (const i of indices) {
    const len = texts[i].length;
    if (group.length && (group.length >= MAX_TEXTS || chars + len > MAX_CHARS)) {
      groups.push(group);
      group = [];
      chars = 0;
    }
    group.push(i);
    chars += len;
  }
  if (group.length) groups.push(group);
  return groups;
}

async function google(fetch, texts, to, from) {
  const body = new URLSearchParams();
  for (const text of texts) body.append('q', text);
  const sl = encodeURIComponent(from || 'auto');
  const res = await fetchWithRetry(fetch, `${GOOGLE_URL}?client=gtx&sl=${sl}&tl=${encodeURIComponent(to)}`, {
    method: 'POST',
    body,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !Array.isArray(data)) {
    throw new Error(
      res.status === 429 || !data
        ? 'Google Translate is limiting requests right now. Wait a minute, or switch to DeepL in Settings.'
        : `Google Translate failed (HTTP ${res.status}).`,
    );
  }
  // With sl=auto each item is [translation, detectedLanguage]; with a fixed sl it's just the translation.
  return texts.map((source, i) => {
    const [text, detected] = Array.isArray(data[i]) ? data[i] : [data[i], from];
    return { text: typeof text === 'string' ? text : source, from: normLang(detected) };
  });
}

async function deepl(fetch, texts, to, from, key, xml) {
  const body = { text: texts, target_lang: DEEPL_TARGET[to] || to.toUpperCase() };
  if (from) body.source_lang = from.startsWith('zh') ? 'ZH' : from === 'no' ? 'NB' : from.toUpperCase();
  if (xml) body.tag_handling = 'xml'; // keep the <xN> markers in place
  const send = () =>
    fetchWithRetry(fetch, key.endsWith(':fx') ? DEEPL_URL.free : DEEPL_URL.pro, {
      method: 'POST',
      headers: { Authorization: `DeepL-Auth-Key ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  let res = await send();
  if (res.status === 400 && body.source_lang) {
    delete body.source_lang; // DeepL may not support the page's language as a source: let it detect
    res = await send();
  }
  if (!res.ok) throw new Error(deeplError(res.status));
  const data = await res.json();
  return data.translations.map((t) => ({ text: t.text, from: normLang(t.detected_source_language) }));
}

function deeplError(status) {
  if (status === 403) return 'DeepL rejected your API key. Check it in Settings.';
  if (status === 456) return 'Your DeepL quota for this month is used up.';
  if (status === 429) return 'DeepL is limiting requests right now. Try again in a moment.';
  if (status === 400) return "DeepL doesn't support this language. Pick another one, or switch to Google in Settings.";
  return `DeepL failed (HTTP ${status}).`;
}

/** One retry for rate limits and server hiccups. */
async function fetchWithRetry(fetch, url, options) {
  const res = await fetch(url, options);
  if (res.status !== 429 && res.status < 500) return res;
  await new Promise((r) => setTimeout(r, 1000));
  return fetch(url, options);
}
