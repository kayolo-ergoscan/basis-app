// The money spectrum (no engine): one signed note, three ways to accept it. Used by /learn/how and /learn/trust.
import { useT } from "@/app";
import { pick, spectrum } from "@/content";
import { Fig } from "../layout";

export function SpectrumFig({ n, caption = true }: { n?: string; caption?: boolean }) {
  const t = useT();
  const L = t.lang;
  return (
    <Fig n={n} caption={caption ? t("learn.f.sp.cap") : undefined} wide>
      <div className="hw-spectrum">
        <div>
          <div className="hw-spec-bar" aria-hidden="true"><i /><i /><i /></div>
          <div className="spread" style={{ marginTop: 8 }}>
            <span className="label">{t("learn.f.sp.trust")}</span>
            <span className="label">{t("learn.f.sp.backed")}</span>
          </div>
        </div>
        <div className="hw-tiers">
          {spectrum.tiers.map((tier) => (
            <div className="hw-tier" key={tier.id}>
              <span className="n">0{tier.n}</span>
              <b>{pick(tier.title, L)}</b>
              <p>{pick(tier.explanation, L)}</p>
              <p><code>{pick(tier.policy, L)}</code></p>
              <p><span className="label">{t("learn.f.sp.protection")}</span><br />{pick(tier.protection, L)}</p>
              <p><span className="label">{t("learn.f.sp.risk")}</span><br />{pick(tier.risk, L)}</p>
            </div>
          ))}
        </div>
      </div>
    </Fig>
  );
}

