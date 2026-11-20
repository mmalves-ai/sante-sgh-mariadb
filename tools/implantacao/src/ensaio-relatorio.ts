// M60, etapa 1: peças puras do orquestrador do ensaio (ensaio.ts). Os comandos das sessões que simulam o
// sistema anterior em uso, a impressão completa (legada + objetos SGH_ + privilégios), a conferência do disco
// e o relatório em Markdown (docs/marcos/M60/ensaio-primeira-aplicacao.md). Saída só com contagens, tempos e
// nomes de objeto; nunca dado de linha.
import { createHash } from 'node:crypto';
import {
  type AvaliacaoEsperas,
  type Contagens,
  type Criterio,
  contagemPublica,
  LIMITE_ESPERA_TRAVA_MS,
} from './ensaio-regras.ts';

/**
 * Tabelas legadas mais usadas pelo produto (contagem das consultas de @sgh/legado): as sessões do ensaio leem e
 * travam linhas delas, e as contagens antes e depois são comparadas.
 */
export const TABELAS_DAS_SESSOES = [
  'RICADPAC',
  'RICADINT',
  'RECADATE',
  'ATCABECATEND',
  'FCCTAEXT',
  'FCLANEXT',
  'TBCONVEN',
  'TBUSERS',
  'TBCBOPRO',
  'SILANEXA',
  'PRCHKGERAL',
  'PRCABEVOL',
] as const;

const NOME_LEGADO = /^[A-Z][A-Z0-9_$]{0,30}$/;

function nomeSeguro(t: string): string {
  if (!NOME_LEGADO.test(t) || t.startsWith('SGH_')) throw new Error(`Nome de tabela legada inválido: ${t}`);
  return t;
}

/** Leitura de uma sessão: até 200 linhas de uma tabela (só a contagem volta). */
export function sqlLeitura(tabela: string, salto: number): string {
  return `SELECT COUNT(*) N FROM (SELECT FIRST 200 SKIP ${Math.max(0, Math.trunc(salto))} 1 X FROM ${nomeSeguro(tabela)}) D`;
}

/**
 * Gravação de uma sessão, como a edição do sistema anterior: trava uma linha (SELECT ... WITH LOCK, que não
 * dispara trigger) dentro de uma transação de escrita com LOCK TIMEOUT igual ao limite; sempre desfeita.
 */
export function sqlTrava(tabela: string, salto: number): string {
  return `SELECT FIRST 1 SKIP ${Math.max(0, Math.trunc(salto))} 1 X FROM ${nomeSeguro(tabela)} WITH LOCK`;
}

/**
 * Gravação real (UPDATE da chave no mesmo valor), só em tabela sem trigger nenhum (nada dispara: nem as saídas
 * externas da cópia); sempre desfeita.
 */
export function sqlAtualizacao(tabela: string, chave: string, salto: number): string {
  const c = nomeSeguro(chave);
  const t = nomeSeguro(tabela);
  return `UPDATE ${t} SET ${c} = ${c} WHERE ${c} = (SELECT FIRST 1 SKIP ${Math.max(0, Math.trunc(salto))} ${c} FROM ${t} ORDER BY ${c})`;
}

/** Comandos ativos das sessões legadas e há quanto tempo (MON$), numa transação nova por amostra. */
export function sqlMon(anexos: readonly number[]): string {
  const ids = anexos.map((n) => {
    if (!Number.isInteger(n) || n < 0) throw new Error('Identificador de conexão inválido.');
    return String(n);
  });
  if (ids.length === 0) throw new Error('Sem conexão legada para amostrar.');
  return `SELECT COUNT(*) N, MAX(DATEDIFF(MILLISECOND FROM S.MON$TIMESTAMP TO CURRENT_TIMESTAMP)) MS
    FROM MON$STATEMENTS S WHERE S.MON$STATE IN (1, 2) AND S.MON$ATTACHMENT_ID IN (${ids.join(', ')})`;
}

export interface PartesImpressaoCompleta {
  /** Resumo da impressão digital da parte legada (schema:verificar). */
  readonly legado: string;
  /** Objetos SGH_ do catálogo (lerObjetosSgh), já ordenados. */
  readonly objetosSgh: unknown;
  /** Contagens do catálogo que um recolhimento incompleto deixaria diferentes. */
  readonly catalogo: Readonly<Record<string, number>>;
}

/** Impressão do banco inteiro: a legada, os objetos SGH_ e as contagens de privilégios, índices e papéis. */
export function impressaoCompleta(p: PartesImpressaoCompleta): string {
  const catalogo = Object.keys(p.catalogo)
    .sort()
    .map((k) => `${k}=${p.catalogo[k]}`)
    .join(';');
  return createHash('sha256')
    .update(`${p.legado}\n${JSON.stringify(p.objetosSgh)}\n${catalogo}`)
    .digest('hex');
}

