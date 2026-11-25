// Porta da agenda de exames sobre o banco do cliente (M18), pelo @sgh/nucleo: leituras somente leitura nas tabelas
// da agenda (agenda_servico de categoria "exame", agenda_escala, geracao_grade, horario_agenda, marcacao_horario,
// cancelamento_marcacao, agenda_fonte_pagadora) e gravações pelo Executor (operacoes.ts: trilha, outbox e
// idempotência na mesma transação). Toda leitura filtra o estabelecimento da sessão e os registros excluídos; a
// fonte pagadora e o catálogo de exames são da rede inteira (não têm estabelecimento).
// Melhoria: horas no fuso do estabelecimento (estabelecimento.fuso_horario), não no relógio do servidor; estado do
// horário pela situação do horário e da marcação, sem letras de situação; "ocupado sem marcação" vira conferência
// de consistência do próprio banco (o resíduo "confirmado sem paciente" não existe no modelo: CHECK da marcação).
// Cobertura por exame (agenda_servico_exame) lida e gravada pelo Executor, com a trilha na mesma transação; feriados
// do calendário do cliente (feriado: nacionais, da UF e do município do estabelecimento e os do próprio
// estabelecimento). Pendência: o solicitante externo da marcação (pedido do lote 01-05).
import { randomUUID } from 'node:crypto';
import {
  type ContextoNucleo,
  type ContextoOperacao,
  definirOperacao,
  type Executor,
  type Leitor,
  type NucleoProprio,
  recusa,
  type ResultadoOperacao,
  type TxOperacao,
} from '@sgh/nucleo';
import type { Feriado } from '@sgh/dominio-agenda';
import { z } from 'zod';
import { lerDiasSemExpediente } from '../agenda/dias-sem-expediente-leitor.js';
import {
  type ContextoPortaM18,
  type LiberacaoGravacao,
  portaIndisponivel,
  type TrilhaDaGravacao,
} from './apoio-gravacao.js';
import { OPERACOES_EXAME_DESLIGADAS } from './esquemas.js';
import { OPERACOES_EXAME } from './operacoes.js';
import { agendasOcultasDoUsuario, exigirManutencaoDeExame } from './papel-nominal.js';
import { type GravadorCoberturaExame, METODOS_PORTA_EXAME, type PortaExame } from './porta.js';
import { FUSO_PADRAO, horaCivil, horaDeMinutos, instanteCivil, relogioDoEstabelecimento } from './relogio.js';
import {
  type AgendaExame,
  type CancelamentoExame,
  type CoberturaExame,
  type ContatoMarcacaoExame,
  type ExtensaoExame,
  type GeracaoGrade,
  type HorarioExame,
  type MarcacaoExame,
  type ResiduoExame,
  type SituacaoGeracao,
  TETO_HORARIOS_EXAME,
  TETO_MARCACOES_EXAME,
  TETO_VAGAS_EXAME,
  type VagaExame,
} from './tipos.js';

/** O mínimo do núcleo que a porta usa. */
export type NucleoExame = Pick<NucleoProprio, 'lerSomente' | 'criarExecutor'>;

type Linha = Record<string, unknown>;
const n = (v: unknown) => Number(v ?? 0);
const nn = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const texto = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const verdadeiro = (v: unknown) => v === true || v === 1 || v === '1';
/** DATE do banco (meia-noite UTC) → "AAAA-MM-DD". */
const dataIso = (v: unknown): string | null =>
  v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : null;
/** TIME do banco ("HH:MM:SS") → hora do dia "HH:MM". */
const horaDoTempo = (v: unknown) => texto(v).padStart(8, '0').slice(0, 5);
const lista = (k: number) => Array.from({ length: k }, () => '?').join(', ');

/** Modalidade da agenda no vocabulário da tela; o modelo ainda não a registra (pendência: "O" = outros). */
const MODALIDADE_PADRAO = 'O';

const SITUACAO_GERACAO: Readonly<Record<string, SituacaoGeracao>> = {
  concluida: 'gerada',
  revertida: 'revertida',
  pendente: 'pendente',
  processando: 'pendente',
  erro: 'falhou',
};

/** Estado do horário pela situação do horário e da marcação ativa. */
function estadoDoHorario(h: Linha): HorarioExame['estado'] {
  const sit = texto(h['situacao_horario']);
  if (sit === 'bloqueado') return 'bloqueado';
  if (sit === 'cancelado') return 'outro';
  if (h['marcacao'] === null || h['marcacao'] === undefined) {
    if (sit === 'ocupado') return 'marcacao-incompleta';
    return h['tipo_horario'] === 'regular' ? 'vago' : 'outro';
  }
  switch (texto(h['significado'])) {
    case 'confirmada':
    case 'chegou':
    case 'em_atendimento':
      return 'confirmado';
    case 'realizada':
      return 'realizado';
    case 'falta':
    case 'bloqueada':
      return 'outro';
    default:
      return 'marcado';
  }
}

