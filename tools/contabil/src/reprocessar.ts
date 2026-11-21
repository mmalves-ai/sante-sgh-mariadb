// `pnpm contabil:reprocessar -- --cliente=<banco> --estabelecimento=<id> --periodo=AAAA-MM` (M54.1; ficha, regra 2 e
// critério de aceite): lê os fatos da competência, o plano, o de-para da exportação e as regras publicadas DUAS vezes
// (duas leituras independentes), aplica as regras em cada leitura e compara os lançamentos gerados: "idêntico" quando a
// segunda execução dá os mesmos lançamentos da primeira (mesma chave, partidas, valores, centros de custo, históricos e
// data) e quando a derivação dá as mesmas partidas dos lançamentos GRAVADOS dos fatos contabilizados. Só leitura: nada
// é gravado (a gravação das situações é a da tela, com a senha). Imprime só contagens e totais.
// Saídas (SAIDA): 0 idêntico; 1 diferente; 2 acima do teto (não conferido); 3 sem fatos na competência (nada a conferir:
// nunca "idêntico"); 64 uso errado ou estabelecimento inexistente no cliente; 69 operação indisponível no banco do
// cliente (modelo pendente); 70 erro inesperado.
// SITUAÇÃO (2026-11-21): INDISPONÍVEL. A porta da tela recusa a leitura das regras publicadas com "modelo-pendente"
//   (PortaContabilPropria.regras: falta o modelo das versões de regra de contabilização no banco do cliente; pedido
//   registrado nos lotes da contabilidade). Até essa migração, a ferramenta sai com 69 e a mensagem da operação.
// Melhoria: lê o banco próprio do cliente pela MESMA porta da tela (PortaContabilPropria), sem SQL repetido na
//   ferramenta; a leitura do período (`lerPeriodo`) é uma função testável com dublê.
// Melhoria: no banco próprio a empresa contábil é o estabelecimento (sai `--empresa`, que separado do estabelecimento
//   fazia a porta ler zero fatos e a conferência dar um falso "idêntico"); o estabelecimento é conferido no banco do
//   cliente antes da leitura (existente e não excluído); zero fatos lidos é "sem fatos", com saída própria.
import { conferirExecucoes, type LeituraDoPeriodo, type ResultadoConferencia } from '@sgh/dominio-contabil';
import { type ContextoNucleo, FORMATO_NOME_BANCO, NucleoProprio } from '@sgh/nucleo';

// A conferência é a do domínio (a mesma da tela); reexportada para o teste e quem já a usava daqui.
export {
  aplicarLeitura,
  conferirExecucoes,
  type LeituraDoPeriodo,
  type ResultadoConferencia,
} from '@sgh/dominio-contabil';

/** Códigos de saída da ferramenta (ver o cabeçalho). */
export const SAIDA = {
  identico: 0,
  diferente: 1,
  parcial: 2,
  semFatos: 3,
  uso: 64,
  indisponivel: 69,
  erro: 70,
} as const;

/** O mesmo teto da conferência da API (TETO_FATOS_COMPETENCIA). */
export const TETO_FATOS = 20_000;

/** Contexto da leitura: o do núcleo (cliente, estabelecimento) mais os campos que o contexto da contabilidade pede. */
export interface ContextoReprocessamento extends ContextoNucleo {
  readonly rede: string;
  readonly hospital: string;
}

type Fato = LeituraDoPeriodo['fatos'][number] & {
  readonly idFato: number;
  readonly situacao?: string;
  readonly estorno?: boolean;
};

/** O pedaço da porta da contabilidade que a conferência lê (a PortaContabilPropria o implementa). */
export interface FonteDoPeriodo {
  fatosDaCompetencia(
    c: ContextoReprocessamento,
    empresa: number,
    competencia: string,
    teto: number,
  ): Promise<readonly Fato[]>;
  plano(c: ContextoReprocessamento, empresa: number): Promise<LeituraDoPeriodo['plano']>;
  dePara(c: ContextoReprocessamento, empresa: number): Promise<LeituraDoPeriodo['dePara']>;
  regras(
    c: ContextoReprocessamento,
    empresa: number,
    filtro: Record<string, never>,
  ): Promise<readonly { readonly regra: LeituraDoPeriodo['regras'][number] }[]>;
  lancamentosDosFatos(
    c: ContextoReprocessamento,
    idsFato: readonly number[],
  ): Promise<NonNullable<LeituraDoPeriodo['gravados']>>;
}

/**
 * Uma leitura do período: os fatos até o teto (`parcial` quando passa), o plano, o de-para, as regras publicadas e os
 * lançamentos gravados dos fatos contabilizados (sem os estornos), como a tela faz.
 */
