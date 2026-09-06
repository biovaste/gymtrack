/* Display-only exercise localization. Canonical names remain workout/history IDs. */
(function (global) {
  'use strict';
  const api = global.I18n;
  if (!api) throw new Error('Load i18n.js before exercises.js');
  const names = [
    'Bench Press', 'Incline Bench Press', 'Dumbbell Bench Press', 'Squat', 'Front Squat',
    'Deadlift', 'Romanian Deadlift', 'Overhead Press', 'Barbell Row', 'Dumbbell Row',
    'Cable Row', 'Pull-Up', 'Chin-Up', 'Lat Pulldown', 'Dip', 'Lateral Raise', 'Face Pull',
    'Rear Delt Fly', 'Bicep Curl', 'Hammer Curl', 'Triceps Pushdown', 'Skull Crusher',
    'Leg Press', 'Leg Extension', 'Leg Curl', 'Calf Raise', 'Hip Thrust', 'Lunge',
    'Bulgarian Split Squat', 'Shrug', 'Plank', 'Chest Fly', 'Good Morning', 'Pullover',
    'Machine Chest Press', 'Seated Dumbbell Press', 'Incline Dumbbell Press', 'Cable Lateral Raise',
    'Back Squat', 'Hack Squat', 'Goblet Squat', 'Split Squat', 'Sumo Deadlift', 'Trap Bar Deadlift',
    'Stiff Leg Deadlift', 'Chest Press', 'Shoulder Press', 'Arnold Press', 'Push Press',
    'Seated Row', 'T Bar Row', 'Pendlay Row', 'Upright Row', 'Inverted Row',
    'Triceps Extension', 'Overhead Triceps Extension', 'Preacher Curl', 'Concentration Curl',
    'Reverse Curl', 'Reverse Fly', 'Pec Deck', 'Reverse Pec Deck', 'Cable Crossover',
    'Seated Leg Curl', 'Lying Leg Curl', 'Standing Calf Raise', 'Seated Calf Raise',
    'Reverse Lunge', 'Walking Lunge', 'Step Up', 'Glute Bridge', 'Back Extension',
    'Hip Abduction', 'Hip Adduction', 'Cable Kickback', 'Glute Kickback',
    'Push-Up', 'Sit-Up', 'Crunch', 'Cable Crunch', 'Hanging Leg Raise', 'Knee Raise',
    'Ab Wheel Rollout', 'Russian Twist', 'Side Plank', 'Pallof Press', 'Dead Bug', 'Bird Dog',
    'Box Jump', 'Countermovement Jump', 'Squat Jump', 'Broad Jump', 'Depth Jump',
    'Kettlebell Swing', 'Farmer Carry', 'Clean', 'Power Clean', 'Snatch', 'Burpee',
    'Bike', 'Treadmill', 'Rowing Machine', 'Elliptical', 'Jump Rope', 'Walking', 'Running'
  ];
  const normalize = value => String(value == null ? '' : value).normalize('NFKC').toLowerCase()
    .replace(/[‐‑–—_-]/g, ' ').replace(/\s+/g, ' ').trim();
  const slug = value => normalize(value).replace(/[^a-z0-9]+/g, '_');
  const entries = names.map(name => ({ name, normalized: normalize(name), key: 'exercises.' + slug(name) }));
  const byName = new Map(entries.map(entry => [entry.normalized, entry]));
  const byFinnish = new Map();
  const ambiguousFinnish = new Set();
  const registerFinnish = (entry, value) => {
    if (typeof value !== 'string' || !value.trim()) return;
    const key = normalize(value);
    if (key === entry.normalized) return;
    if (ambiguousFinnish.has(key)) return;
    const previous = byFinnish.get(key);
    if (previous && previous.key !== entry.key) {
      byFinnish.delete(key);
      ambiguousFinnish.add(key);
      return;
    }
    byFinnish.set(key, entry);
  };
  for (const entry of entries) registerFinnish(entry, global.GYM_I18N_CATALOG?.entries?.[entry.key + '.name']?.fi);
  // The review importer adds exercise keys without requiring a runtime code edit.
  for (const [key, entry] of Object.entries(global.GYM_I18N_CATALOG?.entries || {})) {
    if (/^exercises\.(?!modifier_)[^.]+\.name$/.test(key) && key !== 'exercises.variant.name' && typeof entry.en === 'string') {
      const imported = { name: entry.en, normalized: normalize(entry.en), key: key.slice(0, -5) };
      byName.set(normalize(entry.en), imported);
      registerFinnish(imported, entry.fi);
    }
  }
  const aliases = {
    'pullup': 'Pull-Up', 'pullups': 'Pull-Up', 'pull ups': 'Pull-Up',
    'chinup': 'Chin-Up', 'chinups': 'Chin-Up', 'chin ups': 'Chin-Up',
    'pushup': 'Push-Up', 'pushups': 'Push-Up', 'push ups': 'Push-Up',
    'situp': 'Sit-Up', 'situps': 'Sit-Up', 'sit ups': 'Sit-Up',
    'dips': 'Dip', 'lunges': 'Lunge', 'shrugs': 'Shrug', 'squats': 'Squat',
    'biceps curl': 'Bicep Curl', 'biceps curls': 'Bicep Curl', 'bicep curls': 'Bicep Curl',
    'lateral raises': 'Lateral Raise', 'face pulls': 'Face Pull', 'calf raises': 'Calf Raise',
    'leg curls': 'Leg Curl', 'leg extensions': 'Leg Extension', 'hip thrusts': 'Hip Thrust',
    'skull crushers': 'Skull Crusher', 'rdl': 'Romanian Deadlift', 'ohp': 'Overhead Press',
    'lat pull down': 'Lat Pulldown', 'lat pull downs': 'Lat Pulldown',
    'seated cable row': 'Cable Row', 'bent over barbell row': 'Barbell Row',
    'incline dumbbell bench press': 'Incline Dumbbell Press',
    'rear delt raise': 'Rear Delt Fly', 'rear delt flyes': 'Rear Delt Fly',
    'chest flyes': 'Chest Fly', 'chest flies': 'Chest Fly',
    'hex bar deadlift': 'Trap Bar Deadlift', 'stiff legged deadlift': 'Stiff Leg Deadlift',
    'step ups': 'Step Up', 'box jumps': 'Box Jump', 'cmj': 'Countermovement Jump',
    'counter movement jump': 'Countermovement Jump', 'farmers walk': 'Farmer Carry',
    "farmer's walk": 'Farmer Carry', 'farmers carry': 'Farmer Carry',
    'stationary bike': 'Bike', 'exercise bike': 'Bike', 'rowing ergometer': 'Rowing Machine'
  };
  for (const [alias, name] of Object.entries(aliases)) byName.set(normalize(alias), byName.get(normalize(name)));
  const modifiers = [
    'Single Arm', 'One Arm', 'Two Arm', 'Single Leg', 'One Leg', 'Two Leg', 'Double Leg',
    'Chest Supported', 'Close Grip', 'Wide Grip', 'Neutral Grip', 'Underhand Grip', 'Overhand Grip',
    'Dumbbell', 'Barbell', 'Cable', 'Machine', 'Bodyweight', 'Kettlebell', 'Smith Machine',
    'Resistance Band', 'Banded', 'Weighted', 'Assisted', 'Incline', 'Decline', 'Flat',
    'Seated', 'Standing', 'Lying', 'Alternating', 'Unilateral', 'Bilateral', 'Rope',
    'Paused', 'Tempo', 'Deficit', 'Elevated', 'Bent Over'
  ];
  const modifierEntries = modifiers.map(name => ({ text: normalize(name), key: 'exercises.modifier_' + slug(name) + '.name' }))
    .sort((a, b) => b.text.length - a.text.length);
  const phrases = [...byName.entries()].sort((a, b) => b[0].length - a[0].length);
  const translation = (key, fallback) => { const value = api.t(key); return value && value !== key ? value : fallback; };
  const reverseEntry = name => {
    const key = normalize(name);
    return ambiguousFinnish.has(key) ? null : byFinnish.get(key) || null;
  };
  const read = (key, fallback) => {
    try { return JSON.parse(global.localStorage.getItem(key)) || fallback; } catch (_) { return fallback; }
  };
  const write = (key, value) => { try { global.localStorage.setItem(key, JSON.stringify(value)); } catch (_) { /* Storage may be unavailable. */ } };
  const pendingKey = 'gym.i18n.pendingExercises';
  const overridesKey = 'gym.i18n.exerciseTranslations';
  function pending(name, description, reason) {
    if (!String(name || '').trim()) return;
    const queue = read(pendingKey, []);
    if (!Array.isArray(queue)) return;
    if (queue.some(item => normalize(item.name) === normalize(name) && (item.description || '') === (description || ''))) return;
    queue.push({ name: String(name), ...(description ? { description: String(description) } : {}), reason });
    write(pendingKey, queue);
  }
  function supplied(name, metadata, field) {
    const local = read(overridesKey, {});
    const value = metadata?.[api.locale()]?.[field] || local?.[normalize(name)]?.[api.locale()]?.[field];
    return typeof value === 'string' && value.trim() ? value : null;
  }
  function parts(name) {
    const n = normalize(name);
    if (byName.has(n)) return { entry: byName.get(n), modifiers: [] };
    for (const [phrase, entry] of phrases) {
      const start = n.indexOf(phrase);
      if (start < 0 || (start && /[\p{L}\p{N}]/u.test(n[start - 1])) || /[\p{L}\p{N}]/u.test(n[start + phrase.length] || '')) continue;
      let rest = (n.slice(0, start) + ' ' + n.slice(start + phrase.length)).replace(/[(),/]/g, ' ').replace(/\s+/g, ' ').trim();
      const found = [];
      while (rest) {
        const modifier = modifierEntries.find(item => rest === item.text || rest.startsWith(item.text + ' '));
        if (!modifier) break;
        found.push(modifier); rest = rest.slice(modifier.text.length).trim();
      }
      // Translate only a fully recognized name; never lose an unfamiliar qualifier.
      if (!rest) return { entry, modifiers: found };
    }
    return null;
  }
  api.exercise = function (name, metadata) {
    const original = String(name == null ? '' : name);
    const custom = supplied(original, metadata, 'name');
    if (custom) return custom;
    const reverse = reverseEntry(original);
    if (api.locale() === 'en') return reverse ? reverse.name : original;
    // A translated catalogue name is already display-ready in Finnish.
    if (reverse) return original;
    const match = parts(original);
    if (!match) { pending(original, '', 'unknown-name'); return original; }
    const movement = translation(match.entry.key + '.name', original);
    if (!match.modifiers.length) return movement;
    const modifiers = match.modifiers.map(item => translation(item.key, item.text)).join(', ');
    return api.t('exercises.variant.name', { movement, modifiers });
  };
  api.explanation = function (name, originalFallback, metadata) {
    const custom = supplied(name, metadata, 'description');
    if (custom) return custom;
    const match = parts(name) || (reverseEntry(name) ? { entry: reverseEntry(name), modifiers: [] } : null);
    const key = match?.entry.key + '.description';
    // Custom coach instructions may include crucial cues; do not replace them.
    const english = match && typeof api.english === 'function' ? api.english(key) : null;
    if (api.locale() === 'en') return originalFallback || english || null;
    if (originalFallback && english !== originalFallback) {
      pending(name, originalFallback, 'custom-description');
      return originalFallback;
    }
    const translated = match ? translation(key, null) : null;
    return translated || originalFallback || null;
  };
  api.pendingExercises = () => { const queue = read(pendingKey, []); return Array.isArray(queue) ? queue : []; };
  api.exportPendingExercises = () => JSON.stringify(api.pendingExercises(), null, 2);
  api.setExerciseTranslation = function (name, translations) {
    if (!String(name || '').trim() || !translations || typeof translations !== 'object') throw new Error('Exercise name and translations are required');
    const clean = {};
    for (const locale of ['en', 'fi']) {
      const fields = {};
      for (const field of ['name', 'description']) {
        const value = translations[locale]?.[field];
        if (typeof value === 'string' && value.trim()) fields[field] = value.trim();
      }
      if (Object.keys(fields).length) clean[locale] = fields;
    }
    const local = read(overridesKey, {});
    local[normalize(name)] = clean;
    write(overridesKey, local);
    write(pendingKey, api.pendingExercises().filter(item => normalize(item.name) !== normalize(name) ||
      (item.description ? !clean.fi?.description : !clean.fi?.name)));
  };
})(globalThis);
