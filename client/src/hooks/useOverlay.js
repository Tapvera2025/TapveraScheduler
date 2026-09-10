import { useEffect, useRef } from "react";

const overlays = [];
let previousOverflow;

// Shared keyboard, focus and scroll behavior for drawers and modal dialogs.
export function useOverlay(open, onClose, containerRef) {
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement;
    const overlay = {};
    if (!overlays.length) previousOverflow = document.body.style.overflow;
    overlays.push(overlay);
    document.body.style.overflow = "hidden";
    const focusables = () => [...(containerRef.current?.querySelectorAll('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]') || [])].filter((el) => el.getClientRects().length > 0);
    const frame = requestAnimationFrame(() => {
      if (overlays.at(-1) === overlay) (focusables()[0] || containerRef.current)?.focus({ preventScroll: true });
    });
    const onKeyDown = (event) => {
      if (overlays.at(-1) !== overlay || event.defaultPrevented) return;
      if (event.key === "Escape") { event.preventDefault(); closeRef.current?.(); }
      if (event.key === "Tab") {
        const elements = focusables();
        const first = elements[0]; const last = elements.at(-1);
        if (!first) { event.preventDefault(); return; }
        if (event.shiftKey && (document.activeElement === first || !containerRef.current?.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || !containerRef.current?.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      cancelAnimationFrame(frame);
      const wasTop = overlays.at(-1) === overlay;
      overlays.splice(overlays.indexOf(overlay), 1);
      if (!overlays.length) document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
      if (wasTop && previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, [open, containerRef]);
}
