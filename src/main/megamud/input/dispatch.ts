/**
 * `0x479b20`: one line handed to MegaMUD's line handlers, in its order, the
 * first that takes it ending the chain. Read 2026-10-12.
 *
 * `complete` is 1 for a whole line and 0 for what a chunk leaves without a
 * line end (a prompt). `nested` is 1 when the prompt handler calls back in
 * with an empty line. The number set in `parseStep` before each handler is
 * MegaMUD's own "parse step", kept as `parseStep` for the trace.
 *
 * Two handlers (`0x46a920` with its first argument 0, and `0x4045b0`) are
 * consulted without ending the chain. When no handler takes the line the
 * answer is `probablyLineHandled`, which handlers set to say "handled" without stopping
 * the others.
 */
import { abilitiesListLine } from '../abilities/list';
import { abilityLine } from '../abilities/monitors';
import { blowLine } from '../combat/blows';
import { combatEngaged } from '../combat/engaged';
import { combatEventLine } from '../combat/events';
import { hitLine } from '../combat/hits';
import { indexOf } from '../cstr';
import { bankLine } from '../items/bank';
import { buyLine } from '../items/buy';
import { dropLine } from '../items/drop';
import { equipLine } from '../items/equip';
import { getLine } from '../items/get';
import { inventoryLine } from '../items/inventory';
import { sellLine } from '../items/sell';
import { messageLine } from '../messages/messages';
import { bashLine } from '../move/bash';
import { exitsLine } from '../move/exits';
import { moveLine } from '../move/moves';
import { trapLine } from '../move/traps';
import { unlockLine } from '../move/unlock';
import { partyLine } from '../party/party';
import { rankLine } from '../party/ranks';
import { castLine } from '../player/cast';
import { corpseLine } from '../player/corpse';
import { illLine } from '../player/ill';
import { restLine } from '../player/rest';
import { stealthLine } from '../player/stealth';
import { trainLine } from '../player/train';
import { lookLine } from '../players/look';
import { topLine } from '../players/top';
import { whoLine } from '../players/who';
import { alsoHereLine } from '../room/alsoHere';
import { coinsDropLine } from '../room/coins';
import { comingsLine } from '../room/comings';
import { noticeLine } from '../room/notice';
import { roomLine } from '../room/room';
import { roomNameLine } from '../room/roomName';
import { locationLine } from '../room/where';
import { forgetAwaited, setState } from '../script/state';
import type { LineBuf, Session } from '../Session';
import { spellbookLine } from '../spells/spellbook';
import { expLine } from '../stats/exp';
import { statLine } from '../stats/stats';
import { refreshStatus } from '../status';
import { talkLine } from '../talk/talk';
import { bbsLine, connectThreadLine } from './connect';
import { pagerPrompts } from './pager';
import { statusLine } from './statline';
import { State } from '../states';
import { LineFlag, WHO_LISTING, INVENTORY_LISTING, PROMPT_SEEN } from '../flags';
import { Task } from '../script/task';

/** The handlers after the in-game checks, each with its parse step. */
const CHAIN: [number, (s: Session, line: string) => number][] = [
  [9, combatEngaged],
  [10, roomNameLine],
  [0xb, moveLine],
  [0xc, exitsLine],
  [0xd, (s, line) => inventoryLine(s, line, 0)],
  [0xe, statLine],
  [0xf, whoLine],
  [0x10, topLine],
  [0x11, partyLine],
  [0x12, spellbookLine],
  [0x13, alsoHereLine],
  [0x14, comingsLine],
  [0x15, noticeLine],
  [0x16, coinsDropLine]
];

const CHAIN2: [number, (s: Session, line: string) => number][] = [
  [0x19, rankLine],
  [0x1a, expLine],
  [0x1b, castLine],
  [0x1c, stealthLine],
  [0x1d, illLine],
  [0x1e, restLine],
  [0x1f, bashLine],
  [0x20, unlockLine],
  [0x21, trapLine],
  [0x30, corpseLine],
  [0x22, getLine],
  [0x23, dropLine],
  [0x24, equipLine],
  [0x25, buyLine],
  [0x26, sellLine],
  [0x27, lookLine],
  [0x28, trainLine],
  [0x29, combatEventLine],
  [0x2a, hitLine],
  [0x2b, blowLine],
  [0x2c, abilitiesListLine],
  [0x2d, roomLine]
];

