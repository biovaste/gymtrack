/* GymTrack demo layer.
 *
 * Loaded on every build but inert unless this page is the demo, so one
 * index.html serves both the real app and the demo. When it IS the demo it does
 * three things and nothing else:
 *
 *   1. Declares itself, before app.js evaluates. app.js reads `GymDemo.active`
 *      into its own `DEMO` const and guards on that; every behavioural
 *      difference lives in one of seven guards there.
 *   2. Seeds a SEPARATE localStorage namespace with fabricated data.
 *   3. Owns the intro card's markup and its dismiss handler.
 *
 * Why a separate namespace rather than clearing the app's keys: the `?demo=1`
 * form runs on the production origin, where `gym.*` is the owner's real
 * training history. Clearing it would delete their data locally AND bump
 * `gym.updatedAt`, so the next ordinary (non-demo) load would push fabricated
 * sessions over their real history in KV. Namespacing makes that impossible;
 * reload-as-reset is preserved by wiping the demo namespace on every load.
 */
(function (root) {
  'use strict';

  // ───────────────────────────────────────────────────────────────────────
  // CHANGE ME: where the demo's intro card links back to. This is the only
  // place the URL appears.
  const DEMO_CASE_STUDY_URL = 'https://henri.hithitpull.fi/#projects';
  // ───────────────────────────────────────────────────────────────────────

  const PREFIX = 'gymdemo.';

  /** Demo mode is on for `?demo=1`, or for any host whose first label is `demo`. */
  function detect() {
    try {
      const params = new URLSearchParams(root.location.search);
      if (params.get('demo') === '1') return true;
      return String(root.location.hostname || '').split('.')[0] === 'demo';
    } catch (e) { return false; }
  }

  const active = detect();

  /* ---------- seeding ---------- */
  // Wipe and reseed on every load: reload IS the reset. Writes made during a
  // visit persist normally until then, so logging a set behaves like the real
  // app rather than like a mock.
  function seed() {
    const ls = root.localStorage;
    for (const key of Object.keys(ls).filter(k => k.startsWith(PREFIX))) ls.removeItem(key);

    const data = root.GymDemoData.build();
    const put = (k, v) => ls.setItem(PREFIX + k, JSON.stringify(v));
    put('plan', data.plan);
    put('sessions', data.sessions);
    put('bw', data.bodyWeight);
    put('aliases', data.aliases);
    // autoSync off is belt to the braces in app.js: nothing in demo mode may
    // reach the sync Worker.
    put('settings', { unit: 'kg', sound: true, vibrate: true, autoSync: false });
    put('updatedAt', Date.parse(data.sessions[data.sessions.length - 1].date));
    // The first-run modal would land on top of the intro card.
    put('onboarded', 1);
    // No 'active' key: the demo opens on "Start a workout", which is the right
    // first screen for both a visitor and a screen capture.
  }

  /* ---------- intro card ---------- */
  // Demo prose is deliberately kept out of locales/source/ui.json: it is not
  // product copy, and routing it through the translation pipeline would put
  // demo-only strings into the app's catalogue forever. The app's own UI around
  // this card still translates normally.
  const TEXT = {
    en: {
      title: 'This is a live demo',
      body: 'GymTrack is a workout tracker that swaps training plans and logs with an AI coach as JSON. Everything here works — log sets, run the rest timer, browse history and PRs.',
      note: 'The training data is generated, not real, and it resets every time you reload.',
      link: 'Read about how it was built',
      dismiss: 'Dismiss',
      syncOff: 'Cloud sync is off in the demo. Everything you log stays in this browser and resets when you reload.',
      shareOff: '"Share with AI" is disabled here — it hands out a link to a real synced account. "Copy coaching prompt + data" below is the same feature the app ships, and it works entirely in your browser.'
    },
    fi: {
      title: 'Tämä on esittelyversio',
      body: 'GymTrack on treenipäiväkirja, joka vaihtaa ohjelmia ja treenilokeja tekoälyvalmentajan kanssa JSON-muodossa. Kaikki toimii — kirjaa sarjoja, käytä palautusajastinta, selaa historiaa ja ennätyksiä.',
      note: 'Treenidata on keksittyä, ja se palautuu alkutilaan aina sivun latauksella.',
      link: 'Lue miten se on rakennettu',
      dismiss: 'Sulje',
      syncOff: 'Pilvisynkronointi on pois päältä esittelyversiossa. Kaikki kirjaamasi pysyy tässä selaimessa ja nollautuu sivun latauksella.',
      shareOff: '"Jaa tekoälylle" on poistettu käytöstä täällä — se antaisi linkin oikeaan synkronoituun tiliin. Alla oleva "Kopioi valmennuskehote + data" on sama ominaisuus kuin sovelluksessa ja toimii kokonaan selaimessa.'
    }
  };

  let dismissed = false;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function introCard() {
    if (dismissed) return '';
    const t = TEXT[root.I18n && root.I18n.locale() === 'fi' ? 'fi' : 'en'];
    return `
    <div class="card demo-card">
      <div class="row between">
        <span class="bold">${esc(t.title)}</span>
        <button class="icon-btn ghost" data-action="demo-dismiss" aria-label="${esc(t.dismiss)}">✕</button>
      </div>
      <p class="small mt8">${esc(t.body)}</p>
      <p class="small muted mt8">${esc(t.note)}</p>
      <a class="small demo-link" href="${esc(DEMO_CASE_STUDY_URL)}" target="_blank" rel="noopener noreferrer">${esc(t.link)} →</a>
    </div>`;
  }

  // The card owns its own dismiss handling so app.js needs no extra action case.
  function bindDismiss() {
    root.document.addEventListener('click', e => {
      const btn = e.target.closest && e.target.closest('[data-action="demo-dismiss"]');
      if (!btn) return;
      dismissed = true;
      if (typeof root.render === 'function') root.render();
    });
  }

  function injectStyles() {
    const style = root.document.createElement('style');
    style.textContent = `
      .demo-card { border-left: 3px solid var(--accent, #4ea1ff); }
      .demo-card .demo-link { display: inline-block; margin-top: 10px; }
    `;
    root.document.head.appendChild(style);
  }

  if (active) {
    seed();
    injectStyles();
    bindDismiss();
  }

  /** Demo-only prose, in the language the app is currently showing. */
  function text(key) {
    const t = TEXT[root.I18n && root.I18n.locale() === 'fi' ? 'fi' : 'en'];
    return t[key] || TEXT.en[key] || '';
  }

  root.GymDemo = { active, prefix: PREFIX, introCard, text, caseStudyUrl: DEMO_CASE_STUDY_URL };
})(typeof globalThis === 'object' ? globalThis : this);
