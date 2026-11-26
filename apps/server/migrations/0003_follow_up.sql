-- Follow-up: action items created when a report is issued, their history,
-- and personal update links. Assignee and due date live here (schema 7's
-- idea), never in the report.

-- The report exactly as issued, one row per issued revision. Never changed.
CREATE TABLE issued_report (
  report_id text NOT NULL,
  revision integer NOT NULL,
  doc jsonb NOT NULL,
  issued_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (report_id, revision)
);

CREATE TABLE action_item (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id text NOT NULL,
  finding_id text NOT NULL,
  -- The property name on the issued report: items, links and exports are grouped by it.
  property text NOT NULL,
  -- Frozen from the latest issued revision: what the report said.
  revision integer NOT NULL,
  number text NOT NULL,
  position integer NOT NULL,
  title text NOT NULL,
  description text NOT NULL,
  location text NOT NULL,
  recommendation text NOT NULL,
  priority text NOT NULL,
  priority_label text NOT NULL,
  section text NOT NULL,
  subsection text NOT NULL,
  photo_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  assessment_date text NOT NULL,
  facility_contact text NOT NULL,
  -- Live: set by the client's office and the facility.
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'done', 'deferred', 'withdrawn')),
  facility text NOT NULL DEFAULT '',
  assignee text NOT NULL DEFAULT '',
  due_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (report_id, finding_id)
);
CREATE INDEX action_item_property ON action_item (property);

-- A personal update link: one named person, one property. The token is the access.
CREATE TABLE update_link (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token text NOT NULL UNIQUE CHECK (length(token) >= 32),
  property text NOT NULL,
  person_name text NOT NULL CHECK (length(trim(person_name)) > 0),
  role text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX update_link_property ON update_link (property);

-- A photo a facility contact added from their link (only they can attach it to an update).
ALTER TABLE file ADD COLUMN link_id uuid REFERENCES update_link (id);

-- Every change to an item: who, when, what. Only ever added to.
CREATE TABLE action_update (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES action_item (id),
  at timestamptz NOT NULL DEFAULT now(),
  by_name text NOT NULL,
  -- report: issuing a report; office: the Follow-up page; link: a personal update link.
  via text NOT NULL CHECK (via IN ('report', 'office', 'link')),
  link_id uuid REFERENCES update_link (id),
  -- { "status": { "from": "open", "to": "done" }, "due_date": {…}, … } and, from a report, { "event": "issued" | "revised" | "withdrawn" | "restored" }
  changes jsonb NOT NULL DEFAULT '{}'::jsonb,
  note text NOT NULL DEFAULT '',
  photo_id text REFERENCES file (id)
);
CREATE INDEX action_update_item ON action_update (item_id, at);

CREATE FUNCTION action_update_is_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'action_update rows are never changed or removed';
END;
$$;
CREATE TRIGGER action_update_append_only BEFORE UPDATE OR DELETE ON action_update
  FOR EACH ROW EXECUTE FUNCTION action_update_is_append_only();
