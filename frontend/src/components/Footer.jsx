import logo from "../assets/images/logo.jpg";
import { useLanguage } from "../context/LanguageContext";

const Footer = () => {
  const { t } = useLanguage();

  return (
    <footer className="bg-bg-card/40 backdrop-blur-xl border-t border-border/60 py-2.5 px-4 sm:px-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2.5 text-center sm:text-left">
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
            © 2026 <span className="font-medium text-text-main">Rico Auto Industry</span>.{" "}
            {t("footer.rightsReserved", "All rights reserved.")}
          </p>
        </div>

        <div className="flex items-center justify-center gap-2.5 sm:justify-end">
          <span className="text-[11px] text-text-muted tracking-wide">
            {t("footer.developedBy", "Developed by")}
          </span>

          <span
            style={{
              display: "block",
              width: "0.5px",
              height: "14px",
              background: "var(--color-border-secondary, rgba(0,0,0,0.15))",
            }}
          />

          <img
            src={logo}
            alt="RICO"
            draggable={false}
            onError={(event) => {
              event.currentTarget.style.display = "none";
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

          <span
            style={{
              display: "block",
              width: "0.5px",
              height: "14px",
              background: "var(--color-border-secondary, rgba(0,0,0,0.15))",
            }}
          />

          <span className="text-[10px] text-text-muted border border-border/60 bg-bg-hover/40 rounded px-1.5 py-0.5 tracking-wide">
            v2.0
          </span>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
