/**
 * `0x453a70`: buying, read 2026-10-12: `You just bought … for …` (carried;
 * the coins paid, listed after `for`, possibly across lines, carried no
 * more; then the coins made again from the wealth); `You cannot buy … here!`
 * (out of stock for now); `You cannot afford …` / `… is not a known item!`
 * (the errand is off: walking stops).
 */
import { indexFrom, indexOf, insertAt, leadingNumber, trimSpaces } from '../cstr';
import { findItem } from '../room/checkNames';
import { modeDefaults } from '../script/modes';
import { forgetAwaited, setState } from '../script/state';
import type { Session } from '../Session';
import { carryLess, carryMore, coinsFromWealth, wealthCarried } from './inventory';
import { State } from '../states';
import { LineFlag, ItemFlag } from '../flags';

/**
 * The coins listed after `for`, from `at` to the line's end (`0x453cc3`,
 * `0x455ef0`): each passed to `each`. A list running onto the next line is
 * kept (`listingRest`) and `pending` set in `lineFlags`.
 */
export function coinList(
  s: Session,
  line: string,
  at: number,
  pending: number,
  each: (name: string, count: number) => void
): number {
  for (;;) {
    let end = indexFrom(line, at, ',');
    if (end === -1) end = indexFrom(line, at, '.');
    if (end === -1) {
      s.listingRest = trimSpaces(line.slice(at, at + 0x1ff));
      if (s.listingRest !== '') {
        s.lineFlags |= pending;
        return 1;
      }
      break;
    }
    let piece = trimSpaces(line.slice(at, at + Math.min(end - at, 0x30)));
    if (piece === '') break;
    if (s.listingRest !== '') {
      piece = trimSpaces(insertAt(insertAt(piece, 0, ' '), 0, s.listingRest));
      s.listingRest = '';
    }
    if (piece === '') break;
    const [count, numEnd] = leadingNumber(piece);
    each(piece.slice(numEnd).replace(/^ +/, ''), count);
    at = line[end] === ',' || line[end] === '.' ? end + 1 : end;
    if (line[at] === ' ') at += 1;
  }
  forgetAwaited(s, s.state);
  setState(s, State.Nothing);
  wealthCarried(s);
  coinsFromWealth(s);
  s.weightMax = 0;
  return 1;
}

/** A coin paid: carried no more. */
function paid(s: Session): (name: string, count: number) => void {
  return (name, count) => carryLess(s, name, count, State.Buying);
}

export function buyLine(s: Session, line: string): number {
  const cannot = indexOf(line, 'You cannot buy ');
  const here = cannot === -1 ? -1 : indexFrom(line, cannot, ' here!');
  if (cannot !== -1 && here !== -1) {
    const name = line.slice(
      cannot + 0xf,
      cannot + 0xf + Math.min(Math.max(here - cannot - 0xf, 0), 0x1e)
    );
    const item = findItem(s, name);
    if (item) {
      item.flags |= ItemFlag.OutOfStock;
      s.host.show(`[${name} temporarily out of stock]`);
    }
    setState(s, State.Nothing);
    return 1;
  }
  if (indexOf(line, 'You cannot afford ') !== -1 || indexOf(line, ' is not a known item!') !== -1) {
    s.weightMax = 0;
    s.itemPickingUp = '';
    forgetAwaited(s, s.state);
    setState(s, State.Nothing);
    if (s.walking !== 0) {
      s.walking = 0;
      modeDefaults(s);
      s.host.alert?.('idle');
    }
    return 1;
  }
  if ((s.lineFlags & LineFlag.BuyCoinsContinue) !== 0) {
    s.lineFlags &= ~LineFlag.BuyCoinsContinue;
    return coinList(s, line, 0, LineFlag.BuyCoinsContinue, paid(s));
  }
  const bought = indexOf(line, 'You just bought ');
  const forAt = bought === -1 ? -1 : indexFrom(line, bought + 0x10, ' for ');
  if (bought === -1 || forAt === -1) return 0;
  let name = trimSpaces(
    line.slice(bought + 0x10, bought + 0x10 + Math.min(forAt - bought - 0x10, 0x1e))
  );
  let count = 1;
  if (/^[0-9]/.test(name)) {
    const [n, end] = leadingNumber(name);
    const rest = name.slice(end);
    const bare = rest.replace(/^ +/, '');
    if (rest[0] === ' ' && bare !== rest && bare !== '') {
      name = bare.slice(0, 30);
      count = n;
    }
  }
  if (count > 0 && carryMore(s, name, count) === 0) return 0;
  return coinList(s, line, forAt + 5, LineFlag.BuyCoinsContinue, paid(s));
}
