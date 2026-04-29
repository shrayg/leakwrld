import { useEffect, useId, useRef } from 'react';
import { useAgeGate } from '../../hooks/useAgeGate';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

export function AgeGateModal() {
  const { isOpen, accept } = useAgeGate();
  const dialogTitleId = useId();
  const dialogDescriptionId = useId();
  const modalRef = useRef(null);
  const enterButtonRef = useRef(null);
  const previousFocusedElementRef = useRef(null);

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    previousFocusedElementRef.current = document.activeElement;
    document.body.style.overflow = 'hidden';
    enterButtonRef.current?.focus();

    const onKeyDown = (event) => {
      if (event.key !== 'Tab' || !modalRef.current) {
        return;
      }

      const focusableElements = Array.from(
        modalRef.current.querySelectorAll(FOCUSABLE_SELECTOR),
      );
      if (focusableElements.length === 0) {
        return;
      }

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];
      const activeElement = document.activeElement;

      if (event.shiftKey && activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
      } else if (!event.shiftKey && activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = '';
      previousFocusedElementRef.current?.focus?.();
    };
  }, [isOpen]);

  if (!isOpen) {
    return null;
  }

  return (
    <div
      className="age-gate-overlay"
      role="presentation"
    >
      <section
        ref={modalRef}
        className="age-gate-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={dialogTitleId}
        aria-describedby={dialogDescriptionId}
      >
        <p className="age-gate-kicker">
          Age Verification
        </p>
        <h2 id={dialogTitleId} className="age-gate-title">
          Adults Only (18+)
        </h2>
        <p id={dialogDescriptionId} className="age-gate-description">
          This website contains explicit adult content and is only available to users who are 18 years
          of age or older. By entering, you confirm you meet this requirement and that viewing this
          material is legal in your location.
        </p>
        <ul className="age-gate-list">
          <li className="age-gate-list-item">
            You are at least 18 years old.
          </li>
          <li className="age-gate-list-item">
            You understand this site may include explicit sexual content.
          </li>
          <li className="age-gate-list-item">
            You are responsible for compliance with local laws.
          </li>
        </ul>
        <div className="age-gate-actions">
          <button
            ref={enterButtonRef}
            type="button"
            className="pw-btn pw-btn--block age-gate-enter-btn"
            onClick={accept}
          >
            I am 18+ — Enter Site
          </button>
        </div>
      </section>
    </div>
  );
}
