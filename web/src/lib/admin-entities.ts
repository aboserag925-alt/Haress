/**
 * Admin entity registry (Stage 3): allowed admin entities, field descriptors
 * for validation, and allowed statuses.
 */

export const ADMIN_ENTITIES = ["lectures", "series", "articles", "books", "quran_items", "live_state", "broadcast_schedule"] as const;
export type AdminEntity = (typeof ADMIN_ENTITIES)[number];

export type FieldType = "text" | "textarea" | "number" | "select" | "url";

export type FieldDef = {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  options?: string[];
  max?: number;
};

export const ENTITY_STATUSES: Record<AdminEntity, string[]> = {
  lectures: ["draft", "published", "archived"],
  series: ["draft", "published", "archived"],
  articles: ["draft", "published", "archived"],
  books: ["draft", "published", "archived"],
  quran_items: ["draft", "published", "archived"],
  live_state: ["true", "false"],
  broadcast_schedule: ["draft", "published"]
};

const FIELD_MAP: Record<AdminEntity, FieldDef[]> = {
  lectures: [
    { key: "title", label: "العنوان", type: "text", required: true, max: 180 },
    { key: "description", label: "الوصف", type: "textarea", max: 4000 },
    { key: "starts_at", label: "البداية", type: "text" },
    { key: "category", label: "الفئة", type: "text", max: 80 },
    { key: "status", label: "الحالة", type: "select", options: ENTITY_STATUSES.lectures }
  ],
  series: [
    { key: "title", label: "العنوان", type: "text", required: true, max: 180 },
    { key: "description", label: "الوصف", type: "textarea", max: 4000 },
    { key: "status", label: "الحالة", type: "select", options: ENTITY_STATUSES.series }
  ],
  articles: [
    { key: "title", label: "العنوان", type: "text", required: true, max: 200 },
    { key: "summary", label: "الملخص", type: "textarea", max: 600 },
    { key: "body", label: "المحتوى", type: "textarea", max: 100000 },
    { key: "status", label: "الحالة", type: "select", options: ENTITY_STATUSES.articles }
  ],
  books: [
    { key: "title", label: "العنوان", type: "text", required: true, max: 200 },
    { key: "author", label: "المؤلف", type: "text", max: 120 },
    { key: "description", label: "الوصف", type: "textarea", max: 4000 },
    { key: "status", label: "الحالة", type: "select", options: ENTITY_STATUSES.books }
  ],
  quran_items: [
    { key: "title", label: "العنوان", type: "text", required: true, max: 200 },
    { key: "reciter", label: "القارئ", type: "text", max: 120 },
    { key: "surah_number", label: "رقم السورة", type: "number" },
    { key: "status", label: "الحالة", type: "select", options: ENTITY_STATUSES.quran_items }
  ],
  live_state: [
    { key: "is_live", label: "البث المباشر", type: "select", options: ["true", "false"] },
    { key: "stream_url", label: "رابط البث", type: "url", max: 1000 },
    { key: "stream_title", label: "عنوان البث", type: "text", max: 180 }
  ],
  broadcast_schedule: [
    { key: "title", label: "العنوان", type: "text", required: true, max: 180 },
    { key: "starts_at_utc", label: "الوقت (UTC)", type: "text", required: true, max: 40 },
    { key: "status", label: "الحالة", type: "select", options: ["draft", "published"] },
    { key: "stream_url", label: "رابط البث", type: "url", max: 1000 }
  ]
};

export function getEntityFields(entity: string): FieldDef[] | null {
  const e = entity as AdminEntity;
  if (!ADMIN_ENTITIES.includes(e)) return null;
  return FIELD_MAP[e];
}

export function isAdminEntity(value: string): value is AdminEntity {
  return (ADMIN_ENTITIES as readonly string[]).includes(value);
}
