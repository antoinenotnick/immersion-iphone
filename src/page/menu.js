// The menu sheet: first-run setup, quick controls and settings.
import { h } from './ui.js';
import { AI_PROVIDERS, LANGUAGES, endonym, langName, pickLanguage, sameLang } from '../core/shared.js';
import { listModels } from '../core/ai.js';

export function createMenu({ ui, engine, platform, getSettings, save, toggleMode, host }) {
  let modelsSeq = 0;

  // ---------- Building blocks ----------

  const group = (...rows) => h('div', { class: 'group' }, rows);
  const groupTitle = (text) => h('div', { class: 'group-title' }, text);
  const text = (title, detail) => h('span', {}, title, detail && h('small', {}, detail));

  const toggleRow = (title, detail, on, onchange) =>
    h(
      'button',
      { class: 'row', type: 'button', role: 'switch', 'aria-checked': String(on), onclick: () => onchange(!on) },
      text(title, detail),
      h('span', { class: 'switch' }),
    );

  const buttonRow = (title, detail, value, onclick) =>
    h('button', { class: 'row', type: 'button', onclick }, text(title, detail), h('span', { class: 'value' }, value));

  function selectRow(title, options, selected, onchange) {
    const select = h('select', { 'aria-label': title, onchange: (e) => onchange(e.target.value) });
    select.append(...options.map(([value, label]) => new Option(label, value, false, value === selected)));
    return h('label', { class: 'row' }, h('span', {}, title), select);
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

  const languages = (after) => group(languageRow("I'm learning", 'target', after), languageRow('I speak', 'native', after));

  /** A row for a secret. It's typed into a native prompt and never put on the page. */
  function keyRow(label, keyName, after) {
    const saved = !!getSettings()[keyName];
    return buttonRow(`${label} key`, saved ? 'Saved on this phone' : 'Not set', saved ? 'Change' : 'Add', async () => {
      const value = platform.askSecret(`Paste your ${label} API key.${saved ? ' Leave this empty to remove the saved one.' : ''}`);
      if (value == null) return;
      await save({ [keyName]: value.trim() });
      after();
    });
  }

  // ---------- First run ----------

  function showWelcome() {
    const start = async () => {
      await save({ onboarded: true });
      ui.closeMenu();
    };
    ui.openMenu({
      title: 'Welcome to Immersion',
      content: [
        h('p', { class: 'intro muted' }, 'Websites will appear in the language you’re learning.'),
        languages(showWelcome),
        h(
          'ul',
          { class: 'steps' },
          h('li', {}, h('span', {}, '🔁'), h('span', {}, 'Tap the round button to switch languages. Hold it for the menu, or drag it out of the way.')),
          h('li', {}, h('span', {}, '👀'), h('span', {}, 'Rest two fingers on a paragraph to peek at it in your own language.')),
          h('li', {}, h('span', {}, '✨'), h('span', {}, 'Select text for its translation and grammar tips.')),
        ),
        h('p', { class: 'note muted small' }, 'The text of pages you read is sent to Google Translate. Pause Immersion on sites you want to keep private, like banking or email.'),
        h('button', { class: 'btn primary', type: 'button', onclick: start }, 'Start'),
      ],
    });
  }

  // ---------- Quick controls ----------

  function statusText() {
    const s = getSettings();
    const { mode, pageLang, busy, error } = engine.state();
    if (!s.enabled) return 'Immersion is turned off.';
    if (s.pausedSites.includes(host)) return 'Paused on this site.';
    if (error) return error;
    if (busy) return 'Translating…';
    if (mode === 'target' && sameLang(pageLang, s.target)) return `This page is already in ${langName(s.target)}.`;
    return '';
  }

  function showMain() {
    const s = getSettings();
    if (!s.onboarded) return showWelcome();
    const mode = engine.mode();
    const paused = s.pausedSites.includes(host);
    const status = statusText();
    const failed = mode !== 'off' && !!engine.state().error;
    const seg = (which) =>
      h(
        'button',
        {
          type: 'button',
          role: 'radio',
          'aria-checked': String(mode === which),
          disabled: mode === 'off',
          onclick: () => {
            if (engine.mode() !== which) toggleMode();
            ui.closeMenu();
          },
        },
        langName(s[which]),
      );
    ui.openMenu({
      title: 'Immersion',
      content: [
        h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Page language' }, seg('target'), seg('native')),
        status && h('p', { class: failed ? 'error small' : 'muted small' }, status),
        failed && h('button', { class: 'btn', type: 'button', onclick: () => (engine.retry(), ui.closeMenu()) }, 'Try again'),
        languages(showMain),
        group(
          toggleRow('Pause on this site', host, paused, async (on) => {
            const sites = new Set(getSettings().pausedSites);
            if (on) sites.add(host);
            else sites.delete(host);
            await save({ pausedSites: [...sites] });
            showMain();
          }),
          toggleRow('Immersion', 'Turn off to stop translating everywhere', s.enabled, async (on) => {
            await save({ enabled: on });
            showMain();
          }),
        ),
        group(buttonRow('Settings', null, '›', showSettings)),
      ],
    });
  }

  // ---------- Settings ----------

  function showSettings() {
    const s = getSettings();
    const provider = AI_PROVIDERS[s.aiProvider] ? s.aiProvider : 'gemini';
    const info = AI_PROVIDERS[provider];
    const modelRow = selectRow('Model', [], '', (id) => save({ aiModels: { ...getSettings().aiModels, [provider]: id } }));
    const modelSelect = modelRow.querySelector('select');
    const modelStatus = h('p', { class: 'note muted small', role: 'status' });

    ui.openMenu({
      title: 'Settings',
      onBack: showMain,
      onClose: () => modelsSeq++,
      content: [
        groupTitle('Translation'),
        group(
          selectRow('Service', [['google', 'Google Translate'], ['deepl', 'DeepL']], s.provider, async (value) => {
            await save({ provider: value });
            showSettings();
          }),
          s.provider === 'deepl' && keyRow('DeepL', 'deeplKey', showSettings),
        ),
        s.provider === 'deepl' &&
          h('p', { class: 'note muted small' }, s.deeplKey ? 'The free plan includes 500,000 characters a month.' : 'Google Translate is used until you add a key.'),

        groupTitle('Grammar tips'),
        group(
          selectRow('AI service', Object.entries(AI_PROVIDERS).map(([id, p]) => [id, `${p.label} (${p.cost})`]), provider, async (id) => {
            await save({ aiProvider: id });
            showSettings();
          }),
          keyRow(info.label, info.keyName, showSettings),
          modelRow,
        ),
        modelStatus,
        h('p', { class: 'note muted small' }, h('a', { href: info.keyUrl, target: '_blank', rel: 'noopener noreferrer' }, `Get a key from ${info.label}`), ` · ${info.note}`),

        groupTitle('Reading'),
        group(
          toggleRow('Card when I select text', 'Shows the translation and grammar tips', s.selectPopup, async (on) => {
            await save({ selectPopup: on });
            showSettings();
          }),
        ),

        s.pausedSites.length > 0 && groupTitle('Paused sites'),
        s.pausedSites.length > 0 &&
          group(
            s.pausedSites.map((site) =>
              buttonRow(site, null, 'Resume', async () => {
                await save({ pausedSites: getSettings().pausedSites.filter((x) => x !== site) });
                showSettings();
              }),
            ),
          ),

        groupTitle('Storage'),
        group(
          buttonRow('Saved translations', 'Kept on this phone to avoid repeat requests', 'Clear', async () => {
            await platform.cache.clear();
            ui.toast('Cleared');
          }),
        ),
        h('p', { class: 'note muted small' }, 'Keys stay in the Userscripts app on this phone and are only sent to the service they belong to.'),
      ],
    });
    loadModels(provider, modelSelect, modelStatus);
  }

  /** Fill the model list from the service itself (this also shows whether the key works). */
  async function loadModels(provider, select, status) {
    const seq = ++modelsSeq;
    const info = AI_PROVIDERS[provider];
    const s = getSettings();
    const key = (s[info.keyName] || '').trim();
    const chosen = s.aiModels?.[provider];
    const fill = (models) => {
      const list = chosen && !models.some((m) => m.id === chosen) ? [{ id: chosen }, ...models] : models;
      select.replaceChildren(...list.map((m) => new Option(m.free ? `${m.id} (free)` : m.id, m.id, false, m.id === chosen)));
    };
    const say = (message, isError = false) => {
      status.textContent = message;
      status.className = `note small ${isError ? 'error' : 'muted'}`;
    };
    fill(info.models.map((id) => ({ id })));
    if (!key && provider !== 'openrouter') return say(`Add your ${info.label} key to load its full model list.`);
    say('Loading models…');
    try {
      const live = await listModels(provider, key, platform.fetch);
      if (seq !== modelsSeq) return;
      if (!live.length) return say(`${info.label} didn't list any models.`, true);
      // Suggested models first (when the service actually offers them), then everything else.
      const byId = new Map(live.map((m) => [m.id, m]));
      fill([...info.models.filter((id) => byId.has(id)).map((id) => byId.get(id)), ...live.filter((m) => !info.models.includes(m.id))]);
      const free = live.filter((m) => m.free).length;
      const count = `${live.length} models${free ? `, ${free} free` : ''}`;
      say(key ? `✓ Key works · ${count}` : `${count} · add your key to use them`);
    } catch (err) {
      if (seq === modelsSeq) say(err.message, true);
    }
  }

  return { showMain, showSettings, showWelcome };
}
