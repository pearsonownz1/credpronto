import { describe, expect, it } from "vitest";
import {
  evaluationSpeedLine,
  translationSpeedLine,
  uploadOrCreatedAt,
} from "./speed-line";

const START = "2026-10-12T00:00:00.000Z";

describe("speed lines", () => {
  it("uses the upload time, then the order created time", () => {
    expect(
      uploadOrCreatedAt(
        [{ createdAt: "2026-10-12T00:00:08.000Z" }, { createdAt: "2026-10-12T00:00:02.000Z" }],
        START,
      ),
    ).toBe("2026-10-12T00:00:02.000Z");
    expect(uploadOrCreatedAt([{ createdAt: null }, {}], START)).toBe(START);
    expect(uploadOrCreatedAt([], "not-a-time")).toBeNull();
  });

  it("shows one decimal at 10 seconds or under, and hides anything slower", () => {
    expect(translationSpeedLine(START, "2026-10-12T00:00:04.200Z")).toBe("Translated in 4.2 seconds");
    expect(translationSpeedLine(START, "2026-10-12T00:00:01.000Z")).toBe("Translated in 1.0 second");
    expect(translationSpeedLine(START, "2026-10-12T00:00:10.000Z")).toBe("Translated in 10.0 seconds");
    expect(translationSpeedLine(START, "2026-10-12T00:00:10.100Z")).toBeNull();
    expect(translationSpeedLine(START, "2026-10-12T00:00:30.000Z")).toBeNull();
    expect(translationSpeedLine(START, "2026-10-12T00:01:00.000Z")).toBeNull();
    expect(translationSpeedLine(START, "2026-10-12T00:01:30.000Z")).toBeNull();
  });

  it("hides the translation line when a timestamp is missing or reversed", () => {
    expect(translationSpeedLine(null, "2026-10-12T00:00:04.200Z")).toBeNull();
    expect(translationSpeedLine(START, null)).toBeNull();
    expect(translationSpeedLine(START, "not-a-time")).toBeNull();
    expect(translationSpeedLine("2026-10-12T00:00:05.000Z", START)).toBeNull();
  });

  it("rounds an evaluation to whole minutes from paid to delivered", () => {
    expect(evaluationSpeedLine(START, "2026-10-12T00:12:00.000Z")).toBe("Evaluated in 12 minutes");
    expect(evaluationSpeedLine(START, "2026-10-12T00:01:00.000Z")).toBe("Evaluated in 1 minute");
    expect(evaluationSpeedLine(START, null)).toBeNull();
    expect(evaluationSpeedLine(null, "2026-10-12T00:12:00.000Z")).toBeNull();
    expect(evaluationSpeedLine("2026-10-12T00:20:00.000Z", START)).toBeNull();
  });
});
