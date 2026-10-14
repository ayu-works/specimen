import React from 'react';
import ReactDOM from 'react-dom/client';
import '@/assets/tailwind.css';
import { startChatScrub } from '@/lib/chatScrub';
import { recoverMobileCapture } from '@/lib/tabEmulation';
import App from './App';

// Undo a mobile capture a closed or reloaded panel left half done (phone override, popup).
void recoverMobileCapture();
// Arm the chat gate before any view's effect runs (child effects run before App's); not in demo mode.
if (new URLSearchParams(location.search).get('demo') !== '1') void startChatScrub();

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
