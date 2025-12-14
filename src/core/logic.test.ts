import { describe, it, expect } from "vitest";
import { findLowestAvailableWorkspaceNumber } from "./logic";

describe("findLowestAvailableWorkspaceNumber", () => {
  describe("basic number assignment", () => {
    it("should return 1 when no workspaces exist", () => {
      const result = findLowestAvailableWorkspaceNumber({});
      expect(result).toBe(1);
    });

    it("should return 2 when only workspace 1 exists", () => {
      const workspaces = {
        id1: { number: 1 },
      };
      const result = findLowestAvailableWorkspaceNumber(workspaces);
      expect(result).toBe(2);
    });

    it("should return 4 when workspaces 1, 2, 3 exist", () => {
      const workspaces = {
        id1: { number: 1 },
        id2: { number: 2 },
        id3: { number: 3 },
      };
      const result = findLowestAvailableWorkspaceNumber(workspaces);
      expect(result).toBe(4);
    });
  });

  describe("gap detection", () => {
    it("should return 2 when workspaces 1, 3, 4 exist", () => {
      const workspaces = {
        id1: { number: 1 },
        id3: { number: 3 },
        id4: { number: 4 },
      };
      const result = findLowestAvailableWorkspaceNumber(workspaces);
      expect(result).toBe(2);
    });

    it("should return 1 when workspaces 2, 3, 4 exist", () => {
      const workspaces = {
        id2: { number: 2 },
        id3: { number: 3 },
        id4: { number: 4 },
      };
      const result = findLowestAvailableWorkspaceNumber(workspaces);
      expect(result).toBe(1);
    });

    it("should return 3 when workspaces 1, 2, 4, 5 exist", () => {
      const workspaces = {
        id1: { number: 1 },
        id2: { number: 2 },
        id4: { number: 4 },
        id5: { number: 5 },
      };
      const result = findLowestAvailableWorkspaceNumber(workspaces);
      expect(result).toBe(3);
    });

    it("should return 2 when workspaces 1, 3 exist", () => {
      const workspaces = {
        id1: { number: 1 },
        id3: { number: 3 },
      };
      const result = findLowestAvailableWorkspaceNumber(workspaces);
      expect(result).toBe(2);
    });

    it("should return first gap when multiple gaps exist", () => {
      const workspaces = {
        id1: { number: 1 },
        id5: { number: 5 },
        id10: { number: 10 },
      };
      const result = findLowestAvailableWorkspaceNumber(workspaces);
      expect(result).toBe(2);
    });
  });

  describe("large numbers", () => {
    it("should return 3 when workspaces 1, 2, 100 exist", () => {
      const workspaces = {
        id1: { number: 1 },
        id2: { number: 2 },
        id100: { number: 100 },
      };
      const result = findLowestAvailableWorkspaceNumber(workspaces);
      expect(result).toBe(3);
    });

    it("should handle large sequential numbers correctly", () => {
      const workspaces = {
        id100: { number: 100 },
        id101: { number: 101 },
        id102: { number: 102 },
      };
      const result = findLowestAvailableWorkspaceNumber(workspaces);
      expect(result).toBe(1);
    });
  });

  describe("unordered workspaces", () => {
    it("should handle workspaces in random order", () => {
      const workspaces = {
        id5: { number: 5 },
        id1: { number: 1 },
        id3: { number: 3 },
        id7: { number: 7 },
      };
      const result = findLowestAvailableWorkspaceNumber(workspaces);
      expect(result).toBe(2);
    });

    it("should find lowest gap regardless of insertion order", () => {
      const workspaces = {
        id10: { number: 10 },
        id2: { number: 2 },
        id8: { number: 8 },
        id1: { number: 1 },
      };
      const result = findLowestAvailableWorkspaceNumber(workspaces);
      expect(result).toBe(3);
    });
  });
});
