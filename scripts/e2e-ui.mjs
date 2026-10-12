/**
 * Purpose: optional browser test for the saved-profile screens and exports (npm run test:e2e): Open in Google
 * Docs on Review, /profiles/[id] and /manage/[id], and (added with later features) previews, version labels and the
 * unsaved-changes dialog. Google is STUBBED in the page (a fake token client) and Drive requests are intercepted, so
 * nothing real is called and the test can prove what is sent where. Local stack and seeded users only.
 * The Google checks need NEXT_PUBLIC_GOOGLE_CLIENT_ID set (any value) in .env.local when `npm run dev` starts;
 * without it they are skipped.
 */
import { startHarness } from "./e2e-lib.mjs";

const t = await startHarness("e2e-ui");
const { check, goto, click, bodyText, waitFor, ev, sleep, sql, signIn, send, on, APP } = t;

const FAKE_TOKEN = "FAKE-TOKEN-e2e-123";
const DRIVE_URL = "https://www.googleapis.com/upload/drive/v3/files";

/** A profile that passes the strict schema (so it can be exported). */
const COMPLETE = {
  name: "E2E Docs Person",
  jobTitle: "Senior Engineer",
  experienceSummary: "8+ Years of Industry Experience",
  specialization: "Java and cloud",
  overview: "An overview.",
  education: [{ year: "2014", qualification: "B.E." }],
  projects: [
    { duration: "2020 - 2022", title: "Billing Platform", toolsAndTechnologies: ["Java"], teamSize: "4", role: "Lead", projectLink: "", description: "Built it.", responsibilities: ["Designed the schema"] },
  ],
  skills: [{ name: "Java", rating: "4" }],
  certifications: ["Sample Cloud Associate"],
  tools: ["Git"],
  managerialExperience: [],
  domains: ["Fintech"],
  languages: ["English"],
};

/** Saves a profile through the real API as the signed-in user and returns { profileId, versionId }. */
async function saveProfile(data, label = "Base", reviewFlags = []) {
  const saved = await ev(`fetch('/api/profiles',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({template:'internal',kind:'base',label:${JSON.stringify(label)},source:'scratch',data:${JSON.stringify(data)},reviewFlags:${JSON.stringify(reviewFlags)},promptPlan:[]})}).then(r=>r.json())`);
  if (!saved?.profileId) {
    throw new Error(`save failed (${JSON.stringify(saved?.error)}). The save API allows 60 saves per 10 minutes per user (in memory): wait a few minutes or restart \`npm run dev\` before re-running.`);
  }
  return saved;
}

// ---- Google stub: a fake GIS token client in the page, and Drive requests answered by the test
await send("Page.addScriptToEvaluateOnNewDocument", {
  // every DOCX blob given to URL.createObjectURL (file-saver does that for a download) is kept for inspection
  source: `window.__blobs = []; { const make = URL.createObjectURL.bind(URL);
      URL.createObjectURL = (o) => { if (o instanceof Blob && o.type.includes('wordprocessingml')) window.__blobs.push(o); return make(o); }; }
    window.__gis = { calls: 0, scope: null, mode: 'ok' };
    window.google = { accounts: { oauth2: { initTokenClient(cfg) { return { requestAccessToken() {
      window.__gis.calls++; window.__gis.scope = cfg.scope;
      const m = window.__gis.mode;
      setTimeout(() => {
        if (m === 'ok') cfg.callback({ access_token: '${FAKE_TOKEN}' });
        else if (m === 'denied') cfg.callback({ error: 'access_denied' });
        else cfg.error_callback({ type: m === 'blocked' ? 'popup_failed_to_open' : 'popup_closed' });
      }, 50);
    } }; } } } };`,
});
await send("Fetch.enable", { patterns: [{ urlPattern: "https://www.googleapis.com/*" }] });
let driveReply = { status: 200, body: { id: "e2e-doc", webViewLink: "https://docs.google.com/document/d/e2e-doc/edit" } };
const driveRequests = [];
const CORS = [
  { name: "Access-Control-Allow-Origin", value: "*" },
  { name: "Access-Control-Allow-Headers", value: "authorization, content-type" },
  { name: "Access-Control-Allow-Methods", value: "POST, OPTIONS" },
];
on("Fetch.requestPaused", async (p) => {
  if (p.request.method === "OPTIONS") {
    // CORS preflight (the Authorization header makes the browser send one): approve it, do not count it
    await send("Fetch.fulfillRequest", { requestId: p.requestId, responseCode: 204, responseHeaders: CORS });
    return;
  }
  driveRequests.push({ url: p.request.url, headers: p.request.headers, body: p.request.postData ?? "" });
  await send("Fetch.fulfillRequest", {
    requestId: p.requestId,
    responseCode: driveReply.status,
    responseHeaders: [{ name: "Content-Type", value: "application/json" }, ...CORS],
    body: Buffer.from(JSON.stringify(driveReply.body)).toString("base64"),
  });
});
const toApp = []; // everything sent to our own origin
on("Network.requestWillBeSent", (p) => {
  if (p.request.url.startsWith(APP)) toApp.push({ url: p.request.url, headers: JSON.stringify(p.request.headers), body: p.request.postData ?? "" });
});
const setMode = (mode) => ev(`window.__gis.mode=${JSON.stringify(mode)}`);
const gisCalls = () => ev("window.__gis.calls");
const googleButton = () => ev("!!document.querySelector('[data-google-docs] button')");
const clickGoogle = () => click("Open in Google Docs");
const statusText = () => ev("document.querySelector('[data-google-docs]')?.innerText ?? ''");

