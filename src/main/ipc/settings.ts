/**
 * The settings screen, over IPC: the realm's tables (messages, monsters,
 * items, spell lore) loaded, imported and saved, loop files, a character's,
 * a realm's and the client's own settings, MegaMUD's, remote grants and
 * mudstats, supplies and automation switches, and the logs and clipboard.
 */
import fs from 'node:fs/promises';

import { asAutomationSwitch } from '../../shared/config';
import {
  asGlobalDraft,
  asLoop,
  asProfileDraft,
  asProfileId,
  asServerDraft,
  LOOP_LIMITS
} from '../../shared/drafts';
import { Invoke, LearnedSpellTable, type Revealed, type SessionId } from '../../shared/ipc';
import { asItemRules, type ItemImport, itemSaysAnything } from '../../shared/itemRules';
import { asLoopAddress, asLoops, isLoopScope, loopFileName } from '../../shared/loops';
import { asMegaToggle } from '../../shared/megamud/toggles';
import { asMegaMudPaths, type LoopImport } from '../../shared/megamudPaths';
import {
  asMessageTriggers,
  type MessageImport,
  parseMegaMudMessages
} from '../../shared/messageTriggers';
import { asMonsterRules, type MonsterImport, saysAnything } from '../../shared/monsterRules';
import { t } from '../app/i18n';
import type { IpcContext } from '../client';
import { ITEM_TABLE, MESSAGE_TABLE, MONSTER_TABLE } from '../config/RealmTableStore';
import { loopFileText } from '../config/SettingsEditor';
import type { Transport } from '../host/Host';
import { megaNames } from '../session/MegaEngine';
import { detailOf, MudStatsApi } from '../stats/MudStatsApi';
import { realmAddress } from '../world/PlayerBook';
import { REALM_EXTENSIONS } from '../world/RealmSource';
import { loopsFromMegaMud } from '../world/megamudLoops';

