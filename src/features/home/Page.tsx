// Placeholder page (ui-shell, Wave A): a title and one line. Wave B replaces it.
import { useT } from "@/app/lang";
import { Page, PageHead } from "@/ui";

export default function HomePage() {
  const t = useT();
  return (
    <Page>
      <PageHead eyebrow={t("home.eyebrow")} title={t("home.title")} lede={t("home.lede")} />
    </Page>
  );
}
