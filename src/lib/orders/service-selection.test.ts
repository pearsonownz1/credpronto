import { describe, expect, it } from "vitest";
import { UNIT_PRICE_CENTS } from "./constants";
import { parseDirectOrder, rejectCustomerTotal } from "./direct-upload";
import {
  COURSE_BY_COURSE_UNIT_CENTS,
  DIPLOMA_UNIT_CENTS,
  parseOrderChoice,
  rejectCustomerPageCount,
  serviceChoiceFromBody,
} from "./evaluation-price";
import { HttpError } from "./errors";
import { priceServices, type CatalogService } from "./service-selection";

const diplomaUnit = DIPLOMA_UNIT_CENTS;
const courseUnit = COURSE_BY_COURSE_UNIT_CENTS;

type Combo = {
  name: string;
  services: CatalogService[];
  degreeCount: number | null;
  filePages: number[];
  sourceLanguage: string;
  diplomaCents: number;
  courseCents: number;
  translationCents: number;
};

const combinations: Combo[] = [
  {
    name: "translation",
    services: ["translation"],
    degreeCount: null,
    filePages: [2, 3],
    sourceLanguage: "es",
    diplomaCents: 0,
    courseCents: 0,
    translationCents: 5 * UNIT_PRICE_CENTS,
  },
  {
    name: "diploma",
    services: ["diploma"],
    degreeCount: 2,
    filePages: [2, 3],
    sourceLanguage: "es",
    diplomaCents: 2 * diplomaUnit,
    courseCents: 0,
    translationCents: 0,
  },
  {
    name: "course-by-course",
    services: ["course_by_course"],
    degreeCount: 2,
    filePages: [2, 3],
    sourceLanguage: "es",
    diplomaCents: 0,
    courseCents: 2 * courseUnit,
    translationCents: 0,
  },
  {
    name: "translation and diploma",
    services: ["translation", "diploma"],
    degreeCount: 2,
    filePages: [2, 3],
    sourceLanguage: "es",
    diplomaCents: 2 * diplomaUnit,
    courseCents: 0,
    translationCents: 5 * UNIT_PRICE_CENTS,
  },
  {
    name: "translation and course-by-course",
    services: ["translation", "course_by_course"],
    degreeCount: 1,
    filePages: [1, 1],
    sourceLanguage: "es",
    diplomaCents: 0,
    courseCents: courseUnit,
    translationCents: 2 * UNIT_PRICE_CENTS,
  },
  {
    name: "diploma and course-by-course",
    services: ["diploma", "course_by_course"],
    degreeCount: 2,
    filePages: [4, 5],
    sourceLanguage: "es",
    diplomaCents: 2 * diplomaUnit,
    courseCents: 2 * courseUnit,
    translationCents: 0,
  },
  {
    name: "all three",
    services: ["translation", "diploma", "course_by_course"],
    degreeCount: 3,
    filePages: [2, 2],
    sourceLanguage: "es",
    diplomaCents: 3 * diplomaUnit,
    courseCents: 3 * courseUnit,
    translationCents: 4 * UNIT_PRICE_CENTS,
  },
];

describe("service selection price", () => {
  it.each(combinations)(
    "sums $name from each selected service and every file",
    ({ services, degreeCount, filePages, sourceLanguage, diplomaCents, courseCents, translationCents }) => {
      const priced = priceServices({ services, degreeCount, filePages, sourceLanguage });
      expect(priced).not.toBeNull();
      if (!priced) return;
      expect(priced.diplomaCents).toBe(diplomaCents);
      expect(priced.courseCents).toBe(courseCents);
      expect(priced.translationCents).toBe(translationCents);
      expect(priced.evaluationCents).toBe(diplomaCents + courseCents);
      expect(priced.serviceCents).toBe(diplomaCents + courseCents + translationCents);
      expect(priced.totalCents).toBe(priced.serviceCents);
      const lineSum = priced.lineItems.reduce((sum, line) => sum + line.quantity * line.unitAmountCents, 0);
      expect(lineSum).toBe(priced.serviceCents);
      expect(priced.billablePages).toBe(filePages.reduce((sum, pages) => sum + pages, 0));
    },
  );

  it("prices evaluation fees once per degree, not once per file", () => {
    const manyFiles = priceServices({
      services: ["diploma", "course_by_course"],
      degreeCount: 2,
      filePages: [1, 1, 1, 9],
      sourceLanguage: "es",
    });
    const oneFile = priceServices({
      services: ["diploma", "course_by_course"],
      degreeCount: 2,
      filePages: [12],
      sourceLanguage: "es",
    });
    expect(manyFiles?.evaluationCents).toBe(oneFile?.evaluationCents);
    expect(manyFiles?.evaluationCents).toBe(2 * (diplomaUnit + courseUnit));
    expect(manyFiles?.translationCents).toBe(0);
    expect(manyFiles?.service).toBeNull();
  });

  it("charges translation from the summed pages and leaves English at zero", () => {
    const spanish = priceServices({
      services: ["translation", "diploma", "course_by_course"],
      degreeCount: 1,
      filePages: [2, 3],
      sourceLanguage: "es",
    });
    const english = priceServices({
      services: ["translation", "diploma", "course_by_course"],
      degreeCount: 1,
      filePages: [2, 3],
      sourceLanguage: "en",
    });
    expect(spanish?.translationCents).toBe(5 * UNIT_PRICE_CENTS);
    expect(english?.translationCents).toBe(0);
    expect(english?.includeTranslation).toBe(true);
    expect(english?.evaluationCents).toBe(spanish?.evaluationCents);
    expect(english?.serviceCents).toBe(diplomaUnit + courseUnit);
  });

  it("accepts every combination on the order and rejects a client total", () => {
    expect(
      parseOrderChoice({
        orderType: "evaluation",
        service: null,
        degreeCount: "2",
        services: ["diploma", "course_by_course"],
      }),
    ).toMatchObject({
      orderType: "evaluation",
      service: null,
      degreeCount: 2,
      includeTranslation: false,
      services: ["diploma", "course_by_course"],
    });
    expect(
      parseOrderChoice({
        orderType: "evaluation",
        service: null,
        degreeCount: "1",
        includeTranslation: "true",
        services: ["translation", "diploma", "course_by_course"],
      }).services,
    ).toEqual(["translation", "diploma", "course_by_course"]);
    expect(() => rejectCustomerTotal({ totalCents: 100 })).toThrow(HttpError);
    expect(() => rejectCustomerTotal({ amount: 19.95 })).toThrow(/calculated by the server/);
    expect(() => rejectCustomerPageCount({ pages: 4 })).toThrow(/counted from the upload/);
    expect(() => rejectCustomerTotal({ email: "ada@example.com" })).not.toThrow();
  });
});

