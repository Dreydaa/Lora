import type { TaskIcon } from "./taskIcons";
import "./calendar.css";

// Pastille blanche + logo de marque ou pictogramme à sa couleur (style partagé par tous les blocs).
export const Logo = ({ icon }: { icon: TaskIcon }) => (
  <span className="gcal-logo" title={icon.label}>
    {icon.glyph ? <icon.glyph color={icon.color} strokeWidth={2.4} aria-hidden="true" /> : <svg viewBox="0 0 24 24" aria-hidden="true"><path d={icon.brand!.path} fill={icon.color} /></svg>}
  </span>
);
