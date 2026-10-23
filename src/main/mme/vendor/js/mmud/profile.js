// The bridge between the character stats panel (charstats.calcCharStats, MME's
// lblInvenCharStat array) and the CharProfile the combat math reads (combat.js).
// In MME both are the same globals; here the panel is computed once and copied
// across by stat-label index.

import { calcCharStats, calcCharSummary, S, classCombat } from './charstats.js';
import { blankProfile } from './combat.js';
import { getMaxLevel } from './spellcalc.js';

export const WEAPON_SLOT = 16, OFFHAND_SLOT = 15;   // char.EQ_SLOTS indices

// opt.globalFilter: Q&D crit only applies with the global filter on, as in MME.
export function profileFromChar(c, opt = {}) {
  const ps = calcCharStats(c, opt);
  const st = ps.stats;
  // the Character tab's totals (lblCharMaxHP / lblCharRestRate / lblCharSC /
  // lblCharMaxMana / lblCharManaRate .Tag, txtCharMR); the panel only has the +bonuses
  const sum = calcCharSummary(c, ps);
  const p = blankProfile();
  Object.assign(p, {
    isLoaded: true, level: c.level || 0, cls: c.cls || 0, race: c.race || 0, align: c.alignment || 0,
    combat: c.cls ? classCombat(c.cls) : 0,
    ...ps.eff,                                         // str, int, wis, agi, hea, cha (with item bonuses)
    accuracy: st[S.accy], crit: st[S.crits], qndBonus: ps.qnd, dodge: st[S.dodge],
    plusMaxDamage: st[S.maxDmg], plusMinDamage: st[S.minDmg],
    plusBSaccy: st[S.bsAccy], plusBSmindmg: st[S.bsMin], plusBSmaxdmg: st[S.bsMax],
    maSkill: [0, st[S.punchSkill], st[S.kickSkill], st[S.jkSkill]],
    maAccy: [0, st[S.punchAccy], st[S.kickAccy], st[S.jkAccy]],
    maDmg: [0, st[S.punchDmg], st[S.kickDmg], st[S.jkDmg]],
    stealth: st[S.stealth], classStealth: ps.classStealth, raceStealth: ps.raceStealth,
    hitMagic: st[S.hitMagic], hitMagicNonWeapon: ps.hitMagicNonWeapon,
    encumPct: ps.encumPct, encumCurrent: st[S.curEnc], encumMax: st[S.maxEnc],
    spellcasting: sum.spellcasting ? sum.spellcasting.total : 0, spellDmgBonus: st[S.spellDmg],
    maxMana: sum.maxMana ? sum.maxMana.total : 0, manaRegen: sum.manaRegen || 0,
    hp: sum.hp ? sum.hp.avg : st[S.hp], hpRegen: sum.restResting,
    weapons: [(c.equipped || [])[WEAPON_SLOT] || 0, (c.equipped || [])[OFFHAND_SLOT] || 0],
    accyAbils: ps.accyAbils, accyOther: ps.accyOther, accyItems: ps.accyItems,
    ac: ps.acInt, dr: ps.drInt, protEvil: st[S.protEvil],
    mr: sum.mr, antiMagic: !!c.antiMagic,
  });
  return p;
}

// ---------------------------------------------------------------- party / generic

// The by-lair party boxes (txtMonsterLairFilter(0..9), txtMonsterDamageOUT),
// kept under MME's [MonsterFilter] .mmec keys in char.monsterFilter. size is
// 1 unless the Monsters tab is in by-lair mode (optMonsterFilter(1)).
export const PARTY_KEYS = ['MonLairFilterTXT0', 'MonLairFilterTXT1', 'MonLairFilterTXT2', 'MonLairFilterTXT3',
  'MonLairFilterTXT4', 'MonLairFilterTXT5', 'MonLairFilterTXT6', 'MonLairFilterTXT7', 'MonLairFilterTXT8',
  'MonLairFilterTXT9', 'MonPartyDmgOUT', 'MonPartyMagDmgOUT'];
const PARTY_DEFAULTS = [1, 10, 0, 50, 0, 9999, 0, 1, 999, 1, 99999, 99999];   // frmMain's ReadINI defaults
export function partyFromChar(c, byLair = false) {
  const mf = (c && c.monsterFilter) || {};
  const v = PARTY_KEYS.map((k, i) => (mf[k] == null || mf[k] === '' ? PARTY_DEFAULTS[i] : Number(mf[k]) || 0));
  let size = byLair ? v[0] : 1;
  if (size < 1) size = 1;
  if (size > 6) size = 6;
  return { size, ac: v[1], dr: v[2], mr: v[3], dodge: v[4], hp: v[5], antiMagic: v[6], hpRegen: v[7],
    accy: v[8], swings: v[9], physical: v[10], spell: v[11] };
}

// The "no character" profile PopulateCharacterProfile builds when the global
// filter is off: max level, combat 5, 255 str/agi/stealth, can hit anything.
export function genericProfile(attackTypeMUD = 0) {
  const p = blankProfile();
  Object.assign(p, {
    level: getMaxLevel(), combat: 5, str: 255, agi: 255, stealth: 255, accuracy: 999, hitMagic: 9999,
    hitMagicNonWeapon: 9999, plusBSaccy: 999, classStealth: true, raceStealth: true, hp: 10000, hpRegen: 500,
  });
  if (attackTypeMUD >= 1 && attackTypeMUD <= 3) p.maSkill = [0, 1, 1, 1];
  return p;
}

// modMain.PopulateCharacterProfile(tChar, bForceUseChar, bForceNoParty,
// nAttackTypeMUD, , bForceNOchar). opt: globalFilter, byLair (Monsters tab
// in by-lair mode), forceChar, noParty, attackType (MUD.*), forceNoChar.
// The backstab accuracy swap MME does here for a4_Surprise happens inside
// combat.calculateAttack.
export function populateProfile(c, opt = {}) {
  const { globalFilter = false, byLair = false, forceChar = false, noParty = false, attackType = 0, forceNoChar = false } = opt;
  const useChar = globalFilter || forceChar;
  const party = noParty ? { size: 1 } : partyFromChar(c, byLair);
  let p;
  if (!forceNoChar && ((useChar && party.size < 2) || forceChar)) {
    p = profileFromChar(c, { globalFilter: useChar });
  } else if (party.size > 1 && !noParty) {
    p = blankProfile();
    Object.assign(p, { hp: Math.max(1, party.hp) * party.size, hpRegen: party.hpRegen * party.size,
      accuracy: party.accy, hitMagic: 9999, hitMagicNonWeapon: 9999 });
    if (attackType >= 1 && attackType <= 3) p.maSkill = [0, 1, 1, 1];
  } else {
    p = genericProfile(attackType);
  }
  p.party = party.size;
  if (p.hp < 1) p.hp = 1;
  if (p.hpRegen < 1) p.hpRegen = 1;
  if (p.accuracy < 0) p.accuracy = 0;
  if (p.accuracy > 9999999) p.accuracy = 9999999;
  if (p.encumPct > 100) p.encumPct = 100;
  return p;
}
