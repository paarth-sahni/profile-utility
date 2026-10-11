import Link from "next/link";
import { ReactNode } from "react";
import type { Audience } from "@/components/ProfileWorkflow";

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-500 text-xs font-semibold text-white">
        {n}
      </span>
      <div>
        <p className="font-medium text-gray-900">{title}</p>
        <div className="mt-1 text-sm text-gray-600">{children}</div>
      </div>
    </li>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
      <h2 className="mb-4 text-lg font-semibold text-gray-900">{title}</h2>
      {children}
    </section>
  );
}

export default function InstructionsContent({ audience }: { audience: Audience }) {
  const showExternal = audience === "external";
  const showInternal = audience === "internal";

  return (
    <main className="mx-auto w-full max-w-3xl space-y-6 px-4 py-8">
      <Card title="Signing in">
        <ol className="space-y-4">
          <Step n={1} title="Open the Generator">
            Go to the Generator page. If you aren&apos;t signed in, you&apos;ll be taken to the sign-in page.
          </Step>
          <Step n={2} title="Sign in with Google">
            Click <strong>Sign in with Google</strong> and choose your <strong>@infobeans.com</strong> account. Personal
            Gmail accounts and other company accounts are not allowed.
          </Step>
          <Step n={3} title="Start generating">
            You&apos;ll land on the Generator. Use <strong>Sign out</strong> in the top-right corner when you&apos;re done,
            especially on shared computers.
          </Step>
        </ol>
        <p className="mt-4 text-sm text-gray-600">
          Can&apos;t sign in? Check that you picked your InfoBeans account, then try again. If it still fails, contact
          your administrator.
        </p>
      </Card>
      {showExternal && (
        <Card title="External Profile">
          <p className="mb-4 text-sm text-gray-600">
            The External Profile is the standard InfoBeans profile shared with clients to present a candidate&apos;s
            skills, experience, and project expertise in a consistent format. It includes a professional summary,
            project details, and key skills in a client-ready layout.
          </p>
          <ol className="space-y-8">
            <Step n={1} title="Choose how to get started">
              On the <Link href="/external" className="text-brand-500 underline">Generator</Link> page, choose one of the
              following options:
              <ul className="mt-1 list-disc space-y-1 pl-5">
                <li>
                  <strong>Generate from Candidate Resume</strong> – Upload the candidate&apos;s latest resume to
                  generate a standardized InfoBeans profile.
                </li>
                <li>
                  <strong>Start with Blank Profile</strong> – Begin with a blank External Profile template and enter
                  the candidate&apos;s details manually.
                </li>
              </ul>
              <p className="mt-2">
                If you select <strong>Start with Blank Profile</strong>, you go straight to{" "}
                <strong>Step 3: Review &amp; edit</strong>. Step 2 applies only when generating a profile from a
                candidate&apos;s resume.
              </p>
            </Step>
            <Step n={2} title="Upload the resume">
              Drag and drop the candidate&apos;s resume (PDF or DOCX, up to 10 MB) or choose a file. The generator
              reads it and pre-fills the External Profile — the professional summary, education, project details,
              skills, tools &amp; certifications, and work experience. This usually takes under a minute. Scanned
              images can&apos;t be read, so use a DOCX or a text-based PDF.
            </Step>
            <Step n={3} title="Review & edit">
              Review the generated profile and make any required changes before proceeding. A <strong>Please
              double-check</strong> panel lists every value that had to be estimated or is still missing. Pay special
              attention to
              the following fields:
              <ul className="mt-1 list-disc space-y-1 pl-5">
                <li>
                  <strong>Profile header</strong> – Keep the Job Title, Experience Summary, and Specialization
                  concise and up to date.
                </li>
                <li>
                  <strong>Overview</strong> – Ensure the summary accurately reflects the candidate&apos;s experience
                  and expertise.
                </li>
                <li>
                  <strong>Education &amp; Training</strong> – Verify the highest qualification, institution, and
                  graduation year.
                </li>
                <li>
                  <strong>Projects</strong> – Add, edit, reorder, or remove projects as needed.
                </li>
                <li>
                  <strong>Project description &amp; responsibilities</strong> – Ensure they accurately reflect the
                  candidate&apos;s work and remove any duplicate or irrelevant information.
                </li>
                <li>
                  <strong>Skills, tools &amp; certifications</strong> – Review and update the extracted information
                  for accuracy.
                </li>
                <li>
                  <strong>Content accuracy</strong> – Ensure all information is complete, relevant, and free from
                  formatting or content errors.
                </li>
              </ul>
            </Step>
            <Step n={4} title="Download">
              Download the profile in <strong>DOCX</strong> format.
            </Step>
          </ol>
        </Card>
      )}

      {showInternal && (
      <Card title="Internal Profile">
        <p className="mb-4 text-sm text-gray-600">
          Generate or update your InfoBeans Internal Profile in the standard format using your existing profile or a
          blank template. The profile includes detailed project information along with a sidebar for skills,
          certifications, tools, domains, languages, and other professional details.
        </p>
        <ol className="space-y-8">
          <Step n={1} title="Choose how to get started">
            On the <Link href="/internal" className="text-brand-500 underline">Generator</Link> page, choose one of
            the following options:
            <ul className="mt-1 list-disc space-y-1 pl-5">
              <li>
                <strong>Update an Existing Profile (fastest)</strong> – Upload your latest InfoBeans profile
                to update it with your recent experience and generate it in the latest standard format.
              </li>
              <li>
                <strong>Create a Profile from Scratch</strong> – Begin with a blank Internal Profile
                template and enter all profile details from scratch.
              </li>
            </ul>
            <p className="mt-2">
              If you select <strong>Create a Profile from Scratch</strong>, you go straight to{" "}
              <strong>Step 3: Review &amp; edit</strong>. Step 2 applies only when using an existing profile.
            </p>
          </Step>
          <Step n={2} title="Upload your profile (existing profile only)">
            Drag and drop your existing profile or resume (PDF or DOCX, up to 10 MB) or choose a file. The generator
            reads it and pre-fills project details (duration, tools &amp; technologies, team size, role, project
            link, and responsibilities) along with sidebar information such as skill ratings, certifications, tools,
            managerial experience, domains, and languages. Scanned images can&apos;t be read, so use a DOCX or a
            text-based PDF.
          </Step>
          <Step n={3} title="Review & edit">
            Review and edit profile section details. A <strong>Please double-check</strong> panel lists every value
            that had to be estimated or is still missing:
            <ul className="mt-1 list-disc space-y-1 pl-5">
              <li>
                <strong>Profile header</strong> – Keep your Job Title, Experience, and Specialization concise. Avoid
                long sentences and use short keywords.
              </li>
              <li>
                <strong>Overview</strong> – Update the summary to accurately reflect your experience and expertise.
              </li>
              <li>
                <strong>Education &amp; Training</strong> – Add your highest qualification, institution, and
                graduation year.
              </li>
              <li>
                <strong>Projects</strong> – Add, edit, reorder, or remove projects as needed.
              </li>
              <li>
                <strong>Project duration</strong> – Verify the duration displayed for each project. Project
                numbering is added automatically.
              </li>
              <li>
                <strong>Project link</strong> – Add a public project URL where applicable, or use <em>NDA</em> if the
                project cannot be shared.
              </li>
              <li>
                <strong>Project description &amp; responsibilities</strong> – Ensure they accurately reflect your
                work, remove duplicate information, and update or refine the content where needed.
              </li>
              <li>
                <strong>Skill ratings</strong> – a plain number out of 5 (e.g. <em>3.8</em>), displayed as
                “(3.8/5)” in the sidebar. They are estimated when the uploaded profile doesn&apos;t state them, and flagged for you to confirm.
              </li>
              <li>
                <strong>Managerial Experience, Domains &amp; Languages</strong> – Keep each entry concise (a few
                words per item).
              </li>
              <li>
                <strong>Content accuracy</strong> – Ensure all information is complete, relevant, and free from
                formatting or content errors before generating the final profile.
              </li>
            </ul>
          </Step>
          <Step n={4} title="Download">
            Download your profile in <strong>DOCX</strong> and do a final review before sharing.
          </Step>
          <Step n={5} title="Submit">
            Once you&apos;ve downloaded your profile, upload the generated file through the{" "}
            <a
              href="https://forms.gle/AkoYDhnMvyxyXFP5A"
              target="_blank"
              rel="noopener noreferrer"
              className="text-brand-500 underline"
            >
              Google Form
            </a>{" "}
            to complete your profile submission.
          </Step>
        </ol>
      </Card>
      )}

      <Card title="Tips & troubleshooting">
        <ul className="list-disc space-y-2 pl-5 text-sm text-gray-600">
          <li>
            <strong>Validation errors</strong> – The error list highlights the fields that need attention. Fix them
            in the form and generate again.
          </li>
          <li>
            <strong>Template rendering errors</strong> – These usually occur when a required field is empty. Review
            the form, correct the data, and try again.
          </li>
          <li>
            <strong>Upload problems</strong> – If a file can&apos;t be read, try a DOCX or a text-based PDF, or use
            the blank form instead.
          </li>
          <li>
            <strong>DOCX formatting</strong> – Minor formatting differences may appear in the downloaded DOCX
            depending on whether it is opened in Microsoft Word, WPS, or Google Docs.
          </li>
          <li>
            <strong>Formatting adjustments</strong> – If the downloaded DOCX requires any formatting changes, upload
            it to Google Docs, update the formatting, and share the Google Docs link while submitting the form.
          </li>
          <li>
            <strong>Style Guide</strong> – Use the predefined{" "}
            <Link href="/style-guide" className="text-brand-500 underline">document style guide</Link> to keep
            fonts, headings, and spacing consistent throughout the profile.
          </li>
        </ul>
      </Card>
    </main>
  );
}
