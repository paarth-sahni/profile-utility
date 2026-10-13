/**
 * Purpose: optional browser test for session handling and draft recovery on the Review screen (npm run test:e2e).
 * Covers: drafts in sessionStorage only, 401 on save then restore after re-login, the session-expiry banner,
 * Discard, the "Discard your unsaved draft?" question, sign-out clearing drafts, and another user never seeing a
 * draft. Local stack and seeded users only; see scripts/e2e-lib.mjs for the requirements.
 */
import { startHarness } from "./e2e-lib.mjs";

const t = await startHarness("e2e-drafts");
const { check, goto, click, bodyText, setName, fillRequired, submitViaPreview, getName, draftOf, waitFor, ev, sleep, sql, signIn, ageSession, key } = t;

/** A clean slate for one scenario: signed in as `who`, nothing in this tab's storage, on the start screen. */
async function fresh(who = "member") {
  await signIn(who);
  await goto("/internal");
  await ev("sessionStorage.clear()");
  await goto("/internal");
  await waitFor("document.body.innerText.includes('Create a Profile from Scratch')", "start screen");
}
const openBlankForm = async () => {
  await click("Get started");
  await waitFor("!!document.querySelector('label input')", "review form");
};

await t.scenario("draft is written while there is unsaved work (and only in sessionStorage)", async () => {
  await fresh();
  await openBlankForm();
  check("a blank form nobody typed into has no draft", (await draftOf()) === null);
  await setName("E2E Draft Test");
  await sleep(700);
  const d = JSON.parse((await draftOf()) ?? "null");
  check("typing creates a sessionStorage draft", d?.data?.name === "E2E Draft Test" && d?.template === "internal" && d?.source === "scratch");
  check("nothing is written to localStorage", (await ev("Object.keys(localStorage).filter(k=>k.includes('draft')).length")) === 0);
});

await t.scenario("session ends: 401 on save, restore after re-login, save clears the draft, expiry banner", async () => {
  await fresh();
  await openBlankForm();
  await fillRequired("E2E Draft Test"); // saving needs the required fields
  await sleep(700);
  ageSession("member", "2 hours 1 minute");
  // Preview, tick the consent box, Submit: recording the consent answers 401, which ends the session
  await click("Preview →");
  await waitFor("!!document.querySelector('[data-doc-preview=ready]')", "preview");
  await ev("document.querySelector('[data-preview-step] input[type=checkbox]').click()");
  await click("Submit", "[data-preview-step] button");
  await waitFor("location.pathname.startsWith('/login')", "redirect to /login after 401");
  check("a 401 on Submit sends the user to /login", true);
  check("the draft survives the redirect (same tab)", JSON.parse((await draftOf()) ?? "null")?.data?.name === "E2E Draft Test");

  await signIn("member");
  await goto("/internal");
  await waitFor("document.body.innerText.includes('Restore your unsaved changes?')", "restore prompt");
  check("after re-login the restore prompt appears", true);
  check("the prompt says the draft never leaves the browser", (await bodyText()).includes("never sent anywhere"));
  await click("Restore");
  await waitFor("!!document.querySelector('label input')", "restored form");
  check("Restore brings the form back", (await getName()) === "E2E Draft Test");
  check("the prompt is gone after Restore", !(await bodyText()).includes("Restore your unsaved changes?"));
  await sleep(700);
  check("restored work is kept as a draft again", !!(await draftOf()));

  await submitViaPreview();
  await sleep(500);
  check("submitting clears the draft", (await draftOf()) === null);

  const profile = sql("select p.id from profiles p where p.candidate_name='E2E Draft Test' limit 1");
  const version = sql(`select current_version_id from profiles where id='${profile}'`);
  ageSession("member", "1 hour 56 minutes");
  await goto(`/internal?version=${version}`);
  await waitFor("!!document.querySelector('label input')", "saved version open");
  await waitFor("document.body.innerText.includes('Your session ends in')", "banner (saved)");
  const saved = await bodyText();
  check("banner with nothing unsaved only reassures", /Your session ends in [45] minutes?\. Your latest changes are saved\./.test(saved) && !saved.includes("Save now"));
  await setName("E2E Draft Test 2");
  await waitFor("document.body.innerText.includes('go to Preview and Submit')", "banner (unsaved)");
  const unsaved = await bodyText();
  check("banner with unsaved work says to go to Preview and Submit (or download), with no Save button", /Your session ends in [45] minutes? — go to Preview and Submit to save your profile \(or download your DOCX\)\./.test(unsaved) && !unsaved.includes("Save now") && !(await ev("[...document.querySelectorAll('[role=status] button, [role=alert] button')].length")));
  check("the draft still protects the edit", JSON.parse((await ev("sessionStorage.getItem('profile-draft:v1:internal')")) ?? "null")?.data?.name === "E2E Draft Test 2" || (await sleep(700), JSON.parse((await ev("sessionStorage.getItem('profile-draft:v1:internal')")) ?? "null")?.data?.name === "E2E Draft Test 2"));
});

