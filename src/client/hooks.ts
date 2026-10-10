import { useEffect, useRef, useState } from "react";
import { useStore } from "./store";

/** Milliseconds left until a server deadline, updated a few times a second. */
export function useCountdown(deadline: number | null): number | null {
  const clockOffset = useStore((s) => s.clockOffset);
  const [, setFrame] = useState(0);
  useEffect(() => {
    if (deadline === null) return;
    const interval = setInterval(() => setFrame((n) => n + 1), 100);
    return () => clearInterval(interval);
  }, [deadline]);
  return deadline === null ? null : Math.max(0, deadline - (Date.now() + clockOffset));
}

/** The value from the previous render, for spotting changes worth animating. */
export function usePrevious<T>(value: T): T | undefined {
  const ref = useRef<T | undefined>(undefined);
  const previous = ref.current;
  useEffect(() => {
    ref.current = value;
  });
  return previous;
}
