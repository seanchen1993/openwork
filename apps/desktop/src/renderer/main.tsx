// Type declarations for main process log forwarding
declare global {
  interface Window {
    __mainProcessLogs: Array<{ type: string; message: string; timestamp: number }>;
  }
}

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App';
import './styles/globals.css';

// Initialize main process log viewer
// This shows logs from the Electron main process in DevTools console
window.__mainProcessLogs = [];

// Override console.log to show main process logs with prefix
const originalLog = console.log;
const originalError = console.error;
const originalWarn = console.warn;

function showMainProcessLogs(): void {
  for (const log of window.__mainProcessLogs) {
    const prefix = `[Main Process ${log.type.toUpperCase()}]`;
    const message = `${prefix} ${log.message}`;
    if (log.type === 'error') {
      originalError(message);
    } else if (log.type === 'warn') {
      originalWarn(message);
    } else {
      originalLog(message);
    }
  }
  // Clear after showing
  window.__mainProcessLogs = [];
}

// Poll for new logs every 100ms
setInterval(showMainProcessLogs, 100);

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root element not found');
}

const root = createRoot(container);
root.render(
  <StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </StrictMode>
);
