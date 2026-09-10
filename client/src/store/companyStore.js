import { create } from "zustand";
import { persist } from "zustand/middleware";

export const DEFAULT_SETTINGS = {
  dateFormat: "DD/MM/YYYY",
  timeFormat: "24h",
  currency: "AUD",
  language: "en",
};

/**
 * The logged-in user's organisation and its display settings.
 *
 * Loaded from /companies/me when a layout mounts, and read by lib/format.js so
 * dates and times are shown the way the organisation asked for them.
 */
export const useCompanyStore = create(
  persist(
    (set) => ({
      organisation: null,
      settings: { ...DEFAULT_SETTINGS },

      setOrganisation: (company) =>
        set({
          organisation: company
            ? {
                id: company._id || company.id,
                name: company.name,
                timezone: company.timezone,
              }
            : null,
          settings: { ...DEFAULT_SETTINGS, ...(company?.settings || {}) },
        }),

      clearOrganisation: () =>
        set({ organisation: null, settings: { ...DEFAULT_SETTINGS } }),
    }),
    {
      name: "company-storage",
    }
  )
);

export const getCompanySettings = () => {
  const { settings } = useCompanyStore.getState();
  return { ...DEFAULT_SETTINGS, ...(settings || {}) };
};
