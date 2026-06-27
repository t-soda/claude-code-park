import { useEffect } from "react";
import { useToastStore } from "../stores/toastStore";

/** Shown only while a message is set; auto-dismisses after 3 seconds. */
export function Toast() {
  const message = useToastStore((s) => s.message);
  const clear = useToastStore((s) => s.clear);

  useEffect(() => {
    if (!message) return;
    const id = setTimeout(clear, 3000);
    return () => clearTimeout(id);
  }, [message, clear]);

  if (!message) return null;
  return <div className="toast">{message}</div>;
}
