import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.jsx';
import { openIdbStore, requestPersistentStorage } from './storage/idbStore.js';
import { createApi } from './sync/syncApi.js';
import { createAppState } from './sync/appState.js';

async function boot() {
  const root = createRoot(document.getElementById('root'));
  try {
    const store = await openIdbStore();
    const api = createApi({ baseUrl: import.meta.env.VITE_API_URL || 'http://localhost:4000' });
    const app = createAppState({ store, api });
    app.start();
    requestPersistentStorage();
    root.render(<StrictMode><App app={app} /></StrictMode>);
    if ('serviceWorker' in navigator && import.meta.env.PROD) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
  } catch (err) {
    console.error(err);
    root.render(<p className="fatal">This browser cannot store reports offline (private mode may block it). Open the app in a normal browser window.</p>);
  }
}
boot();
