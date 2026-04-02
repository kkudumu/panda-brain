'use strict';

const PATTERNS = [
  (m) => `xX${cap(m)}97Xx`,
  (m) => `${cap(m)}Master5000`,
  (m) => `ii${m.toUpperCase()}ii`,
  (m) => `${m.toLowerCase()}_gurl22`,
  (m) => `Sk8r${cap(m)}`,
  (m) => `LiL${cap(m)}xo`,
  (m) => `${cap(m)}4Lyfe2003`,
  (m) => `${cap(m)}InUrFace`,
  (m) => `AzN${cap(m)}`,
  (m) => `${m.toLowerCase()}xoxo99`,
  (m) => `${cap(m)}Boi04`,
  (m) => `Da${cap(m)}Kid`,
  (m) => `${cap(m)}Angel2k3`,
  (m) => `SuPeR${cap(m)}`,
];

function cap(str) {
  if (!str) return str;
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

function htmlSafe(name) {
  return name.replace(/[&<>"'`=\/]/g, '');
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = a[i]; a[i] = a[j]; a[j] = tmp;
  }
  return a;
}

function generateScreennames() {
  const entities = ['claude', 'codex', 'gemini', 'user'];
  const selected = shuffle(PATTERNS).slice(0, 4);
  const result = {};
  entities.forEach(function (entity, idx) {
    result[entity] = htmlSafe(selected[idx](entity));
  });
  return result;
}

module.exports = { generateScreennames };
