// Phase 7b: the combat math (js/mmud/combat.js, spellcalc.js, monsterattack.js)
// wired into the explorer tabs through details.hooks, the way MME fills those
// columns and detail lines:
//   Weapons   AddWeapon2LV's Dmg/Spd .. Dmg/1st columns, PullItemDetail's damage line
//   Spells    AddSpell2LV's Dmg, Dmg/M, Heal, Heal/M; CalculateSpellCast for Diff/detail
//   Monsters  GetPreCalculatedMonsterDamage (damage in, vs char / party), PullMonsterDetail's
//             "Dmg/Round" and "Damage vs Mob/Lair" rows, GetLairInfo's damage out
// plus the pieces other modules read: the EQ tab's Attk stat, the rooms
// tab's lair damage line, the Spell Book, and GetDamageOutput for exp/hr.
//
// The character is profileFromChar / populateProfile (PopulateCharacterProfile),
// the attack is char.attack (MME's nGlobalAttack* globals). Everything is cached
// per character/filter state and dropped on 'char' / 'filter' events.

import { by, db } from '../db.js';
import { char } from '../char.js';
import { settings, view, on, emit } from '../state.js';
import { engine } from '../mmud/engine.js';
import { populateProfile, partyFromChar, genericProfile, WEAPON_SLOT } from '../mmud/profile.js';
import { calcCharStats, S } from '../mmud/charstats.js';
import { ATTACK, MUD, calculateAttack, damageVsMonster, monsterDefense, calcCombatRounds, attackFromChar } from '../mmud/combat.js';
import { calculateSpellCast, getMaxLevel } from '../mmud/spellcalc.js';
import { monsterHasAttack, createMonsterSim } from '../mmud/monsterattack.js';
import { vbRound, fix, cint } from '../mmud/vb.js';
import { hooks, LAIR_FLAG_RATIO, lairAverages, autoAppend, truncate } from '../mmud/details.js';

export const MONSTER_SIM_ROUNDS = 500;   // nGlobalMonsterSimRounds
export const AUTO_CALC_MON_DAMAGE = true; // bAutoCalcMonDamage (settings default)

// ---------------------------------------------------------------- options the tabs set

// Weapons tab: chkWeaponOptions(3) "Calc. Combat", cmbWeaponCombos(1) attack,
// chkWeaponOptions(4) 85% speed, txtWeaponExtras(1) "Dmg >=". The target's
// AC/DR/dodge are char.weaponVsChar (txtWeaponExtras(2..4)).
export const weaponOpts = { calc: false, attack: MUD.normal, fast: false, minDmg: 0 };
// Spells tab: chkSpellOptions(0) "vs MR" (MR is char.spellVsMR) and (2) anti-magic.
export const spellOpts = { calc: false, antiMagic: false };

export const setWeaponOpts = o => { Object.assign(weaponOpts, o); bump(); };
export const setSpellOpts = o => { Object.assign(spellOpts, o); bump(); };

// ---------------------------------------------------------------- state + caches

let gen = 0;
const caches = new Set();
const cache = () => { const m = new Map(); caches.add(m); return m; };
function bump() { gen++; for (const m of caches) m.clear(); }
on('char', bump);
on('filter', bump);
export const generation = () => gen;

const useChar = () => !!settings.globalFilter;
const byLair = () => !!view.monstersByLair && engine.nmrVersion >= 1.83;
export const party = () => partyFromChar(char, byLair());

// The attack config damageVsMonster takes, from char.attack.
export const attackConfig = (c = char) => attackFromChar(c.attack, c.equipped);
// The CalculateAttack type GetDamageOutput uses for an MME attack type.
function mudTypeFor(a) {
  if (a.type === ATTACK.martial) return a.ma === 2 ? MUD.kick : a.ma === 3 ? MUD.jumpkick : MUD.punch;
  if (a.type === ATTACK.bash || a.type === ATTACK.smash) return a.type;
  return MUD.normal;
}

const profiles = cache();
// PopulateCharacterProfile(tChar, <global filter>, bForceNoParty, nAttackTypeMUD)
export function profile({ noParty = false, attackType = 0, forceChar = false } = {}) {
  const k = `${noParty}|${attackType}|${forceChar}`;
  if (!profiles.has(k)) {
    profiles.set(k, populateProfile(char, { globalFilter: useChar(), byLair: byLair(), noParty, attackType, forceChar }));
  }
  return profiles.get(k);
}

const stats = cache();
const charStats = () => { if (!stats.has(0)) stats.set(0, calcCharStats(char, { globalFilter: useChar() })); return stats.get(0); };

// ---------------------------------------------------------------- damage out (GetDamageOutput)

