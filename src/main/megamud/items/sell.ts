/**
 * `0x455d30`: selling, read 2026-10-12: `You sold … for …` (carried no more;
 * the coins received carried; then the coins made again from the wealth);
 * `… to sell!` / `You cannot SELL` (the errand is off: walking stops).
 */
import { indexFrom, indexOf, leadingNumber, trimSpaces } from '../cstr';
import { modeDefaults } from '../script/modes';
import { forgetAwaited, setState } from '../script/state';
import type { Session } from '../Session';
import { coinList } from './buy';
import { carryLess, carryMore } from './inventory';

function received(s: Session): (name: string, count: number) => void {
  return (name, count) => {
    carryMore(s, name, count);
  };
}

export function sellLine(s: Session, line: string): number {
  if (indexOf(line, ' to sell!') !== -1 || indexOf(line, 'You cannot SELL') !== -1) {
    s.s_8474 = '';
    forgetAwaited(s, s.state);
    setState(s, 0);
    if (s.walking !== 0) {
      s.walking = 0;
      modeDefaults(s);
      s.host.alert?.('idle');
    }
    return 1;
  }
  let at = 0;
  if ((s.lineFlags & 0x200000) === 0) {
    const sold = indexOf(line, 'You sold ');
    const forAt = sold === -1 ? -1 : indexFrom(line, sold + 9, ' for ');
    if (sold === -1 || forAt === -1) return 0;
    let name = trimSpaces(line.slice(sold + 9, sold + 9 + Math.min(forAt - sold - 9, 0x1e)));
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
    if (count > 0) carryLess(s, name, count, 0x29);
    at = forAt + 5;
  } else {
    s.lineFlags &= ~0x200000;
  }
  // Unlike a purchase, a sale's list does not carry over a line: what was kept is dropped.
  s.s_d910 = '';
  return coinList(s, line, at, 0x200000, received(s));
}
