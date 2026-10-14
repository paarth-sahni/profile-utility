/**
 * Purpose: optional browser test for the saved-profile screens and exports (npm run test:e2e): Download PDF and Open
 * in Google Docs on Preview, /profiles/[id] and /manage/[id], the Preview showing the PDF itself, and (added with
 * later features) previews, version labels and the unsaved-changes dialog. Google is STUBBED in the page (a fake token client) and Drive requests are intercepted, so
 * nothing real is called and the test can prove what is sent where. Local stack and seeded users only.
 * The Google checks need NEXT_PUBLIC_GOOGLE_CLIENT_ID set (any value) in .env.local when `npm run dev` starts;
 * without it they are skipped.
 */
import { startHarness } from "./e2e-lib.mjs";

const t = await startHarness("e2e-ui");
const { check, goto, click, bodyText, waitFor, ev, sleep, sql, signIn, send, on, APP, submitViaPreview } = t;

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
  // every PDF blob given to URL.createObjectURL (file-saver does that for a download) is kept for inspection, and the
  // file name of every download link file-saver clicks
  source: `window.__blobs = []; window.__downloads = []; { const make = URL.createObjectURL.bind(URL);
      URL.createObjectURL = (o) => { if (o instanceof Blob && o.type === 'application/pdf') window.__blobs.push(o); return make(o); };
      const click = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () { if (this.download) { window.__downloads.push(this.download); return; } return click.call(this); };
      const dispatch = HTMLAnchorElement.prototype.dispatchEvent;
      HTMLAnchorElement.prototype.dispatchEvent = function (e) { if (this.download && e.type === 'click') { window.__downloads.push(this.download); return true; } return dispatch.call(this, e); }; }
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

await t.scenario("Open in Google Docs (only on the /manage profile pages, managers and admins)", async () => {
  await signIn("admin"); // Google Docs is for managers and admins; the admin saves the profiles used here
  await goto("/internal");
  const saved = await saveProfile(COMPLETE);
  const incomplete = await saveProfile({ ...COMPLETE, name: "E2E Incomplete Person", overview: "" }, "Draft");
  await goto(`/profiles/${saved.profileId}`);
  await waitFor("document.body.innerText.includes('E2E Docs Person')", "profile page");
  check("My Profiles (/profiles/[id]) has no Open in Google Docs, even for an admin", !(await googleButton()) && !(await bodyText()).includes("Open in Google Docs") && (await bodyText()).includes("Download PDF"));
  await goto(`/manage/${saved.profileId}`);
  await waitFor("document.body.innerText.includes('E2E Docs Person')", "manage page");
  if (!(await googleButton())) {
    console.log("SKIP  Open in Google Docs: NEXT_PUBLIC_GOOGLE_CLIENT_ID is not set for the running dev server");
    return;
  }

  check("the button shows on /manage/[id] for an admin", true);
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
    await goto(`/manage/${saved.profileId}`);
    await setMode(mode);
    await clickGoogle();
    await waitFor("!!document.querySelector('[data-google-docs] [role=alert]')", `error for ${mode}`);
    const text = await statusText();
    check(`"${mode}" shows a friendly message`, text.includes(expected) && !/token|undefined|Error/i.test(text), text);
  }
  await goto(`/manage/${saved.profileId}`);
  driveReply = { status: 403, body: { error: { errors: [{ reason: "accessNotConfigured" }] } } };
  await clickGoogle();
  await waitFor("!!document.querySelector('[data-google-docs] [role=alert]')", "api disabled");
  check("Drive API off shows an admin-facing hint", (await statusText()).includes("not enabled for this app yet"));
  driveReply = { status: 200, body: { id: "e2e-doc", webViewLink: "https://docs.google.com/document/d/e2e-doc/edit" } };

  // An incomplete version is stopped before Google is contacted
  await goto(`/manage/${incomplete.profileId}`);
  const before = await gisCalls();
  await clickGoogle();
  await waitFor("!!document.querySelector('[data-google-docs] [role=alert]')", "incomplete message");
  check("an incomplete profile is refused before any Google popup", (await statusText()).includes("Incomplete:") && (await gisCalls()) === before);

  // Edit details: an incomplete form cannot reach Preview, so Google is never contacted
  await goto("/internal");
  await click("Get started");
  await waitFor("!!document.querySelector('label input')", "edit form");
  const calls = await gisCalls();
  await click("Preview & Submit →");
  await sleep(500);
  check("an incomplete form stays on Edit details with the errors shown", (await bodyText()).includes("before continuing") && !(await ev("!!document.querySelector('[data-preview-step]')")));
  check("and no Google popup was opened", (await gisCalls()) === calls);

  // Manager: read-only page with both export buttons
  await signIn("manager");
  await goto(`/manage/${saved.profileId}`);
  await waitFor("document.body.innerText.includes('E2E Docs Person')", "manage page");
  const manage = await bodyText();
  check("/manage/[id] has Download PDF and Open in Google Docs, and no DOCX download", manage.includes("Download PDF") && !manage.includes("DOCX") && (await googleButton()));
  const blobsBefore = await ev("window.__blobs.length");
  const managerConsents = () => Number(sql(`select count(*) from audit_log where action='consent_download' and actor_id=(select id from auth.users where email='manager@example.test')`));
  const consentsBefore = managerConsents();
  await t.downloadWithConsent({ tryUnticked: true });
  check("Download PDF on /manage/[id] asks for the consent tick first; unticked, nothing is downloaded", t.lastConsentCheck.blocked);
  await waitFor(`window.__blobs.length > ${blobsBefore}`, "manager PDF download");
  check("the manager's consent was recorded before the download", managerConsents() === consentsBefore + 1);
  const managerPdf = await t.lastPdf();
  check("Download PDF on /manage/[id] saves a PDF named <Name>-<Job title>-InfoBeans.pdf", managerPdf.isPdf && managerPdf.name === "E2E_Docs_Person-Senior_Engineer-InfoBeans.pdf" && managerPdf.text.includes("E2E Docs Person"), JSON.stringify({ name: managerPdf.name, isPdf: managerPdf.isPdf }));
  check("/manage/[id] stays read-only (no editing or saving controls)", !manage.includes("Save") && !manage.includes("Open in editor"));
  await clickGoogle();
  await waitFor("document.querySelector('[data-google-docs]')?.innerText.includes('Created in your Google Drive')", "manager created");
  check("a manager can export the version they are viewing", true);

  // Preview & Submit never offers Google Docs, not even to a manager or an admin
  for (const who of ["manager", "admin"]) {
    await signIn(who);
    await goto("/internal");
    await ev("sessionStorage.clear()");
    await goto("/internal");
    await click("Get started");
    await waitFor("!!document.querySelector('label input')", `edit form (${who})`);
    await t.fillRequired(`E2E Google Preview ${who}`);
    await click("Preview & Submit →");
    await waitFor("!!document.querySelector('[data-pdf-preview=ready]')", `preview (${who})`);
    const body = await bodyText();
    check(`a ${who} sees no Open in Google Docs on Preview & Submit; Download PDF and Submit stay`, !(await googleButton()) && !body.includes("Open in Google Docs") && body.includes("Download PDF") && (await ev("[...document.querySelectorAll('[data-preview-step] button')].some(b=>b.textContent.trim()==='Submit')")));
    await goto("/profiles");
    await ev("sessionStorage.clear()");
  }

  // A plain member never sees Google Docs: not on Preview, not on My Profiles
  await signIn("member");
  await goto("/internal");
  const mine = await saveProfile({ ...COMPLETE, name: "E2E Member Docs Person" });
  await goto(`/profiles/${mine.profileId}`);
  await waitFor("document.body.innerText.includes('E2E Member Docs Person')", "member's profile page");
  check("a member sees Download PDF (no DOCX) but no Open in Google Docs on My Profiles", (await bodyText()).includes("Download PDF") && !(await bodyText()).includes("DOCX") && !(await googleButton()) && !(await bodyText()).includes("Open in Google Docs"));
  const memberBlobs = await ev("window.__blobs.length");
  await t.downloadWithConsent();
  await waitFor(`window.__blobs.length > ${memberBlobs}`, "member PDF download");
  const memberPdf = await t.lastPdf();
  check("Download PDF on My Profiles saves the version as a PDF with the agreed file name", memberPdf.isPdf && memberPdf.name === "E2E_Member_Docs_Person-Senior_Engineer-InfoBeans.pdf" && memberPdf.text.includes("E2E Member Docs Person"), memberPdf.name);
  await goto("/internal");
  await ev("sessionStorage.clear()");
  await goto("/internal");
  await click("Get started");
  await waitFor("!!document.querySelector('label input')", "edit form (member)");
  await t.fillRequired("E2E Member Preview");
  await click("Preview & Submit →");
  await waitFor("!!document.querySelector('[data-pdf-preview=ready]')", "preview (member)");
  check("a member sees no Open in Google Docs on Preview", !(await googleButton()) && !(await bodyText()).includes("Open in Google Docs") && (await bodyText()).includes("Download PDF"));
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

await t.scenario("saving only through Submit on Preview; versions are labelled Base, v2, v3... automatically", async () => {
  await signIn("member");
  await goto("/internal");
  await ev("sessionStorage.clear()");
  await goto("/internal");
  await click("Get started");
  await waitFor("!!document.querySelector('label input')", "edit form");
  await t.fillRequired("E2E Label Test");
  const edit = await bodyText();
  check("Edit details has no save controls: no Save button, no Version label, no role-specific box, no saved/unsaved line", !/Save to My Profiles|Save new version|Version label|role-specific|You have unsaved changes|Saved ·/.test(edit) && !(await ev("!!document.getElementById('save-label')")));
  const versions = () => sql("select string_agg(version_no||':'||kind||':'||label, ' | ' order by version_no) from profile_versions where profile_id=(select id from profiles where candidate_name='E2E Label Test')");
  const profiles = () => Number(sql("select count(*) from profiles where candidate_name='E2E Label Test'"));
  check("nothing is saved before Submit", profiles() === 0);

  await submitViaPreview();
  check("the first Submit saves version 1 labelled Base", (await versions()) === "1:base:Base");
  for (const [n, title] of [[2, "Lead Engineer"], [3, "Staff Engineer"]]) {
    await click("← Back to edit");
    await waitFor("!!document.querySelector('label input')", "edit again");
    await t.fill("Job title", title);
    await sleep(200);
    await submitViaPreview();
    check(`the next Submit after an edit saves v${n}`, (await versions()).endsWith(`${n}:base:v${n}`));
  }
  check("all versions belong to one profile and are plain 'base' versions", profiles() === 1 && (await versions()) === "1:base:Base | 2:base:v2 | 3:base:v3");

  // Opening a saved version: Edit details, then Submit saves a NEW version of the same profile
  const profile = sql("select id from profiles where candidate_name='E2E Label Test'");
  const v1 = sql(`select id from profile_versions where profile_id='${profile}' and version_no=1`);
  await goto("/profiles");
  await ev("sessionStorage.clear()");
  await goto(`/internal?version=${v1}`);
  await waitFor("!!document.querySelector('label input')", "saved version open");
  check("an opened version loads into Edit details", (await t.getName()) === "E2E Label Test" && !(await bodyText()).includes("Version label"));
  await t.fill("Job title", "Principal Engineer");
  await sleep(200);
  const text = await submitViaPreview();
  check("Submit from an opened version saves v4 of the same profile", text.includes("v4") && profiles() === 1 && (await versions()).endsWith("4:base:v4"), text);
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

  // submitting (the only way to save) removes the warning
  await t.submitViaPreview();
  await sleep(300);
  check("after Submit, beforeunload no longer fires and links do not ask", !(await beforeUnloadPrevented()));

  // editing again brings it back; Leave anyway goes through
  await click("← Back to edit");
  await waitFor("!!document.querySelector('label input')", "edit again");
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
  await fill("Years of Industry Experience", "4");
  await fill("Overview", "Only the overview.");
  await fill("Year", "2014");
  await fill("Qualification", "B.E.");
  await fill("Skill", "Java");
  await fill("Rating out of 5 (e.g. 4)", "4");
  await sleep(300);
  await click("Preview & Submit →");
  await waitFor("!!document.querySelector('[data-pdf-preview=ready]')", "preview of a profile with only the required fields");
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
  await click("Preview & Submit →");
  await waitFor("document.body.innerText.toLowerCase().includes('overview')", "overview error");
  check("a missing required field is reported and Preview is not entered", !(await ev("!!document.querySelector('[data-preview-step]')")));
});

await t.scenario("Preview step: the PDF itself, consent before Download / Submit, Back keeps edits", async () => {
  await signIn("member");
  await goto("/internal");
  await ev("sessionStorage.clear()");
  await goto("/internal");
  await click("Get started");
  await waitFor("!!document.querySelector('label input')", "edit form");
  const since = sql("select now()");
  const consents = (action) => Number(sql(`select count(*) from audit_log where action='consent_${action}' and at >= '${since}' and actor_id=(select id from auth.users where email='member@example.test')`));
  const labels = () => ev("[...document.querySelectorAll('ol li button')].map(b=>b.textContent.replace(/^[^A-Za-z]+/,'').trim()).join('|')");

  check("the internal steps are Start, Upload profile, Edit details, Preview & Submit (no separate Submit step)", (await labels()) === "Start|Upload profile|Edit details|Preview & Submit", await labels());
  check("there is no 'Submit Profile' link in the top menu", !(await ev("[...document.querySelectorAll('header a')].some(a=>/submit profile/i.test(a.textContent))")));
  const bodyBefore = await bodyText();
  check("Edit details no longer offers DOCX or Google Docs buttons", !bodyBefore.includes("DOCX ↓") && !bodyBefore.includes("Open in Google Docs"));

  // validation runs before Preview: an empty form stays on Edit
  await click("Preview & Submit →");
  await sleep(500);
  check("an incomplete profile does not enter Preview; the errors are shown on Edit details", (await bodyText()).includes("before continuing") && !(await ev("!!document.querySelector('[data-preview-step]')")));

  await t.fillRequired("E2E Preview Person");
  await click("Preview & Submit →");
  await waitFor("!!document.querySelector('[data-pdf-preview=ready]')", "preview rendered");
  const preview = JSON.parse(await ev(`(()=>{const el=document.querySelector('[data-pdf-preview=ready]'); const c=[...el.querySelectorAll('canvas[data-pdf-page]')];
    const inked=c.length>0 && c.every(cv=>{const d=cv.getContext('2d').getImageData(0,0,cv.width,cv.height).data; for(let i=0;i<d.length;i+=4*97) if(d[i]<200||d[i+1]<200||d[i+2]<200) return true; return false});
    return JSON.stringify({pages:Number(el.dataset.pdfPages), canvases:c.length, inked, wide:c[0]?.getBoundingClientRect().width??0, sha:el.dataset.pdfSha256??null, text:el.querySelector('[data-pdf-text]')?.textContent??''})})()`));
  check("Preview draws every page of the PDF (pdf.js canvases, with content) at a readable width", preview.pages >= 1 && preview.canvases === preview.pages && preview.inked && preview.wide > 300, JSON.stringify({ ...preview, text: undefined }));
  check("the previewed PDF holds the candidate's name, job title and overview", ["E2E Preview Person", "Engineer", "Only the overview."].every((x) => preview.text.includes(x)), preview.text.slice(0, 80));
  check("no docx-preview rendering is left on the page", !(await ev("!!document.querySelector('.docx-wrapper, section.docx')")));
  const body = await bodyText();
  check("Preview offers Back to edit, Download PDF and Submit, and no DOCX download", ["← Back to edit", "Download PDF", "Submit"].every((x) => body.includes(x)) && !body.includes("DOCX"));
  check("the consent checkbox has the agreed wording and starts unticked", body.includes("I confirm the information in this profile is accurate and may be shared") && (await ev("document.querySelector('[data-preview-step] input[type=checkbox]').checked")) === false);

  // consent is required, and recorded, before each action
  await click("Download PDF");
  await sleep(400);
  check("Download without the consent box shows a message and focuses the box", (await bodyText()).includes("Please tick the box to confirm") && (await ev("document.activeElement?.type")) === "checkbox");
  check("nothing was downloaded and nothing was recorded", (await ev("window.__blobs.length")) === 0 && consents("download") === 0);
  await click("Submit", "[data-preview-step] button");
  await sleep(400);
  check("Submit without the consent box saves nothing", !(await ev("!!document.querySelector('[data-submitted]')")) && consents("submit") === 0);

  await ev("document.querySelector('[data-preview-step] input[type=checkbox]').click()");
  await sleep(200);
  check("ticking the box clears the message", !(await bodyText()).includes("Please tick the box to confirm"));
  await click("Download PDF");
  await waitFor("document.body.innerText.includes('PDF downloaded')", "downloaded");
  check("the consent was recorded in audit_log (metadata only) before the download", consents("download") === 1 && sql(`select detail::text from audit_log where action='consent_download' and at >= '${since}' order by id desc limit 1`).includes('"template": "internal"'));
  check("exactly one PDF was handed to the browser", (await ev("window.__blobs.length")) === 1);
  const dl = await t.lastPdf();
  check("the download is a PDF named <Name>-<Job title>-InfoBeans.pdf", dl.isPdf && dl.name === "E2E_Preview_Person-Engineer-InfoBeans.pdf", JSON.stringify({ name: dl.name, isPdf: dl.isPdf }));
  check("the downloaded PDF is byte-for-byte the previewed one (same SHA-256)", !!preview.sha && dl.sha256 === preview.sha, `${dl.sha256} vs ${preview.sha}`);
  check("the downloaded file contains the same content that was previewed (name, job title, overview)", ["E2E Preview Person", "Engineer", "Only the overview."].every((x) => dl.text.includes(x)), dl.text.slice(0, 120));

  // the PDF API: signed in, strict validation, PDF out, nothing cached
  const api = JSON.parse(await ev(`(async()=>{const post=(b)=>fetch('/api/pdf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});
    const bad=await post({template:'internal',data:{name:'E2E Incomplete'}}); const badJson=await bad.json();
    const unknown=await post({template:'other',data:{}});
    return JSON.stringify({bad:bad.status, badCode:badJson.error?.code, unknown:unknown.status})})()`));
  check("POST /api/pdf refuses an incomplete profile (422) and an unknown template (400)", api.bad === 422 && api.badCode === "INCOMPLETE" && api.unknown === 400, JSON.stringify(api));

  // Back keeps the edits
  await click("← Back to edit");
  await waitFor("!!document.querySelector('label input')", "back on edit");
  check("Back to edit keeps everything that was typed", (await t.getName()) === "E2E Preview Person");

  // Submit: consent first, then the version is saved and the success message appears ON Preview (no other step)
  await click("Preview & Submit →");
  await waitFor("!!document.querySelector('[data-pdf-preview=ready]')", "preview again");
  check("the consent box is ticked fresh each time Preview is entered", (await ev("document.querySelector('[data-preview-step] input[type=checkbox]').checked")) === false);
  await ev("document.querySelector('[data-preview-step] input[type=checkbox]').click()");
  await click("Submit", "[data-preview-step] button");
  await waitFor("!!document.querySelector('[data-submitted]')", "success message");
  const versionsOf = () => Number(sql("select count(*) from profile_versions v join profiles p on p.id=v.profile_id where p.candidate_name='E2E Preview Person'"));
  const okText = () => ev("document.querySelector('[data-submitted]')?.innerText.replace(/\\s+/g,' ').trim() ?? ''");
  check("Submit records the consent and saves the version", consents("submit") === 1 && versionsOf() === 1);
  check("Preview shows 'Submitted · saved to My Profiles · v1' with a View in My Profiles link", (await okText()).startsWith("Submitted · saved to My Profiles · v1") && (await ev("document.querySelector('[data-submitted] a')?.getAttribute('href')"))?.startsWith("/profiles/"));
  const after = await bodyText();
  check("there is no redirect and no form step: still on Preview, Download PDF still there", (await ev("!!document.querySelector('[data-preview-step]')")) && after.includes("Download PDF") && !after.includes("Submit your profile") && !after.includes("Open submission form"));

  // Submitting again without editing reuses the saved version
  await click("Submit", "[data-preview-step] button");
  await sleep(800);
  check("submitting an unchanged profile does not create another version", versionsOf() === 1 && (await okText()).includes("v1"));

  // After an edit, Submit saves v2
  await click("← Back to edit");
  await waitFor("!!document.querySelector('label input')", "edit (again)");
  await t.fill("Job title", "Staff Engineer");
  await sleep(200);
  await click("Preview & Submit →");
  await waitFor("!!document.querySelector('[data-pdf-preview=ready]')", "preview (edited)");
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
  check("the expiry banner asks for a download and never says anything is saved", banner.includes("download your PDF now. External profiles are not saved.") && !banner.includes("Save now") && !/changes are saved/.test(banner));
  await signIn("member"); // resets the sign-in time

  const body = await bodyText();
  check("Edit details has no save controls (no version label, no Save to My Profiles)", !body.includes("Save to My Profiles") && !body.includes("Version label") && !(await ev("!!document.getElementById('save-label')")));
  const labels = await ev("[...document.querySelectorAll('ol li button')].map(b=>b.textContent.replace(/^[^A-Za-z]+/,'').trim()).join('|')");
  check("the external steps are Start, Upload profile, Edit details, Preview (no Submit)", labels === "Start|Upload profile|Edit details|Preview", labels);

  await t.fill("Name", "E2E External Person");
  await t.fill("Job title", "Engineer");
  await t.fill("Experience summary", "4+ Years of Industry Experience");
  await t.fill("Overview", "Only the overview.");
  await t.fill("Year", "2014");
  await t.fill("Qualification", "B.E.");
  await ev(`(()=>{const h=[...document.querySelectorAll('h3')].find(h=>h.textContent.startsWith('Skills')); const i=h?.closest('section')?.querySelector('input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'Java,'); i.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await sleep(300);
  const since = sql("select now()");
  await click("Preview →");
  await waitFor("!!document.querySelector('[data-pdf-preview=ready]')", "external preview");
  const pbody = await bodyText();
  check("external Preview offers Back to edit and Download PDF, and no Submit", pbody.includes("← Back to edit") && pbody.includes("Download PDF") && !pbody.includes("DOCX") && !(await ev("[...document.querySelectorAll('[data-preview-step] button')].some(b=>b.textContent.trim()==='Submit')")));
  check("no 'saved' wording on external Preview", !pbody.includes("My Profiles"));
  await ev("document.querySelector('[data-preview-step] input[type=checkbox]').click()");
  const externalSha = await ev("document.querySelector('[data-pdf-preview=ready]').dataset.pdfSha256");
  await click("Download PDF");
  await waitFor("document.body.innerText.includes('PDF downloaded')", "external downloaded");
  check("the external consent is recorded (metadata only) and a PDF was handed to the browser", Number(sql(`select count(*) from audit_log where action='consent_download' and at >= '${since}' and detail->>'template'='external'`)) === 1 && (await ev("window.__blobs.length")) === 1);
  const externalPdf = await t.lastPdf();
  check("the external PDF is named after the candidate and is the previewed file", externalPdf.isPdf && externalPdf.name === "E2E_External_Person-Engineer-InfoBeans.pdf" && externalPdf.sha256 === externalSha && externalPdf.text.includes("E2E External Person"), externalPdf.name);
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
  await waitFor("document.body.innerText.includes('E2E_Api_External-a-InfoBeans')", "My Profiles lists the internal profile as <Name>-<Role>-InfoBeans");
  const cards = JSON.parse(await ev("JSON.stringify([...document.querySelectorAll('main ul li a')].map(a=>a.innerText.replace(/\\s+/g,' ').trim()))"));
  check("My Profiles lists internal profiles only, with no Internal / External tag on the cards", cards.length > 0 && !cards.some((c) => c.includes("E2E_Legacy_External") || /^(Internal|External)\b/.test(c)), JSON.stringify(cards));
  await signIn("manager");
  await goto("/manage?q=E2E");
  await waitFor("document.body.innerText.includes('E2E')", "manage results");
  const found = await bodyText();
  // one row per team member (their primary or latest profile), so the member appears once
  const memberOwner = sql("select coalesce(nullif(full_name,''), email) from app_users where email='member@example.test'");
  const memberRows = Number(await ev(`[...document.querySelectorAll('main ul li')].filter(li=>li.innerText.includes(${JSON.stringify("owner " + memberOwner)})).length`));
  check("Manage lists internal profiles only, one row per team member, named <Name>-<Role>-InfoBeans", memberRows === 1 && /E2E_[A-Za-z_]+-[A-Za-z_]+-InfoBeans/.test(found) && !found.includes("E2E_Legacy_External"), String(memberRows));
  void acc;
  await goto("/profiles");
  await ev("sessionStorage.clear()");
});

await t.scenario("primary profile: first one automatic, the Submit checkbox, Mark as primary on My Profiles, Manage", async () => {
  await signIn("member");
  const owner = sql("select id from auth.users where email='member@example.test'");
  sql(`update profiles set is_primary = false where owner_id = '${owner}'`); // start with no primary (local test DB only)
  const primaryName = () => sql(`select candidate_name from profiles where owner_id='${owner}' and is_primary`);
  const choice = () => ev("document.querySelector('[data-primary-choice]')?.dataset.primaryChoice ?? null");
  const box = () => ev("(()=>{const i=document.querySelector('[data-primary-choice] input'); return i ? {checked:i.checked, disabled:i.disabled} : null})()");
  const newProfile = async (name) => {
    await goto("/internal");
    await ev("sessionStorage.clear()");
    await goto("/internal");
    await click("Get started");
    await waitFor("!!document.querySelector('label input')", "edit form");
    await t.fillRequired(name);
    await click("Preview & Submit →");
    await waitFor("!!document.querySelector('[data-pdf-preview=ready]')", "preview ready");
  };
  const tickConsentAndSubmit = async () => {
    if (!(await ev("document.querySelector('[data-preview-step] input[type=checkbox]').checked"))) await ev("document.querySelector('[data-preview-step] input[type=checkbox]').click()");
    await click("Submit", "[data-preview-step] button");
    await waitFor("!!document.querySelector('[data-submitted]')", "submitted message");
    return ev("document.querySelector('[data-submitted]').innerText.replace(/\\s+/g,' ').trim()");
  };

  // 1. no primary yet: the box is ticked and locked, and the first submitted profile becomes primary
  await newProfile("E2E Primary One");
  const text = await bodyText();
  check("Preview & Submit shows 'Mark as primary profile' with the one-line explanation", text.includes("Mark as primary profile") && text.includes("Your primary profile is the one managers will see and use."));
  const above = await ev("(()=>{const c=document.querySelector('[data-primary-choice]'); const s=[...document.querySelectorAll('[data-preview-step] button')].find(b=>b.textContent.trim()==='Submit'); return !!c && !!s && (c.compareDocumentPosition(s) & Node.DOCUMENT_POSITION_FOLLOWING) > 0 && c.getBoundingClientRect().bottom <= s.getBoundingClientRect().top})()");
  check("the checkbox sits just above Submit", above);
  check("with no primary yet the box is ticked and locked ('first')", (await choice()) === "first" && JSON.stringify(await box()) === JSON.stringify({ checked: true, disabled: true }));
  const layout = JSON.parse(await ev(`(()=>{const row=document.querySelector('[data-primary-choice]'); const box=row.querySelector('input'); const consent=document.querySelector('[data-preview-step] input[type=checkbox]');
    const consentRow=consent.closest('.rounded-xl'); const label=[...row.querySelectorAll('span')].find(s=>s.textContent.trim()==='Mark as primary profile');
    const probe=document.createElement('span'); probe.style.color='var(--color-brand-500)'; document.body.append(probe); const red=getComputedStyle(probe).color; probe.remove();
    return JSON.stringify({ boxLeft: Math.round(box.getBoundingClientRect().left), consentLeft: Math.round(consent.getBoundingClientRect().left),
      width: Math.round(row.getBoundingClientRect().width), consentWidth: Math.round(consentRow.getBoundingClientRect().width),
      labelRed: !!label && getComputedStyle(label).color === red, reason: row.querySelector('[data-primary-reason]')?.textContent.trim() ?? null,
      title: box.title, ariaDescription: box.getAttribute('aria-description') });})()`));
  check("the primary row is full width with its box at the same left edge as the consent box", layout.boxLeft === layout.consentLeft && layout.width === layout.consentWidth, JSON.stringify(layout));
  check("the label 'Mark as primary profile' is brand red", layout.labelRed, JSON.stringify(layout));
  check("the locked box says why: a line under it plus a tooltip / aria-description", layout.reason === "This will be your primary profile" && layout.title === layout.reason && layout.ariaDescription === layout.reason, JSON.stringify(layout));
  const first = await tickConsentAndSubmit();
  check("the first submitted profile becomes primary", primaryName() === "E2E Primary One" && first.includes("your primary profile"), first);
  check("after Submit the box says it is already primary", (await choice()) === "already" && (await ev("document.querySelector('[data-primary-reason]')?.textContent.trim()")) === "This is already your primary profile");

  // 2. a second profile: the box is free and unticked; ticking it saves and switches in one step
  await newProfile("E2E Primary Two");
  check("for another profile the box is offered unticked, with no locked-reason line", (await choice()) === "choose" && JSON.stringify(await box()) === JSON.stringify({ checked: false, disabled: false }) && !(await ev("!!document.querySelector('[data-primary-reason]')")));
  await ev("document.querySelector('[data-primary-choice] input').click()");
  await tickConsentAndSubmit();
  check("Submit with the box ticked makes this profile primary (exactly one primary)", primaryName() === "E2E Primary Two");

  // 3. My Profiles: badge on the primary; Mark as primary on another, confirmed in the branded dialog
  await goto("/profiles");
  await waitFor("!!document.querySelector('[data-primary-badge]')", "primary badge");
  const cardOf = (name) => `[...document.querySelectorAll('[data-profile-card]')].find(c=>c.innerText.includes(${JSON.stringify(name)}))`;
  check("My Profiles shows the Primary badge on the primary profile only", await ev(`(()=>{const two=${cardOf("E2E_Primary_Two")}, one=${cardOf("E2E_Primary_One")}; return !!two?.querySelector('[data-primary-badge]') && !two.querySelector('[data-mark-primary]') && !one?.querySelector('[data-primary-badge]') && !!one?.querySelector('[data-mark-primary]')})()`));
  await ev(`${cardOf("E2E_Primary_One")}.querySelector('[data-mark-primary] button').click()`);
  await waitFor("!!document.querySelector('dialog[open]')", "confirm dialog");
  const dialog = await ev("document.querySelector('dialog[open]').innerText");
  check("the confirmation asks with the agreed wording", dialog.includes("Your primary profile is the one managers will see and use. Make this your primary profile?"), dialog);
  await click("Cancel", "dialog[open] button");
  await sleep(300);
  check("Cancel changes nothing", primaryName() === "E2E Primary Two");
  await ev(`${cardOf("E2E_Primary_One")}.querySelector('[data-mark-primary] button').click()`);
  await waitFor("!!document.querySelector('dialog[open]')", "confirm dialog");
  await click("Make primary", "dialog[open] button");
  await waitFor(`!!(${cardOf("E2E_Primary_One")})?.querySelector('[data-primary-badge]')`, "badge moved");
  check("Mark as primary switches it", primaryName() === "E2E Primary One");

  // 4. a new version of the non-primary profile does not move the primary
  const twoId = sql(`select id from profiles where owner_id='${owner}' and candidate_name='E2E Primary Two'`);
  const twoVersion = sql(`select current_version_id from profiles where id='${twoId}'`);
  await goto(`/internal?version=${twoVersion}`);
  // wait until React has hydrated the form, or the typed change is lost and Submit reuses the unchanged version
  await waitFor("[...document.querySelectorAll('label textarea')].some(i=>Object.keys(i).some(k=>k.startsWith('__reactProps')))", "hydrated edit form");
  await t.fill("Overview", "A changed overview.");
  await sleep(300);
  await click("Preview & Submit →");
  await waitFor("!!document.querySelector('[data-pdf-preview=ready]')", "preview ready");
  check("for a non-primary profile the box is offered unticked", (await choice()) === "choose");
  await tickConsentAndSubmit();
  const twoVersions = Number(sql(`select count(*) from profile_versions where profile_id='${twoId}'`));
  check("saving a new version of another profile keeps the primary where it was", primaryName() === "E2E Primary One" && twoVersions === 2, JSON.stringify({ primary: primaryName(), twoVersions }));

  // 5. Manage: the team member once, showing the primary profile; its page lists the other profile read-only
  await signIn("manager");
  await goto("/manage?q=E2E Primary");
  await waitFor("document.body.innerText.includes('E2E_Primary')", "manage results");
  const list = await bodyText();
  check("Manage shows the team member once, as their primary profile, with the Primary badge", list.includes("E2E_Primary_One") && !list.includes("E2E_Primary_Two") && (await ev("!!document.querySelector('main ul li [data-primary-badge]')")));
  await click("E2E_Primary_One", "main ul li a");
  await waitFor("!!document.querySelector('[data-other-profiles]')", "other profiles");
  const page = await ev("document.querySelector('[data-other-profiles]').innerText");
  check("the primary profile's page lists the person's other profiles (read-only links)", page.includes("E2E_Primary_Two") && (await ev("[...document.querySelectorAll('[data-other-profiles] a')].every(a=>a.getAttribute('href').startsWith('/manage/'))")));
});

await t.scenario("every top-nav link opens its page (no 404) for a signed-in user", async () => {
  await signIn("manager"); // managers see every link, Manage included
  const notFound = async () => /could not be found|\b404\b/i.test(await bodyText());
  const LINKS = [
    ["Generator", "/internal", "header nav a"],
    ["Instructions", "/internal/instructions", "header nav a"],
    ["Style Guide", "/style-guide", "header nav a"],
    ["My Profiles", "/profiles", "[role=menuitem]"],
    ["Manage", "/manage", "[role=menuitem]"],
  ];
  for (const [label, path, selector] of LINKS) {
    await goto("/profiles"); // start on another page, then click the real link
    await waitFor("!!document.querySelector('header nav a')", "top nav");
    if (selector === "[role=menuitem]") {
      await ev("document.querySelector('button[aria-label^=\"Account menu\"]').click()");
      await waitFor("!!document.querySelector('[role=menuitem]')", "account menu");
    }
    const clicked = await ev(`(()=>{const a=[...document.querySelectorAll(${JSON.stringify(selector)})].find(a=>a.textContent.trim()===${JSON.stringify(label)}); if(!a) return null; const href=a.getAttribute('href'); a.click(); return href})()`);
    if (path !== "/profiles") await waitFor(`location.pathname === ${JSON.stringify(path)}`, `${label} page`);
    await sleep(800);
    check(`top nav "${label}" links to ${path} and opens without a 404`, clicked === path && (await ev("location.pathname")) === path && !(await notFound()), JSON.stringify({ clicked, at: await ev("location.pathname") }));
    if (label === "Generator") {
      // the start-page heading uses the theme's charcoal text colour (--color-ink), not the brand red
      const colours = await ev(`(()=>{const h=document.querySelector('section.bg-cream h1'); const probe=document.createElement('span'); probe.style.color='var(--color-ink)'; document.body.append(probe); const ink=getComputedStyle(probe).color; probe.remove(); return JSON.stringify({ heading: h && getComputedStyle(h).color, ink, inner: h?.querySelector('span') ? getComputedStyle(h.querySelector('span')).color : null, text: h?.textContent.trim() })})()`);
      const c = JSON.parse(colours);
      check("the start-page heading 'Profile Generator' is charcoal (--color-ink)", c.text === "Profile Generator" && c.heading === c.ink && c.inner === null, colours);
    }
  }
});

await t.scenario("a profile that doesn't exist or isn't yours: a clear message and Go to My Profiles, not the generic 404", async () => {
  const MESSAGE = "This profile doesn't exist or you don't have access to it";
  const otherMembers = sql("select p.id from profiles p join auth.users u on u.id=p.owner_id where u.email='member2@example.test' and p.template='internal' limit 1");
  const cases = [
    ["member", "/profiles/00000000-0000-0000-0000-00000000dead", "a missing id"],
    ["member", "/profiles/not-a-uuid", "a malformed id"],
    ["member", `/profiles/${otherMembers}`, "another member's profile"],
    ["manager", "/manage/00000000-0000-0000-0000-00000000dead", "a missing id on Manage"],
  ];
  for (const [who, path, what] of cases) {
    await signIn(who);
    await goto(path);
    await waitFor("!!document.querySelector('[data-profile-not-found]') || document.body.innerText.includes('could not be found')", `${path} rendered`);
    const body = await bodyText();
    check(`${what}: shows "${MESSAGE}" with Go to My Profiles, not the generic 404`, body.includes(MESSAGE) && !body.includes("could not be found") && (await ev("[...document.querySelectorAll('[data-profile-not-found] a')].some(a=>a.textContent.trim()==='Go to My Profiles' && a.getAttribute('href')==='/profiles')")), body.slice(0, 160));
  }
  await click("Go to My Profiles", "[data-profile-not-found] a");
  await waitFor("location.pathname === '/profiles'", "My Profiles");
  check("Go to My Profiles opens My Profiles", (await ev("location.pathname")) === "/profiles");
});

await t.finish();
