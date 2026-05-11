import { Component } from 'react';
import { Link, useLocation } from 'react-router-dom';

class RouteErrorBoundaryInner extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('[route render error]', error, info);
  }

  componentDidUpdate(prevProps) {
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="lw-main mx-auto w-full max-w-[900px] px-4 pb-20 pt-[96px]">
        <section className="lw-page-head">
          <span className="lw-eyebrow">Page failed</span>
          <h1>Something went wrong</h1>
          <p>The page crashed while rendering. You can retry it, go home, or keep navigating without refreshing the tab.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" className="lw-btn primary" onClick={() => this.setState({ error: null })}>
              Retry page
            </button>
            <Link to="/" className="lw-btn ghost">
              Go home
            </Link>
          </div>
        </section>
      </main>
    );
  }
}

export function RouteErrorBoundary({ children }) {
  const location = useLocation();
  return (
    <RouteErrorBoundaryInner resetKey={`${location.pathname}${location.search}`}>
      {children}
    </RouteErrorBoundaryInner>
  );
}
