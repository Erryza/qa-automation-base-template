/**
 * Distinct, realistic names for the records a suite creates on a shared environment.
 *
 * WHY: a suite that re-creates a record after a failure (new code: STF146022PU → PU2 → PU3 → PU4) kept the SAME name,
 * so SIT on 2026-10-28 listed four "Investa Link Pendidikan Anak" products side by side and nobody could tell which one
 * was live (the user asked for new data to get a new name too). Every record the suite creates from now on gets the
 * base name plus a word ("Investa Link Pendidikan Anak Prima", "… Sentosa", …) that no earlier record of that base
 * received; records made before this keep the name they have.
 *
 * Names hold no digits — Partner Name and Fund Name refuse them.
 *
 * State (the suite's .state/<env>.json, carried over by ST_FRESH):
 *   names   { <code>: <name> }  the name each record was created with
 *   nameSeq { <base>: <n> }     how many variants of that base were handed out
 */
const WORDS = ['Prima', 'Sentosa', 'Nusantara', 'Mandiri', 'Sejahtera', 'Utama', 'Bersama', 'Gemilang', 'Abadi', 'Makmur',
  'Persada', 'Lestari', 'Harapan', 'Perkasa', 'Cemerlang', 'Bahagia', 'Jaya', 'Mulia', 'Amanah', 'Berkah'];

/** The n-th variant of a base name (n ≥ 1). A word the base already contains is skipped; "… Fund" keeps "Fund" last. */
function nameVariant(base, n) {
  const words = WORDS.filter(w => !new RegExp(`\\b${w}\\b`, 'i').test(base));
  const first = words[(n - 1) % words.length];
  // Past the word list: a second word per round, never the first word again ("Prima Sentosa", not "Sentosa Sentosa").
  const round = Math.floor((n - 1) / words.length);
  const others = words.filter(w => w !== first);
  const second = round ? ` ${others[(round - 1) % others.length]}` : '';
  const word = `${first}${second}`;
  return / Fund$/.test(base) ? base.replace(/ Fund$/, ` ${word} Fund`) : `${base} ${word}`;
}

/**
 * Bind to a suite's state file.
 *   nameOf(code, base)  the record's name: the one it was created with, else `base` (records made before this helper).
 *   claim(code, base, isTaken?)  call right BEFORE creating the record: returns the name to type. A code that already
 *     has a name (an earlier attempt of the same record) keeps it. `isTaken(name)` (async, optional) rejects a variant
 *     another record already carries.
 */
function createNamer(loadState, saveState) {
  const names = () => loadState().names || {};
  return {
    nameOf: (code, base) => names()[code] || base,
    async claim(code, base, isTaken) {
      if (names()[code]) return names()[code];
      for (let i = 0; i < 40; i++) {
        const n = ((loadState().nameSeq || {})[base] || 0) + 1;
        const name = nameVariant(base, n);
        saveState({ nameSeq: { ...(loadState().nameSeq || {}), [base]: n } });
        if (isTaken && await isTaken(name)) continue;
        saveState({ names: { ...names(), [code]: name } });
        return name;
      }
      throw new Error(`no free name variant of "${base}" after 40 tries`);
    },
  };
}

module.exports = { nameVariant, createNamer };
