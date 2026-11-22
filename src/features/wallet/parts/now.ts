// The sandbox clock in milliseconds (note timestamps live on it), refreshed with every town frame.
import { useTownView } from "@/world";

export function useNow(): number {
  return useTownView((eco) => Number(eco.clock.nowMs()), []) ?? Date.now();
}
