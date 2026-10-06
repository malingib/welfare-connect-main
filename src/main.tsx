import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom';
import { StrictMode } from 'react';
import App from './App.tsx'
import './index.css'
import { ReactQueryProvider } from './providers/ReactQueryProvider'
import { suppressBrowserExtensionNoise } from './utils/suppressBrowserExtensionNoise'

suppressBrowserExtensionNoise();

const root = createRoot(document.getElementById("root")!);

// Recover deep-link route when host serves 404.html for SPA paths.
try {
  const redirectedPath = sessionStorage.getItem("spa_redirect_path");
  if (redirectedPath) {
    sessionStorage.removeItem("spa_redirect_path");
    if (redirectedPath !== window.location.pathname) {
      window.history.replaceState(null, "", redirectedPath);
    }
  }
} catch (error) {
  // Non-blocking fallback; app should still boot.
}

root.render(
  <StrictMode>
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <ReactQueryProvider>
        <App />
      </ReactQueryProvider>
    </BrowserRouter>
  </StrictMode>
);
