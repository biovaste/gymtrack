const Core = require('./workout-core');

// Apply the whole edit buffer before Log/Save; invalid text never becomes null/NaN.
function applyDrafts(active, drafts) {
  let next = active;
  for (const [key, text] of Object.entries(drafts)) {
    if (key === 'notes') { next = {...next, notes:text}; continue; }
    const [ei, si, field] = key.split(':');
    const trimmed = text.trim().replace(',', '.');
    if (trimmed && !/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(trimmed)) throw Error('invalidSet');
    next = Core.updateSet(next, Number(ei), Number(si), field, trimmed ? Number(trimmed) : null);
  }
  return next;
}
module.exports = {applyDrafts};
