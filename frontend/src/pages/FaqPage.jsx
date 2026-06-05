import { useMemo, useState } from "react";
import { ChevronDown, CircleHelp, Sigma, ShieldAlert } from "lucide-react";
import { useLanguage } from "../context/LanguageContext";

const FaqPage = () => {
  const { t } = useLanguage();
  const [activeTab, setActiveTab] = useState("logic");
  const [openItem, setOpenItem] = useState(0);

  const logicItems = useMemo(() => t("faq.kpis", []), [t]);
  const rejectionItems = useMemo(() => t("faq.rejections", []), [t]);

  const tabs = [
    {
      key: "logic",
      label: t("faq.logicTab", "KPI Logic"),
      icon: Sigma,
    },
    {
      key: "rejection",
      label: t("faq.rejectionTab", "Rejection Categories"),
      icon: ShieldAlert,
    },
  ];

  const items = activeTab === "logic" ? logicItems : rejectionItems;

  return (
    <div className="space-y-5">
      <section className="db-header-card">
        <div className="flex items-start gap-3">
          <div className="w-11 h-11 rounded-2xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
            <CircleHelp size={22} />
          </div>
          <div className="min-w-0">
            <h1 className="db-title">{t("faq.title", "FAQ & Logic Guide")}</h1>
            <p className="db-subtitle mt-1 max-w-4xl">
              {t(
                "faq.subtitle",
                "Traceability formulas, KPI definitions, and rejection categories used by production teams"
              )}
            </p>
          </div>
        </div>
      </section>

      <section className="bg-bg-card border border-border rounded-3xl p-3 sm:p-4 shadow-sm">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.key;

            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => {
                  setActiveTab(tab.key);
                  setOpenItem(0);
                }}
                className={`flex items-center gap-3 rounded-2xl border px-4 py-3 text-left transition-all ${
                  isActive
                    ? "border-primary bg-primary/10 text-primary shadow-sm"
                    : "border-border bg-bg-main/40 text-text-main hover:bg-bg-hover/60"
                }`}
              >
                <span
                  className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                    isActive ? "bg-primary/15" : "bg-bg-hover/70"
                  }`}
                >
                  <Icon size={18} />
                </span>
                <span className="font-semibold text-sm sm:text-base">{tab.label}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="space-y-3">
        {items.map((item, index) => {
          const isOpen = openItem === index;

          return (
            <div
              key={`${activeTab}-${item.title}-${index}`}
              className="overflow-hidden rounded-3xl border border-border bg-bg-card shadow-sm"
            >
              <button
                type="button"
                onClick={() => setOpenItem(isOpen ? -1 : index)}
                className="w-full flex items-center justify-between gap-4 px-4 sm:px-6 py-4 sm:py-5 text-left hover:bg-bg-hover/40 transition-colors"
              >
                <div className="min-w-0">
                  <h2 className="text-base sm:text-lg font-semibold text-text-main">{item.title}</h2>
                </div>
                <ChevronDown
                  size={18}
                  className={`text-text-muted transition-transform shrink-0 ${isOpen ? "rotate-180" : ""}`}
                />
              </button>

              {isOpen && activeTab === "logic" && (
                <div className="border-t border-border px-4 sm:px-6 py-4 sm:py-5 space-y-3">
                  <div className="rounded-2xl bg-bg-main/60 border border-border px-4 py-3 overflow-x-auto">
                    <p className="text-sm sm:text-base font-medium text-text-main whitespace-pre-wrap min-w-0">
                      {item.formula}
                    </p>
                  </div>
                  <p className="text-sm sm:text-base text-text-muted leading-6">{item.note}</p>
                </div>
              )}

              {isOpen && activeTab === "rejection" && (
                <div className="border-t border-border px-4 sm:px-6 py-4 sm:py-5">
                  <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                    {item.items.map((reason) => (
                      <div
                        key={reason}
                        className="rounded-2xl border border-border bg-bg-main/60 px-4 py-3 text-sm text-text-main"
                      >
                        {reason}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </section>
    </div>
  );
};

export default FaqPage;
