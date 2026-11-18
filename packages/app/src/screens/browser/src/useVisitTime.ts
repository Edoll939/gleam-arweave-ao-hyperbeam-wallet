import { useMemo } from "react";
import { useLocale, useT } from "../../../i18n";
import { dayOf } from "./history";

/** A visit's time as a row shows it: the clock today, then "Yesterday", then the date. */
export function useVisitTime(): (at: number) => string {
  const t = useT();
  const locale = useLocale();
  return useMemo(() => {
    const clock = new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" });
    const date = new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" });
    return (at: number) => {
      const day = dayOf(at, Date.now());
      return day === "today" ? clock.format(at) : day === "yesterday" ? t("browser.yesterday") : date.format(at);
    };
  }, [locale, t]);
}
