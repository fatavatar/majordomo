/**
 * The steps of a textblock that MME's frmResults leaves as the realm wrote
 * them (2026-10-25), read for what they do.
 *
 * `AddCommandNode` names the steps it knows (an item, a spell, a teleport, a
 * class) and prints every other one verbatim, so a reader of Dhelvanen's
 * reward saw `levelcheck`, `minlevel 20 2614`, `message 2639` and `text 9026`
 * and had to know the textblock language to tell that the first does nothing,
 * the second refuses anybody under level 20 with the words of block 2614, and
 * the last two show a block's words. This reads those, and only those: a step
 * frmResults already names keeps MME's wording.
 *
 * What the verbs mean is the realm's, as the client's own readers have it
 * (`world/questScript.ts`, `world/roomScript.ts`), checked against the realm:
 *
 * - **`message N` and `text N` show block N's words** and do not run its
 *   commands. Blocks keep words beside their commands and the database keeps
 *   only the commands, so the block is linked rather than quoted. That they do
 *   not run it is the realm's own word: `Called From` counts a `text` (9024 is
 *   called from 9022) but never a `message`, and Dhelvanen's cyclops eye shows
 *   `message 347`, which is a greeting's keyword table, not a script.
 * - **A guard's trailing number is the block whose words refuse you**
 *   (`minlevel 20 1220` prints 1220), one argument in by default and more for
 *   the verbs in `GUARDS`.
 * - **`check` and `levelcheck` are the server's filler** (`TextBlockPart.cs:98`
 *   returns at once: the blocks after them do the checking), so they are left
 *   out rather than shown as something the block does.
 */

/** A run of a step's words: plain, or a reference to a record. */
export type StepPart = string | { kind: 'textblock' | 'monster' | 'ability'; n: number };

/** A step read: the icon MME would give it and its words. */
export interface ReadStep {
  icon: 'PAPER' | 'ARROW' | 'REDARROW' | 'MONSTER';
  parts: StepPart[];
}

/** What a step reads as: its words, nothing at all (`drop`), or not one of these (`null`). */
export type StepReading = ReadStep | 'drop' | null;

/** The words of block `n`, as a step shows them. */
const words = (n: number): StepPart => ({ kind: 'textblock', n });

/**
 * The guards, how many arguments say what is wanted, and how that reads. The
 * argument after those, when there is one, is the block whose words refuse.
 */
const GUARDS: Record<string, { args: number; read: (wanted: number[]) => ReadStep }> = {
  minlevel: { args: 1, read: ([l]) => ({ icon: 'REDARROW', parts: [`Min level: ${l}`] }) },
  maxlevel: { args: 1, read: ([l]) => ({ icon: 'REDARROW', parts: [`Max level: ${l}`] }) },
  // Lower is better on this lineage: good is at most the figure, evil at least.
  goodaligned: {
    args: 1,
    read: ([l]) => ({ icon: 'REDARROW', parts: [`Good: alignment ${l} or lower`] })
  },
  evilaligned: {
    args: 1,
    read: ([l]) => ({ icon: 'REDARROW', parts: [`Evil: alignment ${l} or higher`] })
  },
  // `testability N V` succeeds at V or under, the opposite of `checkability`.
  testability: {
    args: 2,
    read: ([n, v]) => ({
      icon: 'ARROW',
      parts: [`Ability, at most ${v}: `, { kind: 'ability', n: n! }]
    })
  },
  needmonster: {
    args: 1,
    read: ([n]) => ({ icon: 'MONSTER', parts: ['Needs in the room: ', { kind: 'monster', n: n! }] })
  },
  nomonsters: { args: 0, read: () => ({ icon: 'REDARROW', parts: ['No monsters in the room'] }) },
  monsters: { args: 0, read: () => ({ icon: 'REDARROW', parts: ['Monsters in the room'] }) }
};

/** A whole number as the realm writes one, or null. */
function int(text: string | undefined): number | null {
  return text !== undefined && /^-?\d+$/.test(text) ? Number(text) : null;
}

/**
 * Reads one step of a textblock that frmResults printed as written.
 *
 * Null for a step that is not one of these, which stays as MME shows it: a
 * verb this does not know is still something the block does.
 */
export function readStep(step: string): StepReading {
  const tokens = step.trim().split(/\s+/);
  const verb = (tokens[0] ?? '').toLowerCase();
  const args = tokens.slice(1);
  const nums = args.map(int);

  if (verb === 'check' || verb === 'levelcheck') return 'drop';

  if ((verb === 'message' || verb === 'text') && args.length === 1 && nums[0] !== null) {
    return {
      icon: 'PAPER',
      parts: [`${verb === 'message' ? 'Message' : 'Text'}, words of: `, words(nums[0]!)]
    };
  }

  // `adddelay 5`, `delay 5`, and the realm's `add delay 5`.
  const delay =
    verb === 'adddelay' || verb === 'delay'
      ? nums[0]
      : verb === 'add' && args[0] === 'delay'
        ? nums[1]
        : undefined;
  if (delay !== undefined && delay !== null && args.length <= (verb === 'add' ? 2 : 1)) {
    return { icon: 'PAPER', parts: [`Delay: ${delay} s`] };
  }

  if (verb === 'addevil' && args.length === 1 && nums[0] !== null) {
    const n = nums[0]!;
    return {
      icon: 'ARROW',
      parts: [`Alignment: ${n >= 0 ? '+' : ''}${n} (${n >= 0 ? 'evil' : 'good'})`]
    };
  }

  const guard = GUARDS[verb];
  if (guard === undefined) return null;
  const wanted = nums.slice(0, guard.args);
  if (wanted.length < guard.args || wanted.some((n) => n === null)) return null;
  // At most one more: the refusal. Anything past that is not a shape this knows.
  if (args.length > guard.args + 1) return null;
  const refusal = args.length > guard.args ? nums[guard.args] : undefined;
  if (refusal === null) return null;
  const read = guard.read(wanted as number[]);
  return refusal === undefined || refusal === 0
    ? read
    : { icon: read.icon, parts: [...read.parts, ', else ', words(refusal)] };
}
