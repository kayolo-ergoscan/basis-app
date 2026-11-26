// / — the story told once: the hero (the town at night, one sentence, two actions, the live strip), «How it works» as
// three lit stops with the note signed live in this page, the three doors (and one line for developers), mainnet now
// and three FAQ questions. The five moments, the money spectrum, the roles and the ten steps live in Learn.
import "./home.css";
import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { addI18n } from "@/app/lang";
import { Doors } from "./Doors";
import { HomeFaq } from "./Faq";
import { Hero } from "./Hero";
import { Mainnet } from "./Mainnet";
import { Street } from "./Street";
import strings from "./strings";
import { createStoryStore, StoryContext } from "./useStory";

// the page's string table arrives with this lazy chunk; register it before the page renders
addI18n(strings);

export default function HomePage() {
  const [store] = useState(createStoryStore);
  useEffect(() => {
    store.start();
    return () => store.stop();
  }, [store]);
  // "/#mainnet", "/#faq" (command palette, links): the shell scrolls to a #hash at 0 / 350 / 900 ms; this lazy
  // page may mount later than that on a cold load, so it lands the anchor once more itself (instant, the same
  // target, so the two never fight). Sections tuck their top padding under the nav (home.css scroll-margin).
  const { hash, key } = useLocation();
  useEffect(() => {
    if (!hash) return;
    const id = decodeURIComponent(hash.slice(1));
    const go = () => document.getElementById(id)?.scrollIntoView({ block: "start" });
    const raf = requestAnimationFrame(go);
    const t = setTimeout(go, 160);
    return () => { cancelAnimationFrame(raf); clearTimeout(t); };
  }, [hash, key]);
  return (
    <StoryContext.Provider value={store}>
      <div className="home">
        <Hero />
        <Street />
        <Doors />
        <Mainnet />
        <HomeFaq />
      </div>
    </StoryContext.Provider>
  );
}
