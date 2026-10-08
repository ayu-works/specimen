import { useEffect, useState } from 'react';

let push: (m: string) => void = () => {};
export function toast(message: string) {
  push(message);
}

export function Toaster() {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    push = (m) => {
      setMsg(m);
      clearTimeout(t);
      t = setTimeout(() => setMsg(null), 1500);
    };
    return () => clearTimeout(t);
  }, []);
  if (!msg) return null;
  return (
    <div
      role="status"
      className="fixed bottom-3 left-1/2 z-50 -translate-x-1/2 rounded-md bg-foreground px-3 py-1.5 text-xs text-background shadow-lg"
    >
      {msg}
    </div>
  );
}
