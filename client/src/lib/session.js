/**
 * Session storage keys and teardown
 *
 * Kept in one place so signing out, a rejected token and the master panel all
 * clear exactly the same things.
 */

const SESSION_KEYS = [
  "isAuthenticated",
  "token",
  "userRole",
  "userName",
  "userEmail",
  "auth-storage",
  "module-storage",
  "company-storage",
];

export const clearSession = () => {
  SESSION_KEYS.forEach((key) => {
    try {
      localStorage.removeItem(key);
    } catch {
      // Private browsing or blocked storage — nothing to clear
    }
  });
};

export default clearSession;
