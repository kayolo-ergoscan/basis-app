// Reduced motion (VISUAL §10): the shell's switch (OS setting, in-app "reduce", ?still). Every X-ray animation
// renders its final frame when it is on.

import { useEffect, useRef, useState, type RefObject } from "react";
export { useReducedMotion, prefersReducedMotion } from "@/ui/settings";

/** True once the element has been on screen (animations start only when someone can see them). */
export function useSeen<T extends Element>(): [RefObject<T>, boolean] {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    if (typeof IntersectionObserver === "undefined") {
      setSeen(true);
      return;
    }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setSeen(true);
        io.disconnect();
      }
    }, { threshold: 0.15 });
    io.observe(el);
    return () => io.disconnect();
  }, [seen]);
  return [ref, seen];
}
