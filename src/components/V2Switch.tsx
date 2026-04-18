import type { ReactNode } from "react";
import { isV2 } from "../lib/uiVersion";

type Props = {
  v1: ReactNode;
  v2: ReactNode;
};

export default function V2Switch({ v1, v2 }: Props) {
  return <>{isV2() ? v2 : v1}</>;
}
