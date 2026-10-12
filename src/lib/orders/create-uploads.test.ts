import { describe, expect, it } from "vitest";
import { listedUploads } from "./create";

const name = "GuyPearsonCV_under2MB.pdf";

describe("listedUploads", () => {
  it("reads one files part as one upload", () => {
    const form = new FormData();
    form.append("files", new File(["%PDF"], name, { type: "application/pdf" }));
    const uploads = listedUploads(form);
    expect(uploads).toHaveLength(1);
    expect(uploads[0]?.name).toBe(name);
  });

  it("does not collapse repeated parts with the same name and size", () => {
    const form = new FormData();
    const file = new File(["%PDF"], name, { type: "application/pdf" });
    form.append("files", file);
    form.append("files", file);
    form.append("files", file);
    expect(listedUploads(form)).toHaveLength(3);
  });

  it("counts a files part and a file part separately", () => {
    const form = new FormData();
    form.append("files", new File(["%PDF"], name, { type: "application/pdf" }));
    form.append("file", new File(["%PDF"], name, { type: "application/pdf" }));
    expect(listedUploads(form)).toHaveLength(2);
  });
});
