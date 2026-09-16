import { modeStore } from "../stores/modeStore";
import type { SozaMode } from "../../lib/types";
export function ModeSwitcher({ mode }: { mode: SozaMode }) { return <div className="mode-switcher">{(["ACTIF", "PAUSE"] as const).map((value) => <button key={value} className={mode === value ? "active" : ""} onClick={() => modeStore.set(value)}>{value}</button>)}</div>; }
