/**
 * NIP-34 fixtures shaped after events sampled read-only from
 * `wss://relay.ngit.dev` in November 2026: the same tag layouts, with
 * identities replaced. Unsigned on purpose: the pubkeys below are constants
 * no secret key was ever derived for, and `sig` is all zeros, so none of
 * these can be published or mistaken for a real event.
 */
import type { NostrEvent } from "@/types/nostr";

export const OWNER = "a".repeat(64);
export const CONTRIBUTOR = "b".repeat(64);
export const ROOT_ID = "1".repeat(64);
export const PR_ID = "2".repeat(64);
export const COMMIT = "58f8b4b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6";

let counter = 0;

export function gitEvent(
  kind: number,
  tags: string[][],
  content = "",
  overrides: Partial<NostrEvent> = {},
): NostrEvent {
  counter += 1;
  return {
    id: counter.toString(16).padStart(64, "f"),
    pubkey: CONTRIBUTOR,
    created_at: 1_790_000_000 + counter,
    kind,
    tags,
    content,
    sig: "0".repeat(128),
    ...overrides,
  };
}

export const repoCoordinate = (identifier: string, owner = OWNER) =>
  `30617:${owner}:${identifier}`;

/** A pull request as ngit publishes one: Markdown body, title in `subject`. */
export const pullRequest = gitEvent(
  1618,
  [
    ["a", repoCoordinate("darkmatter-linux")],
    ["p", OWNER],
    ["subject", "Enable in-app YouTube playback"],
    ["c", COMMIT],
    ["clone", "https://example.com/darkmatter-linux.git"],
    ["branch-name", "youtube-playback"],
  ],
  "<sub>FEATURE&ensp;·&ensp;CHAT MEDIA</sub>\n\n### A shared video can stay",
  { id: PR_ID },
);

export const issue = gitEvent(
  1621,
  [
    ["a", repoCoordinate("paff")],
    ["p", OWNER],
    ["subject", "Every unhandled promise rejection is logged and ignored"],
  ],
  "`daemon/src/index.ts:55`:\n\n```ts\nprocess.on('unhandledRejection'",
  { id: ROOT_ID },
);

/** A patch has no `subject` tag: the title is in the format-patch header. */
export const patch = gitEvent(
  1617,
  [
    ["a", repoCoordinate("ngit")],
    ["p", OWNER],
    ["t", "root"],
    ["commit", COMMIT],
  ],
  `From ${COMMIT} Mon Sep 17 00:00:00 2001\nFrom: someone <s@example.com>\nSubject: [PATCH 1/3] fix: retry relay connection after timeout\n\n---\n diff --git a/x b/x`,
);

/** Kind 1619: empty content, the PR in `E`, the new tip in `c`. */
export const pullRequestUpdate = gitEvent(1619, [
  ["a", repoCoordinate("darkmatter-linux")],
  ["E", PR_ID],
  ["P", CONTRIBUTOR],
  ["c", COMMIT],
  ["clone", "https://example.com/darkmatter-linux.git"],
]);

export const statusOpened = gitEvent(
  1630,
  [
    ["e", ROOT_ID, "", "root"],
    ["a", repoCoordinate("paff")],
  ],
  "Opened issue",
);

/** A merge: empty content, `q` per applied patch, the merge commit. */
export const statusMerged = gitEvent(1631, [
  ["e", PR_ID, "", "root"],
  ["a", repoCoordinate("darkmatter-linux")],
  ["q", PR_ID, "", CONTRIBUTOR],
  ["merge-commit", COMMIT],
]);

/** A 1631 with no merge evidence and a comment full of references. */
export const statusResolved = gitEvent(
  1631,
  [
    ["e", ROOT_ID, "", "root"],
    ["a", repoCoordinate("paff")],
  ],
  "Fixed in nostr:nevent1qqsw8rjmt46gykfv6q8cw549dduuauugl4l8mdhnxtgtyl9lckf https://example.com/c/abc and released",
);

export const statusClosed = gitEvent(
  1632,
  [
    ["e", "3".repeat(64), "", "root"],
    ["a", repoCoordinate("wyrd")],
  ],
  "not worth it",
);

export const statusDraft = gitEvent(
  1633,
  [
    ["e", PR_ID, "", "root"],
    ["a", repoCoordinate("darkmatter-linux")],
  ],
  "work in progress",
);

export const repository = gitEvent(
  30617,
  [
    ["d", "nostube"],
    ["name", "nostube"],
    ["description", "Monorepo for Nostube,\nan open-source video platform"],
    ["clone", "https://example.com/nostube.git"],
  ],
  "",
  { pubkey: OWNER },
);

/** Seen in the wild: the `d` tag is `<64 hex>/<name>`. */
export const repositoryWithPathIdentifier = gitEvent(
  30617,
  [
    ["d", `${OWNER}/gamestr`],
    ["name", "gamestr"],
  ],
  "",
  { pubkey: OWNER },
);

export const repositoryState = gitEvent(
  30618,
  [
    ["d", "PIPE-NERD"],
    ["HEAD", "ref: refs/heads/main"],
    ["refs/heads/main", COMMIT],
    ["refs/heads/dev", "c".repeat(40)],
    ["refs/tags/v1.0.0", "d".repeat(40)],
  ],
  "",
  { pubkey: OWNER },
);
