import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import './index.css';

// Guard against unhandled DOM Event errors (e.g. { isTrusted: true } from media/resource errors)
if (typeof window !== "undefined") {
  window.addEventListener("error", (event: ErrorEvent) => {
    // If the error is a resource load error (like <img> or <video> or <iframe>), prevent it from crashing the app
    if (event.target && (event.target instanceof HTMLImageElement || event.target instanceof HTMLVideoElement || event.target instanceof HTMLScriptElement)) {
      event.preventDefault();
      return;
    }
  }, true);

  window.addEventListener("unhandledrejection", (event: PromiseRejectionEvent) => {
    // If the rejection reason is a DOM Event object, prevent default uncaught logging
    if (event.reason && typeof event.reason === "object" && "isTrusted" in event.reason) {
      event.preventDefault();
      return;
    }
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