await t.scenario("Open in Google Docs (managers and admins only)", async () => {
  await signIn("admin"); // Google Docs is for managers and admins. Admin is used to save: only team members and admins may create profiles (RLS)
  await goto("/internal");
  const saved = await saveProfile(COMPLETE);
  const incomplete = await saveProfile({ ...COMPLETE, name: "E2E Incomplete Person", overview: "" }, "Draft");
  await goto(`/profiles/${saved.profileId}`);
  await waitFor("document.body.innerText.includes('E2E Docs Person')", "profile page");
  if (!(await googleButton())) {
    console.log("SKIP  Open in Google Docs: NEXT_PUBLIC_GOOGLE_CLIENT_ID is not set for the running dev server");
    return;
  }

  check("the button shows on /profiles/[id]", true);
  await clickGoogle();
  await waitFor("document.querySelector('[data-google-docs]')?.innerText.includes('Created in your Google Drive')", "created message");
  const req = driveRequests.at(-1);
  check("only the drive.file scope was requested", (await ev("window.__gis.scope")) === "https://www.googleapis.com/auth/drive.file");
  check("one upload went to www.googleapis.com", driveRequests.length === 1 && req.url.startsWith(DRIVE_URL));
  check("the token was sent to Google as a Bearer header", req.headers.Authorization === `Bearer ${FAKE_TOKEN}`);
  check("the upload asks Drive to convert the DOCX to a Google Doc", req.body.includes("application/vnd.google-apps.document") && req.body.includes("E2E Docs Person"));
  check("a link to the new document is shown", (await ev("document.querySelector('[data-google-docs] a')?.href")) === "https://docs.google.com/document/d/e2e-doc/edit");
  check("the token never went to our server (URLs, headers, bodies)", toApp.every((r) => !r.url.includes(FAKE_TOKEN) && !r.headers.includes(FAKE_TOKEN) && !r.body.includes(FAKE_TOKEN)));
  const stored = await ev(`JSON.stringify([document.cookie, Object.entries(localStorage), Object.entries(sessionStorage)])`);
  check("the token is not stored (cookies, localStorage, sessionStorage)", !stored.includes(FAKE_TOKEN));

  // Friendly errors
  for (const [mode, expected] of [["blocked", "blocked the Google sign-in window"], ["closed", "closed before you finished"], ["denied", "access was not granted"]]) {
    await goto(`/profiles/${saved.profileId}`);
    await setMode(mode);
    await clickGoogle();
    await waitFor("!!document.querySelector('[data-google-docs] [role=alert]')", `error for ${mode}`);
    const text = await statusText();
    check(`"${mode}" shows a friendly message`, text.includes(expected) && !/token|undefined|Error/i.test(text), text);
  }
  await goto(`/profiles/${saved.profileId}`);
  driveReply = { status: 403, body: { error: { errors: [{ reason: "accessNotConfigured" }] } } };
  await clickGoogle();
  await waitFor("!!document.querySelector('[data-google-docs] [role=alert]')", "api disabled");
  check("Drive API off shows an admin-facing hint", (await statusText()).includes("not enabled for this app yet"));
  driveReply = { status: 200, body: { id: "e2e-doc", webViewLink: "https://docs.google.com/document/d/e2e-doc/edit" } };

  // An incomplete version is stopped before Google is contacted
  await goto(`/profiles/${incomplete.profileId}`);
  const before = await gisCalls();
  await clickGoogle();
  await waitFor("!!document.querySelector('[data-google-docs] [role=alert]')", "incomplete message");
  check("an incomplete profile is refused before any Google popup", (await statusText()).includes("Incomplete:") && (await gisCalls()) === before);

  // Edit details: an incomplete form cannot reach Preview, so Google is never contacted
  await goto("/internal");
  await click("Get started");
  await waitFor("!!document.querySelector('label input')", "edit form");
  const calls = await gisCalls();
  await click("Preview →");
  await sleep(500);
  check("an incomplete form stays on Edit details with the errors shown", (await bodyText()).includes("before continuing") && !(await ev("!!document.querySelector('[data-preview-step]')")));
  check("and no Google popup was opened", (await gisCalls()) === calls);

  // Manager: read-only page with both export buttons
  await signIn("manager");
  await goto(`/manage/${saved.profileId}`);
  await waitFor("document.body.innerText.includes('E2E Docs Person')", "manage page");
  const manage = await bodyText();
  check("/manage/[id] has Download DOCX and Open in Google Docs", manage.includes("Download DOCX") && (await googleButton()));
  check("/manage/[id] stays read-only (no editing or saving controls)", !manage.includes("Save") && !manage.includes("Open in Review"));
  await clickGoogle();
  await waitFor("document.querySelector('[data-google-docs]')?.innerText.includes('Created in your Google Drive')", "manager created");
  check("a manager can export the version they are viewing", true);

  // Preview: Google Docs uploads the previewed file, after the consent box
  await goto("/internal");
  await ev("sessionStorage.clear()");
  await goto("/internal");
  await click("Get started");
  await waitFor("!!document.querySelector('label input')", "edit form (manager)");
  await t.fillRequired("E2E Google Preview");
  await click("Preview →");
  await waitFor("!!document.querySelector('[data-doc-preview=ready]')", "preview (manager)");
  check("a manager sees Open in Google Docs on Preview", await googleButton());
  const since = sql("select now()");
  const popups = await gisCalls();
  const uploads = driveRequests.length;
  await clickGoogle();
  await sleep(500);
  check("without the consent box: a message, no Google popup, no upload", (await statusText()).includes("Please tick the box") && (await gisCalls()) === popups && driveRequests.length === uploads);
  await ev("document.querySelector('[data-preview-step] input[type=checkbox]').click()");
  await clickGoogle();
  await waitFor("document.querySelector('[data-google-docs]')?.innerText.includes('Created in your Google Drive')", "created from Preview");
  check("with the box ticked the DOCX is uploaded to Google", driveRequests.length === uploads + 1 && driveRequests.at(-1).body.includes("E2E Google Preview"));
  check("and the consent was recorded for google_docs", Number(sql(`select count(*) from audit_log where action='consent_google_docs' and at >= '${since}'`)) === 1);

  // A plain member never sees Google Docs: not on Preview, not on My Profiles
  await signIn("member");
  await goto("/internal");
  const mine = await saveProfile({ ...COMPLETE, name: "E2E Member Docs Person" });
  await goto(`/profiles/${mine.profileId}`);
  await waitFor("document.body.innerText.includes('E2E Member Docs Person')", "member's profile page");
  check("a member sees Download DOCX but no Open in Google Docs on My Profiles", (await bodyText()).includes("Download DOCX") && !(await googleButton()) && !(await bodyText()).includes("Open in Google Docs"));
  await goto("/internal");
  await ev("sessionStorage.clear()");
  await goto("/internal");
  await click("Get started");
  await waitFor("!!document.querySelector('label input')", "edit form (member)");
  await t.fillRequired("E2E Member Preview");
  await click("Preview →");
  await waitFor("!!document.querySelector('[data-doc-preview=ready]')", "preview (member)");
  check("a member sees no Open in Google Docs on Preview", !(await googleButton()) && !(await bodyText()).includes("Open in Google Docs") && (await bodyText()).includes("Download DOCX"));
  await goto("/profiles"); // leaving flushes the form above as a draft; clear it here so later scenarios start clean
  await ev("sessionStorage.clear()");
});

