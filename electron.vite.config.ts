import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';

import { buildStamp } from './scripts/lib/build-stamp.mjs';

const shared = resolve('src/shared');

/** Which commit main and the window were built from (`src/shared/build.ts`). */
const stamp = { __BUILD_STAMP__: JSON.stringify(buildStamp(resolve('.'))) };

/**
 * Bundled rather than externalised.
 *
 * Electron's ESM loader cannot pre-parse an external dependency of either
 * shape from the built main chunk. `yaml` fails with a TypeError inside
 * `cjsPreparseModuleExports` before any of our code runs; `mdb-reader` is
 * `"type": "module"` and died with *"require() of ES Module … not
 * supported"* the moment anybody chose an Access realm — which read as the
 * client refusing their database, and left them on the shipped realm.
 *
 * Both are pure JavaScript with no native component, so inlining them costs a
 * few kilobytes and removes the runtime resolution entirely.
 */
const BUNDLED = ['yaml', 'mdb-reader'];

/**
 * Comments do not ship.
 *
 * The main and preload chunks are not minified by default, so every comment in
 * `src/` went into `app.asar` verbatim — and in this repository the comments
 * are the documentation: the evidence for a pattern is the *capture*, pasted in
 * beside it. Which meant a released build carried live `who` and party
 * listings naming this developer's characters and other real players, and the
 * hostname of a private server, in a file handed to strangers. Found by
 * grepping the built `app.asar` for a character name on 2026-09-02.
 *
 * **The minifier is the lever, not the per-module transform.** Under esbuild
 * (Vite 5), two settings were tried and measured before the one that worked:
 * `legalComments: 'none'` governs only licence banners, and
 * `esbuild.minifyWhitespace` is ignored, because Vite's `esbuild` options
 * configure the per-module *transform* and minification is a separate step it
 * does not reach. Both built clean and both still shipped every one of those
 * listings, which is why the measurement is written down here: the way to
 * check this is to grep the built `out/main/index.js`, not to read the config.
 *
 * **Since Vite 8 (2026-11-02) the minifier is Rolldown's (Oxc)**, and the
 * lever is each half's output. `build.minify: 'oxc'` switches it on, and
 * `output.minify` says what it may do: whitespace only. `output.comments:
 * false` takes out every comment. Rolldown drops a plain comment of itself
 * but *keeps* JSDoc, legal and annotation comments unless told, and nearly
 * all of this repository's documentation is JSDoc. Vite clears those when it
 * minifies, but that is an inference about Vite's defaults, so it is said
 * here instead. Measured the same way: the built main, preload and window
 * carry none of the JSDoc phrases the Vite 5 build also lacked.
 *
 * **Renaming and syntax rewriting stay off (`mangle`, `compress`; under
 * esbuild `minifyIdentifiers` and `minifySyntax`), and that is not a
 * preference — it is what the smoke harness measured.** Letting esbuild rename
 * identifiers in the window broke the client: 8 checks failed and the run hung,
 * against 663 of 663 passing on the same tree with minification off (2026-09-02,
 * two runs in worktrees differing in this file alone). The tab showed the name
 * the *server* gave rather than the one the profile gives, the diagnostics cards
 * came up visible, the theme was not remembered and the terminal's search found
 * nothing. Renaming is not safe here and the reason has not been chased down;
 * whitespace alone is, and whitespace alone is what removes a comment.
 *
 * Keeping the names has a second payment: a stack trace out of a packaged build
 * still says `CommandQueue` and `resolveProfile` rather than `t` and `e`. This
 * client's console output is how it explains itself (`notice()` writes to
 * stdout for exactly that reason).
 *
 * What is saved anyway is real: main 1,619 kB → 954 kB, the window's script
 * 2,012 kB → 1,381 kB and its stylesheet 217 kB → 81 kB. About 1.4 MB of prose
 * was in every install.
 *
 * Licence notices ride with the distribution rather than inside the
 * executable: the two dependencies actually bundled are `yaml` (ISC) and
 * `mdb-reader` (MIT), and the repository ships its own LICENCE.
 *
 * It is a *build* setting rather than an instruction to write fewer comments.
 * The alternative was editing ninety comments to launder the evidence out of
 * them, which would cost the thing that makes them worth having.
 */
const stripComments = {
  minify: { compress: false, mangle: false, codegen: { removeWhitespace: true } },
  comments: false
} as const;

