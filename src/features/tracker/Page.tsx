// Placeholder page (ui-shell, Wave A): a title and one line. Wave B replaces it.
import { useT } from "@/app/lang";
import { Page, PageHead } from "@/ui";

export default function TrackerPage() {
  const t = useT();
  return (
    <Page>
      <PageHead eyebrow={t("tracker.eyebrow")} title={t("tracker.title")} lede={t("tracker.lede")} />
    </Page>
  );
}
