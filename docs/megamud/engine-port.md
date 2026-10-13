# Porting MegaMUD's engine

Decided 2026-10-12: mudengine's own decision engine is replaced by a port of
`megamud.exe`'s, function by function, and the character settings are replaced
by MegaMUD's own. Pathing (`Walker`, `LoopRunner`, the world graph), the display,
the parsers that feed it and the connection stay. Work happens on the
`megamud-engine` branch. `main` keeps the current engine until the port can
hunt, and the old engine is deleted in the swap.

The readings behind every step are in `megamud-exe.md`, with addresses.

## The shape of MegaMUD's engine

**Three entry points**, all window messages handled by `0x4657f0`:

- **Data** (`0x499`, from the network thread `0x42c910`) → `0x462c00` →
  `ParseData` (`0x479630`). It frames characters into a line buffer, keeping
  each character's colour beside it (handlers test colours: `Also here:` must
  be magenta or green), then hands each line to `0x479b20`, which dispatches to
  the line handlers.
- **Once a second** (`WM_TIMER` 100) → `0x4653d0`. It stamps the clock
  (`0x32290`, `_time64`). Every timing test reads that stamp, never a live
  clock. Then come AFK, events, lag re-prompts after `Comms.LagWait` and the
  periodic checks.
- **Silence** (`0x49c`, after 2, 5, 10, 30 and 60 seconds without data) →
  `0x464910`, which includes the `{30s}` tick (`0x40a9c0`).

The port has these as `script/timer.ts`: the host calls `secondTick` once a
second, `dataArrived` whenever data is read, and `quietTick` from its read
loop. `quietTick` is the network thread's part (`0x42c910`): with nothing
received it runs the data message (and so the scheduler) once a second and
the silences after `Comms.LagWait` + 2, + 6 and + 10 seconds.

The activity state (`db28`, set by `0x4aa770`) is one of the 48 the status
bar names (`0x4ac2a0`): 0 Nothing, 3 Resting, 5 Meditating, 9–15 the attack
casts, 0x11 Attacking, 0x16 Moving/Running, … See `states.ts`.

**One scheduler, `0x40bab0`, run from `ParseData`** after a chunk, when no
partial line is held and bit 0 of `d904` is set. Each pass
asks the steps below in order, and the first that sends something ends the
pass. The numbers are the `{D%d}` debug tags MegaMUD logs.

| D | Address | Step |
|---|---|---|
| — | `0x416f80` | housekeeping before anything |
| — | `0x48ad60` | the pending list: `@wait`, `@comeback`, `drop`, `suicide`, `reroll` |
| — | `0x42c150` | `break` out of a fight that is over |
| 10 | `0x414300` | health, first pass (only while `e23c`) |
| 12 | `0x40b520` | backstab kit: shield off, BS weapon on, sneak |
| 13 | `0x40b200` | game setup: `set statline`, `brief`, … |
| 14 | `0x40d0e0` | `exp`, `spells`/`powers`, `stat` when stale |
| 15 | `0x407e40` | inventory when stale |
| 16 | `0x40d820` | who's online |
| 17 | `0x408e40` | party status, `@health` |
| 18 | `0x410780` | discard unwanted coins |
| 51 | `0x497840` | recover a corpse |
| 19 | `0x40e080` | get what we collect |
| 20 | `0x410d00` | auto-equip |
| 21 | `0x49c570` | rules (`[Rules]`): conditions and actions |
| 22 | `0x4066f0` | bless, in combat |
| 23 | `0x4120b0` | combat: heal (`0x412120`) and attack (`0x412b10` → `0x40f510`) |
| 24 | `0x410440` | stay hidden, in combat |
| 26 | `0x410130` | cures, in combat |
| 27 | `0x407ee0` | invite players |
| 28 | `0x413760` | heal casts |
| 29 | `0x407390` | events: logon, logoff, re-log, timed, repeated |
| 50 | `0x403c70` | ability monitors |
| 30 | `0x40dc20`, `0x40e190` | low-HP escape, then running away |
| 31 | `0x4118f0` | exit: BBS shutdown, timed logoff, relog |
| 33/34 | `0x410440`, `0x410130` | hide and cures, out of combat |
| 35 | `0x408100` | look at a player |
| 36 | `0x40d2e0` | track a player |
| 37 | `0x40b300` | share cash with the party |
| 38 | `0x46fee0` | `sys stat room` check |
| 39 | `0x414300` | health: full spells, regen, rest, meditate |
| 40 | `0x406d90` | deposit |
| 41 | `0x40d8a0` | withdraw |
| 42 | `0x406b60` | buy |
| 43 | `0x40b0b0` | sell |
| 44 | `0x407c90` | an imported path's commands |
| 45 | `0x40aff0` | search |
| 46 | `0x40ce50` | stash |
| 47 | `0x408270` | roaming, and finding the way back when lost |
| 48 | `0x409170` | walk the path (the way to it is our world graph's) |
| 49 | `0x407ac0`, `0x40b520` | hide, sneak |

After a pass that sent, the status (`0x4ac2a0`: Resting, Meditating, Party
Wait, …) is refreshed.

The state lives in one struct per connection. The settings are fields of the
same struct, loaded from the character's INI by `0x449aa0`, with defaults set
by `0x447f40`.

## The port

`src/main/megamud/`, one module per MegaMUD function or tight group of
functions, each naming its address. Each is ported from the decompile with its
branches in the same order, and tested with cases read off that decompile.

- `Session.ts`: the state the steps read and write, with named fields. Each
  field's comment gives its struct offset.
- `settings/`: MegaMUD's INI schema (every section and key, its type and its
  default from `0x447f40`), reading and writing MegaMUD's own `.ini` format. A
  character's settings are its `megamud.ini`.
