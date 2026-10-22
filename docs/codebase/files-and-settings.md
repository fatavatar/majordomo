# Files and settings

## The home directory

Everything the client keeps is under one root (`src/main/app/home.ts`):
`~/.config/mudengine` on Linux, `%APPDATA%\mudengine` on Windows,
`~/Library/Application Support/mudengine` on macOS. `MUDENGINE_HOME`
overrides it; the Docker image uses `/config`. Every path is a function of
the root, so a test names a temporary directory and gets the whole tree. One
client per home: `.lock` (`app/homeLock.ts`).

```
<root>/
  global/default.yaml          the options every character inherits
  global/loops/*.yaml          loops any character may walk
  servers/<id>/server.yaml     one BBS or realm: address, login menus, bbs:, coins:
  servers/<id>/messages.yaml   the realm's message table (what its sentences mean)
  servers/<id>/monsters.yaml   what to do about particular monsters
  servers/<id>/items.yaml      what to do about particular items
  servers/<id>/loops/*.yaml    loops for every character on that server
  profiles/<id>/profile.yaml   one character: server, account, settings, megamud:
  profiles/<id>/loops/*.yaml   loops only that character walks
  internal.yaml                the client's settings about itself, and tuning:
  memory/                      exits and finds learned, per character and realm
  fights/                      every fight, per character (gzip members)
  talk/<id>.jsonl              the Talk card's history
  belongings/<id>.json         banks and what the character wore
  backscroll/<id>.log          the terminal's retained output
  logs/                        session logs and captures (.mudcap.jsonl)
  realms/                      converted realm databases, by identity
  mob-lore.json  players.json  destinations.json  movement.json
  megamud-learned.json  worlds.json  workspace.json
```

## Who owns each file

Each file has one store in `src/main/config/` (or `world/`, `session/`), and
nothing else writes it.

| Store | Owns |
|---|---|
| `ConfigStore` | `global/default.yaml`, created from `resources/config/default.yaml` on first run |
| `ProfileStore` | `profiles/*/profile.yaml` |
| `ServerStore` | `servers/*/server.yaml` |
| `RealmTableStore` | the realm tables beside each server (`messages`, `monsters`, `items`) |
| `LoopStore` | the three `loops/` directories, by scope |
| `InternalStore` | `internal.yaml`, from `resources/config/internal.yaml` |
| `LoopCatalogue` | the shipped loops in `resources/loops/megamud.yaml` (read-only) |

Shared rules, written once:

- **Polled, not watched.** `Poller.ts` stats each file on an interval:
  `fs.watch` loses a file the moment an editor saves by renaming over it
  (vim, JetBrains, Dropbox). A file edited by hand reaches characters
  already playing.
- **A bad edit keeps the last good values** and reports the error; a store
  never throws at its callers.
- **The user's files are theirs.** `YamlFile.ts` edits YAML through its
  document nodes, so comments and layout survive a save from the Settings
  screen. Never reformat these files with a formatter.
- **New template blocks appear.** `reconcile.ts` copies into the options
  file any top-level block the template states and the file does not, with
  its comments, so a setting added after the file was copied is not
  invisible.

## A character's settings

A character's effective configuration is built in layers:

1. **The options file**, `global/default.yaml`, parsed but not yet coerced.
2. **The profile** overlays it (`shared/profiles.ts`, `resolveProfile`). A
   profile is a **sparse overlay**, never a full copy, so a character
   inherits every setting it does not mention, including ones added later.
   The sum is coerced once by `normalizeConfig` (`shared/config.ts`), which is
   not idempotent, so it must never run twice over the same values.
3. **The server's realm tables** are laid under the character's own rows
   (`withRealmMonsters`, `mergeItemRules`): the realm says what a monster is,
   the character says what it does about it.

The profile also carries a **`megamud:` block**, MegaMUD's own settings in
its INI sections (`MegaMud`, `Combat`, `Combat.P1`…`P4`, `Health`,
`Spells`, `Party`, `Cash`, …). These are what the engine plays by. The schema
is `shared/megamud/schema.ts`; reading and writing, profiles P1 to P4 and
their Enabled flags are `shared/megamud/settings.ts`. A character that had a
`megamud.ini` had it taken into `megamud:` once by a migration and the file
renamed `megamud.ini.imported`.

What is left of `automation:` is what our side still reads: the planners'
settings (`movement`, `hunting`, `quests`, `remotes`), the escape's
`safety.fleeGoto`, the character's monster and item rows, the pacing of the
command queue and a few others. The old engine's own settings were deleted
from the schema on 2026-10-22, and a migration
(`theOldAutomationFieldsWent`) drops them from files that still state them.

**`internal.yaml`** holds the client's settings about itself, including the
`tuning:` block: every number the client uses to decide something (timeouts,
retries, caps). Main reads it through `tuning()` (`app/tuning.ts`), set once
at start-up and again whenever the file changes; the renderer has its own
copy (`renderer/src/lib/tuning.ts`).

**The Settings screen** edits all of this through `config/SettingsEditor.ts`,
which loads a draft from the files, and saves only what the draft says that
the defaults do not.

## Migrations

`config/Migration.ts` (`migrateHome`, run at start-up) brings older layouts
and settings across, once each. Every step is idempotent (it checks before it
writes and does nothing the second time), never overwrites, keeps comments,
never says what is inside a file (they hold passwords), and reports what it
did. A new setting that changes meaning gets a step here, with a notice in
`locales/ui.en.yaml` under its own key.

## Records written while playing

| Record | Where | Written by |
|---|---|---|
| Session log | `logs/*.log` | `SessionLog`: the decoded session, for a person |
| Capture | `logs/*.mudcap.jsonl` | `SessionCapture`: bytes, lines, commands, the player's actions, the engine's log |
| Log budget | | `logBudget.ts`: a file past `logging.maxBytes` goes on in a new part; the directory is kept under `logging.keepBytes` by deleting the oldest closed files |
| Backscroll | `backscroll/<id>.log` | `Backscroll` |
| Fights | `fights/` | `FightLog`, appended, gzip members |
| Talk | `talk/<id>.jsonl` | `TalkLog` |
| Belongings | `belongings/<id>.json` | `Belongings`: banks, worn kit, the spellbook |
| Movement | `movement.json` | `MovementBook`: the loop or route a character was walking when its session went away, taken up again in the game |

Captures hold everything the server sent, and on a manual login a password.
They are git-ignored by name anywhere, and `npm run check:secrets` exists to
catch one before it is packaged or committed.