await t.scenario("Discard, and leaving immediately still keeps a draft", async () => {
  await fresh();
  await openBlankForm();
  await setName("E2E Will Be Discarded");
  await sleep(700);
  await goto("/internal"); // reload: the draft is offered
  await waitFor("document.body.innerText.includes('Restore your unsaved changes?')", "prompt after reload");
  await click("Discard");
  await sleep(300);
  check("Discard hides the prompt and deletes the draft", !(await bodyText()).includes("Restore your unsaved changes?") && (await draftOf()) === null);
  await goto("/internal");
  await sleep(800);
  check("after Discard nothing is offered again", !(await bodyText()).includes("Restore your unsaved changes?"));

  await openBlankForm();
  await setName("E2E Typed Then Left");
  await goto("/profiles"); // leave at once: pagehide must flush the debounced draft
  check("leaving immediately still leaves a draft (pagehide flush)", JSON.parse((await draftOf()) ?? "null")?.data?.name === "E2E Typed Then Left");
});

await t.scenario("sign-out clears every draft", async () => {
  await fresh();
  await openBlankForm();
  await setName("E2E Signing Out");
  await sleep(700);
  check("a draft exists before sign-out", !!(await draftOf()));
  await ev("document.querySelector('header button[aria-haspopup]')?.click()");
  await sleep(300);
  await click("Sign out");
  await waitFor("location.pathname.startsWith('/login')", "login after sign-out");
  check("sign-out clears the draft (the pagehide flush must not bring it back)", (await draftOf()) === null);
});

await t.scenario("another user never sees the draft", async () => {
  await fresh("member");
  await openBlankForm();
  await setName("E2E Private To Member");
  await sleep(700);
  check("the member's draft is written", !!(await draftOf()));
  await signIn("member2");
  await goto("/internal");
  await sleep(1000);
  check("member2 is not offered it", !(await bodyText()).includes("Restore your unsaved changes?"));
  check("and the draft is deleted", (await draftOf()) === null);
});

await t.scenario("starting something new while a draft is pending asks 'Discard your unsaved draft?'", async () => {
  await fresh();
  await openBlankForm();
  await setName("E2E Pending Draft");
  await sleep(700);
  await goto("/internal");
  await waitFor("document.body.innerText.includes('Restore your unsaved changes?')", "restore prompt");

  await click("Get started");
  await waitFor("!!document.querySelector('dialog[open]')", "discard dialog");
  check("the dialog asks the question", (await bodyText()).includes("Discard your unsaved draft?"));
  check("it is a modal alertdialog", await ev("(()=>{const d=document.querySelector('dialog[open]'); return d.getAttribute('role')==='alertdialog' && d.matches(':modal')})()"));
  check("focus starts on the safe button", (await ev("document.activeElement?.textContent?.trim()")) === "No, keep it");
  for (let i = 0; i < 3; i++) await key("Tab", "Tab", 9);
  check("focus stays trapped inside the dialog", await ev("!!document.activeElement.closest('dialog')"));
  await key("Escape", "Escape", 27);
  await sleep(300);
  check("Esc means No: dialog closes", !(await ev("!!document.querySelector('dialog[open]')")));
  check("Esc keeps the prompt, the start screen and the stored draft", (await bodyText()).includes("Restore your unsaved changes?") && (await bodyText()).includes("Create a Profile from Scratch") && !!(await draftOf()));
  check("focus returns to the button that opened the dialog", (await ev("document.activeElement?.textContent?.trim()")) === "Get started");

  await click("Upload existing profile");
  await waitFor("!!document.querySelector('input[type=file]')", "upload step");
  await ev(`(()=>{const i=document.querySelector('input[type=file]'); const dt=new DataTransfer(); dt.items.add(new File(['x'],'resume.txt',{type:'text/plain'})); i.files=dt.files; i.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await waitFor("!!document.querySelector('dialog[open]')", "discard dialog (upload)");
  await click("No, keep it");
  await sleep(500);
  const afterNo = await bodyText();
  check("choosing a file asks too; No starts no upload and keeps the prompt", afterNo.includes("Restore your unsaved changes?") && !/Reading|Structuring/i.test(afterNo));

  await goto("/internal");
  await waitFor("document.body.innerText.includes('Restore your unsaved changes?')", "prompt again");
  await click("Get started");
  await waitFor("!!document.querySelector('dialog[open]')", "dialog (yes)");
  await click("Yes, discard");
  await waitFor("!!document.querySelector('label input')", "blank form after Yes");
  check("Yes opens the blank form, removes the prompt and deletes the draft", (await getName()) === "" && !(await bodyText()).includes("Restore your unsaved changes?") && (await draftOf()) === null);

  await goto("/internal");
  await click("Get started");
  await waitFor("!!document.querySelector('label input')", "form without dialog");
  check("without a pending draft there is no dialog", !(await ev("!!document.querySelector('dialog')")));
});

await t.finish();
