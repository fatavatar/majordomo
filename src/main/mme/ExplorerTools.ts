/**
 * MMUD Explorer's Tools tab (2026-10-19): mudtool's calculators
 * (`../mudtool/js/tools/*.js`), their maths the vendored `mmud/` modules',
 * each answered for the character as the game reports it — the profile they
 * open on is `profileFromChar` of the character `useEqCharacter` makes, its
 * pack and the blessings up counted, as the EQ tab counts them.
 */
import { by, db } from './vendor/js/db.js';
import type { Row } from './vendor/js/db.js';
import { engine } from './vendor/js/mmud/engine.js';
import { ALIGNMENTS, char } from './vendor/js/char.js';
import {
  adjustSpeedForSlowness,
  backstabRange,
  calcEncumbrancePercent,
  calcEnergyUsed,
  calcQuickAndDeadlyBonus,
  calcTrueAverage,
  calculateAttack,
  calculateAttackDefense,
  calculateBackstabAccuracy,
  classStealth,
  EVIL,
  getDodgeCap,
  getHitCap,
  getHitMin,
  monsterDefense,
  MUD,
  swingTable,
  weaponStats
} from './vendor/js/mmud/combat.js';
import { profileFromChar } from './vendor/js/mmud/profile.js';
import { expChart, expRows, getMaxLevel } from './vendor/js/mmud/exp.js';
import { applyCharm, charmModifier, coinWeight, convertCoin } from './vendor/js/mmud/coins.js';
import { spellBook } from './vendor/js/mmud/spellbook.js';
import { createMonsterSim } from './vendor/js/mmud/monsterattack.js';
import { magery } from './vendor/js/mmud/enums.js';
import { plain, spellCols } from './vendor/js/mmud/details.js';
import { spellColumns } from './vendor/js/hooks/combat.js';
import { vbRound } from './vendor/js/mmud/vb.js';
import { supported, useEqCharacter, useRealm, type MmeRealm } from './Explorer';
import type { CharacterState } from '../../shared/character';
import { DEFAULT_EQ_PLAN } from '../../shared/explorer';
import type {
  AttackSimInput,
  AttackSimOutput,
  BackstabInput,
  BackstabOutput,
  HitInput,
  HitOutput,
  SpellBookRow,
  SwingInput,
  SwingOutput,
  ToolAnswer,
  ToolMonster,
  ToolProfile,
  ToolRequest,
  ToolsStart
} from '../../shared/explorerTools';

const WEAPON_SLOT = 16;

/** What a realm mudtool does not compute opens with. */
const NO_TOOLS: ToolsStart = {
  supported: false,
  weapons: [],
  bsWeapons: [],
  monsters: [],
  classes: [],
  races: [],
  alignments: [],
  maxLevel: 0,
  profile: {
    cls: 0,
    race: 0,
    level: 0,
    combat: 0,
    str: 0,
    agi: 0,
    charm: 0,
    encum: 0,
    maxEncum: 0,
    weapon: 0,
    stealth: 0,
    classStealth: false,
    plusMaxDamage: 0,
    bsMin: 0,
    bsMax: 0,
    accuracy: 0,
    bsAccuracy: 0,
    ac: 0,
    dr: 0,
    dodge: 0,
    protEvil: 0,
    mr: 0,
    antiMagic: false,
    chart: 100
  }
};

/** A record as a picker's entry. */
const entry = (row: Row): [number, string] => [row['Number'] as number, String(row['Name'])];
const byName = (a: [number, string], b: [number, string]): number => a[1].localeCompare(b[1]);
/** mudtool's `common.js` lists: weapons, and monsters but its `sdf` placeholders. */
const weaponRows = (): Row[] => (db.Items as Row[]).filter((item) => item['ItemType'] === 1);
const hasBS = (item: Row): boolean =>
  Array.from({ length: 20 }, (_, x) => item[`Abil-${x}`]).includes(116);

/** The character's profile, as `charProfile` (`common.js`) gives it to every calculator. */
function profileNow(): Record<string, unknown> {
  return profileFromChar(char, { globalFilter: true });
}

