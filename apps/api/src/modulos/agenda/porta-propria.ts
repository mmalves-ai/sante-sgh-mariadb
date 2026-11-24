// Porta PRÓPRIA da agenda de consultas (F2.2): o banco do cliente (MariaDB) pelo @sgh/nucleo.
//   - Leituras pelo Leitor (somente leitura), sempre no estabelecimento da sessão (estabelecimento_id) e sem os
//     excluídos (excluido_em IS NULL). Exceções, por serem da rede inteira: fonte_pagadora, especialidade_medica,
//     profissional e paciente (cadastros únicos do cliente).
//   - Cada gravação é uma operação do Executor (definirOperacao): trilha, outbox e idempotência na mesma transação; a
//     operação declara as tabelas que grava; linhas existentes mudam com trava otimista (versao).
//   - Horas: horario_agenda.inicio_em/fim_em e os carimbos são instantes UTC (o pool usa timezone 'Z'); a data e a
//     hora que a tela vê são as do fuso do estabelecimento (estabelecimento.fuso_horario). data_referencia é a data
//     local do horário.
// Tabelas: agenda_servico, agenda_escala, agenda_fonte_pagadora, agenda_especialidade, geracao_grade,
// geracao_grade_periodo, horario_agenda, marcacao_horario, cancelamento_marcacao, confirmacao_marcacao,
// bloqueio_agenda, lista_espera, lista_espera_historico (e, para ler: situacao_marcacao, tipo_marcacao,
// canal_marcacao, motivo_cancelamento_operacao, motivo_bloqueio_agenda, situacao_confirmacao).
// Melhoria: a situação da marcação vem do significado configurado (situacao_marcacao.significado), nunca de letras.
// Melhoria: o número da marcação é de negócio (sequencia_negocio "marcacao_horario", por estabelecimento).
// Melhoria: o encaixe no mesmo minuto é permitido em ordem (encaixe_ordem), com o teto diário da agenda, e nunca passa
// por cima de bloqueio (horário da grade bloqueado ou bloqueio de período ativo: regra-encaixe.ts).
// Melhoria: reverter a geração apaga de fato os horários vagos sem marcação (a grade do período pode ser gerada de novo).
// Melhoria: o local e a unidade do vínculo da agenda são conferidos no estabelecimento da sessão.
// Melhoria: a remarcação grava a ligação das duas marcações (remarcada_marcacao_horario_id e
// cancelamento_marcacao.nova_marcacao_horario_id); "transferir" mantém o horário antigo ocupado, sem letra de situação.
// Melhoria: a geração de grade não reescreve a escala (a escala muda só pelo planejamento, com vigência); as faixas
// usadas ficam em geracao_grade_periodo.
// Melhoria: o vínculo da agenda (profissional, especialidade principal, local, unidade) fica na própria agenda,
// sem tabela de "ligação proposta".
import {
  MOTIVOS_CANCELAMENTO,
  RESULTADOS_CONFIRMACAO,
  esquemaAgendarConsulta,
  esquemaAgendarSemProntuario,
  esquemaAlterarAgenda,
  esquemaBloquearHorarios,
  esquemaCancelarConsulta,
  esquemaConfirmarConsulta,
  esquemaDefinirCobertura,
  esquemaDefinirEspecialidade,
  esquemaDesfazerEncaixe,
  esquemaEncaixar,
  esquemaGerarGrade,
  esquemaHora,
  esquemaIncluirAgenda,
  esquemaRegistrarFalta,
  esquemaRemarcarConsulta,
  esquemaReverterGrade,
  textoDoMotivo,
  lerIdBanco,
} from '@sgh/contratos';
import {
  type Abrangencia,
  diasSemExpediente,
  normalizarHora,
  PESO_PREFERENCIAL_SEM_GRUPO,
  prioridadeGravadaNaEspera,
  prioridadeNaMarcacao,
} from '@sgh/dominio-agenda';
import type { PessoaSemProntuario } from '@sgh/dominio-agenda';
import {
  type ContextoOperacao,
  definirOperacao,
  erroConflitoVersao,
  ErroOperacao,
  type Executor,
  garantirSequencia,
  type Leitor,
  type Linha,
  type Operacao,
  recusa,
  type ResultadoOperacao,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';
import { conferirCredenciamentoNoFluxo } from '../precos/credenciamento-fluxo.js';
import { operacaoAgenda } from './operacoes.js';
import { dataNoFuso, preCadastroDaMarcacao } from './pre-cadastro-marcacao.js';
import { grupoLegalDaEspera } from './prioridade-espera.js';
import { TEXTO_HORARIO_BLOQUEADO, vetoDeBloqueioNoEncaixe } from './regra-encaixe.js';
import { agendasOcultas, exigirMarcacaoNominal } from './usuarios-agenda.js';
import type {
  ContextoAgenda,
  ContextoGravacao,
  GravacaoAgendaFeita,
  GravadorAgenda,
  PortaAgenda,
} from './porta.js';
import type {
  Agenda,
  BloqueioAgenda,
  Cancelamento,
  ComplementoMarcacao,
  ConfirmacaoRegistrada,
  ContagensIndicadores,
  ContatoMarcacao,
  ConvenioDaAgenda,
  EscalaPlanejada,
  FaixaEscala,
  Feriado,
  GeracaoGrade,
  Horario,
  ItemListaEspera,
  LiberacaoGravacao,
  Marcacao,
  OpcoesDaAgenda,
  PacienteDaAgenda,
  PreCadastroMarcado,
  Relogio,
  SituacaoMarcacao,
  Vaga,
  VinculoAgenda,
} from './tipos.js';

/** Nome da operação no núcleo (trilha e idempotência): o da agenda em minúsculas com sublinhado. */
export const nomeNoNucleo = (nome: string): string => nome.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
const operacao = <E, S extends ResultadoOperacao>(op: Operacao<E, S>): Operacao<E, S> =>
  definirOperacao({ ...op, nome: nomeNoNucleo(op.nome) });

/** O que a porta usa do NucleoProprio (os testes trocam). */
export interface NucleoAgenda {
  lerSomente<T>(
    contexto: {
      readonly cliente: string;
      readonly correlacao: string;
      readonly estabelecimento?: number | null;
    },
    fn: (l: Leitor) => Promise<T>,
  ): Promise<T>;
  criarExecutor(): Executor;
}

/** Teto de linhas das leituras de grade e marcações (passar dele marca "truncado"). */
export const TETO_LEITURA = 5000;
const TETO_AGREGADO = 100_000;

interface Estab {
  readonly id: number;
  readonly fuso: string;
}

// ── Tempo no fuso do estabelecimento ──────────────────────────────────────────────────────────────────

function partesLocais(fuso: string, instante: Date) {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: fuso,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instante);
  const v = (t: string) => p.find((x) => x.type === t)?.value ?? '00';
  return {
    data: `${v('year')}-${v('month')}-${v('day')}`,
    hora: `${v('hour')}:${v('minute')}`,
    seg: v('second'),
  };
}

/** Data e hora (HH:MM) locais do instante. */
export function localDe(fuso: string, instante: Date): { data: string; hora: string } {
  const { data, hora } = partesLocais(fuso, instante);
  return { data, hora };
}

/** Instante (UTC) da data e hora locais do estabelecimento. */
export function instanteDe(fuso: string, data: string, hora: string): Date {
  const base = Date.parse(`${data}T${hora}:00Z`);
  const desloc = (t: number) => {
    const l = partesLocais(fuso, new Date(t));
    return (Date.parse(`${l.data}T${l.hora}:${l.seg}Z`) - t) / 60_000;
  };
  let t = base - desloc(base) * 60_000;
  const d2 = desloc(t);
  if (base - d2 * 60_000 !== t) t = base - d2 * 60_000;
  return new Date(t);
}

const somarDias = (d: string, n: number) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};
const diaSemana = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay() + 1;
/** Hora do contrato → "HH:MM" (recusa a inválida). */
const hora = (h: string) => normalizarHora(h);
/** Duração em horas e minutos ("01:00") → minutos. */
const minutos = (h: string) => {
  const n = normalizarHora(h);
  return Number(n.slice(0, 2)) * 60 + Number(n.slice(3, 5));
};
const horaDeTime = (v: unknown): string | null =>
  v === null || v === undefined ? null : String(v).slice(0, 5);
const dataIso = (v: unknown): string | null =>
  v === null || v === undefined
    ? null
    : v instanceof Date
      ? v.toISOString().slice(0, 10)
      : String(v).slice(0, 10);
const num = (v: unknown) => Number(v);
const numOuNull = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const bool = (v: unknown) => v === true || Number(v) === 1;
const txt = (v: unknown) => (v === null || v === undefined ? null : String(v));
const codigoNum = (v: unknown) => (v !== null && v !== undefined ? lerIdBanco(String(v)) : null);
const instante = (v: unknown) => (v instanceof Date ? v : new Date(String(v)));
const marcadores = (n: number) => Array.from({ length: n }, () => '?').join(', ');

const SITUACAO_DO_SIGNIFICADO: Readonly<Record<string, SituacaoMarcacao>> = {
  aguardando: 'marcada',
  bloqueada: 'marcada',
  confirmada: 'confirmada',
  chegou: 'chegou',
  em_atendimento: 'em_atendimento',
  realizada: 'realizada',
  falta: 'falta',
  // Só a remarcada que manteve o horário (cancelamento sem liberar) chega aqui: as canceladas saem da grade.
  cancelada: 'transferida',
};

/** Marcação viva na grade: não cancelada, ou a transferida (o horário antigo continua com o paciente). */
const MARCACAO_NA_GRADE = "(s.significado <> 'cancelada' OR cm.horario_liberado = FALSE)";

const SELECT_MARCACAO = `SELECT m.id, m.paciente_id, m.retorno, m.encaixe, m.marcado_em, m.observacao, m.motivo_encaixe,
  m.remarcada_marcacao_horario_id, m.horario_agenda_id, h.agenda_servico_id, h.data_referencia, h.inicio_em,
  a.nome AS nome_agenda, s.significado, c.codigo AS canal, fp.codigo AS convenio, fp.nome AS nome_convenio,
  COALESCE(pf.nome, pc.nome) AS paciente, p.numero_prontuario, p.pessoa_fisica_id, pc.telefone AS pc_telefone,
  pc.celular AS pc_celular, u.login AS marcado_por, gpl.descricao AS prioridade_legal
FROM marcacao_horario m
JOIN horario_agenda h ON h.id = m.horario_agenda_id
JOIN agenda_servico a ON a.id = h.agenda_servico_id
JOIN situacao_marcacao s ON s.id = m.situacao_marcacao_id
JOIN canal_marcacao c ON c.id = m.canal_marcacao_id
JOIN fonte_pagadora fp ON fp.id = m.fonte_pagadora_id
LEFT JOIN paciente p ON p.id = m.paciente_id
LEFT JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
LEFT JOIN pre_cadastro pc ON pc.id = m.pre_cadastro_id
LEFT JOIN usuario u ON u.id = m.responsavel_usuario_id
LEFT JOIN grupo_prioridade_legal gpl ON gpl.id = m.grupo_prioridade_legal_id
LEFT JOIN cancelamento_marcacao cm ON cm.marcacao_horario_id = m.id AND cm.excluido_em IS NULL
WHERE m.estabelecimento_id = ? AND m.excluido_em IS NULL AND ${MARCACAO_NA_GRADE}`;

const SELECT_AGENDA = `SELECT a.id, a.nome, a.profissional_id, a.ativo, a.duracao_horario_minutos, a.teleatendimento,
  a.unidade_assistencial_id, a.categoria_agenda_id, a.versao,
  (SELECT ic.numero_inscricao FROM inscricao_conselho ic WHERE ic.profissional_id = a.profissional_id
     AND ic.excluido_em IS NULL ORDER BY ic.principal DESC, ic.sequencia LIMIT 1) AS registro,
  (SELECT MIN(h.data_referencia) FROM horario_agenda h WHERE h.agenda_servico_id = a.id AND h.excluido_em IS NULL
     AND h.situacao <> 'cancelado' AND h.inicio_em > ?) AS grade_inicio,
  (SELECT MAX(h.data_referencia) FROM horario_agenda h WHERE h.agenda_servico_id = a.id AND h.excluido_em IS NULL
     AND h.situacao <> 'cancelado' AND h.inicio_em > ?) AS grade_fim,
  (SELECT COUNT(*) FROM agenda_fonte_pagadora f WHERE f.agenda_servico_id = a.id AND f.excluido_em IS NULL) AS convenios,
  (SELECT COUNT(*) FROM agenda_especialidade e WHERE e.agenda_servico_id = a.id AND e.excluido_em IS NULL) AS especialidades
FROM agenda_servico a WHERE a.estabelecimento_id = ? AND a.excluido_em IS NULL`;

export class PortaAgendaPropria implements PortaAgenda {
  readonly destino = 'propria' as const;
  private readonly executor: Executor;
  private readonly estabs = new Map<string, Estab>();
  private readonly fusos = new Map<number, string>();
  private readonly operacoes: Readonly<Record<string, Operacao<never, ResultadoOperacao>>>;

  constructor(
    private readonly nucleo: NucleoAgenda,
    private readonly cliente: string,
    private readonly agora: () => Date = () => new Date(),
  ) {
    this.executor = nucleo.criarExecutor();
    this.operacoes = this.definirOperacoes() as unknown as Readonly<
      Record<string, Operacao<never, ResultadoOperacao>>
    >;
  }

  // ── Contexto ──────────────────────────────────────────────────────────────────────────────────────

  private async estab(c: ContextoAgenda): Promise<Estab> {
    const ja = this.estabs.get(c.hospital);
    if (ja) return ja;
    const l = await this.nucleo.lerSomente(
      { cliente: this.cliente, correlacao: 'agenda-estabelecimento' },
      (x) =>
        x.uma('SELECT id, fuso_horario FROM estabelecimento WHERE codigo = ? AND excluido_em IS NULL', [
          c.hospital,
        ]),
    );
    if (!l)
      throw new ErroOperacao(
        403,
        'estabelecimento-desconhecido',
        'Estabelecimento',
        'O estabelecimento da sessão não existe no cliente.',
      );
    const e = { id: num(l['id']), fuso: String(l['fuso_horario'] || 'America/Sao_Paulo') };
    this.estabs.set(c.hospital, e);
    this.fusos.set(e.id, e.fuso);
    return e;
  }

  private fuso(estabelecimento: number | null): string {
    return (estabelecimento !== null && this.fusos.get(estabelecimento)) || 'America/Sao_Paulo';
  }

  private async ler<T>(c: ContextoAgenda, fn: (l: Leitor, e: Estab) => Promise<T>): Promise<T> {
    const e = await this.estab(c);
    return this.nucleo.lerSomente(
      { cliente: this.cliente, correlacao: 'agenda-leitura', estabelecimento: e.id },
      (l) => fn(l, e),
    );
  }

  private async contexto(c: ContextoGravacao, sufixo = ''): Promise<ContextoOperacao> {
    const e = await this.estab(c);
    const u = await this.nucleo.lerSomente({ cliente: this.cliente, correlacao: c.correlacao }, (l) =>
      l.uma('SELECT id FROM usuario WHERE login = ? AND excluido_em IS NULL', [c.login]),
    );
    if (!u)
      throw recusa(
        'usuario-sem-conta',
        'Gravar na agenda exige uma conta de usuário do cliente (o responsável fica no registro).',
      );
    return {
      cliente: this.cliente,
      estabelecimento: e.id,
      usuario: num(u['id']),
      correlacao: c.correlacao.slice(0, 64),
      chaveIdempotencia: `${c.chaveIdempotencia}${sufixo}`.slice(0, 80),
      ...(c.enderecoIp ? { enderecoIp: c.enderecoIp } : {}),
    };
  }

