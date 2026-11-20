// Ciclo da leitura incremental dos fatos contábeis (M54.1; ficha, regra 1 e seção 4 "Fatos contábeis novos"): por
// fonte, lê as linhas novas acima da marca, a janela de revisão atrás dela (commits fora de ordem e linhas alteradas) e
// uma faixa da varredura em rodízio (linhas antigas alteradas); concilia cada linha com os fatos ATIVOS já registrados
// (D-CONCILIA-541: o que mudou vira estorno + fato novo; o que voltou ao que era ganha a impressão da ocorrência,
// D-REOCORRE-541) e grava os fatos, o estado da fonte (versão otimista: dois ciclos ao mesmo tempo, o segundo recusa) e
// o evento `contabil.fatos.lidos` (com a diferença em contagens), tudo numa transação SGH_ (o adaptador do legado:
// `acessoCicloFatos`). Nenhuma escrita fora de SGH_ (regra 1): a leitura das fontes
// é só SELECT. O acesso ao banco é injetado (a unidade usa memória; a integração, a cópia com ROLLBACK).
import { type FatoContabil, FOLGA_REVISAO_PADRAO, LOTE_FATOS_PADRAO, type LinhaFonte } from '@sgh/contratos';
import { conciliarFatos } from './derivacao.js';
import {
  estadoDepoisDoCiclo,
  type EstadoFonte,
  type OpcoesCiclo,
  type PlanoCiclo,
  planoDoCiclo,
} from './fatos.js';
import { DERIVADORES } from './fontes.js';
import { fatosAtivos, fatosParaGravar } from './registro.js';

/** Teto de chaves por leitura de faixa (o mesmo da leitura do banco, TETO_LOTE_FATOS). */
export const TETO_FAIXA = 2_000;

export const OPCOES_PADRAO: OpcoesCiclo = {
  lote: LOTE_FATOS_PADRAO,
  folga: FOLGA_REVISAO_PADRAO,
  faixaVarredura: TETO_FAIXA,
};

export interface EstadoFonteVisto {
  readonly marca: number;
  readonly varredura: number;
  /** Versão lida (null: a fonte ainda não tem linha de estado). */
  readonly versao: number | null;
}

export interface ResumoCiclo {
  readonly tabela: string;
  readonly plano: PlanoCiclo;
  readonly lidosNovos: number;
  readonly lidosRevisao: number;
  readonly lidosVarredura: number;
  /** Linhas já conhecidas cujo efeito contábil mudou (geraram estorno ou fato novo). */
  readonly lidosAlterados: number;
  readonly fatosNovos: number;
  readonly estornos: number;
  readonly gravados: number;
  readonly repetidos: number;
  readonly marca: number;
  readonly varredura: number;
}

/** O que o ciclo precisa do banco (cada operação numa transação: leitura curta ou a gravação SGH_). */
export interface AcessoCiclo {
  estado(tabela: string): Promise<EstadoFonteVisto | null>;
  lerNovos(tabela: string, acimaDe: number, lote: number): Promise<LinhaFonte[]>;
  lerFaixa(tabela: string, de: number, ate: number): Promise<LinhaFonte[]>;
  registrados(tabela: string, chaves: readonly number[]): Promise<FatoContabil[]>;
  gravar(g: {
    readonly tabela: string;
    readonly fatos: readonly FatoContabil[];
    readonly estado: EstadoFonte;
    readonly versaoVista: number | null;
    readonly resumo: Omit<ResumoCiclo, 'gravados' | 'repetidos'>;
    /** A diferença do evento, com os gravados (diferencaDoCiclo). */
    readonly diferenca: (gravados: number) => string;
  }): Promise<{ gravados: number; repetidos: number }>;
}

/** Lê uma faixa fechada em pedaços de até TETO_FAIXA chaves (a leitura do banco nunca passa do teto). */
export async function lerFaixaInteira(
  a: Pick<AcessoCiclo, 'lerFaixa'>,
  tabela: string,
  faixa: { de: number; ate: number } | null,
): Promise<LinhaFonte[]> {
  if (!faixa) return [];
  const r: LinhaFonte[] = [];
  for (let de = faixa.de; de <= faixa.ate; de += TETO_FAIXA)
    r.push(...(await a.lerFaixa(tabela, de, Math.min(faixa.ate, de + TETO_FAIXA - 1))));
  return r;
}

