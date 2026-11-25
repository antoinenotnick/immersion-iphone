// Entry point: connects the platform, the translation engine and the on-page controls.
import { createPlatform } from './platform/userscript.js';
import { DEFAULTS, LANGUAGES, langName, normLang } from './core/shared.js';
import { translate } from './core/translate.js';
import { explainGrammar } from './core/grammar.js';
import { createEngine } from './page/engine.js';
import { createUI } from './page/ui.js';
import { createPill } from './page/pill.js';
import { createMenu } from './page/menu.js';
import { setupTouch } from './page/touch.js';

async function start() {
  if (window.top !== window || !document.body || document.contentType !== 'text/html') return;
  if (document.querySelector('immersion-ui')) return; // already running (e.g. installed twice)

  const platform = createPlatform();
  const host = location.hostname;
  let settings = withDefaults(await platform.loadSettings());
  let ready = false; // true once the page's language has been looked at

  function withDefaults(saved) {
    const merged = { ...DEFAULTS, ...saved };
    if (!saved.onboarded && !saved.native) {
      const own = normLang(navigator.language);
      merged.native = LANGUAGES.includes(own) ? own : 'en';
      merged.target = merged.native === 'es' ? 'en' : 'es';
    }
    return merged;
  }

  const getSettings = () => settings;
  const wantedMode = () =>
    settings.onboarded && settings.enabled && !settings.pausedSites.includes(host) ? settings.mode : 'off';

  const ui = createUI();
  const engine = createEngine({
    getSettings,
    translate: (texts, to, from) => translate(texts, to, from, settings, platform),
    onState: drawPill,
    onError: (err) => ui.toast(`Couldn't translate: ${err.message}`, 3500),
  });

  // ---------- Settings ----------

  let saving = Promise.resolve();
  let unsaved = {}; // changes not yet written to storage

  /** Change settings: takes effect right away, then is merged into storage (other tabs may have changed it). */
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
        ui.toast("Couldn't save your settings.", 3000);
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
    if (mode !== 'off' && !ready) {
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

  /** Pick up changes made in other tabs while this one was in the background. */
  async function sync() {
    if (document.hidden) return;
    try {
      await saving;
      await apply({ ...withDefaults(await platform.loadSettings()), ...unsaved });
    } catch {
      /* keep what we have */
    }
  }

  // ---------- Controls ----------

  function toggleMode() {
    if (engine.mode() === 'off') return menu.showMain(); // paused or turned off: show why
    const mode = engine.mode() === 'target' ? 'native' : 'target';
    save({ mode });
    ui.toast(`Showing ${langName(settings[mode])}`);
  }

  function drawPill() {
    const state = engine.state();
    const label = state.mode === 'off' ? 'Immersion is off on this page' : `Immersion: showing ${langName(state.lang)}. Tap to switch, hold for the menu.`;
    pill?.update({ ...state, label });
  }

  // `var`: the engine reports its state before the pill exists.
  var pill = createPill(ui.pillEl, {
    position: settings.button,
    onTap: toggleMode,
    onLongPress: () => {
      ui.closeCard();
      menu.showMain();
    },
    onMove: (button) => save({ button }),
  });
  const menu = createMenu({ ui, engine, platform, getSettings, save, toggleMode, host });
  const touch = setupTouch({
    engine,
    ui,
    getSettings,
    openSettings: menu.showSettings,
    explain: ({ text, context }) =>
      explainGrammar({ text, context, native: settings.native, target: settings.target, settings }, platform),
  });

  drawPill();
  addEventListener('online', () => engine.state().error && engine.retry());
  addEventListener('pageshow', (e) => e.persisted && sync());
  document.addEventListener('visibilitychange', sync);

  await apply(settings);
  if (!settings.onboarded) menu.showWelcome();
}

start().catch((err) => console.error('Immersion:', err));
