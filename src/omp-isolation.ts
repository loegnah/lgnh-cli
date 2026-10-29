export function createIsolationExtension(instructions: string, input: string): string {
  // An empty system prompt prevents OMP from adding its automatic date/cwd reminder.
  return `export default function (omp) {
  omp.on("before_agent_start", () => {
    omp.setActiveTools([]);
    return { systemPrompt: [] };
  });
  omp.on("context", () => ({
    messages: [
      { role: "developer", content: ${JSON.stringify(instructions)}, timestamp: 0 },
      { role: "user", content: ${JSON.stringify(input)}, timestamp: 0 }
    ]
  }));
}`;
}
