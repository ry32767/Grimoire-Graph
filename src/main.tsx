import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles/tokens.css'
import './styles/index.css'
// 詠唱コンソール・読み出しストリップ・作図台・見返しバー（DC プロトタイプ v3 の移植分）
import './styles/console.css'

const rootEl = document.getElementById('root')
if (!rootEl) throw new Error('#root が見つかりません')

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
