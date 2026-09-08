// Unobtrusive progress bar for the initial data loads (and later refreshes).
import { $ } from "./util.js";

const tasks = new Map(); // name → { done }
let hideTimer = null;

export function track(name, promise) {
  tasks.set(name, { done: false });
  render();
  const finish = () => { const t = tasks.get(name); if (t) t.done = true; render(); };
  return Promise.resolve(promise).then((v) => { finish(); return v; }, (e) => { finish(); throw e; });
}

function render() {
  const bar = $("loadbar"), fill = $("loadbar-fill"), text = $("loadbar-text");
  if (!bar) return;
  const all = [...tasks.entries()];
  const done = all.filter(([, t]) => t.done).length;
  const pending = all.filter(([, t]) => !t.done).map(([n]) => n);
  clearTimeout(hideTimer);
  if (!pending.length) {
    fill.style.width = "100%";
    text.textContent = "";
    hideTimer = setTimeout(() => { bar.classList.remove("on"); tasks.clear(); fill.style.width = "0%"; }, 600);
    return;
  }
  bar.classList.add("on");
  fill.style.width = `${Math.max(6, Math.round((100 * done) / all.length))}%`;
  text.textContent = `Loading ${pending.slice(0, 3).join(", ")}${pending.length > 3 ? ` +${pending.length - 3}` : ""}…`;
}
