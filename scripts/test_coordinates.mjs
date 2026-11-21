// node --test scripts/test_coordinates.mjs
// Node 24 runs the TypeScript util directly (type stripping).
import { test } from "node:test";
import assert from "node:assert/strict";
import { isInMalaysia, parseLocationText as p } from "../src/utils/coordinates.ts";

const near = (r, lat, lng) => {
  assert.equal(r?.kind, "coords", JSON.stringify(r));
  assert.ok(Math.abs(r.latitude - lat) < 1e-4, `lat ${r.latitude}`);
  assert.ok(Math.abs(r.longitude - lng) < 1e-4, `lng ${r.longitude}`);
};

test("plain decimal coordinates", () => {
  near(p("3.1390, 101.6869"), 3.139, 101.6869);
  near(p("3.1390 101.6869"), 3.139, 101.6869);
  near(p("(3.1390,101.6869)"), 3.139, 101.6869);
  near(p("  -6.2,106.8 "), -6.2, 106.8);
});

test("swapped order is put right", () => {
  near(p("101.6869, 3.1390"), 3.139, 101.6869);
});

test("degrees, minutes, seconds", () => {
  near(p(`3°08'20.4"N 101°41'12.8"E`), 3.139, 101.686889);
  near(p("3 8.34 N, 101 41.21 E"), 3.139, 101.686833);
});

test("Google Maps place link prefers the pin over the view centre", () => {
  near(
    p("https://www.google.com/maps/place/Pudu/@3.1300,101.7000,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d3.1350!4d101.6990"),
    3.135,
    101.699,
  );
});

test("other link shapes", () => {
  near(p("https://maps.google.com/?q=3.139,101.687"), 3.139, 101.687);
  near(p("https://www.google.com/maps/search/3.139,+101.687?entry=tts"), 3.139, 101.687);
  near(p("https://www.google.com/maps/@3.139,101.687,15z"), 3.139, 101.687);
  near(p("geo:3.139,101.687"), 3.139, 101.687);
  near(p("https://maps.apple.com/?ll=3.139,101.687&q=Bus"), 3.139, 101.687);
  near(p("Bus broke down here https://maps.google.com/?q=3.139,101.687 please"), 3.139, 101.687);
});

test("short links need resolving", () => {
  assert.deepEqual(p("https://maps.app.goo.gl/AbCdEf123"), { kind: "shortLink", url: "https://maps.app.goo.gl/AbCdEf123" });
  assert.equal(p("https://goo.gl/maps/xyz")?.kind, "shortLink");
});

test("place names go to the geocoder", () => {
  assert.deepEqual(p("https://www.google.com/maps/search/?api=1&query=Hentian+Pudu"), { kind: "query", text: "Hentian Pudu" });
  assert.deepEqual(p("Hentian Pudu, Kuala Lumpur"), { kind: "query", text: "Hentian Pudu, Kuala Lumpur" });
});

test("junk", () => {
  assert.equal(p(""), null);
  assert.equal(p("123"), null);
  assert.equal(p("200, 300"), null);
  assert.equal(p("https://example.com/nothing"), null);
});

test("Malaysia bounds", () => {
  assert.equal(isInMalaysia(3.139, 101.687), true); // KL
  assert.equal(isInMalaysia(5.98, 116.07), true); // Kota Kinabalu
  assert.equal(isInMalaysia(1.29, 103.85), true); // Singapore sits inside the rough box
  assert.equal(isInMalaysia(13.75, 100.5), false); // Bangkok
});
