import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Shared row types for Stage-2 tables (mirror of
 * supabase/migrations/0001_stage2_data_layer.sql — keep both in sync).
 * These are hand-written previews; generated Database types land in a later
 * stage once the owner applies the migration to the project.
 */

export type ContentStatus = "draft" | "published" | "archived";
export type ModerationStatus = "visible" | "hidden" | "stale";

export type Series = {
  id: string;
  slug: string;
  title: string;
  description: string;
  status: ContentStatus;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type Lecture = {
  id: string;
  title: string;
  description: string;
  starts_at: string | null;
  category: string;
  stream_url: string | null;
  recording_url: string | null;
  status: ContentStatus;
  series_id?: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type Article = {
  id: string;
  slug: string;
  title: string;
  summary: string;
  body: string;
  status: ContentStatus;
  published_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type Book = {
  id: string;
  slug: string;
  title: string;
  author: string;
  description: string;
  cover_url: string | null;
  file_url: string | null;
  language: string;
  status: ContentStatus;
  published_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type QuranItem = {
  id: string;
  item_kind: "recitation" | "surah" | "juz" | "page";
  title: string;
  reciter: string;
  surah_number: number | null;
  audio_url: string | null;
  description: string;
  status: ContentStatus;
  published_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type ForumThread = {
  id: string;
  author_id: string;
  title: string;
  body: string;
  status: ModerationStatus;
  created_at: string;
  updated_at: string;
};

export type ForumPost = {
  id: string;
  thread_id: string;
  author_id: string;
  body: string;
  status: ModerationStatus;
  created_at: string;
  updated_at: string;
};

export type SiteSetting = {
  key: string;
  value: Record<string, unknown>;
  updated_by: string | null;
  updated_at: string;
};

/** Generic-typed client until generated Database types land. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- documented above
export type AppSupabaseClient = SupabaseClient<any>;
