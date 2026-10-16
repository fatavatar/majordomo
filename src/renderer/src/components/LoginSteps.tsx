/**
 * A login menu script's rows: what the realm prints, what to answer, and
 * whether the row may answer again. One editor for the three places a script
 * is stated (a character's own, a realm's, and the Global default), which
 * were three copies of it (2026-10-16).
 */
import Icon from './Icon';
import { t } from '../lib/i18n';
import type { LoginStepDraft } from '@shared/drafts';

export default function LoginSteps({
  steps,
  onChange,
  whenPlaceholder,
  sendPlaceholder,
  onAdd
}: {
  steps: readonly LoginStepDraft[];
  onChange(next: LoginStepDraft[]): void;
  whenPlaceholder: string;
  sendPlaceholder: string;
  /** What the add button does, where it is more than a blank row. */
  onAdd?(): void;
}): React.JSX.Element {
  const write = (index: number, change: Partial<LoginStepDraft>): void =>
    onChange(steps.map((entry, at) => (at === index ? { ...entry, ...change } : entry)));

  return (
    <>
      {steps.length > 0 && (
        <ul className="settings-steps">
          {steps.map((step, index) => (
            // Keyed by position, deliberately: rows are edited in place and
            // identified by nothing else — two blank rows are genuinely the
            // same until somebody types.
            <li key={index}>
              <input
                aria-label={t('settings.login.stepWhenAria', { stepNumber: index + 1 })}
                onChange={(event) => write(index, { when: event.target.value })}
                placeholder={whenPlaceholder}
                value={step.when}
              />
              <span aria-hidden="true" className="arrow">
                →
              </span>
              <input
                aria-label={t('settings.login.stepSendAria', { stepNumber: index + 1 })}
                className="answer"
                onChange={(event) => write(index, { send: event.target.value })}
                placeholder={sendPlaceholder}
                value={step.send}
              />
              <input
                aria-label={t('settings.login.stepRepeatAria', { stepNumber: index + 1 })}
                checked={step.repeat ?? false}
                className="repeat"
                onChange={(event) => write(index, { repeat: event.target.checked })}
                title={t('settings.login.stepRepeatTitle')}
                type="checkbox"
              />
              <button
                aria-label={t('settings.login.removeStepAria', { stepNumber: index + 1 })}
                className="quiet"
                onClick={() => onChange(steps.filter((_, at) => at !== index))}
                title={t('settings.login.removeStepTitle')}
                type="button"
              >
                <Icon name="close" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <button
        className="quiet add-step"
        onClick={onAdd ?? (() => onChange([...steps, { when: '', send: '' }]))}
        type="button"
      >
        <Icon name="plus" />
        <span>{t('settings.login.addStep')}</span>
      </button>
    </>
  );
}
