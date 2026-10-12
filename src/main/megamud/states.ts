/**
 * MegaMUD's activity state (`db28`), the number every scheduler step tests,
 * set through `0x4aa770`. The names are the status bar's (`0x4ac2a0`, read
 * 2026-10-12); 1, 2 and 4 have none of their own there (1 shows nothing, 2
 * and 4 are the lower-case "resting" and "meditating" of a rest asked for
 * but not yet confirmed).
 */
export const State = {
  Nothing: 0,
  Waiting: 1,
  RestAsked: 2,
  Resting: 3,
  MeditateAsked: 4,
  Meditating: 5,
  Poisoned: 6,
  Hanging: 7,
  Relogging: 8,
  CastPreMulti: 9,
  CastMulti: 0xa,
  CastPre: 0xb,
  CastAux: 0xc,
  CastMain: 0xd,
  CastAlt: 0xe,
  CastUser: 0xf,
  Blessing: 0x10,
  Attacking: 0x11,
  Backstabbing: 0x12,
  Hiding: 0x13,
  Unknown: 0x14,
  Casting: 0x15,
  Moving: 0x16,
  Bashing: 0x17,
  Picking: 0x18,
  Disarming: 0x19,
  Opening: 0x1a,
  Sneaking: 0x1b,
  Getting: 0x1c,
  Dropping: 0x1d,
  Stashing: 0x1e,
  Equipping: 0x1f,
  Looking: 0x20,
  Searching: 0x21,
  Tracking: 0x22,
  Who: 0x23,
  Top: 0x24,
  Inventory: 0x25,
  Depositing: 0x26,
  Withdrawing: 0x27,
  Buying: 0x28,
  Selling: 0x29,
  Teleported: 0x2a,
  GetExits: 0x2b,
  Training: 0x2c,
  PendingCmd: 0x2d,
  Other: 0x2e,
  Recovering: 0x2f
} as const;

/** `0x426b00`: the attack-cast states, 9 to 15. */
export function isCastState(state: number): boolean {
  return state - 9 >= 0 && state - 9 <= 6;
}
