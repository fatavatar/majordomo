// Monster damage against a character or party: MME's round-by-round attack
// simulator (clsMonsterAttackSim.cls), loading a monster into it
// (modMMudDatabase.PopulateMonsterDataToAttackSim, CalculateMonsterItemBonuses,
// CalculateMonsterAvgDmg) and the per-character / per-party wrappers
// (modMain.SetupMonsterAttackSimWithCharStats, CalculateMonsterDamageVsChar).
//
// Pure apart from the random numbers: pass `rng` (a function returning [0, 1))
// for repeatable runs; it defaults to Math.random.
//
// Defences (what the sim needs to know about the target), all optional:
//   { ac, dr, dodge, mr (50), antiMagic, protEvil, rcol, rfir, rsto, rlit, rwat,
//     dodgeBeforeAC, cls }
// dodge is the raw dodge value; with dodgeBeforeAC it is read as the dodge %
// MegaMUD reports (frmMonsterAttackSim "MegaMUD Dodge").

import { by } from '../db.js';
import { engine } from './engine.js';
import { fix, vbRound, cint, cur } from './vb.js';
import { getSpellDuration, getSpellMinDamage, getSpellMaxDamage, spellHasAbility, getSpellHitCap } from './spellcalc.js';
import { getHitMin, getHitCap, getDodgeCap, gmudDiminishingReturns, itemHasAbility } from './combat.js';

const monRow = m => (typeof m === 'object' ? m : by.monster.get(m));

// Spell attack types that elemental resists apply to (AttType: 0 cold, 1 fire,
// 2 stone, 3 lightning, 5 water; 4 normal and 6 poison are not resisted).
const RESIST_KEY = { 0: 'rcol', 1: 'rfir', 2: 'rsto', 3: 'rlit', 5: 'rwat' };

export function blankAttack() {
  return { name: '', type: 0, spellType: 4, energy: 0, min: 0, max: 0, chance: 0, success: 0,
    hitSpellMin: 0, hitSpellMax: 0, hitSpellType: 4, hitSpellName: '', resist: 0, mrDmgResist: 0, duration: 0 };
}
export function blankBetween() {
  return { name: '', min: 0, max: 0, spellType: 4, chance: 0, resistType: 0, resistDmgMR: 0, duration: 0 };
}

// clsMonsterAttackSim
export class MonsterAttackSim {
  constructor(rng = Math.random) {
    this.rng = rng;
    this.combatLogMaxRounds = 10;     // Class_Initialize
    this.dynamicCalcDifference = 0.0001;
    this.resetValues();
  }

  // ResetValues
  resetValues() {
    Object.assign(this, {
      HIT_MIN: 8, HIT_CAP: 99, SPELL_HIT_CAP: 98, DODGE_CAP: 95, DODGE_SOFTCAP: 0,
      userAC: 0, userDR: 0, userDodge: 0, userMR: 0, userAntiMagic: 0, dodgeBeforeAC: false,
      userProtEvil: 0, mobIsEvil: true, userRFIR: 0, userRCOL: 0, userRLIT: 0, userRWAT: 0, userRSTO: 0,
      energyPerRound: 0, numberOfRounds: 0, totalAttacks: 0, totalDamage: 0, totalDamagePhys: 0,
      totalDamageSpell: 0, maxRoundDamage: 0, maxEnergyPerRound: 0, averageDamage: 0,
      averageDamagePhys: 0, averageDamageSpell: 0, combatLog: '', hideEnergyInfo: false,
      combatLogMaxRoundOnly: false, dynamicCalc: false, greater: engine.greater,
    });
    this.atk = Array.from({ length: 5 }, blankAttack);
    this.between = Array.from({ length: 5 }, blankBetween);
    this.stat = Array.from({ length: 5 }, () => ({ attempted: 0, hits: 0, dmgResisted: 0, dodgedOrResisted: 0,
      totalDamage: 0, hitSpellDmgResisted: 0, hitSpellTotalDamage: 0, betweenDmgResisted: 0, betweenTotalDamage: 0 }));
    this.logRounds = 0;
    this.resetActiveSpells();
  }

  resetActiveSpells() {
    this.activeAtk = Array.from({ length: 5 }, () => ({ ticks: 0, left: 0, value: 0, original: 0 }));
    this.activeBetween = Array.from({ length: 5 }, () => ({ ticks: 0, left: 0, value: 0, original: 0 }));
  }

