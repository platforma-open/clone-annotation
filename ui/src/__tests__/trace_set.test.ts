import { describe, expect, test } from "vitest";
import { pathTail } from "@platforma-open/milaboratories.clone-annotation.model";

describe("pathTail", () => {
  test("a one-segment pattern sees only the file name", () => {
    expect(pathTail("/traces/Plate1/A10.ab1", 1)).toBe("A10.ab1");
  });

  test("a two-segment pattern keeps the plate directory", () => {
    expect(pathTail("/traces/Plate1/A10.ab1", 2)).toBe("Plate1/A10.ab1");
  });

  test("the plate survives even when every file sits in that one folder", () => {
    const paths = ["/d/Plate1/A1.ab1", "/d/Plate1/A2.ab1"];
    expect(paths.map((p) => pathTail(p, 2))).toEqual(["Plate1/A1.ab1", "Plate1/A2.ab1"]);
  });

  test("asking for more segments than exist returns what there is", () => {
    expect(pathTail("A10.ab1", 3)).toBe("A10.ab1");
  });

  test("windows separators are handled", () => {
    expect(pathTail("C:\\data\\P1\\A10.ab1", 2)).toBe("P1/A10.ab1");
  });
});
