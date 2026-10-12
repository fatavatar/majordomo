import type { Session } from '../Session';
import { unported } from '../unported';

/** `0x4045b0`: not ported yet. */
export function abilityLine(_s: Session, _line: string): number {
  return unported('4045b0');
}

/** `0x403280`: the ability monitors' check at each prompt. Not ported yet. */
export function abilityPrompt(_s: Session): void {
  unported('403280');
}

/** `0x403c70`: the ability monitors' checks (D50). Not ported yet. */
export function abilityMonitors(_s: Session): number {
  return unported('403c70');
}