await t.scenario("previews hide empty sections and show ratings as x/5", async () => {
  await signIn("member");
  await goto("/internal");
  const sparse = {
    name: "E2E Sparse Person", jobTitle: "Engineer", experienceSummary: "", specialization: "", overview: "",
    education: [],
    projects: [
      { duration: "", title: "Real Project", toolsAndTechnologies: [""], teamSize: "N/A", role: "", projectLink: "", description: "", responsibilities: [""] },
      { duration: "", title: "", toolsAndTechnologies: [], teamSize: "", role: "", projectLink: "", description: "", responsibilities: [] },
    ],
    skills: [{ name: "Java", rating: "4" }, { name: "SQL", rating: "" }, { name: "", rating: "" }],
    certifications: [], tools: ["", "Git"], managerialExperience: [""], domains: [], languages: [],
  };
  const saved = await saveProfile(sparse);
  const inspect = () =>
    ev(`(()=>{const a=document.querySelector('article'); const sec=(t)=>[...a.querySelectorAll('section')].find(s=>s.querySelector('h3')?.textContent===t);
      return JSON.stringify({
        headings:[...a.querySelectorAll('h3')].map(h=>h.textContent),
        emptyItems:[...a.querySelectorAll('li')].filter(li=>!li.textContent.trim()).length,
        skills:[...(sec('Skills')?.querySelectorAll('li')??[])].map(li=>li.innerText),
        tools:[...(sec('Tools')?.querySelectorAll('li')??[])].map(li=>li.textContent.trim()),
        projectCards:(sec('Projects')?.querySelectorAll('.rounded-lg')??[]).length,
        projectBullets:(sec('Projects')?.querySelectorAll('ul.list-disc li')??[]).length,
        hasTeam:a.textContent.includes('Team:'), hasDash:a.textContent.includes('—'),
      })})()`);
  for (const [who, path] of [["member", `/profiles/${saved.profileId}`], ["manager", `/manage/${saved.profileId}`]]) {
    await signIn(who);
    await goto(path);
    await waitFor("document.body.innerText.includes('E2E Sparse Person')", `${who} preview`);
    const r = JSON.parse(await inspect());
    r.skills = r.skills.map((x) => x.replace(/\s+/g, " ").trim());
    check(`${path.split("/")[1]}: only sections with content are shown`, JSON.stringify(r.headings) === JSON.stringify(["Skills", "Tools", "Projects"]), JSON.stringify(r.headings));
    check(`${path.split("/")[1]}: ratings read x/5, a blank rating shows nothing, blank skills are dropped`, JSON.stringify(r.skills) === JSON.stringify(["Java 4/5", "SQL"]), JSON.stringify(r.skills));
    check(`${path.split("/")[1]}: blank chips and lone empty bullets are gone`, JSON.stringify(r.tools) === JSON.stringify(["Git"]) && r.emptyItems === 0 && r.projectBullets === 0, JSON.stringify(r));
    check(`${path.split("/")[1]}: an empty project is skipped and an N/A team size is hidden`, r.projectCards === 1 && !r.hasTeam && !r.hasDash, JSON.stringify(r));
  }
});

