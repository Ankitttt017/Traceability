import { MoonStar, Sun } from "lucide-react";
import { useTheme } from "../hooks/useTheme";

const ThemeToggleButton = ({ showLabel = false, className = "" }) => {
  const { isDarkTheme, toggleTheme } = useTheme();
  const activeThemeLabel = isDarkTheme ? "Dark" : "Light";
  const targetThemeLabel = isDarkTheme ? "Light" : "Dark";
  const ActiveIcon = isDarkTheme ? MoonStar : Sun;

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={`Switch to ${targetThemeLabel} theme`}
      title={`Switch to ${targetThemeLabel} theme`}
      className={`inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-border bg-bg-card/70 text-text-main hover:border-primary/60 transition-colors ${className}`}
    >
      <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-primary/15 text-primary">
        <ActiveIcon size={15} />
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