// modMain.GetDamageOutput against a monster (or, with monster null, the
// defences in vs). forceChar: bForceCharacter (party ignored).
const dmgOut = cache();
export function damageOut(monster, { vs = null, forceChar = false } = {}) {
  const key = monster ? `m${typeof monster === 'object' ? monster.Number : monster}|${forceChar}` : null;
  if (key && dmgOut.has(key)) return dmgOut.get(key);
  const a = attackConfig();
  const pty = forceChar ? { size: 1 } : party();
  const p = profile({ noParty: forceChar, attackType: mudTypeFor(a), forceChar });
  const opts = {};
  if (pty.size > 1) opts.party = pty;
  if (vs) opts.vs = vs;
  const r = damageVsMonster(p, a, monster, opts);
  if (key) dmgOut.set(key, r);
  return r;
}
export const damageOutVsMonster = m => damageOut(m);

// GetDamageOutput(0, avg AC, DR, MR, dodge, lair flags, ...) for a lair.
function lairDefense(info, averages) {
  const n = info.nMobs || 0;
  const flag = (cnt, ratio) => cnt > 0 && cnt >= n * ratio;
  const vs = { ac: info.nAvgAC || 0, dr: info.nAvgDR || 0, mr: info.nAvgMR || 0, dodge: info.nAvgDodge || 0,
    magicLevel: info.nMagicLVL || 0, spellImmuLevel: info.nSpellImmuLVL || 0,
    antiMagic: flag(info.nNumAntiMagic, 0.5), undead: flag(info.nNumUndeads, LAIR_FLAG_RATIO),
    living: flag(info.nNumLiving, LAIR_FLAG_RATIO), animal: flag(info.nNumAnimals, LAIR_FLAG_RATIO) };
  if (!averages) {
    Object.assign(vs, { bsDefense: info.nAvgBSDefense || 0, rcol: info.nAvgRCOL || 0, rfir: info.nAvgRFIR || 0,
      rsto: info.nAvgRSTO || 0, rlit: info.nAvgRLIT || 0, rwat: info.nAvgRWAT || 0 });
  }
  return vs;
}

const lairOut = cache();
hooks.lairDamageOut = (info, ctx, { averages = false } = {}) => {
  const key = `${info.sGroupIndex}|${info.nMaxRegen}|${averages}`;
  if (!lairOut.has(key)) {
    lairOut.set(key, { damage: damageOut(null, { vs: lairDefense(info, averages) }), mitigate: useChar() || party().size > 1 });
  }
  return lairOut.get(key);
};

// ---------------------------------------------------------------- damage in (monster vs character / party)

// nMonsterDamageVsChar / nMonsterDamageVsParty: filled per monster on demand
// (bAutoCalcMonDamage) or for all of them by calcAllMonsterDamage(). They
// survive character changes that leave the defences alone, as in MME, which
// keys them by the defence description.
const vsChar = new Map(), vsParty = new Map();
let vsCharKey = '', vsPartyKey = '';

// SetupMonsterAttackSimWithCharStats: the character's defences.
export function charDefenses() {
  const ps = charStats(), st = ps.stats;
  return { cls: char.cls || 0, ac: vbRound(st[S.ac]), dr: vbRound(st[S.dr]), mr: st[S.mr], dodge: st[S.dodge],
    antiMagic: !!char.antiMagic, protEvil: st[S.protEvil],
    rcol: st[S.resCold], rfir: st[S.resFire], rsto: st[S.resStone], rlit: st[S.resLightning], rwat: st[S.resWater] };
}
function partyDefenses() {
  const p = party();
  return { size: p.size, antiMagic: p.antiMagic, ac: p.ac, dr: p.dr, mr: p.mr, dodge: p.dodge };
}
function syncKeys() {
  const ck = JSON.stringify(charDefenses());
  if (ck !== vsCharKey) { vsChar.clear(); vsCharKey = ck; }
  const pk = JSON.stringify(partyDefenses());
  if (pk !== vsPartyKey) { vsParty.clear(); vsPartyKey = pk; }
}

// modMain.CalculateMonsterDamageVsChar(n, bPartyInstead). A party with some
// anti-magic members is simmed twice and averaged. Returns the average and
// the last sim's max round (clsMonAtkSim.nMaxRoundDamage).
function simDamage(m, partyInstead, rounds) {
  const run = def => { const sim = createMonsterSim(m, def, { rounds }); if (sim.numberOfRounds > 0) sim.run(); return sim; };
  if (!partyInstead) { const sim = run(charDefenses()); return { avg: sim.averageDamage, max: sim.maxRoundDamage }; }
  const p = partyDefenses();
  const base = { ac: p.ac, dr: p.dr, mr: p.mr, dodge: p.dodge };
  if (p.size < 2 || p.antiMagic < 1 || p.size === p.antiMagic) {
    const sim = run({ ...base, antiMagic: p.size === p.antiMagic });
    return { avg: sim.averageDamage, max: sim.maxRoundDamage };
  }
  const anti = p.antiMagic, non = p.size - anti;
  let t = 0, sim = null;
  if (anti > 0) { sim = run({ ...base, antiMagic: true }); t += sim.averageDamage * anti; }
  if (non > 0) { sim = run({ ...base, antiMagic: false }); t += sim.averageDamage * non; }
  return { avg: t / (anti + non), max: sim ? sim.maxRoundDamage : 0 };
}
export function calcMonsterDamage(n, partyInstead = false, rounds = MONSTER_SIM_ROUNDS) {
  syncKeys();
  const m = by.monster.get(n);
  if (!m) return { avg: 0, max: 0 };
  const r = simDamage(m, partyInstead, Math.min(10000, Math.max(100, rounds)));
  r.avg = vbRound(r.avg, 1);
  (partyInstead ? vsParty : vsChar).set(n, r.avg);
  return r;
}