const SQL_AGENDAS = `
  SELECT a.id, a.nome, a.categoria_agenda_id, a.duracao_horario_minutos, a.ativo, a.unidade_assistencial_id,
         (SELECT MIN(h.data_referencia) FROM horario_agenda h
           WHERE h.agenda_servico_id = a.id AND h.excluido_em IS NULL) AS inicio,
         (SELECT MAX(h.data_referencia) FROM horario_agenda h
           WHERE h.agenda_servico_id = a.id AND h.excluido_em IS NULL) AS fim,
         (SELECT COUNT(*) FROM agenda_fonte_pagadora f
           WHERE f.agenda_servico_id = a.id AND f.excluido_em IS NULL) AS convenios
    FROM agenda_servico a JOIN categoria_agenda ca ON ca.id = a.categoria_agenda_id
   WHERE a.estabelecimento_id = ? AND a.excluido_em IS NULL AND ca.natureza = 'exame'`;

const SQL_MARCACOES = `
  SELECT m.id, h.agenda_servico_id, a.nome AS nome_agenda, a.categoria_agenda_id, h.data_referencia, h.inicio_em,
         h.situacao AS situacao_horario, h.tipo_horario, m.id AS marcacao, s.significado,
         COALESCE(pf.nome, pc.nome) AS paciente, m.paciente_id, p.numero_prontuario, m.fonte_pagadora_id,
         m.atendido_em, m.chegada_em, u.login AS usuario, m.marcado_em, m.observacao,
         p.pessoa_fisica_id, m.pre_cadastro_id
    FROM marcacao_horario m
    JOIN horario_agenda h ON h.id = m.horario_agenda_id
    JOIN agenda_servico a ON a.id = h.agenda_servico_id
    JOIN categoria_agenda ca ON ca.id = a.categoria_agenda_id
    JOIN situacao_marcacao s ON s.id = m.situacao_marcacao_id
    LEFT JOIN paciente p ON p.id = m.paciente_id
    LEFT JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
    LEFT JOIN pre_cadastro pc ON pc.id = m.pre_cadastro_id
    LEFT JOIN usuario u ON u.id = m.responsavel_usuario_id
   WHERE m.estabelecimento_id = ? AND m.excluido_em IS NULL AND ca.natureza = 'exame'
     AND s.significado <> 'cancelada'`;

