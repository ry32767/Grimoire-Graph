import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles/index.css'

const rootEl = document.getElementById('root')
if (!rootEl) throw new Error('#root が見つかりません')

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
