// Porta própria do job da fila com o ERP corporativo no worker (F8, 08-INTG L136) sobre o banco do cliente, pelo
// @sgh/nucleo. Implementa a FonteFilaErp de exportacao-erp/fila.ts por estabelecimento (o `hospital` da fonte é o id
// do estabelecimento): lê os lotes gerados (exportacao_erp) com os itens (exportacao_erp_item) no layout canônico;
// reserva o lote ('enviando') antes do adaptador, devolve a gerado se o adaptador recusa e marca o envio com o protocolo,
// cada passo numa operação do Executor (trilha na mesma transação, trava da linha e versão lida); lista os enviados sem
// retorno gravado para a retomada; e
// grava o retorno item a item, também numa operação, sob a trava do lote. O retorno é idempotente pela regra do
// domínio (aplicarRetornoErp): o item já aceito com a mesma chave não muda. Nada é apagado.
import { randomUUID } from 'node:crypto';
import {
  type ItemAtualErp,
  type ResultadoRetornoErp,
  type SituacaoItemErp,
  type SituacaoLoteErp,
  SITUACOES_ITEM_ERP,
  SITUACOES_LOTE_ERP,
  TIPO_LOTE_ERP,
  type TipoFilaErp,
} from '@sgh/dominio-integracao';
import { definirOperacao, type Executor, type Leitor } from '@sgh/nucleo';
import { z } from 'zod';
import { type AlvoEstabelecimento, estabelecimentosAtivos, type NucleoWorker } from '../servico-worker.js';
import type { FonteFilaErp, LoteParaEnvioErp, LoteSemRetornoErp } from './fila.js';

const T_LOTE = 'exportacao_erp';
const T_ITEM = 'exportacao_erp_item';
export const TABELAS_FILA_ERP_WORKER = [T_LOTE, T_ITEM] as const;
/** Os mesmos nomes das rotas da API: a trilha do envio e do retorno é uma só, venha da tela ou do worker. */
export const OPERACOES_FILA_ERP_WORKER = {
  reservar: 'integracao.fila_erp.reservar',
  liberar: 'integracao.fila_erp.liberar',
  enviar: 'integracao.fila_erp.enviar',
  retorno: 'integracao.fila_erp.retorno',
} as const;

const TIPO_DO_LOTE = Object.fromEntries(Object.entries(TIPO_LOTE_ERP).map(([k, v]) => [v, k])) as Record<
  string,
  TipoFilaErp
>;

const SQL_ITENS = `SELECT id, sequencia, valor, situacao, chave_externa, cpf_cnpj, conteudo, versao
  FROM exportacao_erp_item WHERE exportacao_erp_id = ? AND excluido_em IS NULL ORDER BY sequencia`;

const n = (v: unknown) => Number(v ?? 0);
const nOuNulo = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const tOuNulo = (v: unknown) => (v === null || v === undefined || String(v) === '' ? null : String(v));
const conteudo = (v: unknown): unknown => {
  if (typeof v !== 'string') return v ?? null;
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
};
const atual = (r: Record<string, unknown>): ItemAtualErp => ({
  sequencia: n(r['sequencia']),
  situacao: String(r['situacao']) as SituacaoItemErp,
  chaveExterna: tOuNulo(r['chave_externa']),
  valor: nOuNulo(r['valor']),
});

/** Conflito de versão ou de situação: o lote mudou desde a leitura (a tela enviou, cancelou ou outro worker). */
export class LoteErpMudou extends Error {
  constructor(id: number) {
    super(`lote ${id} mudou desde a leitura`);
    this.name = 'LoteErpMudou';
  }
}

const ENVIO = z.object({
  estabelecimento: z.number().int().positive(),
  id: z.number().int().positive(),
  versao: z.number().int().positive(),
  protocolo: z.string().min(1).max(100),
});
const RESERVA = z.object({
  estabelecimento: z.number().int().positive(),
  id: z.number().int().positive(),
  versao: z.number().int().positive(),
});
const MUDANCA = z.object({
  sequencia: z.number().int().positive(),
  situacao: z.enum(SITUACOES_ITEM_ERP),
  chaveExterna: z.string().max(100).nullable(),
  mensagem: z.string().max(1000).nullable(),
});
const RETORNO = z.object({
  estabelecimento: z.number().int().positive(),
  id: z.number().int().positive(),
  versao: z.number().int().positive(),
  mudancas: z.array(MUDANCA).max(5000),
  situacaoLote: z.enum(SITUACOES_LOTE_ERP),
  quantidadeErros: z.number().int().nonnegative(),
});

