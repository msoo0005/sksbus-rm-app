import * as SecureStore from "expo-secure-store";
import React from "react";
import { Language, translations } from "./translations";

type TranslateVars = Record<string, string | number>;

type I18nContextType = {
  language: Language;
  loading: boolean;
  setLanguage: (lang: Language) => Promise<void>;
  t: (key: string, vars?: TranslateVars) => string;
};

const I18nContext = React.createContext<I18nContextType | null>(null);

export function useI18n() {
  const ctx = React.useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used within LanguageProvider");
  return ctx;
}

function lookup(key: string, lang: Language): string | null {
  const parts = key.split(".");
  let node: unknown = translations[lang];
  for (const part of parts) {
    if (typeof node !== "object" || node === null) return null;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string" ? node : null;
}

// Replaces "{token}" placeholders — used for messages that need a value
// interpolated mid-sentence (e.g. "Save {value} as the odometer reading"),
// where the value's position/surrounding words differ between languages.
function interpolate(str: string, vars?: TranslateVars): string {
  if (!vars) return str;
  return str.replace(/\{(\w+)\}/g, (match, token) =>
    token in vars ? String(vars[token]) : match,
  );
}

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = React.useState<Language>("en");
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    (async () => {
      const saved = await SecureStore.getItemAsync("appLanguage");
      if (saved === "en" || saved === "ms") setLanguageState(saved);
      setLoading(false);
    })();
  }, []);

  const setLanguage = React.useCallback(async (lang: Language) => {
    await SecureStore.setItemAsync("appLanguage", lang);
    setLanguageState(lang);
  }, []);

  // Untranslated keys (screens not yet covered in Phase 1) fall back to the
  // English string rather than throwing or showing a raw dot-path — lets
  // translation coverage grow incrementally without breaking anything.
  const t = React.useCallback(
    (key: string, vars?: TranslateVars) =>
      interpolate(lookup(key, language) ?? lookup(key, "en") ?? key, vars),
    [language],
  );

  return (
    <I18nContext.Provider value={{ language, loading, setLanguage, t }}>
      {children}
    </I18nContext.Provider>
  );
}