export class PortaExamePropria implements PortaExame {
  readonly destino = 'banco' as const;
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: NucleoExame,
    executorPronto?: Executor,
  ) {
    this.executor = executorPronto ?? nucleo.criarExecutor();
  }

  private ler<T>(c: ContextoPortaM18, fn: (l: Leitor, est: number) => Promise<T>): Promise<T> {
    const est = c.estabelecimento;
    if (est === null)
      return Promise.reject(recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.'));
    return this.nucleo.lerSomente(contextoDe(c), (l) => fn(l, est));
  }

  private async fuso(l: Leitor, est: number): Promise<string> {
    const r = await l.uma<{ fuso_horario: string | null }>(
      'SELECT fuso_horario FROM estabelecimento WHERE id = ?',
      [est],
    );
    return r?.fuso_horario || FUSO_PADRAO;
  }

  // ── Gravação ──────────────────────────────────────────────────────────────────────────────────────────────

  async podeGravar(c: ContextoPortaM18, op: string): Promise<LiberacaoGravacao> {
    const desligada = OPERACOES_EXAME_DESLIGADAS[op];
    if (desligada)
      return { pode: false, codigo: 'operacao-nao-liberada', motivo: `Operação desligada: ${desligada}.` };
    const operacao = OPERACOES_EXAME[op];
    if (!operacao) return { pode: false, codigo: 'operacao-desconhecida', motivo: 'Operação desconhecida.' };
    return this.executor.liberacao(operacao, { ...contextoDe(c), chaveIdempotencia: 'consulta.liberacao' });
  }

  async executar(c: ContextoPortaM18, op: string, entrada: unknown, ctx: ContextoOperacao) {
    const operacao = OPERACOES_EXAME[op];
    if (!operacao) throw recusa('operacao-desconhecida', 'Operação desconhecida na agenda de exames.');
    const r = await this.executor.executar(operacao, c.cliente, entrada, ctx);
    return { resultado: r.resultado, repetida: r.repetida, trilha: r.trilha };
  }

  /**
   * Cobertura por exame (agenda_servico_exame) pelo Executor, com a linha da trilha na mesma transação. A agenda tem
   * de ser de exame e do estabelecimento da sessão; retirar é exclusão lógica e incluir de novo reativa a linha (a
   * chave única agenda + exame + fonte pagadora vale também para as excluídas).
   */
  async gravarSgh<T>(
    c: ContextoPortaM18,
    trilha: TrilhaDaGravacao | ((r: T) => TrilhaDaGravacao),
    fn: (g: GravadorCoberturaExame) => Promise<T>,
  ): Promise<T> {
    const est = c.estabelecimento;
    if (est === null) throw recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.');
    let saida: { valor: T } | null = null;
    const escrita: { id: number | null } = { id: null };
    const linha = () => (typeof trilha === 'function' ? (saida ? trilha(saida.valor) : null) : trilha);
    const op = definirOperacao({
      nome: 'agenda.cobertura_exame',
      tabelas: ['agenda_servico_exame'],
      entrada: z.object({ chave: z.string() }),
      async gravar(tx) {
        saida = { valor: await fn(gravadorCobertura(tx, est, escrita)) };
        return { valor: saida.valor === undefined ? null : saida.valor } as unknown as ResultadoOperacao;
      },
      alvo: () => ({ tabela: 'agenda_servico_exame', id: escrita.id ?? linha()?.entidadeId ?? null }),
      trilha: () => ({ dados: linha()?.dadosDepois ?? null, motivo: linha()?.motivo ?? null }),
    });
    const chave = `exame.cobertura:${randomUUID()}`;
    await this.executor.executar(op, c.cliente, { chave }, { ...contextoDe(c), chaveIdempotencia: chave });
    if (!saida) throw new Error('Gravação da cobertura sem resultado.');
    return (saida as { valor: T }).valor;
  }

  // ── Leituras ──────────────────────────────────────────────────────────────────────────────────────────────

  relogio(c: ContextoPortaM18) {
    return this.ler(c, async (l, est) => relogioDoEstabelecimento(await this.fuso(l, est)));
  }

  agendas(c: ContextoPortaM18): Promise<AgendaExame[]> {
    return this.ler(c, async (l, est) => {
      // 02-AGE 40: a agenda restrita a uma lista de usuários some de quem não está nela.
      const ocultas = await agendasOcultasDoUsuario(l, est, c.usuario);
      return (await l.consultar(`${SQL_AGENDAS} ORDER BY a.nome, a.id`, [est]))
        .map(agendaDe)
        .filter((a) => !ocultas.has(a.id));
    });
  }

  agenda(c: ContextoPortaM18, id: number): Promise<AgendaExame | null> {
    return this.ler(c, async (l, est) => {
      const r = await l.uma(`${SQL_AGENDAS} AND a.id = ?`, [est, id]);
      if (!r || (await agendasOcultasDoUsuario(l, est, c.usuario)).has(id)) return null;
      return agendaDe(r);
    });
  }

  convenios(c: ContextoPortaM18, id: number) {
    return this.ler(c, async (l, est) =>
      (
        await l.consultar(
          `SELECT f.id, f.nome FROM agenda_fonte_pagadora af
             JOIN agenda_servico a ON a.id = af.agenda_servico_id
             JOIN fonte_pagadora f ON f.id = af.fonte_pagadora_id
            WHERE af.agenda_servico_id = ? AND a.estabelecimento_id = ? AND af.excluido_em IS NULL
              AND f.excluido_em IS NULL
            ORDER BY f.nome, f.id`,
          [id, est],
        )
      ).map((r) => ({ codigo: n(r['id']), nome: texto(r['nome']) })),
    );
  }

  escala(c: ContextoPortaM18, agenda: number, periodo?: { de: string; ate: string }) {
    return this.ler(c, async (l, est) => {
      // Sem período: as faixas vigentes hoje (no fuso do estabelecimento); com período: as que valem em algum dia.
      const hoje = horaCivil(new Date(), await this.fuso(l, est)).data;
      const de = periodo?.de ?? hoje;
      const ate = periodo?.ate ?? hoje;
      const linhas = await l.consultar(
        `SELECT e.dia_semana, e.hora_inicio, e.hora_fim, e.intervalo_inicio, e.intervalo_fim, e.vagas_por_horario,
                e.atende_feriado, e.vigencia_inicio, e.vigencia_fim,
                COALESCE(e.duracao_horario_minutos, a.duracao_horario_minutos) AS duracao
           FROM agenda_escala e JOIN agenda_servico a ON a.id = e.agenda_servico_id
          WHERE e.agenda_servico_id = ? AND a.estabelecimento_id = ? AND a.excluido_em IS NULL AND e.ativo = TRUE
            AND e.vigencia_inicio <= ? AND (e.vigencia_fim IS NULL OR e.vigencia_fim >= ?)
          ORDER BY e.dia_semana, e.hora_inicio`,
        [agenda, est, ate, de],
      );
      return linhas.map((r) => ({
        semana: n(r['dia_semana']),
        duracao: horaDeMinutos(n(r['duracao'])),
        horaInicio: horaDoTempo(r['hora_inicio']),
        horaFim: horaDoTempo(r['hora_fim']),
        exame: MODALIDADE_PADRAO,
        intervaloInicio: r['intervalo_inicio'] === null ? null : horaDoTempo(r['intervalo_inicio']),
        intervaloFim: r['intervalo_fim'] === null ? null : horaDoTempo(r['intervalo_fim']),
        vagas: Math.max(1, n(r['vagas_por_horario'])),
        atendeFeriado: verdadeiro(r['atende_feriado']),
        vigenciaInicio: dataIso(r['vigencia_inicio']) ?? de,
        vigenciaFim: dataIso(r['vigencia_fim']),
      }));
    });
  }

  geracoes(c: ContextoPortaM18, agenda: number): Promise<GeracaoGrade[]> {
    return this.ler(c, async (l, est) => {
      const fuso = await this.fuso(l, est);
      const linhas = await l.consultar(
        `SELECT g.id, g.situacao, g.periodo_inicio, g.periodo_fim, g.solicitada_em, g.duracao_horario_minutos,
                u.login AS usuario,
                (SELECT GROUP_CONCAT(DISTINCT p.dia_semana ORDER BY p.dia_semana) FROM geracao_grade_periodo p
                  WHERE p.geracao_grade_id = g.id AND p.excluido_em IS NULL) AS dias
           FROM geracao_grade g LEFT JOIN usuario u ON u.id = g.responsavel_usuario_id
          WHERE g.agenda_servico_id = ? AND g.estabelecimento_id = ? AND g.excluido_em IS NULL
          ORDER BY g.solicitada_em DESC, g.id DESC LIMIT 200`,
        [agenda, est],
      );
      return linhas.map((r) => {
        const em = horaCivil(r['solicitada_em'] as Date, fuso);
        return {
          situacao: SITUACAO_GERACAO[texto(r['situacao'])] ?? 'pendente',
          inicio: dataIso(r['periodo_inicio']) ?? '',
          fim: dataIso(r['periodo_fim']) ?? '',
          em: em.data,
          hora: em.hora,
          duracao:
            r['duracao_horario_minutos'] === null ? '' : horaDeMinutos(n(r['duracao_horario_minutos'])),
          dias: texto(r['dias']).split(',').filter(Boolean).map(Number),
          usuario: texto(r['usuario']),
        };
      });
    });
  }

  /**
   * Dias sem expediente do período no estabelecimento (02-CAD linha 28): o mesmo leitor da agenda de consultas, sobre o
   * cadastro único de dias não úteis (nacionais calculados, UF, município e estabelecimento; anual, data única e móvel;
   * faixa do dia). O ponto facultativo fica de fora (o hospital decide abrir).
   */
  feriados(c: ContextoPortaM18, de: string, ate: string): Promise<Feriado[] | null> {
    return this.ler(c, (l, est) => lerDiasSemExpediente(l, est, de, ate));
  }

  /** Inícios já usados (regular ou extra, posição 0 da chave única), sem teto; excluídos ficam de fora (reativáveis). */
  horariosExistentes(c: ContextoPortaM18, agenda: number, de: string, ate: string): Promise<string[]> {
    return this.ler(c, async (l, est) => {
      const fuso = await this.fuso(l, est);
      const linhas = await l.consultar(
        `SELECT h.data_referencia, h.inicio_em FROM horario_agenda h
           JOIN agenda_servico a ON a.id = h.agenda_servico_id
          WHERE h.agenda_servico_id = ? AND a.estabelecimento_id = ? AND h.excluido_em IS NULL
            AND h.encaixe_ordem = 0 AND h.data_referencia BETWEEN ? AND ?
          ORDER BY h.inicio_em`,
        [agenda, est, de, ate],
        { teto: 200_000 },
      );
      return linhas.map(
        (r) => `${dataIso(r['data_referencia']) ?? ''} ${horaCivil(r['inicio_em'] as Date, fuso).hora}`,
      );
    });
  }

  horarios(c: ContextoPortaM18, agenda: number, de: string, ate: string) {
    return this.ler(c, async (l, est) => {
      const fuso = await this.fuso(l, est);
      const linhas = await l.consultar(
        `SELECT h.id, h.data_referencia, h.inicio_em, h.situacao AS situacao_horario, h.tipo_horario,
                m.id AS marcacao, m.fonte_pagadora_id, s.significado, COALESCE(pf.nome, pc.nome) AS paciente
           FROM horario_agenda h
           JOIN agenda_servico a ON a.id = h.agenda_servico_id
           LEFT JOIN marcacao_horario m ON m.horario_agenda_id = h.id AND m.excluido_em IS NULL
                 AND NOT EXISTS (SELECT 1 FROM situacao_marcacao sc
                                  WHERE sc.id = m.situacao_marcacao_id AND sc.significado = 'cancelada')
           LEFT JOIN situacao_marcacao s ON s.id = m.situacao_marcacao_id
           LEFT JOIN paciente p ON p.id = m.paciente_id
           LEFT JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
           LEFT JOIN pre_cadastro pc ON pc.id = m.pre_cadastro_id
          WHERE h.agenda_servico_id = ? AND a.estabelecimento_id = ? AND h.excluido_em IS NULL
            AND h.data_referencia BETWEEN ? AND ?
          ORDER BY h.inicio_em, h.encaixe_ordem, h.id
          LIMIT ${TETO_HORARIOS_EXAME + 1}`,
        [agenda, est, de, ate],
      );
      const itens: HorarioExame[] = linhas.slice(0, TETO_HORARIOS_EXAME).map((r) => ({
        data: dataIso(r['data_referencia']) ?? '',
        hora: horaCivil(r['inicio_em'] as Date, fuso).hora,
        exame: MODALIDADE_PADRAO,
        estado: estadoDoHorario(r),
        paciente: r['paciente'] === null ? null : texto(r['paciente']),
        convenio: nn(r['fonte_pagadora_id']),
        marcacao: nn(r['marcacao']),
      }));
      return { itens, truncado: linhas.length > TETO_HORARIOS_EXAME };
    });
  }

  vagas(
    c: ContextoPortaM18,
    f: { agendas: readonly number[] | null; de: string; ate: string; limite?: number },
  ) {
    return this.ler(c, async (l, est) => {
      if (f.agendas && f.agendas.length === 0) return { itens: [] as VagaExame[], truncado: false };
      const teto = Math.min(f.limite ?? TETO_VAGAS_EXAME, TETO_VAGAS_EXAME);
      const fuso = await this.fuso(l, est);
      const filtro = f.agendas ? `AND h.agenda_servico_id IN (${lista(f.agendas.length)})` : '';
      const linhas = await l.consultar(
        `SELECT h.agenda_servico_id, a.nome, a.categoria_agenda_id, h.data_referencia, h.inicio_em
           FROM horario_agenda h
           JOIN agenda_servico a ON a.id = h.agenda_servico_id
           JOIN categoria_agenda ca ON ca.id = a.categoria_agenda_id
          WHERE a.estabelecimento_id = ? AND a.excluido_em IS NULL AND a.ativo = TRUE AND ca.natureza = 'exame'
            AND h.excluido_em IS NULL AND h.situacao = 'livre' AND h.tipo_horario = 'regular'
            AND h.vagas_ocupadas < h.vagas AND h.data_referencia BETWEEN ? AND ? AND h.inicio_em > ? ${filtro}
          ORDER BY h.inicio_em, h.id
          LIMIT ${teto + 1}`,
        [est, f.de, f.ate, new Date(), ...(f.agendas ?? [])],
      );
      return {
        truncado: linhas.length > teto,
        itens: linhas.slice(0, teto).map((r) => ({
          agenda: n(r['agenda_servico_id']),
          nomeAgenda: texto(r['nome']),
          categoria: n(r['categoria_agenda_id']),
          data: dataIso(r['data_referencia']) ?? '',
          hora: horaCivil(r['inicio_em'] as Date, fuso).hora,
          exame: MODALIDADE_PADRAO,
        })),
      };
    });
  }

  marcacoesDoDia(c: ContextoPortaM18, data: string, agenda: number | null) {
    return this.ler(c, async (l, est) => {
      const fuso = await this.fuso(l, est);
      const linhas = await l.consultar(
        `${SQL_MARCACOES} AND h.data_referencia = ? ${agenda === null ? '' : 'AND h.agenda_servico_id = ?'}
          ORDER BY h.inicio_em, m.id LIMIT ${TETO_MARCACOES_EXAME + 1}`,
        agenda === null ? [est, data] : [est, data, agenda],
      );
      return {
        itens: linhas.slice(0, TETO_MARCACOES_EXAME).map((r) => marcacaoDe(r, fuso)),
        truncado: linhas.length > TETO_MARCACOES_EXAME,
      };
    });
  }

  marcacoesDoPaciente(c: ContextoPortaM18, idPaciente: number) {
    return this.ler(c, async (l, est) => {
      const fuso = await this.fuso(l, est);
      const linhas = await l.consultar(
        `${SQL_MARCACOES} AND m.paciente_id = ? ORDER BY h.inicio_em DESC, m.id DESC LIMIT ${TETO_MARCACOES_EXAME + 1}`,
        [est, idPaciente],
      );
      // 02-AGE 40: a marcação em agenda restrita não aparece para quem não está na lista dela.
      const ocultas = await agendasOcultasDoUsuario(l, est, c.usuario);
      return {
        itens: linhas
          .filter((r) => !ocultas.has(n(r['agenda_servico_id'])))
          .slice(0, TETO_MARCACOES_EXAME)
          .map((r) => marcacaoDe(r, fuso)),
        truncado: linhas.length > TETO_MARCACOES_EXAME,
      };
    });
  }

  marcacao(c: ContextoPortaM18, id: number) {
    return this.ler(c, async (l, est) => {
      const r = await l.uma(`${SQL_MARCACOES} AND m.id = ?`, [est, id]);
      if (!r) return null;
      const contato = await contatoDe(l, r);
      return { marcacao: marcacaoDe(r, await this.fuso(l, est)), contato };
    });
  }

  cancelamentos(
    c: ContextoPortaM18,
    f: { de: string; ate: string; agendas: readonly number[] | null; pagina: number; porPagina: number },
  ) {
    return this.ler(c, async (l, est) => {
      if (f.agendas && f.agendas.length === 0) return { itens: [] as CancelamentoExame[], total: 0 };
      const fuso = await this.fuso(l, est);
      const ini = instanteCivil(f.de, '00:00', fuso);
      const fim = new Date(instanteCivil(f.ate, '00:00', fuso).getTime() + 86_400_000);
      // 02-AGE 40: cancelamento em agenda restrita não aparece para quem não está na lista dela.
      const ocultas = [...(await agendasOcultasDoUsuario(l, est, c.usuario))];
      const filtro =
        (f.agendas ? `AND a.id IN (${lista(f.agendas.length)})` : '') +
        (ocultas.length > 0 ? ` AND a.id NOT IN (${lista(ocultas.length)})` : '');
      const base = `
          FROM cancelamento_marcacao cm
          JOIN marcacao_horario m ON m.id = cm.marcacao_horario_id
          JOIN horario_agenda h ON h.id = m.horario_agenda_id
          JOIN agenda_servico a ON a.id = h.agenda_servico_id
          JOIN categoria_agenda ca ON ca.id = a.categoria_agenda_id
          JOIN motivo_cancelamento_operacao mc ON mc.id = cm.motivo_cancelamento_operacao_id
          LEFT JOIN paciente p ON p.id = m.paciente_id
          LEFT JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
          LEFT JOIN pre_cadastro pc ON pc.id = m.pre_cadastro_id
          LEFT JOIN usuario uc ON uc.id = cm.responsavel_usuario_id
          LEFT JOIN usuario um ON um.id = m.responsavel_usuario_id
         WHERE cm.estabelecimento_id = ? AND cm.excluido_em IS NULL AND ca.natureza = 'exame'
           AND cm.cancelado_em >= ? AND cm.cancelado_em < ? ${filtro}`;
      const p = [est, ini, fim, ...(f.agendas ?? []), ...ocultas];
      const total = n((await l.uma(`SELECT COUNT(*) AS total ${base}`, p))?.['total']);
      const porPagina = Math.max(1, Math.min(f.porPagina, 200));
      const pular = Math.max(0, (Math.max(1, f.pagina) - 1) * porPagina);
      const linhas = await l.consultar(
        `SELECT a.nome AS nome_agenda, h.data_referencia, h.inicio_em, COALESCE(pf.nome, pc.nome) AS paciente,
                mc.descricao AS motivo, cm.complemento, cm.cancelado_em, uc.login AS cancelado_por,
                um.login AS marcado_por, m.fonte_pagadora_id
           ${base}
          ORDER BY cm.cancelado_em DESC, cm.id DESC LIMIT ${porPagina} OFFSET ${pular}`,
        p,
      );
      const itens = linhas.map((r) => {
        const quando = horaCivil(r['cancelado_em'] as Date, fuso);
        const complemento = texto(r['complemento']);
        return {
          nomeAgenda: texto(r['nome_agenda']),
          data: dataIso(r['data_referencia']) ?? '',
          hora: horaCivil(r['inicio_em'] as Date, fuso).hora,
          paciente: texto(r['paciente']),
          motivo: complemento ? `${texto(r['motivo'])}: ${complemento}` : texto(r['motivo']),
          canceladoEm: quando.data,
          horaCancelamento: quando.hora,
          canceladoPor: texto(r['cancelado_por']),
          marcadoPor: texto(r['marcado_por']),
          convenio: n(r['fonte_pagadora_id']),
        };
      });
      return { itens, total };
    });
  }

  /** Conferência de consistência: horário ocupado sem marcação ativa (o banco próprio não deveria ter nenhum). */
  residuo(c: ContextoPortaM18, de: string, ate: string): Promise<ResiduoExame> {
    return this.ler(c, async (l, est) => {
      const fuso = await this.fuso(l, est);
      const teto = 500;
      const linhas = await l.consultar(
        `SELECT a.id AS agenda, a.nome, h.data_referencia, h.inicio_em
           FROM horario_agenda h
           JOIN agenda_servico a ON a.id = h.agenda_servico_id
           JOIN categoria_agenda ca ON ca.id = a.categoria_agenda_id
          WHERE a.estabelecimento_id = ? AND ca.natureza = 'exame' AND h.excluido_em IS NULL
            AND h.situacao = 'ocupado' AND h.data_referencia BETWEEN ? AND ?
            AND NOT EXISTS (SELECT 1 FROM marcacao_horario m JOIN situacao_marcacao s ON s.id = m.situacao_marcacao_id
                             WHERE m.horario_agenda_id = h.id AND m.excluido_em IS NULL
                               AND s.significado <> 'cancelada')
          ORDER BY h.inicio_em LIMIT ${teto + 1}`,
        [est, de, ate],
      );
      const porAgenda = new Map<number, ResiduoExame['porAgenda'][number]>();
      for (const r of linhas) {
        const k = n(r['agenda']);
        const x = porAgenda.get(k) ?? {
          agenda: k,
          nomeAgenda: texto(r['nome']),
          confirmadosSemPaciente: 0,
          ocupadosSemMarcacao: 0,
        };
        x.ocupadosSemMarcacao++;
        porAgenda.set(k, x);
      }
      return {
        porAgenda: [...porAgenda.values()],
        horarios: linhas.slice(0, teto).map((r) => ({
          nomeAgenda: texto(r['nome']),
          data: dataIso(r['data_referencia']) ?? '',
          hora: horaCivil(r['inicio_em'] as Date, fuso).hora,
          tipo: 'sem-marcacao' as const,
        })),
        truncado: linhas.length > teto,
      };
    });
  }

  /** Fontes pagadoras e catálogo de exames: cadastros da rede inteira (sem estabelecimento). */
  opcoes(c: ContextoPortaM18) {
    return this.ler(c, async (l) => {
      const [fontes, exames] = await Promise.all([
        l.consultar(
          'SELECT id, nome, situacao FROM fonte_pagadora WHERE excluido_em IS NULL ORDER BY nome, id',
        ),
        l.consultar(
          `SELECT id, nome, especialidade_diagnostica_id FROM exame
            WHERE ativo = TRUE AND excluido_em IS NULL ORDER BY nome, id LIMIT 5000`,
        ),
      ]);
      return {
        convenios: fontes.map((r) => ({
          codigo: n(r['id']),
          nome: texto(r['nome']),
          ativo: r['situacao'] === 'ativa',
        })),
        exames: exames.map((r) => ({
          id: n(r['id']),
          nome: texto(r['nome']),
          categoria: n(r['especialidade_diagnostica_id']),
        })),
      };
    });
  }

  extensoes(c: ContextoPortaM18, ids: readonly number[]): Promise<Map<number, ExtensaoExame>> {
    if (ids.length === 0) return Promise.resolve(new Map());
    return this.ler(c, async (l, est) => {
      const linhas = await l.consultar(
        `SELECT m.id, i.exame_id, e.nome AS exame_nome, m.retorno, cm.codigo AS canal
           FROM marcacao_horario m
           JOIN canal_marcacao cm ON cm.id = m.canal_marcacao_id
           LEFT JOIN marcacao_horario_item i ON i.marcacao_horario_id = m.id AND i.sequencia = 1
                 AND i.excluido_em IS NULL
           LEFT JOIN exame e ON e.id = i.exame_id
          WHERE m.estabelecimento_id = ? AND m.excluido_em IS NULL AND m.id IN (${lista(ids.length)})`,
        [est, ...ids],
      );
      return new Map(
        linhas.map((r) => [
          n(r['id']),
          {
            marcacao: n(r['id']),
            idExame: nn(r['exame_id']),
            exameNome: r['exame_nome'] === null ? null : texto(r['exame_nome']),
            // O solicitante externo da marcação aguarda o modelo (pedido do lote 01-05).
            solicitante: null,
            retorno: verdadeiro(r['retorno']),
            canal: texto(r['canal']),
          },
        ]),
      );
    });
  }

  /** Cobertura por exame das agendas do estabelecimento (sem linha: a agenda faz todos os exames do catálogo). */
  cobertura(c: ContextoPortaM18, agenda: number | null): Promise<CoberturaExame[]> {
    return this.ler(c, async (l, est) =>
      (
        await l.consultar(
          `SELECT x.id, x.agenda_servico_id, x.exame_id, e.nome AS exame_nome, x.fonte_pagadora_id,
                  f.nome AS fonte_nome
             FROM agenda_servico_exame x
             JOIN agenda_servico a ON a.id = x.agenda_servico_id
             JOIN exame e ON e.id = x.exame_id
             LEFT JOIN fonte_pagadora f ON f.id = x.fonte_pagadora_id
            WHERE a.estabelecimento_id = ? AND a.excluido_em IS NULL AND x.excluido_em IS NULL
              ${agenda === null ? '' : 'AND x.agenda_servico_id = ?'}
            ORDER BY x.agenda_servico_id, e.nome, x.id`,
          agenda === null ? [est] : [est, agenda],
          { teto: 20_000 },
        )
      ).map((r) => ({
        id: n(r['id']),
        agenda: n(r['agenda_servico_id']),
        exame: n(r['exame_id']),
        exameNome: texto(r['exame_nome']),
        convenio: nn(r['fonte_pagadora_id']),
        convenioNome:
          r['fonte_nome'] === null || r['fonte_nome'] === undefined ? null : texto(r['fonte_nome']),
      })),
    );
  }
}

