/**
 * Concord roles & permissions — CORD-04.
 *
 * Ported from armada `bc19d1f` (`src/concord/lib/roles.ts`), read side only:
 * grimoire never mints, reorders or grants a Role, so the publish- and
 * UI-side helpers are not ported — `roleToJSON`, `grantToJSON`,
 * `mintablePosition`, `accessRolePosition`, `grantRefusal`, `projectReorder`,
 * `normalizeOrder`, `rolesMakeStaff`, `hexToColor`, `PERMISSION_LABELS`,
 * `MODERATOR_ALL`, `adminRole`, `moderatorRole`. Everything armada's control
 * fold imports IS here; that list was checked symbol by symbol.
 *
 * Two kinds of permission, enforced two ways: READ access is key possession
 * (never a permission bit); WRITE authority is a member's rank in the
 * owner-rooted Roster. Bit positions are FROZEN wire format. `permissions`
 * rides the wire as a DECIMAL STRING (a JSON number is a float in JS and
 * silently corrupts past 2^53); a reader accepts either form.
 */

export const Permissions = {
  MANAGE_ROLES: 1n << 0n,
  MANAGE_CHANNELS: 1n << 1n,
  MANAGE_METADATA: 1n << 2n,
  KICK: 1n << 3n,
  BAN: 1n << 4n,
  MANAGE_MESSAGES: 1n << 5n,
  CREATE_INVITE: 1n << 6n,
  // 1<<7 RETIRED (was MANAGE_INVITES).
  VIEW_AUDIT_LOG: 1n << 8n,
  MENTION_EVERYONE: 1n << 9n,
  PIN_MESSAGES: 1n << 11n,
  // Reserved: MANAGE_EMOJI=1<<10, MANAGE_EVENTS=1<<12.
} as const;

/**
 * Every currently-defined management bit — what an "Admin" role holds. There is
 * deliberately no all-powerful bit: a Role granted everything today does NOT
 * inherit a permission added tomorrow (CORD-04 §3).
 */
export const ADMIN_ALL =
  Permissions.MANAGE_ROLES |
  Permissions.MANAGE_CHANNELS |
  Permissions.MANAGE_METADATA |
  Permissions.KICK |
  Permissions.BAN |
  Permissions.MANAGE_MESSAGES |
  Permissions.CREATE_INVITE |
  Permissions.PIN_MESSAGES |
  Permissions.VIEW_AUDIT_LOG |
  Permissions.MENTION_EVERYONE;

/** Management bits (everything but the purely-social MENTION_EVERYONE). */
export const MANAGEMENT_MASK = ADMIN_ALL & ~Permissions.MENTION_EVERYONE;

/**
 * The STAFF bits (CORD-04 §3): the permissions whose authorized actions land as
 * Control Plane editions. A member holding ANY of them — plus always the owner
 * — is staff: the set that holds the `control_root` write key (CORD-02 §2).
 * KICK writes to the Guestbook and MANAGE_MESSAGES to Chat planes; neither
 * needs it. A future permission whose actions are Control editions joins this
 * mask by definition.
 */
export const STAFF_MASK =
  Permissions.MANAGE_ROLES |
  Permissions.MANAGE_CHANNELS |
  Permissions.MANAGE_METADATA |
  Permissions.BAN |
  Permissions.CREATE_INVITE |
  Permissions.PIN_MESSAGES;

/** Protocol-wide name cap: 64 bytes of UTF-8 (roles, channels, community name). */
export const NAME_MAX_BYTES = 64;
/** A member holds at most 64 Roles; a Community carries at most 100 (CORD-04 §2). */
export const MAX_ROLES_PER_MEMBER = 64;
export const MAX_ROLES_PER_COMMUNITY = 100;

export function permsContain(perms: bigint, bits: bigint): boolean {
  return (perms & bits) === bits;
}

export function isManagement(perms: bigint): boolean {
  return (perms & MANAGEMENT_MASK) !== 0n;
}

