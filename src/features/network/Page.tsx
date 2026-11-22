// Placeholder page (ui-shell, Wave A): a title and one line. Wave B replaces it.
import { useT } from "@/app/lang";
import { Page, PageHead } from "@/ui";

export default function NetworkPage() {
  const t = useT();
  return (
    <Page>
      <PageHead eyebrow={t("network.eyebrow")} title={t("network.title")} lede={t("network.lede")} />
    </Page>
  );
}
