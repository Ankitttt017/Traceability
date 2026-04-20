import { MoonStar, Sun } from "lucide-react";
import { useTheme } from "../hooks/useTheme";

const ThemeToggleButton = ({ showLabel = false, className = "" }) => {
  const { isDarkTheme, toggleTheme } = useTheme();
  const activeThemeLabel = isDarkTheme ? "dark" : "light";
  const targetThemeLabel = isDarkTheme ? "light" : "dark";

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={`Switch to ${targetThemeLabel} theme`}
      title={`Switch to ${targetThemeLabel} theme`}
      className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-bg-card/60 text-text-main hover:border-primary transition-colors ${className}`}
    >
      <span className={`inline-flex items-center justify-center w-6 h-6 rounded-md ${!isDarkTheme ? "bg-primary/15 text-primary" : "text-text-muted"}`}>
        <Sun size={14} />
      </span>
      <span className={`inline-flex items-center justify-center w-6 h-6 rounded-md ${isDarkTheme ? "bg-primary/15 text-primary" : "text-text-muted"}`}>
        <MoonStar size={14} />
      </span>
      {showLabel && (
        <span className="text-xs font-semibold tracking-wide uppercase">
          {activeThemeLabel}
        </span>
      )}
    </button>
  );
};

export default ThemeToggleButton;