export type RoleScope =
  { kind: "server" } | { kind: "channel"; channelId: string };

export interface Role {
  roleId: string;
  name: string;
  /** Lower = higher authority. The owner is the implicit position 0, never a Role. */
  position: number;
  permissions: bigint;
  scope: RoleScope;
  /** Cosmetic badge tint; 0 = theme default. */
  color: number;
  /**
   * Hoist: show holders under this role's own named section in the member list.
   * An armada extension (CORD.md), read tolerantly — dropping it loses only the
   * grouping, never authority.
   */
  display?: boolean;
}

/**
 * The CORD-04 §3 display order: by `position` (lower is higher authority), ties
 * broken by the lower `role_id`.
 *
 * The tiebreak is not cosmetic. Two Roles MAY share a position — they are peers
 * — and without a deterministic second key the order falls out of fold
 * insertion, which differs between clients and between reloads.
 */
export function byDisplayOrder(a: Role, b: Role): number {
  return a.position - b.position || a.roleId.localeCompare(b.roleId);
}

// ── Wire JSON (CORD-04 §2) ───────────────────────────────────────────────────

interface RoleWire {
  role_id: string;
  name: string;
  position: number;
  /** Decimal string on the wire; a bare number from an older edition is accepted. */
  permissions: string | number;
  scope: { kind: "server" } | { kind: "channel"; channel_id: string };
  color: number;
  display?: boolean;
}

/**
 * Coerce a wire `color` to the spec's u32 (CORD-04 §2). A non-number, a
 * negative, or a value past 2^32-1 is out of range and becomes the theme
 * default rather than an arbitrary tint; an in-range float is truncated, since
 * its integer part is a colour the sender plausibly meant.
 */
function clampColor(color: unknown): number {
  if (typeof color !== "number" || !Number.isFinite(color)) return 0;
  if (color < 0 || color > 0xffffffff) return 0;
  return Math.trunc(color);
}

export function roleFromJSON(json: string): Role | undefined {
  try {
    const w = JSON.parse(json) as RoleWire;
    if (typeof w.role_id !== "string" || !/^[0-9a-f]{64}$/i.test(w.role_id)) {
      return undefined;
    }
    let permissions: bigint;
    if (typeof w.permissions === "string" && /^\d+$/.test(w.permissions)) {
      permissions = BigInt(w.permissions);
    } else if (
      typeof w.permissions === "number" &&
      Number.isFinite(w.permissions)
    ) {
      permissions = BigInt(Math.trunc(w.permissions));
    } else {
      return undefined;
    }
    if (
      typeof w.position !== "number" ||
      !Number.isInteger(w.position) ||
      w.position < 1
    ) {
      // Position 0 is the owner's alone — the top is not mintable (CORD-04 §3);
      // a non-integer or negative position is malformed.
      return undefined;
    }
    const name = typeof w.name === "string" ? w.name : "";
    if (new TextEncoder().encode(name).length > NAME_MAX_BYTES)
      return undefined;
    const scope: RoleScope =
      w.scope?.kind === "channel" && typeof w.scope.channel_id === "string"
        ? { kind: "channel", channelId: w.scope.channel_id }
        : { kind: "server" };
    return {
      roleId: w.role_id.toLowerCase(),
      name,
      position: w.position,
      permissions,
      scope,
      color: clampColor(w.color),
      ...(w.display === true ? { display: true } : {}),
    };
  } catch {
    return undefined;
  }
}

/**
 * Wire `color` is a u32 holding packed 0xRRGGBB. 0 is "theme default", so a
 * role tinted pure black is indistinguishable from an untinted one — an
 * inherent property of the spec encoding, not something a client can fix.
 * Returns undefined for 0 so callers fall through to the theme.
 */
export function colorToHex(color: number): string | undefined {
  if (!Number.isFinite(color)) return undefined;
  const rgb = Math.trunc(color) & 0xffffff;
  if (rgb === 0) return undefined;
  return `#${rgb.toString(16).padStart(6, "0")}`;
}

