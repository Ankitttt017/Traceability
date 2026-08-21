import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import ThemeProvider from "./context/ThemeProvider";
import { registerSW } from 'virtual:pwa-register';

if (import.meta.env.PROD) {
  registerSW({ immediate: true });
} else if ("serviceWorker" in navigator) {
  navigator.serviceWorker.getRegistrations()
    .then((registrations) => Promise.all(registrations.map((registration) => registration.unregister())))
    .catch(() => {});
}

// Suppress benign React 18 flushSync development warnings caused by @tanstack/react-virtual
const originalError = console.error;
console.error = (...args) => {
  if (typeof args[0] === "string" && args[0].includes("flushSync was called from inside a lifecycle method")) {
    return;
  }
  originalError(...args);
};

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </StrictMode>,
)
