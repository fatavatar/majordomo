/**
 * The player's own commands other players may ask this character for, on the
 * Character page's Talk row (2026-10-15): a word, what to send, what to answer
 * and who may ask. See `BotCommand`.
 */
import { CheckField, TextField } from './FormField';
import Icon from './Icon';
import { t } from '../lib/i18n';
import type { BotCommand } from '@shared/remotes';

const BLANK: BotCommand = {
  word: '',
  send: '',
  reply: '',
  party: true,
  gang: false,
  anyone: false,
  players: []
};

export default function BotCommandList({
  commands,
  onChange
}: {
  commands: readonly BotCommand[];
  onChange(next: BotCommand[]): void;
}): React.JSX.Element {
  const write = (i: number, change: Partial<BotCommand>): void =>
    onChange(commands.map((c, j) => (j === i ? { ...c, ...change } : c)));

  return (
    <div className="bot-commands">
      {commands.length === 0 && <p className="settings-note">{t('settings.botCommands.none')}</p>}
      {commands.map((command, i) => {
        const name = `bot-command-${i}`;
        return (
          <div className="bot-command" data-row={i} key={i}>
            <div className="settings-inline">
              <TextField
                label={t('settings.botCommands.wordLabel')}
                name={`${name}-word`}
                onChange={(word) => write(i, { word })}
                placeholder="@heal"
                spellCheck={false}
                value={command.word}
              />
              <TextField
                hint={t('settings.botCommands.sendHint')}
                label={t('settings.botCommands.sendLabel')}
                name={`${name}-send`}
                onChange={(send) => write(i, { send })}
                placeholder="mend {source}"
                spellCheck={false}
                value={command.send}
              />
              <TextField
                hint={t('settings.botCommands.replyHint')}
                label={t('settings.botCommands.replyLabel')}
                name={`${name}-reply`}
                onChange={(reply) => write(i, { reply })}
                placeholder="{healing}"
                spellCheck={false}
                value={command.reply}
              />
            </div>
            <div className="bot-command-who">
              <CheckField
                checked={command.party}
                label={t('settings.botCommands.party')}
                name={`${name}-party`}
                onChange={(party) => write(i, { party })}
              />
              <CheckField
                checked={command.gang}
                label={t('settings.botCommands.gang')}
                name={`${name}-gang`}
                onChange={(gang) => write(i, { gang })}
              />
              <CheckField
                checked={command.anyone}
                hint={t('settings.botCommands.anyoneHint')}
                label={t('settings.botCommands.anyone')}
                name={`${name}-anyone`}
                onChange={(anyone) => write(i, { anyone })}
              />
              <TextField
                hint={t('settings.botCommands.playersHint')}
                label={t('settings.botCommands.playersLabel')}
                name={`${name}-players`}
                onChange={(typed) =>
                  write(i, {
                    players: typed
                      .split(',')
                      .map((p) => p.trim().toLowerCase())
                      .filter((p, at, all) => p !== '' || at === all.length - 1)
                  })
                }
                spellCheck={false}
                value={command.players.join(', ')}
              />
              <button
                className="quiet"
                onClick={() => onChange(commands.filter((_, j) => j !== i))}
                type="button"
              >
                {t('settings.botCommands.remove')}
              </button>
            </div>
          </div>
        );
      })}
      <button
        className="quiet add-step"
        onClick={() => onChange([...commands, { ...BLANK }])}
        type="button"
      >
        <Icon name="plus" />
        <span>{t('settings.botCommands.add')}</span>
      </button>
    </div>
  );
}
