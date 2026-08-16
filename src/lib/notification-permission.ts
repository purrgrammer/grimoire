/**
 * Ask the browser for notification permission, whichever shape it answers in.
 *
 * `Notification.requestPermission()` has two signatures. Every current browser
 * returns a promise; the original callback-only form is still what older Safari
 * ships, and there it returns `undefined` — so `.then()` on the result throws
 * synchronously, inside the click handler, taking the rest of the handler with
 * it. Passing the callback AND following the promise covers both: whichever one
 * the browser honours settles this, and the other never fires.
 *
 * Must be called from a real user gesture. A browser refuses the prompt
 * otherwise, and refuses it silently.
 */
export function requestNotificationPermission(): Promise<NotificationPermission> {
  if (typeof Notification === "undefined") return Promise.resolve("denied");
  return new Promise<NotificationPermission>((resolve, reject) => {
    try {
      // The callback form: the only channel a legacy browser answers on.
      const maybe = Notification.requestPermission((result) =>
        resolve(result ?? Notification.permission),
      );
      // The promise form. Resolving twice is a no-op, so the browser that
      // honours both hands us the same answer twice and we keep the first.
      if (maybe && typeof maybe.then === "function")
        maybe.then(resolve, reject);
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}
