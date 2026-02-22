import { MoonStar, Sun } from "lucide-react";
import { useTheme } from "../hooks/useTheme";

const ThemeToggleButton = ({ showLabel = false, className = "" }) => {
  const { isDarkTheme, toggleTheme } = useTheme();
  const targetThemeLabel = isDarkTheme ? "light" : "dark";

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={`Switch to ${targetThemeLabel} theme`}
      title={`Switch to ${targetThemeLabel} theme`}
      className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-bg-card/60 text-text-main hover:border-primary hover:text-primary transition-colors ${className}`}
    >
      {isDarkTheme ? <Sun size={16} /> : <MoonStar size={16} />}
      {showLabel && (
        <span className="text-xs font-semibold tracking-wide uppercase">
          {targetThemeLabel}
        </span>
      )}
    </button>
  );
};

export default ThemeToggleButton;
