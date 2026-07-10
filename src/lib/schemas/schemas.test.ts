import { describe, expect, it } from "vitest";
import { accessRequestSchema, indianPhoneSchema, gstinSchema } from "./customer";
import { createProductSchema, updateProductSchema } from "./product";
import { createCategorySchema } from "./category";
import { objectIdSchema } from "./shared";

const OID = "64b7f8a2e4b0c12345678901";

describe("indianPhoneSchema", () => {
  it("normalizes accepted formats to +91XXXXXXXXXX", () => {
    for (const input of [
      "9876543210",
      "+919876543210",
      "919876543210",
      "09876543210",
      "+91 98765 43210",
      "98765-43210",
    ]) {
      expect(indianPhoneSchema.parse(input)).toBe("+919876543210");
    }
  });

  it("rejects invalid numbers", () => {
    for (const input of ["12345", "5876543210", "98765432101", "abcdefghij", ""]) {
      expect(indianPhoneSchema.safeParse(input).success).toBe(false);
    }
  });
});

describe("gstinSchema", () => {
  it("accepts a valid GSTIN and uppercases it", () => {
    expect(gstinSchema.parse("27aapfu0939f1zv")).toBe("27AAPFU0939F1ZV");
  });

  it("rejects malformed GSTINs", () => {
    for (const input of ["27AAPFU0939F1Z", "27AAPFU0939F1XV", "ABCDEFGHIJKLMNO"]) {
      expect(gstinSchema.safeParse(input).success).toBe(false);
    }
  });
});

describe("accessRequestSchema", () => {
  const valid = {
    businessName: "Sharma Mobiles",
    contactName: "Anchal Sharma",
    phone: "98765 43210",
    password: "s3cret-pass",
  };

  it("parses a minimal valid form and normalizes the phone", () => {
    const parsed = accessRequestSchema.parse(valid);
    expect(parsed.phone).toBe("+919876543210");
    expect(parsed.gstNumber).toBeUndefined();
    expect(parsed.email).toBeUndefined();
  });

  it("treats empty optional fields as not provided", () => {
    const parsed = accessRequestSchema.parse({
      ...valid,
      gstNumber: "",
      email: "  ",
      city: "",
    });
    expect(parsed.gstNumber).toBeUndefined();
    expect(parsed.email).toBeUndefined();
    expect(parsed.city).toBeUndefined();
  });

  it("validates GSTIN only when provided", () => {
    expect(
      accessRequestSchema.safeParse({ ...valid, gstNumber: "not-a-gstin" })
        .success,
    ).toBe(false);
    expect(
      accessRequestSchema.parse({ ...valid, gstNumber: "27AAPFU0939F1ZV" })
        .gstNumber,
    ).toBe("27AAPFU0939F1ZV");
  });

  it("enforces password length", () => {
    expect(
      accessRequestSchema.safeParse({ ...valid, password: "short" }).success,
    ).toBe(false);
  });
});

describe("product schemas", () => {
  const validProduct = {
    categoryId: OID,
    name: "Samsung EVO Plus 128GB",
    sku: "SAM-EVO-128",
    price: 49950,
  };

  it("parses a valid product and applies defaults", () => {
    const parsed = createProductSchema.parse(validProduct);
    expect(parsed.stockStatus).toBe("IN_STOCK");
    expect(parsed.status).toBe("ACTIVE");
    expect(parsed.tags).toEqual([]);
    expect(parsed.images).toEqual([]);
  });

  it("rejects non-integer or non-positive prices", () => {
    for (const price of [499.5, 0, -100]) {
      expect(
        createProductSchema.safeParse({ ...validProduct, price }).success,
      ).toBe(false);
    }
  });

  it("rejects mrp below price", () => {
    expect(
      createProductSchema.safeParse({ ...validProduct, mrp: 100 }).success,
    ).toBe(false);
    expect(
      createProductSchema.safeParse({ ...validProduct, mrp: 59900 }).success,
    ).toBe(true);
    expect(
      updateProductSchema.safeParse({ price: 49950, mrp: 100 }).success,
    ).toBe(false);
  });

  it("caps images at 8", () => {
    const image = { url: "https://cdn.example.com/a.jpg" };
    expect(
      createProductSchema.safeParse({
        ...validProduct,
        images: Array.from({ length: 9 }, () => image),
      }).success,
    ).toBe(false);
  });

  it("accepts specs as a string record and rejects non-strings", () => {
    expect(
      createProductSchema.parse({
        ...validProduct,
        specs: { capacity: "128GB", speed: "130MB/s" },
      }).specs,
    ).toEqual({ capacity: "128GB", speed: "130MB/s" });
    expect(
      createProductSchema.safeParse({
        ...validProduct,
        specs: { capacity: 128 },
      }).success,
    ).toBe(false);
  });

  it("update schema allows partial input", () => {
    expect(updateProductSchema.parse({ price: 100 })).toEqual({ price: 100 });
    expect(updateProductSchema.parse({})).toEqual({});
  });
});

describe("category schema / shared", () => {
  it("parses a category with defaults", () => {
    const parsed = createCategorySchema.parse({ name: "Memory Cards" });
    expect(parsed.sortOrder).toBe(0);
    expect(parsed.status).toBe("ACTIVE");
  });

  it("validates ObjectIds", () => {
    expect(objectIdSchema.safeParse(OID).success).toBe(true);
    expect(objectIdSchema.safeParse("not-an-id").success).toBe(false);
    expect(objectIdSchema.safeParse(OID.slice(0, 23)).success).toBe(false);
  });
});
