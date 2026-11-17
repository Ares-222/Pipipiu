import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { initTelegram } from './tg';
import './styles.css';
import { renderCardJpeg } from './card/card';
import { makePdf } from './pdf/makePdf';

initTelegram();

// test hook (used by sandbox smoke tests; harmless in production)
(window as unknown as Record<string, unknown>).__ares = { renderCardJpeg, makePdf };
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
