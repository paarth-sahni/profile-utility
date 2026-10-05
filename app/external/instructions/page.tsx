import type { Metadata } from "next";
import InstructionsContent from "@/components/InstructionsContent";

export const metadata: Metadata = {
  title: "Instructions — Profile Generator",
};

export default function ExternalInstructionsPage() {
  return <InstructionsContent audience="external" />;
}
