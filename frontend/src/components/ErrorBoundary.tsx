import { Component, ErrorInfo, ReactNode } from 'react';
import { captureException } from '../lib/sentry';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    captureException(error, { extra: { componentStack: info.componentStack } });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="crash-screen" role="alert">
          <div className="brand-mark" style={{ marginBottom: 16 }}>
            W
          </div>
          <h1>Something went wrong</h1>
          <p>WENET hit an unexpected error. Your messages are safe — reloading usually fixes this.</p>
          <button className="primary-btn" style={{ maxWidth: 200 }} onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
