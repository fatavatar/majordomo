# Planners beside the engine

The MegaMUD engine makes every moment-to-moment decision: fighting, resting,
healing, blessing, picking up, walking a path. A few things it has no notion
of are ours. They are started by the player (or by a setting), plan with our
world graph and the realm's data, and hand the moving to the engine. They live
in `src/main/automation/` and are built per session by `SessionManager`.

| Module | What it does | How it moves the character |
|---|---|---|
| `AutoHunt` | Picks the best lair the Hunting card's survey knows, walks there and runs a loop sized to the realm's respawn clock; measures what the lair pays and moves on when another would pay better. | the engine's Go To (`megaGoTo`, walked alone), then a loop handed to the engine by name (`megaLoops`) |
| `QuestRunner` | Carries a quest's plan (`shared/quests.ts`) step by step: fetches each item the way its source says, walks to where the act happens, sends it, and reads the outcome off the realm. | legs by the engine's Go To; what it says goes on the engine's pending list; purchases by `megaBuy` |
| `ItemErrand` | Goes and gets an item a route needs (a key, a ward's item) or one the player asked to buy in MMUD Explorer: bought at a counter, or hunted from the monsters that drop it; then walks the route that wanted it. Checks the purse and fetches money from the bank first. | the engine's Go To and loops; `megaBuy` walks to the counter and buys one at a time until the pack holds enough |
| `Wards` | Before a step into a room whose spell a carried item's spell stops (the desert's waterskins), sends `use <item>`, and again when it lapses. | the engine's pending list, ahead of the step (`beforeStep`) |
| `AutoKeys` | Picks up the key for the door in front of the character when it is lying on the floor. | the engine's pending list |
| `PackAfter` | Reads the pack after a script was asked to give or take something, since the realm's sentence does not name the item. Shared by quests and errands. | asks for a listing |
| `LoginAutomator` | Answers the BBS menus and the login prompts from the server's login script and the profile's account. Never retries a rejected password. | the command queue |
| `CommandQueue` | What the player's own presses go through, the login and macros: flow control by prompt credit, coalescing and cancelling of queued intents, refusing words the realm does not have. | the socket |

The figures the Hunting card and auto-hunt read (which lair to hunt, what a
monster costs and the room's simulated fight) are worked out by
`session/Appraisal.ts`, lent the character, the world and the settings by
`SessionManager`.

## Rules they keep

- **They yield.** Each stands aside for a fight, a move in flight, an escape
  or a walk already running, and holds a running loop rather than ending it.
- **Every refusal is said.** A refusal is a `SafetyDecision`
  (`shared/automation.ts`) with an action (`hunt`, `quest`, `collect`, …),
  shown on the console and recorded, so a player can always see why the
  client did not do something.
- **They answer to `automation.enabled` and to MegaMUD's All Off.**

## What the engine is lent while they run

An errand that needs the character to pick something up or fight something
it would not otherwise lends that to the engine's own records and takes it
back after (`MegaEngine.alsoTake`, `alsoFight`). A loop or walk the planner
refuses for a key or item the pack lacks is handed to the item errand through
`MegaEngineHost.fetchFirst`, and the walk is started again once it is fetched.

## The flee

`automation.safety.fleeGoto` is ours: below its health line the engine runs
from the fight with MegaMUD's own run, then sends `sys goto <destination>`
once combat is off (`MegaEngine.useFlee`). It works only on a realm that
answers `sys status`. MegaMUD's own MUD-op escape (`script/escape.ts`) is the
engine's, at the hang-up level.

## What the player starts

Cards and screens start these through IPC calls handled in `client.ts`, which
calls the session: `walkRoute` and `startLoop` (the route panel and loops),
`questRun`, `buyNow` (MMUD Explorer's Buy), `collectThenWalk`. Each answers
with why it would not start, and that is shown where it was asked.
