import { lazy, Suspense } from "react";
import { ModeSwitcher } from "../../components/ModeSwitcher";
import { StreakDisplay } from "../../components/StreakDisplay";
import type { DashboardData } from "../../types/dashboard";
const AvatarOrb = lazy(() => import("../../components/AvatarOrb/AvatarOrb").then((module) => ({ default: module.AvatarOrb })));
export function DashboardHeader({ data }: { data: DashboardData }) { return <header><div><p className="eyebrow">OPÉRATEUR SYSTÈME</p><h1>SOZA</h1><StreakDisplay streak={data.streak} /></div><Suspense fallback={<div className="orb" />}><AvatarOrb /></Suspense><ModeSwitcher mode={data.mode} /></header>; }
