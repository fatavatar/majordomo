// Spell Book list (frmSpellBook). Pure; the page is js/tools/spellbook.js.
import { db } from '../db.js';
import { spellUsableBy } from './usable.js';

// modMain.AddSpell2LV skips unnamed and placeholder spells.
export const listable = sp => {
  const name = String(sp.Name || '');
  return name !== '' && name[0] !== '1' && name.slice(0, 3).toLowerCase() !== 'sdf';
};

// frmSpellBook.cmdListSpells_Click: SpellIsUsable(n, class, level, align, bAndLearnable=True).
// (The form's Magery / Level boxes are only set from the class; MME's filter
// on them is commented out, so they don't narrow the list.)
export function spellBook(clsNum, level, alignment) {
  return db.Spells.filter(sp => spellUsableBy(sp, clsNum, level, alignment, true) && listable(sp));
}
