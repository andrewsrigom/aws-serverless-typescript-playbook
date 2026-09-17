export function cachedSecret(
  load: () => Promise<string>,
  now: () => number = Date.now,
) {
  let value: string | undefined;
  let expiresAt = 0;
  let pending: Promise<string> | undefined;

  return async (): Promise<string> => {
    if (value !== undefined && now() < expiresAt) return value;

    if (!pending) {
      pending = load()
        .then((result) => {
          if (!result) throw Error("Missing signing secret");

          value = result;
          expiresAt = now() + 60_000;

          return result;
        })
        .finally(() => {
          pending = undefined;
        });
    }

    return pending;
  };
}
