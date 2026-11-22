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

/** Managers only see a team member's PRIMARY profile: make this one primary (local test DB only) before opening it on /manage. */
/**
 * The PDF file name for a profile owned by a seeded user: with the Teams data in mock mode (TEAMS_DB_MODE=mock in .env.local,
 * read by the dev server too) the owner's fictional IB code comes first (docs/TEAMS-DB.md: admin IB9007, member IB9003);
 * without it the name starts with the name. <IBCode>_<NameSurname>_<Role>_InfoBeans.pdf, name and role one word each.
 */
const pdfName = (ibCode, nameRole) => (process.env.TEAMS_DB_MODE === "mock" ? `${ibCode}_${nameRole}_InfoBeans.pdf` : `${nameRole}_InfoBeans.pdf`);

function asPrimary(profileId) {
  sql(`update profiles set is_primary = false where owner_id = (select owner_id from profiles where id = '${profileId}') and is_primary`);
  sql(`update profiles set is_primary = true where id = '${profileId}'`);
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
    window.__gis = { calls: 0, scope: null, hint: null, hd: null, mode: 'ok' };
    window.google = { accounts: { oauth2: { initTokenClient(cfg) { return { requestAccessToken() {
      window.__gis.calls++; window.__gis.scope = cfg.scope; window.__gis.hint = cfg.hint ?? null; window.__gis.hd = cfg.hd ?? null;
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
  asPrimary(saved.profileId);
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
  const hinted = await ev("window.__gis.hint");
  check("Google's popup was told which account to use (the signed-in email and its domain)", /^[^@\s]+@[^@\s]+$/.test(hinted ?? "") && (await ev("window.__gis.hd")) === hinted.split("@")[1].toLowerCase(), hinted);
  const docLink = new URL(await ev("document.querySelector('[data-google-docs] a')?.href"));
  check("the link to the new document opens it through Google's account chooser for that account", docLink.origin + docLink.pathname === "https://accounts.google.com/AccountChooser" && docLink.searchParams.get("Email") === hinted && docLink.searchParams.get("continue") === "https://docs.google.com/document/d/e2e-doc/edit", docLink.href);
  check("the message names the account and says what to do on 'You need access'", (await statusText()).includes("Only") && (await statusText()).includes("open the link as"));
  check("the token never went to our server (URLs, headers, bodies)", toApp.every((r) => !r.url.includes(FAKE_TOKEN) && !r.headers.includes(FAKE_TOKEN) && !r.body.includes(FAKE_TOKEN)));
  const stored = await ev(`JSON.stringify([document.cookie, Object.entries(localStorage), Object.entries(sessionStorage)])`);
  check("the token is not stored (cookies, localStorage, sessionStorage)", !stored.includes(FAKE_TOKEN));

  // Friendly errors
  for (const [mode, expected] of [["blocked", "blocked the Google sign-in window"], ["closed", "closed before you finished"], ["denied", "access was not granted"]]) {
    asPrimary(saved.profileId);
    await goto(`/manage/${saved.profileId}`);
    await setMode(mode);
    await clickGoogle();
    await waitFor("!!document.querySelector('[data-google-docs] [role=alert]')", `error for ${mode}`);
    const text = await statusText();
    check(`"${mode}" shows a friendly message`, text.includes(expected) && !/token|undefined|Error/i.test(text), text);
  }
  asPrimary(saved.profileId);
  await goto(`/manage/${saved.profileId}`);
  driveReply = { status: 403, body: { error: { errors: [{ reason: "accessNotConfigured" }] } } };
  await clickGoogle();
  await waitFor("!!document.querySelector('[data-google-docs] [role=alert]')", "api disabled");
  check("Drive API off shows an admin-facing hint", (await statusText()).includes("not enabled for this app yet"));
  driveReply = { status: 200, body: { id: "e2e-doc", webViewLink: "https://docs.google.com/document/d/e2e-doc/edit" } };

  // An incomplete version is stopped before Google is contacted
  asPrimary(incomplete.profileId);
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
  asPrimary(saved.profileId);
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
  check("Download PDF on /manage/[id] saves a PDF named after the OWNER (IBCode_NameSurname_Role_InfoBeans.pdf, or without the code)", managerPdf.isPdf && managerPdf.name === pdfName("IB9007", "E2EDocsPerson_SeniorEngineer") && managerPdf.text.includes("E2E Docs Person"), JSON.stringify({ name: managerPdf.name, isPdf: managerPdf.isPdf }));
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
    await waitFor("!!document.querySelector('[data-preview-editor]')", `preview (${who})`);
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
  check("Download PDF on My Profiles saves the version as a PDF with the agreed file name", memberPdf.isPdf && memberPdf.name === pdfName("IB9003", "E2EMemberDocsPerson_SeniorEngineer") && memberPdf.text.includes("E2E Member Docs Person"), memberPdf.name);
  await goto("/internal");
  await ev("sessionStorage.clear()");
  await goto("/internal");
  await click("Get started");
  await waitFor("!!document.querySelector('label input')", "edit form (member)");
  await t.fillRequired("E2E Member Preview");
  await click("Preview & Submit →");
  await waitFor("!!document.querySelector('[data-preview-editor]')", "preview (member)");
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
        projectCards:(sec('Projects')?.querySelectorAll('div.border-hairline')??[]).length,
        projectBullets:(sec('Projects')?.querySelectorAll('ul.list-disc li')??[]).length,
        hasTeam:a.textContent.includes('Team:'), hasDash:a.textContent.includes('—'),
      })})()`);
  for (const [who, path] of [["member", `/profiles/${saved.profileId}`], ["manager", `/manage/${saved.profileId}`]]) {
    await signIn(who);
    if (who === "manager") asPrimary(saved.profileId);
    await goto(path);
    await waitFor("document.body.innerText.includes('E2E Sparse Person')", `${who} preview`);
    // this profile is incomplete (a lenient save), so the InfoBeans document cannot be made: a note, then the card view
    await waitFor("!!document.querySelector('[data-saved-document=fallback] article')", `${who} card view`);
    check(`${path.split("/")[1]}: an incomplete version shows the 'missing required details' note above the card view`, (await bodyText()).includes("missing required details"));
    const r = JSON.parse(await inspect());
    r.skills = r.skills.map((x) => x.replace(/\s+/g, " ").trim());
    check(`${path.split("/")[1]}: only sections with content are shown`, JSON.stringify(r.headings) === JSON.stringify(["Skills", "Tools", "Projects"]), JSON.stringify(r.headings));
    check(`${path.split("/")[1]}: ratings read x/5, a blank rating shows nothing, blank skills are dropped`, JSON.stringify(r.skills) === JSON.stringify(["Java 4/5", "SQL"]), JSON.stringify(r.skills));
    check(`${path.split("/")[1]}: blank chips and lone empty bullets are gone`, JSON.stringify(r.tools) === JSON.stringify(["Git"]) && r.emptyItems === 0 && r.projectBullets === 0, JSON.stringify(r));
    check(`${path.split("/")[1]}: an empty project is skipped and an N/A team size is hidden`, r.projectCards === 1 && !r.hasTeam && !r.hasDash, JSON.stringify(r));
  }
});

await t.scenario("saved profiles show the InfoBeans document (the PDF from Preview) on My Profiles and Manage", async () => {
  await signIn("member");
  await goto("/internal");
  const saved = await saveProfile({ ...COMPLETE, name: "E2E Document Person" });
  for (const [who, path] of [["member", `/profiles/${saved.profileId}`], ["manager", `/manage/${saved.profileId}`]]) {
    await signIn(who);
    if (who === "manager") asPrimary(saved.profileId);
    await goto(path);
    await waitFor("!!document.querySelector('[data-saved-document=ready] [data-pdf-preview=ready]')", `${who}: the document`);
    const doc = JSON.parse(await ev(`(()=>{const el=document.querySelector('[data-pdf-preview=ready]'); const c=[...el.querySelectorAll('canvas[data-pdf-page]')];
      return JSON.stringify({canvases:c.length, text:el.querySelector('[data-pdf-text]')?.textContent??'', article:!!document.querySelector('article'), fallback:!!document.querySelector('[data-saved-document=fallback]')})})()`));
    check(`${path.split("/")[1]}: shows the InfoBeans document (PDF pages drawn, the person's name in it), not the card layout`, doc.canvases > 0 && doc.text.includes("E2E Document Person") && !doc.article && !doc.fallback, JSON.stringify({ ...doc, text: doc.text.slice(0, 80) }));
  }
});

await t.scenario("saving only through Submit on Preview; versions are labelled Base, v2, v3... automatically", async () => {
  await signIn("member");
  await goto("/internal");
  await ev("sessionStorage.clear()");
  await goto("/internal");
  await click("Get started");
  await waitFor("!!document.querySelector('label input')", "edit form");
  await t.fillRequired("E2E Label Person");
  const edit = await bodyText();
  check("Edit details has no save controls: no Save button, no Version label, no role-specific box, no saved/unsaved line", !/Save to My Profiles|Save new version|Version label|role-specific|You have unsaved changes|Saved ·/.test(edit) && !(await ev("!!document.getElementById('save-label')")));
  const versions = () => sql("select string_agg(version_no||':'||kind||':'||label, ' | ' order by version_no) from profile_versions where profile_id=(select id from profiles where candidate_name='E2E Label Person')");
  const profiles = () => Number(sql("select count(*) from profiles where candidate_name='E2E Label Person'"));
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
  const profile = sql("select id from profiles where candidate_name='E2E Label Person'");
  const v1 = sql(`select id from profile_versions where profile_id='${profile}' and version_no=1`);
  await goto("/profiles");
  await ev("sessionStorage.clear()");
  await goto(`/internal?version=${v1}`);
  await waitFor("!!document.querySelector('label input')", "saved version open");
  // wait until React has hydrated the form, or the typed change is lost and Submit reuses the unchanged version (v1)
  await waitFor("[...document.querySelectorAll('label input')].some(i=>Object.keys(i).some(k=>k.startsWith('__reactProps')))", "hydrated edit form");
  check("an opened version loads into Edit details", (await t.getName()) === "E2E Label Person" && !(await bodyText()).includes("Version label"));
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
  await t.fillRequired("E2E Leave Person");
  const nativeBefore = t.dialogs.length;
  const dialogOpen = () => ev("!!document.querySelector('dialog[open]')");
  /** My Profiles is a link in the header row. */
  const clickMyProfiles = async () => {
    await click("My Profiles", "header nav a");
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
  check("Esc = Stay: the dialog closes and the form is untouched", !(await dialogOpen()) && (await ev("location.pathname")) === "/internal" && (await t.getName()) === "E2E Leave Person");

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
  await t.setName("E2E Leave Person 2");
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
    if (who === "manager" && path.startsWith("/manage/")) asPrimary(saved.profileId);
    await goto(path);
    await waitFor("!!document.querySelector('main h1, section.bg-cream h1')", `${path} rendered`);
    const r = JSON.parse(await audit());
    const name = path.replace(saved.profileId, "[id]");
    check(`${name}: headings are Lexend Medium, never bold`, r.heads > 0 && r.heavy.length === 0, JSON.stringify(r.heavy));
    check(`${name}: no italics, no gradients, Lexend font`, r.italic === 0 && r.gradients === 0 && r.font, JSON.stringify(r));
    check(`${name}: uses the same cream hero band as the generator`, r.hero);
  }
});

await t.scenario("Edit details: fields needing attention are marked from the start; rating limits; blue focus; sharp corners", async () => {
  await signIn("member");
  await goto("/internal");
  await ev("sessionStorage.clear()");
  await goto("/internal");
  await click("Get started");
  await waitFor("!!document.querySelector('label input')", "blank form");
  // 1. marked at once: yellow sections and red required fields, with no failed Preview click needed
  const marks = JSON.parse(await ev(`JSON.stringify({ sections: document.querySelectorAll('[data-needs-attention=true]').length, fields: document.querySelectorAll('label[data-invalid=true]').length, listShown: document.body.innerText.includes('before continuing') })`));
  check("a fresh form already shows yellow 'needs attention' sections and red required fields", marks.sections >= 1 && marks.fields >= 1 && !marks.listShown, JSON.stringify(marks));
  const yellow = await ev(`getComputedStyle(document.querySelector('[data-needs-attention=true]')).backgroundColor`);
  const redBorder = await ev(`getComputedStyle(document.querySelector('label[data-invalid=true] input, label[data-invalid=true] textarea')).borderTopColor`);
  check("the section is highlighted yellow and the field has the brand-red border", yellow === "rgb(255, 243, 212)" && redBorder === "rgb(234, 27, 61)", JSON.stringify({ yellow, redBorder }));
  // 2. the marks go away as the fields are filled
  await t.fillRequired("E2E Marks Person");
  await sleep(300);
  const left = await ev("document.querySelectorAll('[data-needs-attention=true], [data-invalid=true]').length"); // fields and skills-table cells
  check("filling the required fields clears every mark", left === 0, String(left));
  // 3. rating: above 0, at most 5, one decimal
  const ratingBox = `document.querySelector('input[aria-label="Skill 1 rating"]')`;
  const typeRating = async (v) => { await ev(`(()=>{const el=${ratingBox}; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(v)}); el.dispatchEvent(new Event('input',{bubbles:true}))})()`); await sleep(80); return ev(`${ratingBox}.value`); };
  await typeRating("");
  check("a rating above 5 cannot be typed (6 is ignored)", (await typeRating("6")) === "");
  check("4.8 can be typed", (await typeRating("4.8")) === "4.8");
  check("a second decimal is ignored (4.85 stays 4.8)", (await typeRating("4.85")) === "4.8");
  check("5.5 is ignored (stays 4.8)", (await typeRating("5.5")) === "4.8");
  await typeRating("0");
  await sleep(200);
  check("a rating of 0 is marked as needing attention with the explanation", (await ev("!!document.querySelector('[data-needs-attention=true]')")) && (await bodyText()).includes("Enter a rating above 0 and up to 5"));
  await typeRating("4.5");
  // 4. one blue focus ring for everything
  const focus = await ev(`(()=>{ const root=getComputedStyle(document.documentElement).getPropertyValue('--color-focus').trim(); const rule=[...document.styleSheets].flatMap(s=>{try{return [...s.cssRules]}catch{return []}}).find(r=>r.selectorText===':focus-visible'); return JSON.stringify({ root, outline: rule?.style.outline ?? null, color: rule?.style.getPropertyValue('outline-color') || rule?.style.outline || null }) })()`);
  check("the focus ring is the blue #2563EB (not the browser's black ring)", focus.includes("#2563eb") && JSON.parse(focus).outline !== null, focus);
  // 5. sharp corners everywhere except the profile avatar
  const round = JSON.parse(await ev(`JSON.stringify([...document.querySelectorAll('body *')].filter(e=>{const r=getComputedStyle(e); return ['borderTopLeftRadius','borderTopRightRadius','borderBottomLeftRadius','borderBottomRightRadius'].some(k=>r[k]!=='0px') && !e.closest('[aria-label^="Account menu"]') && !e.closest('ol')}).map(e=>e.tagName+'.'+String(e.className).slice(0,50)).slice(0,5))`));
  check("no rounded corners on the Edit details page (only the profile menu and the stepper are round)", round.length === 0, JSON.stringify(round));
  await goto("/profiles");
  await waitFor("!!document.querySelector('main')", "My Profiles");
  const round2 = JSON.parse(await ev(`JSON.stringify([...document.querySelectorAll('body *')].filter(e=>{const r=getComputedStyle(e); return ['borderTopLeftRadius','borderTopRightRadius','borderBottomLeftRadius','borderBottomRightRadius'].some(k=>r[k]!=='0px') && !e.closest('[aria-label^="Account menu"]') && !e.closest('ol')}).map(e=>e.tagName+'.'+String(e.className).slice(0,50)).slice(0,5))`));
  check("no rounded corners on My Profiles either", round2.length === 0, JSON.stringify(round2));
  await ev("sessionStorage.clear()");
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
  // a missing field must stop the test here, naming the field, not show up later as a Preview that never opens
  for (const [label, value] of [["Years of Industry Experience", "4"], ["Overview", "Only the overview."], ["Year", "2014"], ["Qualification", "B.E."]]) {
    if (!(await fill(label, value))) throw new Error(`no field labelled "${label}" on the form`);
  }
  for (const [name, value] of [["Skill 1 name", "Java"], ["Skill 1 rating", "4"]]) {
    if (!(await t.fillNamed(name, value))) throw new Error(`no field named "${name}" on the form`);
  }
  await sleep(300);
  await click("Preview & Submit →");
  await waitFor("!!document.querySelector('[data-preview-editor]')", "preview of a profile with only the required fields");
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

// ---- Preview & Submit (internal): editing the text there. Helpers for the editable view's fields (by data path).
const previewField = (path) => `document.querySelector('[data-edit-path="${path}"]')`;
const setPreviewField = (path, value) =>
  ev(`(()=>{const i=${previewField(path)}; if(!i) return false; const proto=i.tagName==='TEXTAREA'?HTMLTextAreaElement:HTMLInputElement; Object.getOwnPropertyDescriptor(proto.prototype,'value').set.call(i,${JSON.stringify(value)}); i.dispatchEvent(new Event('input',{bubbles:true})); return true})()`);
const previewValue = (path) => ev(`${previewField(path)}?.value ?? null`);
const consentBox = "document.querySelector('[data-preview-step] input[type=checkbox]')";
const tickConsent = () => ev(`${consentBox}.checked || ${consentBox}.click()`);
/** View PDF: opens the dialog, waits for the PDF, returns { sha, text, focusInside }, closes the dialog again. */
async function viewPdf() {
  await click("View PDF");
  await waitFor("!!document.querySelector('dialog[open] [data-pdf-preview=ready]')", "PDF in the View PDF dialog", 40000);
  const got = JSON.parse(await ev(`JSON.stringify({sha:document.querySelector('dialog[open] [data-pdf-preview=ready]').dataset.pdfSha256??null, text:document.querySelector('dialog[open] [data-pdf-text]')?.textContent??'', focusInside:!!document.activeElement?.closest('dialog[open]')})`));
  await click("Close", "dialog[open] button");
  await waitFor("!document.querySelector('dialog[open]')", "dialog closed");
  return got;
}

await t.scenario("Preview & Submit (internal): edit the text, View PDF, consent before Download / Submit, Back keeps edits", async () => {
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
  await waitFor("!!document.querySelector('[data-preview-editor]')", "editable preview");

  // the editable view: laid out like the PDF, text editable, headings / labels / header read-only, no PDF yet
  const view = JSON.parse(await ev(`(()=>{const ed=document.querySelector('[data-preview-editor]');
    return JSON.stringify({ headings:[...ed.querySelectorAll('h3')].map(h=>h.textContent.trim()),
      fields:[...ed.querySelectorAll('[data-edit-path]')].map(f=>[f.dataset.editPath,f.tagName,f.getAttribute('aria-label')]),
      text:ed.innerText, pdf:!!document.querySelector('[data-pdf-preview]') })})()`));
  check("the editable view shows the section headings as real headings (Overview, Education & Training, Skills)", ["Overview", "Education & Training", "Skills"].every((h) => view.headings.includes(h)), JSON.stringify(view.headings));
  check("each value is a real input / textarea with a clear name", JSON.stringify(view.fields) === JSON.stringify([["overview", "TEXTAREA", "Overview"], ["education.0.year", "INPUT", "Education, year"], ["education.0.qualification", "TEXTAREA", "Education, qualification"], ["skills.0.name", "TEXTAREA", "Skill 1, name"], ["skills.0.rating", "INPUT", "Skill 1, rating"]]), JSON.stringify(view.fields));
  check("the header (name, job title) is shown but not editable", view.text.includes("E2E Preview Person") && view.text.includes("Engineer") && !view.fields.some(([p]) => ["name", "jobTitle"].includes(p)));
  check("the view says page breaks are in View PDF and draws no PDF until asked", view.text.includes("Page breaks: View PDF") && !view.pdf);
  const body = await bodyText();
  check("the buttons are there: Back to edit, View PDF, Download PDF, Submit (no DOCX)", ["← Back to edit", "View PDF", "Download PDF", "Submit"].every((x) => body.includes(x)) && !body.includes("DOCX"));
  check("the consent checkbox has the agreed wording and starts unticked", body.includes("I confirm the information in this profile is accurate and may be shared") && (await ev(`${consentBox}.checked`)) === false);

  // plain text: control / zero-width characters and line breaks are removed (the overview keeps its line breaks)
  await setPreviewField("skills.0.name", "Ja​va\nScript\u0007");
  await setPreviewField("overview", "Edited on Preview.\nSecond line.");
  await sleep(200);
  check("a one-line field keeps plain text only (no zero-width, control characters or line breaks)", (await previewValue("skills.0.name")) === "Java Script", JSON.stringify(await previewValue("skills.0.name")));
  check("the overview keeps its line break", (await previewValue("overview")) === "Edited on Preview.\nSecond line.");
  await setPreviewField("skills.0.rating", "7");
  check("the rating accepts only what the Edit page accepts (7 is ignored)", (await previewValue("skills.0.rating")) === "4");
  await setPreviewField("skills.0.rating", "4.5");
  check("a valid rating is taken", (await previewValue("skills.0.rating")) === "4.5");

  // Download and Submit are blocked until the PDF of the current text has been opened (the hint is read with them)
  const gate = () => ev(`JSON.stringify([...document.querySelectorAll('[data-preview-step] button')].filter(b=>['Download PDF','Submit'].includes(b.textContent.trim())).map(b=>[b.disabled, document.getElementById(b.getAttribute('aria-describedby'))?.textContent ?? '']))`);
  const before = JSON.parse(await gate());
  check("before View PDF, Download PDF and Submit are disabled, with the hint read with them", before.length === 2 && before.every(([d, hint]) => d && hint.startsWith("View the PDF first")), JSON.stringify(before));
  check("View PDF is the main action at the bottom, just above the consent box", await ev("(()=>{const v=document.querySelector('[data-view-pdf]'); const c=document.querySelector('[data-preview-step] input[type=checkbox]'); return !!v && v.textContent.trim()==='View PDF before you submit' && v.className.includes('bg-brand-500') && !!(v.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_FOLLOWING) && !!(document.querySelector('[data-preview-editor]').compareDocumentPosition(v) & Node.DOCUMENT_POSITION_FOLLOWING) && document.querySelectorAll('[data-view-pdf]').length===1})()"));

  // View PDF: the exact PDF of the edited text, in a dialog that keeps the focus
  const first = await viewPdf();
  check("View PDF shows the PDF of the edited text, focus inside the dialog", first.text.includes("Edited on Preview.") && first.text.includes("Java Script") && first.text.includes("4.5/5") && first.focusInside, first.text.slice(0, 120));
  check("after View PDF, Download PDF and Submit are enabled", JSON.parse(await gate()).every(([d]) => !d));
  await setPreviewField("overview", "Edited again on Preview.");
  await sleep(200);
  const again = JSON.parse(await gate());
  check("an edit blocks them again: 'View the PDF of your latest changes first'", again.every(([d, hint]) => d && hint === "View the PDF of your latest changes first"), JSON.stringify(again));
  await viewPdf();

  // consent is required, and recorded, before each action
  await click("Download PDF");
  await sleep(400);
  check("Download without the consent box shows a message and focuses the box", (await bodyText()).includes("Please tick the box to confirm") && (await ev("document.activeElement?.type")) === "checkbox");
  check("nothing was downloaded and nothing was recorded", (await ev("window.__blobs.length")) === 0 && consents("download") === 0);
  await click("Submit", "[data-preview-step] button");
  await sleep(400);
  check("Submit without the consent box saves nothing", !(await ev("!!document.querySelector('[data-submitted]')")) && consents("submit") === 0);

  // changing the text after ticking clears the tick
  await tickConsent();
  await sleep(100);
  await setPreviewField("overview", "Edited on Preview, final.");
  await sleep(300);
  check("changing the text after ticking clears the tick and says why", (await ev(`${consentBox}.checked`)) === false && (await bodyText()).includes("please tick the box again"));

  // an emptied required field: its PDF is refused (listed, the field focused) and Download / Submit stay blocked
  await setPreviewField("overview", "");
  await click("View PDF", "[data-preview-step] button");
  await waitFor("!!document.querySelector('[data-preview-problems]')", "the refusal listed on Preview", 30000);
  await sleep(300);
  check("an emptied required field: View PDF is refused, the field listed and focused", (await ev("document.querySelector('[data-preview-problems]')?.innerText ?? ''")).includes("Overview — Required") && (await ev("document.activeElement?.dataset.editPath")) === "overview");
  check("the emptied field is marked invalid and its message is read with it", (await ev(`${previewField("overview")}.getAttribute('aria-invalid')`)) === "true" && (await ev(`document.getElementById(${previewField("overview")}.getAttribute('aria-describedby'))?.textContent`)) === "Required");
  check("…Download and Submit stay disabled; no consent row, nothing downloaded or saved", JSON.parse(await gate()).every(([d]) => d) && consents("download") === 0 && consents("submit") === 0 && (await ev("window.__blobs.length")) === 0);
  await setPreviewField("overview", "Edited on Preview, final.");
  await sleep(500);
  check("the problem list goes away once the field is filled", !(await ev("!!document.querySelector('[data-preview-problems]')")));
  await viewPdf();

  // Download: the server builds the PDF of the current text, checks it, then records the consent
  await tickConsent();
  await click("Download PDF");
  await waitFor("document.body.innerText.includes('PDF downloaded')", "downloaded", 40000);
  check("the consent was recorded in audit_log (metadata only) with the download", consents("download") === 1 && sql(`select detail::text from audit_log where action='consent_download' and at >= '${since}' order by id desc limit 1`).includes('"template": "internal"'));
  check("exactly one PDF was handed to the browser", (await ev("window.__blobs.length")) === 1);
  const dl = await t.lastPdf();
  check("the download is a PDF named IBCode_NameSurname_Role_InfoBeans.pdf (or without the code)", dl.isPdf && dl.name === pdfName("IB9003", "E2EPreviewPerson_Engineer"), JSON.stringify({ name: dl.name, isPdf: dl.isPdf }));
  check("the downloaded file has the text as edited on Preview", ["E2E Preview Person", "Edited on Preview, final.", "Java Script", "4.5/5"].every((x) => dl.text.includes(x)), dl.text.slice(0, 160));
  const after = await viewPdf();
  check("View PDF afterwards shows the downloaded file itself (same SHA-256)", !!after.sha && after.sha === dl.sha256, `${after.sha} vs ${dl.sha256}`);

  // the PDF API: signed in, strict validation with field paths, consent only after the checks, PDF out
  const api = JSON.parse(await ev(`(async()=>{const post=(b)=>fetch('/api/pdf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});
    const bad=await post({template:'internal',data:{name:'E2E Incomplete'},consent:{action:'download',accepted:true}}); const badJson=await bad.json();
    const unknown=await post({template:'other',data:{}});
    const badConsent=await post({template:'internal',data:{},consent:{action:'download',accepted:false}});
    return JSON.stringify({bad:bad.status, badCode:badJson.error?.code, fields:(badJson.error?.fields??[]).length, unknown:unknown.status, badConsent:badConsent.status})})()`));
  check("POST /api/pdf refuses an incomplete profile (422 INCOMPLETE with field paths), an unknown template and a consent that is not accepted (400)", api.bad === 422 && api.badCode === "INCOMPLETE" && api.fields > 0 && api.unknown === 400 && api.badConsent === 400, JSON.stringify(api));
  check("a refused PDF request records no consent", consents("download") === 1);

  // Back keeps the edits made on Preview
  await click("← Back to edit");
  await waitFor("!!document.querySelector('label input')", "back on edit");
  check("Back to edit keeps everything typed, on Edit and on Preview", (await t.getName()) === "E2E Preview Person" && (await ev("[...document.querySelectorAll('label')].find(l=>l.textContent.trim().startsWith('Overview'))?.querySelector('textarea')?.value")) === "Edited on Preview, final.");

  // Submit: consent first, then the version is saved (with the Preview edits) and the success message appears ON Preview
  await click("Preview & Submit →");
  await waitFor("!!document.querySelector('[data-preview-editor]')", "preview again");
  check("the consent box is ticked fresh each time Preview is entered", (await ev(`${consentBox}.checked`)) === false);
  check("re-entering Preview needs the PDF opened again", JSON.parse(await gate()).every(([d]) => d));
  await viewPdf();
  await tickConsent();
  await click("Submit", "[data-preview-step] button");
  await waitFor("!!document.querySelector('[data-submitted]')", "success message");
  const versionsOf = () => Number(sql("select count(*) from profile_versions v join profiles p on p.id=v.profile_id where p.candidate_name='E2E Preview Person'"));
  const okText = () => ev("document.querySelector('[data-submitted]')?.innerText.replace(/\\s+/g,' ').trim() ?? ''");
  check("Submit records the consent and saves the version", consents("submit") === 1 && versionsOf() === 1);
  check("the saved version has the text edited on Preview", sql("select v.overview||'|'||s.name||'|'||s.rating from profile_versions v join profiles p on p.id=v.profile_id join version_skills s on s.version_id=v.id where p.candidate_name='E2E Preview Person'") === "Edited on Preview, final.|Java Script|4.5");
  check("Preview shows 'Submitted · saved to My Profiles · v1' with a View in My Profiles link", (await okText()).startsWith("Submitted · saved to My Profiles · v1") && (await ev("document.querySelector('[data-submitted] a')?.getAttribute('href')"))?.startsWith("/profiles/"));
  const afterSubmit = await bodyText();
  check("there is no redirect and no form step: still on Preview, Download PDF still there", (await ev("!!document.querySelector('[data-preview-step]')")) && afterSubmit.includes("Download PDF") && !afterSubmit.includes("Submit your profile") && !afterSubmit.includes("Open submission form"));

  // Submitting again without editing reuses the saved version
  await click("Submit", "[data-preview-step] button");
  await sleep(800);
  check("submitting an unchanged profile does not create another version", versionsOf() === 1 && (await okText()).includes("v1"));

  // An edit on Preview, then Submit, saves v2
  await setPreviewField("education.0.qualification", "B.E. (Computer Science)");
  await sleep(300);
  check("after an edit on Preview the note says Submit will save a new version", (await bodyText()).includes("Submit saves this profile to My Profiles"));
  await viewPdf();
  await tickConsent();
  await click("Submit", "[data-preview-step] button");
  await waitFor("document.querySelector('[data-submitted]')?.innerText.includes('v2')", "success message (v2)");
  check("an edit made on Preview is saved as v2 on Submit", versionsOf() === 2 && (await okText()).startsWith("Submitted · saved to My Profiles · v2"));

  // The consent API refuses anything but an explicit accept
  const bad = await ev(`fetch('/api/consent',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({template:'internal',action:'download',accepted:false})}).then(r=>r.status)`);
  check("POST /api/consent without accepted:true is a 400", bad === 400);
});

await t.scenario("Preview editing: dates, every list item, an emptied item, and refusals by the server (no consent row)", async () => {
  // A fictional registered name, added for this test only and removed at the end (never a name from the real client sheet).
  const FICTIONAL = "Zephyrine Quillmark Holdings";
  const normalized = FICTIONAL.toLowerCase();
  check("the fictional registered name is not active in the local registry before the test", sql(`select count(*) from compliance_names where normalized='${normalized}' and status='active'`) === "0");
  // registry rows are never deleted (deactivated instead): an earlier run's row is reused
  sql(`insert into compliance_names (display_name, normalized, name_types) values ('${FICTIONAL}', '${normalized}', array['client']) on conflict (normalized) do update set status='active', status_changed_at=now()`);
  try {
    await signIn("member");
    await goto("/internal");
    await ev("sessionStorage.clear()");
    const since = sql("select now()");
    const consents = (action) => Number(sql(`select count(*) from audit_log where action='consent_${action}' and at >= '${since}' and actor_id=(select id from auth.users where email='member@example.test')`));
    const enforced = await ev(`fetch('/api/compliance/check',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({template:'internal',data:{overview:'x'}})}).then(r=>r.json()).then(j=>j.enforced)`);
    if (!enforced) {
      check("client-name refusals need COMPLIANCE_ENFORCE=on for `npm run dev` (skipped)", true);
    } else {
      // the server keeps the registry for 60 s: wait until it knows the fictional name, asking every 3 s (the live check
      // allows 240 requests in 10 minutes per user)
      const knows = `fetch('/api/compliance/check',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({template:'internal',data:{jobTitle:'Lead, ${FICTIONAL}'}})}).then(r=>r.json()).then(j=>j.violations?.length>0)`;
      const t0 = Date.now();
      while (!(await ev(knows))) {
        if (Date.now() - t0 > 80000) throw new Error("the server's registry cache did not pick up the fictional name within 80 s");
        await sleep(3000);
      }
    }

    const saved = await saveProfile({
      ...COMPLETE,
      name: "E2E Preview Items",
      projects: [{ ...COMPLETE.projects[0], duration: "Jan 2020 - Mar 2021", toolsAndTechnologies: ["Java", "Kafka"], projectLink: "https://example.com/p", responsibilities: ["Designed the schema", "Wrote the reports"] }],
      certifications: ["Sample Cloud Associate", "Sample Data Practitioner"],
      tools: ["Git", "Jira"],
      managerialExperience: ["Time Management"],
    });
    await goto(`/internal?version=${saved.versionId}`);
    await waitFor("[...document.querySelectorAll('label textarea')].some(i=>Object.keys(i).some(k=>k.startsWith('__reactProps')))", "hydrated edit form");
    await click("Preview & Submit →");
    await waitFor("!!document.querySelector('[data-preview-editor]')", "editable preview");
    const names = JSON.parse(await ev("JSON.stringify([...document.querySelectorAll('[data-edit-path]')].map(f=>f.getAttribute('aria-label')))"));
    check("one field per item, each with a clear name", ["Project 1, dates", "Project 1, name", "Project 1, tool 1", "Project 1, tool 2", "Project 1, team size", "Project 1, role", "Project 1, link", "Project 1, description", "Project 1, bullet 1", "Project 1, bullet 2", "Certification 2", "Tool 2", "Managerial experience 1", "Domain 1", "Language 1"].every((n) => names.includes(n)), JSON.stringify(names));
    check("'Project 1' stays a real heading with the dates as a field next to it", (await ev("[...document.querySelectorAll('[data-preview-editor] h4')].map(h=>h.textContent.trim()).join('|')")) === "Project 1");

    // dates: tidied with lib/dates.ts when the field is left; an unreadable one stays as typed, with a hint
    await setPreviewField("projects.0.duration", "january 2020 to march 2021");
    await ev(`${previewField("projects.0.duration")}.dispatchEvent(new FocusEvent('focusout',{bubbles:true}))`); // leaving the field
    await sleep(200);
    check("the dates are tidied when the field is left (MMM YYYY – MMM YYYY)", (await previewValue("projects.0.duration")) === "Jan 2020 – Mar 2021", await previewValue("projects.0.duration"));
    await setPreviewField("projects.0.duration", "Q3 2020");
    await ev(`${previewField("projects.0.duration")}.dispatchEvent(new FocusEvent('focusout',{bubbles:true}))`); // leaving the field
    await sleep(200);
    check("an unreadable date stays as typed, with a hint", (await previewValue("projects.0.duration")) === "Q3 2020" && (await bodyText()).includes("We could not read this date"));
    await setPreviewField("projects.0.duration", "Jan 2020 – Mar 2021");

    // an optional single field can be cleared; an emptied list item blocks with the agreed message (its PDF can be made:
    // the template leaves empty items out, so the rule is the Preview's own)
    await setPreviewField("projects.0.projectLink", "");
    await setPreviewField("tools.1", " ");
    await viewPdf();
    await tickConsent();
    await click("Download PDF");
    await sleep(600);
    const problems = await ev("document.querySelector('[data-preview-problems]')?.innerText ?? ''");
    check("an emptied item blocks Download: 'This item is empty: fill it in, or remove it on Edit', focus on it", problems.includes("Tool 2 — This item is empty: fill it in, or remove it on Edit") && (await ev("document.activeElement?.dataset.editPath")) === "tools.1", problems);
    check("a cleared optional field (the link) is not a problem", !problems.includes("link"));
    check("the emptied item is still on screen, so it can be filled in again", (await ev(`!!${previewField("tools.1")}`)));
    await click("Submit", "[data-preview-step] button");
    await sleep(500);
    check("…and Submit: no consent row and nothing saved", consents("download") === 0 && consents("submit") === 0);
    await setPreviewField("tools.1", "Jira Cloud");

    if (enforced) {
      const versions = () => Number(sql(`select count(*) from profile_versions where profile_id='${saved.profileId}'`));
      // a registered name typed on Preview: the PDF is refused by the server (before the live check answers), the field is
      // marked and focused on Preview, and Download / Submit stay disabled (the PDF of this text cannot be opened)
      await setPreviewField("projects.0.responsibilities.1", `Wrote the reports for ${FICTIONAL}`);
      await click("View PDF", "[data-preview-step] button");
      await waitFor("!!document.querySelector('[data-preview-problems]')", "refusal shown on Preview", 30000);
      await sleep(300);
      const refused = JSON.parse(await ev("JSON.stringify({editor:!!document.querySelector('[data-preview-editor]'), problems:document.querySelector('[data-preview-problems]')?.innerText??'', focus:document.activeElement?.dataset.editPath??document.activeElement?.tagName, blocked:[...document.querySelectorAll('[data-preview-step] button')].filter(b=>['Download PDF','Submit'].includes(b.textContent.trim())).every(b=>b.disabled)})"));
      check("the PDF is refused by the server: still on Preview, the bullet listed and focused, Download and Submit disabled", refused.editor && refused.problems.includes("Project 1, bullet 2") && refused.focus === "projects.0.responsibilities.1" && refused.blocked, JSON.stringify(refused));
      await waitFor("!!document.querySelector('[data-compliance-marks]')", "the registered name marked in the text");
      check("the registered name is marked in the text; no consent row and no download", consents("download") === 0 && (await ev("window.__blobs.length")) === 0);
      // the server's own Submit checks (the UI cannot reach them with this text): a registered name and an incomplete
      // profile are refused with where to fix them, and leave no consent row and no new version
      const submitApi = (data) => ev(`fetch('/api/profiles',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({template:'internal',kind:'base',label:'',source:'scratch',profileId:${JSON.stringify(saved.profileId)},data:${JSON.stringify(data)},reviewFlags:[],promptPlan:[],submit:true,consent:{accepted:true}})}).then(async r=>JSON.stringify({status:r.status, body:await r.json()}))`);
      const named = JSON.parse(await submitApi({ ...COMPLETE, name: "E2E Preview Items", jobTitle: `Lead, ${FICTIONAL}` }));
      check("POST /api/profiles Submit naming a registered client: 422 COMPLIANCE with the field, no consent row, no new version", named.status === 422 && named.body.error?.code === "COMPLIANCE" && named.body.error.matches?.[0]?.path === "jobTitle" && consents("submit") === 0 && versions() === 1, JSON.stringify(named));
      const overviewOnly = await ev(`fetch('/api/compliance/check',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({template:'internal',data:{overview:'Built it for ${FICTIONAL}.',skills:[{name:'${FICTIONAL}',rating:'4'}]}})}).then(r=>r.json()).then(j=>j.violations?.length)`);
      check("a registered client named only in the Overview or Skills is NOT flagged (the check covers the name, job title and projects)", overviewOnly === 0, String(overviewOnly));
      const direct = JSON.parse(await submitApi({ ...COMPLETE, name: "E2E Preview Items", overview: "" }));
      check("POST /api/profiles Submit of an incomplete profile: 422 INCOMPLETE naming the field, no consent row", direct.status === 422 && direct.body.error?.code === "INCOMPLETE" && direct.body.error.fields.some((f) => f.path === "overview") && consents("submit") === 0, JSON.stringify(direct));
      // fixed: View PDF, then Download and Submit go through
      await setPreviewField("projects.0.responsibilities.1", "Wrote the reports");
      await sleep(1200);
      await viewPdf();
      await tickConsent();
      await click("Download PDF");
      await waitFor("document.body.innerText.includes('PDF downloaded')", "downloaded after the fix", 40000);
      check("after the fix Download works and records one consent", consents("download") === 1 && (await t.lastPdf()).text.includes("Jira Cloud"));
      await tickConsent();
      await click("Submit", "[data-preview-step] button");
      await waitFor("!!document.querySelector('[data-submitted]')", "submitted after the fix", 30000);
      check("…and Submit saves a new version with one consent row", consents("submit") === 1 && versions() === 2);

      // the same fictional name on an EXTERNAL profile is not checked (internal profiles only)
      await goto("/external");
      await ev("sessionStorage.clear()");
      const ext = await ev(`fetch('/api/pdf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({template:'external',data:{name:'E2E External Name',jobTitle:'Engineer',experienceSummary:'6+ Years of Industry Experience',specialization:'',overview:'Delivered for ${FICTIONAL}.',education:[{year:'2014',qualification:'B.E.'}],skills:['Java'],tools:[],certifications:[],projects:[],experience:[]}})}).then(r=>r.status)`);
      check("an external profile naming the same registered name gets its PDF (not checked)", ext === 200, String(ext));
      const live = await ev(`fetch('/api/compliance/check',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({template:'external',data:{overview:'For ${FICTIONAL}.'}})}).then(r=>r.json()).then(j=>JSON.stringify(j))`);
      check("the live check does not check external profiles", live === JSON.stringify({ enforced: false, violations: [] }), live);
    }
  } finally {
    sql(`update compliance_names set status='deactivated', status_changed_at=now() where normalized='${normalized}'`);
  }
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
  // the Preview step itself (the header has a My Profiles link for everyone)
  check("no 'saved' wording on external Preview", !(await ev("document.querySelector('[data-preview-step]').innerText")).includes("My Profiles"));
  await ev("document.querySelector('[data-preview-step] input[type=checkbox]').click()");
  const externalSha = await ev("document.querySelector('[data-pdf-preview=ready]').dataset.pdfSha256");
  await click("Download PDF");
  await waitFor("document.body.innerText.includes('PDF downloaded')", "external downloaded");
  check("the external consent is recorded (metadata only) and a PDF was handed to the browser", Number(sql(`select count(*) from audit_log where action='consent_download' and at >= '${since}' and detail->>'template'='external'`)) === 1 && (await ev("window.__blobs.length")) === 1);
  const externalPdf = await t.lastPdf();
  check("the external PDF is named after the candidate and is the previewed file", externalPdf.isPdf && externalPdf.name === pdfName("IB9003", "E2EExternalPerson_Engineer") && externalPdf.sha256 === externalSha && externalPdf.text.includes("E2E External Person"), externalPdf.name);
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
  await waitFor("document.body.innerText.includes('E2EApiExternal_A_InfoBeans')", "My Profiles lists the internal profile as [IBCode_]<NameSurname>_<Role>_InfoBeans");
  const cards = JSON.parse(await ev("JSON.stringify([...document.querySelectorAll('main ul li a')].map(a=>a.innerText.replace(/\\s+/g,' ').trim()))"));
  check("My Profiles lists internal profiles only, with no Internal / External tag on the cards", cards.length > 0 && !cards.some((c) => c.includes("E2ELegacyExternal") || /^(Internal|External)\b/.test(c)), JSON.stringify(cards));
  await signIn("manager");
  await goto("/manage?q=E2E");
  await waitFor("document.body.innerText.includes('E2E')", "manage results");
  const found = await bodyText();
  // one row per team member (their primary profile), so the member appears once
  const memberOwner = sql("select coalesce(nullif(full_name,''), email) from app_users where email='member@example.test'");
  const memberRows = Number(await ev(`[...document.querySelectorAll('main ul li')].filter(li=>li.innerText.includes(${JSON.stringify("owner " + memberOwner)})).length`));
  check("Manage lists internal profiles only, one row per team member, named [IBCode_]<NameSurname>_<Role>_InfoBeans", memberRows === 1 && /E2E[A-Za-z0-9]*_[A-Za-z0-9]+_InfoBeans/.test(found) && !found.includes("E2ELegacyExternal"), String(memberRows));
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
    await waitFor("!!document.querySelector('[data-preview-editor]')", "preview ready");
  };
  const tickConsentAndSubmit = async () => {
    if (await ev("!!document.querySelector('[data-pdf-needed]')")) await t.viewPdfOnPreview();
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
    const consentRow=consent.closest('div.border'); const label=[...row.querySelectorAll('span')].find(s=>s.textContent.trim()==='Mark as primary profile');
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
  check("My Profiles shows the Primary badge on the primary profile only", await ev(`(()=>{const two=${cardOf("E2EPrimaryTwo")}, one=${cardOf("E2EPrimaryOne")}; return !!two?.querySelector('[data-primary-badge]') && !two.querySelector('[data-mark-primary]') && !one?.querySelector('[data-primary-badge]') && !!one?.querySelector('[data-mark-primary]')})()`));
  await ev(`${cardOf("E2EPrimaryOne")}.querySelector('[data-mark-primary] button').click()`);
  await waitFor("!!document.querySelector('dialog[open]')", "confirm dialog");
  const dialog = await ev("document.querySelector('dialog[open]').innerText");
  check("the confirmation asks with the agreed wording", dialog.includes("Your primary profile is the one managers will see and use. Make this your primary profile?"), dialog);
  await click("Cancel", "dialog[open] button");
  await sleep(300);
  check("Cancel changes nothing", primaryName() === "E2E Primary Two");
  await ev(`${cardOf("E2EPrimaryOne")}.querySelector('[data-mark-primary] button').click()`);
  await waitFor("!!document.querySelector('dialog[open]')", "confirm dialog");
  await click("Make primary", "dialog[open] button");
  await waitFor(`!!(${cardOf("E2EPrimaryOne")})?.querySelector('[data-primary-badge]')`, "badge moved");
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
  await waitFor("!!document.querySelector('[data-preview-editor]')", "preview ready");
  check("for a non-primary profile the box is offered unticked", (await choice()) === "choose");
  await tickConsentAndSubmit();
  const twoVersions = Number(sql(`select count(*) from profile_versions where profile_id='${twoId}'`));
  check("saving a new version of another profile keeps the primary where it was", primaryName() === "E2E Primary One" && twoVersions === 2, JSON.stringify({ primary: primaryName(), twoVersions }));

  // 5. Manage: the team member once, showing the primary profile only; no other profiles, no version history
  await signIn("manager");
  await goto("/manage?q=E2E Primary");
  await waitFor("document.body.innerText.includes('E2EPrimary')", "manage results");
  const list = await bodyText();
  check("Manage shows the team member once, as their primary profile, with the Primary badge", list.includes("E2EPrimaryOne") && !list.includes("E2EPrimaryTwo") && (await ev("!!document.querySelector('main ul li [data-primary-badge]')")));
  await click("E2EPrimaryOne", "main ul li a");
  await waitFor("location.pathname.startsWith('/manage/') && document.body.innerText.includes('Primary profile')", "primary profile page");
  const page = await bodyText();
  check("the primary profile's page shows no other profiles and no version history", !(await ev("!!document.querySelector('[data-other-profiles]')")) && !page.includes("Other profiles") && !page.includes("Version history") && !page.includes("E2EPrimaryTwo"));
  const nonPrimaryId = sql("select id from profiles where candidate_name='E2E Primary Two' and owner_id=(select id from auth.users where email='member@example.test')");
  await goto(`/manage/${nonPrimaryId}`);
  await waitFor("!!document.querySelector('[data-profile-not-found]') || document.body.innerText.includes('could not be found')", "non-primary page");
  check("a team member's non-primary profile is not available to a manager (same 'not found' answer)", !(await bodyText()).includes("Primary profile ·"));
});

await t.scenario("every top-nav link opens its page (no 404) for a signed-in user", async () => {
  await signIn("manager"); // managers see every link, Manage included
  const notFound = async () => /could not be found|\b404\b/i.test(await bodyText());
  const LINKS = [
    ["Profile Hub", "/manage", "header nav a"],
    ["Generator", "/internal", "header nav a"],
    ["My Profiles", "/profiles", "header nav a"],
    ["Instructions", "/internal/instructions", "header nav a"],
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

await t.scenario("the header: Profile Hub for managers, admins and leads, no Style Guide for anyone", async () => {
  // the text links only: the first link in the nav is the logo (no text)
  const headerLinks = () => ev("[...document.querySelectorAll('header nav a')].map(a=>a.textContent.trim()).filter(Boolean).join('|')");
  // lead@ is a team_member in the app who leads people in the mock Teams data (docs/TEAMS-DB.md): Profile Hub in mock mode only
  const mock = process.env.TEAMS_DB_MODE === "mock";
  for (const [who, manage] of [["member", false], ["checker", false], ["lead", mock], ["manager", true], ["admin", true]]) {
    await signIn(who);
    await goto("/profiles");
    await waitFor("!!document.querySelector('header nav a')", "header");
    const links = await headerLinks();
    // administrators also get Registry, the client-name registry page (docs/COMPLIANCE.md)
    const expected = manage ? "Profile Hub|Generator|My Profiles|Instructions" + (who === "admin" ? "|Registry" : "") : "Generator|Instructions|My Profiles";
    check(`${who}: header is ${expected.replaceAll("|", " | ")}`, links === expected, links);
    check(`${who}: no Style Guide link in the header`, !links.includes("Style Guide"));
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

await t.scenario("checkers and managers create and submit their own profile like a team member", async () => {
  for (const who of ["checker", "manager"]) {
    await signIn(who);
    await goto("/internal");
    await ev("sessionStorage.clear()");
    await goto("/internal");
    const nav = await ev("JSON.stringify([...document.querySelectorAll('header nav a')].map(a=>a.textContent.trim()))");
    await ev("document.querySelector('button[aria-label^=\"Account menu\"]').click()");
    await waitFor("!!document.querySelector('[role=menuitem]')", "account menu");
    const menu = await ev("JSON.stringify([...document.querySelectorAll('[role=menuitem]')].map(a=>a.textContent.trim()))");
    // both are links in the header; the account menu holds only Sign out
    check(`${who} sees Generator and My Profiles`, JSON.parse(nav).includes("Generator") && JSON.parse(nav).includes("My Profiles") && JSON.parse(menu).includes("Sign out"), nav + menu);
    await ev("document.body.click()");
    await click("Get started");
    await waitFor("!!document.querySelector('label input')", `edit form (${who})`);
    const name = `E2E Own ${who}`;
    await t.fillRequired(name);
    const text = await t.submitViaPreview();
    check(`${who} can Submit their own profile`, text.startsWith("Submitted · saved to My Profiles · v1"), text);
    check(`the profile is owned by the ${who}`, sql(`select u.email from profiles p join auth.users u on u.id=p.owner_id where p.candidate_name='${name}'`) === `${who}@example.test`);
    await goto("/profiles");
    await waitFor(`document.body.innerText.includes('E2EOwn${who[0].toUpperCase()}${who.slice(1)}')`, `My Profiles (${who})`);
    check(`${who}'s My Profiles lists it`, true);
  }
});

await t.scenario("Edit details: project cards collapse, Add project puts a new open Project 1 first, Expand / Collapse all", async () => {
  await signIn("member");
  await goto("/internal");
  await ev("sessionStorage.clear()");
  await goto("/internal");
  await click("Get started");
  await waitFor("!!document.querySelector('label input')", "edit form");
  await click("Projects", "section button[aria-expanded]");
  await waitFor("!!document.querySelector('[data-item-card]')", "project cards");
  const cards = () => ev("JSON.stringify([...document.querySelectorAll('[data-item-card]')].map(c=>{const b=c.querySelector('button[aria-expanded]'); return {title:b.textContent.trim(), open:b.getAttribute('aria-expanded')==='true', body:!document.getElementById(b.getAttribute('aria-controls'))?.hidden}}))").then(JSON.parse);
  let now = await cards();
  check("a new form: Project 1 is open, its toggle names its body (aria-controls)", now.length === 1 && now[0].open && now[0].body, JSON.stringify(now));
  await t.fill("Project Name", "First Fictional Project");
  await click("Add project");
  await sleep(300);
  now = await cards();
  check("Add project: the new project is Project 1, open; the old one is renumbered Project 2", now.length === 2 && now[0].title === "Project 1" && now[0].open && now[1].title.startsWith("Project 2 – First Fictional Project"), JSON.stringify(now));
  check("the focus is in the new Project 1's first field", await ev("!!document.activeElement?.closest(\"[data-item-card='0']\") && document.activeElement.tagName === 'INPUT'"));
  await click("Collapse all", 'button[aria-label="Collapse all projects"]');
  await sleep(200);
  now = await cards();
  check("Collapse all: every card collapsed (aria-expanded false, body hidden)", now.every((c) => !c.open && !c.body), JSON.stringify(now));
  await ev("document.querySelector(\"[data-item-card='1'] button[aria-expanded]\").click()");
  await sleep(200);
  await ev("document.querySelector(\"[data-item-card='1'] button[title='Move up']\").click()");
  await sleep(200);
  now = await cards();
  check("the move arrows keep each card's open state with it", now[0].title.startsWith("Project 1 – First Fictional Project") && now[0].open && !now[1].open, JSON.stringify(now));
  await click("Expand all", 'button[aria-label="Expand all projects"]');
  await sleep(200);
  check("Expand all opens every card", (await cards()).every((c) => c.open && c.body));
});

await t.scenario("Edit details: skills are a table, one row per skill, named inputs, move / remove / Add skill", async () => {
  await signIn("member");
  await goto("/internal");
  await ev("sessionStorage.clear()");
  await goto("/internal");
  await click("Get started");
  await waitFor("!!document.querySelector('label input')", "edit form");
  await click("Skills", "section button[aria-expanded]");
  await waitFor("!!document.querySelector('[data-skill-row]')", "skills table");
  check("one row per skill with a named name and rating box", await ev(`!!document.querySelector('table input[aria-label="Skill 1 name"]') && !!document.querySelector('table input[aria-label="Skill 1 rating"]')`));
  await t.fillNamed("Skill 1 name", "Fictional Skill A");
  await click("Add skill");
  await sleep(300);
  check("Add skill adds row 2 below and puts the focus in its name box", await ev(`document.activeElement?.getAttribute('aria-label') === 'Skill 2 name'`));
  await t.fillNamed("Skill 2 name", "Fictional Skill B");
  await t.fillNamed("Skill 2 rating", "4.5");
  await sleep(200);
  await ev(`document.querySelector('button[aria-label="Move skill 2 up"]').click()`);
  await sleep(200);
  const order = await ev(`[...document.querySelectorAll('input[aria-label$=" name"][aria-label^="Skill "]')].map(i=>i.value).join('|')`);
  check("Move up reorders the rows", order === "Fictional Skill B|Fictional Skill A", order);
  check("the rating moved with its skill", (await ev(`document.querySelector('input[aria-label="Skill 1 rating"]').value`)) === "4.5");
  await ev(`document.querySelector('button[aria-label="Remove skill 2"]').click()`);
  await sleep(200);
  check("Remove deletes the row; the last row cannot be removed", (await ev("document.querySelectorAll('[data-skill-row]').length")) === 1 && (await ev(`document.querySelector('button[aria-label="Remove skill 1"]').disabled`)));
});

await t.scenario("Teams data (mock): /profile/<ib_code> and the Profile Hub team list follow the access rules", async () => {
  if (process.env.TEAMS_DB_MODE !== "mock") return void console.log("SKIP  needs TEAMS_DB_MODE=mock (docs/TEAMS-DB.md)");
  // fictional mock people (ops/teams_db.py): IB9003 member@ (Alex Sample, primary), IB9004 member2@, IB9005 Riya (no account)
  const linkState = () => ev("document.querySelector('[data-profile-link-state]')?.dataset.profileLinkState ?? (document.body.innerText.includes(\"isn't available to you\") ? 'denied' : document.body.innerText.includes('No such employee') ? 'unknown' : '?')");
  const open = async (code) => (await goto(`/profile/${code}`), linkState());
  // earlier scenarios make an E2E profile the member's primary (asPrimary): use the seeded one here
  sql(`update profiles set is_primary = false where owner_id = (select id from auth.users where email='member@example.test') and is_primary`);
  sql(`update profiles set is_primary = true where owner_id = (select id from auth.users where email='member@example.test') and candidate_name = 'Alex Sample'`);
  await signIn("member");
  check("member: their own /profile link opens their primary profile", (await open("IB9003")) === "ok" && (await bodyText()).includes("Alex_Sample"));
  check("member: someone else's link is not available", (await open("IB9004")) === "denied");
  check("member: an unknown IB code looks the same", (await open("IB0000")) === "denied");
  await goto("/manage");
  check("member: no team list", (await bodyText()).includes("have access to this page"));
  await signIn("lead");
  check("lead (a team_member with reportees): opens a team member's profile", (await open("IB9003")) === "ok");
  check("lead: \"No profile yet\" for someone without one", (await open("IB9005")) === "none" && (await bodyText()).includes("No profile yet"));
  await goto("/manage");
  await waitFor("!!document.querySelector('[data-team-list]')", "team list");
  const leadRows = await ev("[...document.querySelectorAll('tr[data-team-row]')].map(r=>r.dataset.teamRow).join(',')");
  check("lead: My team lists direct and indirect reportees only", leadRows === "IB9005,,IB9003", leadRows);
  check("lead: View is enabled only with a profile", (await ev("[...document.querySelectorAll('tr[data-team-row] a[href^=\"/profile/\"]')].map(a=>a.getAttribute('href')).join(',')")) === "/profile/IB9003");
  await signIn("manager");
  await goto("/manage?tab=team&scope=all&du=Delivery%20Unit%20Beta");
  await waitFor("!!document.querySelector('[data-team-list]')", "team list");
  const beta = await ev("[...document.querySelectorAll('tr[data-team-row]')].map(r=>r.dataset.teamRow).join(',')");
  check("manager: All team members, filtered by delivery unit", beta === "IB9005,,IB9008,IB9004", beta);
  await goto("/profile/IB9004");
  check("manager: opens anyone's primary profile", (await linkState()) === "ok");
});

await t.finish();
