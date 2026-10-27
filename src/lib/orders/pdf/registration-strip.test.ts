import { describe, expect, it } from "vitest";
import { blocksFromModel, blocksToParagraphs } from "./structure";

describe("registration strips", () => {
  it("prints an empty box label without a leading colon", () => {
    expect(blocksToParagraphs([{ type: "box", label: "", value: "022A-084542" }])).toEqual(["022A-084542"]);
    expect(blocksToParagraphs([{ type: "kv", label: "", value: "022A-084542" }]).join("\n")).not.toContain(": 022A");
  });

  it("turns a registration row of kv blocks into a header table", () => {
    const blocks = blocksFromModel({
      blocks: [
        { type: "kv", label: "National Register of Degrees", value: "2020/217459" },
        { type: "kv", label: "Center Code", value: "08071020" },
        { type: "box", label: "", value: "022A-084542" },
      ],
    });
    expect(blocks).toEqual([
      {
        type: "table",
        header: true,
        rows: [
          ["National Register of Degrees", "Center Code", ""],
          ["2020/217459", "08071020", "022A-084542"],
        ],
      },
    ]);
  });

  it("turns the five reverse-side codes into one table and leaves a lone document number", () => {
    const table = blocksFromModel({
      blocks: [
        {
          type: "fields",
          rows: [
            { label: "Alphanumeric code", value: "022A-084542" },
            { label: "National Degree Registry No.", value: "2020/217459" },
            { label: "Institution code", value: "08071020" },
            { label: "University Degree Registry No.", value: "227295" },
            { label: "University file No.", value: "14655910H5051" },
          ],
        },
      ],
    });
    expect(table[0]).toMatchObject({ type: "table", header: true });
    expect(table[0]?.type === "table" && table[0].rows[1]).toContain("14655910H5051");

    const lone = blocksFromModel({ blocks: [{ type: "kv", label: "Document No.", value: "74" }] });
    expect(lone).toEqual([{ type: "kv", label: "Document No.", value: "74" }]);

    const birth = blocksFromModel({
      blocks: [
        {
          type: "fields",
          rows: [
            { label: "Name", value: "Judit Giménez Roig" },
            { label: "Mother", value: "Maria Roig Example" },
            { label: "Father", value: "Joan Giménez Example" },
            { label: "Place", value: "Barcelona" },
          ],
        },
      ],
    });
    expect(birth[0]?.type).toBe("fields");
  });
});