/** O gravador da cobertura por exame dentro da transação do Executor (só agenda de exame do estabelecimento). */
function gravadorCobertura(
  tx: TxOperacao,
  est: number,
  escrita: { id: number | null },
): GravadorCoberturaExame {
  const exigirAgenda = async (agenda: number) => {
    const a = await tx.uma(
      `SELECT a.id FROM agenda_servico a JOIN categoria_agenda ca ON ca.id = a.categoria_agenda_id
        WHERE a.id = ? AND a.estabelecimento_id = ? AND a.excluido_em IS NULL AND ca.natureza = 'exame'`,
      [agenda, est],
    );
    if (!a) throw recusa('agenda-desconhecida', 'A agenda de exames não existe neste estabelecimento.');
    // 02-AGE 40: a cobertura por exame da agenda restrita é manutenção (quem marca nela ou o gestor da agenda).
    await exigirManutencaoDeExame(tx, agenda, tx.contexto.usuario);
  };
  const linhaDa = (r: { agenda: number; exame: number; convenio: number | null }) =>
    tx.consultarParaAtualizar(
      `SELECT id, versao, excluido_em FROM agenda_servico_exame
        WHERE agenda_servico_id = ? AND exame_id = ? AND fonte_pagadora_chave = ?`,
      [r.agenda, r.exame, r.convenio ?? 0],
    );
  return {
    async incluirCobertura(r) {
      await exigirAgenda(r.agenda);
      const [atual] = await linhaDa(r);
      if (atual && atual['excluido_em'] === null)
        throw recusa('ja-coberto', 'Esta cobertura já está na agenda.');
      if (atual) {
        await tx.alterar('agenda_servico_exame', n(atual['id']), n(atual['versao']), {
          excluido_em: null,
          excluido_por: null,
        });
        escrita.id = n(atual['id']);
        return escrita.id;
      }
      escrita.id = await tx.incluir('agenda_servico_exame', {
        agenda_servico_id: r.agenda,
        exame_id: r.exame,
        fonte_pagadora_id: r.convenio,
      });
      return escrita.id;
    },
    async encerrarCobertura(r) {
      await exigirAgenda(r.agenda);
      const [atual] = await linhaDa(r);
      if (!atual || atual['excluido_em'] !== null) return 0;
      // Exclusão lógica (a linha fica para a trilha e é reativada se o exame voltar à cobertura).
      await tx.alterar('agenda_servico_exame', n(atual['id']), n(atual['versao']), {
        excluido_em: new Date(),
        excluido_por: tx.contexto.usuario,
      });
      escrita.id = n(atual['id']);
      return 1;
    },
  };
}

