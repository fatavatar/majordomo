/**
 * `0x4ac2a0`: the status MegaMUD shows for what it is doing, "Resting",
 * "Cast-Main (2)", "Party Wait", rebuilt whenever a line or a pass changes
 * something. Display only: it changes no state. Read 2026-10-12.
 */
import { f_426ab0, castCount } from './combat/casts';
import { classMagic } from './data';
import type { Session } from './Session';
import { idiv } from './cstr';

const NAMES: Record<number, string> = {
  6: 'Poisoned',
  7: 'Hanging',
  8: 'Relogging',
  9: 'Cast-PreM',
  0xa: 'Cast-Mult',
  0xb: 'Cast-Pre',
  0xc: 'Cast-Aux',
  0xd: 'Cast-Main',
  0xe: 'Cast-ALT',
  0xf: 'Cast-User',
  0x10: 'Blessing',
  0x11: 'Attacking',
  0x12: "BS'ing",
  0x13: 'Hiding',
  0x15: 'Casting',
  0x17: 'Bashing',
  0x18: 'Picking',
  0x19: 'Disarming',
  0x1a: 'Opening',
  0x1b: 'Sneaking',
  0x1c: 'Getting',
  0x1d: 'Dropping',
  0x1e: 'Stashing',
  0x1f: 'Equipping',
  0x20: 'Looking',
  0x21: 'Searching',
  0x22: 'Tracking',
  0x23: 'Who',
  0x24: 'Top',
  0x25: 'Inventory',
  0x26: 'Depositing',
  0x27: 'Withdrawing',
  0x28: 'Buying',
  0x29: 'Selling',
  0x2a: 'Teleported',
  0x2b: 'Get Exits',
  0x2c: 'Training',
  0x2d: 'Pending Cmd',
  0x2e: 'Other',
  0x2f: 'Recovering'
};

/** The idle state's name: the last condition that holds wins. */
function idleName(s: Session): string {
  if (s.inGame === 0) return 'Nothing';
  let name = s.hidden !== 0 ? 'Hidden' : 'Nothing';
  if (s.following !== 0) name = 'Following';
  if (s.f_a5f8 >= 1) name = 'Mass Equip';
  if (s.waitLines >= 1) name = 'Wait-Lines';
  if (s.waitPrompt >= 1) name = 'Wait-Prompt';
  if (s.partyWait !== 0) name = 'Party Wait';
  if (s.chaseTarget !== '') name = 'Chasing';
  if (s.confused !== 0) name = 'Confused';
  if (s.poisoned !== 0 && s.Other_IgnorePoison === 0) name = 'Poisoned';
  if (s.blind !== 0) name = 'Blind';
  if (s.held !== 0) name = "Can't Move";
  if (s.hp < 1) name = 'Dying';
  return name;
}

/** The status text, with the count MegaMUD puts after it in brackets. */
export function statusText(s: Session): string {
  let name: string;
  switch (s.state) {
    case 0:
      name = idleName(s);
      break;
    case 1:
      name = '';
      break;
    case 2:
      name = 'resting';
      break;
    case 3:
      name = s.restHpToFull !== 0 || s.restManaToFull !== 0 ? 'Resting (to full)' : 'Resting';
      if (
        idiv(s.Player_MaxHP * s.Health_HpFullPct, 100) <= s.hp &&
        s.mana < idiv(s.Player_MaxMana * s.Health_ManaFullPct, 100)
      ) {
        name = classMagic(s.data, s.Player_Class) === 5 ? 'Kai Regen' : 'Mana Regen';
      }
      if (s.partyWait !== 0) name = 'Party Wait';
      break;
    case 4:
      name = 'meditating';
      break;
    case 5:
      name = s.restManaToFull !== 0 ? 'Medi. to Full' : 'Meditating';
      break;
    case 0x16:
      name = s.rescueCount >= 1 ? 'Rescuing' : s.runCount >= 1 ? 'Running' : 'Moving';
      break;
    default:
      name = NAMES[s.state] ?? 'Unknown';
  }
  let count: number | null = null;
  if (s.state === 0x16) {
    if (s.rescueCount >= 1) count = s.rescueCount;
    else if (s.runCount >= 1) count = s.runCount;
  } else if (f_426ab0(s, 0) !== 0 || s.state === 0x15) {
    count = castCount(s, s.state);
  } else if (s.state === 0) {
    if (s.f_a5f8 >= 1) count = s.f_a5f8;
    else if (s.waitLines >= 1) count = s.waitLines;
    else if (s.waitPrompt >= 1) count = s.waitPrompt;
  }
  return count === null ? name : `${name} (${count})`;
}

/** `0x4ac2a0` as the engine calls it: the status is handed to the host when it changes. */
export function refreshStatus(s: Session): void {
  const text = statusText(s);
  if (text !== s.statusShown) {
    s.statusShown = text;
    s.host.status?.(text);
  }
}
