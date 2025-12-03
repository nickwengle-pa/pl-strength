import React, { createContext, useContext, useState, type ReactNode } from "react";

export type Org = {
  id: string;
  name: string;
};

type OrgContextType = {
  org: Org | null;
  setOrg: (org: Org | null) => void;
};

const OrgContext = createContext<OrgContextType | undefined>(undefined);

export function OrgProvider({ children }: { children: ReactNode }) {
  // Default to a single org for now - multi-org support can be expanded later
  const [org, setOrg] = useState<Org | null>({ id: "default", name: "PL Strength" });

  return (
    <OrgContext.Provider value={{ org, setOrg }}>
      {children}
    </OrgContext.Provider>
  );
}

export function useOrg() {
  const context = useContext(OrgContext);
  if (context === undefined) {
    // Return a default instead of throwing to support gradual adoption
    return { org: { id: "default", name: "PL Strength" } as Org | null, setOrg: () => {} };
  }
  return context;
}
