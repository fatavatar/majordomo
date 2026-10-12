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

/**
 * `0x401000`: hold off for the ability monitors flagged `bit` (2 rest, 0x20
 * meditate) that act before it: started when one does (`0x402e80`), and
 * holding for up to 20 seconds while one is still going (`0x403980`); a gap
 * over three seconds between checks lets one that has stopped end the hold.
 */
function monitorHold(
  s: Session,
  bit: number,
  gate: { on: number; since: number; checkedAt: number }
): number {
  const t = s.host.tickMs();
  if (s.f_237c === 0 || s.MegaMud_DisableAbilMon !== 0 || s.f_a32c !== 0) return 0;
  if (gate.on !== 0 && t - gate.checkedAt > 3000 && unported('403980') === 0) gate.on = 0;
  gate.checkedAt = t;
  if (gate.on === 0) {
    if (unported('402e80') === 0) return 0;
    gate.on = 1;
    gate.since = s.now;
  }
  if (s.now - gate.since < 0x15) return unported('403980');
  return 0;
}

/** `0x401130`: the monitors that act before a rest. */
export function beforeRest(s: Session): number {
  if (s.resting !== 0) return 0;
  return monitorHold(s, 2, s.restMonitor);
}

/** `0x4010f0`: the monitors that act before a meditation. */
export function beforeMeditate(s: Session): number {
  if (s.meditating !== 0) return 0;
  return monitorHold(s, 0x20, s.meditateMonitor);
}
