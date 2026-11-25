// Taxa de comercialização do consignado por faixa de valor (05-SUP linha 24), sobre o MariaDB do cliente pelo Executor
// do núcleo (trilha na mesma transação, versão conferida, Idempotency-Key honrada). A regra pura mora em
// `@sgh/contratos/regras-suprimentos` (consignado-taxa); aqui ficam a leitura das tabelas, o cálculo pela tabela vigente
// e a gravação da tabela nova. Nada é apagado: a tabela nova fecha a vigente do mesmo escopo (fornecedor ou geral) na
// véspera do início dela, e o histórico fica na tela.
import {
  calcularTaxaConsignacao,
  type CalculoTaxaConsignacao,
  type FaixaTaxaConsignacao,
  planejarTabelaTaxaConsignacao,
  type RecusaSuprimentos,
  type TabelaTaxaConsignacaoEntrada,
  tabelaTaxaVigente,
} from '@sgh/contratos/regras-suprimentos';
import {
  type ContextoNucleo,
  type ContextoOperacao,
  definirOperacao,
  type Executor,
  type Leitor,
  type Linha,
  type NucleoProprio,
  recusa,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';
import { ErroProblema } from '../../problema.filter.js';
import type { ContextoPortaM18 } from '../exames/public-api.js';

export const PORTA_TAXA_CONSIGNACAO = Symbol('PORTA_TAXA_CONSIGNACAO');
export const TABELAS_TAXA_CONSIGNACAO = ['faixa_taxa_consignacao'] as const;
export const OPERACAO_TAXA_CONSIGNACAO = 'suprimentos.consignado.gravar-tabela-taxa';

export interface TabelasTaxaConsignacao {
  readonly hoje: string;
  readonly fornecedor: number | null;
  /** As faixas que valem hoje para o fornecedor (as dele ou, sem tabela própria, as gerais). */
  readonly vigentes: readonly FaixaTaxaConsignacao[];
  readonly origem: 'fornecedor' | 'geral' | 'sem-tabela';
  /** Todas as faixas do escopo pedido e da geral, da mais nova à mais antiga (o histórico nunca some). */
  readonly historico: readonly FaixaTaxaConsignacao[];
}

export interface PortaTaxaConsignacao {
  readonly destino: 'banco' | 'indisponivel';
  tabelas(c: ContextoPortaM18, fornecedor: number | null): Promise<TabelasTaxaConsignacao>;
  calcular(
    c: ContextoPortaM18,
    fornecedor: number | null,
    valor: number,
    data: string | null,
  ): Promise<CalculoTaxaConsignacao & { readonly data: string }>;
  gravar(c: ContextoPortaM18, e: TabelaTaxaConsignacaoEntrada, chave: string): Promise<{ ids: number[] }>;
}

export function portaTaxaConsignacaoIndisponivel(): PortaTaxaConsignacao {
  const falha = (): never => {
    throw new ErroProblema('indisponivel', 503, 'A taxa do consignado exige o banco próprio.');
  };
  return { destino: 'indisponivel', tabelas: falha, calcular: falha, gravar: falha };
}

const n = (v: unknown) => Number(v ?? 0);
const nn = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const dataIso = (v: unknown): string =>
  v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : '';

const faixaDe = (r: Linha): FaixaTaxaConsignacao => ({
  id: n(r['id']),
  fornecedor: nn(r['empresa_fornecedora_id']),
  valorInicial: n(r['valor_inicial']),
  valorFinal: nn(r['valor_final']),
  percentual: n(r['percentual']),
  teto: nn(r['teto_cobranca']),
  inicio: dataIso(r['vigencia_inicio']),
  fim: r['vigencia_fim'] ? dataIso(r['vigencia_fim']) : null,
});

/** As faixas por fornecedor da taxa ficam na tabela sem fonte pagadora nem item de cobrança (escopo da tela). */
const SQL_FAIXAS = `SELECT id, versao, empresa_fornecedora_id, valor_inicial, valor_final, percentual, teto_cobranca,
    vigencia_inicio, vigencia_fim
   FROM faixa_taxa_consignacao
  WHERE estabelecimento_id = ? AND ativo AND fonte_pagadora_id IS NULL AND item_faturavel_id IS NULL
    AND (empresa_fornecedora_id IS NULL OR empresa_fornecedora_id = ?)
  ORDER BY vigencia_inicio DESC, valor_inicial, id`;

async function hojeDo(l: Pick<Leitor, 'uma'>): Promise<string> {
  return dataIso((await l.uma<Linha>('SELECT CURRENT_DATE() AS d', []))?.['d']);
}

function recusarTodas(rs: readonly RecusaSuprimentos[]): void {
  const [r] = rs;
  if (r)
    throw recusa(r.codigo, rs.map((x) => x.mensagem).join(' '), {
      campos: [...new Set(rs.flatMap((x) => x.campos ?? []))],
    });
}

export class PortaTaxaConsignacaoPropria implements PortaTaxaConsignacao {
  readonly destino = 'banco' as const;
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: Pick<NucleoProprio, 'lerSomente' | 'criarExecutor'>,
    executorPronto?: Executor,
  ) {
    this.executor = executorPronto ?? nucleo.criarExecutor();
  }

  private contexto(c: ContextoPortaM18): ContextoNucleo & { estabelecimento: number } {
    if (c.estabelecimento === null)
      throw recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.');
    return {
      cliente: c.cliente,
      estabelecimento: c.estabelecimento,
      usuario: c.usuario,
      correlacao: c.correlacao || 'taxa-consignacao',
    };
  }

  private faixas(l: Pick<Leitor, 'consultar'>, est: number, fornecedor: number | null) {
    return l.consultar<Linha>(SQL_FAIXAS, [est, fornecedor ?? 0]).then((rs) => rs.map(faixaDe));
  }

  tabelas(c: ContextoPortaM18, fornecedor: number | null): Promise<TabelasTaxaConsignacao> {
    const ctx = this.contexto(c);
    return this.nucleo.lerSomente(ctx, async (l) => {
      const hoje = await hojeDo(l);
      const todas = await this.faixas(l, ctx.estabelecimento, fornecedor);
      const vigentes = tabelaTaxaVigente(todas, fornecedor, hoje);
      const origem =
        vigentes.length === 0 ? 'sem-tabela' : vigentes[0]!.fornecedor === null ? 'geral' : 'fornecedor';
      return { hoje, fornecedor, vigentes, origem, historico: todas };
    });
  }

  calcular(c: ContextoPortaM18, fornecedor: number | null, valor: number, data: string | null) {
    const ctx = this.contexto(c);
    return this.nucleo.lerSomente(ctx, async (l) => {
      const dia = data ?? (await hojeDo(l));
      const todas = await this.faixas(l, ctx.estabelecimento, fornecedor);
      return { ...calcularTaxaConsignacao(todas, fornecedor, valor, dia), data: dia };
    });
  }

  async gravar(
    c: ContextoPortaM18,
    e: TabelaTaxaConsignacaoEntrada,
    chave: string,
  ): Promise<{ ids: number[] }> {
    const ctxN = this.contexto(c);
    const est = ctxN.estabelecimento;
    const entrada = {
      fornecedor: e.fornecedor,
      inicio: e.inicio,
      faixas: e.faixas.map((f) => ({
        valorInicial: f.valorInicial,
        valorFinal: f.valorFinal,
        percentual: f.percentual,
        teto: f.teto,
      })),
    };
    const op = definirOperacao({
      nome: OPERACAO_TAXA_CONSIGNACAO,
      tabelas: [...TABELAS_TAXA_CONSIGNACAO],
      entrada: z.unknown(),
      async gravar(tx: TxOperacao): Promise<{ id: number; ids: string }> {
        if (e.fornecedor !== null) {
          const f = await tx.uma<Linha>(
            "SELECT id FROM empresa_fornecedora WHERE id = ? AND excluido_em IS NULL AND situacao = 'ativo'",
            [e.fornecedor],
          );
          if (!f)
            throw recusa('fornecedor-inexistente', 'O fornecedor não existe ou está inativo.', {
              campos: ['fornecedor'],
            });
        }
        // As faixas do escopo, travadas: duas tabelas novas simultâneas do mesmo fornecedor não se cruzam.
        const doEscopo = (
          await tx.consultarParaAtualizar<Linha>(
            `SELECT id, versao, empresa_fornecedora_id, valor_inicial, valor_final, percentual, teto_cobranca,
                    vigencia_inicio, vigencia_fim
               FROM faixa_taxa_consignacao
              WHERE estabelecimento_id = ? AND ativo AND fonte_pagadora_id IS NULL AND item_faturavel_id IS NULL
                AND empresa_fornecedora_id <=> ?`,
            [est, e.fornecedor],
          )
        ).map((r) => ({ ...faixaDe(r), versao: n(r['versao']) }));
        const plano = planejarTabelaTaxaConsignacao(e, doEscopo, await hojeDo(tx));
        recusarTodas(plano.recusas);
        for (const id of plano.fechar) {
          // Só fecha a que começou antes da nova (a que começaria no mesmo dia ou depois já foi recusada no plano).
          const v = doEscopo.find((x) => x.id === id)!;
          await tx.alterar('faixa_taxa_consignacao', id, v.versao, { vigencia_fim: plano.fim });
        }
        const ids: number[] = [];
        for (const f of [...e.faixas].sort((a, b) => a.valorInicial - b.valorInicial))
          ids.push(
            await tx.incluir('faixa_taxa_consignacao', {
              estabelecimento_id: est,
              empresa_fornecedora_id: e.fornecedor,
              fonte_pagadora_id: null,
              item_faturavel_id: null,
              valor_inicial: f.valorInicial,
              valor_final: f.valorFinal,
              percentual: f.percentual,
              teto_cobranca: f.teto,
              vigencia_inicio: e.inicio,
              vigencia_fim: null,
              ativo: true,
            }),
          );
        // O resultado guardado pela idempotência é plano: o primeiro id e a lista separada por vírgula.
        return { id: ids[0] ?? 0, ids: ids.join(',') };
      },
      alvo: (_e, r) => ({ tabela: 'faixa_taxa_consignacao', id: r.id }),
      trilha: () => ({ dados: entrada, motivo: null }),
    });
    const ctx: ContextoOperacao = { ...ctxN, chaveIdempotencia: chave };
    const { resultado } = await this.executor.executar(op, c.cliente, entrada, ctx);
    return {
      ids: String(resultado.ids ?? '')
        .split(',')
        .filter(Boolean)
        .map(Number),
    };
  }
}
