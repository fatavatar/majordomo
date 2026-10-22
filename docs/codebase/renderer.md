# The renderer

`src/renderer/src/`: a React 18 app, built by electron-vite. It holds no game
logic of its own: facts come from main, decisions are main's, and the
renderer shows them and sends what the player does.

## The bridge and the contract

`src/shared/ipc.ts` is the single source of truth for main and renderer:

- `Invoke.*`: calls that answer (`window.mudengine.someCall(...)`, a promise).
- `Send.*`: one-way messages from the window (keystrokes, a resize, which
  cards it shows).
- `Push.*`: what main pushes (`data`, `line`, `block`, `character`, `state`,
  `walk`, `loop`, `automation`, …), each `Addressed<T>` with the session it
  belongs to, so a push without a destination does not typecheck.

`IpcApi` declares every method, each named as its channel's key is (a
`Push` key `x` is the method `onX`), which `METHODS_MATCH_CHANNELS` holds at
compile time. `bridgeOver` in `shared/ipc.ts` builds the whole object from
the channel tables over a carrier that can invoke, send and subscribe:
`src/preload/index.ts` lends it Electron's IPC on the desktop, and
`renderer/src/lib/webBridge.ts` the WebSocket in a browser tab. `main.tsx`
uses whichever is present. `client.ts` handles every `Invoke` and `Send`
(`handle(Invoke.x, …)`), and `ipc-wiring.test.ts` checks that it does.

## The app

- `main.tsx` puts the bridge in place and renders `App`.
- `App.tsx` (about 6,400 lines) is the shell: the tab rail of characters,
  the panes (up to four characters side by side), the card rail, every
  push subscription, and per-session view state (`patchView`). Modal
  screens (Settings, Loops, MMUD Explorer, the home browser) open over it.
- `components/`: about 100 components. Cards (`*Card.tsx`), screens
  (`SettingsScreen`, `ExplorerScreen`, `LoopsModal`), editors (monster and
  item rules, MegaMUD's settings tabs, rewrites), popovers (`Reference*`,
  `PlayerFlyout`) and the terminal (`TerminalView`, `SessionTerminal`, on
  xterm with the WebGL renderer).
- `hooks/`: card layout, drag and resize, pane widths, preferences, theme,
  density, hotkeys, settings panels.
- `lib/`: small helpers (formatting, tables, maps, routes, popovers, the
  web bridge, `i18n.ts`, `tuning.ts`).

## Cards

Every card is listed in `CARDS` (`hooks/useCardLayout.ts`): toolbar, self,
vitals, combat, room, map, builder, navigation, party, notifications, realm,
players, gang, inventory, banks, quests, hunting, conversation, reference,
stats, gear, session, link, automation, stream. That list is the vocabulary,
not the layout: a player's arrangement (order, which are put away, heights)
is kept in `localStorage`, per browser profile, and a card added by a later
build appears for everyone who already has a layout. A new card also needs
its case in `App.tsx`'s card switch.

## Words, styles, themes

- **Words.** Every user-facing string is a key in `locales/ui.en.yaml`,
  looked up with `t('literal.key', { values })` (`lib/i18n.ts`; main has the
  same in `app/i18n.ts`). Keys are always literals, never `t(variable)`, so
  they can be found and checked. YAML plain scalars must not contain `: `.
- **Styles.** `styles/tokens.css` defines the colour and spacing tokens,
  `styles/index.css` (about 15,000 lines) everything else, by component
  class. Themes are `shared/themes.ts`.
- **Preferences.** A setting that is both in the options file and a quick
  control in the window uses `usePreference`: the window's choice wins until
  the file's value actually changes.

## MMUD Explorer

`ExplorerScreen.tsx` and the `Explorer*` components recreate MMUD
Explorer's tabs (EQ, Lists, Weapons, Armour, Sundry, Spells, Monsters,
Class/Race, Shops, Rooms, Tools) on the realm the character plays and the
character as the game reports it. The logic is mudtool's, vendored into
`src/main/mme/vendor/` by `npm run sync:mme` (never edited in place) and
called through `mme/Explorer.ts` on its own worker thread. Buy and Buy +
Wear go through the item errand ([planners.md](planners.md)).