// modMain.CalculateMonsterDamageVsCharALL, in slices so the page stays live.
// onProgress(done, total); resolves when finished or cancelled (signal.cancel).
export async function calcAllMonsterDamage(partyInstead = false, { onProgress, signal = {} } = {}) {
  syncKeys();
  const mons = db.Monsters;
  for (let i = 0; i < mons.length; i++) {
    if (signal.cancel) break;
    const m = mons[i];
    if (monsterHasAttack(m)) calcMonsterDamage(m.Number, partyInstead);
    else (partyInstead ? vsParty : vsChar).set(m.Number, 0);
    if (i % 40 === 39) { if (onProgress) onProgress(i + 1, mons.length); await new Promise(r => setTimeout(r)); }
  }
  if (onProgress) onProgress(mons.length, mons.length);
  bump();
  emit('filter', { key: 'monsterDamage' });
}
export function monsterDamageCalculated(partyInstead = false) {
  syncKeys();
  return (partyInstead ? vsParty : vsChar).size;
}

// modMain.GetPreCalculatedMonsterDamage(n, sReturn, nParty)
export function monsterDamageIn(n) {
  syncKeys();
  const size = party().size;
  if (size > 1 && vsParty.has(n)) return { damage: vsParty.get(n), vs: 'vs Party', calculated: true };
  if (size === 1 && useChar() && vsChar.has(n)) return { damage: vsChar.get(n), vs: 'vs Char', calculated: true };
  const m = by.monster.get(n);
  return { damage: m ? m.AvgDmg : 0, vs: '(default)', calculated: false };
}
hooks.monsterDamageIn = monsterDamageIn;
// The "vs" label GetPreCalculatedMonsterDamage(0) gives.
export function damageInLabel() {
  if (party().size > 1) return 'vs Party';
  return useChar() ? 'vs Char' : '(default)';
}

// ---------------------------------------------------------------- weapons

const weaponAtk = cache();
// AddWeapon2LV's CalculateAttack for one weapon with the Weapons tab options.
export function weaponAttack(item) {
  const it = typeof item === 'object' ? item : by.item.get(item);
  if (!it) return null;
  if (weaponAtk.has(it.Number)) return weaponAtk.get(it.Number);
  const type = weaponOpts.calc ? weaponOpts.attack : MUD.normal;
  const vs = weaponOpts.calc ? char.weaponVsChar || {} : {};
  const p = profile({ noParty: true, attackType: type });
  // FilterWeapons asks before forcing race stealth for a backstab; here it's forced
  const force = type === MUD.surprise && useChar() && !p.classStealth && !p.raceStealth && char.cls > 0 && char.race > 0;
  const r = calculateAttack(p, type, it, { speedAdj: weaponOpts.calc && weaponOpts.fast ? 85 : 100,
    vsAC: vs.ac || 0, vsDR: vs.dr || 0, vsDodge: vs.dodge || 0, forceCalc: force });
  r.forced = force;
  r.type = type;
  weaponAtk.set(it.Number, r);
  return r;
}