export interface MemberGrant {
  /** Grantee pubkey, lowercase hex. */
  member: string;
  roleIds: string[];
  /**
   * The staff write key riding the Grant (CORD-04 §3): the current
   * `control_root` NIP-44-encrypted under the granter↔member pairwise
   * conversation key, base64 — delivery, never authority. Opaque pairwise
   * ciphertext to every other reader, and to grimoire always: we never hold a
   * `control_root`, so this is parsed only to round-trip it.
   */
  controlWrap?: string;
}

interface MemberGrantWire {
  member: string;
  role_ids: string[];
  control_wrap?: string;
}

/** Sanity bound on a carried `control_wrap` (a NIP-44 wrap of 40 bytes is ~130 chars). */
const MAX_CONTROL_WRAP_CHARS = 1024;

export function grantFromJSON(json: string): MemberGrant | undefined {
  try {
    const w = JSON.parse(json) as MemberGrantWire;
    if (typeof w.member !== "string" || !/^[0-9a-f]{64}$/i.test(w.member)) {
      return undefined;
    }
    const roleIds = Array.isArray(w.role_ids)
      ? w.role_ids
          .filter((r): r is string => typeof r === "string")
          .slice(0, MAX_ROLES_PER_MEMBER)
      : [];
    const controlWrap =
      typeof w.control_wrap === "string" &&
      w.control_wrap.length > 0 &&
      w.control_wrap.length <= MAX_CONTROL_WRAP_CHARS
        ? w.control_wrap
        : undefined;
    return {
      member: w.member.toLowerCase(),
      roleIds,
      ...(controlWrap !== undefined ? { controlWrap } : {}),
    };
  } catch {
    return undefined;
  }
}

// ── The aggregated role graph ────────────────────────────────────────────────

export interface CommunityRoles {
  roles: Role[];
  grants: MemberGrant[];
}

export function emptyRoles(): CommunityRoles {
  return { roles: [], grants: [] };
}

export function roleById(
  roles: CommunityRoles,
  roleId: string,
): Role | undefined {
  return roles.roles.find((r) => r.roleId === roleId);
}

export function rolesOf(roles: CommunityRoles, memberHex: string): Role[] {
  const out: Role[] = [];
  for (const g of roles.grants) {
    if (g.member !== memberHex) continue;
    for (const rid of g.roleIds) {
      const r = roleById(roles, rid);
      if (r) out.push(r);
    }
  }
  return out;
}

export function effectivePermissions(
  roles: CommunityRoles,
  memberHex: string,
): bigint {
  return rolesOf(roles, memberHex).reduce((acc, r) => acc | r.permissions, 0n);
}

/**
 * Effective permissions for an action TARGETING one channel: server-scope Roles
 * plus Roles scoped to that channel. The fold stays scope-agnostic (every
 * implementation folds the same union, CORD-04 §3), so this narrows only what
 * THIS client offers its user, never what it honors from others.
 */
export function effectivePermissionsIn(
  roles: CommunityRoles,
  memberHex: string,
  channelIdHex: string,
): bigint {
  return rolesOf(roles, memberHex).reduce(
    (acc, r) =>
      r.scope.kind === "server" || r.scope.channelId === channelIdHex
        ? acc | r.permissions
        : acc,
    0n,
  );
}

/** {@link isAuthorized}, judged against one channel per {@link effectivePermissionsIn}. */
export function isAuthorizedIn(
  roles: CommunityRoles,
  actorHex: string,
  ownerHex: string | undefined,
  channelIdHex: string,
  permission: bigint,
): boolean {
  if (ownerHex === actorHex) return true;
  return permsContain(
    effectivePermissionsIn(roles, actorHex, channelIdHex),
    permission,
  );
}

export function hasPermission(
  roles: CommunityRoles,
  memberHex: string,
  bits: bigint,
): boolean {
  return permsContain(effectivePermissions(roles, memberHex), bits);
}

