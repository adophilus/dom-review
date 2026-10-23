import React, { useRef, useState } from 'react'

const STATS = [
  { label: 'Requests (24h)', value: '4.21M', trend: '▲ 12.4%', dir: 'up' },
  { label: 'Error rate', value: '0.42%', trend: '▲ 0.08', dir: 'down' },
  { label: 'p99 latency', value: '212ms', trend: '▼ 18ms', dir: 'up' },
  { label: 'Active regions', value: '7', trend: '▲ 1', dir: 'up' },
]

const DEPLOYS = [
  { env: 'production', version: 'v2.14.0', status: 'healthy', pill: 'ok', deployed: '2h ago', action: 'Rollback' },
  { env: 'staging', version: 'v2.15.0-rc.2', status: 'healthy', pill: 'ok', deployed: '5h ago', action: 'Promote' },
  { env: 'staging', version: 'v2.15.0-rc.1', status: 'degraded', pill: 'warn', deployed: '1d ago', action: 'Promote' },
  { env: 'canary', version: 'v2.15.0-rc.2', status: 'failing', pill: 'err', deployed: '1d ago', action: 'Inspect' },
]

function Sidebar() {
  return (
    <aside id="sidebar-nav">
      <div className="brand">Aurora Console</div>
      <div className="brand-sub">widget-review demo target</div>
      <nav id="main-nav">
        <a href="#" className="active">Overview</a>
        <a href="#">Deployments</a>
        <a href="#">Logs</a>
        <a href="#">Settings</a>
      </nav>
      <div className="user-card" id="user-card">
        <div className="avatar">AK</div>
        <div>
          <div><b>Ada Kepler</b></div>
          <div style={{ color: 'var(--muted)', fontSize: 12 }}>Platform Admin</div>
        </div>
      </div>
    </aside>
  )
}

function TopBar() {
  return (
    <div className="topbar">
      <nav className="crumbs" aria-label="Breadcrumb">
        <ol>
          <li>Workspace</li>
          <li>Projects</li>
          <li>Aurora</li>
          <li aria-current="page">Overview</li>
        </ol>
      </nav>
      <div className="theme-status">
        theme: <b id="theme-name">light</b> · toggles: <b id="theme-toggle-count">0</b>
        <br />
        press <kbd>d</kbd> anywhere (ignored while typing)
      </div>
    </div>
  )
}

function Stats() {
  return (
    <div className="stats">
      {STATS.map((s) => (
        <div className="stat-card" key={s.label}>
          <dl>
            <dt>{s.label}</dt>
            <dd>{s.value}</dd>
            <dd className={'trend ' + s.dir}>{s.trend}</dd>
          </dl>
        </div>
      ))}
    </div>
  )
}

function Deployments() {
  return (
    <section className="block" id="deployments-block">
      <header>
        <h2>Deployments</h2>
        <button className="ghost" id="btn-view-all">View all</button>
      </header>
      <table id="deploy-table">
        <thead>
          <tr>
            <th>Environment</th><th>Version</th><th>Status</th><th>Deployed</th><th></th>
          </tr>
        </thead>
        <tbody>
          {DEPLOYS.map((d, i) => (
            <tr key={d.env + d.version + i}>
              <td>{d.env}</td>
              <td>{d.version}</td>
              <td><span className={'pill ' + d.pill}>{d.status}</span></td>
              <td>{d.deployed}</td>
              <td><button className="ghost">{d.action}</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

function TaskQueue() {
  const [count, setCount] = useState(2)
  const [generation, setGeneration] = useState(0)
  const addTask = () => {
    setCount((n) => n + 1)
    // New generation => all keys change => React recreates every node,
    // matching the original's full innerHTML replacement.
    setGeneration((g) => g + 1)
  }
  return (
    <section className="block" id="tasks-block">
      <header>
        <h2>Task queue</h2>
        <button className="primary" id="btn-add-task" onClick={addTask}>Add task</button>
      </header>
      <ul className="dyn-list" id="dyn-list">
        {Array.from({ length: count }, (_, i) => (
          <li key={generation + '-' + i}>
            <span>Task {String(i + 1).padStart(2, '0')} — provision staging cluster</span>
            <button className="ghost">Run</button>
          </li>
        ))}
      </ul>
      <p className="hint">"Add task" re-renders the whole list — good for testing selectors against fresh nodes.</p>
    </section>
  )
}

function ApiKeys() {
  return (
    <section className="block" id="api-keys-block">
      <header><h2>API keys</h2></header>
      <div className="form-grid">
        <div>
          <label htmlFor="key-name">Key name</label>
          <input type="text" id="key-name" placeholder="prod-rotate-key" />
        </div>
        <div>
          <label htmlFor="key-scope">Scope</label>
          <select id="key-scope">
            <option>read-only</option>
            <option>read-write</option>
            <option>admin</option>
          </select>
        </div>
        <div style={{ gridColumn: '1 / -1' }}>
          <label htmlFor="key-notes">Notes</label>
          <textarea id="key-notes" rows={2} placeholder="Type 'd' here — theme must NOT toggle" />
        </div>
        <div style={{ gridColumn: '1 / -1' }}>
          <label>Free-form editor (contenteditable)</label>
          <div className="editor" contentEditable={true} id="runbook-editor" suppressContentEditableWarning>
            Runbook: press <b>d</b> here too — still no toggle.
          </div>
        </div>
      </div>
    </section>
  )
}

function ShadowCorner() {
  return (
    <section className="block" id="shadow-block">
      <header><h2>Web component corner</h2></header>
      <p className="hint">The card below lives inside an <b>open</b> shadow root — a known selection boundary.</p>
      <demo-card />
    </section>
  )
}

function DeepFooter() {
  return (
    <footer id="page-footer">
      <div className="deep">
        <div>
          <div>
            <div>
              <div>
                <div id="deep-target">six levels deep — a long path chain for widen testing</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </footer>
  )
}

function InviteDialog() {
  const ref = useRef(null)
  return (
    <>
      <button id="btn-invite" onClick={() => ref.current && ref.current.showModal()}>Invite teammate</button>
      <dialog id="invite-dialog" ref={ref}>
        <h2 style={{ marginTop: 0 }}>Invite teammate</h2>
        <p style={{ color: 'var(--muted)' }}>They'll get read access to Aurora.</p>
        <input type="text" placeholder="teammate@company.com" style={{ marginBottom: 14 }} />
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button id="dialog-cancel" onClick={() => ref.current && ref.current.close()}>Cancel</button>
          <button className="primary" id="dialog-send">Send invite</button>
        </div>
      </dialog>
    </>
  )
}

export default function App() {
  return (
    <div className="app-shell" id="app-shell">
      <Sidebar />
      <main id="main-content">
        <TopBar />
        <h1 id="page-title">Overview</h1>
        <p className="lede">
          A deliberately busy admin dashboard. Select anything with Widget Review — deep chains,
          dynamic nodes, tables, forms, and a shadow-root corner case.
        </p>
        <div className="actions">
          <button className="primary" id="btn-deploy">Deploy to production</button>
          <InviteDialog />
          <button className="ghost" id="btn-docs">Read the docs</button>
        </div>
        <Stats />
        <Deployments />
        <TaskQueue />
        <ApiKeys />
        <ShadowCorner />
        <DeepFooter />
      </main>
    </div>
  )
}
