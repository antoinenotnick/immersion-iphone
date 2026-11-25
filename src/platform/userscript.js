/*
 * Everything that depends on where the code runs. A different host (for example a Safari extension
 * inside a native app) only needs to provide the same object:
 *
 *   fetch(url, { method, headers, body, timeout }) -> { ok, status, headers: { get }, json(), text() }
 *   cache: { getMany(keys), putMany(entries), clear() }
 *   loadSettings() -> object, saveSettings(object)
 *   askSecret(message) -> string, or null if cancelled
 *
 * This one uses the GM API of the Userscripts app for Safari.
 */
/* global GM */

const OFFLINE = "Couldn't connect. Check your internet connection.";
const named = (name, message) => Object.assign(new Error(message), { name });

/** A fetch-like function on top of GM.xmlHttpRequest, which isn't bound by the page's CSP or CORS. */
function gmFetch(url, { method = 'GET', headers = {}, body, timeout = 30_000 } = {}) {
  return new Promise((resolve, reject) => {
    const fail = (name, message) => {
      clearTimeout(timer);
      reject(named(name, message));
    };
    // iOS can suspend the app's background page mid-request, in which case no callback ever comes.
    const timer = setTimeout(() => fail('TimeoutError', 'The request timed out.'), timeout + 1000);
    const allHeaders = { ...headers };
    let data = body;
    if (body instanceof URLSearchParams) {
      data = body.toString();
      allHeaders['Content-Type'] = 'application/x-www-form-urlencoded;charset=UTF-8';
    }
    const details = {
      url,
      method,
      headers: allHeaders,
      timeout,
      responseType: 'text',
      onload(res) {
        if (!res.status) return fail('TypeError', OFFLINE);
        clearTimeout(timer);
        const text = String(res.responseText ?? res.response ?? '');
        resolve({
          ok: res.status >= 200 && res.status < 300,
          status: res.status,
          headers: { get: (name) => headerValue(res.responseHeaders, name) },
          text: async () => text,
          json: async () => JSON.parse(text),
        });
      },
      onerror: () => fail('TypeError', OFFLINE),
      ontimeout: () => fail('TimeoutError', 'The request timed out.'),
    };
    if (data != null) details.data = data;
    // Only the callbacks above are used; the returned promise may reject as well.
    Promise.resolve(GM.xmlHttpRequest(details)).catch(() => fail('TypeError', OFFLINE));
  });
}

function headerValue(raw, name) {
  const prefix = `${name.toLowerCase()}:`;
  const line = String(raw || '')
    .split(/\r?\n/)
    .find((l) => l.toLowerCase().startsWith(prefix));
  return line ? line.slice(prefix.length).trim() : null;
}

/*
 * Translation cache. Kept in the script's own storage rather than the website's, so sites can't read it.
 * Split into one shard per website (loaded only on that site) plus one for grammar tips.
 */
const MAX_SHARDS = 30;
const MAX_SHARD_CHARS = 250_000;
const GRAMMAR_SHARD = 'cache:*grammar';

function createCache(host) {
  const shards = new Map(); // storage key -> Promise<{ map, dirty, timer }>
  const loaded = new Map(); // the same shards, once loaded
  const shardOf = (key) => (key.startsWith('g|') ? GRAMMAR_SHARD : `cache:${host}`);

  async function load(id) {
    let map;
    try {
      map = new Map(JSON.parse(await GM.getValue(id, '[]')));
    } catch {
      map = new Map(); // a broken cache must never break translation
    }
    const shard = { map, dirty: false, timer: 0 };
    loaded.set(id, shard);
    return shard;
  }

  function open(id) {
    if (!shards.has(id)) shards.set(id, load(id));
    return shards.get(id);
  }

  /** The write itself goes out synchronously: when leaving a page there's no time to wait for anything. */
  async function save(id) {
    const shard = loaded.get(id);
    if (!shard) return;
    clearTimeout(shard.timer);
    shard.timer = 0;
    if (!shard.dirty) return;
    shard.dirty = false;
    // Newest entries are last: keep as many of those as fit.
    const kept = [];
    let chars = 0;
    for (const entry of [...shard.map].reverse()) {
      chars += entry[0].length + JSON.stringify(entry[1]).length;
      if (chars > MAX_SHARD_CHARS) break;
      kept.push(entry);
    }
    try {
      await GM.setValue(id, JSON.stringify(kept.reverse()));
      const index = JSON.parse(await GM.getValue('cache-index', '[]')).filter((x) => x !== id);
      index.push(id);
      while (index.length > MAX_SHARDS) await GM.deleteValue(index.shift());
      await GM.setValue('cache-index', JSON.stringify(index));
    } catch {
      /* storage full or unavailable */
    }
  }

  const saveAll = () => loaded.forEach((_, id) => save(id));
  addEventListener('pagehide', saveAll);
  document.addEventListener('visibilitychange', () => document.hidden && saveAll());

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
        shard.timer ||= setTimeout(() => save(id), 1000);
      }
    },

    async clear() {
      for (const shard of await Promise.all(shards.values())) {
        clearTimeout(shard.timer);
        shard.dirty = false;
      }
      shards.clear();
      loaded.clear();
      const index = JSON.parse(await GM.getValue('cache-index', '[]'));
      for (const id of new Set([...index, GRAMMAR_SHARD, `cache:${host}`])) await GM.deleteValue(id);
      await GM.deleteValue('cache-index');
    },
  };
}

export function createPlatform() {
  return {
    fetch: gmFetch,
    cache: createCache(location.hostname),

    /** Rejects if storage can't be read, so a hiccup is never mistaken for a first run. */
    async loadSettings() {
      return JSON.parse((await GM.getValue('settings', '')) || '{}');
    },

    saveSettings: (settings) => GM.setValue('settings', JSON.stringify(settings)),

    // A native prompt, because a page can watch what's typed into anything drawn on it.
    askSecret: (message) => window.prompt(message, ''),
  };
}
