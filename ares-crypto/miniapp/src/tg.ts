// Telegram WebApp SDK wrapper (spec §15/§16: BackButton, haptics, viewport).

interface TgWebApp {
  initData: string;
  initDataUnsafe: { user?: { id: number; first_name?: string; username?: string }; start_param?: string };
  ready(): void;
  expand(): void;
  setHeaderColor(color: string): void;
  setBackgroundColor(color: string): void;
  BackButton: { show(): void; hide(): void; onClick(cb: () => void): void; offClick(cb: () => void): void };
  HapticFeedback: { impactOccurred(style: string): void };
  viewportStableHeight?: number;
  onEvent(event: string, cb: () => void): void;
  openTelegramLink(url: string): void;
  openLink(url: string): void;
}

declare global {
  interface Window { Telegram?: { WebApp: TgWebApp }; ARES_CONFIG?: { apiBase: string }; }
}

export function webApp(): TgWebApp | undefined {
  return window.Telegram?.WebApp;
}

export function initTelegram(): void {
  const app = webApp();
  if (!app) return;
  app.ready();
  app.expand();
  try {
    app.setHeaderColor('#0A0A0B');
    app.setBackgroundColor('#0A0A0B');
  } catch { /* older clients */ }
  app.onEvent('viewportChanged', () => { /* keyboard handling: content scrolls naturally */ });
}

export function initData(): string {
  return webApp()?.initData ?? '';
}

export function haptic(): void {
  try { webApp()?.HapticFeedback.impactOccurred('light'); } catch { /* ignore */ }
}

export function onBackButton(cb: (() => void) | null): void {
  const app = webApp();
  if (!app) return;
  if (cb) { app.BackButton.onClick(cb); app.BackButton.show(); }
  else { app.BackButton.hide(); }
}

export function openLink(url: string): void {
  webApp()?.openLink(url);
}
