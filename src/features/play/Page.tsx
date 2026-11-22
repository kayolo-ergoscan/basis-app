// Placeholder page (ui-shell, Wave A): a title and one line. Wave B replaces it.
import { useT } from "@/app/lang";
import { Page, PageHead } from "@/ui";

export default function PlayPage() {
  const t = useT();
  return (
    <Page>
      <PageHead eyebrow={t("play.eyebrow")} title={t("play.title")} lede={t("play.lede")} />
    </Page>
  );
}