  // ── Gravações ─────────────────────────────────────────────────────────────────────────────────────

  async podeGravar(c: ContextoAgenda, operacao: string, login: string): Promise<LiberacaoGravacao> {
    const op = Object.hasOwn(this.operacoes, operacao) ? this.operacoes[operacao] : undefined;
    if (!op)
      return { pode: false, codigo: 'operacao-desconhecida', motivo: 'Operação da agenda desconhecida.' };
    const ctx = await this.contexto({
      ...c,
      login,
      correlacao: 'agenda-liberacao',
      chaveIdempotencia: 'liberacao-consulta',
    });
    return this.executor.liberacao(op, ctx);
  }

  async executar(c: ContextoGravacao, operacao: string, entrada: unknown): Promise<GravacaoAgendaFeita> {
    operacaoAgenda(operacao);
    const op = this.operacoes[operacao];
    if (!op) throw recusa('operacao-desconhecida', 'Operação da agenda desconhecida.');
    const r = await this.executor.executar(op, this.cliente, entrada, await this.contexto(c));
    return {
      resultado: r.resultado,
      repetida: r.repetida,
      trilha: r.trilha === null ? null : String(r.trilha),
    };
  }

  async gravar<T>(c: ContextoGravacao, fn: (g: GravadorAgenda) => Promise<T>): Promise<T> {
    let n = 0;
    const rodar = async <E, S extends ResultadoOperacao>(op: Operacao<E, S>, e: E): Promise<S> =>
      (await this.executor.executar(op, this.cliente, e, await this.contexto(c, `:${++n}`))).resultado;
    const A = this.apoio;
    const g: GravadorAgenda = {
      planejarEscala: async (r) => Number((await rodar(A.planejarEscala, r)).id),
      cancelarEscalaPlanejada: async (r) => void (await rodar(A.cancelarEscalaPlanejada, r)),
      gravarConfirmacao: async (r) => Number((await rodar(A.gravarConfirmacao, r)).id),
      gravarBloqueioPeriodo: async (r) => Number((await rodar(A.gravarBloqueioPeriodo, r)).id),
      encerrarBloqueio: async (r) => void (await rodar(A.encerrarBloqueio, r)),
      incluirEspera: async (r) => Number((await rodar(A.incluirEspera, r)).id),
      ofertarEspera: async (r) => void (await rodar(A.ofertarEspera, r)),
      encerrarEspera: async (r) => void (await rodar(A.encerrarEspera, r)),
      gravarVinculo: async (r) => void (await rodar(A.gravarVinculo, r)),
    };
    return fn(g);
  }

  // ── Leituras ──────────────────────────────────────────────────────────────────────────────────────

  async relogio(c: ContextoAgenda): Promise<Relogio> {
    const e = await this.estab(c);
    const l = localDe(e.fuso, this.agora());
    return { hoje: l.data, hora: l.hora };
  }

  private agendaDaLinha(x: Linha, fuso: string): Agenda {
    void fuso;
    return {
      id: num(x['id']),
      nome: String(x['nome']),
      profissional: numOuNull(x['profissional_id']),
      registroProfissional: codigoNum(x['registro']),
      ativa: bool(x['ativo']),
      duracaoMinutos: numOuNull(x['duracao_horario_minutos']),
      teleatendimento: bool(x['teleatendimento']),
      gradeInicio: dataIso(x['grade_inicio']),
      gradeFim: dataIso(x['grade_fim']),
      convenios: num(x['convenios']),
      especialidades: num(x['especialidades']),
      unidade: numOuNull(x['unidade_assistencial_id']),
      categoria: numOuNull(x['categoria_agenda_id']),
      versao: num(x['versao']),
    };
  }

  async agendas(c: ContextoAgenda): Promise<Agenda[]> {
    const agora = this.agora();
    return this.ler(c, async (l, e) => {
      // 02-AGE 40: a agenda restrita a uma lista de usuários some para quem não está nela.
      const ocultas = await agendasOcultas(l, e.id, c.login, c.gestorDeAgendas === true);
      return (await l.consultar(`${SELECT_AGENDA} ORDER BY a.nome`, [agora, agora, e.id]))
        .map((x) => this.agendaDaLinha(x, e.fuso))
        .filter((a) => !ocultas.has(a.id));
    });
  }

  async agenda(c: ContextoAgenda, id: number): Promise<Agenda | null> {
    const agora = this.agora();
    return this.ler(c, async (l, e) => {
      const x = await l.uma(`${SELECT_AGENDA} AND a.id = ?`, [agora, agora, e.id, id]);
      if (x && (await agendasOcultas(l, e.id, c.login, c.gestorDeAgendas === true)).has(id)) return null;
      return x ? this.agendaDaLinha(x, e.fuso) : null;
    });
  }

  async conveniosDaAgenda(c: ContextoAgenda, id: number): Promise<ConvenioDaAgenda[]> {
    const r = await this.relogio(c);
    return this.ler(c, async (l, e) =>
      (
        await l.consultar(
          `SELECT fp.codigo, fp.nome, fp.situacao,
             (SELECT COUNT(*) FROM marcacao_horario m JOIN horario_agenda h ON h.id = m.horario_agenda_id
               JOIN situacao_marcacao s ON s.id = m.situacao_marcacao_id
               WHERE h.agenda_servico_id = f.agenda_servico_id AND m.fonte_pagadora_id = fp.id
                 AND m.excluido_em IS NULL AND s.significado <> 'cancelada' AND h.data_referencia >= ?) AS futuros
           FROM agenda_fonte_pagadora f JOIN fonte_pagadora fp ON fp.id = f.fonte_pagadora_id
           JOIN agenda_servico a ON a.id = f.agenda_servico_id
           WHERE f.agenda_servico_id = ? AND a.estabelecimento_id = ? AND f.excluido_em IS NULL ORDER BY fp.nome`,
          [r.hoje, id, e.id],
        )
      ).flatMap((x) => {
        const codigo = codigoNum(x['codigo']);
        return codigo === null
          ? []
          : [
              {
                codigo,
                nome: String(x['nome']),
                ativo: x['situacao'] === 'ativa',
                marcadosFuturos: num(x['futuros']),
              },
            ];
      }),
    );
  }

  async cobertura(c: ContextoAgenda, ids: readonly number[]): Promise<Map<number, number[]>> {
    if (ids.length === 0) return new Map();
    return this.ler(c, async (l, e) => {
      const m = new Map<number, number[]>();
      const linhas = await l.consultar(
        `SELECT f.agenda_servico_id, fp.codigo FROM agenda_fonte_pagadora f
         JOIN fonte_pagadora fp ON fp.id = f.fonte_pagadora_id JOIN agenda_servico a ON a.id = f.agenda_servico_id
         WHERE a.estabelecimento_id = ? AND f.excluido_em IS NULL AND f.agenda_servico_id IN (${marcadores(ids.length)})`,
        [e.id, ...ids],
      );
      for (const x of linhas) {
        const cod = codigoNum(x['codigo']);
        if (cod === null) continue;
        const a = num(x['agenda_servico_id']);
        m.set(a, [...(m.get(a) ?? []), cod]);
      }
      return m;
    });
  }

  async especialidadesDaAgenda(c: ContextoAgenda, id: number): Promise<{ codigo: number; nome: string }[]> {
    return this.ler(c, async (l, e) =>
      (
        await l.consultar(
          `SELECT em.codigo, em.descricao FROM agenda_especialidade x
           JOIN especialidade_medica em ON em.id = x.especialidade_medica_id
           JOIN agenda_servico a ON a.id = x.agenda_servico_id
           WHERE x.agenda_servico_id = ? AND a.estabelecimento_id = ? AND x.excluido_em IS NULL
           ORDER BY x.principal DESC, em.descricao`,
          [id, e.id],
        )
      ).flatMap((x) => {
        const codigo = codigoNum(x['codigo']);
        return codigo === null ? [] : [{ codigo, nome: String(x['descricao']) }];
      }),
    );
  }

  async opcoes(c: ContextoAgenda): Promise<OpcoesDaAgenda> {
    return this.ler(c, async (l, e) => {
      // Fontes pagadoras e especialidades são da rede inteira (cadastro único do cliente).
      const [conv, esp, loc, uni, gpl] = await Promise.all([
        l.consultar(
          'SELECT codigo, nome, situacao FROM fonte_pagadora WHERE excluido_em IS NULL ORDER BY nome',
        ),
        l.consultar('SELECT codigo, descricao FROM especialidade_medica WHERE ativo ORDER BY descricao'),
        l.consultar(
          'SELECT id, descricao FROM local_atendimento WHERE estabelecimento_id = ? AND ativo AND excluido_em IS NULL ORDER BY descricao',
          [e.id],
        ),
        l.consultar(
          'SELECT id, nome FROM unidade_assistencial WHERE estabelecimento_id = ? AND ativo AND excluido_em IS NULL ORDER BY nome',
          [e.id],
        ),
        // O grupo não tem exclusão lógica (só `ativo`).
        l.consultar('SELECT id, descricao FROM grupo_prioridade_legal WHERE ativo ORDER BY peso, descricao'),
      ]);
      return {
        convenios: conv.flatMap((x) => {
          const codigo = codigoNum(x['codigo']);
          return codigo === null
            ? []
            : [{ codigo, nome: String(x['nome']), ativo: x['situacao'] === 'ativa' }];
        }),
        especialidades: esp.flatMap((x) => {
          const codigo = codigoNum(x['codigo']);
          return codigo === null ? [] : [{ codigo, nome: String(x['descricao']) }];
        }),
        locais: loc.map((x) => ({ codigo: num(x['id']), nome: String(x['descricao']) })),
        unidades: uni.map((x) => ({ codigo: num(x['id']), nome: String(x['nome']) })),
        gruposPrioridadeLegal: gpl.map((x) => ({ codigo: num(x['id']), nome: String(x['descricao']) })),
      };
    });
  }

  private faixaDaLinha(x: Linha): FaixaEscala {
    return {
      diaSemana: num(x['dia_semana']),
      duracaoMinutos: numOuNull(x['duracao_horario_minutos']),
      inicio: horaDeTime(x['hora_inicio']) ?? '00:00',
      fim: horaDeTime(x['hora_fim']) ?? '00:00',
      intervaloInicio: horaDeTime(x['intervalo_inicio']),
      intervaloFim: horaDeTime(x['intervalo_fim']),
    };
  }

  async escala(c: ContextoAgenda, agenda: number): Promise<FaixaEscala[]> {
    const r = await this.relogio(c);
    return this.ler(c, async (l, e) =>
      (
        await l.consultar(
          `SELECT x.dia_semana, x.duracao_horario_minutos, x.hora_inicio, x.hora_fim, x.intervalo_inicio, x.intervalo_fim
           FROM agenda_escala x JOIN agenda_servico a ON a.id = x.agenda_servico_id
           WHERE x.agenda_servico_id = ? AND a.estabelecimento_id = ? AND x.ativo AND x.vigencia_inicio <= ?
             AND (x.vigencia_fim IS NULL OR x.vigencia_fim >= ?) ORDER BY x.dia_semana, x.hora_inicio`,
          [agenda, e.id, r.hoje, r.hoje],
        )
      ).map((x) => this.faixaDaLinha(x)),
    );
  }

  async escalasPlanejadas(c: ContextoAgenda, agenda: number): Promise<EscalaPlanejada[]> {
    const r = await this.relogio(c);
    return this.ler(c, async (l, e) => {
      const linhas = await l.consultar(
        `SELECT x.id, x.vigencia_inicio, x.criado_em, u.login, x.dia_semana, x.duracao_horario_minutos, x.hora_inicio,
           x.hora_fim, x.intervalo_inicio, x.intervalo_fim
         FROM agenda_escala x JOIN agenda_servico a ON a.id = x.agenda_servico_id
         LEFT JOIN usuario u ON u.id = x.criado_por
         WHERE x.agenda_servico_id = ? AND a.estabelecimento_id = ? AND x.ativo AND x.vigencia_inicio > ?
         ORDER BY x.vigencia_inicio, x.id`,
        [agenda, e.id, r.hoje],
      );
      const grupos = new Map<string, { id: number; autor: string; em: string; faixas: FaixaEscala[] }>();
      for (const x of linhas) {
        const k = dataIso(x['vigencia_inicio']) ?? '';
        const g = grupos.get(k) ?? {
          id: num(x['id']),
          autor: txt(x['login']) ?? '',
          em: instante(x['criado_em']).toISOString(),
          faixas: [],
        };
        g.faixas.push(this.faixaDaLinha(x));
        grupos.set(k, g);
      }
      return [...grupos.entries()]
        .map(([vigenteDesde, g]) => ({ ...g, vigenteDesde }))
        .sort((x, y) => y.vigenteDesde.localeCompare(x.vigenteDesde));
    });
  }

  async geracoes(c: ContextoAgenda, agenda: number): Promise<GeracaoGrade[]> {
    return this.ler(c, async (l, e) =>
      (
        await l.consultar(
          `SELECT g.id, g.agenda_servico_id, g.periodo_inicio, g.periodo_fim, g.solicitada_em, u.login,
             g.duracao_horario_minutos, g.horarios_gerados, g.revertida_em,
             (SELECT GROUP_CONCAT(DISTINCT p.dia_semana ORDER BY p.dia_semana) FROM geracao_grade_periodo p
               WHERE p.geracao_grade_id = g.id AND p.excluido_em IS NULL) AS dias
           FROM geracao_grade g LEFT JOIN usuario u ON u.id = g.responsavel_usuario_id
           WHERE g.estabelecimento_id = ? AND g.agenda_servico_id = ? AND g.excluido_em IS NULL
           ORDER BY g.id DESC LIMIT 200`,
          [e.id, agenda],
        )
      ).map((x) => {
        const em = localDe(e.fuso, instante(x['solicitada_em']));
        return {
          id: num(x['id']),
          agenda: num(x['agenda_servico_id']),
          inicio: dataIso(x['periodo_inicio']) ?? '',
          fim: dataIso(x['periodo_fim']) ?? '',
          em: `${em.data}T${em.hora}`,
          autor: txt(x['login']) ?? '',
          duracaoMinutos: numOuNull(x['duracao_horario_minutos']),
          diasSemana: x['dias'] ? String(x['dias']).split(',').map(Number) : [],
          horarios: num(x['horarios_gerados']),
          revertidaEm: x['revertida_em'] ? instante(x['revertida_em']).toISOString() : null,
        };
      }),
    );
  }

  async agendaDaGeracao(c: ContextoAgenda, id: number): Promise<number | null> {
    return this.ler(c, async (l, e) => {
      const x = await l.uma(
        'SELECT agenda_servico_id FROM geracao_grade WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [id, e.id],
      );
      return x ? num(x['agenda_servico_id']) : null;
    });
  }

