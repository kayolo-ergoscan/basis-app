// The live strip under the hero (VISUAL §12.12): the departure board of what the story economy on this page just
// did (SANDBOX · LIVE TAPE), and the mainnet height from the shell's one /v1/info poller.
import { Link } from "react-router-dom";
import { useHeight } from "@/app/height";
import { useT } from "@/app/lang";
import { int, Lamp, money, short } from "@/ui";
import type { TapeItem } from "./story";
import { phaseAtLeast, useStory } from "./useStory";

function Row({ it }: { it: TapeItem }) {
  const t = useT();
  const d = it.data;
  const num = (k: string) => Number(d[k] ?? 0);
  let body: React.ReactNode;
  switch (it.kind) {
    case "RESERVE":
      body = <>{t("home.tape.reserve")} <b>{money(num("amount"))}</b> ERG</>;
      break;
    case "NOTE":
      body = <>{t("home.tape.note")} <b>{money(num("amount"))}</b> <span className="up">+{money(num("delta"))}</span></>;
      break;
    case "WITNESS":
      body = <>{t("home.tape.witness")} <span className="mono">sig {short(String(d.sig ?? ""), 4, 4)}</span></>;
      break;
    case "COMMIT":
      body = <>{t("home.tape.commit")} <b className="mono">{short(String(d.digest ?? ""), 4, 2)}</b> · {t.p("home.tape.notes", num("notes"))} · {t("home.tape.block", { n: int(num("height")) })}</>;
      break;
    case "CHECK":
      body = <>{t("home.tape.check")} · <b>{num("match") ? t("home.tape.match") : t("home.tape.mismatch")}</b> <span className="mono">{int(num("bytes"))} B</span></>;
      break;
    case "TOP UP":
      body = <>{t("home.tape.topup")} <b>+{money(num("amount"))}</b> ERG</>;
      break;
    case "REDEEM":
      body = <>{t("home.tape.redeem")} <b>{money(num("amount"))}</b> ERG</>;
      break;
  }
  return <span className="board-row"><span className="ev">{it.kind}</span><Lamp state={it.lamp} size={8} />{body}</span>;
}

export function LiveStrip() {
  const t = useT();
  const { phase, snap } = useStory();
  const h = useHeight();
  // the hero reveals T-01's co-signature one beat after Alice's; the tape follows the hero
  const items = (snap?.tape ?? []).filter((x) => x.kind !== "WITNESS" || phaseAtLeast(phase, "witnessed"));
  return (
    <div className="board home-board" role="region" aria-label={t("home.tape.aria")}>
      <div className="container">
        <span className="label home-board-l"><Lamp state="live" size={8} /><b>{t("ui.tape.sandbox")}</b></span>
        <div className="board-rows" aria-live="off">
          {items.map((it) => <Row key={it.id} it={it} />)}
        </div>
        <Link to="/network" className="label home-board-r">
          <Lamp state="live" size={8} />
          <b>{t("home.tape.mainnet")}</b>
          <span>{h.height != null ? t("home.tape.block", { n: int(h.height) }) : t("home.tape.waiting")}</span>
        </Link>
      </div>
    </div>
  );
}
