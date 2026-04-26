import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ShellProvider } from './context/ShellContext';
import App from './App';
import { ScrollToTop } from './components/layout/ScrollToTop';
import '../../styles.css';
import './app.css';
import './styles/hanime-theme.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <ShellProvider>
        <ScrollToTop />
        <App />
      </ShellProvider>
    </BrowserRouter>
  </React.StrictMode>
);

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
