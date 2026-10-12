/**
 * `18 gold crowns drop to the ground.` (`0x472f60`): coins on the floor, as an
 * item entry with their count. Read 2026-10-12.
 */
import { indexOf, leadingNumber } from '../cstr';
import type { Session } from '../Session';
import { checkNames } from './checkNames';
import { prioritize } from './alsoHere';
import { addEntity, removeEntity } from './entities';

const COINS: [string, string][] = [
  ['copper', 'copper farthings'],
  ['silver', 'silver nobles'],
  ['gold', 'gold crowns'],
  ['platinum', 'platinum pieces']
];

export function coinsDropLine(s: Session, line: string): number {
  if (indexOf(line, ' drop to the ground.') === -1) return 0;
  const [count, after] = leadingNumber(line);
  if (count === 0) {
    s.f_e290 = 1;
    return 1;
  }
  const e = addEntity(s);
  e.type = 3;
  e.kind = 2;
  e.count = count;
  const word = line.slice(after).replace(/^ +/, '');
  const coin = COINS.find(([prefix]) => word.startsWith(prefix));
  if (coin) e.name = coin[1];
  else removeEntity(s, s.room.length - 1);
  checkNames(s);
  prioritize(s);
  return 1;
}
