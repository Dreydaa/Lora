export type TabId = "calendrier" | "blender" | "quiz" | "idees" | "reglages";
export const TABS: { id: TabId; label: string }[] = [
  { id: "calendrier", label: "Calendrier" },
  { id: "blender", label: "Blender" },
  { id: "idees", label: "Idées" },
  { id: "quiz", label: "Quiz" },
  { id: "reglages", label: "Réglages" },
];

export function Tabs({ active, onChange }: { active: TabId; onChange: (tab: TabId) => void }) {
  return (
    <nav aria-label="Sections">
      {TABS.map((tab) => (
        <button key={tab.id} role="tab" aria-selected={active === tab.id} onClick={() => onChange(tab.id)}>
          {tab.label}
        </button>
      ))}
    </nav>
  );
}
