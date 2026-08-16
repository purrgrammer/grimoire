/**
 * Desktop notifications: the master switch, and what a channel is worth by
 * default.
 *
 * Two separate yeses, and the copy has to keep them apart because a user who
 * confuses them cannot debug the silence: the BROWSER grants permission (once,
 * revocable only in its own site settings) and this switch says whether
 * Grimoire should use it. Turning the switch on is what asks — permission
 * prompts are only allowed out of a real click, so this handler is the one
 * place that may ask for it.
 */

import { useCallback, useEffect, useState } from "react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { Switch } from "../ui/switch";
import { useSettings } from "@/hooks/useSettings";
import { requestNotificationPermission } from "@/lib/notification-permission";
import type { NotifLevel } from "@/services/concord-notif-prefs";

type Permission = NotificationPermission | "unsupported";

function currentPermission(): Permission {
  if (typeof Notification === "undefined") return "unsupported";
  return Notification.permission;
}

export function NotificationSettingsSection() {
  const { settings, updateSetting } = useSettings();
  const [permission, setPermission] = useState<Permission>(currentPermission);

  // Permission can change in another tab, or in the site settings the user just
  // walked into after reading the `denied` copy below.
  useEffect(() => {
    const refresh = () => setPermission(currentPermission());
    document.addEventListener("visibilitychange", refresh);
    return () => document.removeEventListener("visibilitychange", refresh);
  }, []);

  const enabled = settings?.notifications?.enabled ?? false;
  const defaultLevel = settings?.notifications?.defaultLevel ?? "mentions";

  const toggle = useCallback(
    (checked: boolean) => {
      updateSetting("notifications", "enabled", checked);
      // Asked here and nowhere else: the browser only honours the request
      // inside the gesture that produced it, so an effect or a later retry
      // would be refused without ever showing a prompt.
      if (checked && typeof Notification !== "undefined") {
        void requestNotificationPermission()
          .then(setPermission)
          .catch(() => setPermission(currentPermission()));
      }
    },
    [updateSetting],
  );

  return (
    <>
      <div>
        <h3 className="text-lg font-semibold mb-1">Notifications</h3>
        <p className="text-sm text-muted-foreground">
          Desktop alerts for Concord messages, while a Concord window is open
        </p>
      </div>

      <div className="space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-0.5">
            <label
              htmlFor="notifications-enabled"
              className="text-base font-medium cursor-pointer"
            >
              Desktop notifications
            </label>
            <p className="text-xs text-muted-foreground">
              Off by default. Switching this on asks your browser for
              permission.
            </p>
          </div>
          <Switch
            id="notifications-enabled"
            checked={enabled}
            onCheckedChange={toggle}
          />
        </div>

        {enabled && permission === "denied" && (
          <p className="text-xs text-destructive">
            Your browser is blocking notifications for this site. Grimoire
            cannot re-ask — allow them in the browser&apos;s site settings for
            this page, then reload.
          </p>
        )}
        {enabled && permission === "unsupported" && (
          <p className="text-xs text-muted-foreground">
            This browser has no Notifications API. Chrome on Android and Safari
            on iOS only show notifications through a service worker, which
            Grimoire does not use for this — you will get badges but no alerts.
          </p>
        )}
        {enabled && permission === "default" && (
          <p className="text-xs text-muted-foreground">
            Permission has not been granted yet. Switch this off and on again to
            see the prompt.
          </p>
        )}

        <div className="flex items-center justify-between gap-4">
          <div className="space-y-0.5">
            <label
              htmlFor="notifications-default-level"
              className="text-base font-medium cursor-pointer"
            >
              Default for a channel
            </label>
            <p className="text-xs text-muted-foreground">
              What a channel you have not set a level on is worth. Right-click a
              channel or community in Concord to override it; those overrides
              stay on this device and are erased when you sign out.
            </p>
          </div>
          <Select
            value={defaultLevel}
            onValueChange={(value) =>
              updateSetting(
                "notifications",
                "defaultLevel",
                value as NotifLevel,
              )
            }
          >
            <SelectTrigger id="notifications-default-level" className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All messages</SelectItem>
              <SelectItem value="mentions">Mentions only</SelectItem>
              <SelectItem value="nothing">Nothing</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    </>
  );
}
