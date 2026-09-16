import { Card } from "../../components/ui/Card";
export function NewsPanel({ news }: { news: string[] }) { return <Card><h2>Veille</h2><ul>{news.map((item) => <li key={item}>{item}</li>)}</ul></Card>; }
