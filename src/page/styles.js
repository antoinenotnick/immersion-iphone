export const COLORS = ['#6366f1', '#0d9488', '#d97706', '#db2777', '#2563eb'];

export const CSS = `
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