export function registerSettingsIpc(transport: Transport, ctx: IpcContext): void {
  const { handle } = transport;

  handle(Invoke.settingsSnapshot, () => ctx.editor().snapshot());
  /*
   * A native picker for a realm database.
   *
   * A path typed by hand is a path typed wrong, and the failure — a realm that
   * cannot be read — shows up only after connecting. The filters name what
   * `RealmSource` understands rather than offering everything, and they name it
   * from `REALM_EXTENSIONS` rather than restating it: a dialog offering a file
   * the reader then refuses is a file a player can choose and not use.
   */
  handle(Invoke.chooseRealm, (caller) =>
    /*
     * The host puts the picker up, owned by the window that asked. A host
     * with no native picker answers null — and is never asked: a browser
     * tab's bridge opens the window's own picker over `browseHome` instead,
     * because the disk being browsed is the client's, not the viewer's.
     */
    ctx.platform.chooseFile(caller, {
      title: t('app.dialog.chooseRealmTitle'),
      extensions: REALM_EXTENSIONS,
      extensionsLabel: t('app.dialog.realmDatabaseFilter'),
      allFilesLabel: t('app.dialog.allFilesFilter')
    })
  );
  /* A realm's message table, by the realm's name (`tableAt`). */
  handle(Invoke.loadMessages, (_caller, realm: unknown) => {
    const at = ctx.tableAt(ctx.realmMessages, realm);
    return at === null ? MESSAGE_TABLE.empty : at.store.forServer(at.serverId);
  });
  handle(Invoke.importMessages, (_caller, realm: unknown, fileName: unknown, text: unknown) => {
    const at = ctx.tableAt(ctx.realmMessages, realm);
    if (at === null)
      return { ok: false, error: t('app.servers.noSuchServer') } satisfies MessageImport;
    if (typeof text !== 'string') {
      return { ok: false, error: t('app.messages.unreadable') } satisfies MessageImport;
    }
    const read = parseMegaMudMessages(text);
    /*
     * A file that yields nothing is refused rather than written: replacing a
     * realm's table with an empty one because somebody picked the wrong file
     * is the one outcome of an import nobody wants, and it is silent.
     */
    if (read.triggers.length === 0) {
      return { ok: false, error: t('app.messages.nothingRead') } satisfies MessageImport;
    }
    const result = at.store.write(at.serverId, {
      source: ctx.importedFrom(fileName, 'Messages.md'),
      triggers: read.triggers
    });
    if (!result.ok) return { ok: false, error: result.error } satisfies MessageImport;
    return {
      ok: true,
      count: read.triggers.length,
      chase: read.triggers.filter((trigger) => trigger.chase).length,
      skipped: read.skipped
    } satisfies MessageImport;
  });
  handle(Invoke.saveMessages, (_caller, realm: unknown, triggers: unknown) => {
    const at = ctx.tableAt(ctx.realmMessages, realm);
    if (at === null) return t('app.servers.noSuchServer');
    // Parsed, not trusted: the rows crossed the wire like any other payload.
    const result = at.store.write(at.serverId, {
      source: at.store.forServer(at.serverId).source,
      triggers: asMessageTriggers(triggers)
    });
    return result.ok ? null : result.error;
  });
  /*
   * A realm's monster table, the same way. The window decodes `Monsters.md`
   * and hands over rows, which are parsed here like any other payload.
   */
  handle(Invoke.loadMonsters, (_caller, realm: unknown) => {
    const at = ctx.tableAt(ctx.realmMonsters, realm);
    return at === null ? MONSTER_TABLE.empty : at.store.forServer(at.serverId);
  });
  handle(Invoke.importMonsters, (_caller, realm: unknown, fileName: unknown, rows: unknown) => {
    const at = ctx.tableAt(ctx.realmMonsters, realm);
    if (at === null)
      return { ok: false, error: t('app.servers.noSuchServer') } satisfies MonsterImport;
    const monsters = asMonsterRules(rows).filter(saysAnything);
    // Refused rather than written, for `importMessages`' reason.
    if (monsters.length === 0) {
      return { ok: false, error: t('app.monsters.noRows') } satisfies MonsterImport;
    }
    const result = at.store.write(at.serverId, {
      source: ctx.importedFrom(fileName, 'Monsters.md'),
      monsters
    });
    if (!result.ok) return { ok: false, error: result.error } satisfies MonsterImport;
    return { ok: true, count: monsters.length } satisfies MonsterImport;
  });
  handle(Invoke.saveMonsters, (_caller, realm: unknown, rows: unknown) => {
    const at = ctx.tableAt(ctx.realmMonsters, realm);
    if (at === null) return t('app.servers.noSuchServer');
    const result = at.store.write(at.serverId, {
      source: at.store.forServer(at.serverId).source,
      monsters: asMonsterRules(rows)
    });
    return result.ok ? null : result.error;
  });
  /* A realm's item table, the same way: the window decodes `Items.md`. */
  handle(Invoke.loadItems, (_caller, realm: unknown) => {
    const at = ctx.tableAt(ctx.realmItems, realm);
    return at === null ? ITEM_TABLE.empty : at.store.forServer(at.serverId);
  });
  handle(Invoke.importItems, (_caller, realm: unknown, fileName: unknown, rows: unknown) => {
    const at = ctx.tableAt(ctx.realmItems, realm);
    if (at === null)
      return { ok: false, error: t('app.servers.noSuchServer') } satisfies ItemImport;
    const items = asItemRules(rows).filter(itemSaysAnything);
    // Refused rather than written, for `importMessages`' reason.
    if (items.length === 0) {
      return { ok: false, error: t('app.items.noRows') } satisfies ItemImport;
    }
    const result = at.store.write(at.serverId, {
      source: ctx.importedFrom(fileName, 'Items.md'),
      items
    });
    if (!result.ok) return { ok: false, error: result.error } satisfies ItemImport;
    return { ok: true, count: items.length } satisfies ItemImport;
  });
  handle(Invoke.saveItems, (_caller, realm: unknown, rows: unknown) => {
    const at = ctx.tableAt(ctx.realmItems, realm);
    if (at === null) return t('app.servers.noSuchServer');
    const result = at.store.write(at.serverId, {
      source: at.store.forServer(at.serverId).source,
      items: asItemRules(rows)
    });
    return result.ok ? null : result.error;
  });
  /*
   * A realm's learned spell sentences, by the realm's name: kept under the
   * realm's data, as `spellLoreFor` keys them, so a realm with none has
   * nothing to list.
   */
  handle(Invoke.loadSpellLore, (_caller, realm: unknown) => {
    const source = ctx.loreSourceOf(realm);
    if (source === null || ctx.lore === null)
      return { known: false, rows: [] } satisfies LearnedSpellTable;
    return { known: true, rows: ctx.lore.learnedSpells(source) } satisfies LearnedSpellTable;
  });
  handle(Invoke.saveSpellLore, (_caller, realm: unknown, rows: unknown) => {
    const source = ctx.loreSourceOf(realm);
    if (source === null || ctx.lore === null) return t('session.loop.noRealmData');
    // Parsed, not trusted: the rows crossed the wire like any other payload.
    const parsed = (Array.isArray(rows) ? rows : []).flatMap((row: unknown) => {
      if (typeof row !== 'object' || row === null) return [];
      const { spell, start, stop } = row as Record<string, unknown>;
      if (typeof spell !== 'string' || typeof start !== 'string' || typeof stop !== 'string')
        return [];
      return [{ spell: spell.slice(0, 80), start: start.slice(0, 200), stop: stop.slice(0, 200) }];
    });
    ctx.lore.setLearnedSpells(source, parsed);
    return null;
  });
  /*
   * A MegaMUD folder's loops onto a realm, converted against **that realm's**
   * data: a loop is a walk through rooms, and the rooms are the realm's. The
   * window read the folder; what crossed is parsed here like any payload.
   */
  handle(Invoke.importLoops, async (_caller, realm: unknown, rawPaths: unknown) => {
    const stored =
      typeof realm === 'string'
        ? ctx.servers?.all.find((entry) => entry.server.name === realm)
        : null;
    if (!stored) return { ok: false, error: t('app.servers.noSuchServer') } satisfies LoopImport;
    const paths = asMegaMudPaths(rawPaths);
    // Refused rather than written as nothing, for `importMessages`' reason.
    if (paths.length === 0) {
      return { ok: false, error: t('app.loop.noLoopsSent') } satisfies LoopImport;
    }
    const learned = ctx.worldBook?.at(realmAddress(stored.server)) ?? null;
    const graph = ctx.realms?.load(stored.server.database, learned).graph;
    if (!graph) return { ok: false, error: t('session.loop.noRealmData') } satisfies LoopImport;
    const { loops: converted, dropped } = await loopsFromMegaMud(graph, paths);
    if (converted.length === 0) {
      return {
        ok: false,
        error: t('app.loop.noneFit', { count: paths.length })
      } satisfies LoopImport;
    }
    const result = ctx.editor().addLoops('server', stored.server.name, converted);
    if (!result.ok) return { ok: false, error: result.error } satisfies LoopImport;
    // Live now rather than on the store's next poll, for `addLoop`'s reason.
    ctx.loops?.refresh();
    return {
      ok: true,
      count: converted.length,
      replaced: result.replaced,
      dropped
    } satisfies LoopImport;
  });
  /*
   * A loop as a file to hand on. The loop crossed the wire, so it is parsed;
   * a name is the character's own, found as its laps find it.
   */
  handle(Invoke.exportLoop, async (_caller, session: unknown, given: unknown, format: unknown) => {
    const manager =
      typeof session === 'string' ? ctx.host?.get(session as SessionId)?.manager : undefined;
    const loop =
      typeof given === 'string' ? manager?.loopNamed(given) : asLoops([given], LOOP_LIMITS)[0];
    if (loop === undefined) return { error: t('app.loop.noSuchLoop') };
    if (format !== 'megamud') {
      return { file: `${loopFileName(loop.name)}.yaml`, text: loopFileText(loop) };
    }
    if (manager === undefined) return { error: t('app.session.notConnected') };
    const made = await manager.exportMegaLoop(loop);
    return typeof made === 'string' ? { error: made } : made;
  });
  handle(Invoke.importLoopFile, (_caller, scope: unknown, owner: unknown, text: unknown) => {
    if (!isLoopScope(scope) || typeof text !== 'string')
      return { ok: false, error: t('errors.settings.loopFileEmpty') };
    if (text.length > ctx.LOOP_FILE_MAX)
      return { ok: false, error: t('errors.settings.loopFileTooBig') };
    const result = ctx
      .editor()
      .importLoopText(scope, typeof owner === 'string' ? owner : null, text);
    // Live now rather than on the store's next poll, for `addLoop`'s reason.
    if (result.ok) ctx.loops?.refresh();
    return result;
  });
  handle(Invoke.saveProfile, (_caller, rawId: unknown, rawDraft: unknown) => {
    const id = asProfileId(rawId);
    if (id === null) return t('app.profiles.invalidId');
    const draft = asProfileDraft(rawDraft);
    if (draft === null) return t('app.profiles.incompleteDraft');
    ctx.profiles?.ensureDirectory();
    const result = ctx.editor().saveProfile(id, draft);
    // The store polls, so the new character appears without being told; saying
    // so here as well would report it twice.
    return result.ok ? null : result.error;
  });
  handle(Invoke.megamudChoices, (_caller, rawId: unknown) => {
    const id = asProfileId(rawId);
    return id === null ? null : (ctx.host?.get(id)?.manager.megaChoices() ?? null);
  });
  handle(Invoke.megamudNames, (_caller, rawId: unknown) => {
    const id = asProfileId(rawId);
    const profile = id === null ? undefined : ctx.profileFor(id);
    return id === null || profile === undefined ? null : megaNames(ctx.megaDataFor(id, profile));
  });
  handle(Invoke.seenPlayers, (_caller, rawId: unknown) => {
    const id = asProfileId(rawId);
    if (id === null) return [];
    return ctx
      .playersFor(id)
      .recall()
      .map((facts) => facts.name);
  });
  handle(Invoke.forgetPlayer, (_caller, rawId: unknown, rawName: unknown) => {
    const id = asProfileId(rawId);
    const target = id === null ? undefined : ctx.profileFor(id)?.target;
    if (target === undefined || typeof rawName !== 'string') {
      return t('app.profiles.noSuchCharacter');
    }
    ctx.playerBook?.forget(realmAddress(target), rawName);
    return null;
  });
  handle(Invoke.deleteProfile, (_caller, rawId: unknown) => {
    const id = asProfileId(rawId);
    if (id === null) return t('app.profiles.noSuchCharacter');
    const result = ctx.editor().deleteProfile(id);
    return result.ok ? null : result.error;
  });
  handle(Invoke.saveServer, (_caller, previous: unknown, rawDraft: unknown) => {
    const draft = asServerDraft(rawDraft);
    if (draft === null) return t('app.servers.invalidDraft');
    const result = ctx.editor().saveServer(typeof previous === 'string' ? previous : null, draft);
    return result.ok ? null : result.error;
  });
  handle(Invoke.saveGlobal, (_caller, rawDraft: unknown) => {
    const draft = asGlobalDraft(rawDraft);
    if (draft === null) return t('app.settings.invalidGlobalDraft');
    const result = ctx.editor().saveGlobal(draft);
    // The store polls, so the change reaches every character without being
    // told; saying so here as well would report it twice.
    return result.ok ? null : result.error;
  });
  /*
   * One player's whole grant, from the Player flyout. Validated here rather
   * than trusted: a renderer payload is a value from outside like any other,
   * and the remotes in it are a closed union of fifty-seven.
   */
  handle(Invoke.setRemoteGrant, (_caller, session: unknown, name: unknown, grant: unknown) => {
    if (typeof session !== 'string' || typeof name !== 'string') {
      return t('app.profiles.noSuchCharacter');
    }
    const parsed = ctx.asGrant(grant);
    if (parsed === null) return t('app.remotes.invalidName');
    const result = ctx.editor().setRemoteGrant(session, name, parsed);
    /*
     * The store polls, so the character picks the change up without being
     * told — but the *renderer* draws the Access face from `ProfileSummary`,
     * which is pushed rather than polled, so the rosters are republished here
     * or the flyout would go on showing the grant it had before the click.
     */
    if (result.ok) ctx.publishRosters();
    return result.ok ? null : result.error;
  });
  /* What anybody in this character's gang may ask for, from the Gang card. */
  handle(Invoke.setGangRemotes, (_caller, session: unknown, remotes: unknown) => {
    if (typeof session !== 'string') return t('app.profiles.noSuchCharacter');
    const parsed = ctx.asRemoteNames(remotes);
    if (parsed === null) return t('app.remotes.invalidName');
    const result = ctx.editor().setGangRemotes(session, parsed);
    if (result.ok) ctx.publishRosters();
    return result.ok ? null : result.error;
  });
  /*
   * The realm's mudstats board. The link runs on the character's own session,
   * which is what reads the code off the telepath the board sends; the key it
   * gets is written beside the password, and the profile's reload hands it to
   * the session's reporter. Nothing here ever returns the key.
   */
  const keepStatsKey =
    (session: string) =>
    (key: string): string | null => {
      const result = ctx.editor().setStatsKey(session, key);
      return result.ok ? null : result.error;
    };
  handle(Invoke.statsLink, async (_caller, session: unknown) => {
    if (typeof session !== 'string') return t('app.profiles.noSuchCharacter');
    const manager = ctx.host?.get(session)?.manager;
    if (!manager) return t('mudstats.link.notConnected');
    return manager.statsLink(keepStatsKey(session));
  });
  handle(Invoke.statsUnlink, async (_caller, session: unknown) => {
    if (typeof session !== 'string') return t('app.profiles.noSuchCharacter');
    const manager = ctx.host?.get(session)?.manager;
    if (!manager) return t('mudstats.link.notConnected');
    return manager.statsUnlink(keepStatsKey(session));
  });
  handle(Invoke.statsStatus, async (_caller, session: unknown) => {
    if (typeof session !== 'string') return t('app.profiles.noSuchCharacter');
    const manager = ctx.host?.get(session)?.manager;
    if (!manager) return t('mudstats.link.notConnected');
    return manager.statsStatus();
  });
  handle(Invoke.statsTest, async (_caller, url: unknown) => {
    if (typeof url !== 'string' || url.trim() === '') return t('mudstats.test.noUrl');
    const answer = await new MudStatsApi(url.trim()).fields();
    if (answer.status !== 200) return t('mudstats.test.failed', { detail: detailOf(answer) });
    const floor = Number(answer.body['min_interval']);
    return t('mudstats.test.ok', { seconds: Number.isFinite(floor) ? floor : '?' });
  });
  /* Whether the gang's own channel is answered on at all. Same card, same push. */
  handle(Invoke.setRemoteGangpath, (_caller, session: unknown, on: unknown) => {
    if (typeof session !== 'string') return t('app.profiles.noSuchCharacter');
    const result = ctx.editor().setRemoteGangpath(session, on === true);
    if (result.ok) ctx.publishRosters();
    return result.ok ? null : result.error;
  });
  /*
   * This character's supplies list, from the Self card or the item panel.
   * Same shape and same push: the list rides on `ProfileSummary`, and a card
   * that drew the old list until the store's poll came round would show the
   * row somebody just added as missing.
   */
  handle(Invoke.setSupplies, (_caller, session: unknown, items: unknown) => {
    if (typeof session !== 'string') return t('app.profiles.noSuchCharacter');
    const parsed = ctx.asSupplyItems(items);
    if (parsed === null) return t('app.supplies.invalidList');
    const result = ctx.editor().setSupplies(session, parsed);
    if (result.ok) ctx.publishRosters();
    return result.ok ? null : result.error;
  });
  /*
   * One automation switch, from the toolbar. Same shape and same push: the
   * store's poll brings the change back to the *session* on its own, and the
   * rosters are republished here because the toolbar draws from
   * `ProfileSummary`, which is pushed rather than polled — without it the
   * button would stay where it was until something else moved.
   */
  handle(Invoke.megamudToggle, (_caller, session: unknown, name: unknown) => {
    const slot = typeof session === 'string' ? ctx.host?.get(session as SessionId) : undefined;
    if (!slot) return t('app.session.notConnected');
    // Parsed rather than trusted: this crossed the wire.
    const parsed = asMegaToggle(name);
    if (parsed === null) return t('app.automation.unknownSwitch');
    return slot.manager.megaToggle(parsed);
  });
  handle(Invoke.megamudAnswer, (_caller, session: unknown, question: unknown, yes: unknown) => {
    if (typeof session !== 'string' || typeof question !== 'string') return;
    ctx.host?.get(session as SessionId)?.manager.megaAnswer(question, yes === true);
  });
  handle(Invoke.setAutomationSwitch, (_caller, session: unknown, name: unknown, on: unknown) => {
    if (typeof session !== 'string') return t('app.profiles.noSuchCharacter');
    // Parsed rather than checked: this crossed the wire, and a path built
    // from an unvalidated name is a write into somebody's YAML at a key
    // nothing reads.
    const parsed = asAutomationSwitch(name);
    if (parsed === null) return t('app.automation.unknownSwitch');
    const result = ctx.editor().setAutomationSwitch(session, parsed, on === true);
    if (result.ok) ctx.publishRosters();
    return result.ok ? null : result.error;
  });
  /*
   * One loop into one scope, from the Loops modal.
   *
   * Parsed rather than trusted: this payload becomes a file in the user's own
   * tree, and `asLoop` is the same parser the options file goes through, so a
   * loop filed from the modal and one typed by hand cannot mean different
   * things. The scope is a closed union and is checked against its own list
   * rather than interpolated into a path — the failure a wire-built path
   * causes here is a write into somebody's YAML at a key nothing reads.
   */
  handle(
    Invoke.addLoop,
    (_caller, scope: unknown, owner: unknown, loop: unknown, replaces: unknown) => {
      if (!isLoopScope(scope)) return t('app.loop.unknownScope');
      const parsed = asLoop(loop);
      if (parsed === null) return t('app.loop.invalidLoop');
      // The loop an edit was opened from, which a save under another name replaces.
      const replaced = replaces === undefined || replaces === null ? null : asLoopAddress(replaces);
      if (replaces !== undefined && replaces !== null && replaced === null)
        return t('app.loop.invalidLoop');
      const result = ctx
        .editor()
        .addLoop(
          scope,
          typeof owner === 'string' && owner.trim().length > 0 ? owner.trim() : null,
          parsed,
          replaced
        );
      // The store's poll would find it within the tick; refreshing now is what
      // makes the modal's own list show it before the player looks away.
      if (result.ok) ctx.loops?.refresh();
      return result.ok ? null : result.error;
    }
  );
  handle(Invoke.deleteServer, (_caller, name: unknown) => {
    if (typeof name !== 'string' || name.trim().length === 0) return t('app.servers.noSuchServer');
    const result = ctx.editor().deleteServer(name.trim());
    return result.ok ? null : result.error;
  });
  handle(Invoke.revealLogs, async (): Promise<Revealed> => {
    const directory = ctx.logDirectory();
    // The directory may not exist yet if nothing has been logged; opening a
    // missing path silently does nothing, which reads as a broken menu item.
    await fs.mkdir(directory, { recursive: true }).catch(() => undefined);
    return ctx.reveal(directory, 'directory');
  });
  /*
   * The clipboard, for the terminal's copy and paste. See the channel's own
   * note for why this is here rather than `navigator.clipboard` in the window.
   *
   * The payload is checked rather than trusted, like every other one that
   * crosses this boundary — and an empty write is refused rather than
   * performed, because clearing somebody's clipboard is not what "copy
   * nothing" should mean.
   *
   * A host with no clipboard is never asked: a browser tab's bridge keeps
   * the window's own (`navigator.clipboard`), for the reason the desktop
   * does not — there the browser's chord is bound and its permission is the
   * tab's to grant. Answered honestly all the same, so a bridge that did ask
   * would learn nothing was written.
   */
  handle(Invoke.copyText, async (_caller, text: unknown) => {
    if (typeof text !== 'string' || text.length === 0) return;
    if (ctx.platform.clipboard === null) {
      ctx.announce('clipboard', t('app.clipboard.none'));
      return;
    }
    await ctx.platform.clipboard.write(text);
  });
  handle(Invoke.pasteText, () => {
    if (ctx.platform.clipboard === null) {
      ctx.announce('clipboard', t('app.clipboard.none'));
      return '';
    }
    return ctx.platform.clipboard.read();
  });
}