function contextoDe(c: ContextoPortaM18): ContextoNucleo {
  return {
    cliente: c.cliente,
    estabelecimento: c.estabelecimento,
    usuario: c.usuario,
    correlacao: c.correlacao.slice(0, 64),
  };
}

function agendaDe(r: Linha): AgendaExame {
  return {
    id: n(r['id']),
    nome: texto(r['nome']),
    // O registro no conselho do profissional da agenda fica no cadastro do profissional (pendência do contrato).
    crm: 0,
    exame: MODALIDADE_PADRAO,
    categoria: n(r['categoria_agenda_id']),
    duracao: horaDeMinutos(n(r['duracao_horario_minutos'])),
    ativa: verdadeiro(r['ativo']),
    unidade: n(r['unidade_assistencial_id']),
    inicio: dataIso(r['inicio']),
    fim: dataIso(r['fim']),
    convenios: n(r['convenios']),
  };
}

function marcacaoDe(r: Linha, fuso: string): MarcacaoExame {
  const significado = texto(r['significado']);
  return {
    id: n(r['id']),
    agenda: nn(r['agenda_servico_id']),
    nomeAgenda: texto(r['nome_agenda']),
    categoriaAgenda: n(r['categoria_agenda_id']),
    data: dataIso(r['data_referencia']) ?? '',
    hora: horaCivil(r['inicio_em'] as Date, fuso).hora,
    paciente: texto(r['paciente']),
    idPaciente: nn(r['paciente_id']),
    prontuario: n(r['numero_prontuario']),
    convenio: n(r['fonte_pagadora_id']),
    estado: estadoDoHorario(r),
    situacao: significado,
    atendido: r['atendido_em'] !== null || significado === 'realizada',
    usuario: texto(r['usuario']),
    marcadaEm: r['marcado_em'] instanceof Date ? horaCivil(r['marcado_em'], fuso).data : '',
    temSenha: r['chegada_em'] !== null,
  };
}

