// Runs the Vite build and prints the full error (with file and line) if it fails.
import { build } from "vite";

try {
  await build();
} catch (error) {
  console.log("\nBuild failed:");
  console.log(error?.stack || error?.message || error);
  if (error?.id) console.log("File:", error.id);
  if (error?.loc) console.log("Location:", JSON.stringify(error.loc));
  if (error?.frame) console.log(error.frame);
  process.exit(1);
}
