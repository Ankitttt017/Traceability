import { useEffect, useMemo, useState } from "react";
import { ThemeContext } from "./themeContext";

const STORAGE_KEY = "indus-theme";
const DARK_THEME = "dark";
const LIGHT_THEME = "light";

function resolveInitialTheme() {
  if (typeof window === "undefined") {
    return DARK_THEME;
  }

  const storedTheme = localStorage.getItem(STORAGE_KEY);
  const resolvedTheme =
    storedTheme === DARK_THEME || storedTheme === LIGHT_THEME
      ? storedTheme
      : window.matchMedia?.("(prefers-color-scheme: light)").matches
    ? LIGHT_THEME
    : DARK_THEME;

  document.documentElement.setAttribute("data-theme", resolvedTheme);
  return resolvedTheme;
}

const ThemeProvider = ({ children }) => {
  const [theme, setTheme] = useState(resolveInitialTheme);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  const value = useMemo(
    () => ({
      theme,
      isDarkTheme: theme === DARK_THEME,
      setTheme,
      toggleTheme: () =>
        setTheme((currentTheme) =>
          currentTheme === DARK_THEME ? LIGHT_THEME : DARK_THEME
        ),
    }),
    [theme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

export default ThemeProvider;