- `Scheduler.ts`: `0x40bab0`, run after each received chunk.
- `send.ts`: `0x42d9f0` (straight to the socket) and the pending list
  (`0x48ab60`, `0x48ad60`), through the existing `CommandQueue` so echo and
  display are unchanged.
- `lines/`: the line handlers that set state (`0x479630` and the handlers it
  dispatches to). Where our tracker already reads the same fact the same way
  it is adapted; where MegaMUD reads it differently, MegaMUD's reading is
  ported.
- `steps/`: the table above.
- Data: MegaMUD's records (monsters, items, spells, messages, players) from the
  realm imports we already have, extended where a step reads a field we drop.

## Walking

MegaMUD walks paths: recorded `.mp` files, each step the room it is taken
from (its signature, `0x8130`), its flags and what is typed. The port walks
them the same way (`script/path.ts`, `move/`): the room checks, the resync,
doors and keys, running back, roaming, the destinations queued and the loop
taken up again. Two things are the host's (`SessionHost`):

- `route(from, to)` in place of MegaMUD's search over its path files
  (`0x43fd90`): our world graph plans the way and hands it over as a path,
  with the rooms' signatures.
- `readPath(name)` in place of reading a path file (`0x482fc0`); without it,
  the paths known (`Session.paths`, MegaMUD's `0x7f20`) are looked in. Our
  loops are made paths this way.

## Running it

A character with a `megamud.ini` beside its profile is run by the port
(`src/main/session/MegaEngine.ts`); one without keeps the old engine until
the swap. For such a character:

- **The old automation stands down** (`SessionManager.configure`): every
  module, the rule engine and the old `@` answers. The login, the display,
  the map and the planners stay.
- **Settings** are the ini's (`megamud/character.ts`, `0x449aa0`), with
  `[AbilMon]`, `[Schedule]` and `[Rules]` read by their own loaders. The
  app's per-player remote grants are turned into MegaMUD's remote bits until
  Players.md is read. The BBS set-up is at the loader's defaults
  (`megamud/bbs.ts`, `0x41bcf0`); the realm's `BBS.INI` is not read yet.
- **Data** is MegaMUD's own `.md` files from the character's data folder:
  `MegaMud.DataDir` when that is a folder here, else the ini's own folder,
  each with its `Default` beneath. Without them MegaMUD learns monsters and
  items as it meets them and knows no spells.
- **Text in**: every chunk the socket gives, after our own reading, so the
  engine can learn the room our tracker placed. **Commands out**: straight
  to the socket, observed as automation's are, a macro's `~` a half-second
  pause. What the player types is shown to it (`0x465d90`).
- **Clocks**: `secondTick` every second, `quietTick` every quarter.
- **The buttons**: the loop card's play is `@loop`'s start of a loop (or Go
  with none named), its stop is Go/Stop (`0x803`), the step back `0x869`,
  and a route asked for is the Go To dialog to its last room.
- **Paths**: our loops and routes are made MegaMUD paths. A room's
  signature is learned whenever the engine and our tracker stand in it
  together, else worked out from the realm data (`worldSignature`); a room
  whose exits the realm data cannot say how the game lists is given the
  relearn mark (`0x80`), which the first walk through fills in. MegaMUD heads
  for destinations only from rooms in its room list (`0x43cb90`): the rooms
  learned and every path's ends are put in it.
- **The settings screen**: Settings → MegaMUD, MegaMUD's own sixteen tabs
  in its order (`0x49eea0`), each control where `MegaRes.dll`'s template
  puts it and bound to the setting the tab's procedure reads and writes
  (`src/shared/megamud/settingsTabs.ts`, generated by
  `~/tools/port/settings_tabs.py`). Health, Spells and Combat switch between
  their four profiles. Saving writes `megamud.ini`; for a character without
  one, that is what switches it to this engine. Not editable yet: the lists a
  tab fills from elsewhere (the special rooms, the sound files, the statline
  items, the toolbar, the colours, BBS accounts, and the events and ability
  monitors).
- **The connection**: `connected` and `connectionClosed` (`0x42c910`'s end)
  from the socket; the engine's hang-up closes it, and its redial (task 2)
  dials the realm again.

## Kept, outside the loop

These are user-started actions that hand control to the loop as a path does:
auto-hunt, the quest runner, item errands, wards and auto-keys. `Walker` and
`LoopRunner` become the route and loop planners behind `route` and
`readPath`. The login automator also stays.

## Deleted at the swap

The modules being deleted, with what replaces each:

| Module | Replaced by |
|---|---|
| `AutoCombat` | MegaMUD's combat |
| `Recovery` | MegaMUD's rest |
| `Regen` | MegaMUD's regen |
| `AutoHeal` | MegaMUD's heal |
| `Cures` | MegaMUD's cures |
| `Blessings` | MegaMUD's bless |
| `Potions` | MegaMUD's health |
| `AutoLoot` | MegaMUD's get |
| `AutoDrop` | MegaMUD's discard |
| `AutoDeposit` | MegaMUD's deposit |
| `Supplies` | MegaMUD's buy and sell |
| `AutoSearch` | MegaMUD's search |
| `AutoStealth` | MegaMUD's sneak and hide |
| `AutoLight` | MegaMUD's AutoLight |
| `Afk` | MegaMUD's AFK |
| `Remotes` | MegaMUD's `@` set only |
| `Events` | MegaMUD's events |
| `Routines` | MegaMUD's setup steps |
| `MessageTriggers` | MegaMUD's Messages.md handling |
| `GearRecovery` | MegaMUD's corpse recovery |
| `HangUp` | MegaMUD's hang-up rules |
| `CombatLease` | none |
| `castRound` | none |
| `AutoInvoke` | none |
| `RuleEngine` | none |
| `EquipmentManager` / gear sets | none |
| `RestAway` | none |
| `TrainErrand` | none |
| `StatScreen` | none |
| learned mob lore | none |

The settings that belonged to the deleted modules go with them. A character's
current settings are converted to `megamud.ini` once, wherever a key maps.

## Order of work

1. **Settings.** The schema from the loader, INI read and write, import of a
   MegaMUD `.ini`, conversion of current profiles, and the settings screen as
   MegaMUD's tabs.
2. **Core.** `Session`, the sender and pending list, the scheduler with every
   step stubbed, the state machine (`0x4a9c00`, `0x4aa770`) and the 30-second
   tick (`0x40a9c0`).
3. **Inputs.** The line handlers the steps' fields depend on.
4. **Steps**, in the order that makes a character hunt: health, combat (heal,
   attack, run), path hand-off, get and cash, bless and cures, sneak and hide,
   party, then the rest.
5. **Swap.** Wire it into `SessionManager`, delete the old modules, and check
   it live on the demo server.

## Tooling

The decompiler lives outside the repository, in `~/tools`, so no part of
MegaMUD is kept in it:

- `~/tools/decomp <addr>…` decompiles the functions holding each address,
  through Ghidra 12.1.4, headless.
- `~/tools/mm-index.tsv` lists every function with its callers, callees and
  strings (the `Index.java` Ghidra script).
- The `Session` struct is applied in the Ghidra project
  (`ApplySession.java`, built from the loader by `port/inischema.py`). Name
  more fields in `~/tools/port/session-fields.txt` and re-run it as they are
  read.

## Notes: the round timer (read 2026-10-12, not yet ported)

- `0x49af50` castAllowed = !`0x49af70`. `0x49af70(s, secs)` is 1 (too soon) when the
  last cast stamp (`0x32308` seconds, or `0x32668` ticks when set) is under `secs + 5`
  seconds old; the tick path is used once `0x32668` is set.
- `0x49b080` stamps a cast: `0x32308 = now`, `0x32660 = 1`, `0x32668 = ticks`, clears
  `0x32670..0x32680`. `0x49ad90` clears the stamps.
- `0x49bb90` expires the stamps after 5000 ms, or at the next round boundary
  (`0x49bfd0`/`0x49b5d0`, 75-tick window via `0x49b890(s, 0x4b)`).
- `0x49bb00(s, kind)` = `0x49b9a0`: a round event (`0x32654` count, `0x32658` ticks,
  `0x3264c` kind); kind 3 → `0x49bb30` (miss streak, `0x32684`, `0x32688` after 3);
  kind 4 resets via `0x49ade0` + `0x49b080`. Events under 1500 ms apart are merged.
- Still to read: `0x49b220`, `0x49b5d0`, `0x49b610`, `0x49bfd0`, `0x49bf20`, `0x49bf70`,
  `0x49be90`, `0x49ade0`.
