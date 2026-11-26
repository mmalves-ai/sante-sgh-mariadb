// Porta própria do registro da carga do data mart (01-ADM L115; F8) sobre o banco do cliente, pelo @sgh/nucleo.
// Leitura (somente leitura): os estabelecimentos ativos e o início da última carga agendada do data mart de cada um
// (carga_data_mart). Gravação, numa operação do Executor (trilha na mesma transação): a abertura da carga em execução,
// sob a trava da linha do estabelecimento (o segundo consumidor do mesmo dia não abre outra), e o fechamento com as
// etapas por dimensão e fato (carga_data_mart_etapa: linhas e tempo) e a situação, as linhas e a mensagem sem valores.
// Melhoria: o registro guarda só contagens, tempos e a mensagem limpa; nenhum dado de pessoa vai ao registro.
import { randomUUID } from 'node:crypto';
import {
  ASSUNTO_CARGA_DATAMART,
  type FechamentoDaCarga,
  PEDIDO_AGUARDANDO,
  PEDIDO_INICIADO,
  podeAbrirAgendada,
} from '@sgh/dominio-relatorio';
import { definirOperacao, type Executor, type Leitor } from '@sgh/nucleo';
import { z } from 'zod';
import { type AlvoEstabelecimento, estabelecimentosAtivos, type NucleoWorker } from './servico-worker.js';

export interface PortaDataMart {
  estabelecimentos(): Promise<AlvoEstabelecimento[]>;
  /** O início da última carga agendada do data mart do estabelecimento (qualquer situação), ou null. */
  ultimaIniciada(est: AlvoEstabelecimento): Promise<Date | null>;
  /** Abre a carga em execução; null se outra já começou depois de `desde` (o início do dia local). */
  abrir(est: AlvoEstabelecimento, inicio: Date, desde: Date): Promise<number | null>;
  /** As cargas manuais pedidas na administração (01-REL L113) que aguardam o worker, da mais antiga. */
  pedidosAguardando(est: AlvoEstabelecimento): Promise<number[]>;
  /** Assume o pedido (aguardando → iniciado), sob a trava da carga; false se outro consumidor já assumiu. */
  assumir(est: AlvoEstabelecimento, carga: number): Promise<boolean>;
  /** Fecha a carga com as etapas, a situação e as linhas. */
  concluir(est: AlvoEstabelecimento, carga: number, f: FechamentoDaCarga, fim: Date): Promise<void>;
}

const ABRIR = z.object({
  estabelecimento: z.number().int().positive(),
  inicio: z.date(),
  desde: z.date(),
});

const ETAPA = z.object({
  sequencia: z.number().int().positive(),
  tipoObjeto: z.enum(['dimensao', 'fato']),
  objeto: z.string().regex(/^[a-z][a-z0-9_]{1,99}$/),
  linhas: z.number().int().nonnegative(),
  duracaoMs: z.number().int().nonnegative(),
  situacao: z.enum(['concluida', 'falhou']),
});

const CONCLUIR = z.object({
  estabelecimento: z.number().int().positive(),
  carga: z.number().int().positive(),
  situacao: z.enum(['concluida', 'concluida_com_rejeicao', 'falhou']),
  linhasGravadas: z.number().int().nonnegative(),
  linhasRejeitadas: z.number().int().nonnegative(),
  mensagemErro: z.string().max(1000).nullable(),
  etapas: z.array(ETAPA).max(200),
  fim: z.date(),
});

const quando = (v: unknown): Date | null =>
  v === null || v === undefined ? null : v instanceof Date ? v : new Date(String(v).replace(' ', 'T') + 'Z');