  // Set defences in one go (see the header).
  setDefenses(d = {}) {
    if (d.ac > 0) this.userAC = d.ac;
    if (d.dr > 0) this.userDR = d.dr;
    if (d.dodge > 0) this.userDodge = d.dodge;
    if (d.mr > 0) this.userMR = d.mr;
    if (d.protEvil > 0) this.userProtEvil = d.protEvil;
    for (const k of ['rcol', 'rfir', 'rsto', 'rlit', 'rwat']) if (d[k] > 0) this['userR' + k.slice(1).toUpperCase()] = d[k];
    if (d.antiMagic) this.userAntiMagic = 1;
    if (d.dodgeBeforeAC) this.dodgeBeforeAC = true;
  }

  // RandomNumber: Int(((end - start + 1) * Rnd) + start)
  randomNumber(start, end) { return Math.floor((end - start + 1) * this.rng() + start); }

  log(left, right = '') {
    if (this.logRounds >= this.combatLogMaxRounds) return;
    if (this.hideEnergyInfo && /energy/i.test(right)) right = '';
    if (right.length > 0 && left.length > 29) left = left.slice(0, 26) + '...';
    this.combatLog += '\n' + left;
    if (right.length > 0) this.combatLog += ' '.repeat(Math.max(0, 30 - left.length)) + right;
  }

  nothingToSim() {
    for (let x = 0; x <= 4; x++) {
      const a = this.atk[x], b = this.between[x];
      if (a.min > 0 || a.max > 0 || a.hitSpellMin > 0 || a.hitSpellMax > 0 || b.min > 0 || b.max > 0) return false;
    }
    return true;
  }

  // GetMaxDamage: the most a monster could do in one round.
  getMaxDamage() {
    let total = 0;
    if (this.nothingToSim()) return 0;
    let lowest = 0, maxCost = 0, maxEnergyRound = 0, zeroEnergy = false;
    for (const a of this.atk) {
      if (a.type > 0 && a.energy > 0) {
        let low = a.energy;
        if (a.type === 2 && (((a.resist === 1 && this.userAntiMagic === 1) || a.resist === 2) || a.success < 100)) low = vbRound(a.energy / 2);
        if ((lowest === 0 || low < lowest) && low > 0) lowest = low;
        if (maxCost === 0 || a.energy > maxCost) maxCost = a.energy;
      } else if (a.type > 0 && a.energy === 0 && a.chance > 0) {
        lowest = 0; maxEnergyRound = this.energyPerRound * 2; zeroEnergy = true;
        break;
      }
    }
    if (!zeroEnergy) {
      if (lowest === 0) return 0;
      maxEnergyRound = this.energyPerRound;
      let least = lowest;
      while (least + maxCost <= maxEnergyRound) least += lowest;
      let rem = this.energyPerRound - least;
      if (rem < lowest) rem += lowest - 1;
      maxEnergyRound = this.energyPerRound + rem;
    }
    let rem = maxEnergyRound;
    for (let x = 1; rem >= lowest && x <= 6; x++) {
      let maxDmg = 0, forAttack = 0, maxDPE = 0;
      for (const a of this.atk) {
        if (a.energy <= rem && a.energy > 0 && (a.type !== 2 || a.success > 0) && a.type > 0) {
          let dmg = a.max;
          if (a.type === 1 && !(a.duration > 1)) dmg += a.hitSpellMax;
          let attempts = fix(rem / a.energy);
          if (attempts > 6 - x + 1) attempts = 6 - x + 1;
          const dpe = cur((dmg * attempts) / rem);
          if (dpe > maxDPE) { maxDmg = dmg; maxDPE = dpe; forAttack = a.energy; }
        }
      }
      total += maxDmg;
      rem -= forAttack;
      if (forAttack === 0 && lowest === 0) break;     // zero-energy attacks: VB would loop 6 times adding 0
    }
    for (const a of this.atk) {
      if (a.type === 1 && a.duration > 1) { total += a.hitSpellMax; if (a.duration > 2) total += a.hitSpellMax; }
      else if (a.type === 2 && a.duration > 1) { total += a.max; if (a.duration > 2) total += a.max; }
    }
    let best = 0;
    for (const b of this.between) if (b.chance > 0 && !(b.duration > 1) && b.max > best) best = b.max;
    total += best;
    for (const b of this.between) if (b.chance > 0 && b.duration > 1) { total += b.max; if (b.duration > 2) total += b.max; }
    return total;
  }

  // IsSpellResisted
  isSpellResisted(resistType, mr, antiMagic) {
    if ((resistType === 1 && antiMagic === 1) || resistType === 2) {
      const roll = this.randomNumber(1, 100);
      mr = cint(mr);
      if (mr > 196) mr = 196;
      return roll <= mr / 2;
    }
    return false;
  }

  // CalcResistedDamage
  calcResistedDamage(damage, mr, antiMagic) {
    mr = cint(mr);
    if (mr > 150) mr = 150;
    let red;
    if (antiMagic === 0) red = mr < 50 ? vbRound((mr - 50) / 100, 2) : vbRound((mr - 50) / 200, 2);
    else red = vbRound(mr / 200, 2);
    return cur(damage - damage * red);
  }

