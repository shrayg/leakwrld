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

class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    // Keep this in console so local debugging still has stack context.
    console.error('[ui] React render crash', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            minHeight: '100vh',
            display: 'grid',
            placeItems: 'center',
            padding: '24px',
            background: '#212121',
            color: '#f5f5f5',
            fontFamily: 'Whitney, Arial, sans-serif',
            textAlign: 'center',
          }}
        >
          <div>
            <h1 style={{ margin: '0 0 10px', fontSize: '22px' }}>UI failed to load</h1>
            <p style={{ margin: '0 0 16px', color: '#cfcfcf' }}>
              A runtime error stopped the app from rendering.
            </p>
            <p style={{ margin: '0 0 20px', color: '#ff8a8a', fontSize: '13px' }}>
              {String(this.state.error?.message || this.state.error || 'Unknown error')}
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{
                border: '1px solid #666',
                background: '#2e2e2e',
                color: '#fff',
                padding: '10px 16px',
                borderRadius: '6px',
                cursor: 'pointer',
              }}
            >
              Reload page
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function RuntimeCrashBanner() {
  const [fatalErr, setFatalErr] = React.useState('');

  React.useEffect(() => {
    function onErr(event) {
      const msg = event?.error?.message || event?.message || 'Unknown runtime error';
      setFatalErr(String(msg));
    }
    function onRejection(event) {
      const reason = event?.reason;
      const msg = typeof reason === 'string' ? reason : reason?.message || 'Unhandled promise rejection';
      setFatalErr(String(msg));
    }
    window.addEventListener('error', onErr);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onErr);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);

  if (!fatalErr) return null;

  return (
    <div
      style={{
        position: 'fixed',
        left: '12px',
        right: '12px',
        bottom: '12px',
        zIndex: 2147483647,
        padding: '10px 12px',
        borderRadius: '8px',
        border: '1px solid rgba(255,80,80,0.6)',
        background: 'rgba(20,0,0,0.92)',
        color: '#ffd0d0',
        fontSize: '12px',
        fontFamily: 'monospace',
      }}
    >
      Runtime error: {fatalErr}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <BrowserRouter>
        <ShellProvider>
          <SupabaseAuthProvider>
            <RuntimeCrashBanner />
            <ScrollToTop />
            <App />
          </SupabaseAuthProvider>
        </ShellProvider>
      </BrowserRouter>
    </AppErrorBoundary>
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
