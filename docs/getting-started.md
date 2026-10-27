# Getting started with Majordomo

From nothing to a character walking a loop, in about fifteen minutes. If you
played with MegaMUD, most of what you already have comes with you: your
character settings, your realm's databases and your paths.

> Majordomo is a fork of Raymond Bennett's
> [mudengine](https://github.com/rayzorben/mudengine), and every character is
> played by a port of **MegaMUD**'s own engine. Neither project made or
> endorses it. See the README's *Where Majordomo comes from*.

- [1. Install](#1-install)
- [2. Add your BBS (a realm)](#2-add-your-bbs-a-realm)
- [3. Give it the realm's data](#3-give-it-the-realms-data)
- [4. Add a character](#4-add-a-character)
- [5. Coming from MegaMUD](#5-coming-from-megamud)
- [6. Paths, loops and getting around](#6-paths-loops-and-getting-around)
- [7. Where things are kept](#7-where-things-are-kept)

---

## 1. Install

Pick one from the [latest release](https://github.com/fatavatar/majordomo/releases/latest).

| | |
|---|---|
| **Windows** | `majordomo-<version>-win-x64-setup.exe`. It is not signed yet, so SmartScreen warns you: choose **More info → Run anyway**. |
| **macOS** | `-mac-arm64.dmg` on Apple silicon, `-mac-x64.dmg` on Intel. Ctrl-click the app and choose **Open** the first time. |
| **Linux** | `.AppImage` (`chmod +x`, then run it), or `.deb`. |
| **Docker** | Runs as a server and you play in a browser. See below. |

```bash
docker run -d --name majordomo --restart unless-stopped -p 8080:8080 -v majordomo:/config ghcr.io/fatavatar/majordomo:latest
```

Open `http://localhost:8080/` and sign in with the password the first start
printed (`docker logs majordomo`). It is also saved in `/config/.access-password`.
The connection is not encrypted, so read the README's *Running it in a
container* before you open the port beyond your own machine.

> [!IMPORTANT]
> ### Config location: everything lives in one folder
> Realms, characters, settings, imported data, the realm database and logs
> all go in the client's home:
>
> - **Windows:** `%APPDATA%\mudengine`
> - **macOS:** `~/Library/Application Support/mudengine`
> - **Linux:** `~/.config/mudengine`
> - **Docker:** `/config`, which is the `-v majordomo:/config` volume. **Keep
>   that `-v`.** Without it, everything is deleted with the container.
>
> Back this folder up, and copy it to move to another machine. See
> [step 7](#7-where-things-are-kept) for what is inside.

The first time it starts with no characters, the settings screen opens.
**Ctrl/⌘ ,** reopens it at any time. Its sections are **Majordomo** (the
client itself), **Global** (settings every character inherits), **Realms**
and **Characters**.

## 2. Add your BBS (a realm)

A *realm* is one game on one BBS: its address, the menus on the way in, and
what the realm calls things. Every character on that realm shares these
settings, so you set them up once.

Majordomo comes with Paradigm's six realms already set up. For anything else, go to
**Realms → + New realm**.

| Field | What to put |
|---|---|
| **Name** | Whatever you call it, e.g. *Skinny Inc*. |
| **Host / Port** | The BBS's telnet address, e.g. `bbs.example.org` and `23` (or the BBS's own port, e.g. `2424`). |
| **Encoding** | Leave it **CP437**. MajorMUD's banners are built from CP437 block characters. |
| **Login menus** | Pairs of *"when the BBS prints this, send that"* (see below). |
| **Locate command** | **sys status** for MajorMUD, or **rm** for GreaterMUD and Paradigm. This is how the client knows exactly which room it is in instead of guessing. |
| **World database** | See [step 3](#3-give-it-the-realms-data). |
| **Coin names** | Only for a realm that renames its coins (one calls runic coins *Krabby Patties*). |
| **MegaMUD BBS set-up** | What MegaMUD's `BBS.INI` held: the game menu prompt, the relog command, the broadcast formats and so on. Leave a field blank to use MegaMUD's own default. |

> [!IMPORTANT]
> ### BBS setup: address, login menus and Locate command
> Get these three right before anything else:
>
> - **Host and port:** the BBS's telnet address.
> - **Login menus:** a row for every prompt on the way in, with `{user}` and
>   `{password}` where the account goes. A missing row leaves the login stuck
>   at that prompt.
> - **Locate command:** **sys status** on MajorMUD, **rm** on GreaterMUD and
>   Paradigm. Without it the client guesses which room a character is in, and
>   walking, loops and Muster start from that guess.

### Login menus

Each row is *when the BBS prints this → send this*. The match is case-blind and
finds the text anywhere in a line. Rows are answered in whatever order the
menus arrive. A blank answer sends a bare Enter. Write `{user}` and
`{password}` where the character's own login goes; you set those on the
character page in step 4, so they are never stored with the realm.

A typical WorldGroup BBS with MajorMUD behind it looks like this. Its file,
`servers/<id>/server.yaml`, is what the Realms page writes:

```yaml
name: Skinny Inc
host: bbs.example.org
port: 2424
encoding: cp437
login:
  - when: 'Otherwise type "new":'     # the BBS's sign-in prompt
    send: "{user}"
  - when: "Enter your password:"
    send: "{password}"
  - when: "Make your selection (A,R,M"  # the BBS main menu: M for MajorMUD
    send: m
  - when: "[MAJORMUD]"                  # the game's own menu: E to enter
    send: e
  - when: "(N)onstop, (Q)uit, or (C)ontinue?"
    send: n
    repeat: true                        # a pager asks every screenful
locate: sys-status
database: /path/to/your-realm.mdb       # optional, see step 3
coins:
  runic: Krabby Patties                 # only if the realm renames a coin
```

The quickest way to get the rows right is to log in once by hand and copy each
prompt as the BBS prints it. If an automated login is unsure, it stops rather
than guessing:

- a rejected password is never retried;
- a menu that comes back a second time stops the login;
- a prompt with no row is left for you to answer.

## 3. Give it the realm's data

The client knows the world (rooms, exits, monsters, items, shops and spells)
from a **realm database**.

- **Stock MajorMUD or Paradigm:** leave **World database** blank. Both worlds
  ship with the client, and it picks the right one from what the realm calls
  itself at its menu. You can also type `majormud` or `paradigm` to pin one.
- **A customised realm** (MudRev, or any realm whose rooms differ): click
  **Browse…** and choose the realm's `.mdb`. This is the same Access database
  that MMUD Explorer reads, usually from the sysop or the realm's website. A
  SQLite copy or a `.zip` of either works too. The client converts it once and
  keeps the result under `realms/`.
  - **In Docker**, copy the file into the `/config` volume first. The Browse
    button sees only the container's own `/config`, so the path must start
    with `/config/`, e.g. `/config/mudrev.mdb`.

> [!IMPORTANT]
> ### MDB import: a customised realm needs its own `.mdb`
> Left blank, the client uses the stock world. On a realm like MudRev the
> rooms, exits, monsters and shops are different, so the map, routes, loops
> and locked doors would all be wrong.

> [!WARNING]
> ### In Docker the path must start with `/config/`
> A path from your own computer (`C:\…` or `/home/…`) does not exist inside
> the container, and the client quietly falls back to the stock world.

With a realm database in place you get the Map card's areas, routes to any
room, where to buy things, which doors are locked and what opens them, and
the Reference card's details on items and monsters.

The realm's **Messages**, **Monsters** and **Items** pages hold MegaMUD's own
tables for that realm. If you have MegaMUD's data folder for the realm, use
**Import Messages.md…**, **Import Monsters.md…** and **Import Items.md…** on
those pages. Importing replaces the whole table. Each character can still
override single rows on its own page.

> [!IMPORTANT]
> ### Import data: `Messages.md`, `Monsters.md` and `Items.md`
> The MegaMUD engine plays by these tables: which monsters to fight and which
> to leave alone, what to pick up, keep or sell, and what the realm's
> sentences mean. Without them it plays on bare defaults.

## 4. Add a character

Go to **Characters → + New character**.

| Field | What to put |
|---|---|
| **Name** | The character's name as the game knows it. |
| **File name** | A short id (`thorn`): it names the character's file, log and tab. |
| **Realm** | The realm from step 2. |
| **Username / Password** | The BBS account. They are kept only in this character's own file and never shown again. |
| **Connect on start** | On, if this character should dial in whenever the client starts. |
| **Copy from** | Optionally start from another character's settings (everything except the name and password). |

Save, then connect from the character's tab. The terminal is in the middle,
and the cards around it (Vitals, Room, Map, Combat, Inventory and Talk, among
others) fill in as you play.

## 5. Coming from MegaMUD

The engine that plays your character **is MegaMUD's**, ported function by
function from `megamud.exe`. The settings are MegaMUD's too, under MegaMUD's
names, so a character set up the way you had it in MegaMUD behaves the way it
did there.

| You had in MegaMUD | Bring it in with |
|---|---|
| A character's `.ini` | When adding the character: **Start from a MegaMUD character file (.ini)…** reads its name, login and every setting. For an existing character, **Replace MegaMUD settings from a character file (.ini)…** keeps the login and password, and **Undo** puts the old settings back. |
| `BBS.INI` | The realm's **MegaMUD BBS set-up** fields ([step 2](#2-add-your-bbs-a-realm)). |
| `Messages.md`, `Monsters.md`, `Items.md` | The realm's import buttons ([step 3](#3-give-it-the-realms-data)). |
| Paths and loops (`.mp`) | The realm's **Loops** page: **Import MegaMUD loops…**, then choose MegaMUD's data folder, the one with `Rooms.md` and the `.mp` files. Each loop is matched to the realm's map, and any that don't fit are listed with the reason. |

> [!IMPORTANT]
> ### Import data: start each character from its MegaMUD `.ini`
> That file holds every combat, healing, spell, party and cash setting. A
> character made without it plays on MegaMUD's defaults, not the way you set
> it up. Use **Start from a MegaMUD character file (.ini)…** when you add it.

> [!IMPORTANT]
> ### Import data: your `.mp` loops, from the same MegaMUD data folder
> They arrive matched to the realm's map, ready to start from the Loops
> search. Without them, each loop has to be built again in the loop builder.

What is the same:

- **Combat, resting, healing, blessings and party work as they did.** The
  character's MegaMUD pages hold the Combat (P1 to P4), Health, Spells, Party
  and Cash settings, laid out as MegaMUD had them.
- **The `@` remote commands** answer as MegaMUD did, for the people you allow
  on the character's Remotes page.
- **Auto-combat** keeps whatever you set it to while the character walks a
  route. The defaults for idle and active play apply only when you start or
  stop your own automation, as in MegaMUD.

What is new:

- **It explains itself.** When the engine fights, refuses to fight, rests or
  stops, it says why, in the character's log and on the cards.
- **It knows the whole map.** You can walk to any room by clicking it (see
  below), not only along a path you recorded.
- **Several characters at once**, each in its own tab, up to four side by side.
  A character you aren't watching lights up its tab when it gets into
  trouble.
- **One place for settings.** A realm's settings are shared by every character
  on it. A character's settings are a thin layer over Global, so it inherits
  anything it doesn't set itself.

## 6. Paths, loops and getting around

### Walk anywhere: the Map card

The Map card draws the whole **area** you are in, one level at a time, laid
out the way mudmaps lays it out.

- **Follow** keeps the map on your character. Search for a room by name or
  number, change level with **▲/▼**, or click an arrow at an area's edge to
  look somewhere else. Doing any of those turns Follow off, and turning it
  back on brings you home.
- **Click any room** to open its panel, then **Walk here** or **Run here**.
  The client plans the way, opens the route panel to show it, and walks it
  one step at a time, checking each step arrived where it should.
- Doors and switches are part of the plan. A locked door is opened with your
  key, a picklock, a knock spell or a bash, in that order, depending on what
  the character can do. A door opened by a lever or button in another room
  names that switch and its room on the map, and the route goes there first
  and presses it.

### Loops: walk a circuit to hunt

A **loop** is a list of rooms walked over and over, which is MegaMUD's path
loop. You can get loops three ways:

- **Import** your MegaMUD `.mp` loops (step 5).
- **Use the loop builder.** It has the same whole-area map with ▲/▼. Click a
  room to start, then click the next room and the builder plans the way
  there. Click the first room again to close the loop.
- **Import a loop file** someone shared with you. To share one of yours, use
  **Export**, which writes a loop file for another Majordomo player or a
  MegaMUD `.mp` path planned for this character.

Where a loop is kept decides who can walk it:

- **Global → Loops**: every character;
- the realm's **Loops** page: every character on that realm;
- the character's own **Loops** page: that character only.

Start a loop from the **Loops** search (*find one to walk*). The Loop card
shows the laps, the stops and the experience rate as it goes.

### Errands and quests

The Gear and Reference cards and the Quest card can send the character on its
way to buy an item, fetch a key or carry out a quest step. These use the same
walking, the same doors and the same auto-combat as everything else.

## 7. Where things are kept

Everything is in one folder:

- `~/.config/mudengine` on Linux;
- `%APPDATA%\mudengine` on Windows;
- `~/Library/Application Support/mudengine` on macOS;
- `/config` in Docker.

The folder still has the old mudengine name so that existing players keep
their data.

| | |
|---|---|
| `servers/<id>/server.yaml` | a realm (step 2), with its `messages`, `monsters` and `items` tables beside it |
| `profiles/<id>/profile.yaml` | a character, with its MegaMUD settings under `megamud:` |
| `global/default.yaml` | the settings every character inherits |
| `*/loops/*.yaml` | loops, by who may walk them |
| `logs/` | each session's log, for when you want to know what happened |

These files are plain YAML, and you can edit them by hand while the client is
running: it notices the change, keeps your comments, and if an edit is
broken it keeps the last good values and tells you why.

More detail is in [`docs/codebase/files-and-settings.md`](codebase/files-and-settings.md).