  // The Select Case on the spell's element: the reduction, or null when MME
  // doesn't assign nResist_Reduction (no matching resist).
  elementalReduction(spellType, dmg) {
    const k = RESIST_KEY[spellType];
    if (!k) return null;
    const r = this['userR' + k.slice(1).toUpperCase()];
    return r > 0 ? cur(dmg * (r / 100)) : null;
  }

  // RunSim
  run() {
    if (this.dynamicCalc) this.numberOfRounds = 100000;
    if (this.numberOfRounds < 1 || this.energyPerRound < 1) return this;
    Object.assign(this, { totalAttacks: 0, totalDamage: 0, totalDamagePhys: 0, totalDamageSpell: 0,
      maxRoundDamage: 0, maxEnergyPerRound: 0 });
    // MME's clamps are one-line Ifs whose second half only runs after the
    // first passed, so only negatives are fixed.
    for (const k of ['HIT_MIN', 'HIT_CAP', 'SPELL_HIT_CAP', 'DODGE_SOFTCAP', 'DODGE_CAP']) if (this[k] < 0) this[k] = 0;
    this.resetActiveSpells();
    let nRound = 0;
    let maxRoundLog = '';
    let resistRed = 0;       // nResist_Reduction is never reset between attacks in MME; kept
    if (!this.nothingToSim()) {
      this.combatLog = '='.repeat(66);
      this.logRounds = 0;
      if (this.combatLogMaxRounds < 0) this.combatLogMaxRounds = 0;
      let energy = 0, curAvg = 0, dynCount = 0;
      const A = this.atk, S = this.stat, AA = this.activeAtk, AB = this.activeBetween, B = this.between;
      let finished = false;
      for (nRound = 1; nRound <= this.numberOfRounds; nRound++) {
        let roundDmg = 0, sep = false;
        // extra spell-round ticks: spell rounds are 3s, combat rounds 5s
        for (let x = 0; x <= 4; x++) {
          if (AA[x].left > 0 && AA[x].ticks === 3) {
            const v = AA[x].value;
            roundDmg += v; this.totalDamage += v; this.totalDamageSpell += v;
            S[x].totalDamage += v; S[x].dmgResisted += AA[x].original - v;
            S[x].hitSpellDmgResisted += AA[x].original - v; S[x].hitSpellTotalDamage += v;
            if (!sep) { this.log(''); sep = true; }
            AA[x].left -= 1;
            if (A[x].type === 2) this.log(`[${A[x].name}, spell tick] for ${v} -- ${AA[x].left} rounds rem.`);
            else this.log(`[${A[x].hitSpellName || 'attack ' + (x + 1)}, hit spell tick] for ${v} -- ${AA[x].left} rounds rem.`);
            if (AA[x].left < 1) AA[x] = { ticks: 0, left: 0, value: 0, original: AA[x].original };
          }
          if (AB[x].left > 0 && AB[x].ticks === 3) {
            const v = AB[x].value;
            roundDmg += v; this.totalDamage += v; this.totalDamageSpell += v;
            S[x].betweenDmgResisted += AB[x].original - v; S[x].betweenTotalDamage += v;
            if (!sep) { this.log(''); sep = true; }
            AB[x].left -= 1;
            this.log(`[${B[x].name}, between spell tick] for ${v} -- ${AB[x].left} rounds rem.`);
            if (AB[x].left < 1) AB[x] = { ticks: 0, left: 0, value: 0, original: AB[x].original };
          }
        }
        if (sep) this.log('');
        this.log(this.hideEnergyInfo ? `ROUND ${nRound}`
          : `ROUND ${nRound} / Energy: ${energy} + ${this.energyPerRound} = ${energy + this.energyPerRound}`);
        this.log('');
        energy += this.energyPerRound;
        if (energy > this.maxEnergyPerRound) this.maxEnergyPerRound = energy;

        // regular attacks: up to six attempts a round
        attempts:
        for (let attempt = 1; attempt <= 6; attempt++) {
          const roll = this.randomNumber(1, 100);
          let lastType = 0, lastEnergy = 0;
          for (let n = 0; n <= 4; n++) {
            const a = A[n];
            let dmg = 0, hsDmg = 0, orig = 0, showHS = false, durApplied = false;
            if (!(roll <= a.chance && a.type > 0)) continue;
            lastEnergy = a.energy; lastType = a.type;
            if (energy >= a.energy) {
              S[n].attempted++; this.totalAttacks++;
              let hit = false, dodged = false, glanced = false, resisted = false;
              let chance = a.success;
              if (a.type !== 2) {
                if (this.userAC + this.userProtEvil > 0) {
                  const def = this.userAC + this.userProtEvil;
                  chance = chance !== 0 ? cur(vbRound(1 - ((def * def) / 100) / ((chance * chance) / 140), 2) * 100) : 0;
                } else chance = this.HIT_CAP;
                if (chance < this.HIT_MIN) chance = this.HIT_MIN;
                if (chance > this.HIT_CAP) chance = this.HIT_CAP;
              }
              if (this.dodgeBeforeAC && this.userDodge > 0 && a.type !== 2) {
                if (this.randomNumber(1, 100) <= this.userDodge) { dodged = true; S[n].dodgedOrResisted++; }
              }
              if (!this.dodgeBeforeAC || !dodged) {
                if (this.randomNumber(1, 100) <= chance) {
                  hit = true;
                  if (a.type !== 2 && this.userDodge > 0 && !this.dodgeBeforeAC && a.success >= 8) {
                    let adj;
                    if (this.greater) {
                      // TODO GreaterMUD: per-class dodge caps
                      const acc = ((a.success * a.success) / 14) / 10;
                      adj = cint((this.userDodge * this.userDodge) / acc);
                      if (adj > this.DODGE_SOFTCAP && this.DODGE_SOFTCAP > 0) adj = cint(this.DODGE_SOFTCAP + gmudDiminishingReturns(adj - this.DODGE_SOFTCAP, 4));
                    } else adj = fix((this.userDodge * 10) / (a.success / 8));
                    if (adj > this.DODGE_CAP) adj = this.DODGE_CAP;
                    if (this.randomNumber(1, 100) <= adj) { hit = false; dodged = true; S[n].dodgedOrResisted++; }
                  }
                }
              }
              if (hit) {
                dmg = this.randomNumber(a.min, a.max);
                orig = dmg;
                if (a.type === 2) {
                  AA[n].original = dmg;
                  if (a.mrDmgResist === 1 && dmg > 0) dmg = vbRound(this.calcResistedDamage(dmg, this.userMR, this.userAntiMagic));
                  if (a.spellType !== 4 && a.spellType !== 6) {
                    const red = this.elementalReduction(a.spellType, dmg);
                    if (red !== null) resistRed = red;
                    if (resistRed !== 0) dmg = vbRound(dmg - resistRed);
                  }
                  if (a.duration > 0) {
                    if (AA[n].left < 1 || AA[n].value !== dmg) {
                      if (this.isSpellResisted(a.resist, this.userMR, this.userAntiMagic)) {
                        S[n].dodgedOrResisted++; resisted = true; hit = false; dmg = 0;
                      } else {
                        AA[n] = { ticks: 0, left: a.duration, value: cint(dmg), original: AA[n].original };
                        durApplied = true; dmg = 0;
                      }
                    } else {
                      // duration continues: not really an attempt
                      S[n].attempted--; this.totalAttacks--;
                      continue;
                    }
                  } else if (this.isSpellResisted(a.resist, this.userMR, this.userAntiMagic)) {
                    S[n].dodgedOrResisted++; resisted = true; hit = false; dmg = 0;
                  }
                } else {
                  let drRes = this.userDR;
                  if (drRes > dmg) drRes = dmg;
                  S[n].dmgResisted += drRes;
                  dmg -= drRes;
                  if (a.hitSpellMin > 0 || a.hitSpellMax > 0 || a.duration > 0) {
                    hsDmg = vbRound(this.randomNumber(a.hitSpellMin, a.hitSpellMax));
                    AA[n].original = hsDmg;
                    if (a.mrDmgResist === 1 && hsDmg > 0) {
                      const r = vbRound(this.calcResistedDamage(hsDmg, this.userMR, this.userAntiMagic));
                      if (a.duration === 0) S[n].dmgResisted += hsDmg - r;
                      hsDmg = r;
                    }
                    if (a.hitSpellType !== 4 && a.hitSpellType !== 6) {
                      const red = this.elementalReduction(a.hitSpellType, hsDmg);
                      if (red !== null) resistRed = red;
                      if (resistRed !== 0) {
                        if (a.duration === 0) S[n].dmgResisted = vbRound(S[n].dmgResisted + resistRed);
                        hsDmg = vbRound(hsDmg - resistRed);
                      }
                    }
                    if (a.duration > 0) {
                      if (AA[n].left < 1 || AA[n].value !== hsDmg) {
                        if (this.isSpellResisted(a.resist, this.userMR, this.userAntiMagic)) {
                          S[n].dmgResisted += hsDmg; showHS = true; resisted = true; hsDmg = 0;
                        } else {
                          AA[n] = { ticks: 0, left: a.duration, value: cint(hsDmg), original: AA[n].original };
                          durApplied = true; showHS = true; hsDmg = 0;
                        }
                      }
                    } else {
                      if (this.isSpellResisted(a.resist, this.userMR, this.userAntiMagic)) {
                        S[n].dmgResisted += hsDmg; resisted = true; hsDmg = 0;
                      }
                      showHS = true;
                    }
                    if (!showHS) hsDmg = 0;
                  }
                }
                if (dmg <= 0) { if (a.type !== 2) glanced = true; dmg = 0; }
                if (hit) {
                  if (orig !== dmg && a.type === 2 && a.duration < 1) S[n].dmgResisted += orig - dmg;
                  roundDmg = cint(roundDmg + dmg + hsDmg);
                  this.totalDamage += dmg + hsDmg;
                  this.totalDamageSpell += hsDmg;
                  if (a.type === 2) this.totalDamageSpell += dmg; else this.totalDamagePhys += dmg;
                  energy -= a.energy;
                  S[n].hits++;
                  S[n].totalDamage += dmg + hsDmg;
                  if (a.type === 2 && a.duration > 0) this.log(`${a.name} applied (${AA[n].original})`, `Energy used: ${a.energy} ... Remaining: ${energy}`);
                  else this.log(`${a.name} for ${vbRound(dmg)}${glanced ? ' (GLANCE)' : ''}`, `Energy used: ${a.energy} ... Remaining: ${energy}`);
                  if (showHS) {
                    // MME labels a nameless hit spell with a stale loop counter; the attack's own number is used here
                    if (durApplied) this.log(` - duration spell applied (${AA[n].value})`);
                    else this.log(` -${a.hitSpellName || 'attack ' + (n + 1)} ${resisted ? '(resist)' : 'for ' + vbRound(hsDmg)}`);
                  }
                }
              }
              if (!hit) {
                if (a.type === 2) {
                  if (a.duration === 0 || resisted) {
                    const used = vbRound(a.energy / 2);
                    energy -= used;
                    this.log(`${a.name} (${resisted ? 'RESIST' : 'FAIL'})`, `Energy used: ${used} ... Remaining: ${energy}`);
                  }
                } else {
                  energy -= a.energy;
                  this.log(`${a.name} (${dodged ? 'DODGE' : 'MISS'})`, `Energy used: ${a.energy} ... Remaining: ${energy}`);
                }
              }
            }
            // next_attempt
            if (lastType === 1 && energy < lastEnergy) break attempts;
            continue attempts;
          }
          if (lastType === 1 && energy < lastEnergy) break;
        }

        // between-round spell
        sep = false;
        const roll = this.randomNumber(1, 100);
        for (let x = 0; x <= 4; x++) {
          const b = B[x];
          let hit = false, resisted = false, durApplied = false, dmg = 0;
          if (b.chance > 0 && roll <= b.chance) {
            dmg = this.randomNumber(b.min, b.max);
            AB[x].original = dmg;
            if (b.resistDmgMR === 1 && dmg > 0) dmg = vbRound(this.calcResistedDamage(dmg, this.userMR, this.userAntiMagic));
            if (b.spellType !== 4 && b.spellType !== 6) {
              const red = this.elementalReduction(b.spellType, dmg);
              if (red !== null) resistRed = red;
              if (resistRed !== 0) dmg = vbRound(dmg - resistRed);
            }
            if (b.duration > 0) {
              if (AB[x].left < 1 || AB[x].value !== dmg) {
                if (this.isSpellResisted(b.resistType, this.userMR, this.userAntiMagic)) { resisted = true; dmg = 0; }
                else { AB[x] = { ticks: 0, left: b.duration, value: cint(dmg), original: AB[x].original }; durApplied = true; dmg = 0; }
              }
            } else if (this.isSpellResisted(b.resistType, this.userMR, this.userAntiMagic)) { resisted = true; dmg = 0; }
            else hit = true;
          }
          if (!sep && (durApplied || resisted || hit)) { this.log(''); sep = true; }
          if (durApplied) { this.log(`[between round] ${b.name} - duration spell applied (${AB[x].value})`); break; }
          if (resisted) { this.log(`[between round] ${b.name} (RESIST)`); break; }
          if (hit) {
            this.log(`[between round] ${b.name} for ${vbRound(dmg)}`);
            roundDmg = cint(roundDmg + dmg);
            this.totalDamage += dmg; this.totalDamageSpell += dmg;
            S[x].betweenTotalDamage += dmg;
            break;
          }
        }

        // all spell duration ticks
        sep = false;
        for (let x = 0; x <= 4; x++) {
          if (AA[x].left > 0) {
            const v = AA[x].value;
            roundDmg += v; this.totalDamage += v; this.totalDamageSpell += v;
            S[x].totalDamage += v; S[x].dmgResisted += AA[x].original - v;
            S[x].hitSpellDmgResisted += AA[x].original - v; S[x].hitSpellTotalDamage += v;
            if (!sep) { this.log(''); sep = true; }
            AA[x].left -= 1;
            if (A[x].type === 2) this.log(`[${A[x].name}, attack spell tick] for ${v} -- ${AA[x].left} rounds rem.`);
            else this.log(`[${A[x].hitSpellName || 'attack ' + (x + 1)}, hit spell tick] for ${v} -- ${AA[x].left} rounds rem.`);
            AA[x].ticks = AA[x].ticks >= 3 ? 1 : AA[x].ticks + 1;
            if (AA[x].left < 1) AA[x] = { ticks: 0, left: 0, value: 0, original: AA[x].original };
          }
          if (AB[x].left > 0) {
            const v = AB[x].value;
            roundDmg += v; this.totalDamage += v; this.totalDamageSpell += v;
            S[x].betweenDmgResisted += AB[x].original - v; S[x].betweenTotalDamage += v;
            if (!sep) { this.log(''); sep = true; }
            AB[x].left -= 1;
            this.log(`[${B[x].name}, between spell tick] for ${v} -- ${AB[x].left} rounds rem.`);
            AB[x].ticks = AB[x].ticks >= 3 ? 1 : AB[x].ticks + 1;
            if (AB[x].left < 1) AB[x] = { ticks: 0, left: 0, value: 0, original: AB[x].original };
          }
        }
        this.log('');
        this.log(`Damage for round: ${roundDmg}`, `Energy Remaining: ${energy}`);
        this.log('='.repeat(66));
        this.logRounds++;
        if (roundDmg > this.maxRoundDamage) {
          this.maxRoundDamage = roundDmg;
          if (this.combatLogMaxRoundOnly) maxRoundLog = this.combatLog;
        } else if (this.combatLogMaxRoundOnly) { this.combatLog = ''; this.logRounds = 0; }

        if (dynCount > 1000 && this.dynamicCalc) {
          const now = vbRound(this.totalDamage / nRound, 3);
          if (curAvg === 0) {
            curAvg = now;
            if (curAvg < 1) { this.numberOfRounds = nRound; finished = true; break; }
            dynCount = 0;
          } else {
            const diff = Math.abs(1 - now / curAvg);
            if (diff < this.dynamicCalcDifference) { this.numberOfRounds = nRound; finished = true; break; }
            curAvg = now; dynCount = 0;
          }
        }
        dynCount++;
      }
      // A VB For loop that runs to the end leaves its counter one past the
      // last round, so MME's averages divide by rounds + 1 unless the
      // dynamic calculation stopped early. Kept.
      void finished;
    }
    if (nRound > 0) {
      this.averageDamage = vbRound(this.totalDamage / nRound, 1);
      this.averageDamagePhys = vbRound(this.totalDamagePhys / nRound, 1);
      this.averageDamageSpell = vbRound(this.totalDamageSpell / nRound, 1);
    }
    if (this.combatLogMaxRoundOnly) this.combatLog = maxRoundLog;
    return this;
  }

