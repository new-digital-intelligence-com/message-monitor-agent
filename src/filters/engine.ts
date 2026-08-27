import type { MatchCondition, MatchField, NormalizedMessage } from "../types.js";

function domainOf(address: string): string {
  const at = address.lastIndexOf("@");
  return at === -1 ? "" : address.slice(at + 1);
}

/** A field can carry zero, one, or many values (e.g. "to", "label"); a leaf
 * condition matches if ANY of them satisfies it. */
function fieldValues(message: NormalizedMessage, field: MatchField): string[] {
  switch (field) {
    case "from.address":
      return [message.from.address];
    case "from.name":
      return message.from.name ? [message.from.name] : [];
    case "from.domain":
      return [domainOf(message.from.address)];
    case "to":
      return message.to ?? [];
    case "subject":
      return message.subject ? [message.subject] : [];
    case "body":
      return [message.bodyText ?? message.snippet ?? ""];
    case "label":
      return message.labels ?? [];
    case "channel":
      return [message.channel];
    case "linkedinType":
      return message.linkedinType ? [message.linkedinType] : [];
  }
}

function textMatches(
  candidate: string,
  op: "contains" | "equals" | "startsWith" | "endsWith",
  value: string,
  caseSensitive: boolean,
): boolean {
  const a = caseSensitive ? candidate : candidate.toLowerCase();
  const b = caseSensitive ? value : value.toLowerCase();
  switch (op) {
    case "contains":
      return a.includes(b);
    case "equals":
      return a === b;
    case "startsWith":
      return a.startsWith(b);
    case "endsWith":
      return a.endsWith(b);
  }
}

export function evaluateCondition(message: NormalizedMessage, condition: MatchCondition): boolean {
  if ("all" in condition) {
    return condition.all.every((c) => evaluateCondition(message, c));
  }
  if ("any" in condition) {
    return condition.any.some((c) => evaluateCondition(message, c));
  }
  if ("not" in condition) {
    return !evaluateCondition(message, condition.not);
  }

  const candidates = fieldValues(message, condition.field);

  if (condition.op === "matches") {
    const flags = condition.caseSensitive ? "" : "i";
    const regex = new RegExp(condition.pattern, flags);
    return candidates.some((c) => regex.test(c));
  }

  if (condition.op === "in") {
    const values = condition.values.map((v) => v.toLowerCase());
    return candidates.some((c) => values.includes(c.toLowerCase()));
  }

  return candidates.some((c) =>
    textMatches(c, condition.op, condition.value, condition.caseSensitive ?? false),
  );
}
