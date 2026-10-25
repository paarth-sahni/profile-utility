/**
 * Purpose: every duration in a profile reads "MMM YYYY" ("Feb 2020"), ranges "Feb 2020 – Jun 2020"; the ways resumes
 * write dates are normalised, "Present" / "Current" are kept, and a date that cannot be read without guessing is left
 * as written and reported (lib/dates.ts).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeDuration, parseDate } from "./dates";

test("single dates in every common form become MMM YYYY", () => {
  const cases: [string, string][] = [
    ["Feb 2020", "Feb 2020"],
    ["February 2020", "Feb 2020"],
    ["june-2020", "Jun 2020"],
    ["JUNE 2020", "Jun 2020"],
    ["Sept 2021", "Sep 2021"],
    ["Sep. 2021", "Sep 2021"],
    ["September, 2021", "Sep 2021"],
    ["Jan'19", "Jan 2019"],
    ["Mar ’98", "Mar 1998"],
    ["06/2020", "Jun 2020"],
    ["6-2020", "Jun 2020"],
    ["06.2020", "Jun 2020"],
    ["2020-06", "Jun 2020"],
    ["2020/6", "Jun 2020"],
    ["2020-06-15", "Jun 2020"],
    ["15/06/2020", "Jun 2020"],
    ["06/15/2020", "Jun 2020"],
    ["5 June 2020", "Jun 2020"],
    ["June 5th, 2020", "Jun 2020"],
  ];
  for (const [input, want] of cases) assert.equal(parseDate(input), want, input);
});

test("ranges use an en dash with spaces; Present and Current are kept", () => {
  const cases: [string, string][] = [
    ["Mar 2021 - June-2021", "Mar 2021 – Jun 2021"],
    ["Feb 2020 – Jun 2020", "Feb 2020 – Jun 2020"],
    ["April-2017 - July 2018", "Apr 2017 – Jul 2018"],
    ["06/2019 to 01/2020", "Jun 2019 – Jan 2020"],
    ["2019-06 – 2020-01", "Jun 2019 – Jan 2020"],
    ["Aug-2016-Mar 2017", "Aug 2016 – Mar 2017"],
    ["Jan'19 - Mar'20", "Jan 2019 – Mar 2020"],
    ["Mar 2023 - Present", "Mar 2023 – Present"],
    ["Mar 2023 - present", "Mar 2023 – Present"],
    ["Mar 2023 – Current", "Mar 2023 – Current"],
    ["Mar 2023 till date", "Mar 2023 – Present"],
    ["Mar 2023 - Ongoing", "Mar 2023 – Present"],
    ["  Jul   2021  —  Dec 2021 ", "Jul 2021 – Dec 2021"],
  ];
  for (const [input, want] of cases) assert.deepEqual(normalizeDuration(input), { value: want, ok: true }, input);
});

test("an empty duration stays empty and is fine", () => {
  assert.deepEqual(normalizeDuration(""), { value: "", ok: true });
  assert.deepEqual(normalizeDuration("   "), { value: "", ok: true });
});

test("dates that cannot be read without guessing are kept as written and reported", () => {
  for (const input of [
    "2019 - 2020", // no months
    "2020",
    "Q3 2020",
    "03/04/2020", // March or April?
    "13/2020", // no 13th month
    "Summer 2020",
    "Jun 20", // June 20th or June 2020?
    "Feb 2020 - 2021", // the end has no month
    "Present",
    "6 months",
    "Jun 1890",
  ]) {
    assert.deepEqual(normalizeDuration(input), { value: input.trim(), ok: false }, input);
  }
});