/** frmBSCalc's backstab accuracy for the character, with its weapon (`frmHitCalc.SetHitCalcVals`). */
function bsAccuracy(p: Record<string, unknown>): number {
  const weapons = p['weapons'] as number[];
  const bsWep = weapons[0] ?? 0;
  const n = (key: string): number => (p[key] as number | undefined) ?? 0;
  return calculateBackstabAccuracy(
    n('stealth'),
    n('agi'),
    n('plusBSaccy'),
    classStealth(n('cls')),
    n('accyAbils') + n('accyOther') + (engine.greater ? n('accyItems') : 0),
    n('level'),
    n('str'),
    (by.item.get(bsWep)?.['StrReq'] as number | undefined) ?? 0
  );
}

function start(): ToolsStart {
  const p = profileNow();
  const n = (key: string): number => (p[key] as number | undefined) ?? 0;
  const profile: ToolProfile = {
    cls: char.cls,
    race: char.race,
    level: char.level,
    combat: n('combat'),
    str: n('str'),
    agi: n('agi'),
    charm: n('cha'),
    encum: n('encumCurrent'),
    maxEncum: n('encumMax'),
    weapon: char.equipped[WEAPON_SLOT] ?? 0,
    stealth: n('stealth'),
    classStealth: char.cls > 0 && classStealth(char.cls) > 0,
    plusMaxDamage: n('plusMaxDamage'),
    bsMin: n('plusBSmindmg'),
    bsMax: n('plusBSmaxdmg'),
    accuracy: n('accuracy'),
    bsAccuracy: bsAccuracy(p),
    ac: n('ac'),
    dr: n('dr'),
    dodge: n('dodge'),
    protEvil: n('protEvil'),
    mr: n('mr'),
    antiMagic: p['antiMagic'] === true,
    chart: expChart(char.cls, char.race) || 100
  };
  return {
    supported: true,
    weapons: weaponRows().map(entry).sort(byName),
    bsWeapons: weaponRows().filter(hasBS).map(entry).sort(byName),
    monsters: (db.Monsters as Row[])
      .filter((m) => String(m['Name'] ?? '') !== '' && !String(m['Name']).startsWith('sdf'))
      .map(entry)
      .sort(byName),
    classes: (db.Classes as Row[]).map(entry).sort(byName),
    races: (db.Races as Row[]).map(entry).sort(byName),
    alignments: [...ALIGNMENTS],
    maxLevel: getMaxLevel(),
    profile
  };
}

/** frmSwingCalc's `calc` and `trueAvg`. */
function swing(s: SwingInput): SwingOutput {
  const it = by.item.get(s.weapon) as Row | undefined;
  const none: SwingOutput = {
    found: false,
    energy: 0,
    encPct: 0,
    rawSwings: 0,
    qnd: 0,
    strengthShort: null,
    rounds: [],
    roundTotal: 0,
    trueAverage: 0
  };
  if (it === undefined) return none;
  let wSpeed = it['Speed'] as number;
  if (s.slow) wSpeed = adjustSpeedForSlowness(wSpeed);
  const encPct = calcEncumbrancePercent(s.encum, s.maxEncum);
  const spd = [85, 0, 125, s.customSpeed < 0 ? 0 : s.customSpeed][s.speed] ?? 0;
  const strReq = it['StrReq'] as number;
  let energy = calcEnergyUsed(s.combat, s.level, wSpeed, s.agi, s.str, encPct, strReq, spd);
  if (s.bash) energy *= 2;
  const qnd = s.str < strReq ? 0 : calcQuickAndDeadlyBonus(s.agi, energy, encPct);
  const rawSwings = energy === 0 ? 0 : vbRound(1000 / energy, 4);
  const rounds =
    energy === 0
      ? Array.from({ length: 10 }, () => ({ swings: 0, energyLeft: 0 }))
      : swingTable(energy);
  const p = profileNow();
  Object.assign(p, { level: s.level, combat: s.combat, agi: s.agi, str: s.str, encumPct: encPct });
  const attack = calculateAttack(p, s.bash ? MUD.bash : MUD.normal, it['Number'] as number, {
    slow: s.slow,
    speedAdj: spd === 0 ? 100 : spd
  });
  const t = s.tru;
  return {
    found: true,
    energy,
    encPct,
    rawSwings,
    qnd,
    strengthShort: s.str < strReq ? strReq : null,
    rounds,
    roundTotal: attack.roundTotal,
    trueAverage: calcTrueAverage(
      s.swings ?? rawSwings,
      t.hitP,
      t.hitA,
      t.critP,
      t.critA,
      t.extraP,
      t.extraA
    )
  };
}