export async function lerPeriodo(
  fonte: FonteDoPeriodo,
  c: ContextoReprocessamento,
  empresa: number,
  competencia: string,
  teto: number = TETO_FATOS,
): Promise<LeituraDoPeriodo> {
  const [lidos, plano, dePara, publicadas] = await Promise.all([
    fonte.fatosDaCompetencia(c, empresa, competencia, teto + 1),
    fonte.plano(c, empresa),
    fonte.dePara(c, empresa),
    fonte.regras(c, empresa, {}),
  ]);
  const parcial = lidos.length > teto;
  const fatos = lidos.slice(0, teto);
  const gravados = await fonte.lancamentosDosFatos(
    c,
    fatos.filter((f) => f.situacao === 'contabilizado' && !f.estorno).map((f) => f.idFato),
  );
  return { fatos, plano, dePara, regras: publicadas.map((p) => p.regra), parcial, gravados };
}

export function opcoesDe(argv: readonly string[]): Record<string, string> {
  const o: Record<string, string> = {};
  for (const a of argv) {
    const m = /^--([a-z][a-z0-9-]*)=(.*)$/.exec(a);
    if (m?.[1] && m[2] !== undefined) o[m[1]] = m[2];
  }
  return o;
}

/** Entrada da linha de comando, conferida (nada vai ao banco sem passar por aqui). A empresa contábil é o estabelecimento. */
export interface PedidoReprocessamento {
  readonly cliente: string;
  readonly estabelecimento: number;
  readonly periodo: string;
}

export function pedidoDe(o: Readonly<Record<string, string>>): PedidoReprocessamento | string {
  const periodo = o['periodo'] ?? '';
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(periodo)) return 'periodo inválido (use AAAA-MM)';
  const cliente = o['cliente'] ?? '';
  if (!FORMATO_NOME_BANCO.test(cliente)) return 'cliente inválido (o código do banco do cliente)';
  const estabelecimento = Number(o['estabelecimento']);
  if (!Number.isSafeInteger(estabelecimento) || estabelecimento <= 0) return 'estabelecimento inválido (o id)';
  if (o['empresa'] !== undefined) return 'empresa não se informa: no banco próprio a empresa contábil é o estabelecimento';
  return { cliente, estabelecimento, periodo };
}

/** O código de saída de uma conferência: zero fatos nunca é "idêntico" (não houve o que conferir). */
export function saidaDe(r: ResultadoConferencia): number {
  if (r.fatos === 0 && !r.parcial) return SAIDA.semFatos;
  return r.identico ? SAIDA.identico : r.parcial ? SAIDA.parcial : SAIDA.diferente;
}

const ROTULO_SAIDA: Readonly<Record<number, string>> = {
  [SAIDA.identico]: 'IDÊNTICO',
  [SAIDA.diferente]: 'DIFERENTE',
  [SAIDA.parcial]: 'NÃO CONFERIDO (parcial)',
  [SAIDA.semFatos]: 'SEM FATOS (nada a conferir)',
};

/** Linha do relatório (só contagens e totais em centavos com as parcelas). */
export function relatorio(rotulo: string, estabelecimento: number, periodo: string, r: ResultadoConferencia): string {
  const t = (x: { debitos: number; creditos: number }) => `D ${x.debitos} = C ${x.creditos}`;
  return [
    `[${rotulo}] estabelecimento ${estabelecimento}, competência ${periodo}: ${r.fatos} fatos${r.parcial ? ' (parcial: acima do teto)' : ''}`,
    `  lançamentos: 1ª ${r.lancamentos.primeira}, 2ª ${r.lancamentos.segunda}; iguais ${r.iguais}, diferentes ${r.diferentes}`,
    `  totais (centavos): 1ª ${t(r.totais.primeira)}; 2ª ${t(r.totais.segunda)}`,
    ...(r.gravado
      ? [
          `  frente ao gravado: ${r.gravado.comparados} fatos contabilizados; iguais ${r.gravado.iguais}, diferentes ${r.gravado.diferentes}, sem lançamento ${r.gravado.semLancamento}`,
        ]
      : []),
    `  resultado: ${ROTULO_SAIDA[saidaDe(r)]}`,
  ].join('\n');
}

/** Contexto de leitura de um pedido (sem usuário: processo de conferência, só leitura). */
export function contextoDe(p: Pick<PedidoReprocessamento, 'cliente' | 'estabelecimento'>): ContextoReprocessamento {
  return {
    cliente: p.cliente,
    estabelecimento: p.estabelecimento,
    usuario: null,
    correlacao: 'contabil-reprocessar',
    rede: p.cliente,
    hospital: String(p.estabelecimento),
  };
}

