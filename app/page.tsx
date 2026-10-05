import { redirect } from "next/navigation";

// Bare domain lands on the internal flow; the external flow lives at /external.
export default function Home() {
  redirect("/internal");
}