export class FonteFilaErpPropria implements FonteFilaErp {
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: NucleoWorker,
    readonly cliente: string,
    executor?: Executor,
  ) {
    this.executor = executor ?? nucleo.criarExecutor();
  }

  private ler<T>(est: number | null, fn: (l: Leitor) => Promise<T>): Promise<T> {
    return this.nucleo.lerSomente(
      { cliente: this.cliente, estabelecimento: est, correlacao: 'fila-erp' },
      fn,
    );
  }

  private contexto(est: number, id: number) {
    return {
      cliente: this.cliente,
      estabelecimento: est,
      usuario: null,
      correlacao: `fila-erp-${id}`.slice(0, 64),
      chaveIdempotencia: `worker.fila_erp.${id}.${randomUUID()}`,
    };
  }

  estabelecimentos(): Promise<AlvoEstabelecimento[]> {
    return this.ler(null, (l) => estabelecimentosAtivos(l, this.cliente));
  }

  private async comItens(l: Leitor, lotes: readonly Record<string, unknown>[]): Promise<LoteParaEnvioErp[]> {
    const out: LoteParaEnvioErp[] = [];
    for (const r of lotes) {
      const tipo = TIPO_DO_LOTE[String(r['tipo'])];
      if (!tipo) continue;
      const itens = await l.consultar(SQL_ITENS, [n(r['id'])], { teto: 5000 });
      out.push({
        id: n(r['id']),
        numero: String(r['numero']),
        tipo,
        versao: n(r['versao']),
        itens: itens.map((i) => ({
          sequencia: n(i['sequencia']),
          cpfCnpj: tOuNulo(i['cpf_cnpj']),
          valor: nOuNulo(i['valor']),
          conteudo: conteudo(i['conteudo']),
        })),
      });
    }
    return out;
  }

  lotesParaEnviar(hospital: string, teto: number): Promise<readonly LoteParaEnvioErp[]> {
    const est = Number(hospital);
    return this.ler(est, async (l) =>
      this.comItens(
        l,
        await l.consultar(
          `SELECT id, numero, tipo, versao FROM exportacao_erp
            WHERE estabelecimento_id = ? AND situacao = 'gerado' AND excluido_em IS NULL
            ORDER BY gerado_em, id LIMIT ?`,
          [est, Math.max(1, Math.min(teto, 200))],
          { teto: 200 },
        ),
      ),
    );
  }

  lotesSemRetorno(hospital: string, teto: number): Promise<readonly LoteSemRetornoErp[]> {
    const est = Number(hospital);
    return this.ler(est, async (l) => {
      const lotes = await l.consultar(
        `SELECT id, numero, tipo, versao, protocolo_externo FROM exportacao_erp
          WHERE estabelecimento_id = ? AND situacao = 'enviado' AND processado_em IS NULL
            AND protocolo_externo IS NOT NULL AND excluido_em IS NULL
          ORDER BY enviado_em, id LIMIT ?`,
        [est, Math.max(1, Math.min(teto, 200))],
        { teto: 200 },
      );
      const protocolo = new Map(lotes.map((r) => [n(r['id']), String(r['protocolo_externo'])]));
      return (await this.comItens(l, lotes)).map((x) => ({ ...x, protocolo: protocolo.get(x.id) ?? '' }));
    });
  }

  /** Uma passagem de situação do lote sob a trava da linha e a versão lida; devolve a versão nova. */
  private async transitar(
    nome: string,
    hospital: string,
    id: number,
    versao: number,
    de: 'gerado' | 'enviando',
    campos: Record<string, unknown>,
  ): Promise<number> {
    const est = Number(hospital);
    const op = definirOperacao<z.infer<typeof RESERVA>, { versao: number }>({
      nome,
      tabelas: TABELAS_FILA_ERP_WORKER,
      entrada: RESERVA,
      gravar: async (tx, e) => {
        const [r] = await tx.consultarParaAtualizar(
          'SELECT id, situacao, versao FROM exportacao_erp WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
          [e.id, e.estabelecimento],
          { teto: 1 },
        );
        if (!r || String(r['situacao']) !== de || n(r['versao']) !== e.versao) throw new LoteErpMudou(e.id);
        return { versao: await tx.alterar(T_LOTE, e.id, e.versao, campos) };
      },
      alvo: (e) => ({ tabela: T_LOTE, id: e.id }),
    });
    const r = await this.executor.executar(
      op,
      this.cliente,
      { estabelecimento: est, id, versao },
      this.contexto(est, id),
    );
    return r.resultado.versao;
  }

  reservarEnvio(hospital: string, id: number, versao: number): Promise<number> {
    return this.transitar(OPERACOES_FILA_ERP_WORKER.reservar, hospital, id, versao, 'gerado', {
      situacao: 'enviando',
    });
  }

  async liberarEnvio(hospital: string, id: number, versao: number): Promise<void> {
    await this.transitar(OPERACOES_FILA_ERP_WORKER.liberar, hospital, id, versao, 'enviando', {
      situacao: 'gerado',
    });
  }

  async registrarEnvio(hospital: string, id: number, versao: number, protocolo: string): Promise<number> {
    const est = Number(hospital);
    const op = definirOperacao<z.infer<typeof ENVIO>, { versao: number }>({
      nome: OPERACOES_FILA_ERP_WORKER.enviar,
      tabelas: TABELAS_FILA_ERP_WORKER,
      entrada: ENVIO,
      gravar: async (tx, e) => {
        const [r] = await tx.consultarParaAtualizar(
          'SELECT id, situacao, versao FROM exportacao_erp WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
          [e.id, e.estabelecimento],
          { teto: 1 },
        );
        if (!r || String(r['situacao']) !== 'enviando' || n(r['versao']) !== e.versao)
          throw new LoteErpMudou(e.id);
        return {
          versao: await tx.alterar(T_LOTE, e.id, e.versao, {
            situacao: 'enviado',
            enviado_em: new Date(),
            protocolo_externo: e.protocolo,
          }),
        };
      },
      alvo: (e) => ({ tabela: T_LOTE, id: e.id }),
    });
    const r = await this.executor.executar(
      op,
      this.cliente,
      { estabelecimento: est, id, versao, protocolo: protocolo.slice(0, 100) },
      this.contexto(est, id),
    );
    return r.resultado.versao;
  }

  itensAtuais(
    hospital: string,
    id: number,
  ): Promise<{ situacao: SituacaoLoteErp; itens: readonly ItemAtualErp[] }> {
    const est = Number(hospital);
    return this.ler(est, async (l) => {
      const [r] = await l.consultar(
        'SELECT situacao FROM exportacao_erp WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [id, est],
        { teto: 1 },
      );
      if (!r) throw new LoteErpMudou(id);
      return {
        situacao: String(r['situacao']) as SituacaoLoteErp,
        itens: (await l.consultar(SQL_ITENS, [id], { teto: 5000 })).map(atual),
      };
    });
  }

  async gravarRetorno(hospital: string, id: number, versao: number, res: ResultadoRetornoErp): Promise<void> {
    const est = Number(hospital);
    const op = definirOperacao<z.infer<typeof RETORNO>, { alterados: number }>({
      nome: OPERACOES_FILA_ERP_WORKER.retorno,
      tabelas: TABELAS_FILA_ERP_WORKER,
      entrada: RETORNO,
      gravar: async (tx, e) => {
        const [r] = await tx.consultarParaAtualizar(
          'SELECT id, situacao, versao FROM exportacao_erp WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
          [e.id, e.estabelecimento],
          { teto: 1 },
        );
        if (!r || n(r['versao']) !== e.versao) throw new LoteErpMudou(e.id);
        const porSeq = new Map(
          (await tx.consultar(SQL_ITENS, [e.id], { teto: 5000 })).map((l) => [n(l['sequencia']), l]),
        );
        let alterados = 0;
        for (const m of e.mudancas) {
          const l = porSeq.get(m.sequencia);
          if (!l) continue;
          await tx.alterar(T_ITEM, n(l['id']), n(l['versao']), {
            situacao: m.situacao,
            chave_externa: m.chaveExterna,
            mensagem_retorno: m.mensagem,
          });
          alterados++;
        }
        if (alterados > 0 || e.situacaoLote !== String(r['situacao']))
          await tx.alterar(T_LOTE, e.id, e.versao, {
            situacao: e.situacaoLote,
            quantidade_erros: e.quantidadeErros,
            processado_em: e.situacaoLote === 'enviado' ? null : new Date(),
          });
        return { alterados };
      },
      alvo: (e) => ({ tabela: T_LOTE, id: e.id }),
    });
    await this.executor.executar(
      op,
      this.cliente,
      {
        estabelecimento: est,
        id,
        versao,
        mudancas: res.mudancas.map((m) => ({ ...m })),
        situacaoLote: res.situacaoLote,
        quantidadeErros: res.quantidadeErros,
      },
      this.contexto(est, id),
    );
  }
}
