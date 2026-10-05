import { redirect } from "next/navigation";

// Bare /instructions has no audience context; default to the internal-only version.
export default function InstructionsRedirect() {
  redirect("/internal/instructions");
}
