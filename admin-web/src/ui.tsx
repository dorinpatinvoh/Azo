import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

/* ---------- Petits composants ---------- */

export function Badge({ tone = "", children }: { tone?: string; children: React.ReactNode }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

export function Spinner() {
  return (
    <div className="center">
      <span className="spinner" />
    </div>
  );
}

export function ErrorBox({ error, onRetry }: { error: string | null; onRetry?: () => void }) {
  if (!error) return null;
  return (
    <div className="errbox">
      {error}
      {onRetry ? (
        <>
          {" "}
          <a href="#" onClick={(e) => { e.preventDefault(); onRetry(); }}>Réessayer</a>
        </>
      ) : null}
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function PageHead({ title, subtitle, children }: { title: string; subtitle?: string; children?: React.ReactNode }) {
  return (
    <div className="pagehead">
      <div>
        <h1>{title}</h1>
        {subtitle ? <p>{subtitle}</p> : null}
      </div>
      <div className="row">{children}</div>
    </div>
  );
}

export function Stat({ value, label, hero }: { value: React.ReactNode; label: string; hero?: boolean }) {
  return (
    <div className={`card stat ${hero ? "hero" : ""}`}>
      <span className="v">{value}</span>
      <span className="l">{label}</span>
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
      {hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
}

/* ---------- Fenêtre ---------- */

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="modalback" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? "wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

/** Fenêtre de confirmation, avec un motif facultatif ou obligatoire. */
export function ConfirmModal(props: {
  title: string;
  message?: React.ReactNode;
  confirmLabel: string;
  danger?: boolean;
  reasonLabel?: string;
  reasonRequired?: boolean;
  reasonMin?: number;
  onConfirm: (reason: string) => Promise<void> | void;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const min = props.reasonRequired ? props.reasonMin ?? 5 : 0;
  const tooShort = props.reasonLabel !== undefined && reason.trim().length < min;

  async function go() {
    setBusy(true);
    setError(null);
    try {
      await props.onConfirm(reason.trim());
      props.onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Opération impossible");
      setBusy(false);
    }
  }

  return (
    <Modal title={props.title} onClose={props.onClose}>
      {props.message ? <div className="muted" style={{ marginBottom: 14 }}>{props.message}</div> : null}
      {props.reasonLabel !== undefined ? (
        <Field label={props.reasonLabel} hint={props.reasonRequired ? `${min} caractères minimum` : "Facultatif"}>
          <textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
        </Field>
      ) : null}
      <ErrorBox error={error} />
      <div className="actions">
        <button className="btn ghost" onClick={props.onClose} disabled={busy}>Annuler</button>
        <button className={`btn ${props.danger ? "danger" : ""}`} onClick={go} disabled={busy || tooShort}>
          {busy ? "…" : props.confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

/* ---------- Message de retour ---------- */

type Toast = { text: string; bad?: boolean } | null;
const ToastCtx = createContext<(text: string, bad?: boolean) => void>(() => undefined);
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<Toast>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = useCallback((text: string, bad?: boolean) => {
    setToast({ text, bad });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 4000);
  }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {toast ? <div className={`toast ${toast.bad ? "bad" : ""}`}>{toast.text}</div> : null}
    </ToastCtx.Provider>
  );
}

/* ---------- Chargement de données ---------- */

export function useLoad<T>(loader: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);

  const reload = useCallback(async () => {
    const mine = ++seq.current;
    setLoading(true);
    try {
      const result = await loader();
      if (mine === seq.current) {
        setData(result);
        setError(null);
      }
    } catch (e) {
      if (mine === seq.current) setError(e instanceof Error ? e.message : "Chargement impossible");
    } finally {
      if (mine === seq.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    reload();
  }, [reload]);

  return { data, error, loading, reload, setData };
}

/** Copie un texte dans le presse-papiers (avec repli pour les navigateurs sans autorisation). */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}
