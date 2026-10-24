# The world

Everything the client knows about a realm's geography and contents comes from
the realm's own database, converted once into a form built for routing.
`src/main/world/` holds it.

## From a database to a world

```mermaid
flowchart LR
  mdb[".mdb / .zip<br/>(Access database)"] --> src["RealmSource<br/>mdb-reader, zip.ts"]
  src --> build["buildRealm<br/>REALM_FORMAT"]
  build --> cache["realms/&lt;identity&gt;.jsonl.gz<br/>(RealmLibrary cache)"]
  shipped["resources/world/<br/>majormud, paradigm .jsonl.gz"] --> graph
  cache --> graph["WorldGraph<br/>rooms, exits, A*"]
```

- **Reading.** `RealmSource.ts` opens an Access `.mdb`, or a `.zip` holding
  one (`zip.ts` reads it with nothing installed), through `mdb-reader`.
  `values.ts` reads a cell without inventing a value.
- **Converting.** `buildRealm.ts` turns the tables into the world's records:
  rooms, exits and what stands in them (doors, keys, levers, tolls, traps,
  gates, text commands), shops and their stock, monsters and lairs, items,
  spells, classes and races, quests (`indexQuests.ts`, out of the NPC text
  blocks, read by `questScript.ts`), room commands (`roomScript.ts`) and room
  spells (`spellHazard.ts`). The output format is numbered by `REALM_FORMAT`
  (53 at the time of writing); raise it when the output changes, so every
  cache is converted again.
- **Two shipped worlds.** Stock MajorMUD v1.11p and Paradigm, converted by
  `npm run build:world` from the zips in `mdb/` into `resources/world/`. A
  realm says which it runs at its own menu (`shared/worlds.ts`, remembered per
  address by `WorldBook`).
- **A realm's own database.** A server can name its own `.mdb`; it is
  converted into the same form and cached by the file's identity (path, size,
  modification time and the format) in `<home>/realms/`, by `RealmLibrary`,
  which prunes stale caches. Nothing queries the database while playing:
  normalise once.

## The graph

`WorldGraph.ts` (about 9,700 lines) is the room graph and A* over it, and
the answers built on it:

- **Routes.** `route(from, to, traveller)` prices each edge for the traveller
  (a door to open, a key carried or not, a lever to pull first, a toll, a
  trap, a level, class or race gate, a dangerous lair or room spell) and
  returns a `Route` (`shared/world.ts`): the steps, what it needs, the
  walls it crosses and why a route was refused. A long search runs on the
  route worker (`RoutePlanner.ts`, `routeWorker.ts`) so the socket does not
  stand still for it; the answer is the same.
- **Errands.** Where an item is bought (`buyingPlaces`, `priceAt`) or
  dropped, which lever opens a hidden way and where it is (`leverErrand`),
  the realm's trainers, banks and shops. A lever's detour is held to
  `tuning.world.leverDetourCost` each way, except where it is the only way
  in: a plan refused for a far lever, or walking into a wall one opens, is
  planned again with that lever's budget lifted (`planReaching`). A set of
  levers over several rooms is one round, any number of rooms, in the
  cheapest order (`bestOrder`), with a lever at the door pulled on the way
  out. A leg is one Dijkstra out of its room, kept and taken further by the
  next leg out of the same room (`leverLeg`), and kept between routes for
  the same shape of traveller, up to `LEG_TREE_ROOMS` rooms in all and let
  go when the tuning changes. A lifted door is shut inside its own errand's
  legs (`Traveller.leversOpening`), which never gain by opening it again.
- **Hidden exits.** `Hidden/Passable` is a plain exit the room does not
  list, priced as any other unless a lever opens it; `Hidden/Searchable`
  costs the search, and `Hidden/Needs N Actions` the levers.
- **Lairs and hunting.** The Hunting card's survey: which lairs the exits
  reach and what they pay.

Around it: `localMap.ts` lays out the rooms around the character for the Map
card; `loopDraft.ts` plans a loop being built on the map; `megamudLoops.ts`
turns MegaMUD's recorded paths into our loops (`npm run build:loops`);
`megamudSignature.ts` is MegaMUD's room signature for a realm room;
`obstacle.ts` and `roomBrief.ts` describe a room or what stands in a way in
words a player can act on.

## Where is the character?

Room names are not unique, so placing the character is a search
(`resolve.ts`): the room's name and exits, narrowed by the move that led
there (`resolveByDeadReckoning`), or, on a realm that answers it, the map and
room number from `sys status` (`resolveFromCoordinates`). The tracker holds
the answer in `CharacterState.room`; the engine is told when it changes
(`MegaEngine.located`). A character the client cannot place stops and asks
rather than guessing.

## What is learned while playing

Per realm or per character, under the home directory:

| Store | File | What |
|---|---|---|
| `WorldMemory`, `SplitMemory` | `memory/<character>.json`, `memory/realm-<realm>.json` | exits learned that the data does not have; the realm's share kept for every character, a character's own kept to it |
| `DestinationBook` | `destinations.json` | where characters on this machine have walked |
| `FindBook` | `memory/finds-<realm>.json` | what searching a room turned up |
| `PlayerBook` | `players.json` | the other players on each realm |
| `RealmLore` | `mob-lore.json` | monster and spell lore learned from fights and messages |
| `LairCosts` | none (in memory) | what one pass through a lair takes from this character |
| `MegaLearned` | `megamud-learned.json` | what the MegaMUD engine learned: items met, room signatures, spell immunities |

Each is stamped with the realm it was learned on and ignored, not deleted,
when the realm's data changes, because room numbers on another database are
other places.

## Shipped sentence tables

`resources/world/*.csv`: the server's own words for emotes
(`actions.csv`), monster deaths, the message table and spell messages, read
once (`ShippedSentences.ts`, `SpellMessages.ts`), so a line the realm composes
from its tables can be recognised.