await t.scenario("version labels default to Base, then v2, v3...; role-specific asks for a name", async () => {
  await signIn("member");
  await goto("/internal");
  await click("Get started");
  await waitFor("!!document.querySelector('label input')", "review form");
  await t.fillRequired("E2E Label Test"); // saving needs the required fields
  const label = () => ev("document.getElementById('save-label').value");
  const setLabel = (v) => ev(`(()=>{const i=document.getElementById('save-label'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,${JSON.stringify(v)}); i.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  const saved = (text) => waitFor(`document.body.innerText.includes(${JSON.stringify(text)})`, text);
  const roleBox = () => ev("[...document.querySelectorAll('label')].find(l=>l.textContent.includes('role-specific'))?.querySelector('input')?.click()");
  const versions = () => sql("select string_agg(version_no||':'||kind||':'||label, ' | ' order by version_no) from profile_versions where profile_id=(select id from profiles where candidate_name='E2E Label Test')");

  check("the first save defaults to Base", (await label()) === "Base");
  await click("Save to My Profiles");
  await saved("Saved · v1 · Base");
  check("after saving, the box holds the next default (v2), not an empty box", (await label()) === "v2");
  await click("Save new version");
  await saved("Saved · v2 · v2");
  check("and then v3", (await label()) === "v3");

  await roleBox();
  await sleep(200);
  check("ticking role-specific clears the box and marks it required", (await label()) === "" && (await ev("document.querySelector('label[for=save-label]').textContent")).includes("(required)"));
  await click("Save new version");
  await waitFor("document.body.innerText.includes('Give this role-specific version a name')", "name required message");
  check("a role-specific version without a name is refused", (await versions()) === "1:base:Base | 2:base:v2");
  await roleBox();
  await sleep(200);
  check("unticking brings the default back", (await label()) === "v3");

  await roleBox();
  await setLabel("Java Backend");
  await click("Save new version");
  await saved("Saved · v3 · Java Backend");
  check("a named role-specific version saves with its parent", (await versions()) === "1:base:Base | 2:base:v2 | 3:role_specific:Java Backend");
  check("the next default continues at v4 and the box is a normal version again", (await label()) === "v4");

  // Opening a saved version pre-fills the next number too
  const profile = sql("select id from profiles where candidate_name='E2E Label Test'");
  const v1 = sql(`select id from profile_versions where profile_id='${profile}' and version_no=1`);
  await goto(`/internal?version=${v1}`);
  await waitFor("!!document.getElementById('save-label')", "saved version open");
  check("opening v1 pre-fills v2", (await label()) === "v2");
});

await t.scenario("unsaved-changes dialog (branded) when leaving through an in-app link", async () => {
  await signIn("member");
  await goto("/internal");
  await ev("sessionStorage.clear()");
  await goto("/internal");
  await click("Get started");
  await waitFor("!!document.querySelector('label input')", "review form");
  await t.fillRequired("E2E Leave Test");
  const nativeBefore = t.dialogs.length;
  const dialogOpen = () => ev("!!document.querySelector('dialog[open]')");
  /** My Profiles is in the avatar menu (not the header row): open the menu, then click the link. */
  const clickMyProfiles = async () => {
    if (!(await ev("!!document.querySelector('a[role=menuitem]')"))) await ev("document.querySelector('header button[aria-haspopup]')?.click()");
    await sleep(200);
    await click("My Profiles", "a[role=menuitem]");
  };
  const beforeUnloadPrevented = () => ev("(()=>{const e=new Event('beforeunload',{cancelable:true}); window.dispatchEvent(e); return e.defaultPrevented})()");

  check("the browser's own beforeunload prompt stays active for refresh and close", await beforeUnloadPrevented());

  await clickMyProfiles();
  await waitFor("!!document.querySelector('dialog[open]')", "leave dialog");
  check("clicking a nav link asks 'Leave without saving?' in the branded dialog", (await bodyText()).includes("Leave without saving?") && (await ev("location.pathname")) === "/internal");
  check("the buttons are Stay and Leave anyway, and focus starts on Stay", (await ev("[...document.querySelectorAll('dialog[open] button')].map(b=>b.textContent.trim()).join('|')")) === "Stay|Leave anyway" && (await ev("document.activeElement?.textContent?.trim()")) === "Stay");
  check("no native confirm() was used", t.dialogs.length === nativeBefore);
  await t.key("Escape", "Escape", 27);
  await sleep(300);
  check("Esc = Stay: the dialog closes and the form is untouched", !(await dialogOpen()) && (await ev("location.pathname")) === "/internal" && (await t.getName()) === "E2E Leave Test");

  await clickMyProfiles();
  await waitFor("!!document.querySelector('dialog[open]')", "dialog again");
  await click("Stay");
  await sleep(300);
  check("Stay keeps you on the page", !(await dialogOpen()) && (await ev("location.pathname")) === "/internal");

  // saving removes the warning
  await click("Save to My Profiles");
  await waitFor("document.body.innerText.includes('Saved')", "saved");
  await sleep(300);
  check("after saving, beforeunload no longer fires and links do not ask", !(await beforeUnloadPrevented()));

  // typing again brings it back; Leave anyway goes through
  await t.setName("E2E Leave Test 2");
  await sleep(200);
  await clickMyProfiles();
  await waitFor("!!document.querySelector('dialog[open]')", "dialog (leave)");
  await click("Leave anyway");
  await waitFor("location.pathname === '/profiles'", "navigated to My Profiles");
  check("Leave anyway navigates to the link", true);
  check("it was an in-app navigation (no native prompt)", t.dialogs.length === nativeBefore);

  // a clean page never asks (leaving anyway kept a draft in this tab: clear it so no restore prompt interferes)
  await goto("/internal");
  await ev("sessionStorage.clear()");
  await goto("/internal");
  await click("Get started");
  await waitFor("!!document.querySelector('label input')", "form");
  await clickMyProfiles();
  await sleep(500);
  check("a blank form nobody typed into still counts as unsaved work, so it asks", await dialogOpen());
  await click("Leave anyway");
  await waitFor("location.pathname === '/profiles'", "left");
});

await t.scenario("brand rules on My Profiles, Manage and the previews (computed styles)", async () => {
  await signIn("member");
  await goto("/internal");
  const saved = await saveProfile({ ...COMPLETE, name: "E2E Brand Person" });
  const audit = () =>
    ev(`(()=>{const heads=[...document.querySelectorAll('main h1, main h2, main h3, section.bg-cream h1')];
      const heavy=heads.filter(h=>parseInt(getComputedStyle(h).fontWeight)>500).map(h=>h.tagName+':'+getComputedStyle(h).fontWeight+':'+h.textContent.slice(0,24));
      const all=[...document.querySelectorAll('main *')];
      return JSON.stringify({ heads:heads.length, heavy,
        italic: all.filter(e=>getComputedStyle(e).fontStyle==='italic').length,
        gradients: all.filter(e=>getComputedStyle(e).backgroundImage.includes('gradient')).length,
        hero: !!document.querySelector('section.bg-cream h1'),
        font: getComputedStyle(document.querySelector('main')).fontFamily.toLowerCase().includes('lexend') });})()`);
  const pages = [["member", "/profiles"], ["member", `/profiles/${saved.profileId}`], ["manager", "/manage"], ["manager", `/manage/${saved.profileId}`]];
  for (const [who, path] of pages) {
    await signIn(who);
    await goto(path);
    await waitFor("!!document.querySelector('main h1, section.bg-cream h1')", `${path} rendered`);
    const r = JSON.parse(await audit());
    const name = path.replace(saved.profileId, "[id]");
    check(`${name}: headings are Lexend Medium, never bold`, r.heads > 0 && r.heavy.length === 0, JSON.stringify(r.heavy));
    check(`${name}: no italics, no gradients, Lexend font`, r.italic === 0 && r.gradients === 0 && r.font, JSON.stringify(r));
    check(`${name}: uses the same cream hero band as the generator`, r.hero);
  }
});

await t.scenario("optional sections: 'left out of the document' notes, and only the required fields are enough", async () => {
  await signIn("member");
  await goto("/internal");
  await ev("sessionStorage.clear()");
  await goto("/internal");
  await click("Get started");
  await waitFor("!!document.querySelector('label input')", "review form");
  /** Types into the field whose label text is exactly `label` (ignoring "(optional)"), input or textarea. */
  const fill = (label, value) =>
    ev(`(()=>{const l=[...document.querySelectorAll('label')].find(l=>(l.querySelector('span')?.textContent??'').replace('(optional)','').trim()===${JSON.stringify(label)}); const i=l?.querySelector('input,textarea'); if(!i) return false; const proto=i.tagName==='TEXTAREA'?HTMLTextAreaElement:HTMLInputElement; Object.getOwnPropertyDescriptor(proto.prototype,'value').set.call(i,${JSON.stringify(value)}); i.dispatchEvent(new Event('input',{bubbles:true})); return true})()`);
  const notes = () =>
    ev(`JSON.stringify([...document.querySelectorAll('h3')].filter(h=>h.textContent.includes('left out of the document')).map(h=>h.textContent.replace('— left out of the document','').trim()))`);

  const blank = JSON.parse(await notes());
  check("a blank form marks every optional section as left out", JSON.stringify(blank) === JSON.stringify(["Projects", "Certifications", "Tools", "Managerial Experience", "Domains", "Languages"]), JSON.stringify(blank));
  check("required sections never show the note", !blank.some((n) => /Profile|Education|Skills/i.test(n)));

  // required fields only
  await fill("Name", "E2E Required Only");
  await fill("Job title", "Engineer");
  await fill("Overview", "Only the overview.");
  await fill("Year", "2014");
  await fill("Qualification", "B.E.");
  await fill("Skill", "Java");
  await fill("Rating out of 5 (e.g. 4)", "4");
  await sleep(300);
  await click("Preview →");
  await waitFor("!!document.querySelector('[data-doc-preview=ready]')", "preview of a profile with only the required fields");
  check("a profile with only the required fields reaches Preview (no validation errors)", !(await bodyText()).includes("before continuing"));
  await click("← Back to edit");
  await waitFor("!!document.querySelector('label input')", "back on Edit details");

  // filling an optional section removes its note
  await fill("Certifications", "x"); // not a label: no-op guard
  const certInput = await ev(`(()=>{const h=[...document.querySelectorAll('h3')].find(h=>h.textContent.startsWith('Certifications')); const i=h?.closest('section')?.querySelector('input'); if(!i) return false; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'Sample Cloud Associate,'); i.dispatchEvent(new Event('input',{bubbles:true})); return true})()`);
  await sleep(300);
  const after = JSON.parse(await notes());
  check("typing in an optional section removes its note", certInput && !after.includes("Certifications") && after.includes("Tools"), JSON.stringify(after));

  // required field cleared again -> clear error, naming the field
  await fill("Overview", "");
  await click("Preview →");
  await waitFor("document.body.innerText.toLowerCase().includes('overview')", "overview error");
  check("a missing required field is reported and Preview is not entered", !(await ev("!!document.querySelector('[data-preview-step]')")));
});

await t.scenario("Preview step: exact DOCX, consent before Download / Submit, Back keeps edits", async () => {
  await signIn("member");
  await goto("/internal");
  await ev("sessionStorage.clear()");
  await goto("/internal");
  await click("Get started");
  await waitFor("!!document.querySelector('label input')", "edit form");
  const since = sql("select now()");
  const consents = (action) => Number(sql(`select count(*) from audit_log where action='consent_${action}' and at >= '${since}' and actor_id=(select id from auth.users where email='member@example.test')`));
  const labels = () => ev("[...document.querySelectorAll('ol li button')].map(b=>b.textContent.replace(/^[^A-Za-z]+/,'').trim()).join('|')");

  check("the steps are Start, Upload resume, Edit details, Preview (no Submit step)", (await labels()) === "Start|Upload resume|Edit details|Preview", await labels());
  check("there is no 'Submit Profile' link in the top menu", !(await ev("[...document.querySelectorAll('header a')].some(a=>/submit profile/i.test(a.textContent))")));
  const bodyBefore = await bodyText();
  check("Edit details no longer offers DOCX or Google Docs buttons", !bodyBefore.includes("DOCX ↓") && !bodyBefore.includes("Open in Google Docs"));

  // validation runs before Preview: an empty form stays on Edit
  await click("Preview →");
  await sleep(500);
  check("an incomplete profile does not enter Preview; the errors are shown on Edit details", (await bodyText()).includes("before continuing") && !(await ev("!!document.querySelector('[data-preview-step]')")));

  await t.fillRequired("E2E Preview Person");
  await click("Preview →");
  await waitFor("!!document.querySelector('[data-doc-preview=ready]')", "preview rendered");
  const shown = await ev("document.querySelector('[data-doc-preview] section.docx, [data-doc-preview] .docx-wrapper')?.innerText ?? ''");
  check("the DOCX itself is rendered in the page (docx-preview) with the candidate's name", shown.includes("E2E Preview Person"), shown.slice(0, 80));
  const body = await bodyText();
  check("Preview offers Back to edit, Download DOCX and Submit", ["← Back to edit", "Download DOCX", "Submit"].every((x) => body.includes(x)));
  check("the consent checkbox has the agreed wording and starts unticked", body.includes("I confirm the information in this profile is accurate and may be shared") && (await ev("document.querySelector('[data-preview-step] input[type=checkbox]').checked")) === false);

  // consent is required, and recorded, before each action
  await click("Download DOCX");
  await sleep(400);
  check("Download without the consent box shows a message and focuses the box", (await bodyText()).includes("Please tick the box to confirm") && (await ev("document.activeElement?.type")) === "checkbox");
  check("nothing was downloaded and nothing was recorded", (await ev("window.__blobs.length")) === 0 && consents("download") === 0);
  await click("Submit", "[data-preview-step] button");
  await sleep(400);
  check("Submit without the consent box saves nothing", !(await ev("!!document.querySelector('[data-submitted]')")) && consents("submit") === 0);

  await ev("document.querySelector('[data-preview-step] input[type=checkbox]').click()");
  await sleep(200);
  check("ticking the box clears the message", !(await bodyText()).includes("Please tick the box to confirm"));
  await click("Download DOCX");
  await waitFor("document.body.innerText.includes('DOCX downloaded')", "downloaded");
  check("the consent was recorded in audit_log (metadata only) before the download", consents("download") === 1 && sql(`select detail::text from audit_log where action='consent_download' and at >= '${since}' order by id desc limit 1`).includes('"template": "internal"'));
  const dl = JSON.parse(await ev(`(async()=>{const b=window.__blobs.at(-1); if(!b) return 'null'; const buf=new Uint8Array(await b.arrayBuffer()); let s=''; for(const x of buf) s+=String.fromCharCode(x); return JSON.stringify({size:b.size,b64:btoa(s)})})()`));
  check("exactly one DOCX was handed to the browser", dl && dl.size > 1000);
  if (dl) {
    const { default: PizZip } = await import("pizzip");
    const xml = new PizZip(Buffer.from(dl.b64, "base64")).file("word/document.xml").asText();
    const text = [...xml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]).join(" ");
    check("the downloaded file contains the same content that was previewed (name, job title, overview)", ["E2E Preview Person", "Engineer", "Only the overview."].every((x) => text.includes(x) && shown.includes(x)), text.slice(0, 120));
  }

  // Back keeps the edits
  await click("← Back to edit");
  await waitFor("!!document.querySelector('label input')", "back on edit");
  check("Back to edit keeps everything that was typed", (await t.getName()) === "E2E Preview Person");

  // Submit: consent first, then the version is saved and the success message appears ON Preview (no other step)
  await click("Preview →");
  await waitFor("!!document.querySelector('[data-doc-preview=ready]')", "preview again");
  check("the consent box is ticked fresh each time Preview is entered", (await ev("document.querySelector('[data-preview-step] input[type=checkbox]').checked")) === false);
  await ev("document.querySelector('[data-preview-step] input[type=checkbox]').click()");
  await click("Submit", "[data-preview-step] button");
  await waitFor("!!document.querySelector('[data-submitted]')", "success message");
  const versionsOf = () => Number(sql("select count(*) from profile_versions v join profiles p on p.id=v.profile_id where p.candidate_name='E2E Preview Person'"));
  const okText = () => ev("document.querySelector('[data-submitted]')?.innerText.replace(/\\s+/g,' ').trim() ?? ''");
  check("Submit records the consent and saves the version", consents("submit") === 1 && versionsOf() === 1);
  check("Preview shows 'Submitted · saved to My Profiles · v1' with a View in My Profiles link", (await okText()).startsWith("Submitted · saved to My Profiles · v1") && (await ev("document.querySelector('[data-submitted] a')?.getAttribute('href')"))?.startsWith("/profiles/"));
  const after = await bodyText();
  check("there is no redirect and no form step: still on Preview, Download DOCX still there", (await ev("!!document.querySelector('[data-preview-step]')")) && after.includes("Download DOCX") && !after.includes("Submit your profile") && !after.includes("Open submission form"));

  // Submitting again without editing reuses the saved version
  await click("Submit", "[data-preview-step] button");
  await sleep(800);
  check("submitting an unchanged profile does not create another version", versionsOf() === 1 && (await okText()).includes("v1"));

  // After an edit, Submit saves v2
  await click("← Back to edit");
  await waitFor("!!document.querySelector('label input')", "edit (again)");
  await t.fill("Job title", "Staff Engineer");
  await sleep(200);
  await click("Preview →");
  await waitFor("!!document.querySelector('[data-doc-preview=ready]')", "preview (edited)");
  check("after an edit the note says Submit will save a new version", (await bodyText()).includes("Submit saves this profile to My Profiles"));
  await ev("document.querySelector('[data-preview-step] input[type=checkbox]').click()");
  await click("Submit", "[data-preview-step] button");
  await waitFor("!!document.querySelector('[data-submitted]')", "success message (v2)");
  check("an edited profile is saved as v2 on Submit", versionsOf() === 2 && (await okText()).startsWith("Submitted · saved to My Profiles · v2"));

  // The consent API refuses anything but an explicit accept
  const bad = await ev(`fetch('/api/consent',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({template:'internal',action:'download',accepted:false})}).then(r=>r.status)`);
  check("POST /api/consent without accepted:true is a 400", bad === 400);
});

await t.scenario("External profiles are never saved: no save UI, Preview offers Back / Download only, the API refuses them", async () => {
  await signIn("member");
  // the session banner for an external profile asks for a download and has no Save button
  t.ageSession("member", "1 hour 56 minutes");
  await goto("/external");
  await ev("sessionStorage.clear()");
  await goto("/external");
  await click("Get started");
  await waitFor("!!document.querySelector('label input')", "external edit form");
  await waitFor("document.body.innerText.includes('Your session ends in')", "expiry banner (external)");
  const banner = await bodyText();
  check("the expiry banner asks for a download and never says anything is saved", banner.includes("download your DOCX now. External profiles are not saved.") && !banner.includes("Save now") && !/changes are saved/.test(banner));
  await signIn("member"); // resets the sign-in time

  const body = await bodyText();
  check("Edit details has no save controls (no version label, no Save to My Profiles)", !body.includes("Save to My Profiles") && !body.includes("Version label") && !(await ev("!!document.getElementById('save-label')")));
  const labels = await ev("[...document.querySelectorAll('ol li button')].map(b=>b.textContent.replace(/^[^A-Za-z]+/,'').trim()).join('|')");
  check("the external steps are Start, Upload resume, Edit details, Preview (no Submit)", labels === "Start|Upload resume|Edit details|Preview", labels);

  await t.fill("Name", "E2E External Person");
  await t.fill("Job title", "Engineer");
  await t.fill("Overview", "Only the overview.");
  await t.fill("Year", "2014");
  await t.fill("Qualification", "B.E.");
  await ev(`(()=>{const h=[...document.querySelectorAll('h3')].find(h=>h.textContent.startsWith('Skills')); const i=h?.closest('section')?.querySelector('input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'Java,'); i.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await sleep(300);
  const since = sql("select now()");
  await click("Preview →");
  await waitFor("!!document.querySelector('[data-doc-preview=ready]')", "external preview");
  const pbody = await bodyText();
  check("external Preview offers Back to edit and Download DOCX, and no Submit", pbody.includes("← Back to edit") && pbody.includes("Download DOCX") && !(await ev("[...document.querySelectorAll('[data-preview-step] button')].some(b=>b.textContent.trim()==='Submit')")));
  check("no 'saved' wording on external Preview", !pbody.includes("My Profiles"));
  await ev("document.querySelector('[data-preview-step] input[type=checkbox]').click()");
  await click("Download DOCX");
  await waitFor("document.body.innerText.includes('DOCX downloaded')", "external downloaded");
  check("the external consent is recorded (metadata only) and a DOCX was handed to the browser", Number(sql(`select count(*) from audit_log where action='consent_download' and at >= '${since}' and detail->>'template'='external'`)) === 1 && (await ev("window.__blobs.length")) === 1);
  check("nothing was written to the database for the external profile", Number(sql("select count(*) from profiles where candidate_name='E2E External Person'")) === 0);

  // the API refuses external saves, signed in, with a clear 400; an internal save still works
  const post = (template) => ev(`fetch('/api/profiles',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({template:${JSON.stringify(template)},kind:'base',label:'x',source:'scratch',data:{name:'E2E Api External',jobTitle:'a',experienceSummary:'',specialization:'',overview:'o',education:[{year:'1',qualification:'q'}],projects:[],${template === "external" ? "experience:[]," : "managerialExperience:[],domains:[],languages:[],"}skills:${template === "external" ? "['a']" : "[{name:'a',rating:'1'}]"},certifications:[],tools:[]},reviewFlags:[],promptPlan:[]})}).then(async r=>({status:r.status,code:(await r.json()).error?.code ?? null}))`);
  const refused = await post("external");
  check("POST /api/profiles with template external is a 400 EXTERNAL_NOT_SAVED", refused.status === 400 && refused.code === "EXTERNAL_NOT_SAVED", JSON.stringify(refused));
  check("and still nothing is stored", Number(sql("select count(*) from profiles where candidate_name='E2E Api External'")) === 0);

  // an old external row is not listed in My Profiles or in the manager search; /external ignores ?version=
  const owner = sql("select id from auth.users where email='member@example.test'");
  sql(`insert into profiles (owner_id, template, candidate_name) values ('${owner}', 'external', 'E2E Legacy External')`);
  const acc = await post("internal");
  await goto("/profiles");
  await waitFor("document.body.innerText.includes('E2E Api External')", "My Profiles lists the internal profile");
  const cards = JSON.parse(await ev("JSON.stringify([...document.querySelectorAll('main ul li a')].map(a=>a.innerText.replace(/\\s+/g,' ').trim()))"));
  check("My Profiles lists internal profiles only", cards.every((c) => c.startsWith("Internal")) && !cards.some((c) => c.includes("E2E Legacy External")), JSON.stringify(cards));
  await signIn("manager");
  await goto("/manage?q=E2E");
  await waitFor("document.body.innerText.includes('E2E')", "manage results");
  const found = await bodyText();
  check("Manage lists internal profiles only", found.includes("E2E Api External") && !found.includes("E2E Legacy External"));
  void acc;
  await goto("/profiles");
  await ev("sessionStorage.clear()");
});

await t.finish();