  // frmMonsterAttackSim.cmdRunSim_Click's results grid, per attack slot.
  results() {
    return this.atk.map((a, x) => {
      const s = this.stat[x];
      if (!(a.type > 0)) return null;
      const pct = (n, d) => (d > 0 ? vbRound(n / d, 3) * 100 : 0);
      return {
        name: a.name,
        trueChance: this.totalAttacks > 0 ? vbRound(s.attempted / this.totalAttacks, 3) * 100 : 0,
        avgHit: s.totalDamage > 0 && s.hits ? vbRound(s.totalDamage / s.hits) : 0,
        hitPct: pct(s.hits, s.attempted),
        dmgResistPct: s.dmgResisted !== 0 ? (s.totalDamage === 0 ? 100 : vbRound(s.dmgResisted / (s.dmgResisted + s.totalDamage), 3) * 100) : 0,
        resistDodgePct: s.attempted > 0 && (a.type === 2 || s.dodgedOrResisted > 0) ? vbRound(s.dodgedOrResisted / s.attempted, 3) * 100 : 0,
      };
    });
  }
}

// ---------------------------------------------------------------- loading a monster

// modMMudDatabase.CalculateMonsterItemBonuses: a monster's unlimited weapon
// and drops add their abilities (drops weighted by drop %).
export function calculateMonsterItemBonuses(monster, abils) {
  const m = monRow(monster);
  if (!m || !abils.length) return 0;
  let total = 0;
  const limit = n => (by.item.get(n) || {}).Limit;
  if (m.Weapon > 0 && limit(m.Weapon) === 0) {
    for (const a of abils) { const t = itemHasAbility(m.Weapon, a); if (t !== -31337) total = cint(total + t); }
  }
  for (let x = 0; x <= 9; x++) {
    const it = m['DropItem-' + x];
    if (it > 0 && limit(it) === 0) {
      for (const a of abils) {
        const t = itemHasAbility(it, a);
        if (t !== -31337) total = cint(total + t * (Math.min(m['DropItem%-' + x], 100) / 100));
      }
    }
  }
  return total;
}

