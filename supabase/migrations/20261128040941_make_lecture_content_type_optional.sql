ALTER TABLE public.lectures
  ALTER COLUMN content_type DROP NOT NULL,
  ALTER COLUMN content_type DROP DEFAULT;

UPDATE public.lectures
SET content_type = NULL
WHERE stream_url IS NULL AND recording_url IS NULL;
