import React from 'react';
import ReactDOM from 'react-dom/client';
import '@/assets/tailwind.css';
import { recoverMobileCapture } from '@/lib/tabEmulation';
import App from './App';

// Undo a mobile capture a closed or reloaded panel left half done (phone override, popup).
void recoverMobileCapture();

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
