// Porta do centro cirúrgico (M18) sobre o banco do cliente, pelo @sgh/nucleo: leituras somente leitura nas tabelas do
// bloco (sala_cirurgica, permissao_sala_usuario, agendamento_cirurgico e itens, reagendamento_cirurgico,
// suspensao_cirurgia, pendencia_agendamento_cirurgico, ato_cirurgico e itens) e gravações pelo Executor (operacoes.ts e a
// gravação direta abaixo): trilha, outbox e idempotência na mesma transação. Toda leitura filtra o estabelecimento da
// sessão e os registros excluídos; os cadastros (procedimento, caráter, anestesia, fonte pagadora, especialidade,
// profissional) são da rede inteira.
// Melhoria: o pedido e a agenda são uma linha só (agendamento_cirurgico.situacao), sem espelho de estado; a sala, o
// procedimento, o convênio e os profissionais são ids do modelo; o histórico vem do reagendamento_cirurgico gravado na
// mesma transação; o horário é o civil do fuso do estabelecimento (estabelecimento.fuso_horario).
// Melhoria: a situação do modelo chega à tela como o estado do domínio (estadoDaSituacao), com a versão lida para a
// trava otimista da mudança de estado; a trilha da gravação direta leva a tabela real gravada e a chave de idempotência
// da requisição (o reenvio não grava de novo).
// Os pedidos do portal do médico externo vêm da conta do portal no agendamento (conta_portal_profissional_externo_id,
// com o nome e o nascimento informados) e as versões do pedido corrigido, de agendamento_cirurgico_versao.
import { randomUUID } from 'node:crypto';
import {
  type ContextoOperacao,
  definirOperacao,
  type Executor,
  type Leitor,
  type NucleoProprio,
  recusa,
  type ResultadoOperacao,
} from '@sgh/nucleo';
import { estadoDaSituacao, FUNCOES_AGENDA } from '@sgh/dominio-cirurgia';
import { z } from 'zod';
import {
  type ContextoPortaM18,
  type LiberacaoGravacao,
  portaIndisponivel,
  type TrilhaDaGravacao,
} from '../exames/public-api.js';
import { civil, dataOuNulo, FUSO_PADRAO, instante, lista, n, nn, texto, verdadeiro } from './banco-apoio.js';
import { buscarProcedimentosComSugestao } from './procedimento-cirurgico-propria.js';
import {
  type EscritaDireta,
  gravadorCirurgia,
  OPERACOES_CIRURGIA,
  TABELAS_GRAVACAO_DIRETA,
} from './operacoes.js';
import {
  type ContextoGravacaoCirurgia,
  type GravadorSghCirurgia,
  METODOS_PORTA_CIRURGIA,
  type PacienteDaCirurgia,
  type PortaCirurgia,
} from './porta.js';
import type {
  AgendamentoDaSala,
  AtoRealizado,
  CancelamentoDaAgenda,
  FiltroRealizadas,
  HistoricoDaAgenda,
  HistoricoDaAgendaNoPeriodo,
  LigacaoDoAto,
  OpcoesDaCirurgia,
  PedidoCirurgia,
  PendenciaDoPedido,
  ProfissionalDoBloco,
  RegistroComplementarAto,
  RelogioDoEstabelecimento,
  SalaDoBloco,
  UsuarioDaSala,
  VersaoDoPedido,
} from './tipos.js';

/** O mínimo do núcleo que a porta usa. */
export type NucleoCirurgia = Pick<NucleoProprio, 'lerSomente' | 'criarExecutor'>;
type Linha = Record<string, unknown>;

/** Teto das listas do mapa (o resto vem com `truncado`). */
export const TETO_CIRURGIA = 500;
/** Situações em que o agendamento ocupa a sala. */
export const SITUACOES_NA_SALA = ['agendado', 'confirmado', 'no_bloco', 'em_andamento', 'realizado'] as const;
const NA_SALA = SITUACOES_NA_SALA.map((s) => `'${s}'`).join(', ');
/** Funções da equipe lidas da agenda: as da tela mais o pediatra (par próprio da resposta). */
const FUNCOES_LIDAS: readonly { funcao: string; cod: string; id: string }[] = [
  ...FUNCOES_AGENDA,
  { funcao: 'pediatra', cod: '__SEM_COD__', id: 'ID_TBCBOPRO_PEDIATRA' },
];

const SQL_AGENDAMENTO = `
  SELECT a.id, a.sala_cirurgica_id, a.inicio_previsto_em, a.duracao_prevista_minutos, a.tempo_limpeza_minutos,
         pf.nome AS paciente, p.numero_prontuario, a.paciente_id, a.atendimento_id, a.regime_paciente,
         a.fonte_pagadora_id, a.especialidade_medica_id, a.tipo_anestesia_id, a.reserva_uti, a.observacao,
         a.cirurgiao_profissional_id, a.carater_cirurgia_id, a.situacao, a.solicitado_em, a.cancelado_em,
         a.alterado_em, a.versao, u.login AS usuario, ms.codigo AS motivo,
         a.conta_portal_profissional_externo_id, a.paciente_informado, a.nascimento_informado,
         (SELECT ap.procedimento_cirurgico_id FROM agendamento_cirurgico_procedimento ap
           WHERE ap.agendamento_cirurgico_id = a.id AND ap.principal = TRUE AND ap.excluido_em IS NULL LIMIT 1) AS procedimento,
         (SELECT COUNT(*) FROM pendencia_agendamento_cirurgico pa
           WHERE pa.agendamento_cirurgico_id = a.id AND pa.excluido_em IS NULL
             AND pa.situacao IN ('aberta', 'em_andamento')) AS pendencias_abertas
    FROM agendamento_cirurgico a
    LEFT JOIN paciente p ON p.id = a.paciente_id
    LEFT JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
    LEFT JOIN usuario u ON u.id = a.criado_por
    LEFT JOIN motivo_suspensao_cirurgia ms ON ms.id = a.motivo_suspensao_cirurgia_id
   WHERE a.estabelecimento_id = ? AND a.excluido_em IS NULL`;

