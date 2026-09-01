// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { PaymentTargetList } from "./PaymentTarget";

// qrcode renders through a canvas, which jsdom does not implement.
vi.mock("qrcode", () => ({
  default: {
    toDataURL: vi.fn(async (text: string) => `data:image/png;base64,${text}`),
  },
}));

const BITCOIN = {
  type: "bitcoin",
  address: "bc1qxq66e0t8d7ugdecwnmv58e90tpry23nc84pg9k",
};
const UNKNOWN = { type: "unknowntype", address: "l7tbta5b9xze6ckkfc99uohzxd" };
const LIGHTNING = { type: "lightning", address: "alice@example.com" };

describe("PaymentTargetList", () => {
  it("labels every target, including one whose type it does not know", () => {
    render(<PaymentTargetList targets={[BITCOIN, UNKNOWN]} />);

    expect(screen.getByText("Bitcoin")).toBeTruthy();
    expect(screen.getByText("unknowntype")).toBeTruthy();
    expect(screen.getByText(BITCOIN.address)).toBeTruthy();
    expect(screen.getByText(UNKNOWN.address)).toBeTruthy();
  });

  it("opens a QR dialog with a wallet link for a known network", async () => {
    render(<PaymentTargetList targets={[BITCOIN]} />);

    fireEvent.click(screen.getByText("Bitcoin"));

    const link = await screen.findByRole("link", { name: /open in wallet/i });
    expect(link.getAttribute("href")).toBe(`bitcoin:${BITCOIN.address}`);

    await waitFor(() => {
      const qr = screen.getByRole("img", { name: /address QR code/i });
      expect(qr.getAttribute("src")).toContain(BITCOIN.address);
    });
  });

  it("renders a web payment target as a plain link, with no dialog", () => {
    render(
      <PaymentTargetList
        targets={[{ type: "geyser", address: "gitcitadel" }]}
      />,
    );

    const link = screen.getByRole("link", { name: /geyser/i });
    expect(link.getAttribute("href")).toBe(
      "https://geyser.fund/project/gitcitadel",
    );

    fireEvent.click(link);
    expect(screen.queryByRole("img", { name: /address QR code/i })).toBeNull();
  });

  it("shows a BIP-353 name once, and hands the wallet the bare name", async () => {
    render(
      <PaymentTargetList
        targets={[{ type: "bip353", address: "₿alice@example.com" }]}
      />,
    );

    // The row's mark is already a ₿; the text must not repeat it.
    expect(screen.queryByText("₿alice@example.com")).toBeNull();
    fireEvent.click(screen.getByText("alice@example.com"));

    // The dialog copies the shareable, ₿-prefixed form.
    expect(screen.getByText("₿alice@example.com")).toBeTruthy();

    const link = await screen.findByRole("link", { name: /open in wallet/i });
    expect(link.getAttribute("href")).toBe("bitcoin:alice@example.com");

    await waitFor(() => {
      const qr = screen.getByRole("img", { name: /address QR code/i });
      expect(qr.getAttribute("src")).toContain("bitcoin:alice@example.com");
    });
  });

  it("still offers a QR for an unknown type, but no wallet link", async () => {
    render(<PaymentTargetList targets={[UNKNOWN]} />);

    fireEvent.click(screen.getByText("unknowntype"));

    await waitFor(() => {
      const qr = screen.getByRole("img", { name: /address QR code/i });
      expect(qr.getAttribute("src")).toContain(UNKNOWN.address);
    });
    expect(screen.queryByRole("link", { name: /open in wallet/i })).toBeNull();
  });

  it("names the network on hover when labels are off", () => {
    render(<PaymentTargetList targets={[BITCOIN]} showLabels={false} />);

    expect(screen.queryByText("Bitcoin")).toBeNull();
    const row = screen.getByText(BITCOIN.address).closest("button");
    expect(row?.getAttribute("title")).toBe(`Bitcoin — ${BITCOIN.address}`);
  });

  it("hands a lightning target to the zap path instead of the dialog", () => {
    const onLightningClick = vi.fn();
    render(
      <PaymentTargetList
        targets={[LIGHTNING]}
        onLightningClick={onLightningClick}
      />,
    );

    fireEvent.click(screen.getByText("Lightning"));

    expect(onLightningClick).toHaveBeenCalledWith(LIGHTNING);
    expect(screen.queryByRole("img", { name: /address QR code/i })).toBeNull();
  });
});