// modMMudDatabase.PopulateMonsterDataToAttackSim
export function loadMonster(sim, monster) {
  const m = monRow(monster);
  if (!m) return sim;
  const nmr = engine.nmrVersion;
  sim.energyPerRound = nmr >= 1.71 ? m.Energy : 1000;
  const dmgBonus = calculateMonsterItemBonuses(m, [4]);             // max damage
  const accyBonus = calculateMonsterItemBonuses(m, [22, 105, 106]); // accuracy
  sim.mobIsEvil = [1, 2, 5, 6].includes(m.Align);
  const spell = n => by.spell.get(n);
  for (let x = 0; x <= 4; x++) {
    const type = m['AttType-' + x];
    if (!(type > 0 && type < 4)) continue;
    const a = sim.atk[x];
    let name = '';
    if (nmr >= 1.8) name = m['AttName-' + x] || '';
    else {
      if (type === 2 && m['AttAcc-' + x] > 0) name = (spell(m['AttAcc-' + x]) || {}).Name || '';
      if (name === '' || name === 'None') name = 'Attack ' + (x + 1);
    }
    a.name = name.trim();
    a.type = type;
    a.energy = m['AttEnergy-' + x];
    a.chance = m['Att%-' + x];
    if (type === 2) {
      const sn = m['AttAcc-' + x], lvl = m['AttMax-' + x];
      const sp = spell(sn);
      if (!sp) continue;
      if (!engine.greater && sp.Targets === 12 && getSpellDuration(sn, lvl, true) === 0 && spellHasAbility(sn, 1) > -1) {
        // an area spell in a regular attack slot using Damage (1) instead of
        // Damage-MR (17): MajorMUD won't cast it, so zero it out
        a.duration = 0; a.min = 0; a.max = 0; a.energy = 0;
        continue;
      }
      if (nmr >= 1.8) a.resist = sp.TypeOfResists;
      a.spellType = sp.AttType;
      a.duration = getSpellDuration(sn, lvl, true);
      a.min = 0; a.max = 0;
      for (const [ab, mrRes] of [[1, 0], [17, 1], [8, 0]]) {
        const t = spellHasAbility(sn, ab);
        if (t >= 0) {
          a.mrDmgResist = mrRes;
          if (t > 0) { a.min = t; a.max = t; }
          else { a.min = getSpellMinDamage(sn, lvl, -1, true); a.max = getSpellMaxDamage(sn, lvl, -1, true); }
        }
      }
      a.success = m['AttMin-' + x];
    } else {
      a.min = m['AttMin-' + x] + dmgBonus;
      a.max = m['AttMax-' + x] + dmgBonus;
      a.success = m['AttAcc-' + x] + accyBonus;
      const hs = m['AttHitSpell-' + x];
      if (hs > 0) {
        const sp = spell(hs);
        if (!sp) continue;
        if (nmr >= 1.8) a.resist = sp.TypeOfResists;
        a.hitSpellName = sp.Name;
        a.hitSpellType = sp.AttType;
        a.duration = getSpellDuration(hs);
        if (spellHasAbility(hs, 1) >= 0) { a.mrDmgResist = 0; a.hitSpellMin = getSpellMinDamage(hs); a.hitSpellMax = getSpellMaxDamage(hs); }
        else if (spellHasAbility(hs, 17) >= 0) { a.mrDmgResist = 1; a.hitSpellMin = getSpellMinDamage(hs); a.hitSpellMax = getSpellMaxDamage(hs); }
        else { a.hitSpellMin = 0; a.hitSpellMax = 0; }
      }
    }
  }
  for (let x = 0; x <= 4; x++) {
    const sn = m['MidSpell-' + x];
    if (!(sn > 0)) continue;
    const sp = spell(sn);
    if (!sp) continue;
    const b = sim.between[x], lvl = m['MidSpellLVL-' + x];
    b.name = sp.Name;
    b.spellType = sp.AttType;
    if (nmr >= 1.8) b.resistType = sp.TypeOfResists;
    b.chance = m['MidSpell%-' + x];
    b.duration = getSpellDuration(sn, lvl, true);
    for (const [ab, mrRes] of [[1, 0], [17, 1], [8, 0]]) {
      const t = spellHasAbility(sn, ab);
      if (t >= 0) {
        b.resistDmgMR = mrRes;
        if (t > 0) { b.min = t; b.max = t; }
        else { b.min = getSpellMinDamage(sn, lvl, -1, true); b.max = getSpellMaxDamage(sn, lvl, -1, true); }
      }
    }
  }
  // same-named attacks get their slot number appended
  for (let x = 0; x <= 4; x++) {
    if (!sim.atk[x].name) continue;
    for (let y = 0; y <= 4; y++) {
      if (y !== x && sim.atk[x].name === sim.atk[y].name) {
        sim.atk[x].name = sim.atk[x].name.trim() + (x + 1);
        sim.atk[y].name = sim.atk[y].name.trim() + (y + 1);
      }
    }
  }
  return sim;
}

