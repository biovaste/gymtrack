/* Curated discovery data. Names/instructions are localized by exercises.js. */
(function (root) {
  'use strict';
  const rows = [
    ['Bench Press','press','chest','barbell','Bench Press','Flat','Two Arm'],
    ['Incline Bench Press','press','chest','barbell','Bench Press','Incline','Two Arm'],
    ['Dumbbell Bench Press','press','chest','dumbbell','Bench Press','Flat','Two Arm'],
    ['Overhead Press','press','shoulders','barbell','Shoulder Press','Standing','Two Arm'],
    ['Seated Dumbbell Press','press','shoulders','dumbbell','Shoulder Press','Seated','Two Arm'],
    ['One Arm Seated Dumbbell Shoulder Press','press','shoulders','dumbbell','Shoulder Press','Seated','One Arm'],
    ['Barbell Row','pull','back','barbell','Barbell Row','Bent Over','Two Arm'],
    ['Dumbbell Row','pull','back','dumbbell','Dumbbell Row','Bent Over','One Arm'],
    ['Cable Row','pull','back','cable','Cable Row','Seated','Two Arm'],
    ['Pull-Up','pull','back','bodyweight','Pull-Up','','Two Arm'],
    ['Lat Pulldown','pull','back','cable','Lat Pulldown','Seated','Two Arm'],
    ['Squat','squat','quadriceps','barbell','Squat','','Two Leg'],
    ['Front Squat','squat','quadriceps','barbell','Squat','','Two Leg'],
    ['Leg Press','squat','quadriceps','machine','Leg Press','Seated','Two Leg'],
    ['Bulgarian Split Squat','lunge','glutes','dumbbell','Split Squat','','One Leg'],
    ['Lunge','lunge','quadriceps','dumbbell','Lunge','','One Leg'],
    ['Deadlift','hinge','back','barbell','Deadlift','','Two Leg'],
    ['Romanian Deadlift','hinge','hamstrings','barbell','Deadlift','','Two Leg'],
    ['Hip Thrust','hinge','glutes','barbell','Hip Thrust','','Two Leg'],
    ['Leg Curl','isolation','hamstrings','machine','Leg Curl','Lying','Two Leg'],
    ['Leg Extension','isolation','quadriceps','machine','Leg Extension','Seated','Two Leg'],
    ['Calf Raise','isolation','calves','machine','Calf Raise','Standing','Two Leg'],
    ['Lateral Raise','isolation','shoulders','dumbbell','Lateral Raise','Standing','Two Arm'],
    ['Face Pull','pull','shoulders','cable','Face Pull','Standing','Two Arm'],
    ['Bicep Curl','isolation','biceps','dumbbell','Bicep Curl','Standing','Two Arm'],
    ['Triceps Pushdown','isolation','triceps','cable','Triceps Pushdown','Standing','Two Arm'],
    ['Plank','core','core','bodyweight','Plank','','','duration'],
    ['Farmer Carry','carry','core','dumbbell','Farmer Carry','','Two Arm','distance'],
    ['Bike','cardio','legs','other','Bike','Seated','','cardio'],
    ['Running','cardio','legs','other','Running','','','cardio']
  ];
  const normalize = s => String(s || '').normalize('NFKC').toLowerCase().replace(/[‐‑–—_-]/g, ' ').replace(/\s+/g, ' ').trim();
  const builtins = rows.map(([name, category, muscle, equipment, movement, position, execution, metric = 'load']) => ({
    id: 'library:' + normalize(name).replace(/[^a-z0-9]+/g, '-'), name, category, muscles: [muscle], equipment,
    movement, position, execution, metric, aliases: [],
    description: root.I18n?.english('exercises.' + (name.startsWith('One Arm Seated') ? 'shoulder_press' : normalize(name).replace(/[^a-z0-9]+/g, '_')) + '.description') || ''
  }));
  function entries(plan) {
    const all = new Map(builtins.map(e => [e.id, e]));
    for (const e of plan.library || []) all.set(e.id, e);
    for (const day of plan.days || []) for (const ex of day.exercises || []) {
      for (const e of [ex, ...(ex.alternates || [])]) if (e.libraryEntry && !all.has(e.libraryEntry.id)) all.set(e.libraryEntry.id, e.libraryEntry);
    }
    return [...all.values()];
  }
  function search(items, query, category = '', muscle = '', display = s => s, aliases = () => []) {
    const words = normalize(query).split(' ').filter(Boolean);
    return items.filter(e => (!category || e.category === category) && (!muscle || e.muscles.includes(muscle)) &&
      words.every(w => normalize([e.name, display(e.name), e.movement, display(e.movement), e.position, display(e.position), e.execution, display(e.execution), e.equipment, ...aliases(e.name), ...(e.aliases || [])].join(' ')).includes(w)));
  }
  function retained(plan) {
    const items = new Map((plan.library || []).map(e => [e.id, e]));
    for (const day of plan.days || []) for (const ex of day.exercises || []) {
      for (const e of [ex, ...(ex.alternates || [])]) if (e.libraryEntry && !items.has(e.libraryEntry.id)) items.set(e.libraryEntry.id, e.libraryEntry);
    }
    return [...items.values()];
  }
  function importLibrary(previous, incoming) {
    const items = new Map(retained(previous).map(e => [e.id, e]));
    for (const entry of retained(incoming)) {
      const old = items.get(entry.id);
      items.set(entry.id, old ? { ...entry, aliases: [...new Set([...old.aliases, ...entry.aliases])] } : entry);
    }
    return [...items.values()];
  }
  function attach(entry, name = entry.name) {
    return { name, movementId: entry.id, equipment: entry.equipment, metric: entry.metric,
      libraryEntry: JSON.parse(JSON.stringify(entry)), description: '' };
  }
  // Blank prescription instructions inherit; custom prose is never translated away.
  function instructions(e, localize = (name, text) => text, fallback = () => null) {
    if (e.description) return localize(e.name, e.description);
    const entry = e.libraryEntry;
    return entry ? localize(entry.name, entry.description) || fallback(entry.name) : localize(e.name, '') || fallback(e.name);
  }
  const api = { builtins, normalize, entries, search, retained, importLibrary, attach, instructions };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ExerciseLibrary = api;
})(typeof globalThis === 'object' ? globalThis : this);
