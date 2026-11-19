// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { ComponentType } from "react";

import type { NostrEvent } from "@/types/nostr";
import {
  GitStatusCompactPreview,
  GitTicketCompactPreview,
  PullRequestUpdateCompactPreview,
  RepositoryCompactPreview,
  RepositoryStateCompactPreview,
} from "./GitCompactPreviews";
import {
  OWNER,
  gitEvent,
  issue,
  patch,
  pullRequest,
  pullRequestUpdate,
  repoCoordinate,
  repository,
  repositoryState,
  repositoryWithPathIdentifier,
  statusClosed,
  statusDraft,
  statusMerged,
  statusOpened,
  statusResolved,
} from "@/test/git-fixtures";

/**
 * What a row says, for each git kind, with and without the event it points at.
 *
 * The EventStore is replaced by a map, so "the ticket is in hand" and "the
 * ticket never arrived" are both one line of setup. The loaders are replaced
 * by spies that must stay untouched: a compact row reads the store and never
 * asks a relay, and the last test fails if a later change reaches for
 * `useNostrEvent` to fill a title in.
 */
const stored = new Map<string, NostrEvent>();
const storeReads = vi.fn();

vi.mock("applesauce-react/hooks", () => ({
  useEventStore: () => ({
    event: (id: string) => {
      storeReads(id);
      return stored.get(id);
    },
  }),
  use$: (factory: () => unknown) => factory(),
}));

const loaderCalls = vi.hoisted(() => vi.fn());
vi.mock("@/services/loaders", () => ({
  eventLoader: loaderCalls,
  addressLoader: loaderCalls,
  batchedAddressLoader: loaderCalls,
  profileLoader: loaderCalls,
}));

afterEach(() => {
  cleanup();
  stored.clear();
  storeReads.mockClear();
});

type Preview = ComponentType<{ event: NostrEvent }>;

/** The row's words in order, one entry per visible part. */
function parts(Component: Preview, event: NostrEvent): string[] {
  const { container } = render(<Component event={event} />);
  const row = container.firstElementChild;
  expect(container.children).toHaveLength(1);
  expect(row?.tagName).toBe("SPAN");
  return [...(row?.children ?? [])].map((el) => el.textContent ?? "");
}

describe("tickets (1617, 1618, 1621)", () => {
  it("shows the repository and the title", () => {
    expect(parts(GitTicketCompactPreview, issue)).toEqual([
      "paff",
      "Every unhandled promise rejection is logged and ignored",
    ]);
    expect(parts(GitTicketCompactPreview, pullRequest)).toEqual([
      "darkmatter-linux",
      "Enable in-app YouTube playback",
    ]);
    expect(parts(GitTicketCompactPreview, patch)).toEqual([
      "ngit",
      "[PATCH 1/3] fix: retry relay connection after timeout",
    ]);
  });

  it("says what is missing instead of showing an empty row", () => {
    expect(parts(GitTicketCompactPreview, gitEvent(1621, []))).toEqual([
      "Untitled issue",
    ]);
    expect(parts(GitTicketCompactPreview, gitEvent(1617, [], ""))).toEqual([
      "Untitled patch",
    ]);
    expect(
      parts(
        GitTicketCompactPreview,
        gitEvent(1618, [["a", repoCoordinate("din")]]),
      ),
    ).toEqual(["din", "Untitled pull request"]);
  });

  it("drops a malformed repository coordinate and keeps the title", () => {
    const event = gitEvent(1621, [
      ["a", "garbage"],
      ["a", "30617:nothex:x"],
      ["subject", "Still has a title"],
    ]);
    expect(parts(GitTicketCompactPreview, event)).toEqual([
      "Still has a title",
    ]);
  });

  it("renders markup in a subject as text, on one line", () => {
    const hostile = "<img src=x onerror=alert(1)>\n\tline two <b>bold</b>";
    const event = gitEvent(1621, [["subject", hostile]]);
    const { container } = render(<GitTicketCompactPreview event={event} />);
    expect(container.querySelector("img, b, script, a")).toBeNull();
    expect(container.textContent).toBe(
      "<img src=x onerror=alert(1)> line two <b>bold</b>",
    );
  });

  it("keeps the repository visible at every width only when untitled", () => {
    const titled = render(<GitTicketCompactPreview event={issue} />);
    expect(titled.container.querySelector("[title=paff]")?.className).toContain(
      "hidden @sm:block",
    );
    cleanup();
    const untitled = render(
      <GitTicketCompactPreview
        event={gitEvent(1621, [["a", repoCoordinate("paff")]])}
      />,
    );
    expect(
      untitled.container.querySelector("[title=paff]")?.className,
    ).not.toContain("hidden");
  });
});

describe("pull request update (1619)", () => {
  it("stands on its own tags when the pull request is not in the store", () => {
    expect(parts(PullRequestUpdateCompactPreview, pullRequestUpdate)).toEqual([
      "darkmatter-linux",
      "pushed",
      "58f8b4b",
      "to a pull request",
    ]);
  });

  it("names the pull request once it is in the store", () => {
    stored.set(pullRequest.id, pullRequest);
    expect(parts(PullRequestUpdateCompactPreview, pullRequestUpdate)).toEqual([
      "darkmatter-linux",
      "pushed",
      "58f8b4b",
      "Enable in-app YouTube playback",
    ]);
  });

  it("does not invent a commit when the c tag is missing or malformed", () => {
    expect(
      parts(PullRequestUpdateCompactPreview, gitEvent(1619, [["c", "HEAD"]])),
    ).toEqual(["updated", "a pull request"]);
  });
});

