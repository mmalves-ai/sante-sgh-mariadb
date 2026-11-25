// SLA do contrato com fornecedor (09-AREA linha 88) sobre o MariaDB do cliente pelo Executor do núcleo (trilha na mesma
// transação, versão conferida, Idempotency-Key honrada). As regras são do domínio (`@sgh/contratos/regras-suprimentos`,
// sla-contrato); aqui ficam a leitura, a trava das linhas e a gravação:
//   - sla_contrato + faixa_sla_contrato: o SLA do contrato (ou de um serviço dele) com as faixas; o novo do mesmo modelo
//     e serviço fecha o vigente na véspera (nada apagado); o encerramento só fecha a vigência;
//   - ocorrencia_contrato (com sla_contrato_id): o chamado, a parada ou o realizado medido (evento `sla-medicao`, com o
//     tempo coberto em duracao_horas ou a quantidade em quantidade_producao) e a apuração do período (evento
//     `sla-apuracao`, com o desempenho, a faixa, a glosa, a multa e as parcelas impressas; tipo multa quando há valor).
// O histórico do contrato ignora esses eventos (não são eventos da tela do contrato) e a aba SLA os lê daqui.
import {
  type ApuracaoSla,
  apurarSla,
  conferirFaturaApuracaoSla,
  conferirMedicaoSla,
  conferirPeriodoApuracaoSla,
  conferirSlaContrato,
  type FaixaSlaEntrada,
  type MedicaoSla,
  type MedicaoSlaEntrada,
  type PenalidadeSla,
  planejarSlaContrato,
  type RecusaSuprimentos,
  type SlaApuravel,
  type SlaContratoEntrada,
  type TipoRegraSla,
  type UnidadeSla,
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

export const PORTA_SLA_CONTRATO = Symbol('PORTA_SLA_CONTRATO');
export const TABELAS_SLA_CONTRATO = ['sla_contrato', 'faixa_sla_contrato', 'ocorrencia_contrato'] as const;
export const OPERACOES_SLA_CONTRATO = {
  gravar: 'suprimentos.contrato.gravar-sla',
  encerrar: 'suprimentos.contrato.encerrar-sla',
  medir: 'suprimentos.contrato.medir-sla',
  apurar: 'suprimentos.contrato.apurar-sla',
} as const;
const TETO_MEDICOES = 200;

export interface MedicaoSlaGravada extends MedicaoSla {
  readonly medido: number | null;
  readonly usuario: string | null;
}

export interface ApuracaoSlaGravada {
  readonly id: number;
  readonly inicio: string;
  readonly fim: string;
  readonly desempenho: number;
  readonly faixa: string | null;
  readonly glosa: number;
  readonly multa: number;
  readonly total: number;
  readonly parcelas: readonly string[];
  readonly usuario: string | null;
  readonly em: string;
}

export interface SlaDetalhe {
  readonly id: number;
  readonly versao: number;
  readonly servico: number | null;
  readonly servicoDescricao: string | null;
  readonly descricao: string;
  readonly tipoRegra: TipoRegraSla;
  readonly unidade: UnidadeSla;
  readonly meta: number;
  readonly horarioInicio: string | null;
  readonly horarioFim: string | null;
  readonly somenteDiasUteis: boolean;
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string | null;
  readonly vigente: boolean;
  readonly faixas: readonly FaixaSlaEntrada[];
  readonly medicoes: readonly MedicaoSlaGravada[];
  readonly apuracoes: readonly ApuracaoSlaGravada[];
}

export interface PainelSlaContrato {
  readonly hoje: string;
  readonly agora: string;
  readonly contrato: {
    readonly id: number;
    readonly situacao: string;
    readonly inicio: string;
    readonly fim: string | null;
  };
  readonly slas: readonly SlaDetalhe[];
  readonly servicos: readonly { readonly id: number; readonly codigo: string; readonly descricao: string }[];
}

export interface PeriodoApuracaoSla {
  readonly inicio: string;
  readonly fim: string;
  readonly valorFatura: number | null;
}

export interface PortaSlaContrato {
  readonly destino: 'banco' | 'indisponivel';
  painel(c: ContextoPortaM18, contrato: number): Promise<PainelSlaContrato>;
  previa(c: ContextoPortaM18, contrato: number, sla: number, p: PeriodoApuracaoSla): Promise<ApuracaoSla>;
  gravar(
    c: ContextoPortaM18,
    contrato: number,
    e: SlaContratoEntrada,
    chave: string,
  ): Promise<{ id: number; fechados: number[] }>;
  encerrar(
    c: ContextoPortaM18,
    contrato: number,
    sla: number,
    fim: string,
    versao: number,
    chave: string,
  ): Promise<{ id: number }>;
  medir(
    c: ContextoPortaM18,
    contrato: number,
    sla: number,
    m: MedicaoSlaEntrada,
    chave: string,
  ): Promise<{ id: number; medido: number | null }>;
  apurar(
    c: ContextoPortaM18,
    contrato: number,
    sla: number,
    p: PeriodoApuracaoSla,
    chave: string,
  ): Promise<ApuracaoSlaGravada>;
}

export function portaSlaContratoIndisponivel(): PortaSlaContrato {
  const falha = (): never => {
    throw new ErroProblema('indisponivel', 503, 'O SLA do contrato exige o banco próprio.');
  };
  return {
    destino: 'indisponivel',
    painel: falha,
    previa: falha,
    gravar: falha,
    encerrar: falha,
    medir: falha,
    apurar: falha,
  };
}

const n = (v: unknown) => Number(v ?? 0);
const nn = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const tx_ = (v: unknown) => (v === null || v === undefined ? null : String(v));
const dataIso = (v: unknown): string | null =>
  v === null || v === undefined
    ? null
    : v instanceof Date
      ? v.toISOString().slice(0, 10)
      : String(v).slice(0, 10);
const hora = (v: unknown): string | null => (v === null || v === undefined ? null : String(v).slice(0, 5));
const json = (v: unknown): Record<string, unknown> =>
  v === null || v === undefined
    ? {}
    : typeof v === 'string'
      ? (JSON.parse(v) as Record<string, unknown>)
      : (v as Record<string, unknown>);
const instanteBanco = (i: string) => `${i.replace('T', ' ')}:00`;

function recusarTodas(rs: readonly RecusaSuprimentos[]): void {
  const [r] = rs;
  if (r)
    throw recusa(r.codigo, rs.map((x) => x.mensagem).join(' '), {
      campos: [...new Set(rs.flatMap((x) => x.campos ?? []))],
    });
}

const faixaDe = (r: Linha): FaixaSlaEntrada => ({
  codigo: String(r['codigo_faixa']),
  descricao: String(r['descricao']),
  desempenhoInicio: n(r['desempenho_inicio']),
  desempenhoFim: nn(r['desempenho_fim']),
  penalidade: String(r['tipo_penalidade']) as PenalidadeSla,
  percentualGlosa: nn(r['percentual_glosa']),
  valorMulta: nn(r['valor_multa']),
});

/** O contrato do estabelecimento (travado na gravação). */
async function contratoDe(
  l: Pick<Leitor, 'uma'> & Partial<Pick<TxOperacao, 'consultarParaAtualizar'>>,
  est: number,
  id: number,
  travar: boolean,
) {
  const sql = `SELECT id, situacao, vigencia_inicio, vigencia_fim FROM contrato_fornecedor
                WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`;
  const r =
    travar && l.consultarParaAtualizar
      ? (await l.consultarParaAtualizar<Linha>(sql, [id, est]))[0]
      : await l.uma<Linha>(sql, [id, est]);
  if (!r) throw recusa('nao-encontrado', 'O contrato não existe neste estabelecimento.');
  return {
    id: n(r['id']),
    situacao: String(r['situacao']),
    inicio: dataIso(r['vigencia_inicio'])!,
    fim: dataIso(r['vigencia_fim']),
  };
}

const SQL_SLA = `SELECT s.id, s.versao, s.servico_contratavel_id, sc.descricao AS servico_descricao, s.descricao, s.tipo_regra,
    s.unidade_medida, s.meta, TIME_FORMAT(s.horario_inicio, '%H:%i') AS horario_inicio,
    TIME_FORMAT(s.horario_fim, '%H:%i') AS horario_fim, s.somente_dias_uteis,
    DATE_FORMAT(s.vigencia_inicio, '%Y-%m-%d') AS vigencia_inicio, DATE_FORMAT(s.vigencia_fim, '%Y-%m-%d') AS vigencia_fim
   FROM sla_contrato s LEFT JOIN servico_contratavel sc ON sc.id = s.servico_contratavel_id
  WHERE s.contrato_fornecedor_id = ? AND s.ativo`;

async function faixasDe(l: Pick<Leitor, 'consultar'>, sla: number): Promise<FaixaSlaEntrada[]> {
  const rs = await l.consultar<Linha>(
    `SELECT codigo_faixa, descricao, desempenho_inicio, desempenho_fim, tipo_penalidade, percentual_glosa, valor_multa
       FROM faixa_sla_contrato WHERE sla_contrato_id = ? AND excluido_em IS NULL ORDER BY sequencia`,
    [sla],
  );
  return rs.map(faixaDe);
}

/** As medições do SLA: as mais recentes (a tela) ou as do período (a apuração; a parada que começou até 31 dias antes
 * ainda pode cair nele, e o domínio recorta). */
async function medicoesDe(
  l: Pick<Leitor, 'consultar'>,
  sla: number,
  periodo: { readonly inicio: string; readonly fim: string } | null,
): Promise<MedicaoSlaGravada[]> {
  const rs = await l.consultar<Linha>(
    `SELECT o.id, DATE_FORMAT(o.ocorrido_em, '%Y-%m-%dT%H:%i') AS inicio, o.dados, o.descricao, o.duracao_horas,
            o.quantidade_producao, u.login
       FROM ocorrencia_contrato o LEFT JOIN usuario u ON u.id = o.usuario_id
      WHERE o.sla_contrato_id = ? AND o.operacao = 'inclusao'
        AND JSON_UNQUOTE(JSON_EXTRACT(o.dados, '$.evento')) = 'sla-medicao'
        ${periodo ? 'AND o.ocorrido_em >= DATE_SUB(?, INTERVAL 31 DAY) AND o.ocorrido_em < DATE_ADD(?, INTERVAL 1 DAY)' : ''}
      ORDER BY o.ocorrido_em DESC, o.id DESC LIMIT ${periodo ? 100_000 : TETO_MEDICOES}`,
    periodo ? [sla, periodo.inicio, periodo.fim] : [sla],
  );
  return rs.map((r) => {
    const d = json(r['dados']);
    const fim = d['fim'] === null || d['fim'] === undefined ? null : String(d['fim']);
    const q = nn(r['quantidade_producao']);
    return {
      id: n(r['id']),
      inicio: String(r['inicio']),
      fim,
      quantidade: q,
      descricao: String(r['descricao'] ?? ''),
      medido: q ?? (d['medido'] === undefined ? nn(r['duracao_horas']) : nn(d['medido'])),
      usuario: tx_(r['login']),
    };
  });
}

async function apuracoesDe(l: Pick<Leitor, 'consultar'>, sla: number): Promise<ApuracaoSlaGravada[]> {
  const rs = await l.consultar<Linha>(
    `SELECT o.id, o.dados, o.valor, DATE_FORMAT(o.criado_em, '%Y-%m-%dT%H:%i') AS em, u.login
       FROM ocorrencia_contrato o LEFT JOIN usuario u ON u.id = o.usuario_id
      WHERE o.sla_contrato_id = ? AND o.operacao = 'inclusao'
        AND JSON_UNQUOTE(JSON_EXTRACT(o.dados, '$.evento')) = 'sla-apuracao'
      ORDER BY o.id DESC LIMIT 60`,
    [sla],
  );
  return rs.map((r) => {
    const d = json(r['dados']);
    return {
      id: n(r['id']),
      inicio: String(d['inicio']),
      fim: String(d['fim']),
      desempenho: n(d['desempenho']),
      faixa: tx_(d['faixa']),
      glosa: n(d['glosa']),
      multa: n(d['multa']),
      total: n(r['valor']),
      parcelas: (d['parcelas'] as string[] | undefined) ?? [],
      usuario: tx_(r['login']),
      em: String(r['em']),
    };
  });
}

async function feriadosDe(
  l: Pick<Leitor, 'consultar'>,
  est: number,
  desde: string,
  ate: string,
): Promise<Set<string>> {
  const rs = await l.consultar<Linha>(
    `SELECT DATE_FORMAT(f.data, '%Y-%m-%d') AS d FROM feriado f
      WHERE f.ativo AND NOT f.ponto_facultativo AND f.data BETWEEN ? AND ?
        AND (f.abrangencia = 'nacional' OR f.estabelecimento_id = ?)`,
    [desde, ate, est],
  );
  return new Set(rs.map((r) => String(r['d'])));
}

const slaDe = (r: Linha) => ({
  id: n(r['id']),
  versao: n(r['versao']),
  servico: nn(r['servico_contratavel_id']),
  servicoDescricao: tx_(r['servico_descricao']),
  descricao: String(r['descricao']),
  tipoRegra: String(r['tipo_regra']) as TipoRegraSla,
  unidade: String(r['unidade_medida']) as UnidadeSla,
  meta: n(r['meta']),
  horarioInicio: hora(r['horario_inicio']),
  horarioFim: hora(r['horario_fim']),
  somenteDiasUteis: n(r['somente_dias_uteis']) === 1,
  vigenciaInicio: String(r['vigencia_inicio']),
  vigenciaFim: tx_(r['vigencia_fim']),
});

async function agoraDe(l: Pick<Leitor, 'uma'>): Promise<{ hoje: string; agora: string }> {
  const r = await l.uma<Linha>(
    "SELECT DATE_FORMAT(NOW(), '%Y-%m-%d') AS hoje, DATE_FORMAT(NOW(), '%Y-%m-%dT%H:%i') AS agora",
    [],
  );
  return { hoje: String(r?.['hoje']), agora: String(r?.['agora']) };
}

export class PortaSlaContratoPropria implements PortaSlaContrato {
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
      correlacao: c.correlacao || 'sla-contrato',
    };
  }

  /** O SLA do contrato (travado na gravação), com as faixas, para a medição e a apuração. */
  private async slaDoContrato(l: Leitor | TxOperacao, contrato: number, sla: number, travar: boolean) {
    if (travar && 'consultarParaAtualizar' in l)
      await l.consultarParaAtualizar<Linha>(
        'SELECT id FROM sla_contrato WHERE id = ? AND contrato_fornecedor_id = ? AND ativo',
        [sla, contrato],
      );
    const r = await l.uma<Linha>(`${SQL_SLA} AND s.id = ?`, [contrato, sla]);
    if (!r) throw recusa('sla-inexistente', 'O SLA não existe neste contrato.');
    return { ...slaDe(r), faixas: await faixasDe(l, sla) };
  }

  private async apuracaoDe(
    l: Leitor | TxOperacao,
    est: number,
    contrato: number,
    slaId: number,
    p: PeriodoApuracaoSla,
    travar: boolean,
  ) {
    await contratoDe(l, est, contrato, travar);
    const sla = await this.slaDoContrato(l, contrato, slaId, travar);
    const { hoje } = await agoraDe(l);
    recusarTodas(conferirPeriodoApuracaoSla(p, sla, hoje));
    const apuravel: SlaApuravel = { ...sla, feriados: await feriadosDe(l, est, p.inicio, p.fim) };
    const medicoes = await medicoesDe(l, slaId, p);
    const a = apurarSla(apuravel, medicoes, p, p.valorFatura);
    recusarTodas(conferirFaturaApuracaoSla(a));
    return { sla, apuracao: a };
  }

  private async executar<R extends Readonly<Record<string, string | number | boolean | null>> & { id: number }>(
    c: ContextoPortaM18,
    nome: string,
    entrada: Record<string, unknown>,
    chave: string,
    gravar: (tx: TxOperacao, est: number) => Promise<R>,
    alvo: string,
  ): Promise<R> {
    const ctxN = this.contexto(c);
    const op = definirOperacao({
      nome,
      tabelas: [...TABELAS_SLA_CONTRATO],
      entrada: z.unknown(),
      gravar: (tx: TxOperacao) => gravar(tx, ctxN.estabelecimento),
      alvo: (_e, r: R) => ({ tabela: alvo, id: r.id }),
      trilha: () => ({ dados: entrada, motivo: null }),
    });
    const ctx: ContextoOperacao = { ...ctxN, chaveIdempotencia: chave };
    const { resultado } = await this.executor.executar(op, c.cliente, entrada, ctx);
    return resultado as R;
  }

  painel(c: ContextoPortaM18, contrato: number): Promise<PainelSlaContrato> {
    const ctx = this.contexto(c);
    return this.nucleo.lerSomente(ctx, async (l) => {
      const k = await contratoDe(l, ctx.estabelecimento, contrato, false);
      const { hoje, agora } = await agoraDe(l);
      const linhas = await l.consultar<Linha>(`${SQL_SLA} ORDER BY s.vigencia_inicio DESC, s.id DESC`, [
        contrato,
      ]);
      const slas: SlaDetalhe[] = [];
      for (const r of linhas) {
        const s = slaDe(r);
        slas.push({
          ...s,
          vigente: s.vigenciaInicio <= hoje && (s.vigenciaFim === null || s.vigenciaFim >= hoje),
          faixas: await faixasDe(l, s.id),
          medicoes: await medicoesDe(l, s.id, null),
          apuracoes: await apuracoesDe(l, s.id),
        });
      }
      const servicos = await l.consultar<Linha>(
        'SELECT id, codigo, descricao FROM servico_contratavel WHERE ativo AND excluido_em IS NULL ORDER BY descricao LIMIT 500',
        [],
      );
      return {
        hoje,
        agora,
        contrato: k,
        slas,
        servicos: servicos.map((x) => ({
          id: n(x['id']),
          codigo: String(x['codigo']),
          descricao: String(x['descricao']),
        })),
      };
    });
  }

  previa(c: ContextoPortaM18, contrato: number, sla: number, p: PeriodoApuracaoSla): Promise<ApuracaoSla> {
    const ctx = this.contexto(c);
    return this.nucleo.lerSomente(
      ctx,
      async (l) => (await this.apuracaoDe(l, ctx.estabelecimento, contrato, sla, p, false)).apuracao,
    );
  }

  gravar(c: ContextoPortaM18, contrato: number, e: SlaContratoEntrada, chave: string) {
    const entrada = { contrato, ...e, faixas: e.faixas.map((f) => ({ ...f })) };
    return this.executar(
      c,
      OPERACOES_SLA_CONTRATO.gravar,
      entrada,
      chave,
      async (tx, est) => {
        const k = await contratoDe(tx, est, contrato, true);
        recusarTodas(conferirSlaContrato(e, k));
        if (e.servico !== null) {
          const s = await tx.uma<Linha>(
            'SELECT id FROM servico_contratavel WHERE id = ? AND ativo AND excluido_em IS NULL',
            [e.servico],
          );
          if (!s)
            throw recusa('servico-inexistente', 'O serviço não existe ou está inativo.', {
              campos: ['servico'],
            });
        }
        const existentes = (
          await tx.consultarParaAtualizar<Linha>(
            `SELECT id, versao, servico_contratavel_id, tipo_regra, DATE_FORMAT(vigencia_inicio, '%Y-%m-%d') AS inicio,
                    DATE_FORMAT(vigencia_fim, '%Y-%m-%d') AS fim
               FROM sla_contrato WHERE contrato_fornecedor_id = ? AND ativo`,
            [contrato],
          )
        ).map((r) => ({
          id: n(r['id']),
          versao: n(r['versao']),
          servico: nn(r['servico_contratavel_id']),
          tipoRegra: String(r['tipo_regra']) as TipoRegraSla,
          inicio: String(r['inicio']),
          fim: tx_(r['fim']),
        }));
        const plano = planejarSlaContrato(e, existentes);
        recusarTodas(plano.recusas);
        for (const id of plano.fechar) {
          const x = existentes.find((y) => y.id === id)!;
          await tx.alterar('sla_contrato', id, x.versao, { vigencia_fim: plano.fim });
        }
        const id = await tx.incluir('sla_contrato', {
          contrato_fornecedor_id: contrato,
          servico_contratavel_id: e.servico,
          descricao: e.descricao.trim(),
          tipo_regra: e.tipoRegra,
          unidade_medida: e.unidade,
          meta: e.meta,
          producao_minima: e.tipoRegra === 'producao' ? e.meta : null,
          horario_inicio: e.horarioInicio,
          horario_fim: e.horarioFim,
          somente_dias_uteis: e.somenteDiasUteis,
          vigencia_inicio: e.vigenciaInicio,
          vigencia_fim: e.vigenciaFim,
          ativo: true,
        });
        let sequencia = 0;
        for (const f of e.faixas)
          await tx.incluir('faixa_sla_contrato', {
            sla_contrato_id: id,
            sequencia: ++sequencia,
            codigo_faixa: f.codigo.toUpperCase(),
            descricao: f.descricao.trim(),
            desempenho_inicio: f.desempenhoInicio,
            desempenho_fim: f.desempenhoFim,
            tipo_penalidade: f.penalidade,
            percentual_glosa: f.percentualGlosa,
            valor_multa: f.valorMulta,
          });
        return { id, fechados: plano.fechar.join(',') };
      },
      'sla_contrato',
    ).then((r) => ({
      id: r.id,
      fechados: String(r.fechados ?? '')
        .split(',')
        .filter(Boolean)
        .map(Number),
    }));
  }

  encerrar(c: ContextoPortaM18, contrato: number, sla: number, fim: string, versao: number, chave: string) {
    return this.executar(
      c,
      OPERACOES_SLA_CONTRATO.encerrar,
      { contrato, sla, fim, versao },
      chave,
      async (tx, est) => {
        await contratoDe(tx, est, contrato, true);
        const s = await this.slaDoContrato(tx, contrato, sla, true);
        if (fim < s.vigenciaInicio || (s.vigenciaFim !== null && fim > s.vigenciaFim))
          throw recusa(
            'sla-vigencia',
            'O encerramento fica entre o início e o fim atual da vigência do SLA.',
            { campos: ['fim'] },
          );
        const apurada = await tx.uma<Linha>(
          `SELECT id FROM ocorrencia_contrato WHERE sla_contrato_id = ? AND operacao = 'inclusao'
              AND JSON_UNQUOTE(JSON_EXTRACT(dados, '$.evento')) = 'sla-apuracao'
              AND JSON_UNQUOTE(JSON_EXTRACT(dados, '$.fim')) > ? LIMIT 1`,
          [sla, fim],
        );
        if (apurada)
          throw recusa('sla-apurado', 'Já há apuração depois dessa data: encerre a partir do fim dela.', {
            campos: ['fim'],
          });
        await tx.alterar('sla_contrato', sla, versao, { vigencia_fim: fim });
        return { id: sla };
      },
      'sla_contrato',
    );
  }

  medir(c: ContextoPortaM18, contrato: number, sla: number, m: MedicaoSlaEntrada, chave: string) {
    return this.executar(
      c,
      OPERACOES_SLA_CONTRATO.medir,
      { contrato, sla, ...m },
      chave,
      async (tx, est) => {
        await contratoDe(tx, est, contrato, false);
        const s = await this.slaDoContrato(tx, contrato, sla, false);
        const { agora } = await agoraDe(tx);
        recusarTodas(
          conferirMedicaoSla(s.tipoRegra, m, agora, { inicio: s.vigenciaInicio, fim: s.vigenciaFim }),
        );
        // O tempo coberto do chamado ou da parada, na unidade do SLA (o histórico guarda também as horas).
        const feriados = await feriadosDe(tx, est, m.inicio.slice(0, 10), (m.fim ?? m.inicio).slice(0, 10));
        const a = apurarSla(
          { ...s, feriados },
          [{ id: 0, ...m }],
          { inicio: m.inicio.slice(0, 10), fim: m.inicio.slice(0, 10) },
          null,
        );
        const medido = s.tipoRegra === 'producao' ? m.quantidade : (a.medicoes[0]?.medido ?? 0);
        const minutos = s.tipoRegra === 'disponibilidade' ? a.minutosParados : null;
        const id = await tx.incluir('ocorrencia_contrato', {
          contrato_fornecedor_id: contrato,
          operacao: 'inclusao',
          dados: JSON.stringify({
            evento: 'sla-medicao',
            inicio: m.inicio,
            fim: m.fim,
            medido,
            minutosParados: minutos,
          }),
          ocorrido_em: instanteBanco(m.inicio),
          usuario_id: tx.contexto.usuario,
          tipo_ocorrencia:
            s.tipoRegra === 'producao'
              ? 'apontamento'
              : s.tipoRegra === 'disponibilidade'
                ? 'falha'
                : 'atraso',
          sla_contrato_id: sla,
          descricao: m.descricao.trim(),
          quantidade_producao: s.tipoRegra === 'producao' ? m.quantidade : null,
          duracao_horas:
            s.tipoRegra === 'producao' || medido === null
              ? null
              : s.tipoRegra === 'disponibilidade'
                ? Math.round(((minutos ?? 0) / 60) * 10000) / 10000
                : s.unidade === 'hora'
                  ? medido
                  : s.unidade === 'dia'
                    ? medido * 24
                    : Math.round((medido / 60) * 10000) / 10000,
        });
        return { id, medido: s.tipoRegra === 'disponibilidade' ? minutos : medido };
      },
      'ocorrencia_contrato',
    );
  }

  async apurar(c: ContextoPortaM18, contrato: number, sla: number, p: PeriodoApuracaoSla, chave: string) {
    const r = await this.executar(
      c,
      OPERACOES_SLA_CONTRATO.apurar,
      { contrato, sla, ...p },
      chave,
      async (tx, est) => {
        const { apuracao: a } = await this.apuracaoDe(tx, est, contrato, sla, p, true);
        const repetida = await tx.uma<Linha>(
          `SELECT id FROM ocorrencia_contrato WHERE sla_contrato_id = ? AND operacao = 'inclusao'
              AND JSON_UNQUOTE(JSON_EXTRACT(dados, '$.evento')) = 'sla-apuracao'
              AND JSON_UNQUOTE(JSON_EXTRACT(dados, '$.inicio')) <= ? AND JSON_UNQUOTE(JSON_EXTRACT(dados, '$.fim')) >= ? LIMIT 1`,
          [sla, p.fim, p.inicio],
        );
        if (repetida)
          throw recusa(
            'periodo-ja-apurado',
            'Este período já tem apuração neste SLA (o histórico não se refaz).',
            { campos: ['inicio'] },
          );
        const id = await tx.incluir('ocorrencia_contrato', {
          contrato_fornecedor_id: contrato,
          operacao: 'inclusao',
          dados: JSON.stringify({
            evento: 'sla-apuracao',
            inicio: a.inicio,
            fim: a.fim,
            desempenho: a.desempenho,
            metaAtingida: a.metaAtingida,
            faixa: a.faixa?.codigo ?? null,
            penalidade: a.faixa?.penalidade ?? null,
            valorFatura: a.valorFatura,
            glosa: a.glosa,
            multa: a.multa,
            considerados: a.considerados,
            parcelas: a.parcelas,
            medicoes: a.medicoes.map((x) => x.id),
          }),
          ocorrido_em: `${a.fim} 23:59:59`,
          usuario_id: tx.contexto.usuario,
          tipo_ocorrencia: a.total > 0 ? 'multa' : 'apontamento',
          sla_contrato_id: sla,
          descricao: `Apuração do SLA de ${a.inicio} a ${a.fim}: desempenho ${a.desempenho}%${a.faixa ? `, faixa ${a.faixa.codigo}` : ''}`,
          valor: a.total,
          gerada_automaticamente: true,
        });
        return { id };
      },
      'ocorrencia_contrato',
    );
    // A apuração gravada, relida do histórico (a repetição pela chave devolve a mesma).
    const ctx = this.contexto(c);
    const gravada = await this.nucleo.lerSomente(ctx, async (l) =>
      (await apuracoesDe(l, sla)).find((x) => x.id === r.id),
    );
    if (!gravada) throw recusa('sla-inexistente', 'A apuração não foi encontrada neste SLA.');
    return gravada;
  }
}
