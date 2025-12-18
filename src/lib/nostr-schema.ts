import yaml from "js-yaml";
import schemaYaml from "@/data/nostr-kinds-schema.yaml?raw";

/**
 * Nostr event schema types based on the official registry
 */

export interface TagDefinition {
  name: string;
  next?: TagValueDefinition;
  variadic?: boolean;
}

export interface TagValueDefinition {
  type: string;
  required?: boolean;
  next?: TagValueDefinition;
  either?: string[]; // For constrained types
  variadic?: boolean;
}

export interface KindSchema {
  description: string;
  in_use: boolean;
  content?: {
    type: "free" | "json" | "empty";
  };
  tags?: TagDefinition[];
  required?: string[]; // List of required tag names
}

export type NostrSchema = Record<number, KindSchema>;

let parsedSchema: NostrSchema | null = null;

/**
 * Parse the YAML schema
 */
export function loadSchema(): NostrSchema {
  if (parsedSchema) return parsedSchema;

  try {
    const data = yaml.load(schemaYaml) as any;
    parsedSchema = {};

    // The kinds are nested under a "kinds" key
    const kindsData = data.kinds || data;

    // Extract kind definitions (filter out anchor definitions starting with _)
    for (const [key, value] of Object.entries(kindsData)) {
      if (!key.startsWith("_") && !isNaN(Number(key))) {
        parsedSchema[Number(key)] = value as KindSchema;
      }
    }

    return parsedSchema;
  } catch (error) {
    console.error("Failed to parse Nostr schema:", error);
    return {};
  }
}

/**
 * Get schema for a specific kind
 */
export function getKindSchema(kind: number): KindSchema | undefined {
  const schema = loadSchema();
  return schema[kind];
}

/**
 * Get all available kinds from schema
 */
export function getAllKinds(): number[] {
  const schema = loadSchema();
  return Object.keys(schema)
    .map(Number)
    .sort((a, b) => a - b);
}

/**
 * Format tag definition as a readable string
 */
export function formatTag(tag: TagDefinition): string {
  let result = `#${tag.name}`;
  let current = tag.next;
  const parts: string[] = [];

  while (current) {
    if (current.either) {
      parts.push(`<${current.either.join("|")}>`);
    } else {
      // Replace 'free' with 'text' for better readability
      const type = current.type === "free" ? "text" : current.type;
      parts.push(`<${type}>`);
    }
    current = current.next;
  }

  if (parts.length > 0) {
    result += ` ${parts.join(" ")}`;
  }

  if (tag.variadic) {
    result += " (multiple)";
  }

  return result;
}

/**
 * Parse tag structure into primary value and other parameters
 */
export function parseTagStructure(tag: TagDefinition): {
  primaryValue: string;
  otherParameters: string[];
} {
  const parts: string[] = [];
  let current = tag.next;

  while (current) {
    if (current.either) {
      parts.push(`${current.either.join(" | ")}`);
    } else {
      // Replace 'free' with 'text' for better readability
      const type = current.type === "free" ? "text" : current.type;
      parts.push(type);
    }
    current = current.next;
  }

  return {
    primaryValue: parts[0] || "",
    otherParameters: parts.slice(1),
  };
}

/**
 * Get content type description
 */
export function getContentTypeDescription(
  contentType: "free" | "json" | "empty"
): string {
  switch (contentType) {
    case "free":
      return "Free-form text or markdown";
    case "json":
      return "JSON object";
    case "empty":
      return "Empty (no content field)";
    default:
      return "Unknown";
  }
}
