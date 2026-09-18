import { notion } from "../lib/notion/client";

const parentPageId = process.env.NOTION_PARENT_PAGE_ID;
if (!parentPageId) throw new Error("NOTION_PARENT_PAGE_ID is missing");

const page = await notion().pages.retrieve({ page_id: parentPageId });
console.log("Connexion Notion valide.");
console.log(`Page accessible: ${"url" in page ? page.url : parentPageId}`);