const operacaoAbrir = definirOperacao<z.infer<typeof ABRIR>, { carga: number | null }>({
  nome: 'relatorio.datamart.carga_abrir',
  tabelas: ['carga_data_mart'],
  entrada: ABRIR,
  gravar: async (tx, e) => {
    // A trava do estabelecimento serializa os consumidores e o pedido da API: o segundo vê a carga aberta e não abre outra.
    await tx.consultarParaAtualizar('SELECT id FROM estabelecimento WHERE id = ?', [e.estabelecimento], {
      teto: 1,
    });
    const ja = await tx.consultar(
      `SELECT id FROM carga_data_mart
        WHERE estabelecimento_id = ? AND assunto = ? AND disparo = 'agendado' AND ocorrido_em >= ?`,
      [e.estabelecimento, ASSUNTO_CARGA_DATAMART, e.desde],
      { teto: 10 },
    );
    if (ja.length > 0) return { carga: null };
    // Sob a mesma trava: a carga aberta de qualquer disparo (o pedido manual aguardando ou já assumido por outro
    // processo do worker) segura a agendada, que fica para a volta seguinte; a aberta há mais do que o teto não.
    const abertas = await tx.consultar<{ id: unknown; ocorrido_em: unknown }>(
      `SELECT id, ocorrido_em FROM carga_data_mart
        WHERE estabelecimento_id = ? AND assunto = ? AND situacao = 'em_execucao'`,
      [e.estabelecimento, ASSUNTO_CARGA_DATAMART],
      { teto: 50 },
    );
    const vistas = abertas.map((a) => ({ id: Number(a.id), ocorridoEm: quando(a.ocorrido_em) ?? e.inicio }));
    if (!podeAbrirAgendada(vistas, e.inicio)) return { carga: null };
    const carga = await tx.incluir('carga_data_mart', {
      estabelecimento_id: e.estabelecimento,
      assunto: ASSUNTO_CARGA_DATAMART,
      tipo_carga: 'completa',
      disparo: 'agendado',
      ocorrido_em: e.inicio,
      situacao: 'em_execucao',
    });
    return { carga };
  },
  alvo: (e) => ({ tabela: 'estabelecimento', id: e.estabelecimento }),
});

const ASSUMIR = z.object({
  estabelecimento: z.number().int().positive(),
  carga: z.number().int().positive(),
});

const operacaoAssumir = definirOperacao<z.infer<typeof ASSUMIR>, { assumida: boolean }>({
  nome: 'relatorio.datamart.carga_assumir',
  tabelas: ['carga_data_mart'],
  entrada: ASSUMIR,
  gravar: async (tx, e) => {
    const c = await tx.consultarParaAtualizar<{ versao: unknown; situacao: unknown; pedido: unknown }>(
      `SELECT versao, situacao, JSON_UNQUOTE(JSON_EXTRACT(dados, '$.pedido')) AS pedido
         FROM carga_data_mart WHERE id = ? AND estabelecimento_id = ? AND disparo = 'manual'`,
      [e.carga, e.estabelecimento],
      { teto: 1 },
    );
    const linha = c[0];
    if (!linha || String(linha.situacao) !== 'em_execucao' || String(linha.pedido) !== PEDIDO_AGUARDANDO)
      return { assumida: false };
    await tx.alterar('carga_data_mart', e.carga, Number(linha.versao), {
      dados: JSON.stringify({ pedido: PEDIDO_INICIADO }),
    });
    return { assumida: true };
  },
  alvo: (e) => ({ tabela: 'carga_data_mart', id: e.carga }),
});

const operacaoConcluir = definirOperacao<z.infer<typeof CONCLUIR>, { etapas: number }>({
  nome: 'relatorio.datamart.carga_concluir',
  tabelas: ['carga_data_mart', 'carga_data_mart_etapa'],
  entrada: CONCLUIR,
  gravar: async (tx, e) => {
    const c = await tx.consultarParaAtualizar<{
      versao: unknown;
      ocorrido_em: unknown;
      situacao: unknown;
      pedido: unknown;
    }>(
      `SELECT versao, ocorrido_em, situacao, JSON_UNQUOTE(JSON_EXTRACT(dados, '$.pedido')) AS pedido
         FROM carga_data_mart WHERE id = ? AND estabelecimento_id = ?`,
      [e.carga, e.estabelecimento],
      { teto: 1 },
    );
    const linha = c[0];
    if (!linha) throw new Error('carga do data mart não encontrada');
    if (String(linha.situacao) !== 'em_execucao') throw new Error('carga do data mart já fechada');
    const inicio = quando(linha.ocorrido_em) ?? e.fim;
    let t = inicio.getTime();
    for (const x of e.etapas) {
      const iniciado = new Date(Math.min(t, e.fim.getTime()));
      const concluido = new Date(Math.min(t + x.duracaoMs, e.fim.getTime()));
      await tx.incluir('carga_data_mart_etapa', {
        carga_data_mart_id: e.carga,
        sequencia: x.sequencia,
        tipo_objeto: x.tipoObjeto,
        objeto_carga: x.objeto,
        iniciado_em: iniciado,
        concluido_em: concluido,
        duracao_ms: x.duracaoMs,
        linhas_gravadas: x.situacao === 'falhou' ? 0 : x.linhas,
        linhas_posteriores: x.situacao === 'falhou' ? null : x.linhas,
        situacao: x.situacao,
        mensagem_erro: x.situacao === 'falhou' ? e.mensagemErro : null,
      });
      t += x.duracaoMs;
    }
    await tx.alterar('carga_data_mart', e.carga, Number(linha.versao), {
      situacao: e.situacao,
      concluido_em: e.fim.getTime() < inicio.getTime() ? inicio : e.fim,
      linhas_lidas: e.linhasGravadas + e.linhasRejeitadas,
      linhas_gravadas: e.linhasGravadas,
      linhas_rejeitadas: e.linhasRejeitadas,
      mensagem_erro: e.mensagemErro,
      dados: JSON.stringify({
        ...(linha.pedido ? { pedido: String(linha.pedido) } : {}),
        etapas: e.etapas.length,
        fatos: e.etapas.filter((x) => x.tipoObjeto === 'fato').length,
      }),
    });
    return { etapas: e.etapas.length };
  },
  alvo: (e) => ({ tabela: 'carga_data_mart', id: e.carga }),
});

