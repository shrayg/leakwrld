import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ShellProvider } from './context/ShellContext';
import { SupabaseAuthProvider } from './context/SupabaseAuthProvider';
import App from './App';
import { ScrollToTop } from './components/layout/ScrollToTop';
import '../../styles.css';
import './app.css';
import './styles/tailwind-phase1.css';
import './styles/pornwrld-theme.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <ShellProvider>
        <SupabaseAuthProvider>
          <ScrollToTop />
          <App />
        </SupabaseAuthProvider>
      </ShellProvider>
    </BrowserRouter>
  </React.StrictMode>
);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .getRegistrations()
      .then((registrations) => {
        registrations.forEach((registration) => {
          registration.unregister();
        });
      })
      .catch(() => {});
  });
}