const SERVICE_IDS = ["translation", "diploma", "course_by_course"] as const;

describe("services contract", () => {
  const fallback = { service: "diploma" as const, degreeCount: 1, includeTranslation: false };

  it("accepts every non-empty subset of translation, diploma, and course_by_course", () => {
    const subsets: Array<Array<(typeof SERVICE_IDS)[number]>> = [];
    for (let mask = 1; mask < 8; mask += 1) {
      subsets.push(SERVICE_IDS.filter((_, index) => (mask & (1 << index)) !== 0));
    }
    expect(subsets).toHaveLength(7);
    for (const services of subsets) {
      const needsDegree = services.some((service) => service !== "translation");
      const choice = serviceChoiceFromBody(
        { services, ...(needsDegree ? { degreeCount: 2 } : {}) },
        { service: null, degreeCount: null, includeTranslation: false },
      );
      expect(choice?.services).toEqual(services);
      expect(choice?.includeTranslation).toBe(needsDegree && services.includes("translation"));
      expect(choice?.service).toBe(needsDegree && services.filter((service) => service !== "translation").length === 1
        ? services.find((service) => service !== "translation")
        : null);
    }
  });

  it("keeps service and includeTranslation when services is omitted", () => {
    expect(serviceChoiceFromBody({ service: "course_by_course", includeTranslation: true, degreeCount: 2 }, fallback)).toEqual({
      orderType: "evaluation",
      service: "course_by_course",
      degreeCount: 2,
      includeTranslation: true,
      services: ["translation", "course_by_course"],
    });
    expect(serviceChoiceFromBody({ service: "diploma", includeTranslation: false, degreeCount: "1" }, fallback)).toMatchObject({
      services: ["diploma"],
      includeTranslation: false,
      service: "diploma",
    });
    expect(serviceChoiceFromBody({ addons: ["notarization"] }, fallback)).toBeNull();
  });

  it("rejects an empty list, an unknown id, a mismatched flag, and a client total", () => {
    expect(() => serviceChoiceFromBody({ services: [] }, fallback)).toThrow(/Choose a service/);
    expect(() => serviceChoiceFromBody({ services: ["expert_letter"] }, fallback)).toThrow(
      /translation, diploma, or course_by_course/,
    );
    expect(() =>
      serviceChoiceFromBody({ services: ["diploma"], includeTranslation: true, degreeCount: 1 }, fallback),
    ).toThrow(/does not match/);
    expect(() => rejectCustomerTotal({ totalCents: 2990, services: ["translation", "diploma"] })).toThrow(
      /calculated by the server/,
    );
    const sessionId = "11111111-1111-4111-8111-111111111111";
    const path = `${sessionId}/22222222-2222-4222-8222-000000000001/diploma.pdf`;
    expect(
      parseDirectOrder({
        sessionId,
        files: [{ path, filename: "diploma.pdf", mime: "application/pdf", size: 10 }],
        services: ["translation", "diploma", "course_by_course"],
        degreeCount: 1,
      }).services,
    ).toEqual(["translation", "diploma", "course_by_course"]);
    expect(() =>
      parseDirectOrder({
        sessionId,
        files: [{ path, filename: "diploma.pdf", mime: "application/pdf", size: 10 }],
        services: ["diploma"],
        totalCents: 1995,
      }),
    ).toThrow(/calculated by the server/);
  });
});
