import { formatTimestamp } from "@/hooks/useLocale";

export default function Timestamp({ timestamp }: { timestamp: number }) {
  return formatTimestamp(timestamp, "time");
}
