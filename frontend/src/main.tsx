import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import ToastHost from './components/ToastHost';
import { initSentry } from './lib/sentry';
import { initAnalytics } from './lib/analytics';
import './styles/index.css';

initSentry();
initAnalytics();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>
      <App />
      <ToastHost />
    </ErrorBoundary>
  </React.StrictMode>
);
