import { App } from "@capacitor/app";
import { SystemBars, SystemBarsStyle } from "@capacitor/core";
import { toast } from "sonner";
import { saveBlob } from "./files";
import { openExternal } from "./links";
import { classifyNavigation, isNativeApp } from "./platform";

/**
 * Android shell behaviour for the Capacitor build: the hardware Back button,
 * deep links, links that must leave the WebView, and system-bar contrast.
 *
 * Installed once, from main.tsx, only when `isNativeApp()`. The web build
 * never runs any of it.
 */

export interface ShellRouter {
  navigate: (to: string | number, opts?: { replace?: boolean }) => unknown;
  pathname: () => string;
}

export type BackAction =
  "dismiss-overlay" | "history-back" | "go-home" | "minimize";

/**
 * What one press of Back does, most specific first:
 *
 * 1. an open dialog, menu or popover closes;
 * 2. a route reached by navigation goes back to where it came from;
 * 3. a route opened directly (deep link, cold start) goes to the dashboard;
 * 4. on the dashboard the app is minimized, not finished.
 *
 * Windows are deliberately not closed by Back. In Grimoire they tile; they
 * are a workspace, not a stack of screens, and closing one loses its state.
 * Minimizing keeps everything exactly as it was when the user returns.
 */
export function decideBack(state: {
  overlayOpen: boolean;
  pathname: string;
  historyIndex: number;
}): BackAction {
  if (state.overlayOpen) return "dismiss-overlay";
  if (state.historyIndex > 0) return "history-back";
  if (state.pathname !== "/") return "go-home";
  return "minimize";
}

const OVERLAY_SELECTOR = [
  '[role="dialog"][data-state="open"]',
  '[role="alertdialog"][data-state="open"]',
  '[role="menu"][data-state="open"]',
  '[role="listbox"][data-state="open"]',
  "[data-radix-popper-content-wrapper]",
].join(",");

function overlayOpen(): boolean {
  return document.querySelector(OVERLAY_SELECTOR) !== null;
}

/** Radix layers close on Escape from the document; send them one. */
function dismissTopOverlay(): void {
  const target = document.activeElement ?? document.body;
  target.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "Escape",
      code: "Escape",
      bubbles: true,
      cancelable: true,
    }),
  );
}

function historyIndex(): number {
  const state = window.history.state as { idx?: unknown } | null;
  return typeof state?.idx === "number" ? state.idx : 0;
}

let lastLink: { href: string; at: number } | null = null;

function routeTo(router: ShellRouter, href: string, source: string): boolean {
  const target = classifyNavigation(href, window.location.origin);
  if (target.kind === "internal") {
    // A cold start delivers the launch link twice (getLaunchUrl and
    // appUrlOpen), before either navigation has committed; navigating twice
    // left a duplicate history entry and Back had to be pressed once more.
    if (source !== "window.open") {
      const now = Date.now();
      if (lastLink && lastLink.href === href && now - lastLink.at < 3000) {
        return true;
      }
      lastLink = { href, at: now };
    }
    void router.navigate(target.path);
    return true;
  }
  if (target.kind === "blocked") {
    console.warn(`[native] ${source} refused: ${target.reason}`);
  }
  return false;
}

/** Relative luminance of an `rgb()`/`rgba()` colour, or null. */
export function luminance(cssColor: string): number | null {
  const m = cssColor.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/);
  if (!m) return null;
  const [r, g, b] = [m[1], m[2], m[3]].map((v) => {
    const c = Number(v) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Light icons on a dark theme, dark icons on a light one. */
function syncSystemBars(): void {
  const bg = getComputedStyle(document.body).backgroundColor;
  const lum = luminance(bg);
  if (lum === null) return;
  void SystemBars.setStyle({
    style: lum < 0.4 ? SystemBarsStyle.Dark : SystemBarsStyle.Light,
  }).catch(() => undefined);
}

function interceptLinks(router: ShellRouter): void {
  document.addEventListener(
    "click",
    (event) => {
      if (event.defaultPrevented) return;
      const anchor = (event.target as Element | null)?.closest?.("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) return;
      const href = anchor.getAttribute("href") ?? "";

      // A blob/data download: a WebView drops these on the floor.
      if (anchor.hasAttribute("download") && /^(blob|data):/.test(href)) {
        event.preventDefault();
        const name = anchor.getAttribute("download") || "download";
        void fetch(anchor.href)
          .then((r) => r.blob())
          .then((blob) => saveBlob(blob, name))
          .catch((error: unknown) => {
            toast.error("Download failed", { description: String(error) });
          });
        return;
      }

      const target = classifyNavigation(anchor.href, window.location.origin);
      if (target.kind === "internal") {
        // Same-tab in-app links are the router's business already; only a
        // `target=_blank` or a canonical grimoire.rocks link needs help.
        const sameOrigin =
          new URL(anchor.href).origin === window.location.origin;
        if (sameOrigin && anchor.target !== "_blank") return;
        event.preventDefault();
        void router.navigate(target.path);
        return;
      }
      event.preventDefault();
      if (target.kind === "external") {
        void openExternal(target.url);
      } else {
        toast.error("Link not opened", { description: target.reason });
      }
    },
    true,
  );

  // window.open has 12 call sites; route them all here rather than editing
  // each. Nothing in the app reads the returned window.
  window.open = ((url?: string | URL) => {
    if (!url) return null;
    const href = String(url);
    if (!routeTo(router, href, "window.open")) {
      const target = classifyNavigation(href, window.location.origin);
      if (target.kind === "external") void openExternal(target.url);
      else if (target.kind === "blocked") {
        toast.error("Link not opened", { description: target.reason });
      }
    }
    return null;
  }) as typeof window.open;
}

export async function installNativeShell(router: ShellRouter): Promise<void> {
  if (!isNativeApp()) return;
  document.documentElement.dataset.native = "android";

  interceptLinks(router);

  await App.addListener("backButton", () => {
    const action = decideBack({
      overlayOpen: overlayOpen(),
      pathname: router.pathname(),
      historyIndex: historyIndex(),
    });
    switch (action) {
      case "dismiss-overlay":
        dismissTopOverlay();
        break;
      case "history-back":
        void router.navigate(-1);
        break;
      case "go-home":
        void router.navigate("/", { replace: true });
        break;
      case "minimize":
        void App.minimizeApp();
        break;
    }
  });

  // Warm start: the app is running and another app hands it a link.
  await App.addListener("appUrlOpen", ({ url }) => {
    routeTo(router, url, "deep link");
  });

  // Cold start: the link that launched the process.
  const launch = await App.getLaunchUrl().catch(() => undefined);
  if (launch?.url) routeTo(router, launch.url, "launch link");

  syncSystemBars();
  new MutationObserver(syncSystemBars).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["style", "class"],
  });
}
