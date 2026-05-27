import logo from "../assets/images/logo.jpg";

// ─────────────────────────────────────────────
// Inline RICO wordmark — used when logo image
// is unavailable or as a fallback alongside it
// ─────────────────────────────────────────────
const RicoMark = () => (
  <div
    style={{
      display: "flex",
      flexDirection: "column",
      alignItems: "flex-start",
      gap: "1.5px",
      lineHeight: 1,
      userSelect: "none",
    }}
  >
    <span
      style={{
        fontFamily:
          "'Arial Black', 'Impact', 'Franklin Gothic Medium', sans-serif",
        fontWeight: 900,
        fontSize: "13px",
        color: "#1a3a7c",
        letterSpacing: "0.12em",
      }}
    >
      RICO
    </span>
    <span
      style={{
        display: "block",
        height: "2px",
        width: "100%",
        background: "linear-gradient(90deg, #c8191e 0%, #e8222a 100%)",
        borderRadius: "1px",
      }}
    />
  </div>
);

const Footer = () => {
  return (
    <footer
      className="
        bg-bg-card/40 backdrop-blur-xl
        border-t border-border/60
        py-2.5 px-6
      "
    >
      <div className="flex flex-col sm:flex-row items-center justify-between gap-2">

        {/* ── LEFT: copyright ── */}
        <div className="flex items-center gap-2.5">
          {/* red dot accent — mirrors the RICO brand colour */}
          <span
            style={{
              width: "4px",
              height: "4px",
              borderRadius: "50%",
              background: "#c8191e",
              opacity: 0.65,
              flexShrink: 0,
              display: "block",
            }}
          />
          <p className="text-xs text-text-muted">
            © 2026{" "}
            <span className="font-medium text-text-main">
              Rico Auto Industry
            </span>
            . All rights reserved.
          </p>
        </div>

        {/* ── RIGHT: developer credit + version ── */}
        <div className="flex items-center gap-2.5">

          <span className="text-[11px] text-text-muted tracking-wide">
            Developed by
          </span>

          {/* thin divider */}
          <span
            style={{
              display: "block",
              width: "0.5px",
              height: "14px",
              background: "var(--color-border-secondary, rgba(0,0,0,0.15))",
            }}
          />

          {/* Logo: real image with CSS wordmark fallback via onError */}
          <img
            src={logo}
            alt="RICO"
            draggable={false}
            onError={(e) => {
              // If image fails, hide it — RicoMark below is always visible
              e.currentTarget.style.display = "none";
            }}
            style={{
              height: "16px",
              width: "auto",
              objectFit: "contain",
              objectPosition: "left center",
              display: "block",
              userSelect: "none",
            }}
          />

          {/* thin divider */}
          <span
            style={{
              display: "block",
              width: "0.5px",
              height: "14px",
              background: "var(--color-border-secondary, rgba(0,0,0,0.15))",
            }}
          />

          {/* version pill */}
          <span
            className="text-[10px] text-text-muted border border-border/60 bg-bg-hover/40 rounded px-1.5 py-0.5 tracking-wide"
          >
            v2.0
          </span>

        </div>
      </div>
    </footer>
  );
};

export default Footer;