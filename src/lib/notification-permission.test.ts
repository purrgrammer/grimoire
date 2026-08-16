/**
 * The two shapes of `Notification.requestPermission`.
 *
 * A browser that answers by callback returns `undefined`, and calling `.then`
 * on that throws inside the click handler — which is the one place the prompt
 * can be asked for at all. Nothing here can be seen from the app: it either
 * prompts or it silently does not.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { requestNotificationPermission } from "@/lib/notification-permission";

afterEach(() => {
  vi.unstubAllGlobals();
});

/** A modern browser: the promise form, no callback honoured. */
function stubPromiseForm(answer: NotificationPermission) {
  const requestPermission = vi.fn(() => Promise.resolve(answer));
  vi.stubGlobal("Notification", { permission: "default", requestPermission });
  return requestPermission;
}

/** Legacy Safari: the callback form, returning nothing at all. */
function stubCallbackForm(answer: NotificationPermission) {
  const requestPermission = vi.fn(
    (cb?: (result: NotificationPermission) => void) => {
      cb?.(answer);
      return undefined;
    },
  );
  vi.stubGlobal("Notification", { permission: "default", requestPermission });
  return requestPermission;
}

describe("requestNotificationPermission", () => {
  it("takes the answer from a browser that returns a promise", async () => {
    stubPromiseForm("granted");
    await expect(requestNotificationPermission()).resolves.toBe("granted");
  });

  it("takes the answer from a browser that only calls back", async () => {
    stubCallbackForm("granted");
    await expect(requestNotificationPermission()).resolves.toBe("granted");
  });

  it("does not throw where the older form returns undefined", () => {
    stubCallbackForm("denied");
    // The throw would happen synchronously, inside the click handler, and take
    // the rest of it — including the switch's own state write — with it.
    expect(() => requestNotificationPermission()).not.toThrow();
  });

  it("carries a refusal back unchanged", async () => {
    stubPromiseForm("denied");
    await expect(requestNotificationPermission()).resolves.toBe("denied");
  });

  it("keeps the first answer when a browser honours both forms", async () => {
    const requestPermission = vi.fn(
      (cb?: (result: NotificationPermission) => void) => {
        cb?.("granted");
        return Promise.resolve("granted" as NotificationPermission);
      },
    );
    vi.stubGlobal("Notification", { permission: "default", requestPermission });
    await expect(requestNotificationPermission()).resolves.toBe("granted");
  });

  it("says denied where notifications do not exist", async () => {
    vi.stubGlobal("Notification", undefined);
    await expect(requestNotificationPermission()).resolves.toBe("denied");
  });

  it("rejects rather than throwing when the browser refuses outright", async () => {
    vi.stubGlobal("Notification", {
      permission: "default",
      requestPermission: () => {
        throw new TypeError("not allowed here");
      },
    });
    await expect(requestNotificationPermission()).rejects.toThrow(
      "not allowed here",
    );
  });
});
