# References the code makes to notes not in this repository

The code cites about 200 times documents that upstream keeps out of the
repository on purpose (the `.gitignore`: "Prose is kept locally"), and a few
Claude Code skills of upstream's (`mudengine-ui`, `mudengine-wire`, …). They
are upstream's working notes and are not in this checkout. The comments that
cite them usually quote the part that matters; this page says what each one
was cited for and where this fork's own account of it is.

## Documents

| Cited as | Cited for | Here instead |
|---|---|---|
| `docs/profiles.md` (31) | Multiple characters: §2–3 what a profile is (a sparse overlay that must name a server), §4 sessions belong to the app and not to a window, §5 every message addressed to a session, §7 popping a tab out and the backscroll replaying on attach, §9 the command window per connection. | [architecture.md](architecture.md) (*Sessions belong to the app*), [files-and-settings.md](files-and-settings.md) (*A character's settings*); the rules are restated in `SessionHost.ts`, `WindowRegistry.ts`, `shared/profiles.ts` and `shared/ipc.ts` |
| `docs/ui-design.md` (34) | The window's rules: §3.6 which surfaces take the caret and give it back, §3.7–3.8 how cards and chips present a fact, colour meaning trouble only when it is. | [renderer.md](renderer.md); the citing component states the rule it applies |
| `docs/legacy-assessment.md` (22) | The review of the two earlier clients this one replaced: §5 grammar first, colour second (the classifier); §5 consequence 4 normalise once, never query the realm database while playing; §6 inbound is a broadcast and outbound is one owner. | [pipeline.md](pipeline.md); the classifier's header (`parse/Classifier.ts`) and `RealmLibrary.ts` restate theirs. The single-owner rule no longer holds since the MegaMUD engine; see *A command goes out* |
| `docs/greatermud/combat.md` (21), `commands.md` (12), `rooms-and-items.md`, `player-and-world.md`, `messages.md`, `movement.md`, `communication.md` | What the GreaterMUD server's own source does: combat rounds and the five-second tick, the unclean-disconnect penalty, the command table and its abbreviations, room and item fields, the message frames, movement refusals, telepaths and broadcasts. | Nothing in this repository; the citing comments quote the server behaviour they rely on, usually with the server file and line (`Player.cs:5919`) |
| `docs/game-behaviour.md` (14) | Behaviour measured on the live realms (for example that an unknown command is spoken aloud in the room). | The citing comments, each with its measurement |
| `docs/terminology.md` (13) | Definitions: realm, server, BBS, character slot. | [README.md](README.md) (*Words used throughout*) |
| `docs/capture-analysis.md` (13) | What the capture corpus taught the parser. | The parser's comments, which quote each line verbatim; captures themselves are not committed |
| `docs/reference-codebases.md` (3) | The two earlier clients (`megamind-client`, the CoffeeScript `mudengine`) and what was ported from each: §2.4 line framing on the repaint marker. | [pipeline.md](pipeline.md) (*Framing*), `net/LineTokenizer.ts` |
| `docs/exp-per-hour-models.md` (3), `docs/mudplay/*` (5) | MMUD Explorer's experience-per-hour model and upstream's essays on the realm's formulas and *can I fight this*. | `shared/hunting.ts`, `shared/verdict.ts` |
| `docs/mega-paramud.md` (2) | Reading MegaMUD's recorded paths into loops (`npm run build:loops`). | [world.md](world.md), `world/megamudLoops.ts` |
| `docs/roadmap.md`, `docs/CLAUDE.md` | Upstream's plans and its notes for Claude Code. | None |

## Skills

`mudengine-ui`, `mudengine-automation`, `mudengine-wire`, `mudengine-world`,
`mudengine-settings`, `mudengine-config`, `mudengine-session` and
`mudengine-verify` are upstream's Claude Code skills, cited as
`` `mudengine-wire` § Line framing `` and the like. Their subjects map onto
this guide: wire to [pipeline.md](pipeline.md), automation to
[planners.md](planners.md) and [engine.md](engine.md), world to
[world.md](world.md), settings and config to
[files-and-settings.md](files-and-settings.md), ui to
[renderer.md](renderer.md), verify to [development.md](development.md).

## For new code

Cite this guide or `docs/megamud/`, which are tracked, and state the rule in
the comment itself. Upstream's citations are left as they are: they are
upstream's text, and rewriting two hundred of them would make every port of
an upstream change harder.
