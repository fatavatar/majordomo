/**
 * `0x47d7e0`: training, read 2026-10-12. `… money required for your
 * training` (in the train state `0x2c`: fetch the cost from the bank, by
 * MegaMUD's own reckoning of it); the refusals that mean wait for more
 * experience (stats looked at again); the refusals that mean not here
 * (`[Can't train!]`).
 */
import { fetchCash } from '../script/cash';
import { setState } from '../script/state';
import type { Session } from '../Session';
import { recheckStats } from '../stats/exp';

/** The gold `train` costs at a level (`0x40d540`), in copper. */
export function trainingCost(level: number): number {
  const n = level + 2;
  if (level < 10) return n * 0x96;
  if (level === 10) return 3000;
  if (level < 0x14) return n * 0x4e2;
  if (level < 0x32) return n * 3000;
  return n * 4999;
}

const NOT_YET = [
  'required experience necessary to train',
  'experience to train yet',
  'receive training to attain',
  'to train to the next level'
];

const NOT_HERE = [
  'in an appropriate training room',
  'not suitable for your training',
  'to use the training provided',
  'may not train '
];

export function trainLine(s: Session, line: string): number {
  if (line.includes('money required for your training')) {
    if (s.state === 0x2c) {
      s.f_e2a8 = 1;
      setState(s, 0);
      fetchCash(s, 0, s.f_8428 + trainingCost(s.Player_Level));
    }
    return 1;
  }
  if (NOT_YET.some((p) => line.includes(p))) {
    s.f_e2a8 = 1;
    s.f_8468 = 0;
    recheckStats(s);
    setState(s, 0);
    return 1;
  }
  if (!NOT_HERE.some((p) => line.includes(p))) return 0;
  s.f_e2a8 = 1;
  if (s.state === 0x2c) s.f_8b64 = 1;
  setState(s, 0);
  s.host.show("[Can't train!]");
  return 1;
}
