import { create } from "zustand";

const STORAGE_KEY = "roster-appearance";
const media = window.matchMedia("(prefers-color-scheme: dark)");
const validTheme = (value) => ["light", "dark", "system"].includes(value);
function readPreference() {
  try { const saved = localStorage.getItem(STORAGE_KEY); return validTheme(saved) ? saved : "system"; }
  catch { return "system"; }
}
function applyTheme(preference) {
  const resolved = preference === "system" ? (media.matches ? "dark" : "light") : preference;
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", resolved === "dark" ? "#161513" : "#f7f6f3");
  return resolved;
}
const preference = readPreference();
export const useThemeStore = create((set) => ({
  preference,
  resolved: applyTheme(preference),
  setTheme: (value) => {
    if (!validTheme(value)) return;
    try { localStorage.setItem(STORAGE_KEY, value); } catch { /* Theme still works without storage. */ }
    set({ preference: value, resolved: applyTheme(value) });
  },
}));
const onSystemChange = () => {
  if (useThemeStore.getState().preference === "system") useThemeStore.setState({ resolved: applyTheme("system") });
};
const onStorage = (event) => {
  if (event.key === STORAGE_KEY || event.key === null) {
    const next = readPreference();
    useThemeStore.setState({ preference: next, resolved: applyTheme(next) });
  }
};
media.addEventListener("change", onSystemChange);
window.addEventListener("storage", onStorage);
if (import.meta.hot) import.meta.hot.dispose(() => {
  media.removeEventListener("change", onSystemChange);
  window.removeEventListener("storage", onStorage);
});
