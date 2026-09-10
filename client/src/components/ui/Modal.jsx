import { createContext, useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useOverlay } from "../../hooks/useOverlay";

const ModalDepth = createContext(0);

// Keep dialogs outside page stacking contexts, including nested map dialogs.
export default function Modal({ children, onClose, label, className = "" }) {
  const ref = useRef(null);
  const depth = useContext(ModalDepth);
  const [target, setTarget] = useState(() => document.fullscreenElement || document.body);
  useEffect(() => {
    const updateTarget = () => setTarget(document.fullscreenElement || document.body);
    document.addEventListener("fullscreenchange", updateTarget);
    return () => document.removeEventListener("fullscreenchange", updateTarget);
  }, []);
  useOverlay(true, onClose, ref);

  return createPortal(
    <ModalDepth.Provider value={depth + 1}>
      <div className={`modal-layer modal-scrim ${className}`} style={{ zIndex: 1100 + depth * 10 }}>
        <div ref={ref} className="modal-container" role="dialog" aria-modal="true" aria-label={label} tabIndex={-1}>
          {children}
        </div>
      </div>
    </ModalDepth.Provider>,
    target,
  );
}
