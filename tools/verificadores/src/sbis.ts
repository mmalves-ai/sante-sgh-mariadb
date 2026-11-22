// pnpm sbis:verificar (ficha do M59, regras 9 e 10; cap-13 §13.6.2 e §13.6.3): suíte de conformidade SBIS. Monta a
// matriz de rastreabilidade requisito → funcionalidade → teste → resultado a partir do catálogo `REQUISITOS_SBIS`
// (@sgh/contratos) e da tabela `MATRIZ_SBIS` (sbis-matriz.ts) e falha se:
//   - um requisito do catálogo não tem linha na matriz, ou a matriz cita requisito que o catálogo não tem;
//   - um requisito não tem teste, ou cita teste que não está versionado;
//   - uma linha da matriz tem lacuna aberta (a parte do requisito ainda não atendida nunca sai "conforme");
//   - com --executar, um teste unitário citado falha (os de integração rodam na cópia, pelo verificar:tudo).
// Gera dist/sbis/matriz-rastreabilidade.{md,json} (item "matriz-rastreabilidade" do pacote de evidências) e o
// checklist do pacote (itens × requisitos), na versão candidata e a cada execução do CI.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { ITENS_PACOTE_SBIS, REQUISITOS_SBIS, type RequisitoSbis } from '@sgh/contratos';
import { type LinhaMatrizSbis, MATRIZ_SBIS } from './sbis-matriz.ts';
import { matrizNgsEmMarkdown, montarMatrizNgs, REQUISITOS_NGS } from './sbis-ngs.ts';

export type ResultadoTeste = 'passou' | 'falhou' | 'na-copia' | 'presente';

export interface LinhaRastreabilidade {
  readonly codigo: string;
  readonly nivel: string;
  readonly regime: string;
  readonly concessao: string | null;
  readonly titulo: string;
  readonly funcionalidade: string;
  readonly testes: readonly { readonly arquivo: string; readonly resultado: ResultadoTeste }[];
  /** 'sem-execucao': a linha está completa, mas nenhum teste rodou (modo estático do `pnpm verificar`). */
  readonly resultado: 'conforme' | 'nao-conforme' | 'sem-execucao' | 'lacuna';
  /** A parte do requisito que ainda não é atendida (linha `lacuna` da matriz); null quando não há. */
  readonly lacuna: string | null;
}

export interface AchadoSbis {
  readonly codigo: string;
  readonly motivo: string;
}

export const ehIntegracao = (arquivo: string): boolean => arquivo.endsWith('.int.spec.ts');

/** Cruza catálogo, matriz e repositório; `resultados` vem da execução (sem ela, o teste só está presente). */
export function montarMatrizSbis(
  requisitos: readonly RequisitoSbis[],
  matriz: Readonly<Record<string, LinhaMatrizSbis>>,
  versionado: (arquivo: string) => boolean,
  resultados: ReadonlyMap<string, 'passou' | 'falhou'> = new Map(),
  executou = resultados.size > 0,
): { linhas: LinhaRastreabilidade[]; achados: AchadoSbis[] } {
  const achados: AchadoSbis[] = [];
  const linhas: LinhaRastreabilidade[] = [];
  const codigos = new Set(requisitos.map((r) => r.codigo));
  for (const codigo of Object.keys(matriz))
    if (!codigos.has(codigo)) achados.push({ codigo, motivo: 'linha da matriz sem requisito no catálogo' });
  for (const r of requisitos) {
    const linha = matriz[r.codigo];
    if (!linha) {
      achados.push({ codigo: r.codigo, motivo: 'requisito sem linha na matriz' });
      continue;
    }
    if (linha.testes.length === 0) achados.push({ codigo: r.codigo, motivo: 'requisito sem teste' });
    if (!linha.funcionalidade.trim()) achados.push({ codigo: r.codigo, motivo: 'funcionalidade em branco' });
    const testes = linha.testes.map((arquivo) => {
      if (!/\.spec\.ts$/.test(arquivo)) achados.push({ codigo: r.codigo, motivo: `não é teste: ${arquivo}` });
      if (!versionado(arquivo))
        achados.push({ codigo: r.codigo, motivo: `teste não versionado: ${arquivo}` });
      const resultado: ResultadoTeste = ehIntegracao(arquivo)
        ? 'na-copia'
        : (resultados.get(arquivo) ?? 'presente');
      if (resultado === 'falhou') achados.push({ codigo: r.codigo, motivo: `teste falhou: ${arquivo}` });
      return { arquivo, resultado };
    });
    const valida =
      testes.length > 0 &&
      testes.every((t) => t.resultado !== 'falhou') &&
      linha.testes.every((t) => versionado(t));
    // Conforme só com a execução: sem ela, a linha só prova que o teste existe (regra 9: suíte verde na candidata).
    // Lacuna aberta: nunca "conforme" e sempre achado (aceitá-la é exceção do dono, não da matriz).
    const lacuna = linha.lacuna?.trim() ? linha.lacuna.trim() : null;
    if (lacuna) achados.push({ codigo: r.codigo, motivo: `lacuna aberta: ${lacuna}` });
    const resultado = !valida ? 'nao-conforme' : lacuna ? 'lacuna' : executou ? 'conforme' : 'sem-execucao';
    linhas.push({
      codigo: r.codigo,
      nivel: r.nivel,
      regime: r.regime,
      concessao: r.concessao ?? null,
      titulo: r.titulo,
      funcionalidade: linha.funcionalidade,
      testes,
      resultado,
      lacuna,
    });
  }
  return { linhas, achados };
}