  async feriados(c: ContextoAgenda, de: string, ate: string): Promise<Feriado[]> {
    // 02-AGE linha 41: nacionais fixos e a Sexta-feira Santa, mais o cadastro de feriados (nacional, da UF, do município e do
    // estabelecimento) e os dias não úteis do cadastro. A regra de qual vale está no domínio.
    return this.ler(c, async (l, e) => {
      const loc = await l.uma(
        `SELECT s.municipio_ibge_id, m.unidade_federativa_id, u.sigla
           FROM estabelecimento s
           LEFT JOIN municipio_ibge m ON m.id = s.municipio_ibge_id
           LEFT JOIN unidade_federativa u ON u.id = m.unidade_federativa_id
          WHERE s.id = ?`,
        [e.id],
      );
      const fer = await l.consultar(
        `SELECT data, nome, abrangencia, uf, municipio_ibge_id, estabelecimento_id, ponto_facultativo
           FROM feriado WHERE ativo AND excluido_em IS NULL AND data BETWEEN ? AND ?`,
        [de, ate],
      );
      const dnu = await l.consultar(
        `SELECT descricao, abrangencia, unidade_federativa_id, municipio_ibge_id, estabelecimento_id, recorrencia,
                dia, mes, data, facultativo, hora_inicio, hora_fim
           FROM dia_nao_util
          WHERE ativo AND excluido_em IS NULL AND (recorrencia = 'anual' OR data BETWEEN ? AND ?)`,
        [de, ate],
      );
      return diasSemExpediente(
        {
          estabelecimento: e.id,
          municipio: numOuNull(loc?.['municipio_ibge_id']),
          uf: txt(loc?.['sigla']),
          ufId: numOuNull(loc?.['unidade_federativa_id']),
        },
        de,
        ate,
        {
          feriados: fer.map((x) => ({
            data: dataIso(x['data']) ?? '',
            nome: String(x['nome']),
            abrangencia: String(x['abrangencia']) as Abrangencia,
            uf: txt(x['uf']),
            municipio: numOuNull(x['municipio_ibge_id']),
            estabelecimento: numOuNull(x['estabelecimento_id']),
            pontoFacultativo: Boolean(Number(x['ponto_facultativo'])),
          })),
          diasNaoUteis: dnu.map((x) => ({
            descricao: String(x['descricao']),
            abrangencia: String(x['abrangencia']) as Abrangencia,
            ufId: numOuNull(x['unidade_federativa_id']),
            municipio: numOuNull(x['municipio_ibge_id']),
            estabelecimento: numOuNull(x['estabelecimento_id']),
            recorrencia: String(x['recorrencia']) as 'anual' | 'data_unica' | 'movel',
            dia: numOuNull(x['dia']),
            mes: numOuNull(x['mes']),
            data: dataIso(x['data']),
            facultativo: Boolean(Number(x['facultativo'])),
            // TIME do banco vem com os segundos: a faixa anda em HH:MM.
            horaInicio: txt(x['hora_inicio'])?.slice(0, 5) ?? null,
            horaFim: txt(x['hora_fim'])?.slice(0, 5) ?? null,
          })),
        },
      );
    });
  }

  private marcacaoDaLinha(x: Linha, fuso: string): Marcacao {
    const l = localDe(fuso, instante(x['inicio_em']));
    const marcada = x['marcado_em'] ? localDe(fuso, instante(x['marcado_em'])).data : null;
    return {
      id: num(x['id']),
      agenda: numOuNull(x['agenda_servico_id']),
      nomeAgenda: String(x['nome_agenda'] ?? ''),
      data: dataIso(x['data_referencia']) ?? l.data,
      hora: l.hora,
      paciente: String(x['paciente'] ?? ''),
      idPaciente: numOuNull(x['paciente_id']),
      prontuario: codigoNum(x['numero_prontuario']),
      convenio: codigoNum(x['convenio']) ?? 0,
      nomeConvenio: txt(x['nome_convenio']),
      retorno: bool(x['retorno']),
      encaixe: bool(x['encaixe']),
      situacao: SITUACAO_DO_SIGNIFICADO[String(x['significado'])] ?? 'marcada',
      canal: String(x['canal'] ?? 'nao-informado'),
      marcadaEm: marcada,
      marcadaPor: txt(x['marcado_por']),
      prioridadeLegal: txt(x['prioridade_legal']),
    };
  }

  async horarios(
    c: ContextoAgenda,
    agenda: number,
    de: string,
    ate: string,
  ): Promise<{ itens: Horario[]; truncado: boolean }> {
    return this.ler(c, async (l, e) => {
      const hs = await l.consultar(
        `SELECT h.id, h.data_referencia, h.inicio_em, h.fim_em, h.tipo_horario, h.situacao
         FROM horario_agenda h WHERE h.estabelecimento_id = ? AND h.agenda_servico_id = ? AND h.excluido_em IS NULL
           AND h.situacao <> 'cancelado' AND h.data_referencia BETWEEN ? AND ?
         ORDER BY h.inicio_em, h.encaixe_ordem LIMIT ${TETO_LEITURA + 1}`,
        [e.id, agenda, de, ate],
        { teto: TETO_LEITURA + 1 },
      );
      const ms = await l.consultar(
        `${SELECT_MARCACAO} AND h.agenda_servico_id = ? AND h.data_referencia BETWEEN ? AND ? ORDER BY m.id`,
        [e.id, agenda, de, ate],
        { teto: TETO_AGREGADO },
      );
      const porHorario = new Map<number, Linha>();
      // A viva (não transferida) prevalece sobre a transferida no mesmo horário.
      for (const m of ms) {
        const h = num(m['horario_agenda_id']);
        const atual = porHorario.get(h);
        if (!atual || atual['significado'] === 'cancelada') porHorario.set(h, m);
      }
      const itens = hs.slice(0, TETO_LEITURA).map((h): Horario => {
        const ini = instante(h['inicio_em']);
        const m = porHorario.get(num(h['id']));
        const mm = m ? this.marcacaoDaLinha(m, e.fuso) : null;
        return {
          data: dataIso(h['data_referencia']) ?? '',
          hora: localDe(e.fuso, ini).hora,
          encaixe: h['tipo_horario'] === 'encaixe',
          bloqueado: h['situacao'] === 'bloqueado',
          duracaoMinutos: Math.round((instante(h['fim_em']).getTime() - ini.getTime()) / 60_000) || null,
          marcacao: mm?.id ?? null,
          paciente: mm?.paciente ?? null,
          situacao: mm?.situacao ?? null,
          convenio: mm ? mm.convenio : null,
        };
      });
      return { itens, truncado: hs.length > TETO_LEITURA };
    });
  }

  async horasMarcadas(c: ContextoAgenda, agenda: number, data: string): Promise<string[]> {
    return (await this.marcacoesDaJanela(c, agenda, data, data)).itens.map((m) => m.hora);
  }

  private async listarMarcacoes(
    c: ContextoAgenda,
    filtro: string,
    params: readonly unknown[],
    ordem = 'h.inicio_em, m.id',
  ): Promise<{ itens: Marcacao[]; truncado: boolean }> {
    return this.ler(c, async (l, e) => {
      const linhas = await l.consultar(
        `${SELECT_MARCACAO} ${filtro} ORDER BY ${ordem} LIMIT ${TETO_LEITURA + 1}`,
        [e.id, ...params],
        { teto: TETO_LEITURA + 1 },
      );
      return {
        itens: linhas.slice(0, TETO_LEITURA).map((x) => this.marcacaoDaLinha(x, e.fuso)),
        truncado: linhas.length > TETO_LEITURA,
      };
    });
  }

  marcacoesDaJanela(c: ContextoAgenda, agenda: number, de: string, ate: string) {
    return this.listarMarcacoes(c, 'AND h.agenda_servico_id = ? AND h.data_referencia BETWEEN ? AND ?', [
      agenda,
      de,
      ate,
    ]);
  }

  marcacoesDoDia(c: ContextoAgenda, data: string) {
    return this.listarMarcacoes(c, 'AND h.data_referencia = ?', [data]);
  }

  async marcacao(
    c: ContextoAgenda,
    id: number,
  ): Promise<{ marcacao: Marcacao; contato: ContatoMarcacao } | null> {
    return this.ler(c, async (l, e) => {
      // A marcação cancelada também se lê pelo id (detalhe e histórico).
      const x = await l.uma(`${SELECT_MARCACAO.replace(` AND ${MARCACAO_NA_GRADE}`, '')} AND m.id = ?`, [
        e.id,
        id,
      ]);
      if (!x) return null;
      let telefone = txt(x['pc_telefone']);
      let celular = txt(x['pc_celular']);
      if (x['pessoa_fisica_id'] !== null && x['pessoa_fisica_id'] !== undefined) {
        const fones = await l.consultar(
          `SELECT ddd, numero, usa_aplicativo_mensagem FROM telefone_pessoa
           WHERE pessoa_fisica_id = ? AND excluido_em IS NULL ORDER BY principal DESC, sequencia LIMIT 5`,
          [x['pessoa_fisica_id']],
        );
        const f = (y: Linha | undefined) => (y ? `${txt(y['ddd']) ?? ''}${String(y['numero'])}` : null);
        telefone = f(fones[0]);
        celular = f(fones.find((y) => bool(y['usa_aplicativo_mensagem'])));
      }
      const m = this.marcacaoDaLinha(x, e.fuso);
      return { marcacao: m, contato: { telefone, celular, observacao: txt(x['observacao']) } };
    });
  }

  async marcacoesDoPaciente(c: ContextoAgenda, id: number) {
    const r = await this.listarMarcacoes(c, 'AND m.paciente_id = ?', [id], 'h.inicio_em DESC, m.id DESC');
    const preCadastros = await this.ler(c, async (l, e) =>
      (
        await l.consultar(
          `SELECT a.nome, h.data_referencia FROM marcacao_horario m
           JOIN pre_cadastro pc ON pc.id = m.pre_cadastro_id
           JOIN horario_agenda h ON h.id = m.horario_agenda_id JOIN agenda_servico a ON a.id = h.agenda_servico_id
           WHERE m.estabelecimento_id = ? AND m.excluido_em IS NULL AND pc.paciente_id = ? ORDER BY h.inicio_em DESC LIMIT 100`,
          [e.id, id],
        )
      ).map((x): PreCadastroMarcado => ({
        nomeAgenda: String(x['nome']),
        data: dataIso(x['data_referencia']),
      })),
    );
    return { ...r, preCadastros };
  }

  async vagas(
    c: ContextoAgenda,
    f: { agendas: readonly number[] | null; de: string; ate: string; limite?: number },
  ): Promise<{ itens: Vaga[]; truncado: boolean }> {
    const limite = Math.min(f.limite ?? 500, TETO_LEITURA);
    if (f.agendas && f.agendas.length === 0) return { itens: [], truncado: false };
    const agora = this.agora();
    return this.ler(c, async (l, e) => {
      const filtro = f.agendas ? `AND h.agenda_servico_id IN (${marcadores(f.agendas.length)})` : '';
      const linhas = await l.consultar(
        `SELECT h.agenda_servico_id, a.nome, h.data_referencia, h.inicio_em FROM horario_agenda h
         JOIN agenda_servico a ON a.id = h.agenda_servico_id
         WHERE h.estabelecimento_id = ? AND h.excluido_em IS NULL AND a.ativo AND a.excluido_em IS NULL
           AND h.situacao = 'livre' AND h.tipo_horario = 'regular' AND h.vagas_ocupadas < h.vagas
           AND h.inicio_em > ? AND h.data_referencia BETWEEN ? AND ? ${filtro}
         ORDER BY h.inicio_em, h.agenda_servico_id LIMIT ${limite + 1}`,
        [e.id, agora, f.de, f.ate, ...(f.agendas ?? [])],
        { teto: limite + 1 },
      );
      return {
        itens: linhas.slice(0, limite).map((x) => ({
          agenda: num(x['agenda_servico_id']),
          nomeAgenda: String(x['nome']),
          data: dataIso(x['data_referencia']) ?? '',
          hora: localDe(e.fuso, instante(x['inicio_em'])).hora,
        })),
        truncado: linhas.length > limite,
      };
    });
  }

  async proximasVagas(
    c: ContextoAgenda,
    agendas: readonly number[],
    depoisDe: string,
    ate: string,
  ): Promise<Vaga[]> {
    const r: Vaga[] = [];
    for (const a of agendas) {
      const v = await this.vagas(c, { agendas: [a], de: somarDias(depoisDe, 1), ate, limite: 1 });
      if (v.itens[0]) r.push(v.itens[0]);
    }
    return r;
  }

  async cancelamentos(
    c: ContextoAgenda,
    f: {
      de: string;
      ate: string;
      agendas: readonly number[] | null;
      motivo?: string | null;
      pagina: number;
      porPagina: number;
    },
  ): Promise<{ itens: Cancelamento[]; total: number }> {
    if (f.agendas && f.agendas.length === 0) return { itens: [], total: 0 };
    return this.ler(c, async (l, e) => {
      const ini = instanteDe(e.fuso, f.de, '00:00');
      const fim = instanteDe(e.fuso, somarDias(f.ate, 1), '00:00');
      const filtros = [
        f.agendas ? `AND h.agenda_servico_id IN (${marcadores(f.agendas.length)})` : '',
        f.motivo ? 'AND mc.codigo = ?' : '',
      ].join(' ');
      const params = [e.id, ini, fim, ...(f.agendas ?? []), ...(f.motivo ? [f.motivo] : [])];
      const base = `FROM cancelamento_marcacao cm JOIN marcacao_horario m ON m.id = cm.marcacao_horario_id
        JOIN horario_agenda h ON h.id = m.horario_agenda_id JOIN agenda_servico a ON a.id = h.agenda_servico_id
        JOIN motivo_cancelamento_operacao mc ON mc.id = cm.motivo_cancelamento_operacao_id
        LEFT JOIN paciente p ON p.id = m.paciente_id LEFT JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
        LEFT JOIN pre_cadastro pc ON pc.id = m.pre_cadastro_id LEFT JOIN usuario u ON u.id = cm.responsavel_usuario_id
        WHERE cm.estabelecimento_id = ? AND cm.excluido_em IS NULL AND cm.cancelado_em >= ? AND cm.cancelado_em < ? ${filtros}`;
      const [t] = await l.consultar(`SELECT COUNT(*) AS n ${base}`, params);
      const linhas = await l.consultar(
        `SELECT cm.id, cm.cancelado_em, cm.complemento, cm.solicitante, mc.codigo AS motivo_codigo, mc.descricao,
           u.login, h.agenda_servico_id, a.nome, h.data_referencia, h.inicio_em, COALESCE(pf.nome, pc.nome) AS paciente
         ${base} ORDER BY cm.id DESC LIMIT ? OFFSET ?`,
        [...params, f.porPagina, (f.pagina - 1) * f.porPagina],
      );
      return {
        total: num(t?.['n'] ?? 0),
        itens: linhas.map((x) => {
          const quando = localDe(e.fuso, instante(x['cancelado_em']));
          const codigo = String(x['motivo_codigo']);
          const conhecido = MOTIVOS_CANCELAMENTO.some((m) => m.codigo === codigo);
          return {
            protocolo: num(x['id']),
            agenda: num(x['agenda_servico_id']),
            nomeAgenda: String(x['nome']),
            data: dataIso(x['data_referencia']) ?? '',
            hora: localDe(e.fuso, instante(x['inicio_em'])).hora,
            paciente: String(x['paciente'] ?? ''),
            canceladoEm: quando.data,
            horaCancelamento: quando.hora,
            canceladoPor: txt(x['login']),
            motivo: conhecido ? textoDoMotivo(codigo, txt(x['complemento'])) : String(x['descricao']),
            motivoCodigo: codigo,
            solicitante: txt(x['solicitante']),
          };
        }),
      };
    });
  }

