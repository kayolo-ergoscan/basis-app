// Placeholder page (ui-shell, Wave A): a title and one line. Wave B replaces it.
import { useT } from "@/app/lang";
import { Page, PageHead } from "@/ui";

export default function LearnPage() {
  const t = useT();
  return (
    <Page>
      <PageHead eyebrow={t("learn.eyebrow")} title={t("learn.title")} lede={t("learn.lede")} />
    </Page>
  );
}
