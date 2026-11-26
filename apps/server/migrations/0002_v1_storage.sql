-- v1's storage, in PostgreSQL (v1 kept these as files under DATA_DIR).
-- v1's front end sends whole JSON documents; each is kept exactly as sent.

-- Reports (v1 "assessments"), in v1's shape (schema 6). Never migrated here:
-- v1's screens read them back as they were saved.
CREATE TABLE report (
  id text PRIMARY KEY CHECK (id ~ '^[A-Za-z0-9_-]{1,80}$'),
  doc jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- "Delete" hides a report; reports are kept forever.
  deleted_at timestamptz
);

-- Branding & settings: one document.
CREATE TABLE setting (
  id smallint PRIMARY KEY CHECK (id = 1),
  doc jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Transcripts, training examples and versions, by collection and id.
CREATE TABLE doc (
  collection text NOT NULL CHECK (collection IN ('transcripts', 'training', 'versions', 'versionIndex')),
  id text NOT NULL CHECK (id ~ '^[A-Za-z0-9_-]{1,80}$'),
  doc jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (collection, id)
);

-- Photo and logo files: the bytes are on disk under DATA_DIR/files/<id>.
-- "Delete" hides a file; it's never removed, so older versions still show it.
CREATE TABLE file (
  id text PRIMARY KEY CHECK (id ~ '^[A-Za-z0-9_-]{1,80}$'),
  content_type text NOT NULL,
  bytes integer NOT NULL CHECK (bytes >= 0),
  sha256 text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  hidden_at timestamptz
);

-- Drafting jobs, as v1's job documents.
CREATE TABLE job (
  id text PRIMARY KEY,
  assessment_id text NOT NULL,
  doc jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX job_running ON job ((doc ->> 'status'));

-- v1's "version": a number that changes whenever any report changes, so the
-- page knows to fetch the list again.
CREATE TABLE change_counter (
  id smallint PRIMARY KEY CHECK (id = 1),
  value bigint NOT NULL
);
INSERT INTO change_counter (id, value) VALUES (1, 1);
