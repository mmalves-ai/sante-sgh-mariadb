// Checagem de sintaxe dos .ts que entram no commit (26/11): lê a versão PREPARADA (git show :arquivo), não a da árvore,
// porque o commit montado por trechos (patch + git apply --cached) quebrou três vezes o HEAD com a árvore correta.
const { execFileSync } = require('child_process');
const ts = require(process.cwd() + '/node_modules/typescript');
const arqs = execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR'], { encoding: 'utf8' })
  .split('\n').filter((f) => /\.(ts|mts|cts)$/.test(f));
let ruins = 0;
for (const f of arqs) {
  const t = execFileSync('git', ['show', ':' + f], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const s = ts.createSourceFile(f, t, ts.ScriptTarget.Latest, true);
  for (const d of s.parseDiagnostics || []) {
    ruins++;
    const p = s.getLineAndCharacterOfPosition(d.start);
    console.error(`${f}:${p.line + 1}:${p.character + 1} ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`);
  }
}
if (ruins) { console.error(`pre-commit: ${ruins} erro(s) de sintaxe no que está preparado para o commit; commit bloqueado.`); process.exit(1); }
