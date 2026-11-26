import { describe, expect, it } from "vitest";
import { ORGANIZATION_TYPES, isOrganizationType, organizationTypeLabel } from "@crb/core";

describe("organization types", () => {
  it("has a plain label for every type", () => {
    expect(ORGANIZATION_TYPES.map(organizationTypeLabel)).toEqual(["Assessor firm", "Client", "Facility operator"]);
  });

  it("recognizes only the known types", () => {
    expect(isOrganizationType("client")).toBe(true);
    expect(isOrganizationType("tenant")).toBe(false);
    expect(isOrganizationType(undefined)).toBe(false);
  });
});
