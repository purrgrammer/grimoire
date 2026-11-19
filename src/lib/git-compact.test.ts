import { describe, expect, it } from "vitest";
import {
  getGitRepositoryRef,
  getGitStatusVerb,
  getGitSubject,
  getPullRequestUpdateTargetId,
  getRepositoryStateSummary,
  getStatusComment,
  getStatusMergeCommit,
  getStatusRootId,
  getTicketNoun,
  parseRepositoryCoordinate,
  shortCommit,
  singleLine,
} from "./git-compact";
import {
  COMMIT,
  OWNER,
  PR_ID,
  ROOT_ID,
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

describe("singleLine", () => {
  it("collapses newlines, tabs and control characters to one space", () => {
    expect(singleLine("a\n\n\tb\u0000c\u007f d")).toBe("a b c d");
  });

  it("is undefined for empty, blank and non-string values", () => {
    expect(singleLine("")).toBeUndefined();
    expect(singleLine(" \n\t ")).toBeUndefined();
    expect(singleLine(undefined)).toBeUndefined();
    expect(singleLine(42 as unknown as string)).toBeUndefined();
  });
});

describe("shortCommit", () => {
  it("shortens a hex commit id to seven lowercase characters", () => {
    expect(shortCommit(COMMIT)).toBe("58f8b4b");
    expect(shortCommit("ABCDEF1234")).toBe("abcdef1");
  });

  it("rejects anything that is not a commit id", () => {
    expect(shortCommit("unknown")).toBeUndefined();
    expect(shortCommit("abc")).toBeUndefined();
    expect(shortCommit("<script>alert(1)</script>")).toBeUndefined();
    expect(shortCommit(undefined)).toBeUndefined();
    expect(shortCommit("f".repeat(65))).toBeUndefined();
  });
});

describe("parseRepositoryCoordinate", () => {
  it("names the repository of a well-formed coordinate", () => {
    expect(parseRepositoryCoordinate(repoCoordinate("paff"))).toEqual({
      identifier: "paff",
      label: "paff",
    });
  });

  it("keeps colons that belong to the identifier", () => {
    expect(parseRepositoryCoordinate(repoCoordinate("a:b:c"))?.identifier).toBe(
      "a:b:c",
    );
  });

  it("labels a path-like identifier with its last segment", () => {
    expect(
      parseRepositoryCoordinate(repoCoordinate(`${OWNER}/gamestr`)),
    ).toEqual({ identifier: `${OWNER}/gamestr`, label: "gamestr" });
    expect(parseRepositoryCoordinate(repoCoordinate("org/repo/"))?.label).toBe(
      "repo",
    );
    expect(parseRepositoryCoordinate(repoCoordinate("///"))?.label).toBe("///");
  });

  it.each([
    ["no separators", "garbage"],
    ["one separator", "30617:only"],
    ["empty identifier", `30617:${OWNER}:`],
    ["blank identifier", `30617:${OWNER}: \n `],
    ["pubkey that is not hex", "30617:nothex:repo"],
    ["another kind", `30023:${OWNER}:repo`],
    ["kind that is not a number", `x:${OWNER}:repo`],
    ["empty string", ""],
    ["not a string", undefined],
  ])("is undefined for %s", (_name, value) => {
    expect(parseRepositoryCoordinate(value)).toBeUndefined();
  });
});

describe("getGitRepositoryRef", () => {
  it("reads the `a` coordinate of tickets, updates and statuses", () => {
    expect(getGitRepositoryRef(issue)?.label).toBe("paff");
    expect(getGitRepositoryRef(pullRequest)?.label).toBe("darkmatter-linux");
    expect(getGitRepositoryRef(patch)?.label).toBe("ngit");
    expect(getGitRepositoryRef(pullRequestUpdate)?.label).toBe(
      "darkmatter-linux",
    );
    expect(getGitRepositoryRef(statusClosed)?.label).toBe("wyrd");
  });

  it("reads the `d` tag of a repository and of its state", () => {
    expect(getGitRepositoryRef(repository)?.label).toBe("nostube");
    expect(getGitRepositoryRef(repositoryState)?.label).toBe("PIPE-NERD");
    expect(getGitRepositoryRef(repositoryWithPathIdentifier)).toEqual({
      identifier: `${OWNER}/gamestr`,
      label: "gamestr",
    });
  });

  it("skips malformed coordinates and takes the first sound one", () => {
    const event = gitEvent(1621, [
      ["a"],
      ["a", "garbage"],
      ["a", `30023:${OWNER}:an-article`],
      ["a", repoCoordinate("real-repo"), "wss://relay.example.com"],
    ]);
    expect(getGitRepositoryRef(event)?.label).toBe("real-repo");
  });

  it("is undefined when nothing names a repository", () => {
    expect(getGitRepositoryRef(gitEvent(1621, []))).toBeUndefined();
    expect(getGitRepositoryRef(gitEvent(1630, [["a", "x"]]))).toBeUndefined();
    expect(getGitRepositoryRef(gitEvent(30618, []))).toBeUndefined();
    expect(getGitRepositoryRef(gitEvent(30617, [["d", ""]]))).toBeUndefined();
  });
});

describe("getGitSubject", () => {
  it("reads the subject tag of an issue and of a pull request", () => {
    expect(getGitSubject(issue)).toBe(
      "Every unhandled promise rejection is logged and ignored",
    );
    expect(getGitSubject(pullRequest)).toBe("Enable in-app YouTube playback");
  });

  it("reads a patch's title from its format-patch Subject header", () => {
    expect(getGitSubject(patch)).toBe(
      "[PATCH 1/3] fix: retry relay connection after timeout",
    );
  });

  it("flattens a subject that spans lines", () => {
    const event = gitEvent(1621, [["subject", "one\ntwo\t three"]]);
    expect(getGitSubject(event)).toBe("one two three");
  });

  it("is undefined when there is none", () => {
    expect(getGitSubject(gitEvent(1621, [], "body only"))).toBeUndefined();
    expect(getGitSubject(gitEvent(1618, [["subject", "  "]]))).toBeUndefined();
    expect(getGitSubject(gitEvent(1617, [], ""))).toBeUndefined();
    expect(getGitSubject(gitEvent(1617, [["subject"]], ""))).toBeUndefined();
  });
});

describe("references to other events", () => {
  it("finds the root a status marks", () => {
    expect(getStatusRootId(statusOpened)).toBe(ROOT_ID);
    expect(getStatusRootId(statusMerged)).toBe(PR_ID);
  });

  it("prefers the e tag marked root over an earlier reply", () => {
    const event = gitEvent(1631, [
      ["e", "4".repeat(64), "", "reply"],
      ["e", ROOT_ID, "", "root"],
    ]);
    expect(getStatusRootId(event)).toBe(ROOT_ID);
  });

  it("has no root when the e tag is missing or is not an event id", () => {
    expect(getStatusRootId(gitEvent(1630, []))).toBeUndefined();
    expect(getStatusRootId(gitEvent(1630, [["e"]]))).toBeUndefined();
    expect(
      getStatusRootId(gitEvent(1630, [["e", "not-an-id", "", "root"]])),
    ).toBeUndefined();
  });

  it("finds the pull request an update moves, from E and not e", () => {
    expect(getPullRequestUpdateTargetId(pullRequestUpdate)).toBe(PR_ID);
    expect(
      getPullRequestUpdateTargetId(gitEvent(1619, [["e", PR_ID]])),
    ).toBeUndefined();
    expect(
      getPullRequestUpdateTargetId(gitEvent(1619, [["E", "nope"]])),
    ).toBeUndefined();
  });
});

describe("getGitStatusVerb", () => {
  it("maps the unambiguous kinds", () => {
    expect(getGitStatusVerb(statusOpened)).toBe("opened");
    expect(getGitStatusVerb(statusClosed)).toBe("closed");
    expect(getGitStatusVerb(statusDraft)).toBe("draft");
  });

  it("reads 1631 as merged when the event carries merge evidence", () => {
    expect(getGitStatusVerb(statusMerged)).toBe("merged");
    expect(
      getGitStatusVerb(gitEvent(1631, [["applied-as-commits", COMMIT]])),
    ).toBe("merged");
  });

  it("reads 1631 as resolved when it carries none", () => {
    expect(getGitStatusVerb(statusResolved)).toBe("resolved");
  });

  it("lets the root's kind decide once the root is known", () => {
    expect(getGitStatusVerb(statusResolved, pullRequest)).toBe("merged");
    expect(getGitStatusVerb(statusResolved, patch)).toBe("merged");
    expect(getGitStatusVerb(statusMerged, issue)).toBe("resolved");
  });

  it("is undefined for a kind that is not a status", () => {
    expect(getGitStatusVerb(issue)).toBeUndefined();
  });
});

describe("status details", () => {
  it("strips links and nostr references from a comment", () => {
    expect(getStatusComment(statusResolved)).toBe("Fixed in and released");
    expect(getStatusComment(statusClosed)).toBe("not worth it");
  });

  it("has no comment when the content is empty or only references", () => {
    expect(getStatusComment(statusMerged)).toBeUndefined();
    expect(
      getStatusComment(gitEvent(1631, [], "nostr:nevent1qqs https://x.y/z")),
    ).toBeUndefined();
    expect(
      getStatusComment(
        gitEvent(1631, [], undefined as unknown as string, {
          content: undefined as unknown as string,
        }),
      ),
    ).toBeUndefined();
  });

  it("reads the merge commit of a 1631 only", () => {
    expect(getStatusMergeCommit(statusMerged)).toBe("58f8b4b");
    expect(getStatusMergeCommit(statusResolved)).toBeUndefined();
    expect(
      getStatusMergeCommit(gitEvent(1632, [["merge-commit", COMMIT]])),
    ).toBeUndefined();
    expect(
      getStatusMergeCommit(gitEvent(1631, [["merge-commit", "zzz"]])),
    ).toBeUndefined();
  });

  it("names the kind of ticket a root is", () => {
    expect(getTicketNoun(issue)).toBe("issue");
    expect(getTicketNoun(pullRequest)).toBe("pull request");
    expect(getTicketNoun(patch)).toBe("patch");
    expect(getTicketNoun(repository)).toBe("");
    expect(getTicketNoun(undefined)).toBe("");
  });
});

describe("getRepositoryStateSummary", () => {
  it("reads the HEAD branch, its commit and the ref count", () => {
    expect(getRepositoryStateSummary(repositoryState)).toEqual({
      branch: "main",
      commit: "58f8b4b",
      refCount: 3,
    });
  });

  it("has no commit when HEAD names a branch the event does not list", () => {
    const event = gitEvent(30618, [
      ["d", "x"],
      ["HEAD", "ref: refs/heads/gone"],
      ["refs/heads/main", COMMIT],
    ]);
    expect(getRepositoryStateSummary(event)).toEqual({
      branch: "gone",
      commit: undefined,
      refCount: 1,
    });
  });

  it("survives a state with no HEAD, a malformed HEAD or no refs", () => {
    expect(getRepositoryStateSummary(gitEvent(30618, [["d", "x"]]))).toEqual({
      branch: undefined,
      commit: undefined,
      refCount: 0,
    });
    expect(
      getRepositoryStateSummary(
        gitEvent(30618, [
          ["HEAD", "detached"],
          ["refs/heads/main", "not-a-hash"],
        ]),
      ),
    ).toEqual({ branch: undefined, commit: undefined, refCount: 1 });
  });
});
