import type { Session } from '../Session';
import { unported } from '../unported';

/** `0x40b520`: the backstab kit and sneaking before a fight (D12, D49). Not ported yet. */
export function sneakStep(_s: Session): number {
  return unported('40b520');
}

/** `0x407ac0`: hiding while idle (D49). Not ported yet. */
export function hideStep(_s: Session): number {
  return unported('407ac0');
}

/** `0x410440`: staying hidden (D24 in a fight, D33 out of one). Not ported yet. */
export function stayHidden(_s: Session, _fighting: number): number {
  return unported('410440');
}
