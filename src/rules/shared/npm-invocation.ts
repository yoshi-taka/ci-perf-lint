const npmInvocationPattern =
  /\bnpm\s+(?:run|run-script)\s+([A-Za-z0-9:_./-]+)|\bnpm\s+(start|stop|test|restart)\b/g;

export function findNpmInvocations(text: string): string[] {
  const invocations: string[] = [];
  for (const match of text.matchAll(npmInvocationPattern)) {
    if (match[1]) {
      invocations.push(`npm run ${match[1]}`);
    } else if (match[2]) {
      invocations.push(`npm ${match[2]}`);
    }
  }
  return invocations;
}