/**
 * O fonte da porta da tela. A API usa decoradores e propriedades de parâmetro: a ferramenta roda num executor de
 * TypeScript completo (o mesmo transformador dos testes), não no modo só de remoção de tipos do node.
 */
export const PORTA_DA_TELA = new URL('../../../apps/api/src/modulos/contabil/porta-propria.ts', import.meta.url).href;

/** A porta da tela, carregada na hora (o caminho não entra no grafo do compilador da ferramenta). */
export async function fonteDoBanco(nucleo: NucleoProprio, caminho: string = PORTA_DA_TELA): Promise<FonteDoPeriodo> {
  const m = (await import(caminho).catch((e: unknown) => {
    throw new Error(`Porta da contabilidade não carregada (${caminho}); rode a ferramenta num executor de TypeScript completo.`, { cause: e });
  })) as {
    PortaContabilPropria: new (n: NucleoProprio) => FonteDoPeriodo;
  };
  return new m.PortaContabilPropria(nucleo);
}

/** O que a conferência precisa do núcleo: só a leitura (para conferir o estabelecimento). */
export type NucleoDaConferencia = Pick<NucleoProprio, 'lerSomente'>;

/** O estabelecimento existe e não foi excluído no banco do cliente? */
export async function estabelecimentoExiste(nucleo: NucleoDaConferencia, p: PedidoReprocessamento): Promise<boolean> {
  const linha = await nucleo.lerSomente({ cliente: p.cliente, correlacao: 'contabil-reprocessar' }, (l) =>
    l.uma('SELECT id FROM estabelecimento WHERE id = ? AND excluido_em IS NULL', [p.estabelecimento]),
  );
  return linha !== null && linha !== undefined;
}

/** O código do problema de um erro da porta (ErroOperacao do núcleo; conferido pela forma, a porta é carregada à parte). */
export function codigoDoProblema(e: unknown): string | null {
  const c = (e as { problema?: { codigo?: unknown } } | null)?.problema?.codigo;
  return typeof c === 'string' ? c : null;
}

/** Resultado de uma execução: o código de saída e as linhas (só contagens e mensagens de operação). */
export interface ExecucaoReprocessamento {
  readonly saida: number;
  readonly texto: string;
}

/**
 * Uma execução completa: confere o estabelecimento no banco do cliente, lê o período duas vezes pela porta e compara.
 * A operação indisponível no banco do cliente ("modelo-pendente") sai com 69 e a mensagem da porta.
 */
export async function reprocessar(
  nucleo: NucleoDaConferencia,
  fonte: FonteDoPeriodo,
  p: PedidoReprocessamento,
): Promise<ExecucaoReprocessamento> {
  if (!(await estabelecimentoExiste(nucleo, p)))
    return { saida: SAIDA.uso, texto: `estabelecimento ${p.estabelecimento} não existe (ou está excluído) no cliente ${p.cliente}` };
  const c = contextoDe(p);
  try {
    const primeira = await lerPeriodo(fonte, c, p.estabelecimento, p.periodo);
    const segunda = await lerPeriodo(fonte, c, p.estabelecimento, p.periodo);
    const r = conferirExecucoes(primeira, segunda);
    return { saida: saidaDe(r), texto: relatorio(`${p.cliente}/${p.estabelecimento}`, p.estabelecimento, p.periodo, r) };
  } catch (e) {
    if (codigoDoProblema(e) !== 'modelo-pendente') throw e;
    const detalhe = (e as { problema?: { detail?: unknown } }).problema?.detail;
    return {
      saida: SAIDA.indisponivel,
      texto: `conferência indisponível no banco do cliente: ${typeof detalhe === 'string' ? detalhe : 'modelo pendente'}`,
    };
  }
}

async function principal(argv: readonly string[]): Promise<number> {
  const p = pedidoDe(opcoesDe(argv));
  if (typeof p === 'string') {
    console.error(`${p}. Uso: pnpm contabil:reprocessar -- --cliente=<banco> --estabelecimento=<id> --periodo=AAAA-MM`);
    return SAIDA.uso;
  }
  const nucleo = new NucleoProprio();
  try {
    const r = await reprocessar(nucleo, await fonteDoBanco(nucleo), p);
    (r.saida === SAIDA.uso || r.saida === SAIDA.indisponivel ? console.error : console.log)(r.texto);
    return r.saida;
  } finally {
    await nucleo.encerrar();
  }
}

if (import.meta.main) {
  principal(process.argv.slice(2)).then(
    (c) => process.exit(c),
    (e: unknown) => {
      console.error(`[contabil:reprocessar] ${e instanceof Error ? `${e.name}: ${e.message}` : 'erro'}`);
      process.exit(SAIDA.erro);
    },
  );
}