/**
 * Whether a member is STAFF (CORD-04 §3): the owner, or any holder of a
 * Control-writing bit ({@link STAFF_MASK}) — the set entitled to the
 * `control_root` (CORD-02 §2).
 */
export function isStaff(
  roles: CommunityRoles,
  memberHex: string,
  ownerHex: string | undefined,
): boolean {
  if (memberHex === ownerHex) return true;
  return (effectivePermissions(roles, memberHex) & STAFF_MASK) !== 0n;
}

/** A member's rank: the lowest position among their Roles; undefined if roleless. */
export function highestPosition(
  roles: CommunityRoles,
  memberHex: string,
): number | undefined {
  const positions = rolesOf(roles, memberHex).map((r) => r.position);
  return positions.length ? Math.min(...positions) : undefined;
}

export function isAdmin(roles: CommunityRoles, memberHex: string): boolean {
  return rolesOf(roles, memberHex).some((r) => isManagement(r.permissions));
}

/**
 * The member's display tier for the member list: "admin" if they can shape the
 * roster itself (MANAGE_ROLES), "moderator" for any other management bit,
 * undefined for a roleless member.
 */
export function badgeOf(
  roles: CommunityRoles,
  memberHex: string,
): "admin" | "moderator" | undefined {
  const perms = effectivePermissions(roles, memberHex);
  if (permsContain(perms, Permissions.MANAGE_ROLES)) return "admin";
  if (isManagement(perms)) return "moderator";
  return undefined;
}

/** Owner is supreme; otherwise the actor must hold `permission`. */
export function isAuthorized(
  roles: CommunityRoles,
  actorHex: string,
  ownerHex: string | undefined,
  permission: bigint,
): boolean {
  if (ownerHex === actorHex) return true;
  return hasPermission(roles, actorHex, permission);
}

/** Does the actor STRICTLY outrank `targetPosition`? Owner outranks everything. */
export function outranks(
  roles: CommunityRoles,
  actorHex: string,
  ownerHex: string | undefined,
  targetPosition: number,
): boolean {
  if (ownerHex === actorHex) return true;
  const p = highestPosition(roles, actorHex);
  return p !== undefined && p < targetPosition;
}

/**
 * Does `actorHex` strictly outrank the member `memberHex`? The owner outranks
 * everyone and is outranked by no one; a roleless member is effectively last
 * (CORD-04 §3), so any ranked actor outranks them.
 *
 * The target-side half of an authority check on its own — for the places where
 * the required permission bit is verified separately (CORD-06 §Authority: "the
 * Rotator must strictly outrank every removed target").
 */
export function outranksMember(
  roles: CommunityRoles,
  actorHex: string,
  ownerHex: string | undefined,
  memberHex: string,
): boolean {
  if (actorHex === ownerHex) return true;
  if (memberHex === ownerHex) return false;
  const target = highestPosition(roles, memberHex) ?? Number.MAX_SAFE_INTEGER;
  return outranks(roles, actorHex, ownerHex, target);
}

/** May `actorHex` perform an action requiring `permission` against `targetPosition`? */
export function canActOnPosition(
  roles: CommunityRoles,
  actorHex: string,
  ownerHex: string | undefined,
  targetPosition: number,
  permission: bigint,
): boolean {
  if (ownerHex === actorHex) return true;
  return (
    hasPermission(roles, actorHex, permission) &&
    outranks(roles, actorHex, ownerHex, targetPosition)
  );
}

/**
 * Generalized member-targeting authority (ban/kick/hide/grant): the actor must
 * hold the bit AND strictly outrank the target (equal cannot act on equal). The
 * owner is never a valid target.
 */
export function canActOnMember(
  roles: CommunityRoles,
  actorHex: string,
  ownerHex: string | undefined,
  targetHex: string,
  permission: bigint,
): boolean {
  if (ownerHex === targetHex) return false;
  const targetPosition =
    highestPosition(roles, targetHex) ?? Number.MAX_SAFE_INTEGER;
  return canActOnPosition(
    roles,
    actorHex,
    ownerHex,
    targetPosition,
    permission,
  );
}
