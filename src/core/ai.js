// The AI services that can write grammar tips. Each one takes a system prompt, a user prompt
// and a JSON schema, and returns the model's JSON text. Each can also list its models.
// `fetch` is always passed in, because a page's own fetch can't reach these services.
import { AI_PROVIDERS } from './shared.js';

const TIMEOUT_MS = 60_000;

/** Ask `provider` for JSON matching `schema`. Resolves to the raw JSON text. */
export function generate(provider, { apiKey, model, system, prompt, schema, fetch }) {
  const call = { gemini, groq, openrouter, openai, claude }[provider];
  if (!call) throw new Error(`Unknown AI service: ${provider}`);
  return call({ apiKey, model, system, prompt, schema, fetch, label: AI_PROVIDERS[provider].label });
}

/** The models `provider` offers, as [{ id, free }], newest/most useful first where the API says. */
export async function listModels(provider, apiKey, fetch) {
  switch (provider) {
    case 'gemini': {
      const data = await getJson(fetch, 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000', { 'x-goog-api-key': apiKey }, 'Google Gemini');
      return (data.models || [])
        .filter((m) => /^models\/gemini/.test(m.name) && !/embedding|image|tts|audio|live/.test(m.name))
        .filter((m) => !m.supportedGenerationMethods || m.supportedGenerationMethods.includes('generateContent'))
        .map((m) => ({ id: m.name.replace(/^models\//, ''), free: false }));
    }
    case 'groq': {
      const data = await getJson(fetch, 'https://api.groq.com/openai/v1/models', { Authorization: `Bearer ${apiKey}` }, 'Groq');
      return (data.data || [])
        .filter((m) => !/whisper|tts|guard|orpheus|playai|distil/.test(m.id))
        .map((m) => ({ id: m.id, free: false }));
    }
    case 'openrouter': {
      // Public list. Only models that support JSON output, free ones first.
      const data = await getJson(fetch, 'https://openrouter.ai/api/v1/models', {}, 'OpenRouter');
      return (data.data || [])
        .filter((m) => (m.supported_parameters || []).includes('response_format'))
        .map((m) => ({
          id: m.id,
          free: m.id.endsWith(':free'),
          structured: (m.supported_parameters || []).includes('structured_outputs'),
        }))
        .sort((a, b) => b.free - a.free || b.structured - a.structured);
    }
    case 'openai': {
      const data = await getJson(fetch, 'https://api.openai.com/v1/models', { Authorization: `Bearer ${apiKey}` }, 'OpenAI');
      return (data.data || [])
        .filter((m) => /^(gpt|o\d)/.test(m.id) && !/audio|realtime|tts|transcribe|image|search|embedding|instruct/.test(m.id))
        .map((m) => ({ id: m.id, free: false }));
    }
    case 'claude': {
      const data = await getJson(fetch, 'https://api.anthropic.com/v1/models?limit=100', claudeHeaders(apiKey), 'Anthropic Claude');
      return (data.data || []).map((m) => ({ id: m.id, free: false }));
    }
    default:
      throw new Error(`Unknown AI service: ${provider}`);
  }
}

/** Default model when none is picked: first suggestion, or OpenRouter's first free model with JSON output. */
export async function defaultModel(provider, fetch) {
  const suggested = AI_PROVIDERS[provider]?.models?.[0];
  if (suggested) return suggested;
  const models = await listModels(provider, '', fetch);
  const pick = models.find((m) => m.free && m.structured) || models.find((m) => m.free);
  if (!pick) throw new Error('OpenRouter has no free models with JSON output right now. Pick a model in Settings.');
  return pick.id;
}

// ---------------------------------------------------------------------------
// Google Gemini (Interactions API)
// ---------------------------------------------------------------------------

async function gemini({ apiKey, model, system, prompt, schema, label, fetch }) {
  const body = {
    model,
    system_instruction: system,
    input: prompt,
    response_format: { type: 'text', mime_type: 'application/json', schema },
    store: false, // don't keep the conversation on Google's side
  };
  const headers = { 'x-goog-api-key': apiKey };
  let { res, data } = await post(fetch, 'https://generativelanguage.googleapis.com/v1beta/interactions', headers, body, label);
  // A per-minute limit says how long to wait; wait once if it's short, rather than failing.
  const wait = res.status === 429 ? geminiRetryDelay(data) : 0;
  if (wait && wait <= 12) {
    await new Promise((r) => setTimeout(r, wait * 1000));
    ({ res, data } = await post(fetch, 'https://generativelanguage.googleapis.com/v1beta/interactions', headers, body, label));
  }
  if (!res.ok) throw geminiError(res.status, data, model);
  if (['incomplete', 'budget_exceeded', 'requires_continuation'].includes(data?.status)) throw cutShort();
  if (data?.status === 'failed') throw new Error(`${label} couldn't answer this one. Try a different sentence.`);
  // The answer is the text in the model's output after the last user input.
  const steps = Array.isArray(data?.steps) ? data.steps : [];
  const parts = [];
  for (let i = steps.length - 1; i >= 0 && steps[i].type !== 'user_input'; i--) {
    if (steps[i].type !== 'model_output') continue;
    parts.unshift(...(steps[i].content || []).filter((c) => c.type === 'text').map((c) => c.text ?? ''));
  }
  return data?.output_text ?? parts.join('');
}

const googleError = (data) => (Array.isArray(data) ? data[0] : data)?.error;

function geminiRetryDelay(data) {
  const info = googleError(data)?.details?.find((d) => d['@type']?.endsWith('RetryInfo'));
  const seconds = parseFloat(info?.retryDelay);
  return Number.isFinite(seconds) ? Math.ceil(seconds) : 0;
}

function geminiError(status, data, model) {
  const error = googleError(data) || {};
  const message = error.message || `HTTP ${status}`;
  const details = error.details || [];
  const reason = details.find((d) => d.reason)?.reason;
  if (reason === 'API_KEY_INVALID') return new Error('Google rejected your Gemini API key. Check it in Settings.');
  if (status === 429) {
    const violations = details.find((d) => d['@type']?.endsWith('QuotaFailure'))?.violations || [];
    if (violations.some((v) => String(v.quotaValue) === '0') || /limit: 0\b/.test(message)) {
      return new Error(
        `${model} has no free quota on your Google project. Pick another model in Settings (Flash-Lite models usually have the most free requests), or check your limits at aistudio.google.com/rate-limit.`,
      );
    }
    const daily = violations.some((v) => /day/i.test(`${v.quotaId} ${v.quotaMetric}`)) || /per day/i.test(message);
    const wait = geminiRetryDelay(data);
    if (daily) return new Error(`You've used today's free Gemini requests for ${model}. They reset at midnight Pacific time, or pick another model in Settings.`);
    return new Error(`Gemini's per-minute free limit was reached${wait ? `; try again in ${wait}s` : ''}. Google says: ${message}`);
  }
  if (status === 404) return new Error(`${model} isn't available for your Gemini key. Pick another model in Settings.`);
  // Show Google's own words: free-tier setup problems (e.g. verification required) come back as 403s.
  return new Error(`Google Gemini error (${status}): ${message}`);
}

// ---------------------------------------------------------------------------
// OpenAI-compatible chat APIs (Groq, OpenRouter)
// ---------------------------------------------------------------------------

const JSON_HINT = '\n\nReply with only a JSON object that matches this JSON schema:\n';

async function chatJson({ url, headers, extra = {}, model, system, prompt, schema, label, fetch }) {
  const messages = [
    { role: 'system', content: system + JSON_HINT + JSON.stringify(schema) },
    { role: 'user', content: prompt },
  ];
  const strict = { type: 'json_schema', json_schema: { name: 'grammar_tips', strict: true, schema } };
  let { res, data } = await post(fetch, url, headers, { model, messages, response_format: strict, ...extra }, label);
  if (res.status === 400 || res.status === 404 || res.status === 422) {
    // This model can't follow a schema strictly: fall back to plain JSON mode (the schema is in the prompt).
    ({ res, data } = await post(fetch, url, headers, { model, messages, response_format: { type: 'json_object' } }, label));
  }
  if (!res.ok) throw httpError(label, res, data, model);
  const choice = data?.choices?.[0];
  if (choice?.finish_reason === 'length') throw cutShort();
  return choice?.message?.content ?? '';
}

function groq(args) {
  return chatJson({ ...args, url: 'https://api.groq.com/openai/v1/chat/completions', headers: { Authorization: `Bearer ${args.apiKey}` } });
}

function openrouter(args) {
  return chatJson({
    ...args,
    url: 'https://openrouter.ai/api/v1/chat/completions',
    headers: { Authorization: `Bearer ${args.apiKey}` },
    extra: { provider: { require_parameters: true } }, // only route to hosts that support the schema
  });
}

// ---------------------------------------------------------------------------
// OpenAI (Responses API)
// ---------------------------------------------------------------------------

async function openai({ apiKey, model, system, prompt, schema, label, fetch }) {
  const body = {
    model,
    instructions: system,
    input: prompt,
    text: { format: { type: 'json_schema', name: 'grammar_tips', strict: true, schema } },
    store: false,
  };
  const { res, data } = await post(fetch, 'https://api.openai.com/v1/responses', { Authorization: `Bearer ${apiKey}` }, body, label);
  if (!res.ok) throw httpError(label, res, data, model);
  if (data?.status === 'incomplete') throw cutShort();
  const content = (data?.output || []).filter((o) => o.type === 'message').flatMap((o) => o.content || []);
  if (content.some((c) => c.type === 'refusal')) throw new Error(`${label} declined to explain this text.`);
  return data?.output_text ?? content.filter((c) => c.type === 'output_text').map((c) => c.text).join('');
}

// ---------------------------------------------------------------------------
// Anthropic Claude (Messages API). Called directly: the official SDK would add 380 KB to every page.
// ---------------------------------------------------------------------------

// Claude models with server-side refusal fallbacks (Haiku has none).
const CLAUDE_FALLBACK = new Set(['claude-opus-5-5', 'claude-sonnet-5-5']);

const claudeHeaders = (apiKey) => ({
  'x-api-key': apiKey,
  'anthropic-version': '2023-06-01',
  'anthropic-dangerous-direct-browser-access': 'true',
});

async function claude({ apiKey, model, system, prompt, schema, label, fetch }) {
  const headers = claudeHeaders(apiKey);
  const body = {
    model,
    max_tokens: 16000,
    system,
    messages: [{ role: 'user', content: prompt }],
    output_config: { effort: 'low', format: { type: 'json_schema', schema } },
  };
  if (CLAUDE_FALLBACK.has(model)) {
    headers['anthropic-beta'] = 'server-side-fallback-2026-07-01';
    body.fallbacks = 'default';
  }
  const { res, data } = await post(fetch, 'https://api.anthropic.com/v1/messages', headers, body, label);
  if (!res.ok) throw httpError(label, res, data, model);
  if (data?.stop_reason === 'refusal') throw new Error(`${label} declined to explain this text.`);
  if (data?.stop_reason === 'max_tokens') throw cutShort();
  return (data?.content || []).find((b) => b.type === 'text')?.text ?? '';
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

const cutShort = () => new Error('The explanation was cut short. Try selecting less text.');

async function request(fetch, url, init, label) {
  try {
    return await fetch(url, { ...init, timeout: TIMEOUT_MS });
  } catch (err) {
    throw new Error(err?.name === 'TimeoutError' ? `${label} took too long to answer. Try again.` : `Couldn't reach ${label}. Check your internet connection.`);
  }
}

async function post(fetch, url, headers, body, label) {
  const res = await request(fetch, url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) }, label);
  return { res, data: await res.json().catch(() => null) };
}

async function getJson(fetch, url, headers, label) {
  const res = await request(fetch, url, { headers }, label);
  const data = await res.json().catch(() => null);
  if (!res.ok) throw url.includes('generativelanguage') ? geminiError(res.status, data, 'This model') : httpError(label, res, data);
  return data;
}

/** A readable error that keeps the service's own message (it usually says exactly what's wrong). */
function httpError(label, res, data, model) {
  const message =
    (typeof data?.error === 'string' ? data.error : data?.error?.message) || data?.message || `HTTP ${res.status}`;
  if (res.status === 401 || res.status === 403) return new Error(`${label} rejected your API key: ${message}`);
  if (res.status === 429) {
    const wait = res.headers.get('retry-after');
    return new Error(`${label} rate limit reached${wait ? `; try again in ${wait}s` : ''}. ${message}`);
  }
  if (res.status === 404 && model) return new Error(`${model} isn't available on ${label}: ${message}`);
  return new Error(`${label} error (${res.status}): ${message}`);
}