/**
 * The 500 kB chunk warning is a web-delivery heuristic, and the window is a
 * web target only some of the time.
 *
 * Vite's default exists because half a megabyte of JavaScript over a slow
 * network is a multi-second stall before anything renders. On the desktop
 * nothing crosses a network: the window is `loadFile()`d off the local disk
 * and main and preload are read by Electron's own loader. In web mode
 * (`MUDENGINE_WEB=1`, `src/main/host/WebHost.ts`) the same bundle *does*
 * cross one — once. Every asset is named by its content hash and served
 * `immutable`, so a tab pays the transfer on its first visit and never again
 * until the client is rebuilt; and the window uses the terminal, the rail and
 * the cards on its first frame regardless, so the two remedies the warning
 * suggests would still buy little — `manualChunks` splits a transfer paid
 * once into several paid once, and dynamic `import()` defers parse cost for
 * code the first frame needs anyway. Measured before it is decided: if a
 * first paint over a slow link ever proves too slow, splitting the map, the
 * settings screen and the quest book off the first frame is the change, and
 * this paragraph is where to say what it bought.
 *
 * The limit is raised to make the warning mean something, not to silence it.
 * One that fires on every build forever is one nobody reads, and build output
 * is where a genuine size regression shows up first — a dependency bundled by
 * accident, or the comment stripping above coming undone, which last time was
 * 1.4 MB of prose carrying a private hostname into every install. Main and the
 * window get about half again what they measure (887 kB and 1,558 kB on
 * 2026-09-07, the window having grown its web bridge), so ordinary growth is
 * quiet and a doubling still speaks up. Preload's is not scaled from its
 * 8 kB: it is the security boundary and has no business growing at all, so
 * 100 kB reads as *something is wrong here*.
 */
const CHUNK_LIMIT_KB = { main: 1400, preload: 100, renderer: 2000 } as const;

/**
 * The preload as a sandboxed window can run it, or no build (2026-11-02).
 *
 * The window is sandboxed (`ElectronHost`), and a sandboxed renderer runs its
 * preload as one plain script: `require` reaches `electron` and nothing else,
 * there is no module loader to fetch a chunk beside it, and from Electron 45
 * none of the Node shims either -- `Buffer`, `setImmediate`, `events`,
 * `timers`, `url` (Electron 45 breaking changes). A preload that asks for any
 * of them throws as the window opens, before the bridge exists, and the
 * window is blank. Nothing on a machine without a display would see that, so
 * the build refuses it instead: a single chunk, `electron` its only import,
 * and none of the globals 45 took away.
 */
const NOT_IN_A_SANDBOX = /\b(?:Buffer|setImmediate|clearImmediate)\b/;
const sandboxedPreload = {
  name: 'majordomo:sandboxed-preload',
  generateBundle(
    _options: unknown,
    bundle: Record<string, { type: string; code?: string; imports?: string[] }>
  ): void {
    const chunks = Object.entries(bundle).filter(([, item]) => item.type === 'chunk');
    const problems: string[] = [];
    if (chunks.length !== 1) problems.push(`${chunks.length} chunks where one can be loaded`);
    for (const [name, chunk] of chunks) {
      for (const imported of chunk.imports ?? []) {
        if (imported !== 'electron') problems.push(`${name} requires ${imported}`);
      }
      const global = NOT_IN_A_SANDBOX.exec(chunk.code ?? '');
      if (global !== null) problems.push(`${name} uses ${global[0]}`);
    }
    if (problems.length > 0) {
      throw new Error(`The preload cannot run in a sandboxed window: ${problems.join('; ')}.`);
    }
  }
};

export default defineConfig({
  main: {
    define: stamp,
    resolve: { alias: { '@shared': shared, '@main': resolve('src/main') } },
    build: {
      externalizeDeps: { exclude: BUNDLED },
      minify: 'oxc',
      chunkSizeWarningLimit: CHUNK_LIMIT_KB.main,
      rolldownOptions: {
        output: stripComments,
        input: {
          index: resolve('src/main/index.ts'),
          // Its own thread: see `src/main/world/RoutePlanner.ts`.
          routeWorker: resolve('src/main/world/routeWorker.ts'),
          // And MMUD Explorer's: see `src/main/mme/ExplorerThread.ts`.
          explorerWorker: resolve('src/main/mme/explorerWorker.ts')
        }
      }
    }
  },
  preload: {
    plugins: [sandboxedPreload],
    resolve: { alias: { '@shared': shared } },
    build: {
      /*
       * Nothing externalised but `electron`, which electron-vite always
       * leaves out: a dependency left to be required at runtime is one a
       * sandboxed preload cannot load, so whatever the preload uses is bundled
       * into it. electron-vite 6 externalises by default, so this says no.
       */
      externalizeDeps: false,
      minify: 'oxc',
      chunkSizeWarningLimit: CHUNK_LIMIT_KB.preload,
      rolldownOptions: {
        input: { index: resolve('src/preload/index.ts') },
        /*
         * CommonJS, for the sandbox (`sandboxedPreload`). `package.json` says
         * `"type": "module"`, which electron-vite reads as an ESM preload
         * (`index.mjs`) -- and Electron loads an ESM preload only with the
         * sandbox off, which is what the window had until 2026-11-02. `.cjs`
         * rather than `.js` so that anything reading it as Node under that
         * same `"type"` takes it for what it is.
         */
        output: {
          ...stripComments,
          format: 'cjs',
          entryFileNames: '[name].cjs',
          codeSplitting: false
        }
      }
    }
  },
  renderer: {
    define: stamp,
    root: resolve('src/renderer'),
    plugins: [react()],
    resolve: { alias: { '@shared': shared, '@renderer': resolve('src/renderer/src') } },
    build: {
      minify: 'oxc',
      chunkSizeWarningLimit: CHUNK_LIMIT_KB.renderer,
      rolldownOptions: {
        output: stripComments,
        input: { index: resolve('src/renderer/index.html') }
      }
    }
  }
});
