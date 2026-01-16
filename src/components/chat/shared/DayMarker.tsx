import { Label } from "@/components/ui/label";

interface DayMarkerProps {
  label: string;
  timestamp: number;
}

/**
 * DayMarker - Generic day separator for chat messages
 * Displays a date label between messages from different days
 */
export function DayMarker({ label, timestamp }: DayMarkerProps) {
  return (
    <div className="flex justify-center py-2" key={`marker-${timestamp}`}>
      <Label className="text-[10px] text-muted-foreground">{label}</Label>
    </div>
  );
}
