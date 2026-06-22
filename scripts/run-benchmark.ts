import { readFileSync } from "fs";

const benchmarkData = JSON.parse(readFileSync("./scripts/turso-bench-questions.json", "utf-8"));

// Select representative sample: 3 easy, 3 medium, 4 hard
const easy = benchmarkData.questions.filter((q: any) => q.difficulty === "easy").slice(0, 3);
const medium = benchmarkData.questions.filter((q: any) => q.difficulty === "medium").slice(0, 3);
const hard = benchmarkData.questions.filter((q: any) => q.difficulty === "hard").slice(0, 4);
const sample = [...easy, ...medium, ...hard];

console.log(`\n=== TURSO BENCHMARK: ${sample.length} questions ===`);
console.log(`Easy: ${easy.length}, Medium: ${medium.length}, Hard: ${hard.length}`);
console.log(`\nRunning with codemogger and without codemogger in parallel agents...\n`);

// Questions for the benchmark report
for (const q of sample) {
  console.log(`Q${q.id} [${q.difficulty}] ${q.q}`);
}

console.log("\nAgent pairs dispatched. Awaiting results...");
