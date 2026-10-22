# The mudengine codebase

A guide to how the client is put together, for someone about to change it.
It describes the `megamud-engine` branch as of 2026-10-22, where every
character is played by the port of MegaMUD's engine.

The code's own comments are long and specific. Read this guide for the map,
and the comments for the detail of any one module.

## Reading order

1. [Architecture](architecture.md): the processes, the two hosts (desktop
   and browser) and what lives in each source directory.
2. [The session pipeline](pipeline.md): a line from the MUD, from the socket
   to the screen and to the engine, and a command back the other way.
3. [The MegaMUD engine](engine.md): how the port of `megamud.exe` is run for
   a connection and what our side lends it. The port itself is described in
   [`docs/megamud/engine-port.md`](../megamud/engine-port.md) and the
   readings behind it in [`docs/megamud/megamud-exe.md`](../megamud/megamud-exe.md).
4. [Planners beside the engine](planners.md): hunting, quests, item errands,
   wards, keys and the login, which hand their work to the engine.
5. [The world](world.md): realm databases, the converted world, routing and
   working out where the character is.
6. [Files and settings](files-and-settings.md): the home directory, the
   stores that own each file, how a character's settings are layered, and
   the records written while playing.
7. [The renderer](renderer.md): the window, its cards, the IPC contract and
   MMUD Explorer.
8. [Development](development.md): building, testing, replaying a capture,
   the scripts, and how to make the common kinds of change.
9. [Oddities](oddities.md): things in the codebase that looked wrong or
   leftover when this guide was written, and what was done about each.
10. [References](references.md): the upstream notes the code cites that are
    not in this repository, what each was cited for, and where to look
    instead.

## In one paragraph

mudengine is an Electron and TypeScript client for MajorMUD and the games
descended from it. The main process (Node) owns every connection: it reads
the telnet stream, frames it into lines, paints the terminal, parses each
line into a typed block that updates the character's state, and hands the
same raw text to a function-by-function port of MegaMUD's engine, which
decides what to do and writes commands back. Our world graph (built from the
realm's Access database) plans every route the engine walks. The renderer
(React) is a view: a terminal and a set of cards fed by pushes over a typed
IPC contract, which the same client can also serve to a browser tab over a
WebSocket.

## Words used throughout

| Term | Meaning |
|---|---|
| Realm | A MajorMUD-family game server, and its data (rooms, items, monsters, spells). |
| Server | One BBS address we dial; a realm is reached through one. |
| Profile | One character: its server, account and settings (`profiles/<id>/profile.yaml`). |
| Session | One live connection for one profile (`SessionManager`). |
| Block | One classified line or listing (`shared/blocks.ts`), the parser's unit of output. |
| Tracker | `CharacterTracker`, which folds blocks into `CharacterState`. |
| The engine, the port | The port of `megamud.exe` in `src/main/megamud/`, run per session by `MegaEngine`. |
| World, world graph | The converted realm: rooms, exits and everything routing needs (`WorldGraph`). |
| Home | The directory the client keeps its files in (`app/home.ts`). |
| Card | One panel of the main window (Vitals, Map, Party, …). |
| Capture | A `.mudcap.jsonl` recording of a session, for replay and analysis. |
