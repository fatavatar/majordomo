import { useEffect, useRef } from 'react';

import { keepFocus } from '../lib/focus';
import { t } from '../lib/i18n';

export interface MegaMudQuestionProps {
  /** MegaMUD's question, in its own words, or null while nothing is asked. */
  question: string | null;
  /** Whose MegaMUD is asking. */
  characterName: string;
  onAnswer(yes: boolean): void;
}

/**
 * One of MegaMUD's own yes-or-no questions — a path step to relearn, the
 * key, gold or level a destination needs.
 *
 * MegaMUD stops and waits on these; this client cannot, so main answers no
 * where MegaMUD asks and holds the question here, and a *yes* runs the
 * player's action again for MegaMUD to be told yes (`SessionManager.megaAsk`).
 * **No is the safe answer and takes the caret**, for `MovementPrompt`'s
 * reason, and Escape is no.
 */
export default function MegaMudQuestion({
  question,
  characterName,
  onAnswer
}: MegaMudQuestionProps): React.JSX.Element | null {
  const no = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (question === null) return;
    const id = window.requestAnimationFrame(() => no.current?.focus());
    return () => window.cancelAnimationFrame(id);
  }, [question]);

  if (question === null) return null;

  return (
    <div className="palette-scrim" role="presentation">
      <div
        aria-labelledby="megamud-question-title"
        aria-modal="true"
        className="surface reset-prompt"
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return;
          event.preventDefault();
          onAnswer(false);
        }}
        role="dialog"
      >
        <h2 id="megamud-question-title">{t('megamud.question.title', { name: characterName })}</h2>
        {question.split('\n').map((line, index) => (
          <p className="settings-warn" key={index}>
            {line}
          </p>
        ))}
        <div className="reset-actions">
          <button
            className="quiet"
            onClick={() => onAnswer(false)}
            onMouseDown={keepFocus}
            ref={no}
            type="button"
          >
            {t('megamud.question.no')}
          </button>
          <button onClick={() => onAnswer(true)} onMouseDown={keepFocus} type="button">
            {t('megamud.question.yes')}
          </button>
        </div>
      </div>
    </div>
  );
}
