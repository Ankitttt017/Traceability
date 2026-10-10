import { useEffect, useRef, useState } from "react";

/**
 * true once the element has come near the viewport (stays true). Used to lazy-load below-the-fold sections.
 * rootMargin pre-loads a little before the section scrolls in.
 */
export default function useInView({ rootMargin = "300px 0px", disabled = false } = {}) {
  const ref = useRef(null);
  const [seen, setSeen] = useState(() => disabled || typeof IntersectionObserver === "undefined");
  useEffect(() => {
    if (seen || disabled) return undefined;
    const el = ref.current;
    if (!el) return undefined;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { setSeen(true); io.disconnect(); }
    }, { rootMargin });
    io.observe(el);
    return () => io.disconnect();
  }, [seen, disabled, rootMargin]);
  return [ref, seen || disabled];
}
