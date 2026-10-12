# Porting MegaMUD's engine

Decided 2026-10-12: mudengine's own decision engine is replaced by a port of
`megamud.exe`'s, function by function, and the character settings are replaced
by MegaMUD's own. Pathing (`Walker`, `LoopRunner`, the world graph), the display,
the parsers that feed it and the connection stay. Work happens on the
`megamud-engine` branch. `main` keeps the current engine until the port can
hunt, and the old engine is deleted in the swap.

The readings behind every step are in `megamud-exe.md`, with addresses.

## The shape of MegaMUD's engine

**One scheduler, `0x40bab0`, run from `ParseData` (`0x479630`)** after each
chunk the server sends. It is driven by input, never by a timer. Each pass
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
| 21 | `0x49c570` | (to read) |
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
| 44 | `0x407c90` | path commands |
| 45 | `0x40aff0` | search |
| 46 | `0x40ce50` | stash |
| 47 | `0x408270` | no allowed exits |
| 48 | `0x409170` | **walk the path: kept as ours (`Walker`/`LoopRunner`)** |
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

## Kept, outside the loop

These are user-started actions that hand control to the loop as a path does:
`Walker`, `LoopRunner`, auto-hunt, the quest runner, item errands, wards and
auto-keys. The login automator also stays.

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