// Does the monster have anything the sim can run (CalculateMonsterDamageVsCharALL)?
export function monsterHasAttack(monster) {
  const m = monRow(monster);
  if (!m) return false;
  for (let x = 0; x <= 4; x++) if (m['AttType-' + x] > 0 && m['AttType-' + x] < 4) return true;
  for (let x = 0; x <= 4; x++) if (m['MidSpell-' + x] > 0) return true;
  return false;
}

// Caps for a defender class (SetupMonsterAttackSimWithCharStats).
function setCaps(sim, cls = 0) {
  sim.HIT_MIN = getHitMin(cls);
  sim.HIT_CAP = getHitCap();
  sim.SPELL_HIT_CAP = getSpellHitCap();
  sim.DODGE_SOFTCAP = getDodgeCap(cls, true);
  sim.DODGE_CAP = getDodgeCap(cls);
}

// Build a sim for a monster against a set of defences.
//   opts: rounds (default 500), dynamic, dynamicDifference, rng, logRounds,
//         logMaxRoundOnly, hideEnergy
export function createMonsterSim(monster, defenses = {}, opts = {}) {
  const sim = new MonsterAttackSim(opts.rng);
  sim.combatLogMaxRounds = opts.logRounds ?? 0;
  sim.combatLogMaxRoundOnly = !!opts.logMaxRoundOnly;
  sim.hideEnergyInfo = !!opts.hideEnergy;
  sim.numberOfRounds = opts.rounds ?? 500;
  sim.userMR = 50;
  sim.greater = engine.greater;
  sim.dynamicCalc = !!opts.dynamic;
  sim.dynamicCalcDifference = opts.dynamicDifference ?? 0.001;
  setCaps(sim, defenses.cls || 0);
  sim.setDefenses(defenses);
  loadMonster(sim, monster);
  return sim;
}