/** As linhas do ciclo sem repetição (a mesma chave lida em duas leituras vale a última lida). */
export function linhasUnicas(...grupos: readonly (readonly LinhaFonte[])[]): LinhaFonte[] {
  const m = new Map<number, LinhaFonte>();
  for (const g of grupos) for (const l of g) m.set(l.id, l);
  return [...m.values()].sort((x, y) => x.id - y.id);
}

/**
 * Os fatos que o lote gera contra os já registrados: a conciliação por linha (só os ativos contam) e a impressão sem
 * colisão. Puro: a unidade e a integração conferem o mesmo cálculo.
 */
export function fatosDoLote(
  tabela: string,
  linhas: readonly LinhaFonte[],
  registrados: readonly FatoContabil[],
  contexto: { empresa: number },
  hoje: string,
): { fatos: FatoContabil[]; alteradas: number } {
  const derivar = DERIVADORES[tabela];
  if (!derivar) throw new RangeError(`Fonte sem derivação: ${tabela}`);
  const ativos = fatosAtivos(registrados);
  const conhecidas = new Set(registrados.map((f) => f.id));
  const porLinha = new Map<number, FatoContabil[]>();
  for (const f of ativos) {
    const l = porLinha.get(f.id) ?? [];
    l.push(f);
    porLinha.set(f.id, l);
  }
  const novos: FatoContabil[] = [];
  let alteradas = 0;
  for (const l of linhas) {
    const r = conciliarFatos(l, derivar, porLinha.get(l.id) ?? [], contexto, hoje);
    if (r.length && conhecidas.has(l.id)) alteradas += 1;
    novos.push(...r);
  }
  return { fatos: fatosParaGravar(novos, registrados), alteradas };
}

/** Um ciclo de uma fonte: ler, conciliar e gravar (fatos + estado + evento na mesma transação). */
export async function cicloDaFonte(
  a: AcessoCiclo,
  tabela: string,
  c: { empresa: number; hoje: string; opcoes?: OpcoesCiclo },
): Promise<ResumoCiclo> {
  const visto = await a.estado(tabela);
  const estado: EstadoFonte = { tabela, marca: visto?.marca ?? 0, varredura: visto?.varredura ?? 1 };
  const plano = planoDoCiclo(estado, c.opcoes ?? OPCOES_PADRAO);
  const novos = await a.lerNovos(tabela, plano.novos.acimaDe, plano.novos.lote);
  const revisao = await lerFaixaInteira(a, tabela, plano.revisao);
  const varredura = await lerFaixaInteira(a, tabela, plano.varredura);
  const linhas = linhasUnicas(varredura, revisao, novos);
  const registrados = linhas.length
    ? await a.registrados(
        tabela,
        linhas.map((l) => l.id),
      )
    : [];
  const { fatos, alteradas } = fatosDoLote(tabela, linhas, registrados, { empresa: c.empresa }, c.hoje);
  const depois = estadoDepoisDoCiclo(
    estado,
    plano,
    novos.map((l) => l.id),
  );
  const resumo = {
    tabela,
    plano,
    lidosNovos: novos.length,
    lidosRevisao: revisao.length,
    lidosVarredura: varredura.length,
    lidosAlterados: alteradas,
    fatosNovos: fatos.filter((f) => !f.estorno).length,
    estornos: fatos.filter((f) => f.estorno).length,
    marca: depois.marca,
    varredura: depois.varredura,
  };
  const g = await a.gravar({
    tabela,
    fatos,
    estado: depois,
    versaoVista: visto?.versao ?? null,
    resumo,
    diferenca: (gravados) => diferencaDoCiclo(resumo, gravados),
  });
  return { ...resumo, ...g };
}

/** A diferença do evento `contabil.fatos.lidos` (só contagens e faixas de chaves; nunca dado da linha). */
export function diferencaDoCiclo(r: Omit<ResumoCiclo, 'gravados' | 'repetidos'>, gravados: number): string {
  const faixa = (f: { de: number; ate: number } | null) => (f ? `${f.de}-${f.ate}` : '-');
  return [
    `fonte=${r.tabela}`,
    `novos=${r.lidosNovos}`,
    `acima=${r.plano.novos.acimaDe}`,
    `revisao=${faixa(r.plano.revisao)}`,
    `varredura=${faixa(r.plano.varredura)}`,
    `alterados=${r.lidosAlterados}`,
    `fatos=${r.fatosNovos}`,
    `estornos=${r.estornos}`,
    `gravados=${gravados}`,
    `marca=${r.marca}`,
  ].join(';');
}