  async cancelamentosPorMotivo(c: ContextoAgenda, de: string, ate: string) {
    return this.ler(c, async (l, e) =>
      (
        await l.consultar(
          `SELECT mc.codigo, COUNT(*) AS n FROM cancelamento_marcacao cm
           JOIN marcacao_horario m ON m.id = cm.marcacao_horario_id JOIN horario_agenda h ON h.id = m.horario_agenda_id
           JOIN motivo_cancelamento_operacao mc ON mc.id = cm.motivo_cancelamento_operacao_id
           WHERE cm.estabelecimento_id = ? AND cm.excluido_em IS NULL AND h.data_referencia BETWEEN ? AND ?
           GROUP BY mc.codigo ORDER BY mc.codigo`,
          [e.id, de, ate],
        )
      ).map((x) => ({ motivo: String(x['codigo']), total: num(x['n']) })),
    );
  }

  async indicadores(c: ContextoAgenda, de: string, ate: string): Promise<ContagensIndicadores> {
    return this.ler(c, async (l, e) => {
      const hs = await l.consultar(
        `SELECT a.nome, COUNT(*) AS horarios, SUM(h.vagas_ocupadas > 0) AS ocupados,
           SUM(h.vagas_ocupadas = 0) AS livres, SUM(h.tipo_horario = 'encaixe') AS encaixes
         FROM horario_agenda h JOIN agenda_servico a ON a.id = h.agenda_servico_id
         WHERE h.estabelecimento_id = ? AND h.excluido_em IS NULL AND h.situacao <> 'cancelado'
           AND h.data_referencia BETWEEN ? AND ? GROUP BY a.nome ORDER BY a.nome`,
        [e.id, de, ate],
      );
      const ms = await l.consultar(
        `SELECT a.nome, h.data_referencia, m.marcado_em, s.significado, c.codigo AS canal
         FROM marcacao_horario m JOIN horario_agenda h ON h.id = m.horario_agenda_id
         JOIN agenda_servico a ON a.id = h.agenda_servico_id JOIN situacao_marcacao s ON s.id = m.situacao_marcacao_id
         JOIN canal_marcacao c ON c.id = m.canal_marcacao_id
         WHERE m.estabelecimento_id = ? AND m.excluido_em IS NULL AND s.significado <> 'cancelada'
           AND h.data_referencia BETWEEN ? AND ?`,
        [e.id, de, ate],
        { teto: TETO_AGREGADO },
      );
      const [canc] = await l.consultar(
        `SELECT COUNT(*) AS n FROM cancelamento_marcacao cm JOIN marcacao_horario m ON m.id = cm.marcacao_horario_id
         JOIN horario_agenda h ON h.id = m.horario_agenda_id
         WHERE cm.estabelecimento_id = ? AND cm.excluido_em IS NULL AND h.data_referencia BETWEEN ? AND ?`,
        [e.id, de, ate],
      );
      const compareceu = (x: Linha) => x['significado'] === 'realizada';
      const faixa = (x: Linha) => {
        if (!x['marcado_em']) return 'nao-informada';
        const marcada = localDe(e.fuso, instante(x['marcado_em'])).data;
        const d = Math.round(
          (Date.parse(`${dataIso(x['data_referencia'])}T00:00:00Z`) - Date.parse(`${marcada}T00:00:00Z`)) /
            86_400_000,
        );
        return d <= 0 ? 'mesmo-dia' : d <= 7 ? 'ate-7' : d <= 30 ? 'de-8-a-30' : 'mais-de-30';
      };
      const contar = (chave: (x: Linha) => string) => {
        const m = new Map<string, { marcados: number; compareceu: number }>();
        for (const x of ms) {
          const k = chave(x);
          const a = m.get(k) ?? { marcados: 0, compareceu: 0 };
          a.marcados++;
          if (compareceu(x)) a.compareceu++;
          m.set(k, a);
        }
        return [...m.entries()].map(([k, v]) => ({ chave: k, ...v }));
      };
      const soma = (k: string) => hs.reduce((t, x) => t + num(x[k] ?? 0), 0);
      return {
        ocupacao: hs.map((x) => ({
          agenda: String(x['nome']),
          horarios: num(x['horarios']),
          ocupados: num(x['ocupados']),
        })),
        porAntecedencia: contar(faixa),
        porAgenda: contar((x) => String(x['nome'])),
        funil: {
          horarios: soma('horarios'),
          livres: soma('livres'),
          marcados: ms.length,
          compareceu: ms.filter(compareceu).length,
          cancelados: num(canc?.['n'] ?? 0),
          encaixes: soma('encaixes'),
        },
        porCanal: contar((x) => String(x['canal'])).map((x) => ({ canal: x.chave, marcados: x.marcados })),
      };
    });
  }

  async pacientes(c: ContextoAgenda, ids: readonly number[]): Promise<PacienteDaAgenda[]> {
    if (ids.length === 0) return [];
    // Paciente é cadastro único da rede inteira do cliente (sem estabelecimento).
    return this.ler(c, async (l) =>
      (
        await l.consultar(
          `SELECT p.id, pf.nome, p.numero_prontuario FROM paciente p JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
           WHERE p.excluido_em IS NULL AND p.id IN (${marcadores(ids.length)})`,
          [...ids],
        )
      ).map((x) => ({
        id: num(x['id']),
        nome: String(x['nome']),
        prontuario: codigoNum(x['numero_prontuario']),
      })),
    );
  }

  async complementos(c: ContextoAgenda, ids: readonly number[]): Promise<Map<number, ComplementoMarcacao>> {
    if (ids.length === 0) return new Map();
    return this.ler(c, async (l, e) => {
      const linhas = await l.consultar(
        `SELECT m.id, c.codigo AS canal, m.encaixe, m.motivo_encaixe, m.remarcada_marcacao_horario_id,
           ca.horario_liberado, u.login
         FROM marcacao_horario m JOIN canal_marcacao c ON c.id = m.canal_marcacao_id
         LEFT JOIN cancelamento_marcacao ca ON ca.marcacao_horario_id = m.remarcada_marcacao_horario_id
           AND ca.excluido_em IS NULL
         LEFT JOIN usuario u ON u.id = m.responsavel_usuario_id
         WHERE m.estabelecimento_id = ? AND m.id IN (${marcadores(ids.length)})`,
        [e.id, ...ids],
      );
      return new Map(
        linhas.map((x) => {
          const de = numOuNull(x['remarcada_marcacao_horario_id']);
          return [
            num(x['id']),
            {
              marcacao: num(x['id']),
              canal: String(x['canal']),
              encaixe: bool(x['encaixe']),
              motivoEncaixe: txt(x['motivo_encaixe']),
              remarcadaDe: de,
              modoRemarcacao: de === null ? null : bool(x['horario_liberado']) ? 'liberar' : 'transferir',
              criadoPor: txt(x['login']) ?? '',
            },
          ];
        }),
      );
    });
  }

  async bloqueios(
    c: ContextoAgenda,
    f: { agenda?: number | null; ativos?: boolean; de?: string | null; ate?: string | null },
  ): Promise<BloqueioAgenda[]> {
    return this.ler(c, async (l, e) => {
      const filtros: string[] = [];
      const params: unknown[] = [e.id];
      if (f.agenda) {
        filtros.push('AND b.agenda_servico_id = ?');
        params.push(f.agenda);
      }
      if (f.ativos) filtros.push("AND b.situacao = 'ativo'");
      if (f.de && f.ate) {
        filtros.push('AND b.inicio_em < ? AND b.fim_em > ?');
        params.push(instanteDe(e.fuso, somarDias(f.ate, 1), '00:00'), instanteDe(e.fuso, f.de, '00:00'));
      }
      const linhas = await l.consultar(
        `SELECT b.id, b.agenda_servico_id, a.nome, b.inicio_em, b.fim_em, b.previsao_retorno, b.situacao, b.observacao,
           mb.codigo, u.login, b.criado_em,
           (SELECT COUNT(*) FROM horario_agenda h WHERE h.bloqueio_agenda_id = b.id AND h.excluido_em IS NULL) AS horarios
         FROM bloqueio_agenda b JOIN agenda_servico a ON a.id = b.agenda_servico_id
         JOIN motivo_bloqueio_agenda mb ON mb.id = b.motivo_bloqueio_agenda_id
         LEFT JOIN usuario u ON u.id = b.responsavel_usuario_id
         WHERE b.estabelecimento_id = ? AND b.excluido_em IS NULL ${filtros.join(' ')}
         ORDER BY b.id DESC LIMIT 1000`,
        params,
      );
      return linhas.map((x) => {
        const ini = localDe(e.fuso, instante(x['inicio_em']));
        const fimInst = instante(x['fim_em']);
        const fim = localDe(e.fuso, fimInst);
        const fimDia =
          fim.hora === '00:00' ? localDe(e.fuso, new Date(fimInst.getTime() - 1)).data : fim.data;
        return {
          id: num(x['id']),
          agenda: num(x['agenda_servico_id']),
          nomeAgenda: String(x['nome']),
          inicio: ini.data,
          fim: fimDia,
          horaInicio: ini.hora === '00:00' ? null : ini.hora,
          horaFim: fim.hora === '00:00' ? null : fim.hora,
          motivo: String(x['codigo']),
          complemento: txt(x['observacao']),
          previsaoRetorno: dataIso(x['previsao_retorno']),
          horarios: num(x['horarios']),
          autor: txt(x['login']) ?? '',
          criadoEm: instante(x['criado_em']).toISOString(),
          ativo: x['situacao'] === 'ativo',
        };
      });
    });
  }

  async horariosDoBloqueio(c: ContextoAgenda, id: number): Promise<{ data: string; hora: string }[]> {
    return this.ler(c, async (l, e) =>
      (
        await l.consultar(
          `SELECT data_referencia, inicio_em FROM horario_agenda
           WHERE bloqueio_agenda_id = ? AND estabelecimento_id = ? AND excluido_em IS NULL ORDER BY inicio_em`,
          [id, e.id],
        )
      ).map((x) => ({
        data: dataIso(x['data_referencia']) ?? '',
        hora: localDe(e.fuso, instante(x['inicio_em'])).hora,
      })),
    );
  }

  async confirmacoes(c: ContextoAgenda, marcacao: number): Promise<ConfirmacaoRegistrada[]> {
    return this.ler(c, async (l, e) =>
      (
        await l.consultar(
          `SELECT sc.codigo, sc.significado, cn.codigo AS canal, COALESCE(cf.respondida_em, cf.solicitada_em) AS em, u.login
           FROM confirmacao_marcacao cf JOIN situacao_confirmacao sc ON sc.id = cf.situacao_confirmacao_id
           JOIN canal_marcacao cn ON cn.id = cf.canal_marcacao_id LEFT JOIN usuario u ON u.id = cf.responsavel_usuario_id
           WHERE cf.marcacao_horario_id = ? AND cf.estabelecimento_id = ? AND cf.excluido_em IS NULL
           ORDER BY cf.tentativa DESC`,
          [marcacao, e.id],
        )
      ).map((x) => ({
        resultado: resultadoDaSituacao(String(x['codigo']), String(x['significado'])),
        canal: String(x['canal']),
        em: instante(x['em']).toISOString(),
        por: txt(x['login']) ?? '',
      })),
    );
  }

  async espera(
    c: ContextoAgenda,
    f: { situacoes: readonly string[]; agenda?: number | null; especialidade?: number | null },
  ): Promise<ItemListaEspera[]> {
    if (f.situacoes.length === 0) return [];
    return this.ler(c, async (l, e) => {
      const filtros: string[] = [`AND le.situacao IN (${marcadores(f.situacoes.length)})`];
      const params: unknown[] = [e.id, ...f.situacoes];
      if (f.agenda) {
        filtros.push('AND le.agenda_servico_id = ?');
        params.push(f.agenda);
      }
      if (f.especialidade !== null && f.especialidade !== undefined) {
        filtros.push('AND em.codigo = ?');
        params.push(String(f.especialidade));
      }
      const linhas = await l.consultar(
        `SELECT le.id, le.paciente_id, p.numero_prontuario, le.agenda_servico_id, em.codigo AS especialidade,
           le.prioridade, le.situacao, le.observacao, le.entrada_em, le.marcacao_horario_id,
           le.grupo_prioridade_legal_id, gpl.descricao AS grupo_descricao, gpl.peso AS grupo_peso,
           (SELECT hh.dados FROM lista_espera_historico hh WHERE hh.lista_espera_id = le.id AND hh.evento = 'oferta'
             ORDER BY hh.id DESC LIMIT 1) AS oferta
         FROM lista_espera le LEFT JOIN paciente p ON p.id = le.paciente_id
         LEFT JOIN especialidade_medica em ON em.id = le.especialidade_medica_id
         LEFT JOIN grupo_prioridade_legal gpl ON gpl.id = le.grupo_prioridade_legal_id
         WHERE le.estabelecimento_id = ? AND le.excluido_em IS NULL AND le.paciente_id IS NOT NULL ${filtros.join(' ')}
         ORDER BY le.prioridade = 'urgente' DESC,
           COALESCE(gpl.peso, IF(le.prioridade = 'preferencial', ${PESO_PREFERENCIAL_SEM_GRUPO}, ${Number.MAX_SAFE_INTEGER})),
           le.entrada_em, le.id LIMIT ${TETO_LEITURA}`,
        params,
        { teto: TETO_LEITURA },
      );
      return linhas.map((x) => {
        let oferta: ItemListaEspera['oferta'] = null;
        if (x['situacao'] === 'ofertado' && x['oferta']) {
          const o = (typeof x['oferta'] === 'string' ? JSON.parse(x['oferta']) : x['oferta']) as Record<
            string,
            unknown
          >;
          oferta = { agenda: num(o['agenda']), data: String(o['data']), hora: String(o['hora']) };
        }
        return {
          id: num(x['id']),
          paciente: num(x['paciente_id']),
          prontuario: codigoNum(x['numero_prontuario']),
          agenda: numOuNull(x['agenda_servico_id']),
          especialidade: codigoNum(x['especialidade']),
          prioridade: String(x['prioridade']),
          prioridadeLegal:
            x['grupo_prioridade_legal_id'] === null || x['grupo_prioridade_legal_id'] === undefined
              ? null
              : {
                  id: num(x['grupo_prioridade_legal_id']),
                  descricao: txt(x['grupo_descricao']) ?? '',
                  peso: num(x['grupo_peso']),
                },
          situacao: String(x['situacao']),
          observacao: txt(x['observacao']),
          desde: instante(x['entrada_em']).toISOString(),
          oferta,
          marcacao: numOuNull(x['marcacao_horario_id']),
        };
      });
    });
  }

  async vinculos(c: ContextoAgenda): Promise<Map<number, VinculoAgenda>> {
    return this.ler(c, async (l, e) => {
      const linhas = await l.consultar(
        `SELECT a.id, a.profissional_id, a.local_atendimento_id, a.unidade_assistencial_id,
           (SELECT em.codigo FROM agenda_especialidade x JOIN especialidade_medica em ON em.id = x.especialidade_medica_id
             WHERE x.agenda_servico_id = a.id AND x.excluido_em IS NULL ORDER BY x.principal DESC, x.id LIMIT 1) AS especialidade
         FROM agenda_servico a WHERE a.estabelecimento_id = ? AND a.excluido_em IS NULL`,
        [e.id],
      );
      return new Map(
        linhas.map((x) => [
          num(x['id']),
          {
            agenda: num(x['id']),
            profissional: numOuNull(x['profissional_id']),
            especialidade: codigoNum(x['especialidade']),
            local: numOuNull(x['local_atendimento_id']),
            unidade: numOuNull(x['unidade_assistencial_id']),
            situacao: 'revisada' as const,
          },
        ]),
      );
    });
  }