// modMMudDatabase.CalculateMonsterAvgDmg: average and max damage per round
// against no defences (MR 50).
export function calculateMonsterAvgDmg(monster, rounds = 500, rng) {
  const sim = createMonsterSim(monster, {}, { rounds, rng });
  if (sim.numberOfRounds > 0) sim.run();
  return { averageDamage: sim.averageDamage, maxDamage: sim.getMaxDamage() };
}

// modMain.CalculateMonsterDamageVsChar: average damage per round to one
// character (defenses as above) or, with party = {size, antiMagic, ac, dr, mr,
// dodge}, the average over the party members (anti-magic members simmed
// separately). Rounds are clamped to 100..10000 as in MME.
export function monsterDamageVsChar(monster, defenses = {}, { party = null, rounds = 500, rng } = {}) {
  if (rounds < 100) rounds = 100;
  if (rounds > 10000) rounds = 10000;
  const m = monRow(monster);
  if (!m) return 0;
  if (!monsterHasAttack(m)) return 0;
  const one = (def) => {
    const sim = createMonsterSim(m, def, { rounds, rng });
    if (sim.numberOfRounds > 0) sim.run();
    return sim.averageDamage;
  };
  let dmg;
  const size = party ? party.size || 1 : 1, anti = party ? party.antiMagic || 0 : 0;
  if (!party || size < 2 || anti < 1 || size === anti) {
    const def = party ? { ac: party.ac, dr: party.dr, mr: party.mr, dodge: party.dodge, antiMagic: size === anti } : defenses;
    dmg = one(def);
  } else {
    const base = { ac: party.ac, dr: party.dr, mr: party.mr, dodge: party.dodge };
    const non = size - anti;
    dmg = 0;
    if (anti > 0) dmg = one({ ...base, antiMagic: true }) * anti;
    if (non > 0) dmg += one({ ...base, antiMagic: false }) * non;
    dmg = dmg / (anti + non);
  }
  return vbRound(dmg, 1);
}
