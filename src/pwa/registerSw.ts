export function registerSagittaServiceWorker(
  onUpdateReady: (applyUpdate: () => void) => void
): () => void {
  const isProdBuild = Boolean(
    (import.meta as unknown as { env?: { PROD?: boolean } }).env?.PROD
  );
  if (
    !isProdBuild ||
    typeof window === 'undefined' ||
    !('serviceWorker' in navigator)
  ) {
    return () => {};
  }

  let disposed = false;
  let reloading = false;
  let registrationRef: ServiceWorkerRegistration | null = null;
  let updateCheckTimer: ReturnType<typeof setInterval> | null = null;

  const triggerApply = () => {
    const waiting = registrationRef?.waiting;
    if (waiting) {
      waiting.postMessage({ type: 'SKIP_WAITING' });
    } else {
      window.location.reload();
    }
  };

  const onControllerChange = () => {
    if (reloading) return;
    reloading = true;
    window.location.reload();
  };

  navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);

  const setup = async () => {
    try {
      const registration = await navigator.serviceWorker.register('/sw.js', {
        scope: '/'
      });
      if (disposed) return;
      registrationRef = registration;

      if (registration.waiting && navigator.serviceWorker.controller) {
        onUpdateReady(triggerApply);
      }

      registration.addEventListener('updatefound', () => {
        const installing = registration.installing;
        if (!installing) return;
        installing.addEventListener('statechange', () => {
          if (
            installing.state === 'installed' &&
            navigator.serviceWorker.controller &&
            !disposed
          ) {
            onUpdateReady(triggerApply);
          }
        });
      });

      updateCheckTimer = setInterval(() => {
        void registration.update().catch(() => {});
      }, 60 * 60 * 1000);
    } catch {
      // Service Worker non disponibile (es. anteprima HTTP non-localhost o contesto privato)
    }
  };

  void setup();

  return () => {
    disposed = true;
    if (updateCheckTimer !== null) {
      clearInterval(updateCheckTimer);
      updateCheckTimer = null;
    }
    navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
  };
}
