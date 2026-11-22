// Placeholder page (ui-shell, Wave A): a title and one line. Wave B replaces it.
import { useT } from "@/app/lang";
import { Page, PageHead } from "@/ui";

export default function WalletPage() {
  const t = useT();
  return (
    <Page>
      <PageHead eyebrow={t("wallet.eyebrow")} title={t("wallet.title")} lede={t("wallet.lede")} />
    </Page>
  );
}
