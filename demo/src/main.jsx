import React from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { setupTheme, syncThemeLabels } from './theme.js'

setupTheme()

// Web component with an OPEN shadow root (selection boundary probe).
class DemoCard extends HTMLElement {
  connectedCallback() {
    const sh = this.attachShadow({ mode: 'open' })
    sh.innerHTML = `
      <div style="border:1px solid var(--line,#e4e4e7);border-radius:10px;padding:12px">
        <b>edge-metrics-card</b>
        <p style="color:var(--muted,#71717a);margin:6px 0">Button inside an open shadow root.</p>
        <button class="primary">Ping edge</button>
      </div>`
  }
}
customElements.define('demo-card', DemoCard)

createRoot(document.getElementById('root')).render(<App />)

// Topbar labels exist only after mount.
syncThemeLabels()
