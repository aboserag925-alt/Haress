ALTER TABLE public.lectures
  ADD COLUMN IF NOT EXISTS sheikh text NOT NULL DEFAULT '' CHECK (char_length(sheikh) <= 120),
  ADD COLUMN IF NOT EXISTS duration_seconds integer CHECK (duration_seconds IS NULL OR duration_seconds BETWEEN 0 AND 86400),
  ADD COLUMN IF NOT EXISTS content_type text NOT NULL DEFAULT 'video' CHECK (content_type IN ('audio', 'video', 'document'));