  async profissionais(c: ContextoAgenda): Promise<{ id: number; nome: string }[]> {
    // Profissional é cadastro da rede inteira do cliente.
    return this.ler(c, async (l) =>
      (
        await l.consultar(
          `SELECT pr.id, COALESCE(pr.nome_exibicao, pf.nome) AS nome FROM profissional pr
           JOIN pessoa_fisica pf ON pf.id = pr.pessoa_fisica_id
           WHERE pr.excluido_em IS NULL AND pr.situacao = 'ativo' ORDER BY nome LIMIT ${TETO_LEITURA}`,
          [],
          { teto: TETO_LEITURA },
        )
      ).map((x) => ({ id: num(x['id']), nome: String(x['nome']) })),
    );
  }

  // ── Operações (Executor) ──────────────────────────────────────────────────────────────────────────

  private readonly apoio = this.definirApoio();

  private definirOperacoes() {
    const agendar = (nome: 'agenda.agendarConsulta' | 'agenda.encaixar') =>
      operacao({
        nome,
        tabelas: ['horario_agenda', 'marcacao_horario', 'sequencia_negocio'],
        entrada: (nome === 'agenda.encaixar' ? esquemaEncaixar : esquemaAgendarConsulta) as z.ZodType<
          z.infer<typeof esquemaEncaixar> | z.infer<typeof esquemaAgendarConsulta>
        >,
        gravar: async (tx, e, ctx) => {
          if ('teleconsulta' in e && e.teleconsulta)
            throw recusa(
              'teleconsulta-fora-do-modulo',
              'A teleconsulta do portal é marcada pelo módulo do portal.',
            );
          const encaixe = nome === 'agenda.encaixar';
          const alertas: string[] = [];
          const m = await this.marcarNoHorario(tx, ctx, {
            agenda: e.agenda,
            data: e.data,
            hora: hora(e.hora),
            paciente: e.paciente,
            convenio: e.convenio,
            retorno: e.retorno,
            canal: e.canal,
            observacao: e.observacao ?? null,
            prioridadeLegal: e.prioridadeLegal ?? null,
            encaixe: encaixe ? ('motivo' in e ? String(e.motivo) : '') : null,
            remarcadaDe: null,
            alertas,
          });
          return alertas.length
            ? {
                marcacao: m,
                agenda: e.agenda,
                alerta: 'profissional-nao-credenciado',
                alertaMotivo: alertas[0]!,
              }
            : { marcacao: m, agenda: e.agenda };
        },
        alvo: (_e, r) => ({ tabela: 'marcacao_horario', id: Number(r.marcacao) }),
      });
    // 02-AGE 42: marcação para quem ainda não tem prontuário, com o pré-cadastro na mesma transação.
    const agendarSemProntuario = operacao({
      nome: 'agenda.agendarSemProntuario',
      tabelas: ['horario_agenda', 'marcacao_horario', 'sequencia_negocio', 'pre_cadastro'],
      entrada: esquemaAgendarSemProntuario,
      gravar: async (tx, e, ctx) => {
        const alertas: string[] = [];
        const m = await this.marcarNoHorario(tx, ctx, {
          agenda: e.agenda,
          data: e.data,
          hora: hora(e.hora),
          paciente: null,
          preCadastro: { nome: e.nome, nascimento: e.nascimento, telefone: e.telefone },
          convenio: e.convenio,
          retorno: false,
          canal: e.canal,
          observacao: null,
          encaixe: null,
          remarcadaDe: null,
          alertas,
        });
        const [r] = await tx.consultar('SELECT pre_cadastro_id FROM marcacao_horario WHERE id = ?', [m]);
        const base = { marcacao: m, agenda: e.agenda, preCadastro: num(r?.['pre_cadastro_id']) };
        return alertas.length
          ? { ...base, alerta: 'profissional-nao-credenciado', alertaMotivo: alertas[0]! }
          : base;
      },
      alvo: (_e, r) => ({ tabela: 'marcacao_horario', id: Number(r.marcacao) }),
    });
    const cancelar = (nome: 'agenda.cancelarConsulta' | 'agenda.desfazerEncaixe') =>
      operacao({
        nome,
        tabelas: ['horario_agenda', 'marcacao_horario', 'cancelamento_marcacao'],
        entrada: (nome === 'agenda.desfazerEncaixe'
          ? esquemaDesfazerEncaixe
          : esquemaCancelarConsulta) as z.ZodType<
          z.infer<typeof esquemaDesfazerEncaixe> & { solicitante?: string }
        >,
        gravar: async (tx, e, ctx) => {
          const m = await this.travarMarcacao(tx, ctx, e.marcacao);
          if (nome === 'agenda.desfazerEncaixe' && !bool(m['encaixe']))
            throw recusa('nao-e-encaixe', 'A marcação não é de encaixe: use o cancelamento.');
          const protocolo = await this.cancelarMarcacao(tx, ctx, m, {
            motivo: e.motivo,
            complemento: e.complemento ?? null,
            solicitante: e.solicitante ?? 'hospital',
            liberar: true,
            nova: null,
          });
          return { protocolo, marcacao: e.marcacao };
        },
        alvo: (e) => ({ tabela: 'marcacao_horario', id: e.marcacao }),
      });
    const situacao = (nome: 'agenda.confirmarConsulta' | 'agenda.registrarFalta') =>
      operacao({
        nome,
        tabelas: ['marcacao_horario', 'confirmacao_marcacao'],
        entrada: nome === 'agenda.confirmarConsulta' ? esquemaConfirmarConsulta : esquemaRegistrarFalta,
        gravar: async (tx, e, ctx) => {
          const m = await this.travarMarcacao(tx, ctx, e.marcacao);
          const sig = String(m['significado']);
          const passou = instante(m['inicio_em']).getTime() <= this.agora().getTime();
          const agora = this.agora();
          if (nome === 'agenda.confirmarConsulta') {
            if (sig !== 'aguardando')
              throw recusa('ja-confirmada', 'A marcação já tem situação (confirmada, falta ou outra).');
            if (passou) throw recusa('horario-passado', 'A consulta já passou.');
            await tx.alterar('marcacao_horario', num(m['id']), num(m['versao']), {
              situacao_marcacao_id: await this.situacaoMarcacao(tx, 'confirmada'),
            });
            const [t] = await tx.consultar(
              'SELECT COALESCE(MAX(tentativa), 0) + 1 AS n FROM confirmacao_marcacao WHERE marcacao_horario_id = ?',
              [m['id']],
            );
            await tx.incluir('confirmacao_marcacao', {
              estabelecimento_id: ctx.estabelecimento,
              marcacao_horario_id: m['id'],
              tentativa: num(t?.['n'] ?? 1),
              canal_marcacao_id: m['canal_marcacao_id'],
              situacao_confirmacao_id: await this.situacaoConfirmacao(tx, 'confirmado'),
              automatica: false,
              solicitada_em: agora,
              respondida_em: agora,
              responsavel_usuario_id: ctx.usuario,
            });
          } else {
            if (sig !== 'aguardando' && sig !== 'confirmada')
              throw recusa(
                'situacao-mudou',
                'A marcação já tem outra situação (falta, chegada ou transferência).',
              );
            if (!passou)
              throw recusa(
                'consulta-futura',
                'A consulta ainda não aconteceu: a falta só se registra depois do horário.',
              );
            await tx.alterar('marcacao_horario', num(m['id']), num(m['versao']), {
              situacao_marcacao_id: await this.situacaoMarcacao(tx, 'falta'),
              falta_registrada_em: agora,
            });
          }
          return { marcacao: e.marcacao };
        },
        alvo: (e) => ({ tabela: 'marcacao_horario', id: e.marcacao }),
      });
    const vinculo = (nome: 'agenda.definirCobertura' | 'agenda.definirEspecialidade') =>
      operacao({
        nome,
        tabelas: nome === 'agenda.definirCobertura' ? ['agenda_fonte_pagadora'] : ['agenda_especialidade'],
        entrada: (nome === 'agenda.definirCobertura'
          ? esquemaDefinirCobertura
          : esquemaDefinirEspecialidade) as z.ZodType<{
          agenda: number;
          acao: 'incluir' | 'remover';
          convenio?: number;
          especialidade?: number;
          confirmarAceitarTodos?: boolean;
        }>,
        gravar: async (tx, e, ctx) => {
          await this.travarAgenda(tx, ctx, e.agenda);
          const cob = nome === 'agenda.definirCobertura';
          const cod = String(cob ? e.convenio : e.especialidade);
          const tabela = cob ? 'agenda_fonte_pagadora' : 'agenda_especialidade';
          const coluna = cob ? 'fonte_pagadora_id' : 'especialidade_medica_id';
          const alvo = cob
            ? await tx.uma('SELECT id FROM fonte_pagadora WHERE codigo = ? AND excluido_em IS NULL', [cod])
            : await tx.uma('SELECT id FROM especialidade_medica WHERE codigo = ? AND ativo', [cod]);
          if (!alvo)
            throw recusa(
              cob ? 'convenio-inexistente' : 'especialidade-inexistente',
              cob ? 'O convênio não existe.' : 'A especialidade não existe.',
            );
          const linhas = await tx.consultarParaAtualizar(
            `SELECT id, versao, ${coluna} AS alvo, excluido_em FROM ${tabela} WHERE agenda_servico_id = ?`,
            [e.agenda],
          );
          const minha = linhas.find((x) => num(x['alvo']) === num(alvo['id']));
          const ativas = linhas.filter((x) => x['excluido_em'] === null);
          if (e.acao === 'incluir') {
            if (minha && minha['excluido_em'] === null)
              throw recusa(
                cob ? 'ja-aceito' : 'ja-ligada',
                cob ? 'O convênio já está na lista da agenda.' : 'A especialidade já está ligada à agenda.',
              );
            if (minha)
              await tx.alterar(tabela, num(minha['id']), num(minha['versao']), {
                excluido_em: null,
                excluido_por: null,
              });
            else
              await tx.incluir(tabela, {
                agenda_servico_id: e.agenda,
                [coluna]: alvo['id'],
                ...(cob ? {} : { principal: ativas.length === 0 }),
              });
          } else {
            if (!minha || minha['excluido_em'] !== null)
              throw recusa(
                cob ? 'nao-aceito' : 'nao-ligada',
                cob ? 'O convênio não está na lista da agenda.' : 'A especialidade não está ligada à agenda.',
              );
            if (cob && ativas.length === 1 && !e.confirmarAceitarTodos)
              throw recusa(
                'confirmar-aceitar-todos',
                'É o último convênio da lista: removê-lo faz a agenda aceitar TODOS os convênios. Confirme para seguir.',
              );
            await tx.alterar(tabela, num(minha['id']), num(minha['versao']), {
              excluido_em: this.agora(),
              excluido_por: ctx.usuario,
            });
          }
          return cob
            ? { agenda: e.agenda, convenio: Number(cod) }
            : { agenda: e.agenda, especialidade: Number(cod) };
        },
        alvo: (e) => ({ tabela: 'agenda_servico', id: e.agenda }),
      });
    return {
      'agenda.gerarGrade': operacao({
        nome: 'agenda.gerarGrade',
        tabelas: ['geracao_grade', 'geracao_grade_periodo', 'horario_agenda'],
        entrada: esquemaGerarGrade,
        gravar: async (tx, e, ctx) => {
          const a = await this.travarAgenda(tx, ctx, e.agenda);
          if (!bool(a['ativo']))
            throw recusa('agenda-inativa', 'A agenda está inativa: não aceita marcação nem geração.');
          const fuso = this.fuso(ctx.estabelecimento);
          const dur = minutos(e.duracao);
          const agora = this.agora();
          const inicios = e.horarios.map((h) => ({ ...h, inicio: instanteDe(fuso, h.data, hora(h.hora)) }));
          const existentes = new Set(
            (
              await tx.consultar(
                `SELECT inicio_em FROM horario_agenda WHERE agenda_servico_id = ? AND excluido_em IS NULL
                 AND situacao <> 'cancelado' AND data_referencia BETWEEN ? AND ?`,
                [e.agenda, e.de, e.ate],
                { teto: TETO_AGREGADO },
              )
            ).map((x) => instante(x['inicio_em']).getTime()),
          );
          if (
            inicios.some((h) => h.inicio.getTime() <= agora.getTime() || existentes.has(h.inicio.getTime()))
          )
            throw recusa(
              'previa-desatualizada',
              'A agenda mudou desde a prévia (um horário apareceu em outro terminal): refaça a prévia.',
            );
          const geracao = await tx.incluir('geracao_grade', {
            estabelecimento_id: ctx.estabelecimento,
            agenda_servico_id: e.agenda,
            periodo_inicio: e.de,
            periodo_fim: e.ate,
            duracao_horario_minutos: dur,
            situacao: 'concluida',
            solicitada_em: agora,
            responsavel_usuario_id: ctx.usuario,
            processada_em: agora,
            horarios_gerados: inicios.length,
          });
          for (const [i, l] of e.escala.entries()) {
            const intervalo = l.intervaloInicio !== null && l.intervaloFim !== null;
            await tx.incluir('geracao_grade_periodo', {
              geracao_grade_id: geracao,
              sequencia: i + 1,
              data_inicio: e.de,
              data_fim: e.ate,
              dia_semana: l.semana,
              hora_inicio: `${hora(l.horaInicio)}:00`,
              hora_fim: `${hora(l.horaFim)}:00`,
              intervalo_inicio: intervalo && l.intervaloInicio ? `${hora(l.intervaloInicio)}:00` : null,
              intervalo_fim: intervalo && l.intervaloFim ? `${hora(l.intervaloFim)}:00` : null,
              situacao: 'concluido',
            });
          }
          for (const h of inicios)
            await tx.incluir('horario_agenda', {
              estabelecimento_id: ctx.estabelecimento,
              agenda_servico_id: e.agenda,
              geracao_grade_id: geracao,
              data_referencia: h.data,
              inicio_em: h.inicio,
              fim_em: new Date(h.inicio.getTime() + dur * 60_000),
              teleatendimento: bool(a['teleatendimento']),
            });
          return { agenda: e.agenda, geracao, horarios: inicios.length };
        },
        alvo: (_e, r) => ({ tabela: 'geracao_grade', id: Number(r.geracao) }),
        eventos: (e, r) => [
          { tipo: 'agenda.grade.gerada', carga: { agenda: e.agenda, geracao: Number(r.geracao) } },
        ],
      }),
      'agenda.reverterGrade': operacao({
        nome: 'agenda.reverterGrade',
        tabelas: ['geracao_grade', 'horario_agenda'],
        entrada: esquemaReverterGrade,
        travar: (e) => ({
          tabela: 'geracao_grade',
          id: e.geracao,
          colunas: ['estabelecimento_id', 'situacao'],
        }),
        conferir: async (_tx, _e, ctx, relido) => {
          if (!relido || num(relido['estabelecimento_id']) !== ctx.estabelecimento)
            throw new ErroOperacao(
              404,
              'registro-inexistente',
              'Geração não encontrada',
              'A geração não existe.',
            );
          if (relido['situacao'] === 'revertida')
            throw recusa('geracao-revertida', 'A geração já foi revertida.');
        },
        gravar: async (tx, e, ctx) => {
          const agora = this.agora();
          const [t] = await tx.consultar(
            'SELECT COUNT(*) AS n, MAX(versao) AS v FROM horario_agenda WHERE geracao_grade_id = ? AND excluido_em IS NULL',
            [e.geracao],
          );
          // Horário vago que nada referencia sai de fato (exclusão auditada uma a uma): a exclusão lógica deixaria a
          // linha presa na unicidade (agenda, início, ordem) e a grade do período não poderia ser gerada de novo.
          const vagos = await tx.consultarParaAtualizar(
            `SELECT id, versao FROM horario_agenda h
             WHERE h.geracao_grade_id = ? AND h.excluido_em IS NULL AND h.situacao = 'livre' AND h.vagas_ocupadas = 0
               AND h.tipo_horario = 'regular'
               AND NOT EXISTS (SELECT 1 FROM marcacao_horario m WHERE m.horario_agenda_id = h.id)
               AND NOT EXISTS (SELECT 1 FROM sessao_terapeutica s WHERE s.horario_agenda_id = h.id)
               AND NOT EXISTS (SELECT 1 FROM turma_encontro t WHERE t.horario_agenda_id = h.id)`,
            [e.geracao],
            { teto: TETO_AGREGADO },
          );
          for (const v of vagos) await tx.excluir('horario_agenda', num(v['id']), num(v['versao']));
          const removidos = vagos.length;
          const g = await tx.uma('SELECT versao FROM geracao_grade WHERE id = ?', [e.geracao]);
          await tx.alterar('geracao_grade', e.geracao, num(g?.['versao']), {
            situacao: 'revertida',
            revertida_em: agora,
            reversao_usuario_id: ctx.usuario,
          });
          return { geracao: e.geracao, removidos, mantidos: num(t?.['n'] ?? 0) - removidos };
        },
        alvo: (e) => ({ tabela: 'geracao_grade', id: e.geracao }),
      }),
      'agenda.agendarConsulta': agendar('agenda.agendarConsulta'),
      'agenda.agendarSemProntuario': agendarSemProntuario,
      'agenda.encaixar': agendar('agenda.encaixar'),
      'agenda.cancelarConsulta': cancelar('agenda.cancelarConsulta'),
      'agenda.desfazerEncaixe': cancelar('agenda.desfazerEncaixe'),
      'agenda.remarcarConsulta': operacao({
        nome: 'agenda.remarcarConsulta',
        tabelas: ['horario_agenda', 'marcacao_horario', 'cancelamento_marcacao', 'sequencia_negocio'],
        entrada: esquemaRemarcarConsulta,
        gravar: async (tx, e, ctx) => {
          const m = await this.travarMarcacao(tx, ctx, e.marcacao);
          const convenio = e.convenio ?? codigoNum(m['convenio']);
          if (convenio === null)
            throw recusa('convenio-inexistente', 'O convênio da marcação não tem código de negócio.');
          const nova = await this.marcarNoHorario(tx, ctx, {
            agenda: e.destino.agenda,
            data: e.destino.data,
            hora: hora(e.destino.hora),
            paciente: numOuNull(m['paciente_id']),
            preCadastro: numOuNull(m['pre_cadastro_id']),
            convenio,
            retorno: bool(m['retorno']),
            canal: e.canal,
            observacao: e.observacao ?? txt(m['observacao']),
            encaixe: null,
            remarcadaDe: num(m['id']),
          });
          const protocolo = await this.cancelarMarcacao(tx, ctx, m, {
            motivo: e.motivo,
            complemento: e.complemento ?? null,
            solicitante: MOTIVOS_CANCELAMENTO.find((x) => x.codigo === e.motivo)?.solicitante ?? 'paciente',
            liberar: e.modo === 'liberar',
            nova,
          });
          return { marcacao: nova, anterior: e.marcacao, protocolo };
        },
        alvo: (_e, r) => ({ tabela: 'marcacao_horario', id: Number(r.marcacao) }),
      }),
      'agenda.confirmarConsulta': situacao('agenda.confirmarConsulta'),
      'agenda.registrarFalta': situacao('agenda.registrarFalta'),
      'agenda.bloquearHorarios': operacao({
        nome: 'agenda.bloquearHorarios',
        tabelas: ['horario_agenda', 'bloqueio_agenda'],
        entrada: esquemaBloquearHorarios,
        gravar: async (tx, e, ctx) => {
          await this.travarAgenda(tx, ctx, e.agenda);
          const fuso = this.fuso(ctx.estabelecimento);
          const bloquear = e.acao === 'bloquear';
          const alvos: Linha[] = [];
          for (const x of e.horarios) {
            const [h] = await tx.consultarParaAtualizar(
              `SELECT id, versao, situacao, vagas_ocupadas, bloqueio_agenda_id, inicio_em, fim_em FROM horario_agenda
               WHERE agenda_servico_id = ? AND inicio_em = ? AND encaixe_ordem = 0 AND excluido_em IS NULL`,
              [e.agenda, instanteDe(fuso, x.data, hora(x.hora))],
              { teto: 1 },
            );
            if (!h) throw recusa('horario-inexistente', 'Um dos horários não existe mais na grade.');
            if (num(h['vagas_ocupadas']) > 0)
              throw recusa(
                'horario-ocupado',
                'Um dos horários tem paciente marcado: remarque antes de bloquear.',
              );
            if (h['situacao'] !== (bloquear ? 'livre' : 'bloqueado'))
              throw recusa(
                'situacao-mudou',
                `Um dos horários já está ${bloquear ? 'bloqueado' : 'desbloqueado'}.`,
              );
            alvos.push(h);
          }
          const agora = this.agora();
          if (bloquear) {
            const motivo = await tx.uma('SELECT id FROM motivo_bloqueio_agenda WHERE codigo = ? AND ativo', [
              e.motivo,
            ]);
            if (!motivo) throw configuracaoIncompleta(`motivo de bloqueio "${e.motivo}"`);
            const bloqueio = await tx.incluir('bloqueio_agenda', {
              estabelecimento_id: ctx.estabelecimento,
              agenda_servico_id: e.agenda,
              motivo_bloqueio_agenda_id: motivo['id'],
              inicio_em: new Date(Math.min(...alvos.map((h) => instante(h['inicio_em']).getTime()))),
              fim_em: new Date(Math.max(...alvos.map((h) => instante(h['fim_em']).getTime()))),
              previsao_retorno: e.previsaoRetorno ?? null,
              situacao: 'ativo',
              observacao: e.complemento ?? null,
              responsavel_usuario_id: ctx.usuario,
            });
            for (const h of alvos)
              await tx.alterar('horario_agenda', num(h['id']), num(h['versao']), {
                situacao: 'bloqueado',
                bloqueio_agenda_id: bloqueio,
              });
          } else {
            const bloqueios = new Set(
              alvos.map((h) => numOuNull(h['bloqueio_agenda_id'])).filter((x) => x !== null),
            );
            for (const h of alvos)
              await tx.alterar('horario_agenda', num(h['id']), num(h['versao']), {
                situacao: 'livre',
                bloqueio_agenda_id: null,
              });
            for (const b of bloqueios) {
              const [resta] = await tx.consultar(
                'SELECT COUNT(*) AS n FROM horario_agenda WHERE bloqueio_agenda_id = ? AND excluido_em IS NULL',
                [b],
              );
              if (num(resta?.['n'] ?? 0) > 0) continue;
              const [linha] = await tx.consultarParaAtualizar(
                "SELECT id, versao FROM bloqueio_agenda WHERE id = ? AND situacao = 'ativo'",
                [b],
                { teto: 1 },
              );
              if (linha)
                await tx.alterar('bloqueio_agenda', b, num(linha['versao']), {
                  situacao: 'desbloqueado',
                  desbloqueado_em: agora,
                  desbloqueio_usuario_id: ctx.usuario,
                });
            }
          }
          return { agenda: e.agenda, horarios: alvos.length };
        },
        alvo: (e) => ({ tabela: 'agenda_servico', id: e.agenda }),
      }),
      'agenda.definirCobertura': vinculo('agenda.definirCobertura'),
      'agenda.definirEspecialidade': vinculo('agenda.definirEspecialidade'),
      'agenda.incluirAgenda': operacao({
        nome: 'agenda.incluirAgenda',
        tabelas: ['agenda_servico'],
        entrada: esquemaIncluirAgenda,
        gravar: async () => {
          // O modelo exige o dono da agenda (profissional, recurso ou setor) e a categoria: o pedido da tela ainda
          // não os traz (pedido de contrato registrado). Recusa explícita, nunca agenda sem dono.
          throw recusa(
            'agenda-sem-dono',
            'Inclua a agenda informando o profissional, o recurso ou o setor que atende e a categoria (a tela atual ainda não envia esses campos).',
          );
        },
        alvo: () => ({ tabela: 'agenda_servico', id: null }),
      }),
      'agenda.alterarAgenda': operacao({
        nome: 'agenda.alterarAgenda',
        tabelas: ['agenda_servico'],
        entrada: esquemaAlterarAgenda,
        gravar: async (tx, e, ctx) => {
          const a = await this.travarAgenda(tx, ctx, e.agenda);
          const atual = {
            duracaoMinutos: numOuNull(a['duracao_horario_minutos']) || null,
            ativa: bool(a['ativo']),
            teleatendimento: bool(a['teleatendimento']),
          };
          const mudou = (['duracaoMinutos', 'ativa', 'teleatendimento'] as const).filter(
            (k) => atual[k] !== e.lidos[k],
          );
          if (mudou.length > 0) throw erroConflitoVersao([...mudou]);
          const novo = {
            duracaoMinutos: e.valores.duracaoMinutos ?? atual.duracaoMinutos,
            ativa: e.valores.ativa ?? atual.ativa,
            teleatendimento: e.valores.teleatendimento ?? atual.teleatendimento,
          };
          if (
            novo.duracaoMinutos === atual.duracaoMinutos &&
            novo.ativa === atual.ativa &&
            novo.teleatendimento === atual.teleatendimento
          )
            throw recusa('sem-efeito', 'Nenhum campo muda de valor.');
          await tx.alterar('agenda_servico', e.agenda, num(a['versao']), {
            duracao_horario_minutos: novo.duracaoMinutos,
            ativo: novo.ativa,
            teleatendimento: novo.teleatendimento,
          });
          return { agenda: e.agenda, campos: Object.keys(e.valores).length };
        },
        alvo: (e) => ({ tabela: 'agenda_servico', id: e.agenda }),
      }),
    };
  }

