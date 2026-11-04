import { useEffect, useState } from "react";
import { actingOrganisation, onActingOrganisationChange, type ActingOrganisation } from "./acting-organisation";

/** The organisation the app is acting for, or null for the user's own account. Re-renders on a switch. */
export function useActingOrganisation(): ActingOrganisation | null {
  const [org, setOrg] = useState(actingOrganisation());
  useEffect(() => onActingOrganisationChange(() => setOrg(actingOrganisation())), []);
  return org;
}