/** Checklist do pacote de evidências (regra 10): cada item com os requisitos que o pedem. */
export function checklistPacote(
  requisitos: readonly RequisitoSbis[],
): { item: string; requisitos: string[] }[] {
  return ITENS_PACOTE_SBIS.map((item) => ({
    item,
    requisitos: requisitos.filter((r) => r.evidencias.includes(item)).map((r) => r.codigo),
  }));
}

const ROTULO: Readonly<Record<ResultadoTeste, string>> = {
  passou: 'passou',
  falhou: 'FALHOU',
  'na-copia': 'integração na cópia',
  presente: 'presente',
};

export function matrizEmMarkdown(
  linhas: readonly LinhaRastreabilidade[],
  checklist: readonly { item: string; requisitos: string[] }[],
  executou: boolean,
): string {
  const partes = [
    '# Matriz de rastreabilidade SBIS',
    '',
    `Gerada por \`pnpm sbis:verificar${executou ? ' --executar' : ''}\`. ${linhas.length} requisitos; ` +
      `${linhas.filter((l) => l.resultado === 'conforme').length} conformes` +
      (linhas.some((l) => l.resultado === 'lacuna')
        ? `, ${linhas.filter((l) => l.resultado === 'lacuna').length} com lacuna aberta`
        : '') +
      (executou
        ? '.'
        : `, ${linhas.filter((l) => l.resultado === 'sem-execucao').length} sem execução (só a estrutura).`),
    '',
    '| Requisito | Nível | Regime | Funcionalidade | Testes | Resultado |',
    '|---|---|---|---|---|---|',
    ...linhas.map(
      (l) =>
        `| ${l.codigo} | ${l.nivel} | ${l.regime}${l.concessao ? ` (${l.concessao})` : ''} | ${l.funcionalidade} | ` +
        `${l.testes.map((t) => `\`${t.arquivo}\` (${ROTULO[t.resultado]})`).join('<br>')} | ` +
        `${l.lacuna ? `**LACUNA**: ${l.lacuna}` : l.resultado} |`,
    ),
    '',
    '## Checklist do pacote de evidências',
    '',
    '| Item | Requisitos |',
    '|---|---|',
    ...checklist.map((c) => `| ${c.item} | ${c.requisitos.join(', ') || '(nenhum)'} |`),
    '',
  ];
  return partes.join('\n');
}

/** A pasta do projeto vitest que roda o arquivo (a mais próxima com vitest.config.ts). */
export function projetoDoTeste(
  raiz: string,
  arquivo: string,
  existe: (caminho: string) => boolean = existsSync,
): string | null {
  let dir = dirname(arquivo);
  while (dir && dir !== '.' && dir !== '/') {
    if (existe(join(raiz, dir, 'vitest.config.ts'))) return dir;
    dir = dirname(dir);
  }
  return null;
}

function executarUnitarios(raiz: string, arquivos: readonly string[]): Map<string, 'passou' | 'falhou'> {
  const porProjeto = new Map<string, string[]>();
  const resultados = new Map<string, 'passou' | 'falhou'>();
  for (const a of arquivos) {
    const p = projetoDoTeste(raiz, a);
    if (!p) {
      resultados.set(a, 'falhou');
      continue;
    }
    porProjeto.set(p, [...(porProjeto.get(p) ?? []), a]);
  }
  // Relatórios do vitest dentro do repositório (POL-4: nada fora do projeto).
  mkdirSync(resolve(raiz, 'dist/sbis'), { recursive: true });
  const tmp = mkdtempSync(resolve(raiz, 'dist/sbis/vitest-'));
  try {
    for (const [projeto, lista] of porProjeto) {
      const saida = join(tmp, `${projeto.replace(/\//g, '_')}.json`);
      console.log(`[sbis] ${projeto}: ${lista.length} arquivo(s) de teste`);
      spawnSync(
        resolve(raiz, 'node_modules/.bin/vitest'),
        [
          'run',
          '--config',
          `${projeto}/vitest.config.ts`,
          '--reporter=json',
          `--outputFile=${saida}`,
          ...lista.map((a) => resolve(raiz, a)),
        ],
        {
          cwd: raiz,
          stdio: ['ignore', 'ignore', 'inherit'],
          env: { ...process.env, NX_LOAD_DOT_ENV_FILES: 'false' },
        },
      );
      const json = existsSync(saida)
        ? (JSON.parse(readFileSync(saida, 'utf8')) as { testResults?: { name: string; status: string }[] })
        : {};
      const porNome = new Map((json.testResults ?? []).map((t) => [t.name, t.status]));
      for (const a of lista)
        resultados.set(a, porNome.get(resolve(raiz, a)) === 'passed' ? 'passou' : 'falhou');
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  return resultados;
}

function principal(): number {
  const raiz = resolve(import.meta.dirname, '../../..');
  const executar = process.argv.includes('--executar');
  const versionados = new Set(
    execFileSync('git', ['ls-files', '-z', '--', '*.spec.ts'], { cwd: raiz, encoding: 'utf8' }).split('\0'),
  );
  const unitarios = [
    ...new Set(Object.values(MATRIZ_SBIS).flatMap((l) => l.testes.filter((t) => !ehIntegracao(t)))),
  ].filter((t) => versionados.has(t));
  const resultados = executar ? executarUnitarios(raiz, unitarios) : new Map<string, 'passou' | 'falhou'>();
  const { linhas, achados } = montarMatrizSbis(
    REQUISITOS_SBIS,
    MATRIZ_SBIS,
    (a) => versionados.has(a),
    resultados,
    executar,
  );
  const checklist = checklistPacote(REQUISITOS_SBIS);
  const pasta = resolve(raiz, 'dist/sbis');
  mkdirSync(pasta, { recursive: true });
  writeFileSync(join(pasta, 'matriz-rastreabilidade.md'), matrizEmMarkdown(linhas, checklist, executar));
  writeFileSync(
    join(pasta, 'matriz-rastreabilidade.json'),
    `${JSON.stringify({ executou: executar, linhas, checklist, achados }, null, 2)}\n`,
  );
  // W1-01 (parte 12b): a matriz NGS1/NGS2 requisito a requisito (evidência ou lacuna marcada).
  const todos = new Set(execFileSync('git', ['ls-files', '-z'], { cwd: raiz, encoding: 'utf8' }).split('\0'));
  const ngs = montarMatrizNgs(REQUISITOS_NGS, MATRIZ_SBIS, (a) => todos.has(a));
  writeFileSync(join(pasta, 'matriz-ngs.md'), matrizNgsEmMarkdown(ngs.linhas));
  writeFileSync(join(pasta, 'matriz-ngs.json'), `${JSON.stringify(ngs, null, 2)}\n`);
  achados.push(...ngs.achados);
  console.log(
    `[sbis] NGS1/NGS2: ${ngs.linhas.length} requisitos, ` +
      `${ngs.linhas.filter((l) => l.situacao === 'lacuna').length} lacuna(s) marcada(s) (dist/sbis/matriz-ngs.md)`,
  );
  for (const a of achados) console.error(`[sbis] ${a.codigo}: ${a.motivo}`);
  const ok = achados.length === 0;
  const conformes = linhas.filter((l) => l.resultado === 'conforme').length;
  const semExecucao = linhas.filter((l) => l.resultado === 'sem-execucao').length;
  console.log(
    `[sbis] ${REQUISITOS_SBIS.length} requisitos, ${conformes} conformes` +
      `${semExecucao ? `, ${semExecucao} sem execução (rode --executar)` : ''}, ${unitarios.length} teste(s) unitário(s)` +
      `${executar ? ` executado(s) (${[...resultados.values()].filter((r) => r === 'passou').length} passaram)` : ''}; ` +
      `${achados.length} achado(s) → ${ok ? 'verde' : 'VERMELHO'} (dist/sbis/matriz-rastreabilidade.md)`,
  );
  return ok ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(principal());