/** frmHitCalc's `DoHitCalc`. */
function hit(s: HitInput): HitOutput {
  const evil = [0, EVIL.criminal, EVIL.fiend][s.evil] ?? 0;
  const [hitPct, dodged] = calculateAttackDefense(
    Math.min(9999, s.accy),
    Math.min(9999, s.ac),
    Math.min(9999, s.dodge),
    {
      bsDefense: s.perception,
      protEv: s.protEv,
      perception: s.perception,
      vileWard: s.vileWard,
      evil: engine.greater ? evil : 0,
      shadow: s.shadow,
      seeHidden: s.seeHidden,
      backstab: s.backstab,
      vsPlayer: s.vsPlayer,
      cls: s.cls
    }
  );
  return {
    hit: hitPct,
    dodge: dodged > 0 ? vbRound(dodged) : 0,
    overall: dodged > 0 ? vbRound(hitPct - hitPct * (dodged / 100)) : hitPct,
    minHit: getHitMin(s.cls),
    baseMinHit: getHitMin(),
    maxHit: getHitCap(),
    dodgeCap: getDodgeCap(),
    dodgeSoftCap: engine.greater ? getDodgeCap(0, true) : null,
    greater: engine.greater === true
  };
}

/** frmHitCalc's `GetMonsterData`. */
function monster(n: number): ToolMonster | null {
  const m = by.monster.get(n) as Row | undefined;
  if (m === undefined) return null;
  const d = monsterDefense(m);
  let accy = 0;
  for (let x = 0; x <= 4; x++) {
    const type = m[`AttType-${x}`];
    const acc = (m[`AttAcc-${x}`] as number | undefined) ?? 0;
    if (
      (type === 1 || type === 3) &&
      ((m[`Att%-${x}`] as number | undefined) ?? 0) > 0 &&
      acc > accy
    )
      accy = acc;
  }
  return {
    accy,
    ac: d.ac,
    dodge: d.dodge > 0 ? d.dodge : 0,
    bsDefense: d.bsDefense,
    seeHidden: d.seeHidden,
    evil: d.evil
  };
}

/** frmBSCalc's `calc`. */
function backstab(s: BackstabInput): BackstabOutput | null {
  const it = by.item.get(s.weapon) as Row | undefined;
  if (it === undefined) return null;
  const p = profileNow();
  const weapons = p['weapons'] as number[];
  const r = backstabRange(it, {
    level: s.level,
    stealth: s.stealth,
    str: s.str,
    plusMaxDamage: s.maxDmg,
    plusBSmin: s.bsMin,
    plusBSmax: s.bsMax,
    hasClassStealth: s.classStealth,
    globalFilter: true,
    equipped: [weaponStats(weapons[0] ?? 0), weaponStats(weapons[1] ?? 0)]
  });
  if (r === null) return null;
  return {
    noBS: r.noBS === true,
    min: r.min ?? 0,
    max: r.max ?? 0,
    avg: r.avg ?? 0,
    adj: r.adj ?? { maxDmg: 0, bsMin: 0, bsMax: 0, stealth: 0 },
    weaponMin: it['Min'] as number,
    weaponMax: it['Max'] as number
  };
}

/**
 * frmSpellBook's list (`cmdListSpells_Click`): what a class learns to a
 * level, with `AddSpell2LV`'s columns for the character where the class is
 * the character's, and the spells its book holds marked learned.
 */