/** Contato da marcação: telefones e e-mail principais da pessoa (ou os do pré-cadastro). */
async function contatoDe(l: Leitor, r: Linha): Promise<ContatoMarcacaoExame> {
  const observacao = r['observacao'] === null ? null : texto(r['observacao']);
  const pessoa = nn(r['pessoa_fisica_id']);
  if (pessoa === null) {
    const pc = nn(r['pre_cadastro_id']);
    const x =
      pc === null
        ? null
        : await l.uma('SELECT telefone, celular, email FROM pre_cadastro WHERE id = ?', [pc]);
    return {
      telefone: texto(x?.['telefone']),
      celular: texto(x?.['celular']),
      email: texto(x?.['email']),
      observacao,
    };
  }
  const telefones = await l.consultar(
    `SELECT t.ddd, t.numero, tt.movel FROM telefone_pessoa t JOIN tipo_telefone tt ON tt.id = t.tipo_telefone_id
      WHERE t.pessoa_fisica_id = ? AND t.excluido_em IS NULL ORDER BY t.principal DESC, t.sequencia`,
    [pessoa],
  );
  const numero = (t: Linha | undefined) => (t ? `${texto(t['ddd'])}${texto(t['numero'])}` : '');
  const email = await l.uma(
    'SELECT email FROM email_pessoa WHERE pessoa_fisica_id = ? AND excluido_em IS NULL ORDER BY principal DESC, sequencia LIMIT 1',
    [pessoa],
  );
  return {
    telefone: numero(telefones.find((t) => !verdadeiro(t['movel']))),
    celular: numero(telefones.find((t) => verdadeiro(t['movel']))),
    email: texto(email?.['email']),
    observacao,
  };
}

/** Fora de dev/ci sem o núcleo: toda chamada responde 503 (nada lido nem gravado). */
export function portaExameIndisponivel(): PortaExame {
  return portaIndisponivel<PortaExame>(METODOS_PORTA_EXAME);
}
