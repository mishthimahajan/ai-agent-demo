
export function isAllowedProposalPath(path: string): boolean {
  return /^src\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*\.(?:ts|tsx|mts|cts)$/.test(
    path
  );
}