  private definirApoio() {
    const id = z.number().int().positive();
    const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
    const faixa = z
      .object({
        diaSemana: z.number().int().min(1).max(7),
        duracaoMinutos: z.number().int().min(5).max(480).nullable(),
        inicio: esquemaHora,
        fim: esquemaHora,
        intervaloInicio: esquemaHora.nullable(),
        intervaloFim: esquemaHora.nullable(),
      })
      .strict();
    return {
      planejarEscala: operacao({
        nome: 'agenda.planejarEscala',
        tabelas: ['agenda_escala'],
        entrada: z.object({ agenda: id, vigenteDesde: data, faixas: z.array(faixa).min(1).max(21) }).strict(),
        gravar: async (tx, e, ctx) => {
          await this.travarAgenda(tx, ctx, e.agenda);
          const linhas = await tx.consultarParaAtualizar(
            'SELECT id, versao, vigencia_inicio, vigencia_fim FROM agenda_escala WHERE agenda_servico_id = ? AND ativo',
            [e.agenda],
          );
          if (linhas.some((x) => dataIso(x['vigencia_inicio']) === e.vigenteDesde))
            throw recusa('escala-ja-planejada', 'Já há escala planejada para esta data: cancele-a antes.');
          const posteriores = linhas
            .map((x) => dataIso(x['vigencia_inicio']) ?? '')
            .filter((d) => d > e.vigenteDesde)
            .sort();
          const vigenciaFim = posteriores[0] ? somarDias(posteriores[0], -1) : null;
          const vespera = somarDias(e.vigenteDesde, -1);
          for (const x of linhas) {
            const ini = dataIso(x['vigencia_inicio']) ?? '';
            const fim = dataIso(x['vigencia_fim']);
            if (ini < e.vigenteDesde && (fim === null || fim >= e.vigenteDesde))
              await tx.alterar('agenda_escala', num(x['id']), num(x['versao']), { vigencia_fim: vespera });
          }
          let primeira = 0;
          for (const f of e.faixas) {
            const n = await tx.incluir('agenda_escala', {
              agenda_servico_id: e.agenda,
              dia_semana: f.diaSemana,
              hora_inicio: `${f.inicio}:00`,
              hora_fim: `${f.fim}:00`,
              intervalo_inicio: f.intervaloInicio ? `${f.intervaloInicio}:00` : null,
              intervalo_fim: f.intervaloFim ? `${f.intervaloFim}:00` : null,
              duracao_horario_minutos: f.duracaoMinutos,
              vigencia_inicio: e.vigenteDesde,
              vigencia_fim: vigenciaFim,
            });
            primeira ||= n;
          }
          return { id: primeira };
        },
        alvo: (_e, r) => ({ tabela: 'agenda_escala', id: Number(r.id) }),
      }),
      cancelarEscalaPlanejada: operacao({
        nome: 'agenda.cancelarEscalaPlanejada',
        tabelas: ['agenda_escala'],
        entrada: z.object({ agenda: id, id }).strict(),
        gravar: async (tx, e, ctx) => {
          await this.travarAgenda(tx, ctx, e.agenda);
          const fuso = this.fuso(ctx.estabelecimento);
          const hoje = localDe(fuso, this.agora()).data;
          const linhas = await tx.consultarParaAtualizar(
            'SELECT id, versao, vigencia_inicio, vigencia_fim FROM agenda_escala WHERE agenda_servico_id = ? AND ativo',
            [e.agenda],
          );
          const alvo = linhas.find((x) => num(x['id']) === e.id);
          const desde = alvo ? (dataIso(alvo['vigencia_inicio']) ?? '') : '';
          if (!alvo || desde <= hoje)
            throw recusa('escala-inexistente', 'A escala planejada não existe ou já foi cancelada.');
          const fimDoGrupo = dataIso(alvo['vigencia_fim']);
          for (const x of linhas.filter((y) => dataIso(y['vigencia_inicio']) === desde))
            await tx.alterar('agenda_escala', num(x['id']), num(x['versao']), { ativo: false });
          // A escala anterior volta a valer até onde o grupo cancelado valia.
          const vespera = somarDias(desde, -1);
          for (const x of linhas.filter((y) => dataIso(y['vigencia_fim']) === vespera))
            await tx.alterar('agenda_escala', num(x['id']), num(x['versao']), { vigencia_fim: fimDoGrupo });
          return { id: e.id };
        },
        alvo: (e) => ({ tabela: 'agenda_escala', id: e.id }),
      }),
      gravarConfirmacao: operacao({
        nome: 'agenda.gravarConfirmacao',
        tabelas: ['confirmacao_marcacao'],
        entrada: z
          .object({
            marcacao: id,
            resultado: z.enum(RESULTADOS_CONFIRMACAO.map((r) => r.codigo) as [string, ...string[]]),
            canal: z.string().min(1).max(30),
            observacao: z.string().max(200).nullable(),
          })
          .strict(),
        gravar: async (tx, e, ctx) => {
          const m = await this.travarMarcacao(tx, ctx, e.marcacao);
          const canal = await tx.uma('SELECT id FROM canal_marcacao WHERE codigo = ? AND ativo', [e.canal]);
          if (!canal) throw configuracaoIncompleta(`canal de marcação "${e.canal}"`);
          const [t] = await tx.consultar(
            'SELECT COALESCE(MAX(tentativa), 0) + 1 AS n FROM confirmacao_marcacao WHERE marcacao_horario_id = ?',
            [m['id']],
          );
          const agora = this.agora();
          const n = await tx.incluir('confirmacao_marcacao', {
            estabelecimento_id: ctx.estabelecimento,
            marcacao_horario_id: m['id'],
            tentativa: num(t?.['n'] ?? 1),
            canal_marcacao_id: canal['id'],
            situacao_confirmacao_id: await this.situacaoConfirmacao(tx, e.resultado),
            automatica: false,
            solicitada_em: agora,
            respondida_em: e.resultado === 'nao-confirmado' ? null : agora,
            responsavel_usuario_id: ctx.usuario,
            observacao: e.observacao,
          });
          return { id: n };
        },
        alvo: (e) => ({ tabela: 'marcacao_horario', id: e.marcacao }),
      }),
      gravarBloqueioPeriodo: operacao({
        nome: 'agenda.gravarBloqueioPeriodo',
        tabelas: ['bloqueio_agenda'],
        entrada: z
          .object({
            agenda: id,
            inicio: data,
            fim: data,
            horaInicio: esquemaHora.nullable(),
            horaFim: esquemaHora.nullable(),
            motivo: z.string().min(1).max(30),
            complemento: z.string().max(500).nullable(),
            previsaoRetorno: data.nullable(),
          })
          .strict()
          .refine((x) => x.fim >= x.inicio, { path: ['fim'], message: 'O fim vem antes do início.' }),
        gravar: async (tx, e, ctx) => {
          await this.travarAgenda(tx, ctx, e.agenda);
          const fuso = this.fuso(ctx.estabelecimento);
          const motivo = await tx.uma('SELECT id FROM motivo_bloqueio_agenda WHERE codigo = ? AND ativo', [
            e.motivo,
          ]);
          if (!motivo) throw configuracaoIncompleta(`motivo de bloqueio "${e.motivo}"`);
          const n = await tx.incluir('bloqueio_agenda', {
            estabelecimento_id: ctx.estabelecimento,
            agenda_servico_id: e.agenda,
            motivo_bloqueio_agenda_id: motivo['id'],
            inicio_em: instanteDe(fuso, e.inicio, e.horaInicio ?? '00:00'),
            fim_em: e.horaFim
              ? instanteDe(fuso, e.fim, e.horaFim)
              : instanteDe(fuso, somarDias(e.fim, 1), '00:00'),
            previsao_retorno: e.previsaoRetorno,
            situacao: 'ativo',
            observacao: e.complemento,
            responsavel_usuario_id: ctx.usuario,
          });
          return { id: n };
        },
        alvo: (_e, r) => ({ tabela: 'bloqueio_agenda', id: Number(r.id) }),
      }),
      encerrarBloqueio: operacao({
        nome: 'agenda.encerrarBloqueio',
        tabelas: ['bloqueio_agenda'],
        entrada: z.object({ agenda: id, id }).strict(),
        gravar: async (tx, e, ctx) => {
          const [b] = await tx.consultarParaAtualizar(
            `SELECT id, versao FROM bloqueio_agenda WHERE id = ? AND agenda_servico_id = ? AND estabelecimento_id = ?
               AND situacao = 'ativo' AND excluido_em IS NULL`,
            [e.id, e.agenda, ctx.estabelecimento],
            { teto: 1 },
          );
          if (!b) throw recusa('bloqueio-inexistente', 'O bloqueio não existe ou já foi encerrado.');
          await tx.alterar('bloqueio_agenda', e.id, num(b['versao']), {
            situacao: 'desbloqueado',
            desbloqueado_em: this.agora(),
            desbloqueio_usuario_id: ctx.usuario,
          });
          return { id: e.id };
        },
        alvo: (e) => ({ tabela: 'bloqueio_agenda', id: e.id }),
      }),
      incluirEspera: operacao({
        nome: 'agenda.incluirEspera',
        tabelas: ['lista_espera', 'lista_espera_historico'],
        entrada: z
          .object({
            paciente: id,
            agenda: id.nullable(),
            especialidade: z.number().int().min(0).nullable(),
            // Urgência clínica (critério próprio); a prioridade legal vem do grupo (02-AGE 48, fila-espera.ts).
            prioridade: z.enum(['normal', 'urgente']),
            prioridadeLegal: id.nullable().default(null),
            observacao: z.string().max(600).nullable(),
          })
          .strict(),
        gravar: async (tx, e, ctx) => {
          if (e.agenda) await this.travarAgenda(tx, ctx, e.agenda);
          const esp =
            e.especialidade === null
              ? null
              : await tx.uma('SELECT id FROM especialidade_medica WHERE codigo = ? AND ativo', [
                  String(e.especialidade),
                ]);
          if (e.especialidade !== null && !esp)
            throw recusa('especialidade-inexistente', 'A especialidade não existe.');
          const agora = this.agora();
          const grupo = await grupoLegalDaEspera(tx, {
            paciente: e.paciente,
            informada: e.prioridadeLegal,
            data: dataNoFuso(this.fuso(ctx.estabelecimento), agora),
          });
          const prioridade = prioridadeGravadaNaEspera(e.prioridade, grupo);
          const n = await tx.incluir('lista_espera', {
            estabelecimento_id: ctx.estabelecimento,
            paciente_id: e.paciente,
            agenda_servico_id: e.agenda,
            especialidade_medica_id: esp ? esp['id'] : null,
            prioridade,
            grupo_prioridade_legal_id: grupo,
            situacao: 'aguardando',
            entrada_em: agora,
            observacao: e.observacao,
            responsavel_usuario_id: ctx.usuario,
          });
          await this.historicoEspera(tx, ctx, n, 'inclusao', 'entrada', {
            prioridade,
            grupoPrioridadeLegal: grupo,
          });
          return { id: n };
        },
        alvo: (_e, r) => ({ tabela: 'lista_espera', id: Number(r.id) }),
      }),
      ofertarEspera: operacao({
        nome: 'agenda.ofertarEspera',
        tabelas: ['lista_espera', 'lista_espera_historico'],
        entrada: z.object({ id, agenda: id, data, hora: esquemaHora }).strict(),
        gravar: async (tx, e, ctx) => {
          const x = await this.travarEspera(tx, ctx, e.id);
          await tx.alterar('lista_espera', e.id, num(x['versao']), { situacao: 'ofertado' });
          await this.historicoEspera(tx, ctx, e.id, 'alteracao', 'oferta', {
            agenda: e.agenda,
            data: e.data,
            hora: e.hora,
          });
          return { id: e.id };
        },
        alvo: (e) => ({ tabela: 'lista_espera', id: e.id }),
      }),
      encerrarEspera: operacao({
        nome: 'agenda.encerrarEspera',
        tabelas: ['lista_espera', 'lista_espera_historico'],
        entrada: z
          .object({ id, situacao: z.enum(['atendido', 'cancelado', 'aguardando']), marcacao: id.nullable() })
          .strict(),
        gravar: async (tx, e, ctx) => {
          const x = await this.travarEspera(tx, ctx, e.id);
          const fim = e.situacao !== 'aguardando';
          await tx.alterar('lista_espera', e.id, num(x['versao']), {
            situacao: e.situacao,
            marcacao_horario_id: e.marcacao,
            encerrada_em: fim ? this.agora() : null,
          });
          const evento =
            e.situacao === 'atendido' ? 'marcacao' : e.situacao === 'cancelado' ? 'cancelamento' : 'recusa';
          await this.historicoEspera(tx, ctx, e.id, 'alteracao', evento, { marcacao: e.marcacao });
          return { id: e.id };
        },
        alvo: (e) => ({ tabela: 'lista_espera', id: e.id }),
      }),
      gravarVinculo: operacao({
        nome: 'agenda.gravarVinculo',
        tabelas: ['agenda_servico', 'agenda_especialidade'],
        entrada: z
          .object({
            agenda: id,
            profissional: id.nullable(),
            especialidade: z.number().int().min(0).nullable(),
            local: id.nullable(),
            unidade: id.nullable(),
          })
          .strict(),
        gravar: async (tx, e, ctx) => {
          const a = await this.travarAgenda(tx, ctx, e.agenda);
          // O local e a unidade são do estabelecimento da sessão (a FK só confere que o id existe).
          if (
            e.local !== null &&
            !(await tx.uma(
              'SELECT id FROM local_atendimento WHERE id = ? AND estabelecimento_id = ? AND ativo AND excluido_em IS NULL',
              [e.local, ctx.estabelecimento],
            ))
          )
            throw recusa(
              'local-de-outro-estabelecimento',
              'O local de atendimento não é deste estabelecimento.',
              {
                campos: ['local'],
              },
            );
          if (
            e.unidade !== null &&
            !(await tx.uma(
              'SELECT id FROM unidade_assistencial WHERE id = ? AND estabelecimento_id = ? AND ativo AND excluido_em IS NULL',
              [e.unidade, ctx.estabelecimento],
            ))
          )
            throw recusa(
              'local-de-outro-estabelecimento',
              'A unidade assistencial não é deste estabelecimento.',
              {
                campos: ['unidade'],
              },
            );
          await tx.alterar('agenda_servico', e.agenda, num(a['versao']), {
            profissional_id: e.profissional,
            local_atendimento_id: e.local,
            unidade_assistencial_id: e.unidade,
          });
          if (e.especialidade !== null) {
            const esp = await tx.uma('SELECT id FROM especialidade_medica WHERE codigo = ? AND ativo', [
              String(e.especialidade),
            ]);
            if (!esp) throw recusa('especialidade-inexistente', 'A especialidade não existe.');
            const linhas = await tx.consultarParaAtualizar(
              'SELECT id, versao, especialidade_medica_id, principal, excluido_em FROM agenda_especialidade WHERE agenda_servico_id = ?',
              [e.agenda],
            );
            let achou = false;
            for (const x of linhas) {
              const esta = num(x['especialidade_medica_id']) === num(esp['id']);
              achou ||= esta;
              if (esta && (!bool(x['principal']) || x['excluido_em'] !== null))
                await tx.alterar('agenda_especialidade', num(x['id']), num(x['versao']), {
                  principal: true,
                  excluido_em: null,
                  excluido_por: null,
                });
              else if (!esta && bool(x['principal']))
                await tx.alterar('agenda_especialidade', num(x['id']), num(x['versao']), {
                  principal: false,
                });
            }
            if (!achou)
              await tx.incluir('agenda_especialidade', {
                agenda_servico_id: e.agenda,
                especialidade_medica_id: esp['id'],
                principal: true,
              });
          }
          return { agenda: e.agenda };
        },
        alvo: (e) => ({ tabela: 'agenda_servico', id: e.agenda }),
      }),
    };
  }

