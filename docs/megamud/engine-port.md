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
  Players.md is read. A combat spell's cast limit of 0 is no limit (MegaMUD's
  is none): the port is of MegaMUD's decisions, not of its values. The BBS
  set-up is the realm's own (below, `megamud/bbs.ts`, `0x41bcf0`). The
  account `{userid}` and `{pswd}` expand to is the character's own login.
  A few settings MegaMUD reads from two names into one place (the AFK keys
  of `[MegaMud]` and `[Talk]`, `PartyRank` of `[Party]` and `[Other]`) are
  one setting kept under both (`TWINS`, 2026-10-14).
- **Data** is built from our own stores, never read from MegaMUD's `.md`
  files (`megamud/fromWorld.ts`, 2026-10-13). The realm's facts come from its
  converted data (realm format 49 added the class's and spell's magery type,
  the class's weapon type and a monster's `ExpMulti`). Checked against
  Skinny's own files on the same realm, class by class and spell by spell:
  - a class's chart is `100 + ExpTable` and its magic `MageryType << 8 |
    MageryLVL`; a race's experience is its `ExpTable`;
  - a spell's magic is a fixed table of the realm's `Magery` and `MageryLVL`,
    its target bits one of `Targets`, `2` its `Dur`, and `4` the abilities
    Damage, DrainLife, Damage(-MR) and EvilInCombat;
  - a monster's experience is `EXP × ExpMulti`;
  - an item's type is `ItemType`, its location `Worn` (13 filed as 4), its
    weight `Encum`, Cannot be taken `!Gettable`, loyal the `LoyalItem`
    ability, its shop the first the realm stocks it in, and its price that
    shop's list price.

  The player's choices come from the realm's tables: `monsters.yaml`,
  `items.yaml` (MegaMUD's item details) and `messages.yaml`, the last two
  also put on a running engine when edited. Over the realm's tables go the
  options file's and then the character's own rows, field by field:
  `combat.monsters` and `loot.itemDetails` (the Item Details list beside
  Auto-Looting). A character's own MegaMUD
  folder (`profiles/<id>/Default`) is taken into those tables once, where
  the realm has none, and renamed `Default.imported`. Without realm data
  MegaMUD learns monsters and items as it meets them and knows no spells.
- **Learned data** follows MegaMUD's rule and lands in our own stores.
  MegaMUD marks the databases it changed in play (`0xe24c` players, `0xe254`
  monsters, `0xe258` items) and writes the marked ones on the way out
  (`0x43bfa0`). The engine hands its changes over a second after a mark and
  when the session ends (`megamud/saved.ts`): a monster's stance to the
  realm lore (`RealmLore.learnStance`), what it learned of an item and the
  room signatures to `megamud-learned.json` (`MegaLearned`), and nothing of
  players, which our tracker already keeps in `PlayerBook`. Each engine
  starts from its own copy of the realm's data with all of these laid over
  it, players unseen in `Other.DelPlayers` days left out as MegaMUD drops
  them.
- **Text in**: every chunk the socket gives, after our own reading, so the
  engine can learn the room our tracker placed. **Commands out**: straight
  to the socket, observed as automation's are, a macro's `~` a half-second
  pause. What the player types is shown to it (`0x465d90`).
- **Clocks**: `secondTick` every second, `quietTick` every quarter.
- **A character's MegaMUD settings** are its `profile.yaml`'s `megamud:`,
  in MegaMUD's sections and keys where they differ from MegaMUD's defaults,
  read through MegaMUD's loader rules (`settingsFromStored`); having them is
  what runs the character on the engine. A `megamud.ini` beside the file is
  taken in once at launch and renamed `megamud.ini.imported`. A character
  with none is offered settings started from its old automation
  (`megamudFromConfig`) where MegaMUD has the same setting, saved only when
  the player saves.
- **The BBS set-up** MegaMUD reads from `BBS.INI` (`0x41bcf0`: the menu
  prompt, log-off and relog commands, speech and broadcast prefixes, the
  BBS's talk lines, its limits) is the realm's own `bbs:` in `server.yaml`,
  edited under the realm's settings, MegaMUD's defaults for any key it does
  not state; the runic coin's name is its `coins: runic`. No MegaMUD file is
  read for it, and it is applied again when the settings are saved.
- **Redial** is MegaMUD's for a character the engine runs, and our
  auto-reconnect (`Reconnect`) stands down for it, so the two never both
  dial. The engine redials after a drop in play (`Comms.RedialCarrier`), a
  BBS shutdown, a full game, a stuck log-on and a dial that failed
  (`Comms.RedialConnect`, `0x4b71d0`, up to `Comms.RedialMax`), each after
  its pause, through the host's dial so the log and capture turn over. The
  wait shows on the tab rail as ours does, and Disconnect calls it off.
- **Blessings** are kept up from our tracker's buff list (`MegaEngine.buffs`),
  since a realm's Messages.md names few: a buff going up stamps its slot as
  cast, one going down makes it due. The tracker settles an ending it cannot
  read with a stat sheet, and under the engine that sheet is the engine's own
  wish for one (`0xe29c`, `wantStat`), sent out of a fight at most once per
  `tuning.spells.sheetAskMs`. A spell the realm's spell table says lasts is
  given Spells.md's lasting bit (`2`) when the database lacks it, so it is
  cast as a blessing (necropotence).
- **The buttons**: the loop card's play is `@loop`'s start of a loop (or Go
  with none named), its stop is Go/Stop (`0x803`), the step back `0x869`,
  and a route asked for is the Go To dialog to its last room.
- **The toolbar's toggles** are MegaMUD's (`shared/megamud/toggles.ts`):
  All Off, Auto-Combat, -Pre-Attack, -Nuke, -Heal, -Bless, -Light, -Get,
  -Cash, -Sneak, -Hide, -Search, Prefer Melee and AFK, each pressing its
  window command (`0x462d20`, `megamud/move/buttons.ts`) with the side
  effects MegaMUD's has. They stand where the old automation's switches
  would on the Toolbar card, every one of them pinned or unpinned by the
  card's `...` as its other buttons are (`toolbar.pinned` ships those
  MegaMUD's own toolbar shows, all but Prefer Melee; the character's
  `[Toolbar]` no longer decides, 2026-10-14), and are drawn from the
  automation snapshot, pushed
  whenever they change — a press, a mode's defaults, a remote. They are the
  session's: a settings save keeps them as they stand. They are drawn as
  MegaMUD's window draws them (`0x460d50`): with All Off on, every other one
  reads off and is greyed, and so is the transport. The snapshot also says
  whether the engine is walking or looping, and the transport, the Navigation
  card and the palette's stop read that in place of the walker's and loop
  runner's progress, which stand idle while the engine walks.
- **The walk and the loop on the cards** are the engine's
  (`MegaEngine.progress`): the path walked and the step reached, the room each
  step leaves from and the leg's end as the route or loop it was made from
  said them, the loop's stops and the one being walked to, and its laps
  (`0xdb44`). They go out as the walker's and loop runner's `WalkProgress` and
  `LoopProgress` would, whenever they move on, so the Navigation and Loops
  cards, the map's route line and the Combat Stats lap all follow the engine.
  A run started by `@loop` or by MegaMUD taking the loop up again counts as a
  run; a route walked in its place ends it.
- **Its questions** (MegaMUD's message boxes: a path step to relearn, the
  key, gold or level a destination needs) are answered *no* where asked, as
  MegaMUD cannot be kept waiting here, and put to the player in a dialog; a
  *yes* is kept for that question and the player's action that asked it
  (Go To, a loop's start) is run again, where MegaMUD asks once more and is
  told yes (`SessionManager.megaAsk`).
- **Its alerts** (`0x4c0640`) are said in the console where MegaMUD would
  play the sound `[Alerts]` names for one: with sound on, a sound named, and
  with `AlertWhenAfk` only while AFK.
- **Paths**: our loops and routes are made MegaMUD paths. A room's
  signature is learned whenever the engine and our tracker stand in it
  together, else worked out from the realm data (`worldSignature`); a room
  whose exits the realm data cannot say how the game lists is given the
  relearn mark (`0x80`), which the first walk through fills in. MegaMUD heads
  for destinations only from rooms in its room list (`0x43cb90`): the rooms
  learned and every path's ends are put in it.
- **The settings screen** (2026-10-14): Settings → Character, whose rows
  after Character and Login are MegaMUD's tabs in its order (`0x49eea0`),
  each control where `MegaRes.dll`'s template puts it and bound to the
  setting the tab's procedure reads and writes
  (`src/shared/megamud/settingsTabs.ts`, generated by
  `~/tools/port/settings_tabs.py`), saved as it is changed. Health, Spells
  and Combat switch between their four profiles, with Copy From...
  (`0x49fd10`). For a character with none, a press switches it to this
  engine. What a tab fills and answers itself is drawn by
  `MegaMudEditors.tsx`: the events and ability monitors (`0x435f80`, template
  406), the statline builder (`0x4a5f00`, `0x4a6920`), the alerts (each on or off,
  as it is said rather than played), the Spells and Combat resets, and the
  Combat tab's weapon and shield pickers (`0x42afc0`), these last and the
  rooms from the running engine (`MegaEngine.choices`). Auto-roam's page
  (its directions, doors and special rooms) is not drawn, as not wanted; its
  row holds only ours. Not drawn, so that a
  setting has one place: the Toolbar tab (the toolbar's `...` pins its
  items), the BBS tab (its list and account are the realm's
  page and the Character row's login; MudOp access, `sys goto` and the
  redials are on the Character row, where our own reconnect stands down for
  the engine), and the controls of MegaMUD's own window the engine never
  reads (the data directory, the screen and its colours, the confirmations,
  the talk log, the back-scroll, the command splitter, the sound files) or that are kept elsewhere (the
  runic coin's name, the realm's; Auto-connect, the Character row's).
- **Where it is**: the engine's ways are planned from the room our tracker
  places the character in. When it cannot place it, the engine asks the
  realm (its locate command, `rm` or `sys status`, straight to the socket:
  the command queue stands down with the old automation) on entering the
  game, and whenever the engine wants a way. That walk is put aside while
  the realm answers, and taken up again once the reply places the room.
  After five seconds with no answer, or on a realm with no locate command,
  the engine is answered "no way" and does what MegaMUD does: it picks up
  its place on the path or loop, or reports itself lost. The window's own
  locate (before a route or loop it starts) goes the same way.
- **The connection**: `connected` and `connectionClosed` (`0x42c910`'s end)
  from the socket; the engine's hang-up closes it, and its redial (task 2)
  dials the realm again.

## Kept, outside the loop

These are user-started actions that hand control to the loop as a path does:
auto-hunt, the quest runner, item errands, wards and auto-keys. `Walker` and
`LoopRunner` become the route and loop planners behind `route` and
`readPath`. The login automator also stays.

They answer to the file's own `automation.enabled` rather than standing down
with the rest (`SessionManager.configure`), and to MegaMUD's All Off. Each
one's way of moving the character is the engine's for a character it runs:

- **Auto-hunt** (2026-10-14): its walk to the lair is the engine's Go To,
  walked alone (`MegaEngine.walkTo` with `alone`: a loop stopped earlier is
  let go, where the dialog's walk would take it up again at its end and never
  arrive), and its loop, filed nowhere, the engine's loop by name
  (`SessionManager.megaLoops`). The engine's walk ending is told to it as the
  walker's is (`megaWalkEnded`); the lap it measures is the engine's.
- **Wards and auto-keys** (2026-10-14): their commands go on MegaMUD's
  pending list (`MegaEngine.queue`, `0x48ab60`), which its scheduler sends
  when it may and which holds its walk (`0x409170`'s pending check). A ward
  for the room ahead is asked for before each step of the engine's path, by
  a hook of ours in `walkPath` (`SessionHost.beforeStep`): what it queues
  holds the step until it is sent. The wards switch is on the Health row.
- **What was being walked** (2026-10-14): a loop that was running, or a
  route the player started, is kept per character (`MovementBook`,
  `movement.json`) and taken up again at the next first prompt in the game
  (`MegaEngineHost.enteredGame`), unless MegaMUD's own `On entry`
  (`StartTask`, `0x47b070`) started something or All Off is on. A stop in
  the game (a Stop, an arrival, a death) lets it go; one out of it (a
  Disconnect, a hang-up, a dropped line, all of which leave the game first,
  `0x42de00`) keeps it.
- **Item errands and the quest runner** (2026-10-14): their legs are the
  engine's Go To walked alone, their loops filed nowhere the engine's, and
  what they say or list goes on the pending list, told sent when MegaMUD's
  pending pump echoes it (`0x48ad60`) and taken back off it unsent. What
  they make the character pick up or fight is lent to the engine's own
  records and given back after (`MegaEngine.alsoTake`, `alsoFight`), kept
  through a table edited meanwhile. A purchase is ours
  (`SessionManager.megaBuy`), as MegaMUD buys only on a loop's start detour
  (`0x406f20`): walked to the counter, then a `buy` at a time until the pack
  holds the row's minimum, given up when one added nothing within
  `tuning.supplies.buyTimeoutMs`; MegaMUD reads the replies (`0x453a70`). A
  quest run holds the engine's lap by its Go/Stop and takes it up again by
  name at the release (its legs let the stopped loop go), and leaves
  restocking to MegaMUD's own detour.

**The flee** (`automation.safety.fleeGoto`, 2026-10-14) is ours inside the
loop, as MegaMUD has no toggle for it: on the toolbar beside MegaMUD's own,
and in the engine (`MegaEngine.useFlee`) below its health it starts
MegaMUD's run (`startRun`, `Combat.RunRooms`) to leave the fight, then sends
`sys goto <destination>` once combat is off, once until health is back above
the line. Only on a realm that answers `sys status`.

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

## What is MegaMUD's window and not the engine

Every function the engine calls is ported (2026-10-14), but for these,
whose work is MegaMUD's own window or tooling and is done by ours: the
dialling thread and the BBS logon (`0x45a6b0`, `0x45ad00`: the host and the
realm's login script), the talk window's log of a page (`0x460bb0`: our talk
panel), the toolbar's redraw (`0x460d50`: the toggles are published each
second), the path recorder (`0x488700`) and the Import Path dialog
(`0x4451e0`: our paths are the planner's), the party window's drawing
(`0x481d40`; its decisions, `0x4816b0`, are ported as `partyRefresh`), and
the terminal's reset (`0x418280`).

## Where we answer differently from MegaMUD

- **A command's answer is read only after its echo** (2026-10-14). MegaMUD's
  prompt handler (`0x47b070`) takes any two whole lines after a command, and
  in a fight any prompt, as its answer. A room redraw already on its way
  then answered a heal before the realm had read it: walking, the next step
  went out before the room the last one led to was seen (the double step,
  seen 2026-10-13: the cast's state `0x15` done, the step sent in `0x16`,
  and the heal's own "You cast …" line setting the state to 0 on the
  uncounted branch of `0x47c280`); fighting, the attack went out early and
  then again on each `*Combat Off*` the heal caused, two or three times in a
  tenth of a second (the forgotten dragon slayer, replayed from Skinny's
  capture). Each command sent in the game is now remembered until the realm
  echoes it (`send.ts`, `echoAwaited`); lines before the echo neither count
  toward `waitLines` nor make the prompt ready. A command not echoed within
  three seconds is let go, and the count runs as MegaMUD's.

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

## Notes: the round timer (read 2026-10-12, ported in `combat/timer.ts`)

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
