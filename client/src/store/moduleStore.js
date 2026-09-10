import { create } from "zustand";
import { persist } from "zustand/middleware";
import { ALL_MODULES } from "../constants/modules";

/**
 * Which modules the logged-in user's organisation may use.
 *
 * Set from the login response and refreshed by /auth/me. An empty list means
 * "not loaded yet" rather than "nothing enabled", so the UI falls back to
 * showing everything and lets the server refuse what is not allowed — that way
 * a stale or missing list never locks someone out of their own product.
 */
export const useModuleStore = create(
  persist(
    (set, get) => ({
      modules: [],

      setModules: (modules) =>
        set({ modules: Array.isArray(modules) ? modules : [] }),

      clearModules: () => set({ modules: [] }),

      hasModule: (key) => {
        const { modules } = get();
        if (!modules || modules.length === 0) return true; // not loaded yet
        return modules.includes(key);
      },
    }),
    {
      name: "module-storage",
    }
  )
);

/**
 * Read the module list outside React (route guards, plain helpers).
 */
export const getModules = () => {
  const { modules } = useModuleStore.getState();
  return modules && modules.length > 0 ? modules : ALL_MODULES;
};

export const hasModule = (key) => getModules().includes(key);
