export function log(
  event: string,
  correlationId: string,
  fields: Record<string, string | number | boolean> = {},
): void {
  const safe = Object.fromEntries(
    Object.entries(fields).filter(
      ([key]) =>
        !/secret|token|password|authorization|email|body|payload/i.test(key),
    ),
  );

  console.log(JSON.stringify({ event, correlationId, ...safe }));
}
