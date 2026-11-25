// Settings, languages and AI services. No browser-extension or platform APIs here.

// Language codes offered in the UI (Google Translate codes; DeepL codes are mapped in translate.js).
// Names are never hard-coded: they come from Intl.DisplayNames.
export const LANGUAGES = [
  'ar', 'bg', 'bn', 'ca', 'cs', 'da', 'de', 'el', 'en', 'es', 'et', 'fa', 'fi', 'fr', 'he',
  'hi', 'hr', 'hu', 'id', 'it', 'ja', 'ko', 'lt', 'lv', 'ms', 'nl', 'no', 'pl', 'pt', 'ro',
  'ru', 'sk', 'sl', 'sr', 'sv', 'sw', 'ta', 'th', 'tl', 'tr', 'uk', 'ur', 'vi', 'zh-CN', 'zh-TW',
];

// AI services that can write grammar tips. `models` are suggestions shown before the
// service's live model list loads; OpenRouter's free models change often, so its list is always live.
export const AI_PROVIDERS = {
  gemini: {
    label: 'Google Gemini',
    cost: 'Free tier',
    keyName: 'geminiKey',
    keyUrl: 'https://aistudio.google.com/apikey',
    keyHint: 'AIza…',
    note: 'Free tier with daily limits. Google may use free-tier requests to improve its products.',
    models: ['gemini-3.5-flash-lite', 'gemini-flash-latest', 'gemini-3.8-flash'],
  },
  groq: {
    label: 'Groq',
    cost: 'Free tier',
    keyName: 'groqKey',
    keyUrl: 'https://console.groq.com/keys',
    keyHint: 'gsk_…',
    note: 'Free tier with per-minute and daily limits. Very fast open models.',
    models: ['openai/gpt-oss-20b', 'openai/gpt-oss-120b', 'llama-3.3-70b-versatile', 'llama-3.1-8b-instant'],
  },
  openrouter: {
    label: 'OpenRouter',
    cost: 'Free models',
    keyName: 'openrouterKey',
    keyUrl: 'https://openrouter.ai/settings/keys',
    keyHint: 'sk-or-…',
    note: 'One key for hundreds of models. Models marked (free) cost nothing, up to 50 requests a day.',
    models: [],
  },
  openai: {
    label: 'OpenAI',
    cost: 'Paid',
    keyName: 'openaiKey',
    keyUrl: 'https://platform.openai.com/api-keys',
    keyHint: 'sk-…',
    note: 'Pay per use.',
    models: ['gpt-6.1-terra', 'gpt-6-luna', 'gpt-6.2-sol', 'gpt-6.2-astra'],
  },
  claude: {
    label: 'Anthropic Claude',
    cost: 'Paid',
    keyName: 'claudeKey',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    keyHint: 'sk-ant-…',
    note: 'Pay per use. Most thorough explanations.',
    models: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'],
  },
};

export const DEFAULTS = {
  onboarded: false, // false until the languages have been picked once
  enabled: true,
  mode: 'target', // what pages show: 'target' (immersed) | 'native'. Kept across pages.
  native: 'en',
  target: 'es',
  provider: 'google', // translation service: 'google' | 'deepl'
  deeplKey: '',
  aiProvider: 'gemini', // grammar tips: a key of AI_PROVIDERS
  aiModels: {}, // chosen model per AI provider ('' = its first suggestion / first free model)
  geminiKey: '',
  groqKey: '',
  openrouterKey: '',
  openaiKey: '',
  claudeKey: '',
  selectPopup: true, // show the translation card as soon as text is selected
  pausedSites: [], // hostnames where Immersion stays off
  button: { side: 'right', y: 0.7 }, // where the floating button sits (y: share of the screen height)
};

// Intl uses slightly different codes for a few languages.
const DISPLAY_CODE = { 'zh-CN': 'zh-Hans', 'zh-TW': 'zh-Hant', tl: 'fil', no: 'nb' };
const ALIASES = { iw: 'he', nb: 'no', nn: 'no', fil: 'tl', jw: 'jv' };

/** Normalize any BCP-47-ish code ("en-US", "iw", "zh-Hant") to the codes in LANGUAGES. */
export function normLang(code) {
  if (!code) return '';
  const c = String(code).toLowerCase().replace(/_/g, '-');
  if (c.startsWith('zh')) return /tw|hk|mo|hant/.test(c) ? 'zh-TW' : 'zh-CN';
  const base = c.split('-')[0];
  return ALIASES[base] || base;
}

export const sameLang = (a, b) => !!a && !!b && normLang(a) === normLang(b);

/** "Spanish" (in the browser's language). */
export function langName(code, locale = navigator.language) {
  try {
    return new Intl.DisplayNames([locale, 'en'], { type: 'language' }).of(DISPLAY_CODE[code] || code) || code;
  } catch {
    return code;
  }
}

/** "español" (in the language itself). */
export const endonym = (code) => langName(code, DISPLAY_CODE[code] || code);

/** Changing one language to the other's value swaps them, so they never match. */
export function pickLanguage(settings, which, code) {
  const other = which === 'target' ? 'native' : 'target';
  const patch = { [which]: code };
  if (code === settings[other]) patch[other] = settings[which];
  return patch;
}
