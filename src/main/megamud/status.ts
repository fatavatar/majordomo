/**
 * `0x4ac2a0`: the status MegaMUD shows for what it is doing, "Resting",
 * "Cast-Main (2)", "Party Wait", rebuilt whenever a line or a pass changes
 * something. Display only: it changes no state. Read 2026-10-12.
 */
import { inAttackCast, castCount } from './combat/casts';
import { classMagic } from './data';
import type { Session } from './Session';
import { idiv } from './cstr';
import { State } from './states';

const NAMES: Record<number, string> = {
  [State.Poisoned]: 'Poisoned',
  [State.Hanging]: 'Hanging',
  [State.Relogging]: 'Relogging',
  [State.CastPreMulti]: 'Cast-PreM',
  [State.CastMulti]: 'Cast-Mult',
  [State.CastPre]: 'Cast-Pre',
  [State.CastAux]: 'Cast-Aux',
  [State.CastMain]: 'Cast-Main',
  [State.CastAlt]: 'Cast-ALT',
  [State.CastUser]: 'Cast-User',
  [State.Blessing]: 'Blessing',
  [State.Attacking]: 'Attacking',
  [State.Backstabbing]: "BS'ing",
  [State.Hiding]: 'Hiding',
  [State.Casting]: 'Casting',
  [State.Bashing]: 'Bashing',
  [State.Picking]: 'Picking',
  [State.Disarming]: 'Disarming',
  [State.Opening]: 'Opening',
  [State.Sneaking]: 'Sneaking',
  [State.Getting]: 'Getting',
  [State.Dropping]: 'Dropping',
  [State.Stashing]: 'Stashing',
  [State.Equipping]: 'Equipping',
  [State.Looking]: 'Looking',
  [State.Searching]: 'Searching',
  [State.Tracking]: 'Tracking',
  [State.Who]: 'Who',
  [State.Top]: 'Top',
  [State.Inventory]: 'Inventory',
  [State.Depositing]: 'Depositing',
  [State.Withdrawing]: 'Withdrawing',
  [State.Buying]: 'Buying',
  [State.Selling]: 'Selling',
  [State.Teleported]: 'Teleported',
  [State.GetExits]: 'Get Exits',
  [State.Training]: 'Training',
  [State.PendingCmd]: 'Pending Cmd',
  [State.Other]: 'Other',
  [State.Recovering]: 'Recovering'
};

/** The idle state's name: the last condition that holds wins. */
function idleName(s: Session): string {
  if (s.inGame === 0) return 'Nothing';
  let name = s.hidden !== 0 ? 'Hidden' : 'Nothing';
  if (s.following !== 0) name = 'Following';
  if (s.equipsPending >= 1) name = 'Mass Equip';
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
function statusText(s: Session): string {
  let name: string;
  switch (s.state) {
    case State.Nothing:
      name = idleName(s);
      break;
    case State.Waiting:
      name = '';
      break;
    case State.RestAsked:
      name = 'resting';
      break;
    case State.Resting:
      name = s.restHpToFull !== 0 || s.restManaToFull !== 0 ? 'Resting (to full)' : 'Resting';
      if (
        idiv(s.Player_MaxHP * s.Health_HpFullPct, 100) <= s.hp &&
        s.mana < idiv(s.Player_MaxMana * s.Health_ManaFullPct, 100)
      ) {
        name = classMagic(s.data, s.Player_Class) === 5 ? 'Kai Regen' : 'Mana Regen';
      }
      if (s.partyWait !== 0) name = 'Party Wait';
      break;
    case State.MeditateAsked:
      name = 'meditating';
      break;
    case State.Meditating:
      name = s.restManaToFull !== 0 ? 'Medi. to Full' : 'Meditating';
      break;
    case State.Moving:
      name = s.rescueCount >= 1 ? 'Rescuing' : s.runCount >= 1 ? 'Running' : 'Moving';
      break;
    default:
      name = NAMES[s.state] ?? 'Unknown';
  }
  let count: number | null = null;
  if (s.state === State.Moving) {
    if (s.rescueCount >= 1) count = s.rescueCount;
    else if (s.runCount >= 1) count = s.runCount;
  } else if (inAttackCast(s, 0) !== 0 || s.state === State.Casting) {
    count = castCount(s, s.state);
  } else if (s.state === State.Nothing) {
    if (s.equipsPending >= 1) count = s.equipsPending;
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
