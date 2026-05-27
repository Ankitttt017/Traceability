import { useEffect, useRef, useState } from "react";

const SafeChart = ({ height = 220, children, style = {} }) => {
  const hostRef = useRef(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!hostRef.current) return;
    const el = hostRef.current;
    const check = () => {
      const w = Math.floor(el.clientWidth || 0);
      const h = Math.floor(el.clientHeight || 0);
      setReady(w > 1 && h > 1);
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={hostRef} style={{ height, width: "100%", minWidth: 1, minHeight: 1, ...style }}>
      {ready ? children : null}
    </div>
  );
};

export default SafeChart;