/** O que difere entre duas impressões completas (para o relatório): só nomes de parte e contagens. */
export function diferencasDasPartes(a: PartesImpressaoCompleta, b: PartesImpressaoCompleta): string[] {
  const d: string[] = [];
  if (a.legado !== b.legado) d.push('impressão legada');
  if (JSON.stringify(a.objetosSgh) !== JSON.stringify(b.objetosSgh)) d.push('objetos SGH_');
  for (const k of [...new Set([...Object.keys(a.catalogo), ...Object.keys(b.catalogo)])].sort()) {
    if (a.catalogo[k] !== b.catalogo[k]) d.push(`${k} ${a.catalogo[k] ?? '-'} → ${b.catalogo[k] ?? '-'}`);
  }
  return d;
}

/** O disco precisa caber a cópia da matriz e uma folga (o banco cresce com os índices e o recolhimento). */
export function conferirEspaco(livreBytes: number, matrizBytes: number, folgaBytes = 10 * 2 ** 30): void {
  if (livreBytes < matrizBytes + folgaBytes) {
    const gb = (b: number) => (b / 2 ** 30).toFixed(1);
    throw new Error(
      `Disco insuficiente para a cópia limpa: ${gb(livreBytes)} GB livres, precisa de ${gb(matrizBytes + folgaBytes)} GB.`,
    );
  }
}

export interface TempoScript {
  readonly numero: number;
  readonly arquivo: string;
  readonly ms: number;
  readonly situacao: string;
}

export interface ResultadoEnsaio {
  readonly inicio: string;
  readonly porta: number;
  readonly matriz: string;
  readonly sessoes: number;
  readonly tabelasAtualizadas: readonly string[];
  readonly etapasMs: Readonly<Record<string, number>>;
  readonly tempos: readonly TempoScript[];
  readonly totalMs: number;
  readonly objetosSghDepoisDaAplicacao: number;
  readonly comandosDoRecolhimento: number;
  readonly recolhimentoMs: number;
  /** Partes da impressão completa que o recolhimento não devolveu (vazio = estado inicial). */
  readonly diferencasDoRecolhimento?: readonly string[];
  /** Linhas de privilégio de domínio implícito que o Firebird 3 deixa sem objeto no DROP TABLE. */
  readonly privilegiosOrfaosDeDominio?: number;
  readonly contagensAntes: Contagens;
  readonly contagensDepois: Contagens;
  readonly esperas: AvaliacaoEsperas;
  readonly mon: { readonly amostras: number; readonly maiorParadoMs: number; readonly ok: boolean };
  readonly veredito: { readonly ok: boolean; readonly criterios: readonly Criterio[] };
  /** M60.1: os relatórios JSON do próprio `sgh:aplicar` (simulação, aplicação, recolhimento), pelo caminho. */
  readonly relatoriosCli?: readonly string[];
  readonly erro?: string;
}

const ms = (n: number) => `${Math.round(n)} ms`;

