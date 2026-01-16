/**
 * Metadata Section
 *
 * Edit relay name, description, and icon.
 */

import { useState } from "react";
import { toast } from "sonner";
import { Save, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { Nip86Client } from "@/lib/nip86-client";

interface MetadataSectionProps {
  url: string;
  getClient: () => Nip86Client | null;
  supportedMethods: string[];
  currentInfo?: {
    name?: string;
    description?: string;
    icon?: string;
  } | null;
}

export function MetadataSection({
  getClient,
  supportedMethods,
  currentInfo,
}: MetadataSectionProps) {
  const canChangeName = supportedMethods.includes("changerelayname");
  const canChangeDescription = supportedMethods.includes(
    "changerelaydescription",
  );
  const canChangeIcon = supportedMethods.includes("changerelayicon");

  const [name, setName] = useState(currentInfo?.name || "");
  const [description, setDescription] = useState(
    currentInfo?.description || "",
  );
  const [iconUrl, setIconUrl] = useState(currentInfo?.icon || "");

  const [savingName, setSavingName] = useState(false);
  const [savingDescription, setSavingDescription] = useState(false);
  const [savingIcon, setSavingIcon] = useState(false);

  const handleSaveName = async () => {
    const client = getClient();
    if (!client || !name.trim()) return;

    setSavingName(true);
    try {
      await client.changeRelayName(name.trim());
      toast.success("Relay name updated");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to update name",
      );
    } finally {
      setSavingName(false);
    }
  };

  const handleSaveDescription = async () => {
    const client = getClient();
    if (!client) return;

    setSavingDescription(true);
    try {
      await client.changeRelayDescription(description);
      toast.success("Relay description updated");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to update description",
      );
    } finally {
      setSavingDescription(false);
    }
  };

  const handleSaveIcon = async () => {
    const client = getClient();
    if (!client || !iconUrl.trim()) return;

    setSavingIcon(true);
    try {
      await client.changeRelayIcon(iconUrl.trim());
      toast.success("Relay icon updated");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to update icon",
      );
    } finally {
      setSavingIcon(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Name */}
      {canChangeName && (
        <div className="space-y-2">
          <label className="text-sm font-medium">Name</label>
          <div className="flex gap-2">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Relay name"
              className="flex-1"
            />
            <Button
              size="sm"
              onClick={handleSaveName}
              disabled={savingName || !name.trim()}
            >
              {savingName ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Save className="size-4" />
              )}
            </Button>
          </div>
        </div>
      )}

      {/* Description */}
      {canChangeDescription && (
        <div className="space-y-2">
          <label className="text-sm font-medium">Description</label>
          <div className="flex gap-2">
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Relay description"
              className="flex-1 min-h-[80px]"
            />
            <Button
              size="sm"
              onClick={handleSaveDescription}
              disabled={savingDescription}
            >
              {savingDescription ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Save className="size-4" />
              )}
            </Button>
          </div>
        </div>
      )}

      {/* Icon URL */}
      {canChangeIcon && (
        <div className="space-y-2">
          <label className="text-sm font-medium">Icon URL</label>
          <div className="flex gap-2">
            <Input
              value={iconUrl}
              onChange={(e) => setIconUrl(e.target.value)}
              placeholder="https://example.com/icon.png"
              className="flex-1"
            />
            <Button
              size="sm"
              onClick={handleSaveIcon}
              disabled={savingIcon || !iconUrl.trim()}
            >
              {savingIcon ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Save className="size-4" />
              )}
            </Button>
          </div>
          {iconUrl && (
            <img
              src={iconUrl}
              alt="Relay icon preview"
              className="size-16 rounded-md object-cover"
              onError={(e) => {
                e.currentTarget.style.display = "none";
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}
