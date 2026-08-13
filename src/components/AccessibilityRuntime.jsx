import { useEffect, useRef } from 'react';

export default function AccessibilityRuntime({ pageTitle }) {
  const previousTitleRef = useRef('');

  useEffect(() => {
    const title = pageTitle ? `${pageTitle} · RTB OS` : 'RTB OS';
    document.title = title;

    if (previousTitleRef.current && previousTitleRef.current !== pageTitle) {
      const main = document.getElementById('main-content');
      const keyboardMode = document.documentElement.dataset.inputMode === 'keyboard';
      if (keyboardMode && main) {
        window.setTimeout(() => main.focus({ preventScroll: false }), 60);
      }
    }
    previousTitleRef.current = pageTitle;
  }, [pageTitle]);

  useEffect(() => {
    function onKeyboard(event) {
      if (['Tab', 'ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Enter', ' '].includes(event.key)) {
        document.documentElement.dataset.inputMode = 'keyboard';
      }
    }

    function onPointer() {
      document.documentElement.dataset.inputMode = 'pointer';
    }

    window.addEventListener('keydown', onKeyboard, true);
    window.addEventListener('pointerdown', onPointer, true);
    return () => {
      window.removeEventListener('keydown', onKeyboard, true);
      window.removeEventListener('pointerdown', onPointer, true);
    };
  }, []);

  return (
    <div className="sr-only" aria-live="polite" aria-atomic="true" role="status">
      {pageTitle ? `${pageTitle} page loaded` : 'RTB OS loaded'}
    </div>
  );
}
