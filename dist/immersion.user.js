// ==UserScript==
// @name         Immersion
// @description  Read the web in the language you're learning. Tap the floating button to switch, two fingers to peek, select text for grammar tips.
// @version      1.0.0
// @match        *://*/*
// @run-at       document-end
// @inject-into  content
// @noframes
// @grant        GM.getValue
// @grant        GM.setValue
// @grant        GM.deleteValue
// @grant        GM.xmlHttpRequest
// ==/UserScript==

(() => {
  // src/platform/userscript.js
  var OFFLINE = "Couldn't connect. Check your internet connection.";
  var named = (name, message) => Object.assign(new Error(message), { name });
  function gmFetch(url, { method = "GET", headers = {}, body, timeout = 3e4 } = {}) {
    return new Promise((resolve, reject) => {
      const fail = (name, message) => {
        clearTimeout(timer);
        reject(named(name, message));
      };
      const timer = setTimeout(() => fail("TimeoutError", "The request timed out."), timeout + 1e3);
      const allHeaders = { ...headers };
      let data = body;
      if (body instanceof URLSearchParams) {
        data = body.toString();
        allHeaders["Content-Type"] = "application/x-www-form-urlencoded;charset=UTF-8";
      }
      const details = {
        url,
        method,
        headers: allHeaders,
        timeout,
        responseType: "text",
        onload(res) {
          if (!res.status) return fail("TypeError", OFFLINE);
          clearTimeout(timer);
          const text = String(res.responseText ?? res.response ?? "");
          resolve({
            ok: res.status >= 200 && res.status < 300,
            status: res.status,
            headers: { get: (name) => headerValue(res.responseHeaders, name) },
            text: async () => text,
            json: async () => JSON.parse(text)
          });
        },
        onerror: () => fail("TypeError", OFFLINE),
        ontimeout: () => fail("TimeoutError", "The request timed out.")
      };
      if (data != null) details.data = data;
      Promise.resolve(GM.xmlHttpRequest(details)).catch(() => fail("TypeError", OFFLINE));
    });
  }
  function headerValue(raw, name) {
    const prefix = `${name.toLowerCase()}:`;
    const line = String(raw || "").split(/\r?\n/).find((l) => l.toLowerCase().startsWith(prefix));
    return line ? line.slice(prefix.length).trim() : null;
  }
  var MAX_SHARDS = 30;
  var MAX_SHARD_CHARS = 25e4;
  var GRAMMAR_SHARD = "cache:*grammar";
  function createCache(host) {
    const shards = /* @__PURE__ */ new Map();
    const loaded = /* @__PURE__ */ new Map();
    const shardOf = (key) => key.startsWith("g|") ? GRAMMAR_SHARD : `cache:${host}`;
    async function load(id) {
      let map;
      try {
        map = new Map(JSON.parse(await GM.getValue(id, "[]")));
      } catch {
        map = /* @__PURE__ */ new Map();
      }
      const shard = { map, dirty: false, timer: 0 };
      loaded.set(id, shard);
      return shard;
    }
    function open(id) {
      if (!shards.has(id)) shards.set(id, load(id));
      return shards.get(id);
    }
    async function save(id) {
      const shard = loaded.get(id);
      if (!shard) return;
      clearTimeout(shard.timer);
      shard.timer = 0;
      if (!shard.dirty) return;
      shard.dirty = false;
      const kept = [];
      let chars = 0;
      for (const entry of [...shard.map].reverse()) {
        chars += entry[0].length + JSON.stringify(entry[1]).length;
        if (chars > MAX_SHARD_CHARS) break;
        kept.push(entry);
      }
      try {
        await GM.setValue(id, JSON.stringify(kept.reverse()));
        const index = JSON.parse(await GM.getValue("cache-index", "[]")).filter((x) => x !== id);
        index.push(id);
        while (index.length > MAX_SHARDS) await GM.deleteValue(index.shift());
        await GM.setValue("cache-index", JSON.stringify(index));
      } catch {
      }
    }
    const saveAll = () => loaded.forEach((_, id) => save(id));
    addEventListener("pagehide", saveAll);
    document.addEventListener("visibilitychange", () => document.hidden && saveAll());
    return {
      async getMany(keys) {
        return Promise.all(keys.map(async (key) => (await open(shardOf(key))).map.get(key)));
      },
      async putMany(entries) {
        for (const [key, value] of entries) {
          const id = shardOf(key);
          const shard = await open(id);
          shard.map.delete(key);
          shard.map.set(key, value);
          shard.dirty = true;
          shard.timer ||= setTimeout(() => save(id), 1e3);
        }
      },
      async clear() {
        for (const shard of await Promise.all(shards.values())) {
          clearTimeout(shard.timer);
          shard.dirty = false;
        }
        shards.clear();
        loaded.clear();
        const index = JSON.parse(await GM.getValue("cache-index", "[]"));
        for (const id of /* @__PURE__ */ new Set([...index, GRAMMAR_SHARD, `cache:${host}`])) await GM.deleteValue(id);
        await GM.deleteValue("cache-index");
      }
    };
  }
  function createPlatform() {
    return {
      fetch: gmFetch,
      cache: createCache(location.hostname),
      /** Rejects if storage can't be read, so a hiccup is never mistaken for a first run. */
      async loadSettings() {
        return JSON.parse(await GM.getValue("settings", "") || "{}");
      },
      saveSettings: (settings) => GM.setValue("settings", JSON.stringify(settings)),
      // A native prompt, because a page can watch what's typed into anything drawn on it.
      askSecret: (message) => window.prompt(message, "")
    };
  }

  // src/core/shared.js
  var LANGUAGES = [
    "ar",
    "bg",
    "bn",
    "ca",
    "cs",
    "da",
    "de",
    "el",
    "en",
    "es",
    "et",
    "fa",
    "fi",
    "fr",
    "he",
    "hi",
    "hr",
    "hu",
    "id",
    "it",
    "ja",
    "ko",
    "lt",
    "lv",
    "ms",
    "nl",
    "no",
    "pl",
    "pt",
    "ro",
    "ru",
    "sk",
    "sl",
    "sr",
    "sv",
    "sw",
    "ta",
    "th",
    "tl",
    "tr",
    "uk",
    "ur",
    "vi",
    "zh-CN",
    "zh-TW"
  ];
  var AI_PROVIDERS = {
    gemini: {
      label: "Google Gemini",
      cost: "Free tier",
      keyName: "geminiKey",
      keyUrl: "https://aistudio.google.com/apikey",
      keyHint: "AIza…",
      note: "Free tier with daily limits. Google may use free-tier requests to improve its products.",
      models: ["gemini-3.5-flash-lite", "gemini-flash-latest", "gemini-3.8-flash"]
    },
    groq: {
      label: "Groq",
      cost: "Free tier",
      keyName: "groqKey",
      keyUrl: "https://console.groq.com/keys",
      keyHint: "gsk_…",
      note: "Free tier with per-minute and daily limits. Very fast open models.",
      models: ["openai/gpt-oss-20b", "openai/gpt-oss-120b", "llama-3.3-70b-versatile", "llama-3.1-8b-instant"]
    },
    openrouter: {
      label: "OpenRouter",
      cost: "Free models",
      keyName: "openrouterKey",
      keyUrl: "https://openrouter.ai/settings/keys",
      keyHint: "sk-or-…",
      note: "One key for hundreds of models. Models marked (free) cost nothing, up to 50 requests a day.",
      models: []
    },
    openai: {
      label: "OpenAI",
      cost: "Paid",
      keyName: "openaiKey",
      keyUrl: "https://platform.openai.com/api-keys",
      keyHint: "sk-…",
      note: "Pay per use.",
      models: ["gpt-6.1-terra", "gpt-6-luna", "gpt-6.2-sol", "gpt-6.2-astra"]
    },
    claude: {
      label: "Anthropic Claude",
      cost: "Paid",
      keyName: "claudeKey",
      keyUrl: "https://console.anthropic.com/settings/keys",
      keyHint: "sk-ant-…",
      note: "Pay per use. Most thorough explanations.",
      models: ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"]
    }
  };
  var DEFAULTS = {
    onboarded: false,
    // false until the languages have been picked once
    enabled: true,
    mode: "target",
    // what pages show: 'target' (immersed) | 'native'. Kept across pages.
    native: "en",
    target: "es",
    provider: "google",
    // translation service: 'google' | 'deepl'
    deeplKey: "",
    aiProvider: "gemini",
    // grammar tips: a key of AI_PROVIDERS
    aiModels: {},
    // chosen model per AI provider ('' = its first suggestion / first free model)
    geminiKey: "",
    groqKey: "",
    openrouterKey: "",
    openaiKey: "",
    claudeKey: "",
    selectPopup: true,
    // show the translation card as soon as text is selected
    pausedSites: [],
    // hostnames where Immersion stays off
    button: { side: "right", y: 0.7 }
    // where the floating button sits (y: share of the screen height)
  };
  var DISPLAY_CODE = { "zh-CN": "zh-Hans", "zh-TW": "zh-Hant", tl: "fil", no: "nb" };
  var ALIASES = { iw: "he", nb: "no", nn: "no", fil: "tl", jw: "jv" };
  function normLang(code) {
    if (!code) return "";
    const c = String(code).toLowerCase().replace(/_/g, "-");
    if (c.startsWith("zh")) return /tw|hk|mo|hant/.test(c) ? "zh-TW" : "zh-CN";
    const base = c.split("-")[0];
    return ALIASES[base] || base;
  }
  var sameLang = (a, b) => !!a && !!b && normLang(a) === normLang(b);
  function langName(code, locale = navigator.language) {
    try {
      return new Intl.DisplayNames([locale, "en"], { type: "language" }).of(DISPLAY_CODE[code] || code) || code;
    } catch {
      return code;
    }
  }
  var endonym = (code) => langName(code, DISPLAY_CODE[code] || code);
  function pickLanguage(settings, which, code) {
    const other = which === "target" ? "native" : "target";
    const patch = { [which]: code };
    if (code === settings[other]) patch[other] = settings[which];
    return patch;
  }

  // src/core/translate.js
  var GOOGLE_URL = "https://translate.googleapis.com/translate_a/t";
  var DEEPL_URL = {
    free: "https://api-free.deepl.com/v2/translate",
    pro: "https://api.deepl.com/v2/translate"
  };
  var DEEPL_TARGET = { en: "EN-US", pt: "PT-BR", "zh-CN": "ZH-HANS", "zh-TW": "ZH-HANT", no: "NB" };
  var MAX_TEXTS = 50;
  var MAX_CHARS = 5e3;
  var MARKED = /^<x0>/;
  async function translate(texts, to, from, settings, { fetch, cache }) {
    const deeplKey = settings.provider === "deepl" ? settings.deeplKey.trim() : "";
    const provider = deeplKey ? "deepl" : "google";
    const keys = texts.map((text) => `t|${provider}|${from}|${to}|${text}`);
    const results = await cache.getMany(keys);
    const missing = results.flatMap((hit, i) => hit ? [] : [i]);
    const plain = missing.filter((i) => !MARKED.test(texts[i]));
    const marked = missing.filter((i) => MARKED.test(texts[i]));
    for (const [indices, xml] of [[plain, false], [marked, true]]) {
      for (const group of batches(indices, texts)) {
        const input = group.map((i) => texts[i]);
        const output = deeplKey ? await deepl(fetch, input, to, from, deeplKey, xml) : await google(fetch, input, to, from);
        group.forEach((i, j) => results[i] = output[j]);
        cache.putMany(group.map((i) => [keys[i], results[i]]));
      }
    }
    return results;
  }
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
    for (const text of texts) body.append("q", text);
    const sl = encodeURIComponent(from || "auto");
    const res = await fetchWithRetry(fetch, `${GOOGLE_URL}?client=gtx&sl=${sl}&tl=${encodeURIComponent(to)}`, {
      method: "POST",
      body
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !Array.isArray(data)) {
      throw new Error(
        res.status === 429 || !data ? "Google Translate is limiting requests right now. Wait a minute, or switch to DeepL in Settings." : `Google Translate failed (HTTP ${res.status}).`
      );
    }
    return texts.map((source, i) => {
      const [text, detected] = Array.isArray(data[i]) ? data[i] : [data[i], from];
      return { text: typeof text === "string" ? text : source, from: normLang(detected) };
    });
  }
  async function deepl(fetch, texts, to, from, key, xml) {
    const body = { text: texts, target_lang: DEEPL_TARGET[to] || to.toUpperCase() };
    if (from) body.source_lang = from.startsWith("zh") ? "ZH" : from === "no" ? "NB" : from.toUpperCase();
    if (xml) body.tag_handling = "xml";
    const send = () => fetchWithRetry(fetch, key.endsWith(":fx") ? DEEPL_URL.free : DEEPL_URL.pro, {
      method: "POST",
      headers: { Authorization: `DeepL-Auth-Key ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    let res = await send();
    if (res.status === 400 && body.source_lang) {
      delete body.source_lang;
      res = await send();
    }
    if (!res.ok) throw new Error(deeplError(res.status));
    const data = await res.json();
    return data.translations.map((t) => ({ text: t.text, from: normLang(t.detected_source_language) }));
  }
  function deeplError(status) {
    if (status === 403) return "DeepL rejected your API key. Check it in Settings.";
    if (status === 456) return "Your DeepL quota for this month is used up.";
    if (status === 429) return "DeepL is limiting requests right now. Try again in a moment.";
    if (status === 400) return "DeepL doesn't support this language. Pick another one, or switch to Google in Settings.";
    return `DeepL failed (HTTP ${status}).`;
  }
  async function fetchWithRetry(fetch, url, options) {
    const res = await fetch(url, options);
    if (res.status !== 429 && res.status < 500) return res;
    await new Promise((r) => setTimeout(r, 1e3));
    return fetch(url, options);
  }

  // src/core/ai.js
  var TIMEOUT_MS = 6e4;
  function generate(provider, { apiKey, model, system, prompt, schema, fetch }) {
    const call = { gemini, groq, openrouter, openai, claude }[provider];
    if (!call) throw new Error(`Unknown AI service: ${provider}`);
    return call({ apiKey, model, system, prompt, schema, fetch, label: AI_PROVIDERS[provider].label });
  }
  async function listModels(provider, apiKey, fetch) {
    switch (provider) {
      case "gemini": {
        const data = await getJson(fetch, "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000", { "x-goog-api-key": apiKey }, "Google Gemini");
        return (data.models || []).filter((m) => /^models\/gemini/.test(m.name) && !/embedding|image|tts|audio|live/.test(m.name)).filter((m) => !m.supportedGenerationMethods || m.supportedGenerationMethods.includes("generateContent")).map((m) => ({ id: m.name.replace(/^models\//, ""), free: false }));
      }
      case "groq": {
        const data = await getJson(fetch, "https://api.groq.com/openai/v1/models", { Authorization: `Bearer ${apiKey}` }, "Groq");
        return (data.data || []).filter((m) => !/whisper|tts|guard|orpheus|playai|distil/.test(m.id)).map((m) => ({ id: m.id, free: false }));
      }
      case "openrouter": {
        const data = await getJson(fetch, "https://openrouter.ai/api/v1/models", {}, "OpenRouter");
        return (data.data || []).filter((m) => (m.supported_parameters || []).includes("response_format")).map((m) => ({
          id: m.id,
          free: m.id.endsWith(":free"),
          structured: (m.supported_parameters || []).includes("structured_outputs")
        })).sort((a, b) => b.free - a.free || b.structured - a.structured);
      }
      case "openai": {
        const data = await getJson(fetch, "https://api.openai.com/v1/models", { Authorization: `Bearer ${apiKey}` }, "OpenAI");
        return (data.data || []).filter((m) => /^(gpt|o\d)/.test(m.id) && !/audio|realtime|tts|transcribe|image|search|embedding|instruct/.test(m.id)).map((m) => ({ id: m.id, free: false }));
      }
      case "claude": {
        const data = await getJson(fetch, "https://api.anthropic.com/v1/models?limit=100", claudeHeaders(apiKey), "Anthropic Claude");
        return (data.data || []).map((m) => ({ id: m.id, free: false }));
      }
      default:
        throw new Error(`Unknown AI service: ${provider}`);
    }
  }
  async function defaultModel(provider, fetch) {
    const suggested = AI_PROVIDERS[provider]?.models?.[0];
    if (suggested) return suggested;
    const models = await listModels(provider, "", fetch);
    const pick = models.find((m) => m.free && m.structured) || models.find((m) => m.free);
    if (!pick) throw new Error("OpenRouter has no free models with JSON output right now. Pick a model in Settings.");
    return pick.id;
  }
  async function gemini({ apiKey, model, system, prompt, schema, label, fetch }) {
    const body = {
      model,
      system_instruction: system,
      input: prompt,
      response_format: { type: "text", mime_type: "application/json", schema },
      store: false
      // don't keep the conversation on Google's side
    };
    const headers = { "x-goog-api-key": apiKey };
    let { res, data } = await post(fetch, "https://generativelanguage.googleapis.com/v1beta/interactions", headers, body, label);
    const wait = res.status === 429 ? geminiRetryDelay(data) : 0;
    if (wait && wait <= 12) {
      await new Promise((r) => setTimeout(r, wait * 1e3));
      ({ res, data } = await post(fetch, "https://generativelanguage.googleapis.com/v1beta/interactions", headers, body, label));
    }
    if (!res.ok) throw geminiError(res.status, data, model);
    if (["incomplete", "budget_exceeded", "requires_continuation"].includes(data?.status)) throw cutShort();
    if (data?.status === "failed") throw new Error(`${label} couldn't answer this one. Try a different sentence.`);
    const steps = Array.isArray(data?.steps) ? data.steps : [];
    const parts = [];
    for (let i = steps.length - 1; i >= 0 && steps[i].type !== "user_input"; i--) {
      if (steps[i].type !== "model_output") continue;
      parts.unshift(...(steps[i].content || []).filter((c) => c.type === "text").map((c) => c.text ?? ""));
    }
    return data?.output_text ?? parts.join("");
  }
  var googleError = (data) => (Array.isArray(data) ? data[0] : data)?.error;
  function geminiRetryDelay(data) {
    const info = googleError(data)?.details?.find((d) => d["@type"]?.endsWith("RetryInfo"));
    const seconds = parseFloat(info?.retryDelay);
    return Number.isFinite(seconds) ? Math.ceil(seconds) : 0;
  }
  function geminiError(status, data, model) {
    const error = googleError(data) || {};
    const message = error.message || `HTTP ${status}`;
    const details = error.details || [];
    const reason = details.find((d) => d.reason)?.reason;
    if (reason === "API_KEY_INVALID") return new Error("Google rejected your Gemini API key. Check it in Settings.");
    if (status === 429) {
      const violations = details.find((d) => d["@type"]?.endsWith("QuotaFailure"))?.violations || [];
      if (violations.some((v) => String(v.quotaValue) === "0") || /limit: 0\b/.test(message)) {
        return new Error(
          `${model} has no free quota on your Google project. Pick another model in Settings (Flash-Lite models usually have the most free requests), or check your limits at aistudio.google.com/rate-limit.`
        );
      }
      const daily = violations.some((v) => /day/i.test(`${v.quotaId} ${v.quotaMetric}`)) || /per day/i.test(message);
      const wait = geminiRetryDelay(data);
      if (daily) return new Error(`You've used today's free Gemini requests for ${model}. They reset at midnight Pacific time, or pick another model in Settings.`);
      return new Error(`Gemini's per-minute free limit was reached${wait ? `; try again in ${wait}s` : ""}. Google says: ${message}`);
    }
    if (status === 404) return new Error(`${model} isn't available for your Gemini key. Pick another model in Settings.`);
    return new Error(`Google Gemini error (${status}): ${message}`);
  }
  var JSON_HINT = "\n\nReply with only a JSON object that matches this JSON schema:\n";
  async function chatJson({ url, headers, extra = {}, model, system, prompt, schema, label, fetch }) {
    const messages = [
      { role: "system", content: system + JSON_HINT + JSON.stringify(schema) },
      { role: "user", content: prompt }
    ];
    const strict = { type: "json_schema", json_schema: { name: "grammar_tips", strict: true, schema } };
    let { res, data } = await post(fetch, url, headers, { model, messages, response_format: strict, ...extra }, label);
    if (res.status === 400 || res.status === 404 || res.status === 422) {
      ({ res, data } = await post(fetch, url, headers, { model, messages, response_format: { type: "json_object" } }, label));
    }
    if (!res.ok) throw httpError(label, res, data, model);
    const choice = data?.choices?.[0];
    if (choice?.finish_reason === "length") throw cutShort();
    return choice?.message?.content ?? "";
  }
  function groq(args) {
    return chatJson({ ...args, url: "https://api.groq.com/openai/v1/chat/completions", headers: { Authorization: `Bearer ${args.apiKey}` } });
  }
  function openrouter(args) {
    return chatJson({
      ...args,
      url: "https://openrouter.ai/api/v1/chat/completions",
      headers: { Authorization: `Bearer ${args.apiKey}` },
      extra: { provider: { require_parameters: true } }
      // only route to hosts that support the schema
    });
  }
  async function openai({ apiKey, model, system, prompt, schema, label, fetch }) {
    const body = {
      model,
      instructions: system,
      input: prompt,
      text: { format: { type: "json_schema", name: "grammar_tips", strict: true, schema } },
      store: false
    };
    const { res, data } = await post(fetch, "https://api.openai.com/v1/responses", { Authorization: `Bearer ${apiKey}` }, body, label);
    if (!res.ok) throw httpError(label, res, data, model);
    if (data?.status === "incomplete") throw cutShort();
    const content = (data?.output || []).filter((o) => o.type === "message").flatMap((o) => o.content || []);
    if (content.some((c) => c.type === "refusal")) throw new Error(`${label} declined to explain this text.`);
    return data?.output_text ?? content.filter((c) => c.type === "output_text").map((c) => c.text).join("");
  }
  var CLAUDE_FALLBACK = /* @__PURE__ */ new Set(["claude-opus-5-5", "claude-sonnet-5-5"]);
  var claudeHeaders = (apiKey) => ({
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
    "anthropic-dangerous-direct-browser-access": "true"
  });
  async function claude({ apiKey, model, system, prompt, schema, label, fetch }) {
    const headers = claudeHeaders(apiKey);
    const body = {
      model,
      max_tokens: 16e3,
      system,
      messages: [{ role: "user", content: prompt }],
      output_config: { effort: "low", format: { type: "json_schema", schema } }
    };
    if (CLAUDE_FALLBACK.has(model)) {
      headers["anthropic-beta"] = "server-side-fallback-2026-07-01";
      body.fallbacks = "default";
    }
    const { res, data } = await post(fetch, "https://api.anthropic.com/v1/messages", headers, body, label);
    if (!res.ok) throw httpError(label, res, data, model);
    if (data?.stop_reason === "refusal") throw new Error(`${label} declined to explain this text.`);
    if (data?.stop_reason === "max_tokens") throw cutShort();
    return (data?.content || []).find((b) => b.type === "text")?.text ?? "";
  }
  var cutShort = () => new Error("The explanation was cut short. Try selecting less text.");
  async function request(fetch, url, init, label) {
    try {
      return await fetch(url, { ...init, timeout: TIMEOUT_MS });
    } catch (err) {
      throw new Error(err?.name === "TimeoutError" ? `${label} took too long to answer. Try again.` : `Couldn't reach ${label}. Check your internet connection.`);
    }
  }
  async function post(fetch, url, headers, body, label) {
    const res = await request(fetch, url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) }, label);
    return { res, data: await res.json().catch(() => null) };
  }
  async function getJson(fetch, url, headers, label) {
    const res = await request(fetch, url, { headers }, label);
    const data = await res.json().catch(() => null);
    if (!res.ok) throw url.includes("generativelanguage") ? geminiError(res.status, data, "This model") : httpError(label, res, data);
    return data;
  }
  function httpError(label, res, data, model) {
    const message = (typeof data?.error === "string" ? data.error : data?.error?.message) || data?.message || `HTTP ${res.status}`;
    if (res.status === 401 || res.status === 403) return new Error(`${label} rejected your API key: ${message}`);
    if (res.status === 429) {
      const wait = res.headers.get("retry-after");
      return new Error(`${label} rate limit reached${wait ? `; try again in ${wait}s` : ""}. ${message}`);
    }
    if (res.status === 404 && model) return new Error(`${model} isn't available on ${label}: ${message}`);
    return new Error(`${label} error (${res.status}): ${message}`);
  }

  // src/core/grammar.js
  var pending = /* @__PURE__ */ new Map();
  var SCHEMA = {
    type: "object",
    properties: {
      points: {
        type: "array",
        items: {
          type: "object",
          properties: {
            snippet: { type: "string" },
            title: { type: "string" },
            explanation: { type: "string" }
          },
          required: ["snippet", "title", "explanation"],
          additionalProperties: false
        }
      },
      vocabulary: {
        type: "array",
        items: {
          type: "object",
          properties: {
            term: { type: "string" },
            meaning: { type: "string" }
          },
          required: ["term", "meaning"],
          additionalProperties: false
        }
      }
    },
    required: ["points", "vocabulary"],
    additionalProperties: false
  };
  var systemPrompt = (native, target) => `You are a friendly, precise ${target} tutor built into a phone's web browser. The learner's native language is ${native}. They read web pages that were machine-translated into ${target}, and they highlighted some text because they want to understand the grammar it uses.

Explain the grammar the highlighted text actually uses, for a learner. Write every title, explanation and meaning in ${native}.

- Give 2 to 5 grammar points, most useful first: tense, mood and conjugation; gender and number agreement; cases, particles or prepositions; pronouns; word order; set phrases and idioms.
- "snippet" is the exact words from the highlighted text that the point is about, copied character for character so they can be highlighted.
- "title" names the rule in a few words. "explanation" is one to three short sentences: what the form is, why it is used here, and how to use it yourself. Show the dictionary form next to inflected forms where it helps.
- If the highlight is a single word or short phrase, explain its form and its role in the surrounding sentence.
- The text is machine-translated. If something in it is unnatural or incorrect ${target}, say so in a point and give the natural version.
- "vocabulary" lists up to 6 useful words or phrases from the highlighted text in dictionary form, each with a short meaning in ${native}.`;
  function userPrompt(text, context) {
    let prompt = `Highlighted text:
<highlight>
${text}
</highlight>`;
    if (context && context !== text) {
      prompt += `

Surrounding text, for context only:
<context>
${context}
</context>`;
    }
    return prompt;
  }
  async function explainGrammar({ text, context, native, target, settings }, { fetch, cache }) {
    const provider = AI_PROVIDERS[settings.aiProvider] ? settings.aiProvider : "gemini";
    const { label, keyName } = AI_PROVIDERS[provider];
    const apiKey = (settings[keyName] || "").trim();
    if (!apiKey) {
      throw Object.assign(new Error(`Add a ${label} API key in Settings to get grammar tips.`), { code: "NO_KEY" });
    }
    const model = settings.aiModels?.[provider] || await defaultModel(provider, fetch);
    const key = `g|${provider}|${model}|${native}|${target}|${text}|${context}`;
    if (pending.has(key)) return pending.get(key);
    const job = (async () => {
      const [hit] = await cache.getMany([key]);
      if (hit) return hit;
      const raw = await generate(provider, {
        apiKey,
        model,
        system: systemPrompt(langName(native, "en"), langName(target, "en")),
        prompt: userPrompt(text, context),
        schema: SCHEMA,
        fetch
      });
      const parsed = parseJson(raw);
      if (!parsed) throw new Error(`${label} didn't return a usable explanation. Try again, or pick another model in Settings.`);
      const result = {
        points: Array.isArray(parsed.points) ? parsed.points.filter((p) => p && p.title) : [],
        vocabulary: Array.isArray(parsed.vocabulary) ? parsed.vocabulary.filter((v) => v && v.term) : []
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
  function parseJson(text) {
    if (!text) return null;
    const cleaned = text.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, "");
    for (const candidate of [cleaned, cleaned.slice(cleaned.indexOf("{"), cleaned.lastIndexOf("}") + 1)]) {
      try {
        const value = JSON.parse(candidate);
        if (value && typeof value === "object") return value;
      } catch {
      }
    }
    return null;
  }

  // src/page/engine.js
  var SKIP = [
    "script",
    "style",
    "noscript",
    "template",
    "textarea",
    "input",
    "select",
    "option",
    "code",
    "pre",
    "kbd",
    "samp",
    "var",
    "svg",
    "math",
    "canvas",
    "iframe",
    "object",
    "immersion-ui",
    '[contenteditable]:not([contenteditable="false"])',
    '[translate="no"]',
    ".notranslate",
    '[class*="material-icons"]',
    '[class*="material-symbols"]'
  ].join(",");
  var LETTER = new RegExp("\\p{L}", "u");
  var URL_OR_EMAIL = /^\s*(?:(?:https?:\/\/|www\.)\S+|\S+@\S+\.\w+)\s*$/;
  var MAX_NODE_CHARS = 5e3;
  var BATCH_TEXTS = 40;
  var BATCH_CHARS = 4e3;
  var PARALLEL_REQUESTS = 3;
  var tidy = (s) => s.replace(/\s+/g, " ").trim();
  var hasLetters = (s) => LETTER.test(s);
  function blockOf(node) {
    for (let el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement; el; el = el.parentElement) {
      if (el === document.body) return el;
      const display = getComputedStyle(el).display;
      if (display !== "inline" && display !== "contents") return el;
    }
    return null;
  }
  function createEngine({ translate: translate2, getSettings, onState, onError }) {
    let mode = "off";
    let pageLang = "";
    let generation = 0;
    let inFlight = 0;
    let lastError = "";
    let errorShownFor = -1;
    const records = /* @__PURE__ */ new WeakMap();
    const produced = /* @__PURE__ */ new Map();
    const waiting = /* @__PURE__ */ new Map();
    const queue = /* @__PURE__ */ new Set();
    const dirty = /* @__PURE__ */ new Set();
    const timers = {};
    const originalHtmlLang = document.documentElement.getAttribute("lang");
    const io = new IntersectionObserver(onVisible, { rootMargin: "50% 0px" });
    const mo = new MutationObserver(onMutations);
    let watchedRoots = /* @__PURE__ */ new WeakSet();
    let observing = false;
    let sawRemovals = false;
    const displayLang = () => mode === "target" ? getSettings().target : mode === "native" ? getSettings().native : "";
    const otherLang = () => mode === "target" ? getSettings().native : getSettings().target;
    const state = () => ({ mode, pageLang, lang: displayLang(), busy: inFlight > 0, error: lastError });
    function schedule(name, fn, delay) {
      if (!timers[name]) timers[name] = setTimeout(() => (timers[name] = 0, fn()), delay);
    }
    async function translateTexts(texts, to, from = "") {
      if (!inFlight++) onState(state());
      try {
        return await translate2(texts, to, from);
      } finally {
        if (!--inFlight) onState(state());
      }
    }
    const worthTranslating = (text) => !!text && text.length <= MAX_NODE_CHARS && LETTER.test(text) && text.trim().length > 1 && !URL_OR_EMAIL.test(text);
    function walk(root, visit) {
      const shadows = [];
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          if (node.nodeType === Node.TEXT_NODE) return NodeFilter.FILTER_ACCEPT;
          if (node.matches(SKIP)) return NodeFilter.FILTER_REJECT;
          if (node.shadowRoot) shadows.push(node.shadowRoot);
          return NodeFilter.FILTER_SKIP;
        }
      });
      for (let node = walker.nextNode(); node; node = walker.nextNode()) visit(node);
      for (const shadow of shadows) {
        watch(shadow);
        walk(shadow, visit);
      }
    }
    function scan(root) {
      if (!root?.isConnected) return;
      if (root.nodeType === Node.TEXT_NODE) {
        if (root.parentElement && !root.parentElement.closest(SKIP)) consider(root);
      } else if (root.nodeType === Node.ELEMENT_NODE && !root.closest(SKIP)) {
        walk(root, consider);
      }
    }
    const isOurs = (node, rec) => {
      const value = node.nodeValue;
      return value === rec.orig || Object.values(rec.tr).includes(value);
    };
    function render(node, rec, lang) {
      const value = sameLang(rec.from, lang) ? rec.orig : rec.tr[lang];
      if (value == null) return false;
      if (node.nodeValue !== value) node.nodeValue = value;
      return true;
    }
    function consider(node) {
      const lang = displayLang();
      if (!lang) return;
      let rec = records.get(node);
      if (rec && !isOurs(node, rec)) {
        records.delete(node);
        rec = void 0;
      }
      if (!rec) {
        const copy = produced.get(node.nodeValue.trim());
        if (copy) {
          const [, lead, trail] = node.nodeValue.match(/^(\s*)[\s\S]*?(\s*)$/);
          rec = { orig: lead + copy.orig + trail, from: copy.from, tr: { [copy.lang]: node.nodeValue } };
          records.set(node, rec);
        }
      }
      if (rec) {
        if (render(node, rec, lang)) return;
      } else if (!worthTranslating(node.nodeValue) || sameLang(pageLang, lang)) {
        return;
      }
      const el = node.parentElement;
      if (!el) return;
      let nodes = waiting.get(el);
      if (!nodes) {
        waiting.set(el, nodes = /* @__PURE__ */ new Set());
        io.observe(el);
      }
      nodes.add(node);
    }
    function onVisible(entries) {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        io.unobserve(entry.target);
        const nodes = waiting.get(entry.target);
        waiting.delete(entry.target);
        nodes?.forEach((node) => queue.add(node));
      }
      if (queue.size) schedule("flush", flush, 30);
    }
    const FROZEN_INLINE = 'code, kbd, samp, var, .notranslate, [translate="no"]';
    const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
    const escapeXml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    function decodeEntities(s) {
      return s.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (match, e) => {
        if (e[0] !== "#") return ENTITIES[e.toLowerCase()] ?? match;
        const code = /^#x/i.test(e) ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return code > 0 && code <= 1114111 ? String.fromCodePoint(code) : match;
      });
    }
    function inlineRuns(block) {
      const runs = [[]];
      const breakRun = () => runs.at(-1).length && runs.push([]);
      const visit = (el) => {
        for (const child of el.childNodes) {
          if (child.nodeType === Node.TEXT_NODE) {
            runs.at(-1).push(child);
          } else if (child.nodeType === Node.ELEMENT_NODE) {
            if (child.tagName === "BR") {
              breakRun();
              continue;
            }
            const display = getComputedStyle(child).display;
            if (display !== "inline" && display !== "contents") {
              if (display !== "none") breakRun();
            } else if (!child.matches(SKIP) || child.matches(FROZEN_INLINE)) {
              visit(child);
            }
          }
        }
      };
      visit(block);
      return runs.filter((run) => run.length);
    }
    function simpleJob(node) {
      const rec = records.get(node);
      const orig = rec && isOurs(node, rec) ? rec.orig : node.nodeValue;
      return { nodes: [node], pieces: [{ node, orig }], source: orig.trim(), marked: false };
    }
    function jobsFor(node, runsCache) {
      const block = blockOf(node);
      if (!block) return [simpleJob(node)];
      if (!runsCache.has(block)) runsCache.set(block, inlineRuns(block));
      const run = runsCache.get(block).find((r) => r.includes(node));
      if (!run || run.length === 1) return [simpleJob(node)];
      const pieces = run.map((n) => {
        const rec = records.get(n);
        return {
          node: n,
          orig: rec && isOurs(n, rec) ? rec.orig : n.nodeValue,
          frozen: !!n.parentElement?.closest(SKIP),
          inline: n.parentElement !== block
          // inside a link, bold text, etc.
        };
      });
      const wordy = pieces.filter((p) => !p.frozen && worthTranslating(p.orig));
      if (wordy.length < 2) return [simpleJob(node)];
      const last = pieces.length - 1;
      const source = pieces.map((p, i) => {
        let text = p.orig.replace(/\s+/g, " ");
        if (i === 0) text = text.trimStart();
        if (i === last) text = text.trimEnd();
        return `<x${i}>${escapeXml(text)}</x${i}>`;
      }).join("");
      if (source.length > MAX_NODE_CHARS) return wordy.map((p) => simpleJob(p.node));
      return [{ nodes: run, pieces, source, marked: true }];
    }
    function splitMarked(text, count) {
      const marker = /<x(\d+)>([\s\S]*?)<\/x\1>/g;
      const parts = [...text.matchAll(marker)];
      if (parts.length !== count || parts.some((m, i) => Number(m[1]) !== i)) return null;
      if (text.replace(marker, "").trim()) return null;
      return parts.map((m) => decodeEntities(m[2]));
    }
    function chunk(texts) {
      const out = [];
      let batch = [];
      let chars = 0;
      for (const text of texts) {
        if (batch.length && (batch.length >= BATCH_TEXTS || chars + text.length > BATCH_CHARS)) {
          out.push(batch);
          batch = [];
          chars = 0;
        }
        batch.push(text);
        chars += text.length;
      }
      if (batch.length) out.push(batch);
      return out;
    }
    async function flush() {
      const lang = displayLang();
      const gen = generation;
      const jobs = [];
      const taken = /* @__PURE__ */ new Set();
      const runsCache = /* @__PURE__ */ new Map();
      for (const node of queue) {
        if (!lang || taken.has(node) || !node.isConnected) continue;
        const rec = records.get(node);
        if (rec && isOurs(node, rec) && render(node, rec, lang)) continue;
        for (const job of jobsFor(node, runsCache)) {
          job.nodes.forEach((n) => taken.add(n));
          if (job.source) jobs.push(job);
        }
      }
      queue.clear();
      const failed = await runJobs(jobs, lang, gen);
      if (failed.length) {
        const pieces = failed.flatMap((job) => job.pieces.filter((p) => !p.frozen && worthTranslating(p.orig)));
        await runJobs(pieces.map((p) => simpleJob(p.node)), lang, gen);
      }
    }
    async function runJobs(jobs, lang, gen) {
      const failed = [];
      const bySource = /* @__PURE__ */ new Map();
      for (const job of jobs) {
        if (!bySource.has(job.source)) bySource.set(job.source, []);
        bySource.get(job.source).push(job);
      }
      const batches2 = chunk([...bySource.keys()]);
      let next = 0;
      const worker = async () => {
        while (next < batches2.length && gen === generation) {
          const batch = batches2[next++];
          let results;
          try {
            results = await translateTexts(batch, lang, pageLang);
          } catch (err) {
            showError(err);
            return;
          }
          if (gen !== generation) return;
          setError("");
          batch.forEach((source, i) => {
            for (const job of bySource.get(source)) if (!applyJob(job, results[i], lang)) failed.push(job);
          });
        }
      };
      await Promise.all(Array.from({ length: Math.min(PARALLEL_REQUESTS, batches2.length) }, worker));
      return failed;
    }
    function applyJob(job, result, lang) {
      if (!result) return true;
      const { from } = result;
      if (!job.marked) {
        const { node, orig } = job.pieces[0];
        const [, lead, trail] = orig.match(/^(\s*)[\s\S]*?(\s*)$/);
        remember(node, orig, from, lang, lead + result.text.trim() + trail);
        return true;
      }
      const { pieces } = job;
      if (sameLang(from, lang)) {
        pieces.forEach((p) => !p.frozen && remember(p.node, p.orig, from, lang, null));
        return true;
      }
      const out = splitMarked(result.text, pieces.length);
      if (!out) return false;
      const intact = pieces.every(
        (p, i) => p.frozen ? tidy(out[i]) === tidy(p.orig) : !(p.inline && LETTER.test(p.orig)) || LETTER.test(out[i])
      );
      if (!intact) return false;
      const last = pieces.length - 1;
      pieces.forEach((p, i) => {
        if (p.frozen || !p.orig.trim() && !out[i].trim()) return;
        let text = out[i];
        if (i === 0) text = p.orig.match(/^\s*/)[0] + text.trimStart();
        if (i === last) text = text.trimEnd() + p.orig.match(/\s*$/)[0];
        remember(p.node, p.orig, from, lang, text);
      });
      return true;
    }
    function remember(node, orig, from, lang, text) {
      if (!node.isConnected) return;
      let rec = records.get(node);
      if (rec && !isOurs(node, rec)) {
        records.delete(node);
        rec = void 0;
      }
      if (!rec) {
        if (node.nodeValue !== orig) return;
        rec = { orig, from: "", tr: {} };
        records.set(node, rec);
      } else if (rec.orig !== orig) {
        return;
      }
      if (from) rec.from = from;
      if (text != null) {
        rec.tr[lang] = text;
        if (LETTER.test(text)) produced.set(text.trim(), { orig: orig.trim(), from: rec.from, lang });
      }
      render(node, rec, lang);
    }
    function setError(message) {
      if (message === lastError) return;
      lastError = message;
      onState(state());
    }
    function showError(err) {
      setError(err.message);
      if (errorShownFor === generation) return;
      errorShownFor = generation;
      onError(err);
    }
    function watch(root) {
      if (!observing || watchedRoots.has(root)) return;
      watchedRoots.add(root);
      mo.observe(root, { childList: true, subtree: true, characterData: true });
    }
    function observeDom(on) {
      if (on) {
        observing = true;
        watch(document.documentElement);
      } else {
        mo.disconnect();
        observing = false;
        watchedRoots = /* @__PURE__ */ new WeakSet();
      }
    }
    function onMutations(mutations) {
      const lang = displayLang();
      for (const m of mutations) {
        if (m.type === "childList") {
          m.addedNodes.forEach((node2) => dirty.add(node2));
          if (m.removedNodes.length) sawRemovals = true;
          continue;
        }
        const node = m.target;
        const rec = records.get(node);
        if (rec && isOurs(node, rec)) {
          if (lang && node.nodeValue === rec.orig && !sameLang(rec.from, lang) && rec.tr[lang]) {
            rec.reverts = (rec.reverts || 0) + 1;
            if (rec.reverts <= 3) node.nodeValue = rec.tr[lang];
          }
          continue;
        }
        if (rec) records.delete(node);
        dirty.add(node);
      }
      if (dirty.size || sawRemovals) schedule("rescan", rescan, 80);
    }
    function rescan() {
      if (sawRemovals) {
        sawRemovals = false;
        for (const el of waiting.keys()) {
          if (!el.isConnected) {
            io.unobserve(el);
            waiting.delete(el);
          }
        }
      }
      const nodes = [...dirty];
      dirty.clear();
      nodes.forEach(scan);
    }
    function restoreOriginals() {
      if (!document.body) return;
      walk(document.body, (node) => {
        const rec = records.get(node);
        if (rec && isOurs(node, rec) && node.nodeValue !== rec.orig) node.nodeValue = rec.orig;
      });
    }
    function setHtmlLang(lang) {
      const html = document.documentElement;
      if (lang && !sameLang(lang, pageLang)) html.setAttribute("lang", lang);
      else if (originalHtmlLang == null) html.removeAttribute("lang");
      else html.setAttribute("lang", originalHtmlLang);
    }
    function refresh() {
      generation++;
      lastError = "";
      queue.clear();
      waiting.forEach((_, el) => io.unobserve(el));
      waiting.clear();
      const lang = displayLang();
      if (lang) {
        observeDom(true);
        setHtmlLang(lang);
        if (document.body) scan(document.body);
      } else {
        observeDom(false);
        restoreOriginals();
        setHtmlLang("");
      }
      onState(state());
    }
    function setMode(next) {
      if (next === mode) return;
      mode = next;
      refresh();
    }
    function languagesChanged() {
      if (mode === "off") return;
      restoreOriginals();
      refresh();
    }
    async function detectPageLang() {
      const main = document.querySelector('article, main, [role="main"]');
      let sample = tidy(main?.innerText || "").slice(0, 300);
      if (sample.length < 80) sample = tidy(document.body?.innerText || "").slice(0, 300);
      if (sample.length < 80) return;
      const declared = normLang(originalHtmlLang);
      try {
        const { native, target } = getSettings();
        const [result] = await translateTexts([sample], mode === "native" ? native : target);
        const detected = normLang(result.from);
        if (detected && (!declared || declared === detected)) pageLang = detected;
      } catch {
      }
    }
    async function textOf(block, lang) {
      const pieces = [];
      const walker = document.createTreeWalker(block, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          if (node.nodeType === Node.TEXT_NODE) return NodeFilter.FILTER_ACCEPT;
          const display = getComputedStyle(node).display;
          return display === "inline" || display === "contents" ? NodeFilter.FILTER_SKIP : NodeFilter.FILTER_REJECT;
        }
      });
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const rec = records.get(node);
        if (rec && isOurs(node, rec)) {
          pieces.push(rec);
        } else {
          const neutral = !worthTranslating(node.nodeValue) || node.parentElement?.closest(SKIP);
          pieces.push({ orig: node.nodeValue, from: neutral ? "*" : pageLang, tr: {} });
        }
      }
      const inLang = (p) => p.from === "*" || sameLang(p.from, lang);
      if (!pieces.some((p) => p.from !== "*")) return "";
      if (pieces.every(inLang)) return tidy(pieces.map((p) => p.orig).join(""));
      if (pieces.every((p) => inLang(p) || p.tr[lang])) {
        return tidy(pieces.map((p) => inLang(p) ? p.orig : p.tr[lang]).join(""));
      }
      const source = tidy(pieces.map((p) => p.orig).join("")).slice(0, 3e3);
      const [result] = await translateTexts([source], lang, pageLang);
      return sameLang(result.from, lang) ? source : result.text;
    }
    return {
      setMode,
      languagesChanged,
      detectPageLang,
      translateTexts,
      textOf,
      displayLang,
      otherLang,
      state,
      mode: () => mode,
      retry: refresh
    };
  }

  // src/page/styles.js
  var COLORS = ["#6366f1", "#0d9488", "#d97706", "#db2777", "#2563eb"];
  var CSS = `
  :host { all: initial; }
  * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
  .root {
    --bg: #ffffff; --fg: #1d2030; --muted: #667085; --line: #e6e7ee; --soft: #f4f5fb;
    --accent: #4f46e5; --accent-fg: #ffffff; --accent-soft: #eef0ff; --error: #b42318; --off: #64748b;
    --shadow: 0 14px 36px rgba(16, 24, 40, .18), 0 2px 6px rgba(16, 24, 40, .1);
    font: 16px/1.5 system-ui, -apple-system, "Helvetica Neue", sans-serif;
    color: var(--fg); -webkit-text-size-adjust: 100%; text-align: start;
  }
  @media (prefers-color-scheme: dark) {
    .root {
      --bg: #1b1c24; --fg: #eceef4; --muted: #a3a9ba; --line: #2f3140; --soft: #262835;
      --accent: #8f8cff; --accent-fg: #14142a; --accent-soft: #2a2a48; --error: #ff8a80; --off: #8892a6;
      --shadow: 0 14px 36px rgba(0, 0, 0, .55);
    }
  }
  .layer { position: fixed; z-index: 2147483647; }
  button { font: inherit; color: inherit; background: none; border: 0; padding: 0; margin: 0; cursor: pointer; }
  button:focus-visible, select:focus-visible, a:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

  .label { font-size: 12px; font-weight: 600; letter-spacing: .05em; text-transform: uppercase; color: var(--muted); margin: 0 0 2px; }
  .error { color: var(--error); margin: 0; }
  .muted { color: var(--muted); margin: 0; }
  .small { font-size: 14px; line-height: 1.4; }
  .skeleton { display: grid; gap: 8px; padding: 6px 0 4px; }
  .skeleton i {
    display: block; height: 11px; border-radius: 6px;
    background: linear-gradient(90deg, var(--line), var(--accent-soft), var(--line));
    background-size: 200% 100%; animation: shimmer 1.1s linear infinite;
  }
  .skeleton i:last-child { width: 62%; }
  @keyframes shimmer { to { background-position: -200% 0; } }

  /* Floating button */
  .pill {
    width: 48px; height: 48px; border-radius: 50%; display: grid; place-items: center;
    background: var(--off); color: #fff; font-size: 15px; font-weight: 700; letter-spacing: .02em;
    box-shadow: var(--shadow); pointer-events: auto; touch-action: none; opacity: .62;
    -webkit-user-select: none; user-select: none; -webkit-touch-callout: none;
    transition: opacity .3s ease, transform .12s ease, background-color .15s ease;
  }
  .pill.awake { opacity: 1; }
  .pill.pressed { transform: scale(.92); }
  .pill.target { background: var(--accent); color: var(--accent-fg); }
  .pill.off { background: var(--bg); color: var(--muted); border: 1.5px solid var(--line); }
  .pill::before {
    content: ""; position: absolute; inset: -4px; border-radius: 50%; opacity: 0;
    border: 2.5px solid transparent; border-top-color: var(--accent); border-right-color: var(--accent);
  }
  .pill.busy::before { opacity: 1; animation: spin .8s linear infinite; }
  .pill.failed::after {
    content: ""; position: absolute; top: 1px; right: 1px; width: 13px; height: 13px; border-radius: 50%;
    background: #dc2626; border: 2px solid var(--bg);
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* Peek */
  .hl {
    border-radius: 6px; pointer-events: none; visibility: hidden;
    background: color-mix(in srgb, var(--accent) 9%, transparent);
    box-shadow: 0 0 0 1.5px color-mix(in srgb, var(--accent) 35%, transparent);
  }
  .peek {
    width: max-content; max-width: min(520px, calc(100vw - 16px)); padding: 10px 14px 12px;
    background: var(--bg); border: 1px solid var(--line); border-radius: 12px; box-shadow: var(--shadow);
    pointer-events: none; visibility: hidden;
  }
  .peek .text { max-height: 45vh; overflow: hidden; font-size: 17px; line-height: 1.45; }
  .hl.show, .peek.show { visibility: visible; }

  /* Sheets: the selection card and the menu */
  .backdrop { inset: 0; background: rgba(10, 12, 20, .38); pointer-events: auto; display: none; }
  .backdrop.show { display: block; animation: fade .16s ease-out; }
  .sheet {
    left: 0; right: 0; margin: 0 auto; max-width: 560px; display: none; flex-direction: column;
    background: var(--bg); box-shadow: var(--shadow); pointer-events: auto;
    padding-left: env(safe-area-inset-left); padding-right: env(safe-area-inset-right);
  }
  .sheet.show { display: flex; }
  .sheet.bottom {
    bottom: 0; border-radius: 18px 18px 0 0; padding-bottom: env(safe-area-inset-bottom);
    animation: up .2s cubic-bezier(.2, .8, .3, 1);
  }
  .sheet.top {
    top: 0; border-radius: 0 0 18px 18px; padding-top: env(safe-area-inset-top);
    animation: down .2s cubic-bezier(.2, .8, .3, 1);
  }
  .card { max-height: 46vh; max-height: 46dvh; border: 1px solid var(--line); }
  .menu { max-height: 88vh; max-height: 88dvh; }
  .scroll { overflow-y: auto; overscroll-behavior: contain; -webkit-overflow-scrolling: touch; padding: 0 18px 18px; }
  .head {
    flex: none; display: flex; align-items: center; justify-content: space-between; gap: 8px;
    min-height: 48px; padding: 4px 8px 0 18px; touch-action: none;
  }
  .head .title { font-weight: 700; font-size: 17px; }
  .icon-btn { flex: none; width: 44px; height: 44px; border-radius: 50%; display: grid; place-items: center; color: var(--muted); font-size: 24px; line-height: 1; }
  .icon-btn:active { background: var(--soft); }
  @keyframes fade { from { opacity: 0; } }
  @keyframes up { from { transform: translateY(24px); opacity: 0; } }
  @keyframes down { from { transform: translateY(-24px); opacity: 0; } }

  .translation { font-size: 18px; line-height: 1.45; overflow-wrap: anywhere; -webkit-user-select: text; user-select: text; }
  .btn {
    display: flex; align-items: center; justify-content: center; gap: 6px; width: 100%; min-height: 46px; margin-top: 14px;
    padding: 8px 14px; border-radius: 12px; background: var(--accent-soft); color: var(--accent); font-weight: 600; text-align: center;
  }
  .btn.primary { background: var(--accent); color: var(--accent-fg); }
  .btn:active { filter: brightness(.95); }
  .btn:disabled { opacity: .5; }

  .grammar { border-top: 1px solid var(--line); margin-top: 14px; padding-top: 12px; display: grid; gap: 12px; }
  .sentence { margin: 0; padding: 10px 12px; border-radius: 10px; background: var(--soft); font-size: 17px; line-height: 1.75; overflow-wrap: anywhere; }
  .sentence mark {
    color: inherit; padding: 1px 2px; border-radius: 4px;
    background: color-mix(in srgb, var(--c) 18%, transparent); box-shadow: inset 0 -2px 0 var(--c);
  }
  .sentence sup { font-size: 11px; font-weight: 700; color: var(--c); margin-left: 1px; line-height: 0; }
  .points { list-style: none; margin: 0; padding: 0; display: grid; gap: 14px; }
  .point { display: grid; grid-template-columns: 22px 1fr; gap: 10px; }
  .num { width: 22px; height: 22px; border-radius: 50%; margin-top: 1px; background: var(--c); color: #fff; display: grid; place-items: center; font-size: 12px; font-weight: 700; }
  .point-title { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 8px; font-weight: 600; }
  .snippet { font-weight: 500; font-size: 15px; color: var(--c); }
  .point p { margin: 2px 0 0; }
  .vocab { margin: 0; display: grid; grid-template-columns: minmax(0, max-content) 1fr; gap: 4px 16px; }
  .vocab dt { font-weight: 600; }
  .vocab dd { margin: 0; color: var(--muted); }

  /* Menu */
  .seg { display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; gap: 4px; padding: 4px; border-radius: 14px; background: var(--soft); margin: 6px 0 10px; }
  .seg button { min-height: 46px; border-radius: 11px; font-weight: 600; color: var(--muted); padding: 4px 8px; }
  .seg button[aria-checked="true"] { background: var(--bg); color: var(--accent); box-shadow: 0 1px 4px rgba(16, 24, 40, .16); }
  .seg button:disabled { opacity: .5; }
  .group { border: 1px solid var(--line); border-radius: 14px; margin: 14px 0 0; overflow: hidden; }
  .group-title { font-size: 13px; font-weight: 600; color: var(--muted); margin: 20px 4px -8px; }
  .row { display: flex; align-items: center; justify-content: space-between; gap: 12px; width: 100%; min-height: 50px; padding: 8px 14px; text-align: start; }
  .row + .row { border-top: 1px solid var(--line); }
  .row > span:first-child { flex: 1 1 auto; min-width: 0; overflow-wrap: anywhere; }
  .row small { display: block; font-size: 13px; line-height: 1.35; color: var(--muted); }
  .row .value { flex: none; color: var(--accent); font-weight: 600; }
  select {
    font: inherit; color: var(--accent); background: transparent; border: 0; max-width: 58%; min-height: 36px; text-align: end;
    text-overflow: ellipsis; appearance: none; -webkit-appearance: none; text-align-last: end; padding: 0; margin: 0;
  }
  select option { color: #1d2030; background: #fff; }
  .switch { flex: none; position: relative; width: 50px; height: 30px; border-radius: 999px; background: var(--line); transition: background-color .15s; }
  .switch::after {
    content: ""; position: absolute; top: 3px; left: 3px; width: 24px; height: 24px; border-radius: 50%; background: #fff;
    box-shadow: 0 1px 3px rgba(0, 0, 0, .3); transition: transform .15s;
  }
  [aria-checked="true"] > .switch { background: var(--accent); }
  [aria-checked="true"] > .switch::after { transform: translateX(20px); }
  .note { margin: 8px 4px 0; }
  .note a { color: var(--accent); }
  .intro { margin: 2px 0 4px; }
  .steps { margin: 14px 0 0; padding: 0; list-style: none; display: grid; gap: 9px; }
  .steps li { display: grid; grid-template-columns: 26px 1fr; gap: 8px; }

  /* Toast */
  .toast {
    left: 50%; top: calc(16px + env(safe-area-inset-top)); transform: translate(-50%, -6px); max-width: calc(100vw - 32px); width: max-content;
    padding: 10px 16px; border-radius: 20px; background: #1d2030; color: #fff; font-size: 15px; font-weight: 500; line-height: 1.35; text-align: center;
    box-shadow: var(--shadow); pointer-events: none; opacity: 0; transition: opacity .16s ease, transform .16s ease;
  }
  .toast.show { opacity: 1; transform: translate(-50%, 0); }

  @media (prefers-reduced-motion: reduce) {
    .sheet, .backdrop { animation: none !important; }
    .pill, .toast, .switch, .switch::after { transition: none; }
  }
`;

  // src/page/ui.js
  function h(tag, props = {}, ...children) {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (value == null || value === false) continue;
      if (key === "class") el.className = value;
      else if (key === "color") el.style.setProperty("--c", value);
      else if (key.startsWith("on")) el.addEventListener(key.slice(2), value);
      else el.setAttribute(key, value === true ? "" : value);
    }
    el.append(...children.flat(Infinity).filter((c) => c != null && c !== false));
    return el;
  }
  var skeleton = (lines) => h("div", { class: "skeleton" }, Array.from({ length: lines }, () => h("i")));
  var colorOf = (i) => COLORS[i % COLORS.length];
  var clamp = (v, lo, hi) => Math.max(lo, Math.min(v, hi));
  var SHIELDED = [
    "click",
    "dblclick",
    "contextmenu",
    "touchstart",
    "touchmove",
    "touchend",
    "pointerdown",
    "pointermove",
    "pointerup",
    "mousedown",
    "mouseup",
    "keydown",
    "keyup",
    "keypress",
    "input",
    "change",
    "focusin",
    "focusout",
    "wheel"
  ];
  function createUI() {
    const host = document.createElement("immersion-ui");
    host.setAttribute("translate", "no");
    host.style.cssText = "all: initial !important; position: fixed !important; top: 0 !important; left: 0 !important; width: 0 !important; height: 0 !important; z-index: 2147483647 !important; pointer-events: none !important;";
    for (const type of SHIELDED) host.addEventListener(type, (e) => e.stopPropagation());
    const shadow = host.attachShadow({ mode: "closed" });
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(CSS);
      shadow.adoptedStyleSheets = [sheet];
    } catch {
      shadow.append(h("style", {}, CSS));
    }
    const hlEl = h("div", { class: "layer hl" });
    const peekEl = h("div", { class: "layer peek", role: "tooltip" });
    const pillEl = h("button", { class: "layer pill", type: "button" });
    const cardEl = h("div", { class: "layer sheet card bottom", role: "dialog", "aria-label": "Translation" });
    const backdropEl = h("div", { class: "layer backdrop" });
    const menuEl = h("div", { class: "layer sheet menu bottom", role: "dialog", "aria-modal": "true", "aria-label": "Immersion" });
    const toastEl = h("div", { class: "layer toast", role: "status" });
    shadow.append(h("div", { class: "root" }, hlEl, peekEl, pillEl, cardEl, backdropEl, menuEl, toastEl));
    let remounts = 0;
    const mount = () => document.documentElement.append(host);
    new MutationObserver(() => {
      if (!host.isConnected && remounts++ < 20) mount();
    }).observe(document.documentElement, { childList: true });
    mount();
    function showPeek(rect, { label, text, loading, error, lang }) {
      peekEl.replaceChildren(
        h("div", { class: "label" }, label),
        loading ? skeleton(2) : h("div", { class: error ? "text error" : "text", lang: error ? null : lang, dir: "auto" }, error || text)
      );
      peekEl.classList.add("show");
      hlEl.classList.add("show");
      movePeek(rect);
    }
    function movePeek(rect) {
      const pad = 3;
      Object.assign(hlEl.style, {
        left: `${rect.left - pad}px`,
        top: `${rect.top - pad}px`,
        width: `${rect.width + pad * 2}px`,
        height: `${rect.height + pad * 2}px`
      });
      const margin = 8;
      peekEl.style.left = `${clamp(rect.left, margin, Math.max(margin, innerWidth - peekEl.offsetWidth - margin))}px`;
      peekEl.style.top = `${Math.max(margin, rect.top - 10 - peekEl.offsetHeight)}px`;
    }
    function hidePeek() {
      peekEl.classList.remove("show");
      hlEl.classList.remove("show");
    }
    const closeButton = (onclick) => h("button", { class: "icon-btn", type: "button", "aria-label": "Close", onclick }, "×");
    function swipeToClose(head, el, close) {
      let startY = null;
      head.addEventListener("touchstart", (e) => startY = e.touches[0].clientY, { passive: true });
      head.addEventListener(
        "touchmove",
        (e) => {
          if (startY == null) return;
          const away = el.classList.contains("top") ? -1 : 1;
          const distance = (e.touches[0].clientY - startY) * away;
          el.style.transform = distance > 0 ? `translateY(${distance * away}px)` : "";
        },
        { passive: true }
      );
      const end = (e) => {
        if (startY == null) return;
        const distance = (e.changedTouches[0].clientY - startY) * (el.classList.contains("top") ? -1 : 1);
        startY = null;
        el.style.transform = "";
        if (e.type === "touchend" && distance > 50) close();
      };
      head.addEventListener("touchend", end);
      head.addEventListener("touchcancel", end);
    }
    let card = null;
    function openCard({ rect, label, lang, onGrammar, onSettings }) {
      const translation = h("div", { class: "translation", lang, dir: "auto" }, skeleton(2));
      const grammar = h("button", { class: "btn", type: "button", onclick: onGrammar }, "✦ Grammar tips");
      const head = h("div", { class: "head" }, h("div", { class: "label" }, label), closeButton(closeCard));
      const reopening = !!card;
      if (!reopening) {
        const top = rect.top + rect.height / 2 > innerHeight * 0.55;
        cardEl.classList.toggle("top", top);
        cardEl.classList.toggle("bottom", !top);
      }
      swipeToClose(head, cardEl, closeCard);
      cardEl.replaceChildren(head, h("div", { class: "scroll" }, translation, grammar));
      card = { translation, grammar, onSettings };
      cardEl.classList.add("show");
    }
    function setCardTranslation({ text, error }) {
      card?.translation.replaceChildren(error ? h("p", { class: "error" }, error) : text);
    }
    function setCardGrammar({ loading, error, needsKey, sentence, lang, points = [], vocabulary = [] }) {
      if (!card) return;
      const { onSettings } = card;
      let content;
      if (loading) {
        content = [h("div", { class: "label" }, "Grammar"), skeleton(4)];
      } else if (error) {
        content = [h("p", { class: "error" }, error), needsKey && h("button", { class: "btn", type: "button", onclick: onSettings }, "Open settings")];
      } else {
        content = renderGrammar(sentence, lang, points, vocabulary);
      }
      const section = h("div", { class: "grammar" }, content);
      card.grammar.replaceWith(section);
      card.grammar = section;
    }
    function closeCard() {
      card = null;
      cardEl.classList.remove("show");
    }
    let menuOpenedAt = 0;
    let onMenuClose = null;
    function openMenu({ title, content, onBack, onClose }) {
      const wasOpen = isMenuOpen();
      const scrollTop = wasOpen ? menuEl.querySelector(".scroll")?.scrollTop : 0;
      const sameView = menuEl.dataset.title === title;
      const head = h(
        "div",
        { class: "head" },
        onBack && h("button", { class: "icon-btn", type: "button", "aria-label": "Back", onclick: onBack }, "‹"),
        h("div", { class: "title" }, title),
        closeButton(closeMenu)
      );
      swipeToClose(head, menuEl, closeMenu);
      menuEl.replaceChildren(head, h("div", { class: "scroll" }, content));
      menuEl.dataset.title = title;
      onMenuClose = onClose || null;
      if (wasOpen && sameView) menuEl.querySelector(".scroll").scrollTop = scrollTop;
      if (!wasOpen) {
        menuOpenedAt = performance.now();
        menuEl.classList.add("show");
        backdropEl.classList.add("show");
      }
    }
    const isMenuOpen = () => menuEl.classList.contains("show");
    function closeMenu() {
      if (!isMenuOpen()) return;
      menuEl.classList.remove("show");
      backdropEl.classList.remove("show");
      const callback = onMenuClose;
      onMenuClose = null;
      callback?.();
    }
    backdropEl.addEventListener("click", () => {
      if (performance.now() - menuOpenedAt > 400) closeMenu();
    });
    backdropEl.addEventListener("touchmove", (e) => e.preventDefault(), { passive: false });
    let toastTimer = 0;
    function toast(text, ms = 1600) {
      toastEl.textContent = text;
      toastEl.classList.add("show");
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => toastEl.classList.remove("show"), ms);
    }
    return {
      pillEl,
      showPeek,
      movePeek,
      hidePeek,
      openCard,
      setCardTranslation,
      setCardGrammar,
      closeCard,
      isCardOpen: () => !!card,
      openMenu,
      closeMenu,
      isMenuOpen,
      toast,
      owns: (event) => event.composedPath().includes(host)
    };
  }
  function renderGrammar(sentence, lang, points, vocabulary) {
    const out = [
      h("div", {}, h("div", { class: "label" }, "Grammar"), h("p", { class: "sentence", lang, dir: "auto" }, highlight(sentence, points)))
    ];
    if (points.length) {
      out.push(
        h(
          "ol",
          { class: "points" },
          points.map(
            (p, i) => h(
              "li",
              { class: "point", color: colorOf(i) },
              h("span", { class: "num" }, String(i + 1)),
              h(
                "div",
                {},
                h("div", { class: "point-title" }, String(p.title), p.snippet && h("span", { class: "snippet", lang }, String(p.snippet))),
                h("p", {}, String(p.explanation ?? ""))
              )
            )
          )
        )
      );
    } else {
      out.push(h("p", { class: "muted" }, "Nothing special to note here."));
    }
    if (vocabulary.length) {
      out.push(
        h(
          "div",
          {},
          h("div", { class: "label" }, "Vocabulary"),
          h("dl", { class: "vocab" }, vocabulary.map((v) => [h("dt", { lang }, String(v.term)), h("dd", {}, String(v.meaning ?? ""))]))
        )
      );
    }
    return out;
  }
  function highlight(sentence, points) {
    const lower = sentence.toLowerCase();
    const marks = [];
    points.forEach((p, i) => {
      const snippet = String(p.snippet || "").trim().toLowerCase();
      if (!snippet) return;
      let at = lower.indexOf(snippet);
      while (at >= 0 && marks.some((m) => at < m.end && at + snippet.length > m.start)) at = lower.indexOf(snippet, at + 1);
      if (at >= 0) marks.push({ start: at, end: at + snippet.length, i });
    });
    marks.sort((a, b) => a.start - b.start);
    const parts = [];
    let pos = 0;
    for (const m of marks) {
      parts.push(sentence.slice(pos, m.start));
      parts.push(h("mark", { color: colorOf(m.i) }, sentence.slice(m.start, m.end)));
      parts.push(h("sup", { color: colorOf(m.i) }, String(m.i + 1)));
      pos = m.end;
    }
    parts.push(sentence.slice(pos));
    return parts;
  }

  // src/page/pill.js
  var SIZE = 48;
  var EDGE = 12;
  var LONG_PRESS_MS = 450;
  var DRAG_PX = 10;
  function createPill(el, { position, onTap, onLongPress, onMove }) {
    let pos = { ...position };
    let press = null;
    let sleepTimer = 0;
    const maxTop = () => Math.max(EDGE, innerHeight - SIZE - EDGE);
    const clampTop = (top) => Math.max(EDGE, Math.min(top, maxTop()));
    function layout() {
      if (press?.dragging) return;
      el.style.top = `${clampTop(pos.y * innerHeight - SIZE / 2)}px`;
      el.style.left = `${pos.side === "left" ? EDGE : document.documentElement.clientWidth - SIZE - EDGE}px`;
    }
    function wake(ms = 2200) {
      el.classList.add("awake");
      clearTimeout(sleepTimer);
      sleepTimer = setTimeout(() => el.classList.remove("awake"), ms);
    }
    function update({ mode, lang, label, busy, error }) {
      el.classList.toggle("target", mode === "target");
      el.classList.toggle("off", mode === "off");
      el.classList.toggle("busy", busy && mode !== "off");
      el.classList.toggle("failed", !!error && mode !== "off");
      el.textContent = mode === "off" ? "⏸︎" : lang.slice(0, 2).toUpperCase();
      el.setAttribute("aria-label", label);
    }
    function release() {
      clearTimeout(press?.timer);
      press = null;
      el.classList.remove("pressed");
    }
    el.addEventListener("pointerdown", (e) => {
      if (!e.isPrimary || e.button) return;
      e.preventDefault();
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
      }
      const box = el.getBoundingClientRect();
      wake();
      el.classList.add("pressed");
      press = { id: e.pointerId, x: e.clientX, y: e.clientY, dx: e.clientX - box.left, dy: e.clientY - box.top, dragging: false, long: false };
      press.timer = setTimeout(() => {
        if (!press || press.dragging) return;
        press.long = true;
        el.classList.remove("pressed");
        onLongPress();
      }, LONG_PRESS_MS);
    });
    el.addEventListener("pointermove", (e) => {
      if (!press || e.pointerId !== press.id || press.long) return;
      if (!press.dragging && Math.hypot(e.clientX - press.x, e.clientY - press.y) < DRAG_PX) return;
      press.dragging = true;
      clearTimeout(press.timer);
      wake();
      el.style.left = `${e.clientX - press.dx}px`;
      el.style.top = `${clampTop(e.clientY - press.dy)}px`;
    });
    el.addEventListener("pointerup", (e) => {
      if (!press || e.pointerId !== press.id) return;
      const { dragging, long } = press;
      release();
      if (dragging) {
        const box = el.getBoundingClientRect();
        pos = { side: box.left + SIZE / 2 < innerWidth / 2 ? "left" : "right", y: (box.top + SIZE / 2) / innerHeight };
        layout();
        onMove(pos);
      } else if (!long) {
        onTap();
      }
    });
    el.addEventListener("pointercancel", () => {
      release();
      layout();
    });
    for (const type of ["touchstart", "touchend", "contextmenu"]) {
      el.addEventListener(type, (e) => e.cancelable && e.preventDefault(), { passive: false });
    }
    el.addEventListener("click", (e) => e.detail === 0 && onTap());
    addEventListener("resize", layout);
    layout();
    wake(4e3);
    return {
      update,
      wake,
      setPosition(next) {
        pos = { ...next };
        layout();
      }
    };
  }

  // src/page/menu.js
  function createMenu({ ui, engine, platform, getSettings, save, toggleMode, host }) {
    let modelsSeq = 0;
    const group = (...rows) => h("div", { class: "group" }, rows);
    const groupTitle = (text2) => h("div", { class: "group-title" }, text2);
    const text = (title, detail) => h("span", {}, title, detail && h("small", {}, detail));
    const toggleRow = (title, detail, on, onchange) => h(
      "button",
      { class: "row", type: "button", role: "switch", "aria-checked": String(on), onclick: () => onchange(!on) },
      text(title, detail),
      h("span", { class: "switch" })
    );
    const buttonRow = (title, detail, value, onclick) => h("button", { class: "row", type: "button", onclick }, text(title, detail), h("span", { class: "value" }, value));
    function selectRow(title, options, selected, onchange) {
      const select = h("select", { "aria-label": title, onchange: (e) => onchange(e.target.value) });
      select.append(...options.map(([value, label]) => new Option(label, value, false, value === selected)));
      return h("label", { class: "row" }, h("span", {}, title), select);
    }
    function languageRow(title, which, after) {
      const options = LANGUAGES.map((code) => {
        const name = langName(code);
        const own = endonym(code);
        return [code, name.toLowerCase() === own.toLowerCase() ? name : `${name} · ${own}`];
      }).sort((a, b) => a[1].localeCompare(b[1]));
      return selectRow(title, options, getSettings()[which], async (code) => {
        await save(pickLanguage(getSettings(), which, code));
        after();
      });
    }
    const languages = (after) => group(languageRow("I'm learning", "target", after), languageRow("I speak", "native", after));
    function keyRow(label, keyName, after) {
      const saved = !!getSettings()[keyName];
      return buttonRow(`${label} key`, saved ? "Saved on this phone" : "Not set", saved ? "Change" : "Add", async () => {
        const value = platform.askSecret(`Paste your ${label} API key.${saved ? " Leave this empty to remove the saved one." : ""}`);
        if (value == null) return;
        await save({ [keyName]: value.trim() });
        after();
      });
    }
    function showWelcome() {
      const start2 = async () => {
        await save({ onboarded: true });
        ui.closeMenu();
      };
      ui.openMenu({
        title: "Welcome to Immersion",
        content: [
          h("p", { class: "intro muted" }, "Websites will appear in the language you’re learning."),
          languages(showWelcome),
          h(
            "ul",
            { class: "steps" },
            h("li", {}, h("span", {}, "🔁"), h("span", {}, "Tap the round button to switch languages. Hold it for the menu, or drag it out of the way.")),
            h("li", {}, h("span", {}, "👀"), h("span", {}, "Rest two fingers on a paragraph to peek at it in your own language.")),
            h("li", {}, h("span", {}, "✨"), h("span", {}, "Select text for its translation and grammar tips."))
          ),
          h("p", { class: "note muted small" }, "The text of pages you read is sent to Google Translate. Pause Immersion on sites you want to keep private, like banking or email."),
          h("button", { class: "btn primary", type: "button", onclick: start2 }, "Start")
        ]
      });
    }
    function statusText() {
      const s = getSettings();
      const { mode, pageLang, busy, error } = engine.state();
      if (!s.enabled) return "Immersion is turned off.";
      if (s.pausedSites.includes(host)) return "Paused on this site.";
      if (error) return error;
      if (busy) return "Translating…";
      if (mode === "target" && sameLang(pageLang, s.target)) return `This page is already in ${langName(s.target)}.`;
      return "";
    }
    function showMain() {
      const s = getSettings();
      if (!s.onboarded) return showWelcome();
      const mode = engine.mode();
      const paused = s.pausedSites.includes(host);
      const status = statusText();
      const failed = mode !== "off" && !!engine.state().error;
      const seg = (which) => h(
        "button",
        {
          type: "button",
          role: "radio",
          "aria-checked": String(mode === which),
          disabled: mode === "off",
          onclick: () => {
            if (engine.mode() !== which) toggleMode();
            ui.closeMenu();
          }
        },
        langName(s[which])
      );
      ui.openMenu({
        title: "Immersion",
        content: [
          h("div", { class: "seg", role: "radiogroup", "aria-label": "Page language" }, seg("target"), seg("native")),
          status && h("p", { class: failed ? "error small" : "muted small" }, status),
          failed && h("button", { class: "btn", type: "button", onclick: () => (engine.retry(), ui.closeMenu()) }, "Try again"),
          languages(showMain),
          group(
            toggleRow("Pause on this site", host, paused, async (on) => {
              const sites = new Set(getSettings().pausedSites);
              if (on) sites.add(host);
              else sites.delete(host);
              await save({ pausedSites: [...sites] });
              showMain();
            }),
            toggleRow("Immersion", "Turn off to stop translating everywhere", s.enabled, async (on) => {
              await save({ enabled: on });
              showMain();
            })
          ),
          group(buttonRow("Settings", null, "›", showSettings))
        ]
      });
    }
    function showSettings() {
      const s = getSettings();
      const provider = AI_PROVIDERS[s.aiProvider] ? s.aiProvider : "gemini";
      const info = AI_PROVIDERS[provider];
      const modelRow = selectRow("Model", [], "", (id) => save({ aiModels: { ...getSettings().aiModels, [provider]: id } }));
      const modelSelect = modelRow.querySelector("select");
      const modelStatus = h("p", { class: "note muted small", role: "status" });
      ui.openMenu({
        title: "Settings",
        onBack: showMain,
        onClose: () => modelsSeq++,
        content: [
          groupTitle("Translation"),
          group(
            selectRow("Service", [["google", "Google Translate"], ["deepl", "DeepL"]], s.provider, async (value) => {
              await save({ provider: value });
              showSettings();
            }),
            s.provider === "deepl" && keyRow("DeepL", "deeplKey", showSettings)
          ),
          s.provider === "deepl" && h("p", { class: "note muted small" }, s.deeplKey ? "The free plan includes 500,000 characters a month." : "Google Translate is used until you add a key."),
          groupTitle("Grammar tips"),
          group(
            selectRow("AI service", Object.entries(AI_PROVIDERS).map(([id, p]) => [id, `${p.label} (${p.cost})`]), provider, async (id) => {
              await save({ aiProvider: id });
              showSettings();
            }),
            keyRow(info.label, info.keyName, showSettings),
            modelRow
          ),
          modelStatus,
          h("p", { class: "note muted small" }, h("a", { href: info.keyUrl, target: "_blank", rel: "noopener noreferrer" }, `Get a key from ${info.label}`), ` · ${info.note}`),
          groupTitle("Reading"),
          group(
            toggleRow("Card when I select text", "Shows the translation and grammar tips", s.selectPopup, async (on) => {
              await save({ selectPopup: on });
              showSettings();
            })
          ),
          s.pausedSites.length > 0 && groupTitle("Paused sites"),
          s.pausedSites.length > 0 && group(
            s.pausedSites.map(
              (site) => buttonRow(site, null, "Resume", async () => {
                await save({ pausedSites: getSettings().pausedSites.filter((x) => x !== site) });
                showSettings();
              })
            )
          ),
          groupTitle("Storage"),
          group(
            buttonRow("Saved translations", "Kept on this phone to avoid repeat requests", "Clear", async () => {
              await platform.cache.clear();
              ui.toast("Cleared");
            })
          ),
          h("p", { class: "note muted small" }, "Keys stay in the Userscripts app on this phone and are only sent to the service they belong to.")
        ]
      });
      loadModels(provider, modelSelect, modelStatus);
    }
    async function loadModels(provider, select, status) {
      const seq = ++modelsSeq;
      const info = AI_PROVIDERS[provider];
      const s = getSettings();
      const key = (s[info.keyName] || "").trim();
      const chosen = s.aiModels?.[provider];
      const fill = (models) => {
        const list = chosen && !models.some((m) => m.id === chosen) ? [{ id: chosen }, ...models] : models;
        select.replaceChildren(...list.map((m) => new Option(m.free ? `${m.id} (free)` : m.id, m.id, false, m.id === chosen)));
      };
      const say = (message, isError = false) => {
        status.textContent = message;
        status.className = `note small ${isError ? "error" : "muted"}`;
      };
      fill(info.models.map((id) => ({ id })));
      if (!key && provider !== "openrouter") return say(`Add your ${info.label} key to load its full model list.`);
      say("Loading models…");
      try {
        const live = await listModels(provider, key, platform.fetch);
        if (seq !== modelsSeq) return;
        if (!live.length) return say(`${info.label} didn't list any models.`, true);
        const byId = new Map(live.map((m) => [m.id, m]));
        fill([...info.models.filter((id) => byId.has(id)).map((id) => byId.get(id)), ...live.filter((m) => !info.models.includes(m.id))]);
        const free = live.filter((m) => m.free).length;
        const count = `${live.length} models${free ? `, ${free} free` : ""}`;
        say(key ? `✓ Key works · ${count}` : `${count} · add your key to use them`);
      } catch (err) {
        if (seq === modelsSeq) say(err.message, true);
      }
    }
    return { showMain, showSettings, showWelcome };
  }

  // src/page/touch.js
  var PEEK_DELAY_MS = 180;
  var PEEK_SLOP_PX = 14;
  var SELECTION_SETTLE_MS = 450;
  var MAX_SELECTION = 1200;
  function setupTouch({ engine, ui, getSettings, explain, openSettings }) {
    const otherLabel = () => langName(engine.otherLang());
    let peek = null;
    let peekSeq = 0;
    const pointsOf = (touches) => [...touches].slice(0, 2).map((t) => ({ x: t.clientX, y: t.clientY }));
    const middle = ([a, b]) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    const moved = (a, b) => a.some((p, i) => Math.hypot(p.x - b[i].x, p.y - b[i].y) > PEEK_SLOP_PX);
    function caretNode(x, y) {
      if (document.caretRangeFromPoint) return document.caretRangeFromPoint(x, y)?.startContainer;
      return document.caretPositionFromPoint?.(x, y)?.offsetNode;
    }
    function textAt({ x, y }) {
      const node = caretNode(x, y);
      if (!node || node.nodeType !== Node.TEXT_NODE) return null;
      const range = document.createRange();
      range.selectNodeContents(node);
      const slop = 8;
      for (const r of range.getClientRects()) {
        if (x >= r.left - slop && x <= r.right + slop && y >= r.top - slop && y <= r.bottom + slop) return node;
      }
      return null;
    }
    function blockAt(points) {
      for (const point of [middle(points), ...points]) {
        const node = textAt(point);
        const block2 = node && blockOf(node);
        if (block2 && block2 !== document.body) return block2;
      }
      return null;
    }
    async function showPeek() {
      const block2 = blockAt(peek.points);
      if (!block2 || block2 === peek.block) return;
      peek.block = block2;
      const seq = ++peekSeq;
      const lang = engine.otherLang();
      const label = otherLabel();
      ui.showPeek(block2.getBoundingClientRect(), { label, loading: true });
      try {
        const text = await engine.textOf(block2, lang);
        if (seq !== peekSeq) return;
        if (text) ui.showPeek(block2.getBoundingClientRect(), { label, text, lang });
        else ui.hidePeek();
      } catch (err) {
        if (seq === peekSeq) ui.showPeek(block2.getBoundingClientRect(), { label, error: err.message });
      }
    }
    function endPeek() {
      clearTimeout(peek?.timer);
      peek = null;
      peekSeq++;
      ui.hidePeek();
    }
    function onTouchStart(e) {
      touching = e.touches.length;
      if (touching === 1) tap = { ...pointsOf(e.touches)[0], at: e.timeStamp, owned: ui.owns(e) };
      else tap = null;
      if (peek) endPeek();
      if (touching !== 2 || engine.mode() === "off" || ui.owns(e) || ui.isMenuOpen()) return;
      block(true);
      const points = pointsOf(e.touches);
      peek = { start: points, points, shown: false, block: null };
      peek.timer = setTimeout(() => {
        if (!peek) return;
        peek.shown = true;
        showPeek();
      }, PEEK_DELAY_MS);
    }
    function onTouchMove(e) {
      if (!peek || e.touches.length !== 2) return;
      const points = pointsOf(e.touches);
      if (!peek.shown) {
        if (moved(points, peek.start)) endPeek();
        return;
      }
      peek.points = points;
      showPeek();
    }
    function onTouchEnd(e) {
      touching = e.touches.length;
      if (peek) {
        if (peek.shown) swallowUntil = e.timeStamp + 400;
        endPeek();
      } else if (e.type === "touchend" && tap && !touching) {
        const end = e.changedTouches[0];
        const still = Math.hypot(end.clientX - tap.x, end.clientY - tap.y) < 10;
        if (still && !tap.owned && e.timeStamp - tap.at < 350) ui.closeCard();
      }
      if (!touching) {
        tap = null;
        setTimeout(() => !touching && block(false), 0);
      }
    }
    function block(on) {
      const change = on ? addEventListener : removeEventListener;
      for (const type of ["touchmove", "touchend", "touchcancel", "gesturestart", "gesturechange"]) {
        change.call(window, type, cancelDuringPeek, { capture: true, passive: false });
      }
    }
    function cancelDuringPeek(e) {
      if ((peek?.shown || e.timeStamp < swallowUntil) && e.cancelable) e.preventDefault();
    }
    function onScroll() {
      if (peek?.shown && peek.block) ui.movePeek(peek.block.getBoundingClientRect());
    }
    let touching = 0;
    let tap = null;
    let swallowUntil = 0;
    let selectionTimer = 0;
    let cardText = "";
    let cardSeq = 0;
    const isEditable = (el) => !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName || ""));
    function contextFor(range, text) {
      const block2 = blockOf(range.commonAncestorContainer);
      if (!block2) return "";
      const full = tidy(block2.innerText || block2.textContent || "");
      if (full.length <= 1200) return full;
      const at = Math.max(0, full.indexOf(text));
      return full.slice(Math.max(0, at - 500), at + text.length + 500);
    }
    function selectionInfo() {
      const selection = getSelection();
      if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
      const text = tidy(selection.toString());
      if (!text || text.length > MAX_SELECTION || !hasLetters(text)) return null;
      if (isEditable(document.activeElement)) return null;
      const range = selection.getRangeAt(0).cloneRange();
      const base = range.commonAncestorContainer;
      const el = base.nodeType === Node.ELEMENT_NODE ? base : base.parentElement;
      if (!el || el.closest('immersion-ui, input, textarea, [contenteditable]:not([contenteditable="false"])')) return null;
      const rect = range.getBoundingClientRect();
      if (!rect.width && !rect.height) return null;
      return { text, rect, context: contextFor(range, text) };
    }
    function openCard({ text, rect, context }) {
      const seq = ++cardSeq;
      cardText = text;
      const toLang = engine.otherLang();
      const { target } = getSettings();
      const learning = engine.mode() === "target";
      const translation = engine.translateTexts([text], toLang).then(([r]) => sameLang(r.from, toLang) ? text : r.text);
      ui.openCard({
        rect,
        label: langName(toLang),
        lang: toLang,
        onSettings: () => {
          ui.closeCard();
          openSettings();
        },
        onGrammar: async () => {
          ui.setCardGrammar({ loading: true });
          try {
            const sentence = learning ? text : await translation;
            const result = await explain({ text: sentence, context: learning ? context : "" });
            if (seq === cardSeq) ui.setCardGrammar({ sentence, lang: target, ...result });
          } catch (err) {
            if (seq === cardSeq) ui.setCardGrammar({ error: err.message, needsKey: err.code === "NO_KEY" });
          }
        }
      });
      translation.then(
        (result) => seq === cardSeq && ui.setCardTranslation({ text: result }),
        (err) => seq === cardSeq && ui.setCardTranslation({ error: err.message })
      );
    }
    function onSelectionChange() {
      clearTimeout(selectionTimer);
      if (engine.mode() === "off" || !getSettings().selectPopup) return;
      selectionTimer = setTimeout(() => {
        if (touching) return onSelectionChange();
        if (ui.isMenuOpen()) return;
        const info = selectionInfo();
        if (info && !(ui.isCardOpen() && info.text === cardText)) openCard(info);
      }, SELECTION_SETTLE_MS);
    }
    const passive = { capture: true, passive: true };
    addEventListener("touchstart", onTouchStart, passive);
    for (const type of ["touchend", "touchcancel"]) addEventListener(type, onTouchEnd, passive);
    addEventListener("touchmove", onTouchMove, passive);
    addEventListener("scroll", onScroll, passive);
    addEventListener("blur", (e) => e.target === window && endPeek(), true);
    document.addEventListener("selectionchange", onSelectionChange);
    return {
      /** Close anything that shows text in the previous language. */
      reset() {
        endPeek();
        ui.closeCard();
        cardSeq++;
      }
    };
  }

  // src/main.js
  async function start() {
    if (window.top !== window || !document.body || document.contentType !== "text/html") return;
    if (document.querySelector("immersion-ui")) return;
    const platform = createPlatform();
    const host = location.hostname;
    let settings = withDefaults(await platform.loadSettings());
    let ready = false;
    function withDefaults(saved) {
      const merged = { ...DEFAULTS, ...saved };
      if (!saved.onboarded && !saved.native) {
        const own = normLang(navigator.language);
        merged.native = LANGUAGES.includes(own) ? own : "en";
        merged.target = merged.native === "es" ? "en" : "es";
      }
      return merged;
    }
    const getSettings = () => settings;
    const wantedMode = () => settings.onboarded && settings.enabled && !settings.pausedSites.includes(host) ? settings.mode : "off";
    const ui = createUI();
    const engine = createEngine({
      getSettings,
      translate: (texts, to, from) => translate(texts, to, from, settings, platform),
      onState: drawPill,
      onError: (err) => ui.toast(`Couldn't translate: ${err.message}`, 3500)
    });
    let saving = Promise.resolve();
    let unsaved = {};
    function save(patch) {
      Object.assign(unsaved, patch);
      const applied = apply({ ...settings, ...patch });
      saving = saving.then(async () => {
        const changes = unsaved;
        unsaved = {};
        if (!Object.keys(changes).length) return;
        try {
          await platform.saveSettings({ ...withDefaults(await platform.loadSettings()), ...changes });
        } catch {
          ui.toast("Couldn't save your settings.", 3e3);
        }
      });
      return Promise.all([applied, saving]);
    }
    async function apply(next) {
      const prev = settings;
      settings = next;
      pill.setPosition(settings.button);
      const mode = wantedMode();
      if (mode !== engine.mode()) touch.reset();
      if (mode !== "off" && !ready) {
        ready = true;
        drawPill();
        await engine.detectPageLang();
      }
      if (wantedMode() !== engine.mode()) engine.setMode(wantedMode());
      else if (prev.target !== settings.target || prev.native !== settings.native) {
        touch.reset();
        engine.languagesChanged();
      }
      drawPill();
    }
    async function sync() {
      if (document.hidden) return;
      try {
        await saving;
        await apply({ ...withDefaults(await platform.loadSettings()), ...unsaved });
      } catch {
      }
    }
    function toggleMode() {
      if (engine.mode() === "off") return menu.showMain();
      const mode = engine.mode() === "target" ? "native" : "target";
      save({ mode });
      ui.toast(`Showing ${langName(settings[mode])}`);
    }
    function drawPill() {
      const state = engine.state();
      const label = state.mode === "off" ? "Immersion is off on this page" : `Immersion: showing ${langName(state.lang)}. Tap to switch, hold for the menu.`;
      pill?.update({ ...state, label });
    }
    var pill = createPill(ui.pillEl, {
      position: settings.button,
      onTap: toggleMode,
      onLongPress: () => {
        ui.closeCard();
        menu.showMain();
      },
      onMove: (button) => save({ button })
    });
    const menu = createMenu({ ui, engine, platform, getSettings, save, toggleMode, host });
    const touch = setupTouch({
      engine,
      ui,
      getSettings,
      openSettings: menu.showSettings,
      explain: ({ text, context }) => explainGrammar({ text, context, native: settings.native, target: settings.target, settings }, platform)
    });
    drawPill();
    addEventListener("online", () => engine.state().error && engine.retry());
    addEventListener("pageshow", (e) => e.persisted && sync());
    document.addEventListener("visibilitychange", sync);
    await apply(settings);
    if (!settings.onboarded) menu.showWelcome();
  }
  start().catch((err) => console.error("Immersion:", err));
})();