// The weapon columns AddWeapon2LV adds after Limit.
const w = it => weaponAttack(it) || {};
hooks.columns.weapons.push(
  { key: 'dmgspd', label: 'Dmg/Spd', num: true, width: '4.5em', get: it => {
    const r = w(it);
    if (r.type !== MUD.surprise && it.Speed > 0 && r.roundTotal > 0 && r.swings > 0) return vbRound(r.roundTotal / r.swings / it.Speed, 4) * 1000;
    return 0;
  }, fmt: v => String(vbRound(v, 1)) },
  { key: 'swings', label: '#Swings', num: true, width: '4.5em', get: it => truncate(w(it).swings || 0, 2) },
  { key: 'xswings', label: 'xSwings', num: true, width: '4.5em', get: it => (w(it).type === MUD.surprise ? w(it).avgHit : w(it).roundPhysical) || 0 },
  { key: 'extra', label: 'Extra', num: true, width: '3.5em', get: it => {
    const r = w(it);
    return r.avgExtraSwing > 0 && r.swings > 0 && r.hitChance > 0 ? vbRound(r.avgExtraSwing * r.swings * (r.hitChance / 100)) : 0;
  } },
  { key: 'dmgrnd', label: 'Dmg/Rnd', num: true, width: '4.5em', get: it => w(it).roundTotal || 0 },
  { key: 'dmg1st', label: 'Dmg/1st', num: true, width: '4.5em',
    get: it => (w(it).firstRoundDamage || 0) + vbRound((w(it).roundTotal || 0) / 100, 2), fmt: (v, it) => String(w(it).firstRoundDamage || 0) },
);
// Min/Max/Speed show the calculated values when "Calc. Combat" is on.
export const weaponMin = it => (weaponOpts.calc ? w(it).minDmg ?? it.Min : it.Min);
export const weaponMax = it => (weaponOpts.calc ? w(it).maxDmg ?? it.Max : it.Max);
export const weaponSpeed = it => (w(it).attackSpeed > 0 ? w(it).attackSpeed : it.Speed);
export const weaponPassesDmg = it => !(weaponOpts.minDmg > 0) || (w(it).roundTotal || 0) >= weaponOpts.minDmg;

const ATTACK_LABEL = { 1: 'Punch Damage', 2: 'Kick Damage', 3: 'Jumpkick Damage', 4: 'Backstab Damage', 6: 'Bash Damage', 7: 'Smash Damage' };

// PullItemDetail's weapon damage block.
hooks.weaponDamageText = (item, ctx = {}) => {
  const r = weaponAttack(item);
  if (!r || !(r.swings > 0)) return '';
  let s = ATTACK_LABEL[r.type] || 'Damage';
  if (!useChar()) s += ` (@lvl ${getMaxLevel()})`;
  s += `: ${r.roundTotal}/round @ ${truncate(r.swings, 1)} swings w/${r.hitChance}% hit chance`;
  if (r.type === MUD.surprise && r.forced) s += ' (forced race stealth)';
  s += ' - Avg Hit: ' + r.avgHit;
  if (r.maxCrit > 0 && r.critChance > 0) {
    s = autoAppend(s, `Avg/Max Crit: ${r.avgCrit}/${r.maxCrit}`);
    s += ` (${r.critChance}%` + (r.qndBonus > 0 ? ` w/${r.qndBonus}qnd` : '') + ')';
  }
  if (r.avgExtraHit > 0) {
    s = autoAppend(s, 'Avg Extra: ' + r.avgExtraHit);
    if (r.avgExtraHit !== r.avgExtraSwing) s += ` (avg ${r.avgExtraSwing}/swing)`;
  }
  if (r.roundTotal > 0 && r.roundTotal !== r.firstRoundDamage && r.swings !== fix(r.swings)) {
    s += ` - 1st Round: ${r.firstRoundDamage} dmg @ ${fix(r.swings)} swings`;
  }
  if (ctx.fullDetails) {
    let lvl = 0, acc = 0, bs = 0;
    for (let x = 0; x < 20; x++) {
      const a = item['Abil-' + x], v = item['AbilVal-' + x];
      if (a === 135) lvl = v; else if (a === 116) bs = v; else if (a === 22 || a === 105 || a === 106) acc += v;
    }
    acc += item.Accy;
    let t = `Min/Max Hit: ${r.minDmg}/${r.maxDmg}, Speed: ${item.Speed}`;
    if (lvl > 0) t += ', LVL Req: ' + lvl;
    if (item.StrReq > 0) t += ', STR Req: ' + item.StrReq;
    if (item.ArmourClass + item.DamageResist > 0) t += `, AC/DR: ${Math.ceil(item.ArmourClass / 10)}/${item.DamageResist / 10}`;
    if (acc > 0) t += ', Accy: ' + acc;
    t += ', BS: ' + (bs > 0 ? bs : 'No');
    if (item.Limit > 0) t += ', Limit: ' + item.Limit;
    s = t + '\n' + s;
  }
  s += '\n';
  if (useChar()) {
    const str = charStats().eff.str;
    if (item.StrReq > str) s += `Notice: Character Strength (${str}) < Strength Requirement (${item.StrReq})\n`;
  }
  return s + '\n';
};

// ---------------------------------------------------------------- spells

// AddSpell2LV / PullSpellDetail's CalculateSpellCast. Only with the global
// filter on and "vs MR" ticked does the target's MR (char.spellVsMR) count.
// generic: the max-level "no character" profile (the Spell Book uses it
// unless its boxes match the character).
const casts = cache();
export function spellCast(sp, castLevel, generic = false) {
  const k = `${sp.Number}|${castLevel}|${generic}`;
  if (casts.has(k)) return casts.get(k);
  const p = generic ? genericProfile() : profile({ noParty: true });
  const mr = Number(char.spellVsMR) || 0;
  const r = !generic && useChar() && spellOpts.calc && mr > 0
    ? calculateSpellCast(p, sp, castLevel, { vsMR: mr, vsAntiMagic: spellOpts.antiMagic })
    : calculateSpellCast(p, sp, castLevel);
  casts.set(k, r);
  return r;
}
hooks.spellCast = (sp, castLevel, ctx = {}) => spellCast(sp, castLevel, !!ctx.generic);

