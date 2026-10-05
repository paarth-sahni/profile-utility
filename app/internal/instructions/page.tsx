import type { Metadata } from "next";
import InstructionsContent from "@/components/InstructionsContent";

export const metadata: Metadata = {
  title: "Instructions — Profile Generator",
};

export default function InternalInstructionsPage() {
  return <InstructionsContent audience="internal" />;
}
