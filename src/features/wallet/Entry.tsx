// /wallet/* — the wallet's entry: the sandbox town wallet (./Page) or the mainnet wallet (./mainnet/Page), each its
// own lazy chunk, so a visit to one never loads the other. A page switch loads the chunk first (route.tsx parts), so
// the fallback shows only when a chunk is not here yet.
import { Suspense } from "react";
import { useLocation } from "react-router-dom";
import { lazyChunk, loadParts } from "@/app/chunk";
import { sandboxTown } from "@/app/warm";
import { PageLoading } from "@/ui";
import { isMainnetPath, mainnetPage, mainnetVault, sandboxPage } from "./chunks";

/** A switch loads the mode's page and opens what it reads (the mainnet vault, or boots the sandbox town) first. */
export const warm = (pathname: string, code: boolean) =>
  loadParts(isMainnetPath(pathname) ? [mainnetPage, mainnetVault] : [sandboxPage, sandboxTown], code);

const Sandbox = lazyChunk(sandboxPage);
const Mainnet = lazyChunk(mainnetPage);

export default function WalletEntry() {
  const { pathname } = useLocation();
  return <Suspense fallback={<PageLoading />}>{isMainnetPath(pathname) ? <Mainnet /> : <Sandbox />}</Suspense>;
}