function book(cls: number, level: number, align: number): SpellBookRow[] {
  const useChar = cls === char.cls && char.level > 0;
  const castLevel = useChar ? char.level : 255;
  return spellBook(cls, level, align).map((spell) => {
    const base = spellCols(spell, {
      useChar,
      level: useChar ? char.level : 0,
      cls: char.cls,
      generic: !useChar
    });
    const figures = spellColumns(spell, castLevel, !useChar);
    return {
      number: spell['Number'] as number,
      name: String(spell['Name']),
      short: String(spell['Short'] ?? ''),
      magery: magery(spell['Magery'], spell['MageryLVL']),
      level: spell['ReqLevel'] as number,
      mana: base.mana,
      diff: base.diff,
      dmg: figures.dmgText,
      dmgPerMana: figures.dmgPerMana,
      heal: figures.healText,
      healPerMana: figures.healPerMana,
      detail: plain(base.detail),
      learned: char.learnedSpells.includes(spell['Number'] as number)
    };
  });
}

/** frmMonsterAttackSim's `cmdRunSim_Click`. */
function attackSim(s: AttackSimInput): AttackSimOutput {
  const sim = createMonsterSim(
    s.monster,
    { ...s.def, antiMagic: s.antiMagic, dodgeBeforeAC: s.megaDodge },
    {
      rounds: Math.min(500000, Math.max(1, s.rounds)),
      dynamic: s.dynamic,
      dynamicDifference: 0.0001,
      logRounds: 100,
      logMaxRoundOnly: s.maxRoundOnly,
      hideEnergy: s.hideEnergy
    }
  );
  if (sim.numberOfRounds > 0) sim.run();
  const ran = sim.totalAttacks > 0 && sim.numberOfRounds > 0;
  return {
    ran,
    average: ran ? vbRound(sim.totalDamage / sim.numberOfRounds, 1) : 0,
    max: ran ? sim.getMaxDamage() : 0,
    maxSeen: sim.maxRoundDamage,
    physical: vbRound(sim.averageDamagePhys),
    spell: vbRound(sim.averageDamageSpell),
    rounds: sim.numberOfRounds,
    attacks: ran
      ? sim.results().map((r, x) =>
          r === null
            ? null
            : {
                name: sim.atk[x]?.name || `${x + 1}.`,
                trueChance: vbRound(r.trueChance, 1),
                avgHit: vbRound(r.avgHit, 1),
                hitPct: vbRound(r.hitPct, 1),
                dmgResistPct: vbRound(r.dmgResistPct, 1),
                resistDodgePct: vbRound(r.resistDodgePct, 1)
              }
        )
      : [],
    log: sim.combatLog.trim()
  };
}

/**
 * One ask of a tool (`ToolRequest`), for the character on its realm. A realm
 * mudtool does not compute answers `start` with why, and nothing else is
 * asked of it.
 */
export async function explorerTool<R extends ToolRequest>(
  realm: MmeRealm,
  state: CharacterState,
  request: R
): Promise<ToolAnswer<R>> {
  await useRealm(realm);
  if (!supported()) {
    if (request.tool === 'start') return NO_TOOLS as ToolAnswer<R>;
    throw new Error('unsupported');
  }
  useEqCharacter(state, DEFAULT_EQ_PLAN);
  const answer = ((): unknown => {
    switch (request.tool) {
      case 'start':
        return start();
      case 'swing':
        return swing(request.input);
      case 'hit':
        return hit(request.input);
      case 'monster':
        return monster(request.monster);
      case 'backstab':
        return backstab(request.input);
      case 'expChart':
        return expChart(request.cls, request.race);
      case 'exp':
        return expRows(request.start, request.end, request.chart);
      case 'coin': {
        const amount = convertCoin(request.amount, request.from, request.to);
        return { amount, weight: coinWeight(amount) };
      }
      case 'charm':
        return charmModifier(request.charm, true);
      case 'applyCharm':
        return applyCharm(request.amount, request.coin, request.pct);
      case 'spellbook':
        return book(request.cls, request.level, request.align);
      case 'attacksim':
        return attackSim(request.input);
    }
  })();
  return answer as ToolAnswer<R>;
}
