import { it, expect, vi } from "vitest";
import { log } from "./log.js";

it("removes sensitive fields and preserves correlation metadata", () => {
  const output = vi.spyOn(console, "log").mockImplementation(() => {});

  try {
    log("test", "trace-1", {
      token: "secret",
      password: "secret",
      email: "private",
      body: "private",
      statusCode: 200,
    });
    expect(output).toHaveBeenCalledWith(
      '{"event":"test","correlationId":"trace-1","statusCode":200}',
    );
  } finally {
    output.mockRestore();
  }
});
