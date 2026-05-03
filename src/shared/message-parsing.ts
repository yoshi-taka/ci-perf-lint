export function extractQuotedJobName(message: string): string | undefined {
  const match = /\bjob "([^"]+)"/i.exec(message);
  return match?.[1];
}