// The cast level AddSpell2LV uses: the character's level with the global
// filter, else the (max level) generic profile's.
export const spellCastLevel = () => (useChar() && char.level > 0 ? char.level : getMaxLevel());

// AddSpell2LV's Dmg / Dmg/M / Heal / Heal/M.
export function spellColumns(sp, castLevel = spellCastLevel(), generic = false) {
  const c = spellCast(sp, castLevel, generic);
  const area = [3, 5, 9, 10, 11, 12, 13].includes(sp.Targets) ? '^' : '';
  const out = { dmg: 0, dmgText: '0', dmgPerMana: 0, heal: 0, healText: '0', healPerMana: 0 };
  if (!(sp.Learnable === 1 || sp.ManaCost > 0)) return out;
  const mana = sp.ManaCost > 0 ? (c.nNumCasts > 1 ? sp.ManaCost * c.nNumCasts : sp.ManaCost) : 0;
  const spread = (v) => c.nDuration > 1 && v > 0 && v === c.nMinCast && c.nMaxCast > c.nMinCast;
  out.dmg = spread(c.nAvgRoundDmg) ? vbRound((c.nMinCast * c.nDuration + c.nMaxCast * c.nDuration) / 2) : vbRound(c.nAvgRoundDmg * c.nDuration);
  out.dmgText = out.dmg + (c.nAvgRoundDmg > 0 ? area : '');
  if (c.nAvgRoundDmg > 0 && sp.ManaCost > 0) out.dmgPerMana = c.nNumCasts > 1 ? vbRound(c.nAvgRoundDmg / mana, 1) : vbRound(out.dmg / sp.ManaCost, 1);
  out.heal = spread(c.nAvgRoundHeals) ? vbRound((c.nMinCast * c.nDuration + c.nMaxCast * c.nDuration) / 2) : cint(c.nAvgRoundHeals * c.nDuration);
  out.healText = out.heal + (c.nAvgRoundHeals > 0 ? area : '');
  if (c.nAvgRoundHeals !== 0 && sp.ManaCost > 0) out.healPerMana = c.nNumCasts > 1 ? vbRound(c.nAvgRoundHeals / mana, 1) : vbRound(out.heal / sp.ManaCost, 1);
  return out;
}
const sc = sp => spellColumns(sp);
hooks.columns.spells.push(
  { key: 'dmg', label: 'Dmg', num: true, width: '4em', get: sp => sc(sp).dmg, fmt: (v, sp) => sc(sp).dmgText },
  { key: 'dmgm', label: 'Dmg/M', num: true, width: '4em', get: sp => sc(sp).dmgPerMana },
  { key: 'heal', label: 'Heal', num: true, width: '4em', get: sp => sc(sp).heal, fmt: (v, sp) => sc(sp).healText },
  { key: 'healm', label: 'Heal/M', num: true, width: '4em', get: sp => sc(sp).healPerMana },
);

// ---------------------------------------------------------------- monsters

// AddMonster2LV's "Damage": damage in, purple when worked out vs char/party.
// (The Monsters tab reads monsterDamageIn through hooks for its own column.)

// PullMonsterDetail rows. Chains onto any other monsterDamageRows hook (exp/hr).
const prevRows = hooks.monsterDamageRows;
hooks.monsterDamageRows = (mon, ctx = {}) => {
  const mine = ctx.part === 'vsChar' ? damageInRows(mon) : ctx.part === 'damageOut' ? damageOutRows(mon, ctx) : [];
  const theirs = prevRows ? prevRows(mon, ctx) || [] : [];
  return [...mine, ...theirs];
};

function damageInRows(mon) {
  const rows = [];
  const n = mon.Number;
  const one = (partyInstead, cls, who) => {
    syncKeys();
    const store = partyInstead ? vsParty : vsChar;
    let d = -1, max = null;
    if (AUTO_CALC_MON_DAMAGE) ({ avg: d, max } = calcMonsterDamage(n, partyInstead));
    else if (store.has(n)) d = store.get(n);
    if (d >= 0) rows.push({ label: 'Dmg/Round *', cls,
      text: `AVG: ${d}${max != null ? ', Max Seen: ' + max : ''}   * versus current ${who} defenses, ${MONSTER_SIM_ROUNDS} round sim` });
  };
  if (useChar()) one(false, 'purple', 'character');
  if (party().size > 1) one(true, 'amber', 'PARTY');
  return rows;
}

