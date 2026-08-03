import { z } from "zod";
import { SpriteSpecSchema } from "./sprite-spec.js";

/**
 * Keywords de JSON Schema que los structured outputs de la API de Anthropic rechazan.
 * `maxItems` deliberadamente no está aquí: no es el que se pidió cubrir, pero tampoco lo
 * emitimos nunca (ver nota en sprite-spec.ts sobre evitar `.int()`/`.min()`/`.max()`).
 */
const FORBIDDEN_KEYWORDS = [
  "minimum",
  "maximum",
  "minLength",
  "maxLength",
  "minItems",
  "pattern",
] as const;

/** Compila `SpriteSpecSchema` al JSON Schema que se envía en `output_config.format`. */
export function spriteSpecJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(SpriteSpecSchema) as Record<string, unknown>;
}

/**
 * Recorre un JSON Schema compilado y falla si encuentra una keyword incompatible con
 * structured outputs, o un objeto sin `additionalProperties: false`. Este test es el que
 * evita un 400 en producción cuando alguien añade `.min()`/`.regex()` sin darse cuenta.
 */
export function assertStructuredOutputCompatible(schema: unknown, path = "$"): void {
  if (Array.isArray(schema)) {
    schema.forEach((item, i) => assertStructuredOutputCompatible(item, `${path}[${i}]`));
    return;
  }
  if (schema === null || typeof schema !== "object") {
    return;
  }

  const node = schema as Record<string, unknown>;

  for (const keyword of FORBIDDEN_KEYWORDS) {
    if (keyword in node) {
      throw new Error(
        `assertStructuredOutputCompatible: keyword prohibida "${keyword}" en ${path}.`,
      );
    }
  }

  const isObjectSchema = node["type"] === "object" || "properties" in node;
  if (isObjectSchema && node["additionalProperties"] !== false) {
    throw new Error(
      `assertStructuredOutputCompatible: "additionalProperties" debe ser false en ${path} ` +
        `(encontrado: ${JSON.stringify(node["additionalProperties"])}).`,
    );
  }

  for (const [key, value] of Object.entries(node)) {
    assertStructuredOutputCompatible(value, `${path}.${key}`);
  }
}
