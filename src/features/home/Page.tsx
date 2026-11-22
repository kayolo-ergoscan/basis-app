// / — the story in one scroll (VISUAL §13 Home): the hero with a note signed live in this page, the live strip,
// 01 Five moments, 02 Three doors, 03 Mainnet now, the money spectrum with the personas, and 04 Learn.
import "./home.css";
import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { addI18n } from "@/app/lang";
import { Doors } from "./Doors";
import { Hero } from "./Hero";
import { Learn } from "./Learn";
import { Mainnet } from "./Mainnet";
import { Moments } from "./Moments";
import { Spectrum } from "./Spectrum";
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
  // "/#moments", "/#mainnet" (command palette, links): the shell scrolls to a #hash at 0 / 350 / 900 ms; this lazy
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
        <Moments />
        <Doors />
        <Mainnet />
        <Spectrum />
        <Learn />
      </div>
    </StoryContext.Provider>
  );
}