describe("status (1630–1633)", () => {
  it("reads as a sentence from tags alone", () => {
    expect(parts(GitStatusCompactPreview, statusClosed)).toEqual([
      "wyrd",
      "closed",
      "not worth it",
    ]);
    expect(parts(GitStatusCompactPreview, statusMerged)).toEqual([
      "darkmatter-linux",
      "merged",
      "58f8b4b",
    ]);
    expect(parts(GitStatusCompactPreview, statusResolved)).toEqual([
      "paff",
      "resolved",
      "Fixed in and released",
    ]);
  });

  it("names the ticket once it is in the store", () => {
    stored.set(issue.id, issue);
    stored.set(pullRequest.id, pullRequest);
    expect(parts(GitStatusCompactPreview, statusOpened)).toEqual([
      "paff",
      "opened",
      "Every unhandled promise rejection is logged and ignored",
      "Opened issue",
    ]);
    expect(parts(GitStatusCompactPreview, statusDraft)).toEqual([
      "darkmatter-linux",
      "draft",
      "Enable in-app YouTube playback",
      "work in progress",
    ]);
  });

  it("corrects resolved to merged when the root turns out to be a PR", () => {
    const status = gitEvent(1631, [["e", pullRequest.id, "", "root"]]);
    expect(parts(GitStatusCompactPreview, status)).toEqual(["resolved"]);
    cleanup();
    stored.set(pullRequest.id, pullRequest);
    expect(parts(GitStatusCompactPreview, status)).toEqual([
      "merged",
      "Enable in-app YouTube playback",
    ]);
  });

  it("says so when the stored ticket has no title", () => {
    const untitled = gitEvent(1621, []);
    stored.set(untitled.id, untitled);
    const status = gitEvent(1632, [["e", untitled.id, "", "root"]]);
    expect(parts(GitStatusCompactPreview, status)).toEqual([
      "closed",
      "an untitled issue",
    ]);
  });

  it("does not look anything up for a root that is not an event id", () => {
    const status = gitEvent(1630, [
      ["e", "not-an-id", "", "root"],
      ["a", `30617:${OWNER}:`],
    ]);
    expect(parts(GitStatusCompactPreview, status)).toEqual(["opened"]);
    expect(storeReads).not.toHaveBeenCalled();
  });
});

describe("repository (30617)", () => {
  it("shows the name and a one-line description", () => {
    expect(parts(RepositoryCompactPreview, repository)).toEqual([
      "nostube",
      "Monorepo for Nostube, an open-source video platform",
    ]);
  });

  it("falls back to the identifier, then says it is unnamed", () => {
    expect(
      parts(RepositoryCompactPreview, gitEvent(30617, [["d", "only-a-slug"]])),
    ).toEqual(["only-a-slug"]);
    expect(
      parts(
        RepositoryCompactPreview,
        gitEvent(30617, [["d", `${OWNER}/gamestr`]]),
      ),
    ).toEqual(["gamestr"]);
    expect(parts(RepositoryCompactPreview, gitEvent(30617, []))).toEqual([
      "Unnamed repository",
    ]);
    expect(
      parts(RepositoryCompactPreview, repositoryWithPathIdentifier),
    ).toEqual(["gamestr"]);
  });
});

describe("repository state (30618)", () => {
  it("shows the repository, its HEAD branch and commit", () => {
    expect(parts(RepositoryStateCompactPreview, repositoryState)).toEqual([
      "PIPE-NERD",
      "main",
      "58f8b4b",
    ]);
  });

  it("counts refs when there is no HEAD", () => {
    const noHead = gitEvent(30618, [
      ["d", "toolkit"],
      ["refs/heads/trunk", "c".repeat(40)],
    ]);
    expect(parts(RepositoryStateCompactPreview, noHead)).toEqual([
      "toolkit",
      "1 ref",
    ]);
    expect(
      parts(RepositoryStateCompactPreview, gitEvent(30618, [["d", "empty"]])),
    ).toEqual(["empty", "no refs"]);
    expect(parts(RepositoryStateCompactPreview, gitEvent(30618, []))).toEqual([
      "Unnamed repository",
      "no refs",
    ]);
  });
});

describe("every preview", () => {
  const cases: [string, Preview, NostrEvent][] = [
    ["issue", GitTicketCompactPreview, issue],
    ["pull request", GitTicketCompactPreview, pullRequest],
    ["patch", GitTicketCompactPreview, patch],
    ["update", PullRequestUpdateCompactPreview, pullRequestUpdate],
    ["opened", GitStatusCompactPreview, statusOpened],
    ["merged", GitStatusCompactPreview, statusMerged],
    ["resolved", GitStatusCompactPreview, statusResolved],
    ["closed", GitStatusCompactPreview, statusClosed],
    ["draft", GitStatusCompactPreview, statusDraft],
    ["repository", RepositoryCompactPreview, repository],
    ["state", RepositoryStateCompactPreview, repositoryState],
  ];

  it.each(cases)("%s: one flat row, no click target, no fetch", (_n, C, e) => {
    const { container } = render(<C event={e} />);
    const row = container.firstElementChild as HTMLElement;
    // One line: a single flex row whose parts cannot wrap or stack.
    expect(row.className).toContain("flex");
    expect(row.className).not.toContain("flex-col");
    expect(row.className).not.toContain("flex-wrap");
    expect(row.querySelector("div, p, br, ul, li")).toBeNull();
    for (const part of row.children) {
      expect(part.children).toHaveLength(0);
      expect(part.className).toMatch(/truncate|shrink-0/);
    }
    // The row opens the event; nothing inside competes for the click.
    expect(row.querySelector("a, button, [role], [onclick]")).toBeNull();
    expect(loaderCalls).not.toHaveBeenCalled();
  });
});
