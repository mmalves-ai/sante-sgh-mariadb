// Avalia as saídas do seguranca:verificar e imprime o resumo (0 segredo, 0 Semgrep alto,
// 0 vulnerabilidade alta ou crítica sem exceção aprovada, SBOM gerado).
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const [saida = '.', arquivoExcecoes = '', ...codigos] = process.argv.slice(2);
const [cGitHist, cGitArv, cSemgrep, cOsv, cTrivy, cSyft] = codigos.map(Number);

function lerJson<T>(nome: string): T | null {
  const caminho = join(saida, nome);
  if (!existsSync(caminho)) return null;
  return JSON.parse(readFileSync(caminho, 'utf8')) as T;
}

const segredosHist = lerJson<unknown[]>('gitleaks-historico.json') ?? [];
const segredosArv =
  lerJson<{ File: string; RuleID: string; StartLine: number }[]>('gitleaks-arvore.json') ?? [];

const semgrep = lerJson<{
  results: { check_id: string; path: string; extra: { severity: string } }[];
  paths?: { scanned?: string[] };
}>('semgrep.json');
const semgrepAltos = (semgrep?.results ?? []).filter((r) => r.extra.severity === 'ERROR');

interface OsvGrupo {
  ids: string[];
  max_severity?: string;
}
interface OsvPacote {
  package: { name: string; version: string };
  groups?: OsvGrupo[];
}
// Sem nota numérica (campo ausente, vazio ou não numérico) conta como bloqueante: na dúvida, vermelho.
function bloqueiaOsv(nota: string | undefined): boolean {
  if (nota === undefined || nota.trim() === '') return true;
  const valor = Number(nota);
  return Number.isNaN(valor) || valor >= 7;
}
const osv = lerJson<{ results?: { packages?: OsvPacote[] }[] }>('osv.json');
// Exceção vale só até `validoAte` (AAAA-MM-DD, inclusive); vencida ou sem data, deixa de valer e o achado bloqueia.
const hoje = new Date().toISOString().slice(0, 10);
const excecoes = (
  JSON.parse(readFileSync(arquivoExcecoes, 'utf8')) as { osv: { id: string; validoAte?: string }[] }
).osv
  .filter(
    (e) => typeof e.validoAte === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(e.validoAte) && e.validoAte >= hoje,
  )
  .map((e) => e.id);
const osvAltos = (osv?.results ?? [])
  .flatMap((r) => r.packages ?? [])
  .flatMap((p) => (p.groups ?? []).map((g) => ({ pacote: `${p.package.name}@${p.package.version}`, g })))
  .filter(({ g }) => bloqueiaOsv(g.max_severity) && !g.ids.some((id) => excecoes.includes(id)));

interface TrivyAchado {
  VulnerabilityID?: string;
  ID?: string;
  PkgName?: string;
  Severity: string;
}
const trivy = lerJson<{
  Results?: { Target: string; Vulnerabilities?: TrivyAchado[]; Misconfigurations?: TrivyAchado[] }[];
}>('trivy.json');
const trivyTodos = (trivy?.Results ?? []).flatMap((r) =>
  [...(r.Vulnerabilities ?? []), ...(r.Misconfigurations ?? [])].map((a) => ({ alvo: r.Target, a })),
);
// Sem isenção por pasta: marketing/ também bloqueia (exceção só pelo trivyignore, com aprovação do dono).
const trivyAchados = trivyTodos.length;
for (const t of trivyTodos) {
  console.error(
    `TRIVY: ${t.alvo} ${t.a.VulnerabilityID ?? t.a.ID ?? '?'} ${t.a.PkgName ?? ''} ${t.a.Severity}`,
  );
}

const sbom = join(saida, 'sbom.spdx.json');
const sbomPacotes = existsSync(sbom)
  ? ((JSON.parse(readFileSync(sbom, 'utf8')) as { packages?: unknown[] }).packages?.length ?? 0)
  : 0;

const linhas: [string, boolean, string][] = [
  ['gitleaks (histórico)', cGitHist === 0, `${segredosHist.length} segredo(s)`],
  [
    'gitleaks (árvore)',
    cGitArv === 0,
    `${segredosArv.length} segredo(s)${segredosArv.map((s) => ` ${s.File}:${s.StartLine} ${s.RuleID}`).join(';')}`,
  ],
  [
    'Semgrep',
    semgrep !== null && cSemgrep === 0 && semgrepAltos.length === 0,
    `${semgrepAltos.length} achado(s) alto(s) de ${semgrep?.results.length ?? '?'} em ${semgrep?.paths?.scanned?.length ?? '?'} arquivo(s)`,
  ],
  [
    'OSV-Scanner',
    osv !== null && osvAltos.length === 0,
    `${osvAltos.length} vulnerabilidade(s) alta(s)/crítica(s) sem exceção (código ${cOsv})`,
  ],
  [
    'Trivy fs',
    trivy !== null && cTrivy === 0 && trivyAchados === 0,
    `${trivyAchados} achado(s) ALTO/CRÍTICO sem exceção`,
  ],
  [
    'Syft (SBOM SPDX)',
    cSyft === 0 && sbomPacotes > 0,
    existsSync(sbom)
      ? `${sbomPacotes} pacotes, ${statSync(sbom).size} bytes, .seguranca/saida/sbom.spdx.json`
      : 'não gerado',
  ],
];
for (const r of semgrepAltos) console.error(`SEMGREP: ${r.path} ${r.check_id}`);
for (const o of osvAltos) console.error(`OSV: ${o.pacote} ${o.g.ids.join(',')} (${o.g.max_severity ?? '?'})`);

console.log('\n══ Resumo de pnpm seguranca:verificar ══');
for (const [nome, ok, detalhe] of linhas)
  console.log(`  ${ok ? 'verde   ' : 'VERMELHO'}  ${nome}: ${detalhe}`);
const ok = linhas.every(([, v]) => v);
console.log(ok ? 'Resultado: verde' : 'Resultado: VERMELHO');
process.exit(ok ? 0 : 1);