// modMain.AddMonsterDamageOutText
function damageOutText(rows, header, detail, { detail2 = '', damageOut = -9999, mobHealth = 0, mobHPRegen = 0, mobDamage = -1,
  charHealth = 0, defenseText = '', numMobs = 1, oom = 0, overrideRTK = 0, surpriseDamageOut = -9999, surpriseText = '',
  firstRoundDamageOut = -9999 } = {}) {
  const cr = calcCombatRounds({ damageOut, mobHealth, mobDamage, charHealth, mobHPRegen, numMobs, overrideRTK,
    surpriseDamageOut, firstRoundDamageOut });
  rows.push({ label: header, text: detail, cls: /immune:/i.test(detail) ? 'red' : 'b' });
  if (surpriseDamageOut > 0 && surpriseText) rows.push({ label: '', text: surpriseText, cls: '' });
  if (detail2) rows.push({ label: '', text: detail2, cls: '' });
  if ((cr.sRTK + cr.sRTD).length) {
    const text = cr.sRTK && cr.sRTD ? autoAppend(cr.sRTK, cr.sRTD, ' ') + cr.sSuccess + defenseText : cr.sRTK + cr.sRTD + cr.sSuccess;
    let cls = '';
    if (cr.nRTD > 0 && cr.nRTK > 1 && cr.nSuccess < 70) cls = 'red';
    else if (cr.nRTD >= 1 && cr.nSuccess >= 95) cls = 'green';
    rows.push({ label: '', text, cls });
  }
  if (oom > 0 && oom < 100) {
    const ext = useChar() && ((charStats().bless || {}).manaPerTick > 0) ? ' (with current heals/bless set)' : '';
    rows.push({ label: '', text: `OOM in ${oom} rounds${ext}`, cls: oom * 0.9 < cr.nRTK * 1.1 ? 'red' : '' });
  }
  rows.push({ label: '', text: '', cls: '' });
}

