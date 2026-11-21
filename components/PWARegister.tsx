'use client';

import { useEffect } from 'react';
import { PWA_VERSION } from '@/lib/pwa/version';

/** Leave a trace on /debug, so an unexpected reload can be explained afterwards. */
function logToDebug(message: string) {
  try {
    const logs = JSON.parse(localStorage.getItem('expense-debug-logs') || '[]');
    logs.push({ timestamp: new Date().toISOString(), message, userAgent: navigator.userAgent });
    localStorage.setItem('expense-debug-logs', JSON.stringify(logs.slice(-200)));
  } catch {
    // ignore
  }
}

export default function PWARegister() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    // When a new service worker takes over, the page should reload so it gets
    // fresh HTML (and therefore correct JS chunk references) — but never under
    // the user's hands: a reload mid-form throws away an open modal. So:
    //  - a page with no controller yet is just being claimed by its first
    //    worker (clients.claim on install); its HTML is already current, skip.
    //  - otherwise reload only once the page is hidden (app switched away),
    //    so the user comes back to the new version instead of losing work.
    const hadController = !!navigator.serviceWorker.controller;
    let refreshing = false;
    const reloadNow = () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    };
    const reloadWhenHidden = () => {
      if (document.visibilityState === 'hidden') reloadNow();
    };

    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController) {
        logToDebug('[PWA] first service worker claimed the page (no reload)');
        return;
      }
      logToDebug('[PWA] new service worker active; reload deferred until the app is hidden');
      if (document.visibilityState === 'hidden') {
        reloadNow();
      } else {
        document.addEventListener('visibilitychange', reloadWhenHidden);
      }
    });

    let updateTimer: ReturnType<typeof setInterval> | undefined;

    navigator.serviceWorker
      .register(`/sw.js?v=${PWA_VERSION}`, { scope: '/' })
      .then((registration) => {
        console.log('[PWA] Service Worker registered:', registration);

        // If there is already a waiting worker (installed but not yet active),
        // tell it to skip waiting so it activates immediately.
        if (registration.waiting) {
          registration.waiting.postMessage({ type: 'SKIP_WAITING' });
        }

        // Watch for a newly installed worker becoming "waiting".
        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          if (!newWorker) return;
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              // New version ready — tell it to activate now.
              newWorker.postMessage({ type: 'SKIP_WAITING' });
            }
          });
        });

        // Proactively check for updates every minute so the PWA picks up
        // new deployments without the user having to reopen the app.
        updateTimer = setInterval(() => registration.update(), 60_000);
      })
      .catch((error) => {
        console.error('[PWA] Service Worker registration failed:', error);
      });

    return () => {
      if (updateTimer) clearInterval(updateTimer);
      document.removeEventListener('visibilitychange', reloadWhenHidden);
    };
  }, []);

  return null;
}
