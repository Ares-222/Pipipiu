// Browser harness (esbuild entry): exposes card + pdf renderers over a report
// injected as window.__REPORT. Runs in Playwright chromium (headless).
// Fonts: makePdf fetches ./fonts/DejaVuSans.ttf — served by the local static server.

import { renderCardJpeg } from '../miniapp/src/card/card';
import { makePdf } from '../miniapp/src/pdf/makePdf';

declare const window: Record<string, unknown>;

window.__renderAll = async (): Promise<{ jpeg: string; pdf: string; err?: string }> => {
  try {
    const report = (window as { __REPORT?: unknown }).__REPORT as never;
    const jpeg = await renderCardJpeg(report);
    const pdf = await makePdf(report);
    return { jpeg, pdf };
  } catch (e) {
    return { jpeg: '', pdf: '', err: (e as Error).stack ?? (e as Error).message };
  }
};
