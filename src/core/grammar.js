// Grammar tips for a highlighted sentence, written by the AI service picked in Settings.
import { langName, AI_PROVIDERS } from './shared.js';
import { generate, defaultModel } from './ai.js';

const pending = new Map(); // requests in flight, so repeated clicks don't spend extra quota

const SCHEMA = {
  type: 'object',
  properties: {
    points: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          snippet: { type: 'string' },
          title: { type: 'string' },
          explanation: { type: 'string' },
        },
        required: ['snippet', 'title', 'explanation'],
        additionalProperties: false,
      },
    },
    vocabulary: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          term: { type: 'string' },
          meaning: { type: 'string' },
        },
        required: ['term', 'meaning'],
        additionalProperties: false,
      },
    },
  },
  required: ['points', 'vocabulary'],
  additionalProperties: false,
};

const systemPrompt = (native, target) => `You are a friendly, precise ${target} tutor built into a phone's web browser. The learner's native language is ${native}. They read web pages that were machine-translated into ${target}, and they highlighted some text because they want to understand the grammar it uses.

Explain the grammar the highlighted text actually uses, for a learner. Write every title, explanation and meaning in ${native}.

- Give 2 to 5 grammar points, most useful first: tense, mood and conjugation; gender and number agreement; cases, particles or prepositions; pronouns; word order; set phrases and idioms.
- "snippet" is the exact words from the highlighted text that the point is about, copied character for character so they can be highlighted.
- "title" names the rule in a few words. "explanation" is one to three short sentences: what the form is, why it is used here, and how to use it yourself. Show the dictionary form next to inflected forms where it helps.
- If the highlight is a single word or short phrase, explain its form and its role in the surrounding sentence.
- The text is machine-translated. If something in it is unnatural or incorrect ${target}, say so in a point and give the natural version.
- "vocabulary" lists up to 6 useful words or phrases from the highlighted text in dictionary form, each with a short meaning in ${native}.`;

function userPrompt(text, context) {
  let prompt = `Highlighted text:\n<highlight>\n${text}\n</highlight>`;
  if (context && context !== text) {
    prompt += `\n\nSurrounding text, for context only:\n<context>\n${context}\n</context>`;
  }
  return prompt;
}

/**
 * Resolves to { points: [{ snippet, title, explanation }], vocabulary: [{ term, meaning }] }.
 * `settings` supplies the AI service, its key and the chosen model.
 */
export async function explainGrammar({ text, context, native, target, settings }, { fetch, cache }) {
  const provider = AI_PROVIDERS[settings.aiProvider] ? settings.aiProvider : 'gemini';
  const { label, keyName } = AI_PROVIDERS[provider];
  const apiKey = (settings[keyName] || '').trim();
  if (!apiKey) {
    throw Object.assign(new Error(`Add a ${label} API key in Settings to get grammar tips.`), { code: 'NO_KEY' });
  }
  const model = settings.aiModels?.[provider] || (await defaultModel(provider, fetch));
  const key = `g|${provider}|${model}|${native}|${target}|${text}|${context}`;
  if (pending.has(key)) return pending.get(key);

  const job = (async () => {
    const [hit] = await cache.getMany([key]);
    if (hit) return hit;
    const raw = await generate(provider, {
      apiKey,
      model,
      system: systemPrompt(langName(native, 'en'), langName(target, 'en')),
      prompt: userPrompt(text, context),
      schema: SCHEMA,
      fetch,
    });
    const parsed = parseJson(raw);
    if (!parsed) throw new Error(`${label} didn't return a usable explanation. Try again, or pick another model in Settings.`);
    const result = {
      points: Array.isArray(parsed.points) ? parsed.points.filter((p) => p && p.title) : [],
      vocabulary: Array.isArray(parsed.vocabulary) ? parsed.vocabulary.filter((v) => v && v.term) : [],
    };
    cache.putMany([[key, result]]);
    return result;
  })();
  pending.set(key, job);
  try {
    return await job;
  } finally {
    pending.delete(key);
  }
}

/** Parse the model's JSON, tolerating code fences or a sentence around it (common with JSON mode). */
function parseJson(text) {
  if (!text) return null;
  const cleaned = text.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, '');
  for (const candidate of [cleaned, cleaned.slice(cleaned.indexOf('{'), cleaned.lastIndexOf('}') + 1)]) {
    try {
      const value = JSON.parse(candidate);
      if (value && typeof value === 'object') return value;
    } catch {
      /* try the next form */
    }
  }
  return null;
}
