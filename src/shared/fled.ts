/**
 * The monsters this character ran from for its health, and at what level: a
 * fight is not opened on one again until the character is `fledLevels` past
 * the level it ran at, or `fledForgetMs` has passed. Kept with what the
 * character owns (`Belongings`), per realm, so a restart does not walk it
 * back into the mad wizard it ran from three times.
 *
 * Per level and on a clock, not for ever: running from a kobold at level 1
 * says nothing about level 25, and a loop whose only monster was run from
 * once must not stop earning the levels that would lift it. Dependency-free
 * like everything in `shared/`.
 */

export interface FledEntry {
  /** The monster's name as `mobKey` folds it. */
  name: string;
  /** The character's level when it ran; null where the sheet had not said. */
  level: number | null;
  at: number;
}

/** Whether a value read back from disk is a list of entries. */
export function isFledList(value: unknown): value is FledEntry[] {
  return (
    Array.isArray(value) &&
    value.every(
      (entry) =>
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as FledEntry).name === 'string' &&
        typeof (entry as FledEntry).at === 'number' &&
        ((entry as FledEntry).level === null || typeof (entry as FledEntry).level === 'number')
    )
  );
}
