// Tests for index.js, the web server Render runs. They call the app directly
// with chai-http, so they need no emulators and no Maps key.
import { existsSync } from "node:fs";
import chai from "chai";
import chaiHttp from "chai-http";
import { createApp } from "../index.js";

chai.use(chaiHttp);
const { expect } = chai;

const MAPS_CONFIG = "/login-and-registration/maps-config.local.js";

describe("Web server (index.js)", () => {
  const app = createApp({ mapsApiKey: "" });

  it("GET /welcome answers, like Lab 10's welcome route", async () => {
    const res = await chai.request(app).get("/welcome");
    expect(res).to.have.status(200);
    expect(res.body).to.deep.equal({ status: "success", message: "Welcome!" });
  });

  it("sends / to the home page, which handles logging in", async () => {
    const res = await chai.request(app).get("/").redirects(0);
    expect(res).to.have.status(302);
    expect(res).to.redirectTo("/login-and-registration/home.html");
  });

  it("serves the pages, scripts and styles", async () => {
    for (const [url, type] of [
      ["/login-and-registration/login.html", "text/html"],
      ["/login-and-registration/home.js", "text/javascript"],
      ["/firebase/events.js", "text/javascript"],
      ["/assets/style.css", "text/css"],
    ]) {
      const res = await chai.request(app).get(url);
      expect(res, url).to.have.status(200);
      expect(res.headers["content-type"], url).to.include(type);
    }
  });

  it("never serves the notifier, tests, packages or other files outside the page folders", async () => {
    for (const url of [
      "/notifier/.env.example",
      "/notifier/src/index.js",
      "/package.json",
      "/index.js",
      "/firebase/tests/helpers.js",
      "/firebase/node_modules/firebase/package.json",
      "/firebase/.firebaserc",
      "/assets/../package.json",
    ]) {
      const res = await chai.request(app).get(url);
      expect(res, url).to.have.status(404);
    }
  });

  it("serves the Maps key from MAPS_API_KEY as the module home.js imports", async () => {
    const res = await chai.request(createApp({ mapsApiKey: " test-key-123 " })).get(MAPS_CONFIG);
    expect(res).to.have.status(200);
    expect(res.headers["content-type"]).to.include("text/javascript");
    expect(res.headers["cache-control"]).to.equal("no-store");
    expect(res.text).to.equal('export const MAPS_API_KEY = "test-key-123";\n');
  });

  it("without a key, still serves that module so the rest of the home page loads", async () => {
    const res = await chai.request(app).get(MAPS_CONFIG);
    expect(res).to.have.status(200);
    expect(res.text).to.include("export const MAPS_API_KEY");
    // A developer's own maps-config.local.js wins when there's no MAPS_API_KEY.
    if (!existsSync(new URL(`..${MAPS_CONFIG}`, import.meta.url))) {
      expect(res.text).to.include('export const MAPS_API_KEY = "";');
      expect(res.text).to.include("console.warn");
    }
  });
});
