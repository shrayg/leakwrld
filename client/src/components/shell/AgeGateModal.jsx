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
  const leaveButtonRef = useRef(null);
  const previousFocusedElementRef = useRef(null);

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    previousFocusedElementRef.current = document.activeElement;
    document.body.style.overflow = 'hidden';
    enterButtonRef.current?.focus();

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        leaveSite();
        return;
      }

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

  function leaveSite() {
    window.location.replace('https://www.google.com');
  }

  return (
    <div
      className="fixed inset-0 z-[10000] grid place-items-center bg-[radial-gradient(90%_90%_at_50%_100%,color-mix(in_srgb,var(--color-primary)_20%,transparent)_0%,transparent_55%),rgba(9,10,14,0.84)] px-4 py-[max(16px,env(safe-area-inset-top,0px))] pb-[max(16px,env(safe-area-inset-bottom,0px))] backdrop-blur-[10px]"
      role="presentation"
    >
      <section
        ref={modalRef}
        className="max-h-[min(92dvh,780px)] w-full max-w-[560px] overflow-auto rounded-2xl border border-[color-mix(in_srgb,var(--color-primary)_28%,transparent)] bg-[linear-gradient(170deg,rgba(22,23,28,0.98),rgba(12,13,18,0.98))] p-[clamp(20px,3vw,30px)] shadow-[0_26px_60px_rgba(0,0,0,0.55),inset_0_0_0_1px_rgba(255,255,255,0.03)] max-sm:rounded-[14px] max-sm:px-[14px] max-sm:py-[max(18px,env(safe-area-inset-top,0px))]"
        role="dialog"
        aria-modal="true"
        aria-labelledby={dialogTitleId}
        aria-describedby={dialogDescriptionId}
      >
        <p className="mb-[10px] text-xs font-bold uppercase tracking-[0.1em] text-primary-soft">
          Age Verification
        </p>
        <h2 id={dialogTitleId} className="mb-3 text-[clamp(1.45rem,2.8vw,2rem)] leading-[1.15]">
          Adults Only (18+)
        </h2>
        <p id={dialogDescriptionId} className="m-0 leading-[1.6] text-white/75">
          This website contains explicit adult content and is only available to users who are 18 years
          of age or older. By entering, you confirm you meet this requirement and that viewing this
          material is legal in your location.
        </p>
        <ul className="mt-[18px] grid list-none gap-[9px] p-0">
          <li className="relative pl-[18px] text-white/80 before:absolute before:left-0 before:top-[9px] before:h-2 before:w-2 before:rounded-full before:bg-[linear-gradient(180deg,var(--color-pink-soft)_0%,var(--color-primary)_100%)]">
            You are at least 18 years old.
          </li>
          <li className="relative pl-[18px] text-white/80 before:absolute before:left-0 before:top-[9px] before:h-2 before:w-2 before:rounded-full before:bg-[linear-gradient(180deg,var(--color-pink-soft)_0%,var(--color-primary)_100%)]">
            You understand this site may include explicit sexual content.
          </li>
          <li className="relative pl-[18px] text-white/80 before:absolute before:left-0 before:top-[9px] before:h-2 before:w-2 before:rounded-full before:bg-[linear-gradient(180deg,var(--color-pink-soft)_0%,var(--color-primary)_100%)]">
            You are responsible for compliance with local laws.
          </li>
        </ul>
        <div className="mt-[22px] grid gap-[10px]">
          <button
            ref={enterButtonRef}
            type="button"
            className="min-h-[46px] w-full rounded-[10px] border border-[color-mix(in_srgb,var(--color-primary)_50%,transparent)] bg-[linear-gradient(180deg,var(--color-pink-soft)_0%,var(--color-primary)_100%)] px-[14px] text-sm font-bold uppercase tracking-[0.03em] text-[#1d161d] shadow-[0_8px_20px_color-mix(in_srgb,var(--color-primary)_26%,transparent)] transition-[transform,filter] duration-150 hover:-translate-y-px hover:brightness-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color-mix(in_srgb,var(--color-primary)_75%,transparent)] max-sm:min-h-11 max-sm:text-[13px]"
            onClick={accept}
          >
            I am 18+ - Enter Site
          </button>
          <button
            ref={leaveButtonRef}
            type="button"
            className="min-h-[46px] w-full rounded-[10px] border border-[color-mix(in_srgb,var(--color-primary)_24%,transparent)] bg-[color-mix(in_srgb,var(--color-bg-elevated)_80%,transparent)] px-[14px] text-sm font-bold uppercase tracking-[0.03em] text-white/90 transition-[border-color,background] duration-150 hover:border-[color-mix(in_srgb,var(--color-primary)_40%,transparent)] hover:bg-[color-mix(in_srgb,var(--color-primary)_14%,var(--color-bg-elevated))] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color-mix(in_srgb,var(--color-primary)_75%,transparent)] max-sm:min-h-11 max-sm:text-[13px]"
            onClick={leaveSite}
          >
            Leave Site
          </button>
        </div>
        <p className="mt-[14px] text-xs text-white/50">Press Esc to leave this site.</p>
      </section>
    </div>
  );
}
