// Theme system replicating the Gate84 admin provider exactly:
// window bubble-phase keydown, editable-target guard, plain 'd' toggles.
// The visible counter makes containment assertions exact.
const KEY = 'demo-theme';
const root = document.documentElement;

const apply = (t) => {
  root.classList.remove('light', 'dark');
  root.classList.add(t);
  const el = document.getElementById('theme-name');
  if (el) el.textContent = t;
};

let toggles = 0;
const renderCount = () => {
  const el = document.getElementById('theme-toggle-count');
  if (el) el.textContent = String(toggles);
};

const isEditableTarget = (target) => {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return !!target.closest("input, textarea, select, [contenteditable='true']");
};

export function setupTheme() {
  apply(localStorage.getItem(KEY) || 'light');
  toggles = Number(sessionStorage.getItem('demo-toggles') || 0);
  renderCount();

  window.addEventListener('keydown', (event) => {
    if (event.repeat) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (isEditableTarget(event.target)) return;
    if (event.key.toLowerCase() !== 'd') return;
    const next = root.classList.contains('dark') ? 'light' : 'dark';
    localStorage.setItem(KEY, next);
    apply(next);
    toggles++;
    sessionStorage.setItem('demo-toggles', String(toggles));
    renderCount();
  });
}

// Label sync once React has mounted the topbar (ids appear after render).
export function syncThemeLabels() {
  apply(root.classList.contains('dark') ? 'dark' : 'light');
  toggles = Number(sessionStorage.getItem('demo-toggles') || 0);
  renderCount();
}
