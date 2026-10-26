import { test } from "node:test";
import assert from "node:assert/strict";
import { COUNTRIES, startingRole, validateOnboarding } from "@shared/onboarding";
import { combineScreening } from "../service";

const individual = { accountType: "individual", fullName: "  Ama   Mensah ", country: "gh", phone: "+233 24 123 4567", intents: ["payables"] };
const organisation = {
  accountType: "organisation", fullName: "Kofi Boateng", country: "GH", jobTitle: "Finance Director", intents: ["payables", "receivables"],
  legalName: "Accra Medical Supplies Ltd", registrationCountry: "GH", registrationNumber: "CS123456789",
  industry: "Healthcare and pharmaceuticals", monthlyVolume: "$100,000 to $1 million",
};

test("a complete individual form passes, cleaned", () => {
  const { value, problems } = validateOnboarding(individual);
  assert.deepEqual(problems, []);
  assert.equal(value.fullName, "Ama Mensah");
  assert.equal(value.country, "GH");
  assert.equal(value.legalName, undefined);
});

test("a complete organisation form passes and keeps the company details", () => {
  const { value, problems } = validateOnboarding(organisation);
  assert.deepEqual(problems, []);
  assert.equal(value.legalName, "Accra Medical Supplies Ltd");
  assert.equal(value.phone, undefined);
});

test("missing choices are reported in form order", () => {
  const { problems } = validateOnboarding({});
  assert.deepEqual(problems, ["Choose individual or organisation.", "Enter your full name.", "Choose your country of residence.", "Choose at least one thing you want to do."]);
});

test("individuals need a phone number with enough digits", () => {
  assert.ok(validateOnboarding({ ...individual, phone: "12345" }).problems.includes("Enter a phone number, with the country code."));
  assert.ok(validateOnboarding({ ...individual, phone: "call me" }).problems.length > 0);
});

test("organisations need every company field, from the lists", () => {
  const { problems } = validateOnboarding({ ...organisation, industry: "Crypto", monthlyVolume: "lots", registrationNumber: "" });
  assert.deepEqual(problems, ["Enter the registration number.", "Choose an industry.", "Choose the expected monthly amount."]);
});

test("unknown intents are dropped", () => {
  const { value } = validateOnboarding({ ...individual, intents: ["payables", "trading"] });
  assert.deepEqual(value.intents, ["payables"]);
});

test("the country list has no duplicates and starts with the countries we cover", () => {
  assert.equal(new Set(COUNTRIES).size, COUNTRIES.length);
  assert.deepEqual(COUNTRIES.slice(0, 5), ["GH", "NG", "KE", "ZA", "EG"]);
});

test("only underwriting opens the Underwriter workspace", () => {
  assert.equal(startingRole(["underwrite"]), "underwriter");
  assert.equal(startingRole(["payables", "underwrite"]), "hedger");
  assert.equal(startingRole(["receivables"]), "hedger");
});

test("screening reports the worst result", () => {
  assert.equal(combineScreening(["clear", "clear"]), "clear");
  assert.equal(combineScreening(["clear", "inconclusive"]), "inconclusive");
  assert.equal(combineScreening(["inconclusive", "hit"]), "hit");
});