  // ── Apoio das operações ───────────────────────────────────────────────────────────────────────────

  private async travarAgenda(tx: TxOperacao, ctx: ContextoOperacao, id: number): Promise<Linha> {
    const [a] = await tx.consultarParaAtualizar(
      `SELECT id, versao, ativo, duracao_horario_minutos, teleatendimento, permite_encaixe, encaixes_por_dia,
         profissional_id
       FROM agenda_servico WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
      [id, ctx.estabelecimento],
      { teto: 1 },
    );
    if (!a)
      throw new ErroOperacao(
        404,
        'registro-inexistente',
        'Agenda não encontrada',
        'A agenda não existe mais.',
      );
    return a;
  }

  private async travarMarcacao(tx: TxOperacao, ctx: ContextoOperacao, id: number): Promise<Linha> {
    const [m] = await tx.consultarParaAtualizar(
      `SELECT m.id, m.versao, m.horario_agenda_id, m.paciente_id, m.pre_cadastro_id, m.encaixe, m.retorno, m.observacao, m.chegada_em,
         m.atendido_em, m.canal_marcacao_id, s.significado, fp.codigo AS convenio, h.inicio_em
       FROM marcacao_horario m JOIN situacao_marcacao s ON s.id = m.situacao_marcacao_id
       JOIN fonte_pagadora fp ON fp.id = m.fonte_pagadora_id JOIN horario_agenda h ON h.id = m.horario_agenda_id
       WHERE m.id = ? AND m.estabelecimento_id = ? AND m.excluido_em IS NULL`,
      [id, ctx.estabelecimento],
      { teto: 1 },
    );
    if (!m)
      throw new ErroOperacao(
        404,
        'registro-inexistente',
        'Marcação não encontrada',
        'A marcação não existe mais.',
      );
    const sig = String(m['significado']);
    if (sig === 'cancelada') throw recusa('ja-cancelada', 'A marcação já foi cancelada ou remarcada.');
    if (m['atendido_em'] !== null || sig === 'realizada')
      throw recusa('ja-atendido', 'O paciente já foi atendido: a marcação não pode mais ser desfeita.');
    if (m['chegada_em'] !== null || sig === 'chegou' || sig === 'em_atendimento')
      throw recusa(
        'paciente-com-senha',
        'O paciente já fez o check-in: cancelar agora exige o perfil de supervisor da recepção.',
      );
    return m;
  }

  private async travarEspera(tx: TxOperacao, ctx: ContextoOperacao, id: number): Promise<Linha> {
    const [x] = await tx.consultarParaAtualizar(
      `SELECT id, versao, situacao FROM lista_espera WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL
         AND situacao IN ('aguardando', 'ofertado')`,
      [id, ctx.estabelecimento],
      { teto: 1 },
    );
    if (!x) throw recusa('espera-encerrada', 'O pedido da lista de espera já foi encerrado.');
    return x;
  }

  private async historicoEspera(
    tx: TxOperacao,
    ctx: ContextoOperacao,
    id: number,
    operacao: 'inclusao' | 'alteracao',
    evento: string,
    dados: Record<string, unknown>,
  ): Promise<void> {
    await tx.incluir('lista_espera_historico', {
      lista_espera_id: id,
      operacao,
      evento,
      dados: JSON.stringify(dados),
      ocorrido_em: this.agora(),
      usuario_id: ctx.usuario,
    });
  }

  private async situacaoMarcacao(tx: TxOperacao, significado: string): Promise<number> {
    const x = await tx.uma(
      'SELECT id FROM situacao_marcacao WHERE significado = ? AND ativo ORDER BY ordem, id LIMIT 1',
      [significado],
    );
    if (!x) throw configuracaoIncompleta(`situação de marcação com o significado "${significado}"`);
    return num(x['id']);
  }

  private async situacaoConfirmacao(tx: TxOperacao, resultado: string): Promise<number> {
    const significado =
      resultado === 'confirmado'
        ? 'confirmada'
        : resultado === 'nao-confirmado'
          ? 'sem_resposta'
          : 'recusada';
    const x =
      (await tx.uma('SELECT id FROM situacao_confirmacao WHERE codigo = ? AND ativo', [resultado])) ??
      (await tx.uma(
        'SELECT id FROM situacao_confirmacao WHERE significado = ? AND ativo ORDER BY ordem, id LIMIT 1',
        [significado],
      ));
    if (!x) throw configuracaoIncompleta(`situação de confirmação "${resultado}"`);
    return num(x['id']);
  }

  /** Marca o paciente no horário (vaga da grade) ou cria o encaixe; devolve o id da marcação. */
  private async marcarNoHorario(
    tx: TxOperacao,
    ctx: ContextoOperacao,
    p: {
      agenda: number;
      data: string;
      hora: string;
      /** null = marcação sem prontuário (02-AGE 42): vai `preCadastro`. */
      paciente: number | null;
      /** 02-AGE 42: o pré-cadastro já ligado (remarcação) ou os dados mínimos da pessoa (marcação nova). */
      preCadastro?: number | PessoaSemProntuario | null;
      convenio: number;
      retorno: boolean;
      canal: string;
      observacao: string | null;
      /** 02-AGE 49: grupo de prioridade legal informado na marcação (a regra do domínio pode subir pela idade ou pelo cadastro). */
      prioridadeLegal?: number | null;
      /** Motivo do encaixe; null = vaga da grade. */
      encaixe: string | null;
      remarcadaDe: number | null;
      /** ADR 0009, decisão 25: recebe o alerta de credenciamento (sem bloqueio) para o resultado. */
      alertas?: string[];
    },
  ): Promise<number> {
    const a = await this.travarAgenda(tx, ctx, p.agenda);
    if (!bool(a['ativo']))
      throw recusa('agenda-inativa', 'A agenda está inativa: não aceita marcação nem geração.');
    await exigirMarcacaoNominal(tx, p.agenda, ctx.usuario);
    const fuso = this.fuso(ctx.estabelecimento);
    const inicio = instanteDe(fuso, p.data, p.hora);
    if (inicio.getTime() <= this.agora().getTime())
      throw recusa('horario-passado', 'O horário já passou pelo relógio do servidor: escolha outro.');
    const pre = p.paciente === null ? (p.preCadastro ?? null) : null;
    if (p.paciente === null && pre === null)
      throw recusa(
        'sem-paciente',
        'Escolha o paciente ou informe os dados mínimos da marcação sem prontuário.',
      );
    const pac =
      p.paciente === null
        ? null
        : await tx.uma(
            `SELECT p.id, p.numero_prontuario, p.situacao, pf.data_nascimento
               FROM paciente p LEFT JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
              WHERE p.id = ? AND p.excluido_em IS NULL`,
            [p.paciente],
          );
    if (p.paciente !== null) {
      if (!pac)
        throw new ErroOperacao(
          404,
          'registro-inexistente',
          'Paciente não encontrado',
          'O cadastro não existe.',
        );
      if (pac['situacao'] !== 'ativo' && pac['situacao'] !== 'provisorio')
        throw recusa('paciente-inativo', 'O cadastro do paciente está inativo ou foi unificado em outro.');
      if (pac['numero_prontuario'] === null)
        throw recusa('sem-prontuario', 'O paciente não tem prontuário: complete o cadastro antes de marcar.');
    }
    const fp = await tx.uma(
      'SELECT id, situacao FROM fonte_pagadora WHERE codigo = ? AND excluido_em IS NULL',
      [String(p.convenio)],
    );
    if (!fp) throw recusa('convenio-inexistente', 'O convênio não existe.', { campos: ['convenio'] });
    if (fp['situacao'] !== 'ativa')
      throw recusa('convenio-inativo', 'O convênio está suspenso: não aceita marcação.', {
        campos: ['convenio'],
      });
    const aceitos = await tx.consultar(
      'SELECT fonte_pagadora_id FROM agenda_fonte_pagadora WHERE agenda_servico_id = ? AND excluido_em IS NULL',
      [p.agenda],
    );
    if (aceitos.length > 0 && !aceitos.some((x) => num(x['fonte_pagadora_id']) === num(fp['id'])))
      throw recusa(
        'convenio-nao-aceito',
        'A agenda não atende este convênio: escolha outra agenda do mesmo procedimento ou outro convênio.',
        { campos: ['convenio'] },
      );
    // ADR 0009, decisão 25: o médico da agenda sem credenciamento no convênio alerta ou, se o convênio pede, bloqueia.
    const credenciamento = await conferirCredenciamentoNoFluxo(tx, {
      profissionalId: a['profissional_id'] == null ? null : num(a['profissional_id']),
      fontePagadoraId: num(fp['id']),
      // A marcação não traz o plano: o credenciamento só num plano do convênio alerta e nunca bloqueia (decisão 25).
      // A conferência pelo plano exato acontece na abertura do atendimento.
      planoId: null,
      planoDesconhecido: true,
      estabelecimentoId: Number(ctx.estabelecimento),
      data: p.data,
      campo: 'convenio',
    });
    if (credenciamento)
      p.alertas?.push(credenciamento.motivo ?? 'O profissional não é credenciado no convênio.');
    const canal = await tx.uma('SELECT id FROM canal_marcacao WHERE codigo = ? AND ativo', [p.canal]);
    if (!canal) throw configuracaoIncompleta(`canal de marcação "${p.canal}"`);
    // 02-AGE 42: o pré-cadastro (reaproveitado ou novo) na mesma transação da marcação.
    let preCadastroId: number | null = null;
    let nascimentoPre: string | null = null;
    if (typeof pre === 'number') {
      const k = await tx.uma(
        'SELECT id, data_nascimento FROM pre_cadastro WHERE id = ? AND excluido_em IS NULL',
        [pre],
      );
      if (!k) throw recusa('pre-cadastro-inexistente', 'O pré-cadastro da marcação não existe.');
      preCadastroId = num(k['id']);
      nascimentoPre = dataIso(k['data_nascimento']);
    } else if (pre !== null) {
      const r = await preCadastroDaMarcacao(tx, {
        estabelecimento: Number(ctx.estabelecimento),
        pessoa: pre,
        hoje: dataNoFuso(fuso, this.agora()),
        fontePagadora: num(fp['id']),
      });
      preCadastroId = r.id;
      nascimentoPre = pre.nascimento;
    }
    const natureza = p.encaixe !== null ? 'encaixe' : p.retorno ? 'retorno' : 'primeira_vez';
    const tipo =
      (await tx.uma('SELECT id FROM tipo_marcacao WHERE natureza = ? AND ativo ORDER BY id LIMIT 1', [
        natureza,
      ])) ??
      (await tx.uma(
        "SELECT id FROM tipo_marcacao WHERE natureza = 'primeira_vez' AND ativo ORDER BY id LIMIT 1",
      ));
    if (!tipo) throw configuracaoIncompleta(`tipo de marcação "${natureza}"`);
    const esp = await tx.uma(
      'SELECT especialidade_medica_id FROM agenda_especialidade WHERE agenda_servico_id = ? AND excluido_em IS NULL ORDER BY principal DESC, id LIMIT 1',
      [p.agenda],
    );
    const dur = num(a['duracao_horario_minutos']);
    let horario: number;
    if (p.encaixe !== null) {
      if (!bool(a['permite_encaixe'])) throw recusa('encaixe-nao-permitido', 'A agenda não aceita encaixe.');
      const bloqueado = await tx.uma(
        `SELECT id FROM horario_agenda WHERE agenda_servico_id = ? AND inicio_em = ? AND encaixe_ordem = 0
           AND excluido_em IS NULL AND situacao = 'bloqueado' LIMIT 1`,
        [p.agenda, inicio],
      );
      const periodos = await tx.consultar(
        `SELECT inicio_em, fim_em FROM bloqueio_agenda
         WHERE estabelecimento_id = ? AND excluido_em IS NULL AND situacao = 'ativo'
           AND (agenda_servico_id = ? OR (profissional_id IS NOT NULL AND profissional_id = ?))
           AND inicio_em <= ? AND fim_em > ?`,
        [ctx.estabelecimento, p.agenda, a['profissional_id'] ?? null, inicio, inicio],
        { teto: TETO_AGREGADO },
      );
      const veto = vetoDeBloqueioNoEncaixe(inicio.getTime(), {
        horarioBloqueado: bloqueado !== null,
        bloqueios: periodos.map((b) => ({
          inicio: instante(b['inicio_em']).getTime(),
          fim: instante(b['fim_em']).getTime(),
        })),
      });
      if (veto) throw recusa(veto, TEXTO_HORARIO_BLOQUEADO);
      if (a['encaixes_por_dia'] !== null) {
        const [n] = await tx.consultar(
          `SELECT COUNT(*) AS n FROM horario_agenda WHERE agenda_servico_id = ? AND data_referencia = ?
             AND tipo_horario = 'encaixe' AND excluido_em IS NULL AND situacao <> 'cancelado'`,
          [p.agenda, p.data],
        );
        if (num(n?.['n'] ?? 0) >= num(a['encaixes_por_dia']))
          throw recusa('teto-encaixes', 'A agenda já tem o máximo de encaixes do dia.');
      }
      const [o] = await tx.consultar(
        'SELECT COALESCE(MAX(encaixe_ordem), 0) + 1 AS n FROM horario_agenda WHERE agenda_servico_id = ? AND inicio_em = ?',
        [p.agenda, inicio],
      );
      horario = await tx.incluir('horario_agenda', {
        estabelecimento_id: ctx.estabelecimento,
        agenda_servico_id: p.agenda,
        data_referencia: p.data,
        inicio_em: inicio,
        fim_em: new Date(inicio.getTime() + dur * 60_000),
        encaixe_ordem: num(o?.['n'] ?? 1),
        tipo_horario: 'encaixe',
        situacao: 'ocupado',
        vagas: 1,
        vagas_ocupadas: 1,
        teleatendimento: bool(a['teleatendimento']),
      });
    } else {
      const [h] = await tx.consultarParaAtualizar(
        `SELECT id, versao, situacao, vagas, vagas_ocupadas FROM horario_agenda
         WHERE agenda_servico_id = ? AND inicio_em = ? AND encaixe_ordem = 0 AND excluido_em IS NULL`,
        [p.agenda, inicio],
        { teto: 1 },
      );
      if (!h) throw recusa('horario-inexistente', 'O horário não existe na grade da agenda.');
      if (h['situacao'] !== 'livre' || num(h['vagas_ocupadas']) >= num(h['vagas']))
        throw recusa(
          'horario-ocupado',
          'O horário foi ocupado ou bloqueado em outro terminal enquanto você marcava. Escolha outro horário.',
        );
      const ocupadas = num(h['vagas_ocupadas']) + 1;
      await tx.alterar('horario_agenda', num(h['id']), num(h['versao']), {
        vagas_ocupadas: ocupadas,
        situacao: ocupadas >= num(h['vagas']) ? 'ocupado' : 'livre',
      });
      horario = num(h['id']);
    }
    await garantirSequencia(
      tx,
      { tipo: 'marcacao_horario', estabelecimento: ctx.estabelecimento, prefixo: 'MC-' },
      { usuario: ctx.usuario, agora: this.agora() },
    );
    // 02-AGE 49: prioridade legal na marcação (informada, do cadastro do paciente ou pela idade), regra no domínio.
    const grupos = await tx.consultar(
      // O grupo não tem exclusão lógica (só `ativo`, que a regra do domínio confere).
      'SELECT id, descricao, ativo, peso, idade_minima FROM grupo_prioridade_legal',
    );
    const doPaciente =
      p.paciente === null
        ? []
        : await tx.consultar(
            `SELECT grupo_prioridade_legal_id, vigencia_inicio, vigencia_fim FROM paciente_prioridade_legal
              WHERE paciente_id = ? AND excluido_em IS NULL`,
            [p.paciente],
          );
    const prio = prioridadeNaMarcacao(
      grupos.map((g) => ({
        id: num(g['id']),
        descricao: String(g['descricao']),
        ativo: bool(g['ativo']),
        peso: num(g['peso']),
        idadeMinima: numOuNull(g['idade_minima']),
      })),
      {
        informada: p.prioridadeLegal ?? null,
        doPaciente: doPaciente.map((x) => ({
          grupo: num(x['grupo_prioridade_legal_id']),
          vigenciaInicio: dataIso(x['vigencia_inicio']) ?? '',
          vigenciaFim: dataIso(x['vigencia_fim']),
        })),
        nascimento: pac ? dataIso(pac['data_nascimento']) : nascimentoPre,
        data: p.data,
      },
    );
    if (!prio.ok) throw recusa(prio.codigo, prio.motivo, { campos: ['prioridadeLegal'] });
    const numero = await tx.proximoNumero('marcacao_horario');
    return tx.incluir('marcacao_horario', {
      estabelecimento_id: ctx.estabelecimento,
      numero: numero.formatado,
      horario_agenda_id: horario,
      grupo_prioridade_legal_id: prio.grupo,
      paciente_id: p.paciente,
      pre_cadastro_id: preCadastroId,
      tipo_marcacao_id: tipo['id'],
      situacao_marcacao_id: await this.situacaoMarcacao(tx, 'aguardando'),
      canal_marcacao_id: canal['id'],
      fonte_pagadora_id: fp['id'],
      especialidade_medica_id: esp ? esp['especialidade_medica_id'] : null,
      executante_profissional_id: a['profissional_id'],
      remarcada_marcacao_horario_id: p.remarcadaDe,
      duracao_minutos: dur,
      retorno: p.retorno,
      encaixe: p.encaixe !== null,
      motivo_encaixe: p.encaixe,
      teleatendimento: bool(a['teleatendimento']),
      observacao: p.observacao,
      marcado_em: this.agora(),
      responsavel_usuario_id: ctx.usuario,
    });
  }

  /** Cancela a marcação travada: o cancelamento, a situação e o horário (liberado ou mantido). */
  private async cancelarMarcacao(
    tx: TxOperacao,
    ctx: ContextoOperacao,
    m: Linha,
    p: {
      motivo: string;
      complemento: string | null;
      solicitante: string;
      liberar: boolean;
      nova: number | null;
    },
  ): Promise<number> {
    const motivo = await tx.uma('SELECT id FROM motivo_cancelamento_operacao WHERE codigo = ? AND ativo', [
      p.motivo,
    ]);
    if (!motivo) throw configuracaoIncompleta(`motivo de cancelamento "${p.motivo}"`);
    const protocolo = await tx.incluir('cancelamento_marcacao', {
      estabelecimento_id: ctx.estabelecimento,
      marcacao_horario_id: m['id'],
      motivo_cancelamento_operacao_id: motivo['id'],
      complemento: p.complemento,
      solicitante: p.solicitante,
      cancelado_em: this.agora(),
      responsavel_usuario_id: ctx.usuario,
      horario_liberado: p.liberar,
      nova_marcacao_horario_id: p.nova,
    });
    await tx.alterar('marcacao_horario', num(m['id']), num(m['versao']), {
      situacao_marcacao_id: await this.situacaoMarcacao(tx, 'cancelada'),
    });
    if (p.liberar) {
      const [h] = await tx.consultarParaAtualizar(
        'SELECT id, versao, tipo_horario, vagas_ocupadas FROM horario_agenda WHERE id = ?',
        [m['horario_agenda_id']],
        { teto: 1 },
      );
      if (h) {
        const encaixe = h['tipo_horario'] === 'encaixe';
        await tx.alterar('horario_agenda', num(h['id']), num(h['versao']), {
          vagas_ocupadas: Math.max(0, num(h['vagas_ocupadas']) - 1),
          situacao: encaixe ? 'cancelado' : 'livre',
        });
      }
    }
    return protocolo;
  }
}

function configuracaoIncompleta(o: string): ErroOperacao {
  return new ErroOperacao(
    422,
    'configuracao-incompleta',
    'Cadastro da agenda incompleto',
    `Falta no cadastro do cliente: ${o}. Peça ao administrador para completar os domínios da agenda.`,
  );
}

function resultadoDaSituacao(codigo: string, significado: string): string {
  if (RESULTADOS_CONFIRMACAO.some((r) => r.codigo === codigo)) return codigo;
  return significado === 'confirmada'
    ? 'confirmado'
    : significado === 'recusada'
      ? 'refutado'
      : 'nao-confirmado';
}

/** Dia da semana (1 = domingo) de uma data ISO; exportado para os testes. */
export const diaDaSemana = diaSemana;
