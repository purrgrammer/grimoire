import { useEffect } from "react";
import { useGrimoire } from "@/core/state";
import { WorkspaceView } from "../WorkspaceView";

export default function DashboardPage() {
  const { isTemporary, discardTemporary } = useGrimoire();

  useEffect(() => {
    if (isTemporary) {
      discardTemporary();
    }
  }, [isTemporary, discardTemporary]);

  return <WorkspaceView />;
}
