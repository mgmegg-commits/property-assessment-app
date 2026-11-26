-- Organizations: the boundary for keeping each client's data separate.
-- Row-level security and the other tables arrive with step 2.3.

CREATE TABLE organization (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(trim(name)) > 0),
  type text NOT NULL CHECK (type IN ('assessor_firm', 'client', 'facility_operator')),
  -- For a facility operator: the client whose properties it operates.
  client_org_id uuid REFERENCES organization (id),
  -- Logo file, colors, report name, disclaimer (per organization, as v1's Branding & settings).
  branding jsonb NOT NULL DEFAULT '{}'::jsonb,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT client_only_for_facility_operators CHECK (type = 'facility_operator' OR client_org_id IS NULL)
);

CREATE INDEX organization_client_org_id ON organization (client_org_id);