// The "Damage vs Mob" / "Damage vs Lair" part of PullMonsterDetail.
function damageOutRows(mon, ctx) {
  const rows = [];
  const n = mon.Number, nmr = engine.nmrVersion;
  const a = attackConfig();
  const pty = party().size;
  const charProf = profile();
  // tForcedCharProfile: this character (or the generic one), never the party
  const forced = a.type === ATTACK.martial || pty > 1 ? profile({ noParty: true, attackType: a.type === ATTACK.martial ? mudTypeFor(a) : 0 }) : charProf;

  let mobDmg, defDesc;
  const din = monsterDamageIn(n);
  if (pty > 1 && din.calculated) { mobDmg = din.damage; defDesc = ' (vs party defenses)'; }
  else if (useChar() && din.calculated) { mobDmg = din.damage; defDesc = ' (vs char defenses)'; }
  else { mobDmg = mon.AvgDmg; defDesc = ' (vs default defenses)'; }

  const lair = nmr >= 1.83 && /lair/i.test(mon['Summoned By'] || '') ? lairAverages(mon['Summoned By'], ctx) : { nTotalLairs: 0 };

  let weaponMagic = 0, bsMagic = 0;
  if (pty === 1) {
    if (a.type === ATTACK.oneshot) weaponMagic = 9999;
    else if (a.type === ATTACK.martial || a.type === ATTACK.spell || a.type === ATTACK.spellAny) weaponMagic = charProf.hitMagicNonWeapon;
    else weaponMagic = charProf.hitMagic;
    if (a.type > ATTACK.oneshot && a.backstab) {
      const bw = a.backstabWeapon || a.weapon;
      if (bw > 0) {
        bsMagic = itemAbil(bw, 28);
        const hm = itemAbil(bw, 142);
        if (hm > -500) bsMagic = engine.greater ? Math.max(bsMagic, hm) : bsMagic + hm;   // TODO GreaterMUD: verify
        bsMagic = engine.greater ? Math.max(bsMagic, charProf.hitMagicNonWeapon) : bsMagic + charProf.hitMagicNonWeapon;
      } else bsMagic = charProf.hitMagicNonWeapon;
    }
  }
  if (weaponMagic < 0) weaponMagic = 0;
  if (bsMagic < 0) bsMagic = 0;

  const md = monsterDefense(mon);
  for (let iAttack = 1; iAttack <= (lair.nTotalLairs > 0 ? 2 : 1); iAttack++) {
    let header, avgDmg, hp, hpRegen, vs, numMobs, overrideRTK = 0;
    if (iAttack === 1) {
      header = 'Damage vs Mob'; avgDmg = mobDmg; hp = mon.HP; hpRegen = mon.HPRegen; numMobs = 1;
      vs = { ...md, dodge: Math.max(0, md.dodge) };
    } else {
      header = 'Damage vs Lair'; avgDmg = lair.nAvgDmgLair; hp = lair.nAvgHP; hpRegen = 0; numMobs = lair.nMaxRegen;
      overrideRTK = lair.nRTK;
      vs = { ...monsterDefense(null), ...lairDefense(lair, false) };
    }
    const common = { mobHealth: hp, mobHPRegen: hpRegen, mobDamage: avgDmg, charHealth: charProf.hp, defenseText: defDesc,
      numMobs, overrideRTK };
    if (pty > 1 || a.type === ATTACK.manual) {
      const per = pty > 1 ? '/round (party)' : '/round (manual)';
      let d;
      if (iAttack === 2) {
        d = { averageDamage: lair.nDamageOut, firstRoundDamage: lair.nFirstRoundDamageOut, surpriseDamage: lair.nSurpriseDamageOut };
      } else d = damageOut(mon);
      let dmg = d.averageDamage, sur = d.surpriseDamage, immu = '', bsText = '';
      if (iAttack === 2) { if (sur > 0) bsText = ` + ${sur} surprise round`; }
      else if (sur > -9999) {
        if (sur === -9998) { sur = -9999; bsText = ' + 0 surprise round [immune:MagicLVL]'; }
        else bsText = ` + ${sur} surprise round`;
      }
      if (dmg === -9998) { immu = ' [immune:MagicLVL]'; dmg = 0; }
      damageOutText(rows, header, `${dmg}${per}${immu}${bsText}`, { ...common, damageOut: dmg, surpriseDamageOut: sur,
        firstRoundDamageOut: d.firstRoundDamage });
      continue;
    }

    let sur = 0, bsText = '', bsDetail = '';
    if (a.type > ATTACK.oneshot && a.backstab) {
      if (vs.magicLevel > 0 && bsMagic < vs.magicLevel) { sur = 0; bsText = ' + 0 surprise round [immune:MagicLVL]'; }
      else {
        const bw = a.backstabWeapon > 0 ? a.backstabWeapon : a.backstabWeapon === 0 && a.weapon > 0 ? a.weapon : 0;
        const bp = populateProfile(char, { globalFilter: useChar(), noParty: true, attackType: MUD.surprise });
        const bs = calculateAttack(bp, MUD.surprise, bw, { vsAC: vs.ac, vsDR: vs.dr, vsDodge: vs.dodge,
          bsDefense: nmr >= 1.83 ? mon.BSDefense : 0 });
        sur = bs.avgHit + bs.avgExtraHit;
        bsText = ` + ${sur} surprise round`;
        bsDetail = bs.attackDetail;
      }
    }
    const opt = { ...common, surpriseDamageOut: sur, surpriseText: bsDetail };
    switch (a.type) {
      case ATTACK.weapon: case ATTACK.bash: case ATTACK.smash: case ATTACK.martial: {
        const t = calculateAttack(forced, mudTypeFor(a), a.type === ATTACK.martial ? 0 : a.weapon,
          { vsAC: vs.ac, vsDR: vs.dr, vsDodge: vs.dodge });
        let dmg, first, immu = '';
        if (vs.magicLevel > 0 && weaponMagic < vs.magicLevel) { dmg = 0; first = 0; opt.overrideRTK = 0; immu = ' [immune:MagicLVL]'; }
        else { dmg = t.roundTotal; first = t.firstRoundDamage; }
        damageOutText(rows, header, `${dmg}/round (${t.attackDesc})${immu}${bsText}`,
          { ...opt, detail2: t.attackDetail, damageOut: dmg, firstRoundDamageOut: first });
        break;
      }
      case ATTACK.spell: case ATTACK.spellAny: {
        if (!(a.spell > 0)) break;
        const sp = by.spell.get(a.spell);
        const c = calculateSpellCast(forced, a.spell, a.type === ATTACK.spellAny ? a.spellLevel : forced.level,
          { vsMR: vs.mr, vsAntiMagic: !!vs.antiMagic, vsRcol: vs.rcol, vsRfir: vs.rfir, vsRsto: vs.rsto, vsRlit: vs.rlit, vsRwat: vs.rwat });
        let valid = false, undead = false, animal = false, living = false;
        const immuLvl = vs.spellImmuLevel || 0;
        const immuOk = immuLvl === 0 || c.nRequiredLevel > immuLvl || (c.nRequiredLevel === 0 && c.nCastLevel > immuLvl);
        for (let x = 0; x <= 9; x++) {
          const ab = sp && sp['Abil-' + x];
          if (ab === 23) undead = true; else if (ab === 80) animal = true; else if (ab === 108) living = true;
        }
        if (immuOk) {
          if (!undead && !animal && !living) valid = true;
          else if (undead) valid = !!vs.undead;
          else if (animal) valid = !!vs.animal;
          else valid = !!vs.living;
        }
        let dmg = 0, immu = '';
        if (valid) dmg = c.nAvgRoundDmg;
        else {
          if (!immuOk) immu = autoAppend(immu, 'SpellImmuLVL', '+');
          if (undead && !vs.undead) immu = autoAppend(immu, 'NotUndead', '+');
          if (animal && !vs.animal) immu = autoAppend(immu, 'NotAnimal', '+');
          if (living && !vs.living) immu = autoAppend(immu, 'NotLiving', '+');
          immu = ` [immune:${immu}]`;
        }
        damageOutText(rows, header, `${immu === '' ? c.sAvgRound : 0}/round (${c.sSpellName})${immu}${bsText}`,
          { ...opt, detail2: c.sMMA, damageOut: dmg, firstRoundDamageOut: dmg, oom: c.nOOM });
        break;
      }
      default:
        damageOutText(rows, header, '(assuming one-shot)', {});
    }
  }
  return rows;
}
const itemAbil = (n, abil) => {
  const it = by.item.get(n);
  if (!it) return -31337;
  let v = -31337;
  for (let x = 0; x <= 19; x++) if (it['Abil-' + x] === abil) v = (v === -31337 ? 0 : v) + it['AbilVal-' + x];
  return v;
};

