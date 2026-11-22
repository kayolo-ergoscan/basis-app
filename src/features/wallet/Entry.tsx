// /wallet/* — the wallet's entry: the sandbox town wallet (./Page) or the mainnet wallet (./mainnet/Page), each its
// own lazy chunk, so a visit to one never loads the other.
import { lazy, Suspense } from "react";
import { useLocation } from "react-router-dom";
import { PageLoading } from "@/ui";

const Sandbox = lazy(() => import("./Page"));
const Mainnet = lazy(() => import("./mainnet/Page"));

export default function WalletEntry() {
  const { pathname } = useLocation();
  const mainnet = /^\/wallet\/mainnet(\/|$)/.test(pathname);
  return <Suspense fallback={<PageLoading />}>{mainnet ? <Mainnet /> : <Sandbox />}</Suspense>;
}
