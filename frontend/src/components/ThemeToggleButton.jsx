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
      className={`inline-flex items-center justify-center text-text-main hover:text-primary transition-colors ${className}`}
    >
      <ActiveIcon size={20} />

      {showLabel && (
        <span className="text-xs font-semibold tracking-wide uppercase ml-2">
          {activeThemeLabel}
        </span>
      )}
    </button>
  );
};

export default ThemeToggleButton;