export class PortaDataMartPropria implements PortaDataMart {
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
      { cliente: this.cliente, estabelecimento: est, correlacao: 'datamart-carga' },
      fn,
    );
  }

  private contexto(est: AlvoEstabelecimento) {
    return {
      cliente: this.cliente,
      estabelecimento: est.id,
      usuario: null,
      correlacao: 'datamart-carga',
      chaveIdempotencia: `worker.datamart.${est.id}.${randomUUID()}`,
    };
  }

  estabelecimentos(): Promise<AlvoEstabelecimento[]> {
    return this.ler(null, (l) => estabelecimentosAtivos(l, this.cliente));
  }

  ultimaIniciada(est: AlvoEstabelecimento): Promise<Date | null> {
    return this.ler(est.id, async (l) => {
      const r = await l.uma<{ ultima: unknown }>(
        `SELECT MAX(ocorrido_em) AS ultima FROM carga_data_mart
          WHERE estabelecimento_id = ? AND assunto = ? AND disparo = 'agendado'`,
        [est.id, ASSUNTO_CARGA_DATAMART],
      );
      return quando(r?.ultima);
    });
  }

  async abrir(est: AlvoEstabelecimento, inicio: Date, desde: Date): Promise<number | null> {
    const r = await this.executor.executar(
      operacaoAbrir,
      this.cliente,
      { estabelecimento: est.id, inicio, desde },
      this.contexto(est),
    );
    return r.resultado.carga;
  }

  pedidosAguardando(est: AlvoEstabelecimento): Promise<number[]> {
    return this.ler(est.id, async (l) =>
      (
        await l.consultar<{ id: unknown }>(
          `SELECT id FROM carga_data_mart
            WHERE estabelecimento_id = ? AND assunto = ? AND disparo = 'manual' AND situacao = 'em_execucao'
              AND JSON_UNQUOTE(JSON_EXTRACT(dados, '$.pedido')) = ?
            ORDER BY ocorrido_em, id LIMIT 10`,
          [est.id, ASSUNTO_CARGA_DATAMART, PEDIDO_AGUARDANDO],
        )
      ).map((x) => Number(x.id)),
    );
  }

  async assumir(est: AlvoEstabelecimento, carga: number): Promise<boolean> {
    const r = await this.executor.executar(
      operacaoAssumir,
      this.cliente,
      { estabelecimento: est.id, carga },
      this.contexto(est),
    );
    return r.resultado.assumida;
  }

  async concluir(est: AlvoEstabelecimento, carga: number, f: FechamentoDaCarga, fim: Date): Promise<void> {
    await this.executor.executar(
      operacaoConcluir,
      this.cliente,
      {
        estabelecimento: est.id,
        carga,
        situacao: f.situacao,
        linhasGravadas: f.linhasGravadas,
        linhasRejeitadas: f.linhasRejeitadas,
        mensagemErro: f.mensagemErro,
        etapas: f.etapas.map((x) => ({ ...x })),
        fim,
      },
      this.contexto(est),
    );
  }
}
