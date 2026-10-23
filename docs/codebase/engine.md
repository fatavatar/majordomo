# The MegaMUD engine

Every character is played by a port of `megamud.exe`'s decision engine,
function by function (decided 2026-10-12, swapped in 2026-10-14). This page
is about how the port sits inside the client. What MegaMUD itself does, and
how the port maps onto its functions, is in
[`docs/megamud/engine-port.md`](../megamud/engine-port.md); the readings of
the binary, with addresses, are in
[`docs/megamud/megamud-exe.md`](../megamud/megamud-exe.md).

## Two layers

| Layer | Where | What it is |
|---|---|---|
| The port | `src/main/megamud/` | MegaMUD's own code in TypeScript: its session struct, line handlers and scheduler steps, each module naming the addresses it ports. It knows nothing of our client beyond a small host interface. |
| The adapter | `src/main/session/MegaEngine.ts` | Runs the port for one connection: feeds it text, keeps its clocks, answers its host calls with our world graph and stores, and keeps what it learns. |

`SessionManager` builds one `MegaEngine` per session (`useMegaMud`), from a
setup `client.ts` makes (`megamudFor`).

## The port, `src/main/megamud/`

- **State.** `Session.ts` is MegaMUD's per-connection struct, one field per
  struct field, its offset in a comment. `SettingsFields.ts` (generated from
  the settings schema, do not edit) declares every setting as a field named
  `Section_Key` (`Health.HpFull%` is `Health_HpFullPct`, see
  `fieldNames.ts`). `StateFields.ts` holds the working flags, counters and
  clocks. Flag bits are named in `flags.ts`, activity states in `states.ts`.
- **Naming rule.** Nothing is named by its address. A field or function only
  partly understood is `probably…`, one not understood `unknown_<offset>`,
  and one the port never reads is not declared. Comments name the address
  (`0x40bab0`) and the date it was read.
- **Reading lines** (MegaMUD's line handlers): `input/` (`ParseData`, the
  dispatcher, the status line, listings, the pager, typed input), `room/`
  (the room's name, `Also here`, comings and goings), `player/` (casting,
  resting, stealth, training, corpses, illness), `players/`, `party/`,
  `talk/`, `messages/` (the realm's message table), `stats/`, and the
  combat lines in `combat/` (`blows`, `hits`, `events`).
- **Steps** (what the scheduler can do): `script/scheduler.ts` is
  `0x40bab0`, one pass asking the steps in MegaMUD's order (the D-numbers
  in its debug log), the first that sends ending the pass. The steps are in
  `script/` (setup, party, bless, cures, cash, items, rules, events, escape,
  the path steps), `health/` (rest, heal, flux, pre- and post-rest),
  `combat/` (attack, heal, casts, engaged modes, the round timer), `items/`
  and `move/` (paths, exits, doors, traps, bashing).
- **Sending.** `script/send.ts` writes straight to the host, keeps the
  pending list (`0x48ab60`), and waits for each command's echo before
  reading its answer.
- **Data.** MegaMUD's databases (monsters, items, spells, classes, races,
  messages) as its code holds them (`data.ts`), built from our own stores
  rather than its `.md` files (`fromWorld.ts`): the realm's facts from the
  converted world, the player's choices from the realm's tables.
- **Settings.** `character.ts` puts a character's settings onto the
  session as MegaMUD's loader does, including `[AbilMon]`, `[Schedule]` and
  `[Rules]`. The schema of every setting, its type and default, is
  `src/shared/megamud/schema.ts`; the tabs the settings screen shows are
  `settingsTabs.ts`.
- **C helpers.** `cstr.ts` holds the string routines MegaMUD calls, ported
  with their edge cases (fixed buffer lengths included), so a handler
  behaves as the decompile reads.

Tests for the port are in `src/main/megamud/__tests__/`, each case read off
the decompile, with a fixture session (`fixture.ts`) whose host records what
the engine sent, showed and traced.

## The adapter, `MegaEngine.ts`

**In.** `received(text)` stamps the clock and runs `parseData`, the port's
reader, which runs the scheduler at the end of a chunk. Before that,
`SessionManager` hands it what our tracker read that the port would
otherwise get wrong: buffs, afflictions, and `located()` when our tracker
places the room. Two timers drive the rest: `secondTick` once a second, and
`quietTick` for MegaMUD's silences.

**Out.** The port's writes go to `MegaEngineHost.write`, which is
`SessionManager.megaWrite` (straight to the socket, held behind a half-typed
line). Its status, what it is doing and its gate changes go to the capture
as `engine` records.

**What we lend it** (`MegaEngineHost`):

| Hook | What it answers |
|---|---|
| `here()`, `locate()` | where our tracker places the character, and asking the realm where it is |
| `world()`, `plan(from, to)` | the world graph, and a planned route (A* on the route worker) in place of MegaMUD's search over its path files |
| `loopRooms(name)` | a loop's stops and the commands typed at each, which become a MegaMUD path (the commands as steps that do not move, before the leg out of their stop) |
| `beforeStep(to)` | wards and doors before each step of a path (`SessionHost`) |
| `fetchFirst(items, then)` | an item errand for a key or item a walk needs, then the walk again |
| `opensAWay`, `leaveFor` | whether an item opens a way on the realm, or is left for a party member's errand |
| `ask(text)` | MegaMUD's yes-or-no message boxes, put to the player |
| `dial`, `hangUp`, `enteredGame`, `progressed`, `counted`, `alert` | the connection, walk progress, the statistics window, desktop alerts |

**Setup** (`MegaEngineSetup`, from `megamudFor` in `client.ts`): the
character's MegaMUD settings (its profile's `megamud:` block), the data
built from the world and the realm's tables, the per-player remote grants,
the BBS set-up from the server's `bbs:` block, and what the engine learned
before. Saving the settings calls `reload`, which puts the new settings on
the running session without rebuilding it.

**What it learns** is kept between launches: monster stances in the realm's
lore, items it has met and room signatures in `MegaLearned`
(`megamud-learned.json`), and monsters marked immune to a spell
(`EngineLessons.marks`).

## Paths and the world graph

MegaMUD walks paths: each step is the room it starts from, by MegaMUD's
**signature** (a hash of the room's name in the top bits, plus exit bits),
and the command to type. We have no recorded paths; our world graph plans a
route and `MegaEngine` turns it into a MegaMUD path, with each room's
signature, keys for locked doors written as MegaMUD's recorded paths write
them (`sw[use <key> sw]`), lever detours, and trap flags. Signatures the
engine learns where it and our tracker stood in the same room are kept, so a
path is not relearned every launch.

## Deviations from MegaMUD

The port follows the binary, branch for branch. Where it answers differently
on purpose, the code says so with the date it was asked for, and
`engine-port.md` lists the general ones (*Where we answer differently from
MegaMUD*). Examples from 2026-10-21: a damage line the message table files
under a spell this character does not know counts for the cast spell
(`spells/lookup.ts`, `landsAs`); the heals and blessings run before resting
after a MUD op's `sys goto` (`script/scheduler.ts`).

## Changing the port

1. Find the function in the decompile (`~/tools/port/dc/<addr>.c`, or
   decompile more with the Ghidra command in `engine-port.md`, *Tooling*).
2. Port it in the module that holds its neighbours, branches in the same
   order, fields by their port names.
3. Test it with cases read off the decompile, through the fixture session.
4. Replay a capture where it went wrong (`npm run replay`, see
   [development.md](development.md)) to see the live engine's steps beside the
   replayed ones.