function handled(s: Session): number {
  if (s.debug !== 0) s.host.trace(`{L${s.parseStep}}`);
  return 1;
}

export function dispatchLine(s: Session, buf: LineBuf, complete: number, nested: number): number {
  let line = buf.text;
  if (nested === 0) s.probablyLineHandled = 0;
  s.parseStep = 2;
  const inGame = complete !== 0 && s.task !== Task.Exiting && s.inGame !== 0 && s.online !== 0;
  if (!inGame && pagerPrompts(s, line, complete) !== 0) return handled(s);

  s.parseStep = 3;
  const comm = s.task;
  if ((comm > Task.Idle && comm < Task.InGame) || comm === Task.Entering || comm === Task.Exiting) {
    if (comm === Task.Connecting || comm === Task.Connecting2) return connectThreadLine(s);
    const answer = bbsLine(s, line, complete);
    if (answer !== -1) return answer;
  }

  s.parseStep = 4;
  if (indexOf(line, '<CE-2') !== -1) {
    s.lineFlags &= ~PROMPT_SEEN;
    if (s.state === State.Inventory) {
      s.lineFlags &= ~INVENTORY_LISTING;
      forgetAwaited(s, State.Inventory);
      setState(s, State.Nothing);
      s.weightMax = 0;
      s.inventoryQuietAt = 0;
      s.inventoryStartedAt = 0;
    }
    if (s.state === State.Who) {
      if ((s.lineFlags & WHO_LISTING) !== 0) s.lineFlags &= ~WHO_LISTING;
      forgetAwaited(s, State.Who);
      setState(s, State.Nothing);
      s.whoQuietAt = 0;
    }
    if (s.state === State.Top) {
      s.lineFlags &= ~LineFlag.TopListing;
      forgetAwaited(s, State.Top);
      setState(s, State.Nothing);
      s.topQuietAt = 0;
    }
    return 1;
  }

  s.parseStep = 5;
  const prompt = nested === 0 ? statusLine(s, buf, complete) : 0;
  // The prompt is cut off the buffer in place, and the C reads the buffer on
  // whatever `statusLine` answered: a whole line behind a prompt
  // (`[HP=…]:*Combat Engaged*`) is read without it.
  line = buf.text;
  if (prompt !== 0) {
    dispatchLine(s, { text: '', attr: [] }, 1, 1);
    if (line.length === 0 && complete === 0) return 0;
    s.lineFlags &= ~PROMPT_SEEN;
    refreshStatus(s);
  }
  if (complete === 0) return 0;

  s.parseStep = 0x31;
  if (locationLine(s, line) !== 0 && s.debug !== 0) s.host.trace(`{L${s.parseStep}}`);

  s.parseStep = 6;
  if (s.inGame !== 0 && messageLine(s, line, 1) !== 0) return handled(s);
  s.parseStep = 7;
  if (talkLine(s, line) !== 0) return handled(s);
  s.parseStep = 8;
  if (pagerPrompts(s, line, complete) !== 0) return handled(s);
  if (s.inGame === 0) return 0;

  for (const [step, handler] of CHAIN) {
    s.parseStep = step;
    if (handler(s, line) !== 0) return handled(s);
  }
  s.parseStep = 0x17;
  if (messageLine(s, line, 0) !== 0 && s.debug !== 0) s.host.trace(`{L${s.parseStep}}`);
  s.parseStep = 0x18;
  if (bankLine(s, line) !== 0) return handled(s);
  s.parseStep = 0x2e;
  if (abilityLine(s, line) !== 0 && s.debug !== 0) s.host.trace(`{L${s.parseStep}}`);
  for (const [step, handler] of CHAIN2) {
    s.parseStep = step;
    if (handler(s, line) !== 0) return handled(s);
  }
  s.parseStep = 0x2f;
  return s.probablyLineHandled === 0 ? 0 : 1;
}
