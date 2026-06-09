import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

console.log('[cqrcfg-ui] client runtime config:', {
  BASE_PATH: window.__CQRCFG_BASE_PATH__,
  API_URL: window.__CQRCFG_API_URL__,
  ENV: window.__CQRCFG_ENV__,
  location: window.location.href,
});

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
