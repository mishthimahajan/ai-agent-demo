import ts from "typescript";

export function validateTypeScriptSyntax(
  files: Array<{ path: string; content: string }>
): string[] {
  const errors: string[] = [];

  for (const file of files) {
    if (!/\.(ts|tsx|mts|cts)$/.test(file.path)) {
      continue;
    }

    const sourceFile = ts.createSourceFile(
      file.path,
      file.content,
      ts.ScriptTarget.Latest,
      true,
      file.path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
    );

    const diagnostics = (
      sourceFile as ts.SourceFile & {
        parseDiagnostics: readonly ts.Diagnostic[];
      }
    ).parseDiagnostics;

    for (const diagnostic of diagnostics) {
      const position = diagnostic.start === undefined
        ? ""
        : ` at line ${
            sourceFile.getLineAndCharacterOfPosition(diagnostic.start).line + 1
          }`;

      errors.push(
        `${file.path}${position}: ${
          ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")
        }`
      );
    }
  }

  return errors;
}
