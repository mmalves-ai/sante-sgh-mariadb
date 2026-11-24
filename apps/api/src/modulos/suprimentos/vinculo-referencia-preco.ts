// Vínculo do item do estoque com a referência de preço de material e medicamento (F3.6, 05-SUP linha 28), sobre o
// MariaDB do cliente pelo Executor do núcleo (trilha na mesma transação, versão conferida). A regra pura mora em
// `@sgh/contratos/regras-suprimentos` (vinculo-referencia-preco); aqui ficam a conferência das referências no banco, a
// escrita e a leitura da ficha. Nada é apagado: o vínculo novo fecha a vigência do anterior na véspera, e o encerramento
// só preenche o fim. A conta (conta-estoque.ts) lê o vínculo vigente na data do lançamento, com o fator.
import { randomUUID } from 'node:crypto';
import {
  conferirEncerramentoVinculoReferencia,
  fatorSugeridoReferencia,
  planejarVinculoReferenciaPreco,
  type RecusaSuprimentos,
  type VincularReferenciaPrecoEntrada,
  type VinculoReferenciaPrecoVigencia,
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
  type ResultadoOperacao,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';
import { ErroProblema } from '../../problema.filter.js';
import type { ContextoPortaM18 } from '../exames/public-api.js';

export const PORTA_VINCULO_REFERENCIA = Symbol('PORTA_VINCULO_REFERENCIA');
export const TABELAS_VINCULO_REFERENCIA = ['insumo_referencia_preco'] as const;

export interface ReferenciaPrecoResumo {
  readonly id: number;
  readonly fonte: string;
  readonly codigo: string;
  readonly descricao: string;
  readonly apresentacao: string | null;
  readonly tipoProduto: string;
  readonly situacao: string;
  readonly unidade: string | null;
  readonly ean: string | null;
}

export interface VinculoReferenciaPreco {
  readonly id: number;
  readonly versao: number;
  readonly referencia: ReferenciaPrecoResumo;
  readonly edicao: { readonly id: number; readonly numero: string } | null;
  readonly fator: number;
  readonly inicio: string;
  readonly fim: string | null;
  readonly vigente: boolean;
}

export interface FichaVinculoReferencia {
  readonly hoje: string;
  readonly item: {
    readonly id: number;
    readonly codigo: string;
    readonly nome: string;
    readonly unidade: string | null;
  };
  readonly vigente: VinculoReferenciaPreco | null;
  /** Todos os vínculos do item, do mais novo ao mais antigo (o histórico nunca some). */
  readonly historico: readonly VinculoReferenciaPreco[];
}

export interface OpcaoReferenciaPreco extends ReferenciaPrecoResumo {
  readonly fatorSugerido: number | null;
  readonly edicaoVigente: { readonly id: number; readonly numero: string } | null;
}

export interface PortaVinculoReferencia {
  readonly destino: 'banco' | 'indisponivel';
  ficha(c: ContextoPortaM18, insumo: number): Promise<FichaVinculoReferencia | null>;
  buscar(c: ContextoPortaM18, insumo: number, termo: string): Promise<OpcaoReferenciaPreco[]>;
  vincular(c: ContextoPortaM18, insumo: number, e: VincularReferenciaPrecoEntrada): Promise<{ id: number }>;
  encerrar(c: ContextoPortaM18, insumo: number, vinculo: number, fim: string): Promise<{ id: number }>;
}

export function portaVinculoReferenciaIndisponivel(): PortaVinculoReferencia {
  const falha = (): never => {
    throw new ErroProblema('indisponivel', 503, 'O vínculo com a referência de preço exige o banco próprio.');
  };
  return { destino: 'indisponivel', ficha: falha, buscar: falha, vincular: falha, encerrar: falha };
}

const n = (v: unknown) => Number(v ?? 0);
const nn = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const t = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const tn = (v: unknown) => (v === null || v === undefined || v === '' ? null : String(v));
const dataIso = (v: unknown): string =>
  v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : '';

function recusarTodas(rs: readonly RecusaSuprimentos[]): void {
  const [r] = rs;
  if (r)
    throw recusa(r.codigo, rs.map((x) => x.mensagem).join(' '), {
      campos: [...new Set(rs.flatMap((x) => x.campos ?? []))],
    });
}

const COLUNAS_REFERENCIA = `r.id AS ref_id, r.fonte_referencia, r.codigo_referencia, r.descricao, r.apresentacao,
  r.tipo_produto, r.situacao AS ref_situacao, r.codigo_ean, r.unidade_medida_id AS ref_unidade, um.sigla AS ref_sigla`;

const referenciaDe = (r: Linha): ReferenciaPrecoResumo => ({
  id: n(r['ref_id']),
  fonte: t(r['fonte_referencia']),
  codigo: t(r['codigo_referencia']),
  descricao: t(r['descricao']),
  apresentacao: tn(r['apresentacao']),
  tipoProduto: t(r['tipo_produto']),
  situacao: t(r['ref_situacao']),
  unidade: tn(r['ref_sigla']),
  ean: tn(r['codigo_ean']),
});

/** A edição vigente da publicação na data (a da carga mais recente que já vale). */
async function edicaoVigente(
  l: Pick<Leitor, 'uma'>,
  fonte: string,
  data: string,
): Promise<{ id: number; numero: string } | null> {
  const r = await l.uma<Linha>(
    `SELECT e.id, e.numero_edicao FROM edicao_referencia_matmed e
       JOIN fonte_referencia_matmed f ON f.id = e.fonte_referencia_matmed_id
      WHERE f.codigo = ? AND e.situacao IN ('ativa', 'importada') AND e.vigencia_inicio <= ?
        AND (e.vigencia_fim IS NULL OR e.vigencia_fim >= ?)
      ORDER BY e.vigencia_inicio DESC, e.id DESC LIMIT 1`,
    [fonte, data, data],
  );
  return r ? { id: n(r['id']), numero: t(r['numero_edicao']) } : null;
}

export class PortaVinculoReferenciaPropria implements PortaVinculoReferencia {
  readonly destino = 'banco' as const;
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: Pick<NucleoProprio, 'lerSomente' | 'criarExecutor'>,
    executorPronto?: Executor,
  ) {
    this.executor = executorPronto ?? nucleo.criarExecutor();
  }

  private contexto(c: ContextoPortaM18): ContextoNucleo {
    if (c.estabelecimento === null)
      throw recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.');
    return {
      cliente: c.cliente,
      estabelecimento: c.estabelecimento,
      usuario: c.usuario,
      correlacao: c.correlacao || 'vinculo-referencia',
    };
  }

  async ficha(c: ContextoPortaM18, insumo: number): Promise<FichaVinculoReferencia | null> {
    return this.nucleo.lerSomente(this.contexto(c), async (l) => {
      const item = await l.uma<Linha>(
        `SELECT i.id, i.codigo, i.nome, um.sigla FROM insumo i
           LEFT JOIN unidade_medida um ON um.id = i.estoque_unidade_medida_id
          WHERE i.id = ? AND i.excluido_em IS NULL`,
        [insumo],
      );
      if (!item) return null;
      const hojeL = await l.uma<Linha>('SELECT CURRENT_DATE() AS d', []);
      const hoje = dataIso(hojeL?.['d']);
      const linhas = await l.consultar<Linha>(
        `SELECT v.id, v.versao, v.fator_conversao, v.vigencia_inicio, v.vigencia_fim,
                e.id AS edicao_id, e.numero_edicao, ${COLUNAS_REFERENCIA}
           FROM insumo_referencia_preco v
           JOIN item_referencia_matmed r ON r.id = v.item_referencia_matmed_id
           LEFT JOIN unidade_medida um ON um.id = r.unidade_medida_id
           LEFT JOIN edicao_referencia_matmed e ON e.id = v.edicao_referencia_matmed_id
          WHERE v.insumo_id = ? AND v.excluido_em IS NULL
          ORDER BY v.vigencia_inicio DESC, v.id DESC`,
        [insumo],
      );
      const historico = linhas.map((r): VinculoReferenciaPreco => {
        const inicio = dataIso(r['vigencia_inicio']);
        const fim = r['vigencia_fim'] ? dataIso(r['vigencia_fim']) : null;
        return {
          id: n(r['id']),
          versao: n(r['versao']),
          referencia: referenciaDe(r),
          edicao: r['edicao_id'] ? { id: n(r['edicao_id']), numero: t(r['numero_edicao']) } : null,
          fator: n(r['fator_conversao']),
          inicio,
          fim,
          vigente: inicio <= hoje && (fim === null || fim >= hoje),
        };
      });
      return {
        hoje,
        item: {
          id: n(item['id']),
          codigo: t(item['codigo']),
          nome: t(item['nome']),
          unidade: tn(item['sigla']),
        },
        vigente: historico.find((v) => v.vigente) ?? null,
        historico,
      };
    });
  }

  async buscar(c: ContextoPortaM18, insumo: number, termo: string): Promise<OpcaoReferenciaPreco[]> {
    const busca = termo.trim().slice(0, 60);
    if (busca.length < 2) return [];
    return this.nucleo.lerSomente(this.contexto(c), async (l) => {
      const item = await l.uma<Linha>('SELECT estoque_unidade_medida_id FROM insumo WHERE id = ?', [insumo]);
      const unidades = await l.consultar<Linha>(
        'SELECT unidade_medida_id, fator_conversao FROM insumo_unidade WHERE insumo_id = ? AND ativo AND excluido_em IS NULL',
        [insumo],
      );
      const doItem = unidades.map((u) => ({
        unidade: n(u['unidade_medida_id']),
        fator: n(u['fator_conversao']),
      }));
      const linhas = await l.consultar<Linha>(
        `SELECT ${COLUNAS_REFERENCIA} FROM item_referencia_matmed r
           LEFT JOIN unidade_medida um ON um.id = r.unidade_medida_id
          WHERE r.situacao = 'ativo' AND r.excluido_em IS NULL
            AND (r.codigo_referencia = ? OR r.codigo_ean = ? OR r.codigo_tuss = ? OR r.descricao LIKE ?)
          ORDER BY r.codigo_referencia = ? DESC, r.descricao LIMIT 30`,
        [busca, busca, busca, `%${busca.replace(/[%_\\]/g, '\\$&')}%`, busca],
      );
      const hoje = dataIso((await l.uma<Linha>('SELECT CURRENT_DATE() AS d', []))?.['d']);
      const edicoes = new Map<string, { id: number; numero: string } | null>();
      const saida: OpcaoReferenciaPreco[] = [];
      for (const r of linhas) {
        const fonte = t(r['fonte_referencia']);
        if (!edicoes.has(fonte)) edicoes.set(fonte, await edicaoVigente(l, fonte, hoje));
        saida.push({
          ...referenciaDe(r),
          fatorSugerido: fatorSugeridoReferencia(
            nn(item?.['estoque_unidade_medida_id']),
            nn(r['ref_unidade']),
            doItem,
          ),
          edicaoVigente: edicoes.get(fonte) ?? null,
        });
      }
      return saida;
    });
  }

  private async gravar(
    c: ContextoPortaM18,
    nome: string,
    resumo: Record<string, unknown>,
    fn: (tx: TxOperacao) => Promise<number>,
  ): Promise<{ id: number }> {
    const ctxN = this.contexto(c);
    let id: number | null = null;
    const op = definirOperacao({
      nome: `suprimentos.cadastro.${nome}`,
      tabelas: [...TABELAS_VINCULO_REFERENCIA],
      entrada: z.object({ chave: z.string() }),
      async gravar(tx) {
        id = await fn(tx);
        return {} as ResultadoOperacao;
      },
      alvo: () => ({ tabela: 'insumo_referencia_preco', id }),
      trilha: () => ({ dados: resumo, motivo: null }),
    });
    const chave = `vinculo-referencia:${randomUUID()}`;
    const ctx: ContextoOperacao = { ...ctxN, chaveIdempotencia: chave };
    await this.executor.executar(op, c.cliente, { chave }, ctx);
    if (id === null) throw new Error('Gravação do vínculo com a referência sem resultado.');
    return { id };
  }

  /** A linha do tempo do item, travada para a gravação (dois vínculos simultâneos não se cruzam). */
  private async linhaDoTempo(tx: TxOperacao, insumo: number): Promise<VinculoReferenciaPrecoVigencia[]> {
    const rs = await tx.consultarParaAtualizar<Linha>(
      `SELECT id, versao, item_referencia_matmed_id, fator_conversao, vigencia_inicio, vigencia_fim
         FROM insumo_referencia_preco WHERE insumo_id = ? AND excluido_em IS NULL`,
      [insumo],
    );
    return rs.map((r) => ({
      id: n(r['id']),
      versao: n(r['versao']),
      referencia: n(r['item_referencia_matmed_id']),
      fator: n(r['fator_conversao']),
      inicio: dataIso(r['vigencia_inicio']),
      fim: r['vigencia_fim'] ? dataIso(r['vigencia_fim']) : null,
    }));
  }

  vincular(c: ContextoPortaM18, insumo: number, e: VincularReferenciaPrecoEntrada): Promise<{ id: number }> {
    return this.gravar(
      c,
      'vincularReferenciaPreco',
      { insumo, referencia: e.referencia, edicao: e.edicao, fator: e.fator, inicio: e.inicio },
      async (tx) => {
        const item = await tx.uma<Linha>('SELECT id FROM insumo WHERE id = ? AND excluido_em IS NULL', [
          insumo,
        ]);
        if (!item)
          throw recusa('item-inexistente', 'O item não existe no cadastro do estoque.', { campos: ['item'] });
        const ref = await tx.uma<Linha>(
          'SELECT id, fonte_referencia, situacao FROM item_referencia_matmed WHERE id = ? AND excluido_em IS NULL',
          [e.referencia],
        );
        if (!ref)
          throw recusa('referencia-inexistente', 'A referência de preço não existe.', {
            campos: ['referencia'],
          });
        if (t(ref['situacao']) !== 'ativo')
          throw recusa(
            'referencia-inativa',
            `A referência está ${t(ref['situacao'])} na publicação; escolha uma ativa.`,
            { campos: ['referencia'] },
          );
        const linha = await this.linhaDoTempo(tx, insumo);
        const plano = planejarVinculoReferenciaPreco(e, linha);
        recusarTodas(plano.recusas);
        let edicao = e.edicao;
        if (edicao !== null) {
          const ed = await tx.uma<Linha>(
            `SELECT e.id FROM edicao_referencia_matmed e JOIN fonte_referencia_matmed f ON f.id = e.fonte_referencia_matmed_id
              WHERE e.id = ? AND f.codigo = ?`,
            [edicao, t(ref['fonte_referencia'])],
          );
          if (!ed)
            throw recusa(
              'edicao-de-outra-fonte',
              'A edição escolhida não é da publicação desta referência.',
              {
                campos: ['edicao'],
              },
            );
        } else edicao = (await edicaoVigente(tx, t(ref['fonte_referencia']), e.inicio))?.id ?? null;
        for (const f of plano.encerrar) {
          const v = linha.find((x) => x.id === f.id) as VinculoReferenciaPrecoVigencia & { versao: number };
          await tx.alterar('insumo_referencia_preco', f.id, v.versao, { vigencia_fim: f.fim });
        }
        return tx.incluir('insumo_referencia_preco', {
          insumo_id: insumo,
          item_referencia_matmed_id: e.referencia,
          edicao_referencia_matmed_id: edicao,
          fator_conversao: e.fator,
          vigencia_inicio: e.inicio,
        });
      },
    );
  }

  encerrar(c: ContextoPortaM18, insumo: number, vinculo: number, fim: string): Promise<{ id: number }> {
    return this.gravar(c, 'encerrarVinculoReferenciaPreco', { insumo, vinculo, fim }, async (tx) => {
      const linha = await this.linhaDoTempo(tx, insumo);
      const v = linha.find((x) => x.id === vinculo) as
        (VinculoReferenciaPrecoVigencia & { versao: number }) | undefined;
      if (!v) throw recusa('vinculo-inexistente', 'O vínculo não é deste item.', { campos: ['vinculo'] });
      recusarTodas(conferirEncerramentoVinculoReferencia(v, fim));
      await tx.alterar('insumo_referencia_preco', v.id, v.versao, { vigencia_fim: fim });
      return v.id;
    });
  }
}
