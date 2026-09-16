import { Client } from "@notionhq/client";
let client: Client | undefined;
export function notion() { if (!process.env.NOTION_TOKEN) throw new Error("NOTION_TOKEN is missing"); return (client ??= new Client({ auth: process.env.NOTION_TOKEN })); }
