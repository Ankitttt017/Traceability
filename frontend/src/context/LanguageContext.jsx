import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { translations } from "../i18n/translations";

const LANGUAGE_STORAGE_KEY = "app-language-v1";

const LanguageContext = createContext({
  language: "en",
  setLanguage: () => {},
  t: (key, fallback) => fallback || key,
});

function getValueByPath(source, path) {
  return String(path || "")
    .split(".")
    .filter(Boolean)
    .reduce((acc, part) => (acc && Object.prototype.hasOwnProperty.call(acc, part) ? acc[part] : undefined), source);
}

export function LanguageProvider({ children }) {
  const [language, setLanguageState] = useState(() => {
    try {
      const saved = localStorage.getItem(LANGUAGE_STORAGE_KEY);
      return saved === "hi" ? "hi" : "en";
    } catch {
      return "en";
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
    } catch {
      // ignore storage errors
    }
    if (typeof document !== "undefined") {
      document.documentElement.lang = language === "hi" ? "hi" : "en";
    }
  }, [language]);

  const value = useMemo(() => {
    const t = (key, fallback = "") => {
      const selected = getValueByPath(translations[language], key);
      if (selected !== undefined && selected !== null && selected !== "") return selected;
      const english = getValueByPath(translations.en, key);
      if (english !== undefined && english !== null && english !== "") return english;
      return fallback || key;
    };

    return {
      language,
      setLanguage: setLanguageState,
      t,
    };
  }, [language]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  return useContext(LanguageContext);
}
