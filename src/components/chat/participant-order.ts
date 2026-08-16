/**
 * Who to show first in a member list.
 *
 * Every protocol that has a member list also has someone in charge of it, and
 * the reader looking one up is usually looking for exactly those people — who
 * to ask, who to report to. A flat list buries them among hundreds.
 *
 * The ranks are the union of what the adapters emit (`ParticipantRole`), not a
 * Concord-only ladder: NIP-53 says `host`, NIP-29 says `admin`, Concord says
 * `admin`/`moderator`. They collapse into one "Staff" section because a reader
 * scanning for authority does not care which word the protocol chose — the row
 * still carries the exact role beside the name.
 */

import type { Participant, ParticipantRole } from "@/types/chat";

/** Roles that mean "runs this room". Ordered: the list is sorted by this. */
const STAFF_ORDER: ParticipantRole[] = ["host", "admin", "op", "moderator"];

export function isStaff(role: ParticipantRole | undefined): boolean {
  return role !== undefined && STAFF_ORDER.includes(role);
}

/** A heading row, or a person. Fed straight to the list as one array. */
export type ParticipantRow =
  | { type: "heading"; label: string; count: number }
  | { type: "participant"; participant: Participant };

/**
 * Staff first under their own heading, then everyone else.
 *
 * A section with nothing in it gets no heading — a "Staff (0)" line tells the
 * reader nothing they could not see. And with no staff at all there is only one
 * group, so the "Members" heading goes too: a single heading over the whole
 * list is a label for the dropdown, which the dropdown already has.
 */
export function groupParticipants(
  participants: readonly Participant[],
): ParticipantRow[] {
  const staff = participants.filter((p) => isStaff(p.role));
  const rest = participants.filter((p) => !isStaff(p.role));
  if (staff.length === 0) {
    return rest.map((participant) => ({
      type: "participant" as const,
      participant,
    }));
  }
  staff.sort(
    (a, b) =>
      STAFF_ORDER.indexOf(a.role as ParticipantRole) -
      STAFF_ORDER.indexOf(b.role as ParticipantRole),
  );
  const rows: ParticipantRow[] = [
    { type: "heading", label: "Staff", count: staff.length },
    ...staff.map((participant) => ({
      type: "participant" as const,
      participant,
    })),
  ];
  if (rest.length > 0) {
    rows.push({ type: "heading", label: "Members", count: rest.length });
    for (const participant of rest) {
      rows.push({ type: "participant", participant });
    }
  }
  return rows;
}