// ---------------------------------------------------------------- EQ tab Attk stat

// CalcCharacterStats' lblInvenCharStat(46): GetDamageOutput(0, AC 0, DR 0, MR 50,
// dodge 0, bForceCharacter) and GetCurrentAttackName(True) for its tooltip.
export function attkStat() {
  const d = damageVsMonster(profile({ noParty: true, forceChar: true, attackType: mudTypeFor(attackConfig()) }),
    attackConfig(), null, { vs: { ac: 0, dr: 0, mr: 50, dodge: 0 } });
  if (d.swings === 0) return { text: '0', tip: '', cls: '' };
  const dmg = d.averageDamage > -9000 ? d.averageDamage : 0;
  const bs = d.surpriseDamage > -9000 ? '+' + d.surpriseDamage : '';
  let text, cls = '';
  if (dmg > 999999) text = 'one-shot';
  else if (dmg !== 0) { text = `${vbRound(dmg)}${bs} @ ${truncate(d.swings, 2)}`; cls = 'orange'; }
  else { text = String(d.swings); cls = 'yellow'; }
  if (text.length > 12) text = text.replace(/ /g, '');
  return { text, tip: currentAttackName(true), cls };
}

// modMain.GetCurrentAttackName(bForceAttackDesc)
export function currentAttackName(desc = false) {
  const a = attackConfig();
  let s = '';
  switch (a.type) {
    case ATTACK.weapon: case ATTACK.bash: case ATTACK.smash:
      if (a.weapon > 0) {
        s = a.type === ATTACK.bash ? 'bash' : a.type === ATTACK.smash ? 'smash' : desc ? 'normal attack' : 'weapon';
        if (desc) s += ' w/' + nameOf(by.item.get(a.weapon));
      } else s = 'no wepn!';
      break;
    case ATTACK.spell:
      if (desc) s = nameOf(by.spell.get(a.spell)) + ' / ';
      s += (by.spell.get(a.spell) || {}).Short || '';
      if (desc) s += ' @ LVL';
      break;
    case ATTACK.spellAny:
      if (desc) s = nameOf(by.spell.get(a.spell)) + ' / ';
      s += ((by.spell.get(a.spell) || {}).Short || '') + '@' + a.spellLevel;
      break;
    case ATTACK.martial: s = a.ma === 2 ? 'kick' : a.ma === 3 ? 'jumpkick' : 'punch'; break;
    case ATTACK.manual:
      if (a.manualPhys + a.manualMag === 0) s = 'zero';
      else if (a.manualPhys > 0 && a.manualMag <= 0) s = a.manualPhys + ' phys';
      else if (a.manualPhys <= 0 && a.manualMag > 0) s = a.manualMag + ' mag';
      else s = 'man dmg';
      break;
    default: s = 'one-shot';
  }
  if (a.type > ATTACK.oneshot && a.backstab) {
    s = desc && a.backstabWeapon > 0 ? autoAppend(s, '+bs', '\n') : s + '+bs';
    if (a.backstabWeapon > 0) s += desc ? ' w/' + nameOf(by.item.get(a.backstabWeapon)) : '*';
  }
  return s;
}
const nameOf = r => (r ? r.Name : '?');

// ---------------------------------------------------------------- rooms

// MapMapExits' lair line: "Dmg vs Char: n/clear" from GetLairInfo.nAvgDmgLair.
export function lairDamageLine(info) {
  if (!info || !info.nAvgDmgLair) return '';
  return `Dmg ${damageInLabel()}: ${info.nAvgDmgLair}/clear`;
}
// The character's illumination (lblInvenCharStat(23)); MME reads it whatever the global filter.
export const charIllumination = () => charStats().stats[S.illu] || 0;

