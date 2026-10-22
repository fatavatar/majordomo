# Oddities

Things found while writing this guide (2026-10-22) that looked wrong, stale
or leftover, and what was done about each. Most came from one event: on
2026-10-14 the old decision engine was swapped for the port of
`megamud.exe`, and its modules were deleted, but much of what surrounded them
was not.

Items 1 to 7, 9 and 10 were fixed on 2026-10-22. Item 8 was fixed in part.
Item 11 is open.

## 1. Two settings trees per character, one mostly dead (fixed)

**Was.** Every `profile.yaml` had an `automation:` block (the old engine's
settings) beside the `megamud:` block the engine plays by, both with heal
thresholds, rest levels and combat spells. Sixty-three of the
`automation:` fields had no reader outside the settings plumbing (`idle`,
`gear`, `retreat.strategy`, `combat.engage`, `spells.drain`,
`party.autoRank`, `loot.minPrice`, …). The Settings screen carried them in
its form state and saved them back, with no control for any of them.

**Done.** Each field was checked for a reader with the TypeScript language
service, and the dead ones were deleted from `shared/config.ts`, the
template, `SettingsEditor`, the Settings screen's form, `drafts.ts` and the
IPC types. A migration, `theOldAutomationFieldsWent`, drops them from files
that state them, with a notice. Every `tuning:` key was checked the same way
and all are live.

## 2. Migrations for settings that no longer exist (fixed)

**Was.** Eleven migration steps only wrote values into the dead settings
(`statedTheTrapRest`, `statedTheGearRecovery`, `statedTheDrain`,
`statedThePartyRank`, …). Others carried dead keys among live ones.

**Done.** The eleven were deleted with their constants, notices and tests.
The steps that wrote live and dead keys together now write only the live
ones. The layout moves and the `megamud.ini` import are kept.

## 3. "The single writer" has three writers (fixed)

**Was.** `CommandQueue`'s header called it the single writer for everything
the client sends, and `configure` set its `enabled` to false so it refused
everything not marked `user`. Its keep-alive exemption (`keepsLink`) was set
by nothing.

**Done.** The queue is what it now is: the path of the player's own presses
(the login, macros and the toolbar), with prompt credit. Its header says so
and names the other writers. `enabled`, `keepsLink`, `noGap` and
`skipNextGap` were removed, and its config is just `pacing`.
[pipeline.md](pipeline.md) has the table of writers.

## 4. Dead stand-down in `SessionManager.configure` (fixed)

Removed with item 3. The `this.mega === null` guards stay.

## 5. Comments and docs naming code that is gone (fixed)

**Was.** `Walker`, `LoopRunner`, `Supplies`, `Blessings`, `AutoCombat`,
`Routines` and the rest were named a few hundred times as if they were
still there. `docs/megamud/engine-port.md` described the swap as still to
come. Several comments spoke of "a character with a `megamud.ini`".

**Done.** About 210 comments were rewritten to name the code that does the
job now (`SessionHost.clearWay`, `RouteStep.pull`, `MegaEngine.depositAll`,
…) or to say "the old …" where history is the point. The `megamud.ini`
comments and the four stale sections of `engine-port.md` were rewritten. Dead
code found on the way went too: `CharacterTracker`'s status-line request
(`takeStatlineRequest`), `SessionManager`'s `fight()`, `opening()` and
`fightWith()`, and `pvpSaid`.

## 6. Citations of documents nobody here has (fixed)

**Was.** The code cites upstream's local notes (`docs/profiles.md`,
`docs/ui-design.md`, …) and skills (`mudengine-wire`, …) about 200 times.
None are in this checkout.

**Done.** [references.md](references.md) says what each was cited for and
where this fork's own account is. The citations are left alone: they are
upstream's text, and rewriting them would make porting upstream changes
harder.

## 7. Probes that cannot run (fixed)

**Was.** The probes dialled `orohost:2427` only, and some tested the
automation the engine replaced.

**Done.** The realm is `MUDENGINE_PROBE_HOST` and `MUDENGINE_PROBE_PORT`,
with upstream's as the default. `combat-probe`, `play-probe`,
`remotes-probe`, `soak` and `soak-report` (which tested deleted modules)
were removed. The rest no longer set the old automation's switches, and
all of them pass `prettier --check`.

## 8. Very large files (fixed in part)

| File | Lines | What makes it large |
|---|---|---|
| `world/WorldGraph.ts` | 9,700 | the graph, A*, and every question about the realm |
| `parse/CharacterTracker.ts` | 7,300 | the reducer's 70-odd block cases, after five clusters were split out |
| `config/Migration.ts` | 7,000 | about 90 migration steps |
| `renderer/src/App.tsx` | 6,400 | the whole shell, with about 230 hooks in one component |
| `session/SessionManager.ts` | 6,100 | the connection, the line pipeline, the engine bridge, buying and learning, quests, routes |
| `client.ts` | 4,200 | every IPC handler |
| `renderer/src/styles/index.css` | 14,900 | every component's styles in one sheet |

The hunting survey and the fight verdicts (about 1,000 lines with their own
state) moved out of `SessionManager` into `session/Appraisal.ts`, unchanged.
The purchase planner (`megaBuy`, `fundsFor`, `purchaseFor`,
`learnPlanFor`) was left: it is driven by the engine bridge's own ticks
(`megaBuyTick`, `megaCashTick`) and state, so it would move only with the
bridge.

## 9. The IPC contract written out twice by hand (fixed)

**Was.** `preload/index.ts` and `webBridge.ts` each listed all 155 channels
by hand.

**Done.** `bridgeOver` in `shared/ipc.ts` builds the whole `IpcApi` from the
channel tables over a carrier, and both bridges are a few lines each. A
compile-time check (`METHODS_MATCH_CHANNELS`) holds every method's name to
its channel's key. A new call is now the contract and its handler.

## 10. Doc comments on the wrong declaration (fixed)

**Was.** About 180 places where one doc comment sat directly on another, so
the first described something else. Most came from a method being inserted
between an existing doc and the code it described. Others had lost their
code entirely, or were a file's own description stranded below its imports.

**Done.** Each was traced through git to the declaration it was written for.
They were moved back to it, or merged where two docs described one thing.
Docs whose code is gone were deleted, and file descriptions were made file
headers. The ones left are a file's header directly above its first
declaration's doc, which is right.

## 11. Unanswered steps are only probed when a line arrives (open)

`SessionManager.settleClaims` sends `rm` after a step nothing answered, and
later writes the step off. It runs on every line. It also used to run on the
old automation's tick, so a probe went out during a silence; that tick went
with the old automation. The MegaMUD engine has its own handling of
silence (`quietTick`), so putting a timer back could send our probe beside
the engine's. Whether it should be put back is a question of play, not of
tidying.

## Worth knowing, not wrong

- **The stream is read twice**: by our classifier and tracker, and by the
  port's own reader. This is by design (the port reads lines as MegaMUD
  does), but the two can disagree, and where they must agree the engine is
  told what our tracker read (`located`, `buffs`, `afflictions`). A bug in
  what the engine believes may be in either reading.
- **Card layouts are per browser** (`localStorage`), so in web mode each
  device has its own arrangement. This is deliberate in `useCardLayout.ts`.
