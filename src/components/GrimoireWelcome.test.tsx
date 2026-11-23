// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { GrimoireWelcome } from "./GrimoireWelcome";
import { parseAndExecuteCommand } from "@/lib/command-parser";
import { SPELL_KIND, SPELLBOOK_KIND } from "@/constants/kinds";

// Only the network resolvers are faked: the welcome screen must not reach a
// NIP-05 server or a relay to prove what its suggestion would open.
const PUBKEY = "a".repeat(64);
const resolveNip05Batch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/nip05", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/nip05")>()),
  resolveNip05Batch,
  resolveDomainDirectoryBatch: vi.fn(async () => new Map()),
}));

const SPELLS_COMMAND = "req -k 777,30777 -a verbiricha@grimoire.rocks";

afterEach(cleanup);

describe("GrimoireWelcome suggestions", () => {
  it("offers the spells/spellbooks query in place of the welcome chat", () => {
    render(
      <GrimoireWelcome onLaunchCommand={vi.fn()} onExecuteCommand={vi.fn()} />,
    );

    expect(screen.getByText(SPELLS_COMMAND)).toBeTruthy();
    expect(
      screen.getByText("Browse spells and spellbooks by verbiricha"),
    ).toBeTruthy();
    expect(screen.queryByText(/^chat /)).toBeNull();
    expect(screen.queryByText("Join the Grimoire welcome chat")).toBeNull();
  });

  it("executes the exact command string when clicked", () => {
    const onExecuteCommand = vi.fn();
    render(
      <GrimoireWelcome
        onLaunchCommand={vi.fn()}
        onExecuteCommand={onExecuteCommand}
      />,
    );

    fireEvent.click(screen.getByText(SPELLS_COMMAND));

    expect(onExecuteCommand).toHaveBeenCalledTimes(1);
    expect(onExecuteCommand).toHaveBeenCalledWith(SPELLS_COMMAND);
  });

  it("the query parses, unchanged, into a req window for spells and spellbooks", async () => {
    resolveNip05Batch.mockImplementation(
      async (ids: string[]) => new Map(ids.map((id) => [id, PUBKEY])),
    );

    const result = await parseAndExecuteCommand(SPELLS_COMMAND);

    expect(result.error).toBeUndefined();
    expect(result.command?.appId).toBe("req");
    expect(result.props.filter.kinds).toEqual([SPELL_KIND, SPELLBOOK_KIND]);
    expect(result.props.filter.authors).toEqual([PUBKEY]);
    expect(resolveNip05Batch).toHaveBeenCalledWith([
      "verbiricha@grimoire.rocks",
    ]);
  });
});