const SQL_ATO = `
  SELECT t.id, t.atendimento_id, t.agendamento_cirurgico_id, t.sala_cirurgica_id, t.tipo_anestesia_id,
         t.entrada_sala_em, t.inicio_cirurgia_em, t.fim_cirurgia_em, t.saida_sala_em, t.observacao,
         pc.codigo AS porte, cc.codigo AS contaminacao, pf.nome AS paciente
    FROM ato_cirurgico t
    JOIN paciente p ON p.id = t.paciente_id
    JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
    LEFT JOIN porte_cirurgico pc ON pc.id = t.porte_cirurgico_id
    LEFT JOIN classe_contaminacao_cirurgica cc ON cc.id = t.classe_contaminacao_cirurgica_id
   WHERE t.estabelecimento_id = ? AND t.excluido_em IS NULL AND t.situacao <> 'cancelado'`;

export function contextoDe(c: ContextoPortaM18) {
  return { cliente: c.cliente, correlacao: c.correlacao || 'cirurgia' };
}

export class PortaCirurgiaPropria implements PortaCirurgia {
  readonly destino = 'banco' as const;
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: NucleoCirurgia,
    executorPronto?: Executor,
  ) {
    this.executor = executorPronto ?? nucleo.criarExecutor();
  }

  private ler<T>(c: ContextoPortaM18, fn: (l: Leitor, est: number, fuso: string) => Promise<T>): Promise<T> {
    const est = c.estabelecimento;
    if (est === null)
      return Promise.reject(recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.'));
    return this.nucleo.lerSomente(contextoDe(c), async (l) => {
      const f = await l.uma<{ fuso_horario: string | null }>(
        'SELECT fuso_horario FROM estabelecimento WHERE id = ?',
        [est],
      );
      return fn(l, est, f?.fuso_horario || FUSO_PADRAO);
    });
  }

  async podeGravar(c: ContextoPortaM18, op: string): Promise<LiberacaoGravacao> {
    const operacao = OPERACOES_CIRURGIA[op];
    if (!operacao) return { pode: false, codigo: 'operacao-desconhecida', motivo: 'Operação desconhecida.' };
    return this.executor.liberacao(operacao, {
      ...contextoDe(c),
      estabelecimento: c.estabelecimento,
      usuario: c.usuario,
      chaveIdempotencia: 'consulta.liberacao',
    });
  }

  async executar(c: ContextoPortaM18, op: string, entrada: unknown, ctx: ContextoOperacao) {
    const operacao = OPERACOES_CIRURGIA[op];
    if (!operacao) throw recusa('operacao-desconhecida', 'Operação desconhecida no centro cirúrgico.');
    const r = await this.executor.executar(operacao, c.cliente, entrada, ctx);
    return { resultado: r.resultado, repetida: r.repetida, trilha: r.trilha };
  }

  /**
   * Gravação direta (solicitação, andamento, pendência e revisão da ligação), pelo Executor, com a trilha junto. A
   * chave de idempotência é a da requisição (o reenvio devolve o mesmo resultado sem gravar de novo); sem ela, uma
   * chave única da chamada. A trilha leva a tabela e o id que o gravador escreveu, não o nome vindo da tela.
   */
  async gravarSgh<T>(
    c: ContextoGravacaoCirurgia,
    trilha: TrilhaDaGravacao | ((r: T) => TrilhaDaGravacao),
    fn: (g: GravadorSghCirurgia) => Promise<T>,
  ): Promise<T> {
    if (c.estabelecimento === null)
      throw recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.');
    let saida: { valor: T } | null = null;
    const escrita: { ultima: EscritaDireta | null } = { ultima: null };
    const linha = () => (typeof trilha === 'function' ? (saida ? trilha(saida.valor) : null) : trilha);
    const op = definirOperacao({
      nome: 'cirurgia.gravacao-direta',
      tabelas: TABELAS_GRAVACAO_DIRETA,
      entrada: z.object({ chave: z.string() }),
      async gravar(tx) {
        saida = { valor: await fn(gravadorCirurgia(tx, escrita)) };
        return { valor: saida.valor === undefined ? null : saida.valor } as unknown as ResultadoOperacao;
      },
      alvo: () => ({
        tabela: escrita.ultima?.tabela ?? 'agendamento_cirurgico',
        id: escrita.ultima?.id ?? linha()?.entidadeId ?? null,
      }),
      trilha: () => ({ dados: linha()?.dadosDepois ?? null, motivo: linha()?.motivo ?? null }),
    });
    const chave = c.chaveIdempotencia
      ? `cirurgia.direta:${c.chaveIdempotencia}`
      : `cirurgia.direta:${randomUUID()}`;
    const r = await this.executor.executar(
      op,
      c.cliente,
      { chave },
      {
        cliente: c.cliente,
        estabelecimento: c.estabelecimento,
        usuario: c.usuario,
        correlacao: c.correlacao || 'cirurgia',
        chaveIdempotencia: chave,
      },
    );
    if (r.repetida) return ((r.resultado as Record<string, unknown>)['valor'] ?? undefined) as T;
    if (!saida) throw new Error('Gravação direta sem resultado.');
    return (saida as { valor: T }).valor;
  }

  // ── Leituras ──────────────────────────────────────────────────────────────────────────────────────────────

  relogio(c: ContextoPortaM18): Promise<RelogioDoEstabelecimento> {
    return this.ler(c, async (_l, _e, fuso) => {
      const agora = civil(new Date(), fuso) ?? '';
      return { hoje: agora.slice(0, 10), hhmm: agora.slice(11, 16).replace(':', '') };
    });
  }

  salas(c: ContextoPortaM18, login: string): Promise<SalaDoBloco[]> {
    return this.ler(c, async (l, est) => {
      const r = await l.consultar(
        `SELECT s.id, s.descricao, s.centro_custo_id,
                (SELECT COUNT(*) FROM permissao_sala_usuario ps WHERE ps.sala_cirurgica_id = s.id AND ps.excluido_em IS NULL) AS usuarios,
                (SELECT COUNT(*) FROM permissao_sala_usuario ps JOIN usuario u ON u.id = ps.usuario_id
                  WHERE ps.sala_cirurgica_id = s.id AND ps.excluido_em IS NULL AND u.login = ?) AS permitida
           FROM sala_cirurgica s
          WHERE s.estabelecimento_id = ? AND s.excluido_em IS NULL AND s.situacao <> 'inativa'
          ORDER BY s.codigo`,
        [login, est],
      );
      return r.map((x) => ({
        codigo: n(x['id']),
        nome: texto(x['descricao']),
        centroCusto: n(x['centro_custo_id']),
        usuarios: n(x['usuarios']),
        permitida: n(x['permitida']) > 0,
      }));
    });
  }

  usuariosDaSala(c: ContextoPortaM18, sala: number): Promise<UsuarioDaSala[]> {
    return this.ler(c, async (l, est) => {
      const r = await l.consultar(
        `SELECT u.login, u.nome, u.situacao FROM permissao_sala_usuario ps
           JOIN sala_cirurgica s ON s.id = ps.sala_cirurgica_id
           JOIN usuario u ON u.id = ps.usuario_id
          WHERE ps.sala_cirurgica_id = ? AND s.estabelecimento_id = ? AND ps.excluido_em IS NULL
          ORDER BY u.login`,
        [sala, est],
      );
      return r.map((x) => ({
        login: texto(x['login']),
        nome: texto(x['nome']),
        ativo: x['situacao'] === 'ativo',
      }));
    });
  }

  private async equipes(
    l: Leitor,
    ids: readonly number[],
  ): Promise<Map<number, Record<string, number | null>>> {
    const m = new Map<number, Record<string, number | null>>();
    if (ids.length === 0) return m;
    const r = await l.consultar(
      `SELECT e.agendamento_cirurgico_id, e.profissional_id, f.codigo FROM agendamento_cirurgico_equipe e
         JOIN funcao_equipe_cirurgica f ON f.id = e.funcao_equipe_cirurgica_id
        WHERE e.agendamento_cirurgico_id IN (${lista(ids.length)}) AND e.excluido_em IS NULL`,
      [...ids],
    );
    for (const x of r) {
      const ag = n(x['agendamento_cirurgico_id']);
      const pares = m.get(ag) ?? {};
      const f = FUNCOES_LIDAS.find((y) => y.funcao === texto(x['codigo']));
      if (f) {
        pares[f.id] = n(x['profissional_id']);
        pares[f.cod] = n(x['profissional_id']);
      }
      m.set(ag, pares);
    }
    return m;
  }

  private async agendamentosDe(l: Leitor, linhas: Linha[], fuso: string): Promise<AgendamentoDaSala[]> {
    const eq = await this.equipes(
      l,
      linhas.map((x) => n(x['id'])),
    );
    return linhas.map((x) => ({
      id: n(x['id']),
      sala: n(x['sala_cirurgica_id']),
      inicio: civil(x['inicio_previsto_em'], fuso) ?? '',
      duracaoMin: n(x['duracao_prevista_minutos']),
      intervaloMin: n(x['tempo_limpeza_minutos']),
      paciente: texto(x['paciente']),
      prontuario: n(x['numero_prontuario']),
      reg: n(x['atendimento_id']),
      atendimento: x['regime_paciente'] === 'externo' ? 'E' : 'I',
      convenio: n(x['fonte_pagadora_id']),
      procedimento: n(x['procedimento']),
      especialidade: n(x['especialidade_medica_id']),
      anestesia: n(x['tipo_anestesia_id']),
      pares: eq.get(n(x['id'])) ?? {},
      recursos: verdadeiro(x['reserva_uti']) ? ['cti'] : [],
      observacao: texto(x['observacao']),
      usuario: texto(x['usuario']),
    }));
  }

  private pedidoDe(x: Linha, fuso: string): PedidoCirurgia {
    const sit = texto(x['situacao']);
    return {
      id: n(x['id']),
      agendamento: (SITUACOES_NA_SALA as readonly string[]).includes(sit) ? n(x['id']) : null,
      sala: n(x['sala_cirurgica_id']),
      inicio: civil(x['inicio_previsto_em'], fuso) ?? '',
      duracaoMin: n(x['duracao_prevista_minutos']),
      intervaloMin: n(x['tempo_limpeza_minutos']),
      reg: n(x['atendimento_id']),
      prontuario: n(x['numero_prontuario']),
      idPaciente: nn(x['paciente_id']),
      procedimento: n(x['procedimento']),
      convenio: n(x['fonte_pagadora_id']),
      cirurgiao: nn(x['cirurgiao_profissional_id']),
      carater: nn(x['carater_cirurgia_id']),
      anestesia: nn(x['tipo_anestesia_id']),
      // Código desconhecido segue cru: a tela o trata como estado inválido (sem ação), nunca como outro estado.
      estado: estadoDaSituacao(sit) ?? sit,
      versao: n(x['versao']),
      motivo: x['motivo'] === null || x['motivo'] === undefined ? null : texto(x['motivo']),
      complemento: null,
      solicitante: null,
      observacao: x['observacao'] === null || x['observacao'] === undefined ? null : texto(x['observacao']),
      criadoPor: texto(x['usuario']),
      atualizadoEm: civil(x['alterado_em'], fuso),
      pendenciasAbertas: n(x['pendencias_abertas']),
      excecao: false,
      portal:
        x['conta_portal_profissional_externo_id'] === null ||
        x['conta_portal_profissional_externo_id'] === undefined
          ? null
          : {
              acesso: n(x['conta_portal_profissional_externo_id']),
              paciente: texto(x['paciente_informado'] ?? x['paciente']),
              nascimento: dataOuNulo(x['nascimento_informado']),
            },
    };
  }

  agendamentos(c: ContextoPortaM18, de: string, ate: string, salas: readonly number[] | null) {
    return this.ler(c, async (l, est, fuso) => {
      const filtroSala =
        salas && salas.length > 0 ? ` AND a.sala_cirurgica_id IN (${lista(salas.length)})` : '';
      const r = await l.consultar(
        `${SQL_AGENDAMENTO} AND a.situacao IN (${NA_SALA}) AND a.inicio_previsto_em >= ? AND a.inicio_previsto_em < ?${filtroSala}
          ORDER BY a.inicio_previsto_em, a.id LIMIT ${TETO_CIRURGIA + 1}`,
        [est, instante(`${de} 00:00`, fuso), instante(`${ate} 23:59`, fuso, 1), ...(salas ?? [])],
      );
      const itens = await this.agendamentosDe(l, r.slice(0, TETO_CIRURGIA), fuso);
      return { itens, truncado: r.length > TETO_CIRURGIA };
    });
  }

  agendamento(c: ContextoPortaM18, id: number): Promise<AgendamentoDaSala | null> {
    return this.ler(c, async (l, est, fuso) => {
      const r = await l.consultar(`${SQL_AGENDAMENTO} AND a.situacao IN (${NA_SALA}) AND a.id = ?`, [
        est,
        id,
      ]);
      return (await this.agendamentosDe(l, r, fuso))[0] ?? null;
    });
  }

  adicionais(c: ContextoPortaM18, sala: number, inicio: string): Promise<number[]> {
    return this.ler(c, async (l, est, fuso) => {
      const r = await l.consultar(
        `SELECT ap.procedimento_cirurgico_id FROM agendamento_cirurgico_procedimento ap
           JOIN agendamento_cirurgico a ON a.id = ap.agendamento_cirurgico_id
          WHERE a.estabelecimento_id = ? AND a.sala_cirurgica_id = ? AND a.inicio_previsto_em = ?
            AND a.excluido_em IS NULL AND ap.excluido_em IS NULL AND ap.principal = FALSE
          ORDER BY ap.sequencia`,
        [est, sala, instante(inicio, fuso)],
      );
      return r.map((x) => n(x['procedimento_cirurgico_id']));
    });
  }

  private historicoDe(x: Linha, fuso: string): HistoricoDaAgenda {
    const op = texto(x['operacao']);
    return {
      quando: civil(x['ocorrido_em'], fuso) ?? '',
      usuario: texto(x['login']),
      operacao: op === 'inclusao' ? 'A' : op === 'alteracao' ? 'R' : 'E',
      salaAnterior: nn(x['anterior_sala_cirurgica_id']),
      inicioAnterior: civil(x['inicio_anterior'], fuso),
      sala: nn(x['nova_sala_cirurgica_id']),
      inicio: civil(x['inicio_novo'], fuso),
      justificativa:
        x['justificativa'] === null || x['justificativa'] === undefined ? null : texto(x['justificativa']),
    };
  }

  historico(c: ContextoPortaM18, sala: number, inicio: string): Promise<HistoricoDaAgenda[]> {
    return this.ler(c, async (l, est, fuso) => {
      const r = await l.consultar(
        `SELECT r.*, u.login FROM reagendamento_cirurgico r
           JOIN agendamento_cirurgico a ON a.id = r.agendamento_cirurgico_id
           LEFT JOIN usuario u ON u.id = r.usuario_id
          WHERE a.estabelecimento_id = ? AND a.excluido_em IS NULL
            AND a.id IN (SELECT a2.id FROM agendamento_cirurgico a2 WHERE a2.estabelecimento_id = ?
                          AND a2.sala_cirurgica_id = ? AND a2.inicio_previsto_em = ?)
          ORDER BY r.ocorrido_em, r.id LIMIT ${TETO_CIRURGIA}`,
        [est, est, sala, instante(inicio, fuso)],
      );
      return r.map((x) => this.historicoDe(x, fuso));
    });
  }

  historicoDoPeriodo(c: ContextoPortaM18, de: string, ate: string) {
    return this.ler(c, async (l, est, fuso) => {
      const r = await l.consultar(
        `SELECT r.*, u.login, pf.nome AS paciente, a.atendimento_id FROM reagendamento_cirurgico r
           JOIN agendamento_cirurgico a ON a.id = r.agendamento_cirurgico_id
           JOIN paciente p ON p.id = a.paciente_id
           JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
           LEFT JOIN usuario u ON u.id = r.usuario_id
          WHERE a.estabelecimento_id = ? AND a.excluido_em IS NULL AND r.ocorrido_em >= ? AND r.ocorrido_em < ?
          ORDER BY r.ocorrido_em, r.id LIMIT ${TETO_CIRURGIA + 1}`,
        [est, instante(`${de} 00:00`, fuso), instante(`${ate} 23:59`, fuso, 1)],
      );
      const itens: HistoricoDaAgendaNoPeriodo[] = r.slice(0, TETO_CIRURGIA).map((x) => ({
        ...this.historicoDe(x, fuso),
        paciente: texto(x['paciente']),
        reg: nn(x['atendimento_id']),
      }));
      return { itens, truncado: r.length > TETO_CIRURGIA };
    });
  }

  cancelados(c: ContextoPortaM18, de: string, ate: string) {
    return this.ler(c, async (l, est, fuso) => {
      const r = await l.consultar(
        `${SQL_AGENDAMENTO} AND a.situacao IN ('cancelado', 'suspenso') AND a.cancelado_em >= ? AND a.cancelado_em < ?
          ORDER BY a.cancelado_em, a.id LIMIT ${TETO_CIRURGIA + 1}`,
        [est, instante(`${de} 00:00`, fuso), instante(`${ate} 23:59`, fuso, 1)],
      );
      const itens: CancelamentoDaAgenda[] = r.slice(0, TETO_CIRURGIA).map((x) => ({
        id: n(x['id']),
        sala: n(x['sala_cirurgica_id']),
        inicio: civil(x['inicio_previsto_em'], fuso) ?? '',
        paciente: texto(x['paciente']),
        procedimento: n(x['procedimento']),
        atualizadoEm: civil(x['cancelado_em'], fuso) ?? '',
        usuario: texto(x['usuario']),
      }));
      return { itens, truncado: r.length > TETO_CIRURGIA };
    });
  }

  private async atosDe(l: Leitor, r: Linha[], fuso: string): Promise<AtoRealizado[]> {
    const ids = r.map((x) => n(x['id']));
    const procs = new Map<number, AtoRealizado['procedimentos']>();
    if (ids.length > 0) {
      const ps = await l.consultar(
        `SELECT ap.ato_cirurgico_id, ap.procedimento_cirurgico_id, pc.especialidade_medica_id
           FROM ato_cirurgico_procedimento ap JOIN procedimento_cirurgico pc ON pc.id = ap.procedimento_cirurgico_id
          WHERE ap.ato_cirurgico_id IN (${lista(ids.length)}) AND ap.excluido_em IS NULL ORDER BY ap.sequencia`,
        ids,
      );
      for (const p of ps) {
        const k = n(p['ato_cirurgico_id']);
        procs.set(k, [
          ...(procs.get(k) ?? []),
          {
            procedimento: n(p['procedimento_cirurgico_id']),
            especialidade: n(p['especialidade_medica_id']),
            tecnica: 0,
            pares: {},
          },
        ]);
      }
    }
    const hm = (v: unknown) => (civil(v, fuso) ?? '').slice(11, 16).replace(':', '');
    return r.map((x) => {
      const ini = civil(x['inicio_cirurgia_em'], fuso);
      const fim = civil(x['fim_cirurgia_em'], fuso);
      const minutos =
        x['inicio_cirurgia_em'] instanceof Date && x['fim_cirurgia_em'] instanceof Date
          ? Math.round(
              ((x['fim_cirurgia_em'] as Date).getTime() - (x['inicio_cirurgia_em'] as Date).getTime()) /
                60000,
            )
          : 0;
      return {
        id: n(x['id']),
        reg: n(x['atendimento_id']),
        data: (ini ?? civil(x['entrada_sala_em'], fuso) ?? '').slice(0, 10),
        sala: n(x['sala_cirurgica_id']),
        porte: texto(x['porte']),
        potencialContaminacao: texto(x['contaminacao']),
        tipoAnestesia: n(x['tipo_anestesia_id']),
        inicio: hm(x['inicio_cirurgia_em']),
        fim: fim ? hm(x['fim_cirurgia_em']) : '',
        duracao: `${String(Math.floor(minutos / 60)).padStart(2, '0')}${String(minutos % 60).padStart(2, '0')}`,
        paciente: texto(x['paciente']),
        procedimentos: procs.get(n(x['id'])) ?? [],
      };
    });
  }

  realizadas(c: ContextoPortaM18, f: FiltroRealizadas) {
    return this.ler(c, async (l, est, fuso) => {
      const cond: string[] = [];
      const p: unknown[] = [est];
      if (f.de) {
        cond.push('COALESCE(t.inicio_cirurgia_em, t.entrada_sala_em) >= ?');
        p.push(instante(`${f.de} 00:00`, fuso));
      }
      if (f.ate) {
        cond.push('COALESCE(t.inicio_cirurgia_em, t.entrada_sala_em) < ?');
        p.push(instante(`${f.ate} 23:59`, fuso, 1));
      }
      if (f.reg) {
        cond.push('t.atendimento_id = ?');
        p.push(f.reg);
      }
      if (f.sala) {
        cond.push('t.sala_cirurgica_id = ?');
        p.push(f.sala);
      }
      const r = await l.consultar(
        `${SQL_ATO}${cond.map((x) => ` AND ${x}`).join('')} ORDER BY t.inicio_cirurgia_em DESC, t.id DESC LIMIT ${TETO_CIRURGIA + 1}`,
        p,
      );
      return {
        itens: await this.atosDe(l, r.slice(0, TETO_CIRURGIA), fuso),
        truncado: r.length > TETO_CIRURGIA,
      };
    });
  }

  realizada(c: ContextoPortaM18, id: number): Promise<AtoRealizado | null> {
    return this.ler(
      c,
      async (l, est, fuso) =>
        (await this.atosDe(l, await l.consultar(`${SQL_ATO} AND t.id = ?`, [est, id]), fuso))[0] ?? null,
    );
  }

  agendamentosDosRegs(c: ContextoPortaM18, regs: readonly number[]) {
    if (regs.length === 0) return Promise.resolve([]);
    return this.ler(c, async (l, est, fuso) => {
      const r = await l.consultar(
        `SELECT a.id, a.atendimento_id, a.sala_cirurgica_id, a.inicio_previsto_em FROM agendamento_cirurgico a
          WHERE a.estabelecimento_id = ? AND a.excluido_em IS NULL AND a.situacao IN (${NA_SALA})
            AND a.atendimento_id IN (${lista(regs.length)})`,
        [est, ...regs],
      );
      return r.map((x) => ({
        id: n(x['id']),
        reg: n(x['atendimento_id']),
        sala: n(x['sala_cirurgica_id']),
        dia: (civil(x['inicio_previsto_em'], fuso) ?? '').slice(0, 10),
      }));
    });
  }

  // Profissionais: cadastro da rede inteira (profissional não tem estabelecimento).
  private profissionaisSql(
    filtro: string,
    p: unknown[],
    teto = 200,
  ): (l: Leitor) => Promise<ProfissionalDoBloco[]> {
    return async (l) =>
      (
        await l.consultar(
          `SELECT pr.id, COALESCE(pr.nome_exibicao, pf.nome) AS nome, pr.atua_cirurgiao, pr.atua_anestesista
             FROM profissional pr JOIN pessoa_fisica pf ON pf.id = pr.pessoa_fisica_id
            WHERE pr.excluido_em IS NULL${filtro} ORDER BY nome LIMIT ${teto}`,
          p,
        )
      ).map((x) => ({ id: n(x['id']), cod: n(x['id']), nome: texto(x['nome']) }));
  }

  profissionaisDoBloco(c: ContextoPortaM18): Promise<ProfissionalDoBloco[]> {
    return this.ler(c, (l) =>
      this.profissionaisSql(
        " AND pr.situacao = 'ativo' AND (pr.atua_cirurgiao = TRUE OR pr.atua_anestesista = TRUE OR pr.atua_auxiliar = TRUE)",
        [],
        2000,
      )(l),
    );
  }

  buscarProfissionais(c: ContextoPortaM18, q: string): Promise<ProfissionalDoBloco[]> {
    return this.ler(c, (l) =>
      this.profissionaisSql(
        " AND pr.situacao = 'ativo' AND (pf.nome LIKE ? OR pr.nome_exibicao LIKE ?)",
        [`%${q}%`, `%${q}%`],
        50,
      )(l),
    );
  }

  async nomesProfissionais(c: ContextoPortaM18, ids: readonly number[]): Promise<Map<number, string>> {
    if (ids.length === 0) return new Map();
    const r = await this.ler(c, (l) =>
      this.profissionaisSql(` AND pr.id IN (${lista(ids.length)})`, [...ids], ids.length)(l),
    );
    return new Map(r.map((x) => [x.id, x.nome]));
  }

  profissionaisPorRegistro(c: ContextoPortaM18, ids: readonly number[]): Promise<ProfissionalDoBloco[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return this.ler(c, async (l) => {
      const r = await l.consultar(
        `SELECT pr.id, COALESCE(pr.nome_exibicao, pf.nome) AS nome, pr.tipo, pr.atua_cirurgiao, pr.atua_anestesista
           FROM profissional pr JOIN pessoa_fisica pf ON pf.id = pr.pessoa_fisica_id
          WHERE pr.excluido_em IS NULL AND pr.id IN (${lista(ids.length)})`,
        [...ids],
      );
      // Médico: quem atua como cirurgião ou anestesista no cadastro (o conselho fica no cadastro do profissional).
      return r.map((x) => ({
        id: n(x['id']),
        cod: n(x['id']),
        nome: texto(x['nome']),
        medico: verdadeiro(x['atua_cirurgiao']) || verdadeiro(x['atua_anestesista']),
      }));
    });
  }

  // Procedimentos: catálogo da rede inteira.
  async nomesProcedimentos(c: ContextoPortaM18, codigos: readonly number[]): Promise<Map<number, string>> {
    if (codigos.length === 0) return new Map();
    const r = await this.ler(c, (l) =>
      l.consultar(`SELECT id, descricao FROM procedimento_cirurgico WHERE id IN (${lista(codigos.length)})`, [
        ...codigos,
      ]),
    );
    return new Map(r.map((x) => [n(x['id']), texto(x['descricao'])]));
  }

  /** Com as sugestões do cadastro do procedimento (caráter, anestesia, duração): C1-089. */
  buscarProcedimentos(c: ContextoPortaM18, q: string) {
    return this.ler(c, (l) => buscarProcedimentosComSugestao(l, q));
  }

  opcoes(c: ContextoPortaM18): Promise<OpcoesDaCirurgia> {
    return this.ler(c, async (l) => {
      const par = async (sql: string) =>
        (await l.consultar(sql)).map((x) => ({ codigo: n(x['id']), nome: texto(x['nome']) }));
      return {
        anestesias: await par(
          'SELECT id, descricao AS nome FROM tipo_anestesia WHERE ativo = TRUE ORDER BY descricao',
        ),
        caracteres: await par(
          'SELECT id, descricao AS nome FROM carater_cirurgia WHERE ativo = TRUE ORDER BY descricao',
        ),
        convenios: (
          await l.consultar(
            'SELECT id, nome, situacao FROM fonte_pagadora WHERE excluido_em IS NULL ORDER BY nome',
          )
        ).map((x) => ({ codigo: n(x['id']), nome: texto(x['nome']), ativo: x['situacao'] === 'ativa' })),
        especialidades: await par(
          'SELECT id, descricao AS nome FROM especialidade_medica WHERE ativo = TRUE ORDER BY descricao',
        ),
      };
    });
  }

  pacientePorProntuario(c: ContextoPortaM18, pront: number) {
    // Paciente: cadastro único da rede (o prontuário não é por estabelecimento).
    return this.ler(c, async (l) => {
      const x = await l.uma(
        `SELECT p.id, pf.nome FROM paciente p JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
          WHERE p.numero_prontuario = ? AND p.excluido_em IS NULL AND p.situacao <> 'unificado'`,
        [pront],
      );
      return x ? { id: n(x['id']), nome: texto(x['nome']) } : null;
    });
  }

  async pacientes(c: ContextoPortaM18, ids: readonly number[]): Promise<PacienteDaCirurgia[]> {
    if (ids.length === 0) return [];
    return this.ler(c, async (l) =>
      (
        await l.consultar(
          `SELECT p.id, pf.nome, p.numero_prontuario FROM paciente p JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
            WHERE p.id IN (${lista(ids.length)}) AND p.excluido_em IS NULL`,
          [...ids],
        )
      ).map((x) => ({ id: n(x['id']), nome: texto(x['nome']), prontuario: n(x['numero_prontuario']) })),
    );
  }

  estadosDoPeriodo(c: ContextoPortaM18, de: string, ate: string): Promise<PedidoCirurgia[]> {
    return this.ler(c, async (l, est, fuso) =>
      (
        await l.consultar(
          `${SQL_AGENDAMENTO} AND COALESCE(a.inicio_previsto_em, a.solicitado_em) >= ? AND COALESCE(a.inicio_previsto_em, a.solicitado_em) < ?
            ORDER BY a.inicio_previsto_em, a.id LIMIT ${TETO_CIRURGIA}`,
          [est, instante(`${de} 00:00`, fuso), instante(`${ate} 23:59`, fuso, 1)],
        )
      ).map((x) => this.pedidoDe(x, fuso)),
    );
  }

  async estadosDosAgendamentos(
    c: ContextoPortaM18,
    ids: readonly number[],
  ): Promise<Map<number, PedidoCirurgia>> {
    if (ids.length === 0) return new Map();
    const r = await this.ler(c, async (l, est, fuso) =>
      (await l.consultar(`${SQL_AGENDAMENTO} AND a.id IN (${lista(ids.length)})`, [est, ...ids])).map((x) =>
        this.pedidoDe(x, fuso),
      ),
    );
    return new Map(r.map((p) => [p.id, p]));
  }

  estado(c: ContextoPortaM18, id: number): Promise<PedidoCirurgia | null> {
    return this.ler(c, async (l, est, fuso) => {
      const x = (await l.consultar(`${SQL_AGENDAMENTO} AND a.id = ?`, [est, id]))[0];
      return x ? this.pedidoDe(x, fuso) : null;
    });
  }

  /** Os pedidos de uma conta do portal do médico externo desde a data (a solicitação ainda sem paciente cadastrado vem com o nome informado). */
  estadosDoPortal(c: ContextoPortaM18, acesso: number, desde: string): Promise<PedidoCirurgia[]> {
    return this.ler(c, async (l, est, fuso) =>
      (
        await l.consultar(
          `${SQL_AGENDAMENTO} AND a.conta_portal_profissional_externo_id = ? AND a.solicitado_em >= ?
            ORDER BY a.solicitado_em DESC, a.id DESC LIMIT ${TETO_CIRURGIA}`,
          [est, acesso, instante(`${desde.slice(0, 10)} 00:00`, fuso)],
        )
      ).map((x) => this.pedidoDe(x, fuso)),
    );
  }

  /** As versões anteriores dos pedidos (a mais nova primeiro em cada pedido), guardadas a cada correção. */
  versoesDosPedidos(c: ContextoPortaM18, ids: readonly number[]): Promise<VersaoDoPedido[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return this.ler(c, async (l, est, fuso) =>
      (
        await l.consultar(
          `SELECT v.agendamento_cirurgico_id, v.numero_versao, v.dados, v.motivo, v.substituida_em
             FROM agendamento_cirurgico_versao v
             JOIN agendamento_cirurgico a ON a.id = v.agendamento_cirurgico_id
            WHERE a.estabelecimento_id = ? AND v.excluido_em IS NULL
              AND v.agendamento_cirurgico_id IN (${lista(ids.length)})
            ORDER BY v.agendamento_cirurgico_id, v.numero_versao DESC`,
          [est, ...ids],
        )
      ).map((x) => {
        const d = (typeof x['dados'] === 'string' ? JSON.parse(x['dados']) : (x['dados'] ?? {})) as Linha;
        return {
          idEstado: n(x['agendamento_cirurgico_id']),
          versao: n(x['numero_versao']),
          sala: n(d['sala']),
          inicio: texto(d['inicio']),
          duracaoMin: n(d['duracaoMin']),
          procedimento: n(d['procedimento']),
          convenio: n(d['convenio']),
          observacao:
            d['observacao'] === null || d['observacao'] === undefined ? null : texto(d['observacao']),
          paciente: d['paciente'] === null || d['paciente'] === undefined ? null : texto(d['paciente']),
          motivo: texto(x['motivo']),
          substituidaEm: civil(x['substituida_em'], fuso) ?? '',
        };
      }),
    );
  }

  agendamentosDoCirurgiao(c: ContextoPortaM18, cirurgioes: readonly number[], de: string, ate: string) {
    if (cirurgioes.length === 0) return Promise.resolve({ itens: [], truncado: false });
    return this.ler(c, async (l, est, fuso) => {
      const r = await l.consultar(
        `${SQL_AGENDAMENTO} AND a.situacao IN (${NA_SALA}) AND a.cirurgiao_profissional_id IN (${lista(cirurgioes.length)})
            AND a.inicio_previsto_em >= ? AND a.inicio_previsto_em < ? ORDER BY a.inicio_previsto_em LIMIT ${TETO_CIRURGIA + 1}`,
        [est, ...cirurgioes, instante(`${de} 00:00`, fuso), instante(`${ate} 23:59`, fuso, 1)],
      );
      return {
        itens: await this.agendamentosDe(l, r.slice(0, TETO_CIRURGIA), fuso),
        truncado: r.length > TETO_CIRURGIA,
      };
    });
  }

  pendencias(c: ContextoPortaM18, idEstado: number): Promise<PendenciaDoPedido[]> {
    return this.ler(c, async (l, est, fuso) =>
      (
        await l.consultar(
          `SELECT pa.id, t.codigo AS tipo, pa.situacao, pa.descricao, u.login, pa.alterado_em, pa.criado_em
             FROM pendencia_agendamento_cirurgico pa
             JOIN agendamento_cirurgico a ON a.id = pa.agendamento_cirurgico_id
             JOIN tipo_pendencia_cirurgica t ON t.id = pa.tipo_pendencia_cirurgica_id
             LEFT JOIN usuario u ON u.id = COALESCE(pa.alterado_por, pa.criado_por)
            WHERE a.id = ? AND a.estabelecimento_id = ? AND pa.excluido_em IS NULL ORDER BY pa.sequencia`,
          [idEstado, est],
        )
      ).map((x) => ({
        id: n(x['id']),
        tipo: texto(x['tipo']),
        situacao: texto(x['situacao']),
        observacao: x['descricao'] === null || x['descricao'] === undefined ? null : texto(x['descricao']),
        atualizadoPor: x['login'] === null || x['login'] === undefined ? null : texto(x['login']),
        atualizadoEm: civil(x['alterado_em'] ?? x['criado_em'], fuso),
      })),
    );
  }

  async ligacoes(c: ContextoPortaM18, realizadas: readonly number[]): Promise<Map<number, LigacaoDoAto>> {
    if (realizadas.length === 0) return new Map();
    const r = await this.ler(c, (l, est) =>
      l.consultar(
        `SELECT t.id, t.agendamento_cirurgico_id, t.alterado_em FROM ato_cirurgico t
          WHERE t.estabelecimento_id = ? AND t.id IN (${lista(realizadas.length)}) AND t.excluido_em IS NULL`,
        [est, ...realizadas],
      ),
    );
    return new Map(
      r.map((x) => [
        n(x['id']),
        {
          realizada: n(x['id']),
          agendamento: nn(x['agendamento_cirurgico_id']),
          origem: x['alterado_em'] ? 'revisao' : 'registro',
        } as LigacaoDoAto,
      ]),
    );
  }

  async registrosExt(
    c: ContextoPortaM18,
    realizadas: readonly number[],
  ): Promise<Map<number, RegistroComplementarAto>> {
    if (realizadas.length === 0) return new Map();
    const r = await this.ler(c, async (l, est, fuso) =>
      (
        await l.consultar(
          `SELECT t.id, t.entrada_sala_em, t.inicio_cirurgia_em, t.saida_sala_em, t.observacao,
                  (SELECT ca.classe FROM ficha_anestesica f JOIN classificacao_asa ca ON ca.id = f.classificacao_asa_id
                    WHERE f.ato_cirurgico_id = t.id AND f.excluido_em IS NULL ORDER BY f.id DESC LIMIT 1) AS asa
             FROM ato_cirurgico t WHERE t.estabelecimento_id = ? AND t.id IN (${lista(realizadas.length)}) AND t.excluido_em IS NULL`,
          [est, ...realizadas],
        )
      ).map((x) => ({
        realizada: n(x['id']),
        entradaSala: civil(x['entrada_sala_em'], fuso),
        incisao: civil(x['inicio_cirurgia_em'], fuso),
        saidaSala: civil(x['saida_sala_em'], fuso),
        asa: nn(x['asa']),
        observacao: x['observacao'] === null || x['observacao'] === undefined ? null : texto(x['observacao']),
      })),
    );
    return new Map(r.map((x) => [x.realizada, x]));
  }
}

/** Fora de dev/ci sem o núcleo: toda chamada responde 503 (nada lido nem gravado). */
export function portaCirurgiaIndisponivel(): PortaCirurgia {
  return portaIndisponivel<PortaCirurgia>(METODOS_PORTA_CIRURGIA);
}
