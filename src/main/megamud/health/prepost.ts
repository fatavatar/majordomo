/**
 * The commands MegaMUD sends around a rest or a meditation (Health tab:
 * `PreRestCmd`, `PostRestCmd`, `PreMedCmd`, `PostMedCmd`), each owed once
 * per sit-down (`0x4140c0`, `0x413c50`, `0x413e80`, `0x413b50`). See
 * docs/megamud/megamud-exe.md, *Rest and meditate: pre/post commands*.
 */
import { expandMacros, noteCommands, send } from '../script/send';
import { setState } from '../script/state';
import type { Session } from '../Session';

function issue(s: Session, command: string, what: string): number {
  s.waitLines = 2;
  noteCommands(s, command);
  setState(s, 0x2e);
  s.host.activity(what);
  const out = expandMacros(s, command);
  send(s, out);
  if (!out.includes('\r')) send(s, '\r');
  return 1;
}

/** `0x4140c0`: the pre-rest command, owed once; settling a meditation first. `force` sends it regardless. */
export function preRest(s: Session, force: number): number {
  if (force === 0) {
    if (s.Health_PrePostMeditate !== 0) {
      if (s.owedPostMeditate === 0) {
        if (s.Health_PreMedCmd !== '' && s.Health_PrePostRest === 0 && preMeditate(s, 1) !== 0)
          return 1;
      } else if (
        (s.Health_PreMedCmd !== '' || s.Health_PostMedCmd !== '') &&
        s.Health_PrePostRest === 0
      ) {
        return 0;
      }
    }
    if (
      s.owedPostMeditate !== 0 &&
      s.Health_PrePostRest !== 0 &&
      (s.Health_PreRestCmd !== '' || s.Health_PreMedCmd !== '') &&
      s.Health_PreMedCmd.toLowerCase() === s.Health_PreRestCmd.toLowerCase() &&
      s.Health_PostMedCmd.toLowerCase() === s.Health_PostRestCmd.toLowerCase()
    ) {
      s.owedPostMeditate = 0;
      s.owedPostRest = 1;
      return 0;
    }
    if (postMeditate(s, 0) !== 0) return 1;
  }
  if (s.owedPostRest === 0 || force !== 0) {
    s.owedPostRest = 1;
    if (
      s.Health_PreRestCmd !== '' &&
      ((s.f_a32c === 0 && s.Health_PrePostRest !== 0) || force !== 0)
    ) {
      return issue(s, s.Health_PreRestCmd, 'Issuing pre-rest');
    }
  }
  return 0;
}

/** `0x413c50`: the post-rest command, when owed (or `force`d). */
export function postRest(s: Session, why: number, force: number): number {
  if (s.owedPostRest !== 0 || force !== 0) {
    s.owedPostRest = 0;
    if (
      s.Health_PostRestCmd !== '' &&
      ((s.f_a32c === 0 && s.Health_PrePostRest !== 0) || force !== 0)
    ) {
      return issue(s, s.Health_PostRestCmd, `Issuing post-rest(${why})`);
    }
  }
  return 0;
}

/** `0x413e80`: the pre-meditate command, owed once; settling a rest first. */
export function preMeditate(s: Session, force: number): number {
  if (force === 0) {
    if (s.Health_PrePostRest !== 0) {
      if (s.owedPostRest === 0) {
        if (s.Health_PreRestCmd !== '' && s.Health_PrePostMeditate === 0 && preRest(s, 1) !== 0)
          return 1;
      } else if (
        (s.Health_PreRestCmd !== '' || s.Health_PostRestCmd !== '') &&
        s.Health_PrePostMeditate === 0
      ) {
        return 0;
      }
    }
    if (
      s.owedPostRest !== 0 &&
      s.Health_PrePostMeditate !== 0 &&
      (s.Health_PreRestCmd !== '' || s.Health_PreMedCmd !== '') &&
      s.Health_PreMedCmd.toLowerCase() === s.Health_PreRestCmd.toLowerCase() &&
      s.Health_PostMedCmd.toLowerCase() === s.Health_PostRestCmd.toLowerCase()
    ) {
      s.owedPostRest = 0;
      s.owedPostMeditate = 1;
      return 0;
    }
    if (postRest(s, 9, 0) !== 0) return 1;
  }
  if (s.owedPostMeditate === 0 || force !== 0) {
    s.owedPostMeditate = 1;
    if (
      s.Health_PreMedCmd !== '' &&
      ((s.f_a32c === 0 && s.Health_UseMeditate !== 0 && s.Health_PrePostMeditate !== 0) ||
        force !== 0)
    ) {
      return issue(s, s.Health_PreMedCmd, 'Issuing pre-meditate');
    }
  }
  return 0;
}

/** `0x413b50`: the post-meditate command, when owed (or `force`d). */
export function postMeditate(s: Session, force: number): number {
  if (s.owedPostMeditate !== 0 || force !== 0) {
    s.owedPostMeditate = 0;
    if (
      s.Health_PostMedCmd !== '' &&
      ((s.f_a32c === 0 && s.Health_UseMeditate !== 0 && s.Health_PrePostMeditate !== 0) ||
        force !== 0)
    ) {
      return issue(s, s.Health_PostMedCmd, 'Issuing post-meditate');
    }
  }
  return 0;
}