/** O relatório do ensaio em Markdown (tempos por script, critérios e contagens com a regra do <5). */
export function formatarRelatorioEnsaio(r: ResultadoEnsaio): string {
  const l: string[] = [];
  l.push('# M60: ensaio da primeira aplicação dos scripts SGH_', '');
  l.push(
    'Gerado por `pnpm implantacao:ensaio` (tools/implantacao/src/ensaio.ts). Cópia limpa do banco atual numa porta',
    'própria, criada a partir da matriz de `../banco-dev` e apagada no fim; as cópias compartilhadas (3351 e 3352)',
    'não são tocadas. Só contagens, tempos e nomes de objeto.',
    '',
  );
  l.push(`- Início: ${r.inicio}`);
  l.push(`- Porta da cópia: ${r.porta}; matriz: \`${r.matriz}\``);
  l.push(
    `- Sessões que simulam o sistema anterior em uso: ${r.sessoes} (leitura, trava de linha WITH LOCK e UPDATE ` +
      `no mesmo valor nas tabelas sem trigger: ${r.tabelasAtualizadas.join(', ') || 'nenhuma'}; sempre desfeitas; ` +
      `LOCK TIMEOUT ${LIMITE_ESPERA_TRAVA_MS / 1000} s)`,
  );
  l.push(`- Limite de espera de trava (POL-5): ${LIMITE_ESPERA_TRAVA_MS} ms`);
  l.push(`- Veredito: **${r.veredito.ok ? 'APROVADO' : 'REPROVADO'}**`);
  if (r.erro) l.push(`- Erro: ${r.erro}`);
  l.push('', '## Critérios de aceite', '', '| Critério | Resultado | Detalhe |', '|---|---|---|');
  for (const c of r.veredito.criterios) l.push(`| ${c.nome} | ${c.ok ? 'ok' : 'FALHOU'} | ${c.detalhe} |`);
  l.push('', '## Etapas', '', '| Etapa | Tempo |', '|---|---|');
  for (const [k, v] of Object.entries(r.etapasMs)) l.push(`| ${k} | ${ms(v)} |`);
  l.push('', '## Aplicação', '');
  l.push(
    `${r.tempos.length} script(s) em ${ms(r.totalMs)}; ${r.objetosSghDepoisDaAplicacao} objeto(s) SGH_ ` +
      `(tabelas, visões, sequências e papéis) depois da aplicação.`,
  );
  const lentos = [...r.tempos].sort((a, b) => b.ms - a.ms).slice(0, 10);
  if (lentos.length > 0) {
    l.push('', 'Os 10 scripts mais lentos:', '', '| Nº | Script | Tempo |', '|---|---|---|');
    for (const t of lentos) l.push(`| ${String(t.numero).padStart(4, '0')} | ${t.arquivo} | ${ms(t.ms)} |`);
  }
  l.push('', '## Sessões legadas', '');
  l.push(
    `${r.esperas.operacoes} operação(ões); maior ${ms(r.esperas.maiorMs)}; ${r.esperas.acimaDoLimite} acima do limite; ` +
      `${r.esperas.comErro} com erro. MON$: ${r.mon.amostras} amostra(s), maior comando ativo das sessões ` +
      `${ms(r.mon.maiorParadoMs)}.`,
  );
  const todas = Object.keys(r.contagensAntes);
  const mudaram = todas.filter((t) => r.contagensAntes[t] !== r.contagensDepois[t]);
  l.push(
    '',
    '## Contagens das tabelas legadas',
    '',
    `${todas.length} tabela(s) legada(s) contadas antes e depois da aplicação (todas as persistentes de usuário: ` +
      `sem visões, tabelas externas, temporárias nem SGH_); ${mudaram.length} diferente(s). Abaixo, as das ` +
      'sessões e as que mudaram:',
    '',
    '| Tabela | Antes | Depois |',
    '|---|---|---|',
  );
  const mostrar = new Set<string>([...TABELAS_DAS_SESSOES, ...r.tabelasAtualizadas, ...mudaram]);
  for (const t of todas.filter((x) => mostrar.has(x)).sort()) {
    const a = r.contagensAntes[t];
    const d = r.contagensDepois[t];
    l.push(
      `| ${t} | ${a === undefined ? '-' : contagemPublica(a)} | ${d === undefined ? '-' : contagemPublica(d)} |`,
    );
  }
  if (r.relatoriosCli?.length) {
    l.push(
      '',
      '## Relatórios do sgh:aplicar',
      '',
      'Simulação, aplicação e recolhimento rodados pelo próprio `pnpm sgh:aplicar` (com `--simular`, `--relatorio` e ' +
        '`--recolher`), com uma conta da aplicação e uma de leitura sintéticas criadas só na cópia descartável:',
      '',
      ...r.relatoriosCli.map((a) => `- \`${a}\``),
    );
  }
  l.push('', '## Recolhimento', '');
  l.push(`${r.comandosDoRecolhimento} comando(s) em ordem reversa, em ${ms(r.recolhimentoMs)}.`);
  if (r.privilegiosOrfaosDeDominio) {
    l.push(
      '',
      `O Firebird 3 deixou ${r.privilegiosOrfaosDeDominio} linha(s) de privilégio USAGE do dono em domínios implícitos ` +
        '(RDB$n, um por coluna) já apagados com as tabelas: sem objeto e sem efeito, fora da parte legada; o Firebird 3 ' +
        'não tem como revogar o uso de domínio. Ficam fora da impressão completa (contadas aqui).',
    );
  }
  if (r.diferencasDoRecolhimento?.length) {
    l.push('', `Diferenças em relação ao antes: ${r.diferencasDoRecolhimento.join('; ')}.`);
  }
  l.push('', '## Tempo por script', '', '| Nº | Script | Tempo | Situação |', '|---|---|---|---|');
  for (const t of r.tempos) {
    l.push(`| ${String(t.numero).padStart(4, '0')} | ${t.arquivo} | ${ms(t.ms)} | ${t.situacao} |`);
  }
  l.push('');
  return l.join('\n');
}
