// Porta PRÓPRIA da telemedicina sobre o MariaDB (@sgh/nucleo): a teleconsulta e a teleinterconsulta na tabela
// `teleconsulta`, o paciente e o médico na sala em `teleconsulta_participante`, a linha da trilha na mesma transação
// (gravarTrilha). Leituras pelo caminho somente leitura, sempre no estabelecimento da sessão e sem os excluídos.
// Melhoria: horários guardados como instante (agendada_para) e mostrados no fuso do estabelecimento
// (estabelecimento.fuso_horario), não no relógio do servidor.
// Melhoria: trava otimista pela coluna versao (SELECT ... FOR UPDATE e alterarAuditado), com a situação conferida na
// mesma transação; a teleconsulta viva é única por marcação.
// Melhoria: o cancelamento da teleinterconsulta grava cancelada_em e motivo_cancelamento próprios (antes o motivo era
// emendado no texto do pedido); o médico da sala e o paciente que entrou ficam como participantes, com o horário.
// Melhoria: a marcação excluída, cancelada ou com falta (situacao_marcacao.significado) ou que mudou de horário fora do
// portal é reconhecida pela leitura (marcacao_vigente), sem tabela espelho nem vigia de reconciliação.
// Melhoria: a teleconsulta da marcação nasce do profissional da agenda (o executante, quando difere do dono da agenda) e
// do horário da agenda (horario_agenda.inicio_em), com o paciente da marcação conferido; o mesmo na remarcação.
// Melhoria: o início é reentrante: a teleconsulta com o atendimento já ligado e a sala aberta termina a vinculação.
// Melhoria: violação de restrição do banco vira mensagem de negócio (traduzirErro), nunca erro cru.
import { randomUUID } from 'node:crypto';
import {
  esquemaHora,
  horaParaMinutos,
  type MotivoEncerramentoTeleconsulta,
  type SituacaoTeleconsulta,
  idBanco,
} from '@sgh/contratos';
import {
  type ContextoOperacao,
  definirOperacao,
  ErroOperacao,
  type Executor,
  gravarTrilha,
  type Leitor,
  type Linha,
  type NucleoProprio,
  type Operacao,
  type ResultadoOperacao,
  restricaoViolada,
  traduzirErro,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';
import { contextoDoEstabelecimento } from '../cadastro/contexto-nucleo.js';
import { portaIndisponivel } from '../exames/public-api.js';
import {
  type AtendimentoDoHistoricoClinico,
  type ContextoTelemedicina,
  ErroTelemedicina,
  type GravadorTelemedicina,
  METODOS_PORTA_TELEMEDICINA,
  type PortaTelemedicina,
  type ProvedorSala,
  type Teleconsulta,
  type TrilhaTelemedicina,
} from './porta.js';

/** O mínimo do núcleo que a porta usa (os testes passam o NucleoProprio real). */
export type NucleoTelemedicina = Pick<NucleoProprio, 'lerSomente' | 'escrever' | 'criarExecutor'>;

const FUSO_PADRAO = 'America/Sao_Paulo';
const TABELA = 'teleconsulta';
const PARTICIPANTE = 'teleconsulta_participante';
const TETO_PACIENTE = 200;
const TETO_HISTORICO = 500;

// ── Fuso ───────────────────────────────────────────────────────────────────────────────────────────────────────────

function partes(fuso: string, d: Date) {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: fuso,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d);
  const v = (t: string) => p.find((x) => x.type === t)?.value ?? '00';
  return { data: `${v('year')}-${v('month')}-${v('day')}`, hh: v('hour'), mi: v('minute'), ss: v('second') };
}

/** O instante no fuso: data civil, hora do dia "HH:MM" e o carimbo local (AAAA-MM-DDTHH:MM:SS). */
export function civilNoFuso(fuso: string, d: Date): { data: string; hora: string; carimbo: string } {
  const p = partes(fuso, d);
  return { data: p.data, hora: `${p.hh}:${p.mi}`, carimbo: `${p.data}T${p.hh}:${p.mi}:${p.ss}` };
}

/** A data civil e a hora do dia ("HH:MM", recusada fora do formato) no fuso do estabelecimento como instante. */
export function instanteNoFuso(fuso: string, data: string, hora: string): Date {
  const [a, m, d] = data.split('-').map(Number);
  const minutos = horaParaMinutos(hora);
  const palpite = Date.UTC(a ?? 1970, (m ?? 1) - 1, d ?? 1, Math.floor(minutos / 60), minutos % 60);
  const p = partes(fuso, new Date(palpite));
  const comoUtc = Date.UTC(
    Number(p.data.slice(0, 4)),
    Number(p.data.slice(5, 7)) - 1,
    Number(p.data.slice(8, 10)),
    Number(p.hh),
    Number(p.mi),
  );
  return new Date(palpite - (comoUtc - palpite));
}

const comoData = (v: unknown): Date | null =>
  v instanceof Date ? v : v === null || v === undefined ? null : new Date(String(v));

// ── Vocabulário: o banco usa sublinhado; o contrato da tela, hífen ───────────────────────────────────────────────────

const doBanco = (v: unknown): string => String(v ?? '').replace(/_/g, '-');
const paraBanco = (v: string): string => v.replace(/-/g, '_');

// ── Leitura ──────────────────────────────────────────────────────────────────────────────────────────────────────

const SQL_TELE = `SELECT t.id, t.modalidade, t.situacao, t.marcacao_horario_id, t.atendimento_id, t.paciente_id,
  t.profissional_id, t.solicitante_profissional_id, t.agendada_para, t.sala_aberta_em, t.iniciada_em, t.encerrada_em,
  t.motivo_encerramento, t.local_paciente_tipo, uf.sigla AS uf_sigla, t.termo_versao, t.termo_aceito_em,
  t.declaracao_profissional_versao, t.identificador_sala, t.provedor_video, t.pergunta, t.parecer, t.respondida_em,
  t.cancelada_em, t.motivo_cancelamento, t.criado_em, t.versao,
  uc.login AS criado_por_login,
  COALESCE(pr.nome_exibicao, pfp.nome) AS profissional_nome,
  (SELECT pp.criado_em FROM teleconsulta_participante pp
     WHERE pp.teleconsulta_id = t.id AND pp.papel = 'paciente' AND pp.excluido_em IS NULL
     ORDER BY pp.sequencia LIMIT 1) AS espera_desde,
  (SELECT pp.entrou_em FROM teleconsulta_participante pp
     WHERE pp.teleconsulta_id = t.id AND pp.papel = 'paciente' AND pp.excluido_em IS NULL
     ORDER BY pp.sequencia LIMIT 1) AS paciente_entrou_em,
  (SELECT um.login FROM teleconsulta_participante pm JOIN usuario um ON um.id = pm.usuario_id
     WHERE pm.teleconsulta_id = t.id AND pm.papel = 'profissional' AND pm.excluido_em IS NULL
     ORDER BY pm.sequencia DESC LIMIT 1) AS medico_login,
  (mh.id IS NOT NULL AND mh.excluido_em IS NULL AND sm.significado NOT IN ('cancelada','falta','nao_informada')
     AND ha.inicio_em = t.agendada_para) AS marcacao_vigente
FROM teleconsulta t
LEFT JOIN unidade_federativa uf ON uf.id = t.local_paciente_unidade_federativa_id
LEFT JOIN usuario uc ON uc.id = t.criado_por
LEFT JOIN profissional pr ON pr.id = t.profissional_id
LEFT JOIN pessoa_fisica pfp ON pfp.id = pr.pessoa_fisica_id
LEFT JOIN marcacao_horario mh ON mh.id = t.marcacao_horario_id
LEFT JOIN horario_agenda ha ON ha.id = mh.horario_agenda_id
LEFT JOIN situacao_marcacao sm ON sm.id = mh.situacao_marcacao_id
WHERE t.estabelecimento_id = ? AND t.excluido_em IS NULL`;

const PROVEDORES: ReadonlySet<string> = new Set(['simulado', 'provedor']);
const numOuNulo = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const textoOuNulo = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

function teleconsultaDe(r: Linha, fuso: string): Teleconsulta {
  const quando = (v: unknown) => {
    const d = comoData(v);
    return d ? civilNoFuso(fuso, d).carimbo : null;
  };
  const tele = r['modalidade'] === 'teleconsulta';
  const agendada = comoData(r['agendada_para']) ?? comoData(r['criado_em']) ?? new Date(0);
  const civil = civilNoFuso(fuso, agendada);
  const salaAberta = r['sala_aberta_em'] !== null && r['sala_aberta_em'] !== undefined;
  const provedor = textoOuNulo(r['provedor_video']);
  const tipoLocal = textoOuNulo(r['local_paciente_tipo']);
  const uf = textoOuNulo(r['uf_sigla']);
  const termo = textoOuNulo(r['termo_versao']);
  const nomeProf = String(r['profissional_nome'] ?? '');
  return {
    id: Number(r['id']),
    modalidade: tele ? 'teleconsulta' : 'teleinterconsulta',
    situacao: doBanco(r['situacao']) as SituacaoTeleconsulta,
    marcacao: numOuNulo(r['marcacao_horario_id']),
    marcacaoVigente: tele && r['marcacao_horario_id'] !== null ? Number(r['marcacao_vigente']) === 1 : null,
    nomeAgenda: tele ? nomeProf : '',
    profissionalAgenda: tele ? numOuNulo(r['profissional_id']) : null,
    data: civil.data,
    hora: civil.hora,
    paciente: Number(r['paciente_id']),
    atendimento: numOuNulo(r['atendimento_id']),
    termo: termo ? { versao: termo, aceitoEm: quando(r['termo_aceito_em']) ?? '' } : null,
    // O município informado não tem coluna no modelo (pedido de DDL do lote 03-15): sai vazio.
    local: tipoLocal && uf ? { uf, municipio: '', tipo: doBanco(tipoLocal) } : null,
    esperaDesde: quando(r['espera_desde']),
    provedor: provedor ? ((PROVEDORES.has(provedor) ? provedor : 'provedor') as ProvedorSala) : null,
    sala: textoOuNulo(r['identificador_sala']),
    salaAbertaEm: quando(r['sala_aberta_em']),
    declaracao: textoOuNulo(r['declaracao_profissional_versao']),
    medico: tele ? (salaAberta ? textoOuNulo(r['medico_login']) : null) : textoOuNulo(r['criado_por_login']),
    vinculoMedico: tele
      ? salaAberta
        ? numOuNulo(r['profissional_id'])
        : null
      : numOuNulo(r['solicitante_profissional_id']),
    pacienteEntrouEm: quando(r['paciente_entrou_em']),
    iniciadaEm: quando(r['iniciada_em']),
    encerradaEm: quando(r['encerrada_em']),
    motivoEncerramento: r['motivo_encerramento']
      ? (doBanco(r['motivo_encerramento']) as MotivoEncerramentoTeleconsulta)
      : null,
    convidado: tele ? null : numOuNulo(r['profissional_id']),
    nomeConvidado: tele ? null : nomeProf,
    motivoInterconsulta: textoOuNulo(r['pergunta']),
    parecer: textoOuNulo(r['parecer']),
    respondidaEm: quando(r['respondida_em']),
    canceladaEm: quando(r['cancelada_em']),
    motivoCancelamento: textoOuNulo(r['motivo_cancelamento']),
    criadoPor: String(r['criado_por_login'] ?? ''),
    criadoEm: quando(r['criado_em']) ?? '',
    versao: Number(r['versao']),
  };
}

async function fusoDe(l: Leitor, est: number): Promise<string> {
  const r = await l.uma<{ fuso_horario: string | null }>(
    'SELECT fuso_horario FROM estabelecimento WHERE id = ?',
    [est],
  );
  return r?.fuso_horario || FUSO_PADRAO;
}

interface Base {
  readonly cliente: string;
  readonly estabelecimento: number;
  readonly usuario: number | null;
  readonly correlacao: string;
}

const versaoVelha = (o: string) =>
  new ErroTelemedicina(
    'versao-desatualizada',
    `A teleconsulta foi alterada por outra pessoa ou mudou de situação (${o}); recarregue.`,
  );

export class PortaTelemedicinaPropria implements PortaTelemedicina {
  readonly destino = 'banco' as const;

  private readonly executor: Executor;

  constructor(
    private readonly nucleo: NucleoTelemedicina,
    private readonly clientePadrao: string | null = null,
    executorPronto?: Executor,
  ) {
    this.executor = executorPronto ?? nucleo.criarExecutor();
  }

  private base(c: ContextoTelemedicina): Base {
    const m = c.hospital ? contextoDoEstabelecimento(c.hospital) : { cliente: '', estabelecimento: null };
    const cliente = c.cliente || m.cliente || this.clientePadrao || '';
    const estabelecimento = c.estabelecimento ?? m.estabelecimento;
    if (!cliente || !estabelecimento)
      throw new ErroTelemedicina(
        'nao-encontrado',
        'O estabelecimento da sessão não foi identificado no banco.',
      );
    return {
      cliente,
      estabelecimento,
      usuario: c.usuario ?? null,
      correlacao: (c.correlacao || `telemedicina-${randomUUID()}`).slice(0, 64),
    };
  }

  private async ler<T>(c: ContextoTelemedicina, fn: (l: Leitor, est: number, fuso: string) => Promise<T>) {
    const b = this.base(c);
    return this.nucleo.lerSomente(b, async (l) =>
      fn(l, b.estabelecimento, await fusoDe(l, b.estabelecimento)),
    );
  }

  private async uma(
    c: ContextoTelemedicina,
    filtro: string,
    p: readonly unknown[],
  ): Promise<Teleconsulta | null> {
    return this.ler(c, async (l, est, fuso) => {
      const r = await l.uma(`${SQL_TELE} AND ${filtro} LIMIT 1`, [est, ...p]);
      return r ? teleconsultaDe(r, fuso) : null;
    });
  }

  private async lista(
    c: ContextoTelemedicina,
    filtro: string,
    p: readonly unknown[],
    ordem: string,
    teto: number,
  ): Promise<{ itens: Teleconsulta[]; truncado: boolean }> {
    return this.ler(c, async (l, est, fuso) => {
      const rs = await l.consultar(`${SQL_TELE} AND ${filtro} ORDER BY ${ordem} LIMIT ?`, [
        est,
        ...p,
        teto + 1,
      ]);
      return { itens: rs.slice(0, teto).map((r) => teleconsultaDe(r, fuso)), truncado: rs.length > teto };
    });
  }

  porId(c: ContextoTelemedicina, id: number) {
    return this.uma(c, 't.id = ?', [id]);
  }

  daMarcacao(c: ContextoTelemedicina, marcacao: number) {
    return this.uma(
      c,
      "t.modalidade = 'teleconsulta' AND t.marcacao_horario_id = ? AND t.situacao <> 'cancelada'",
      [marcacao],
    );
  }

  async doPaciente(c: ContextoTelemedicina, paciente: number) {
    const r = await this.lista(
      c,
      "t.modalidade = 'teleconsulta' AND t.paciente_id = ?",
      [paciente],
      't.agendada_para DESC, t.id DESC',
      TETO_PACIENTE,
    );
    return r.itens;
  }

  async doDia(c: ContextoTelemedicina, f: { data: string; profissional: number | null; teto: number }) {
    const b = this.base(c);
    const fuso = await this.nucleo.lerSomente(b, (l) => fusoDe(l, b.estabelecimento));
    const de = instanteNoFuso(fuso, f.data, '00:00');
    const ate = new Date(de.getTime() + 86_400_000);
    return this.lista(
      c,
      "t.modalidade = 'teleconsulta' AND t.agendada_para >= ? AND t.agendada_para < ? AND (? IS NULL OR t.profissional_id = ?)",
      [de, ate, f.profissional, f.profissional],
      't.agendada_para, t.id',
      f.teto,
    );
  }

  doAtendimento(c: ContextoTelemedicina, atendimento: number) {
    return this.uma(
      c,
      "t.modalidade = 'teleconsulta' AND t.atendimento_id = ? AND t.situacao IN ('em_andamento','encerrada')",
      [atendimento],
    );
  }

  async interconsultas(
    c: ContextoTelemedicina,
    f: { convidado: number | null; solicitante: string; desde: string; teto: number },
  ) {
    return this.lista(
      c,
      "t.modalidade = 'teleinterconsulta' AND (t.profissional_id <=> ? OR uc.login = ?) AND (t.situacao IN ('solicitada','sala_aberta') OR t.agendada_para >= ?)",
      [f.convidado, f.solicitante, new Date(`${f.desde}T00:00:00Z`)],
      't.agendada_para DESC, t.id DESC',
      f.teto,
    );
  }

  /**
   * O histórico do paciente em toda a rede do cliente (sem filtro de estabelecimento, de propósito: o alerta do
   * crônico considera a última consulta presencial em qualquer unidade). Só data, CID e o tipo do atendimento.
   */
  historicoClinico(c: ContextoTelemedicina, paciente: number): Promise<AtendimentoDoHistoricoClinico[]> {
    return this.ler(c, async (l, _est, fuso) => {
      const rs = await l.consultar(
        `SELECT a.id, a.entrada_em, tt.codigo_termo AS cid, ca.tipo_base,
           (a.teleconsulta_id IS NOT NULL OR EXISTS (SELECT 1 FROM teleconsulta t WHERE t.atendimento_id = a.id AND t.excluido_em IS NULL)) AS tele
         FROM atendimento a
         JOIN categoria_atendimento ca ON ca.id = a.categoria_atendimento_id
         LEFT JOIN termo_terminologia tt ON tt.id = a.cid_principal_termo_terminologia_id
         WHERE a.paciente_id = ? AND a.excluido_em IS NULL AND a.situacao <> 'cancelado'
         ORDER BY a.entrada_em DESC LIMIT ?`,
        [paciente, TETO_HISTORICO],
      );
      return rs.map((r) => ({
        atendimento: Number(r['id']),
        data: civilNoFuso(fuso, comoData(r['entrada_em']) ?? new Date(0)).data,
        cid: textoOuNulo(r['cid']),
        laboratorio: r['tipo_base'] === 'externo',
        teleconsulta: Number(r['tele']) === 1 || r['tipo_base'] === 'telessaude',
      }));
    });
  }

  // ── Gravação ─────────────────────────────────────────────────────────────────────────────────────────────────

  /**
   * Cada gravação do gravador é uma operação declarada do Executor (entrada validada, só as tabelas da operação,
   * trilha da operação, outbox e idempotência), rodando sob um SAVEPOINT na transação aberta aqui. A linha do evento
   * de negócio (a trilha que o serviço monta) vai depois, na mesma transação: ou tudo grava, ou nada.
   */
  async gravar<T>(
    c: ContextoTelemedicina,
    trilha: TrilhaTelemedicina<T>,
    fn: (g: GravadorTelemedicina) => Promise<T>,
  ): Promise<T> {
    const b = this.base(c);
    const prefixo = (c.chaveIdempotencia ?? `tele-${randomUUID()}`).slice(0, 56);
    let passo = 0;
    try {
      return await this.nucleo.escrever(b, async (e) => {
        const rodar = async <E, S extends ResultadoOperacao>(op: Operacao<E, S>, entrada: E): Promise<S> => {
          passo += 1;
          const ctx: ContextoOperacao = {
            ...b,
            chaveIdempotencia: `${prefixo}:${op.nome.slice(13)}:${passo}`,
          };
          try {
            return (await this.executor.executar(op, b.cliente, entrada, ctx, { escritor: e })).resultado;
          } catch (erro) {
            throw deNegocio(erro);
          }
        };
        const r = await fn(gravadorDe(rodar));
        const linha = typeof trilha === 'function' ? trilha(r) : trilha;
        if (linha)
          await gravarTrilha(e, {
            ...linha,
            estabelecimento: linha.estabelecimento ?? b.estabelecimento,
            usuario: linha.usuario ?? b.usuario,
            correlacao: linha.correlacao ?? b.correlacao,
            ocorridoEm: linha.ocorridoEm ?? new Date(),
          });
        return r;
      });
    } catch (erro) {
      if (erro instanceof ErroTelemedicina || erro instanceof ErroOperacao) throw erro;
      if (restricaoViolada(erro)) throw traduzirErro(erro);
      throw erro;
    }
  }
}

// ── Operações declaradas (Executor do núcleo) ────────────────────────────────────────────────────────────────────

const TABELAS = [TABELA, PARTICIPANTE] as const;
const PREFIXO_RECUSA = 'telemedicina-';
const MARCACAO_SEM_VALIDADE: ReadonlySet<string> = new Set(['cancelada', 'falta', 'nao_informada']);
const VIVAS = ['agendada', 'aguardando', 'sala_aberta', 'em_andamento'] as const;

/** A recusa de negócio atravessa o executor como ErroOperacao (409) e volta a ErroTelemedicina do lado de cá. */
function recusaDeNegocio(e: ErroTelemedicina): ErroOperacao {
  return new ErroOperacao(409, `${PREFIXO_RECUSA}${e.codigo}`, 'Recusa da telemedicina', e.message);
}

function deNegocio(erro: unknown): unknown {
  if (!(erro instanceof ErroOperacao)) return erro;
  const codigo = erro.problema.codigo ?? '';
  if (codigo.startsWith(PREFIXO_RECUSA))
    return new ErroTelemedicina(
      codigo.slice(PREFIXO_RECUSA.length) as ErroTelemedicina['codigo'],
      erro.problema.detail,
    );
  if (codigo === 'conflito-versao') return versaoVelha('versão');
  return erro;
}

/** O corpo da operação: ErroTelemedicina vira recusa (409) que o executor conta como recusa, não como erro. */
const corpo =
  <E, S extends ResultadoOperacao>(fn: (tx: TxOperacao, e: E, est: number) => Promise<S>) =>
  async (tx: TxOperacao, e: E, ctx: ContextoOperacao): Promise<S> => {
    try {
      return await fn(tx, e, Number(ctx.estabelecimento));
    } catch (erro) {
      if (erro instanceof ErroTelemedicina) throw recusaDeNegocio(erro);
      throw erro;
    }
  };

const idPositivo = idBanco;
const versaoZ = z.number().int().positive().max(2_147_483_647);
const dataZ = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
/** Hora do dia "HH:MM" (o auxiliar neutro do contrato). */
const horaZ = esquemaHora;
const provedorZ = z.enum(['simulado', 'provedor']);
const motivoZ = z.enum(['concluida', 'paciente-ausente', 'falha-conexao', 'presencial-indicado']);

const COLUNAS_TRAVA = `id, versao, modalidade, situacao, paciente_id, profissional_id, solicitante_profissional_id,
  criado_por, termo_versao, local_paciente_tipo, marcacao_horario_id, atendimento_id`;

async function travar(
  tx: TxOperacao,
  est: number,
  id: number,
  versao: number | null,
  o: string,
  ok: (r: Linha) => boolean,
): Promise<Linha> {
  const [r] = await tx.consultarParaAtualizar(
    `SELECT ${COLUNAS_TRAVA} FROM teleconsulta WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
    [id, est],
  );
  if (!r) throw new ErroTelemedicina('nao-encontrado', 'Teleconsulta não encontrada.');
  if ((versao !== null && Number(r['versao']) !== versao) || !ok(r)) throw versaoVelha(o);
  return r;
}

const alterar = (tx: TxOperacao, r: Linha, valores: Readonly<Record<string, unknown>>) =>
  tx.alterar(TABELA, Number(r['id']), Number(r['versao']), valores);
const naSituacao = (r: Linha, ...s: string[]) => s.includes(String(r['situacao']));

async function participante(
  tx: TxOperacao,
  tele: number,
  papel: string,
  valores: Readonly<Record<string, unknown>>,
) {
  const seq = await tx.uma<{ n: number }>(
    `SELECT COALESCE(MAX(sequencia), 0) + 1 AS n FROM ${PARTICIPANTE} WHERE teleconsulta_id = ?`,
    [tele],
  );
  return tx.incluir(PARTICIPANTE, {
    teleconsulta_id: tele,
    sequencia: Number(seq?.n ?? 1),
    papel,
    ...valores,
  });
}

const vivasDaMarcacao = (tx: TxOperacao, est: number, marcacao: number, situacoes: readonly string[]) =>
  tx.consultarParaAtualizar(
    `SELECT ${COLUNAS_TRAVA} FROM teleconsulta
     WHERE estabelecimento_id = ? AND marcacao_horario_id = ? AND modalidade = 'teleconsulta'
       AND excluido_em IS NULL AND situacao IN (${situacoes.map(() => '?').join(', ')})`,
    [est, marcacao, ...situacoes],
  );

interface MarcacaoDaAgenda {
  readonly profissional: number | null;
  readonly inicio: Date;
  readonly paciente: number | null;
  readonly valida: boolean;
}

/**
 * A marcação da agenda, travada (serializa duas teleconsultas na mesma marcação): o profissional é o executante,
 * quando difere do dono da agenda, ou o dono da agenda; o horário é o início do horário da agenda.
 */
async function marcacaoDaAgenda(
  tx: TxOperacao,
  est: number,
  marcacao: number,
): Promise<MarcacaoDaAgenda | null> {
  const [trava] = await tx.consultarParaAtualizar(
    'SELECT id FROM marcacao_horario WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
    [marcacao, est],
  );
  if (!trava) return null;
  const m = await tx.uma(
    `SELECT COALESCE(mh.executante_profissional_id, ags.profissional_id) AS profissional, ha.inicio_em,
            mh.paciente_id, sm.significado
       FROM marcacao_horario mh
       JOIN horario_agenda ha ON ha.id = mh.horario_agenda_id
       JOIN agenda_servico ags ON ags.id = ha.agenda_servico_id
       JOIN situacao_marcacao sm ON sm.id = mh.situacao_marcacao_id
      WHERE mh.id = ?`,
    [marcacao],
  );
  if (!m) return null;
  return {
    profissional: numOuNulo(m['profissional']),
    inicio: comoData(m['inicio_em']) ?? new Date(0),
    paciente: numOuNulo(m['paciente_id']),
    valida: !MARCACAO_SEM_VALIDADE.has(String(m['significado'])),
  };
}

const evento = (tipo: string, carga: Readonly<Record<string, number | string | boolean | null>>) => [
  { tipo, carga },
];

/** A operação com o resultado fixado (a entrada vem do zod). */
const operacao =
  <S extends ResultadoOperacao>() =>
  <E>(op: Operacao<E, S>): Operacao<E, S> =>
    definirOperacao(op);

export const OPERACOES_TELEMEDICINA = {
  agendar: operacao<{ id: number }>()({
    nome: 'telemedicina.agendar',
    tabelas: TABELAS,
    entrada: z.object({
      marcacao: idPositivo.nullable(),
      profissional: idPositivo.nullable(),
      data: dataZ,
      hora: horaZ,
      paciente: idPositivo,
    }),
    gravar: corpo(async (tx, en, est) => {
      let profissional = en.profissional;
      let quando: Date;
      if (en.marcacao !== null) {
        const m = await marcacaoDaAgenda(tx, est, en.marcacao);
        if (!m)
          throw new ErroTelemedicina(
            'nao-encontrado',
            'A marcação da teleconsulta não existe neste estabelecimento.',
          );
        if (!m.valida)
          throw new ErroTelemedicina(
            'situacao',
            'A marcação está cancelada ou com falta: a teleconsulta não foi criada.',
          );
        if (m.paciente !== en.paciente)
          throw new ErroTelemedicina(
            'situacao',
            'A marcação é de outro paciente: a teleconsulta não foi criada.',
          );
        if ((await vivasDaMarcacao(tx, est, en.marcacao, [...VIVAS, 'encerrada'])).length)
          throw new ErroTelemedicina('situacao', 'Esta marcação já tem teleconsulta.');
        profissional ??= m.profissional;
        quando = m.inicio;
      } else quando = instanteNoFuso(await fusoDe(tx, est), en.data, en.hora);
      if (profissional === null)
        throw new ErroTelemedicina(
          'situacao',
          'A agenda da marcação não tem profissional (agenda de recurso ou setor): a teleconsulta não foi criada.',
        );
      const id = await tx.incluir(TABELA, {
        estabelecimento_id: est,
        modalidade: 'teleconsulta',
        marcacao_horario_id: en.marcacao,
        paciente_id: en.paciente,
        profissional_id: profissional,
        situacao: 'agendada',
        agendada_para: quando,
      });
      return { id };
    }),
    eventos: (e, r) =>
      evento('telemedicina.teleconsulta_agendada', {
        teleconsulta: r.id,
        marcacao: e.marcacao,
        paciente: e.paciente,
      }),
    alvo: (_e, r) => ({ tabela: TABELA, id: r.id }),
  }),
  entrarSalaEspera: operacao<{ versao: number }>()({
    nome: 'telemedicina.entrar_sala_espera',
    tabelas: TABELAS,
    entrada: z.object({
      id: idPositivo,
      versao: versaoZ,
      termo: z.string().min(1).max(30),
      uf: z.string().length(2),
      tipo: z.string().min(1).max(30),
    }),
    gravar: corpo(async (tx, en, est) => {
      const r = await travar(
        tx,
        est,
        en.id,
        en.versao,
        'sala de espera',
        (x) => x['modalidade'] === 'teleconsulta' && naSituacao(x, 'agendada', 'aguardando', 'sala_aberta'),
      );
      const uf = await tx.uma<{ id: number }>('SELECT id FROM unidade_federativa WHERE sigla = ?', [en.uf]);
      if (!uf)
        throw new ErroTelemedicina(
          'situacao',
          'A UF informada não existe no cadastro de unidades federativas.',
        );
      const versao = await alterar(tx, r, {
        termo_versao: en.termo,
        termo_aceito_em: new Date(),
        local_paciente_tipo: paraBanco(en.tipo),
        local_paciente_unidade_federativa_id: Number(uf.id),
        situacao: naSituacao(r, 'agendada') ? 'aguardando' : String(r['situacao']),
      });
      const ja = await tx.uma(
        `SELECT id FROM ${PARTICIPANTE} WHERE teleconsulta_id = ? AND papel = 'paciente' AND excluido_em IS NULL`,
        [en.id],
      );
      if (!ja) await participante(tx, en.id, 'paciente', { paciente_id: Number(r['paciente_id']) });
      return { versao };
    }),
    alvo: (e) => ({ tabela: TABELA, id: e.id }),
  }),
  registrarEntradaPaciente: operacao<{ registrada: boolean }>()({
    nome: 'telemedicina.registrar_entrada_paciente',
    tabelas: TABELAS,
    entrada: z.object({ id: idPositivo }),
    gravar: corpo(async (tx, en, est) => {
      const [r] = await tx.consultarParaAtualizar(
        'SELECT id, situacao FROM teleconsulta WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [en.id, est],
      );
      if (!r || !naSituacao(r, 'sala_aberta', 'em_andamento')) return { registrada: false };
      const [p] = await tx.consultarParaAtualizar(
        `SELECT id, versao FROM ${PARTICIPANTE}
         WHERE teleconsulta_id = ? AND papel = 'paciente' AND excluido_em IS NULL AND entrou_em IS NULL
         ORDER BY sequencia LIMIT 1`,
        [en.id],
      );
      if (!p) return { registrada: false };
      await tx.alterar(PARTICIPANTE, Number(p['id']), Number(p['versao']), { entrou_em: new Date() });
      return { registrada: true };
    }),
    alvo: (e) => ({ tabela: TABELA, id: e.id }),
  }),
  abrirSala: operacao<{ versao: number }>()({
    nome: 'telemedicina.abrir_sala',
    tabelas: TABELAS,
    entrada: z.object({
      id: idPositivo,
      versao: versaoZ,
      provedor: provedorZ,
      sala: z.string().min(1).max(128),
      declaracao: z.string().min(1).max(30),
      vinculo: idPositivo,
      cienteAlerta: z.boolean(),
    }),
    gravar: corpo(async (tx, en, est) => {
      const r = await travar(
        tx,
        est,
        en.id,
        en.versao,
        'abertura da sala',
        (x) =>
          x['modalidade'] === 'teleconsulta' &&
          naSituacao(x, 'aguardando') &&
          x['termo_versao'] !== null &&
          x['local_paciente_tipo'] !== null,
      );
      const agora = new Date();
      const versao = await alterar(tx, r, {
        situacao: 'sala_aberta',
        provedor_video: en.provedor,
        identificador_sala: en.sala,
        sala_aberta_em: agora,
        declaracao_profissional_versao: en.declaracao,
        declaracao_profissional_em: agora,
        profissional_id: en.vinculo,
      });
      await participante(tx, en.id, 'profissional', {
        profissional_id: en.vinculo,
        usuario_id: tx.contexto.usuario,
        entrou_em: agora,
      });
      return { versao };
    }),
    alvo: (e) => ({ tabela: TABELA, id: e.id }),
    // A ciência do alerta do crônico fica na trilha da operação até a coluna própria (pedido de DDL do lote).
    trilha: (e) => ({ dados: { cienteAlerta: e.cienteAlerta } }),
  }),
  vincularAtendimento: operacao<{ ligada: boolean }>()({
    nome: 'telemedicina.vincular_atendimento',
    tabelas: TABELAS,
    entrada: z.object({ id: idPositivo, atendimento: idPositivo, profissional: idPositivo }),
    gravar: corpo(async (tx, en, est) => {
      const r = await travar(
        tx,
        est,
        en.id,
        null,
        'início do atendimento',
        (x) => x['modalidade'] === 'teleconsulta',
      );
      if (Number(r['profissional_id']) !== en.profissional)
        throw new ErroTelemedicina(
          'situacao',
          'A sala desta teleconsulta foi aberta por outro profissional: o atendimento não foi ligado.',
        );
      const ligado = numOuNulo(r['atendimento_id']);
      if (ligado !== null && ligado !== en.atendimento)
        throw new ErroTelemedicina('situacao', 'A teleconsulta já está ligada a outro atendimento.');
      // Reentrante: a repetição (ou a retomada depois de uma falha) encontra a teleconsulta já em andamento.
      if (naSituacao(r, 'em_andamento')) return { ligada: false };
      if (!naSituacao(r, 'sala_aberta'))
        throw new ErroTelemedicina(
          'situacao',
          'A teleconsulta não está com a sala aberta: o atendimento não foi ligado.',
        );
      const a = await tx.uma(
        'SELECT id FROM atendimento WHERE id = ? AND estabelecimento_id = ? AND paciente_id = ? AND excluido_em IS NULL',
        [en.atendimento, est, Number(r['paciente_id'])],
      );
      if (!a)
        throw new ErroTelemedicina(
          'nao-encontrado',
          'O atendimento não é deste paciente neste estabelecimento.',
        );
      await alterar(tx, r, {
        situacao: 'em_andamento',
        iniciada_em: new Date(),
        atendimento_id: en.atendimento,
      });
      return { ligada: true };
    }),
    eventos: (e, r) =>
      r.ligada
        ? evento('telemedicina.teleconsulta_iniciada', { teleconsulta: e.id, atendimento: e.atendimento })
        : [],
    alvo: (e) => ({ tabela: TABELA, id: e.id }),
  }),
  encerrar: operacao<{ versao: number }>()({
    nome: 'telemedicina.encerrar',
    tabelas: TABELAS,
    entrada: z.object({ id: idPositivo, versao: versaoZ, motivo: motivoZ, vinculo: idPositivo.nullable() }),
    gravar: corpo(async (tx, en, est) => {
      const r = await travar(
        tx,
        est,
        en.id,
        en.versao,
        'encerramento',
        (x) =>
          x['modalidade'] === 'teleconsulta' &&
          naSituacao(x, 'agendada', 'aguardando', 'sala_aberta', 'em_andamento') &&
          (en.motivo !== 'concluida' || naSituacao(x, 'em_andamento')) &&
          (!naSituacao(x, 'sala_aberta', 'em_andamento') || Number(x['profissional_id']) === en.vinculo),
      );
      const versao = await alterar(tx, r, {
        situacao: 'encerrada',
        encerrada_em: new Date(),
        motivo_encerramento: paraBanco(en.motivo),
      });
      return { versao };
    }),
    eventos: (e) => evento('telemedicina.teleconsulta_encerrada', { teleconsulta: e.id, motivo: e.motivo }),
    alvo: (e) => ({ tabela: TABELA, id: e.id }),
  }),
  cancelarDaMarcacao: operacao<{ canceladas: number }>()({
    nome: 'telemedicina.cancelar_da_marcacao',
    tabelas: TABELAS,
    entrada: z.object({ marcacao: idPositivo }),
    gravar: corpo(async (tx, en, est) => {
      const rs = await vivasDaMarcacao(tx, est, en.marcacao, ['agendada', 'aguardando', 'sala_aberta']);
      for (const r of rs)
        await alterar(tx, r, {
          situacao: 'cancelada',
          cancelada_em: new Date(),
          motivo_cancelamento: 'Marcação cancelada.',
        });
      return { canceladas: rs.length };
    }),
    eventos: (e, r) =>
      r.canceladas > 0
        ? evento('telemedicina.teleconsulta_cancelada', { marcacao: e.marcacao, quantidade: r.canceladas })
        : [],
    alvo: () => ({ tabela: TABELA, id: null }),
  }),
  mover: operacao<{ movidas: number }>()({
    nome: 'telemedicina.mover',
    tabelas: TABELAS,
    entrada: z.object({ de: idPositivo, para: idPositivo }),
    gravar: corpo(async (tx, en, est) => {
      const rs = await vivasDaMarcacao(tx, est, en.de, ['agendada', 'aguardando']);
      if (!rs.length) return { movidas: 0 };
      const m = await marcacaoDaAgenda(tx, est, en.para);
      if (!m)
        throw new ErroTelemedicina('nao-encontrado', 'A nova marcação não existe neste estabelecimento.');
      if (!m.valida) throw new ErroTelemedicina('situacao', 'A nova marcação está cancelada ou com falta.');
      if ((await vivasDaMarcacao(tx, est, en.para, [...VIVAS, 'encerrada'])).length)
        throw new ErroTelemedicina('situacao', 'A nova marcação já tem teleconsulta.');
      for (const r of rs) {
        if (m.paciente !== Number(r['paciente_id']))
          throw new ErroTelemedicina(
            'situacao',
            'A nova marcação é de outro paciente: a teleconsulta não foi movida.',
          );
        await alterar(tx, r, {
          marcacao_horario_id: en.para,
          agendada_para: m.inicio,
          profissional_id: m.profissional ?? Number(r['profissional_id']),
          situacao: 'agendada',
          termo_versao: null,
          termo_aceito_em: null,
          local_paciente_tipo: null,
          local_paciente_unidade_federativa_id: null,
        });
        // A sala de espera recomeça na nova marcação: o paciente aceita o termo de novo.
        const ps = await tx.consultarParaAtualizar(
          `SELECT id, versao FROM ${PARTICIPANTE} WHERE teleconsulta_id = ? AND papel = 'paciente' AND excluido_em IS NULL`,
          [Number(r['id'])],
        );
        for (const p of ps)
          await tx.alterar(PARTICIPANTE, Number(p['id']), Number(p['versao']), {
            excluido_em: new Date(),
            excluido_por: tx.contexto.usuario,
          });
      }
      return { movidas: rs.length };
    }),
    eventos: (e, r) =>
      r.movidas > 0 ? evento('telemedicina.teleconsulta_remarcada', { de: e.de, para: e.para }) : [],
    alvo: () => ({ tabela: TABELA, id: null }),
  }),
  solicitarInterconsulta: operacao<{ id: number }>()({
    nome: 'telemedicina.solicitar_interconsulta',
    tabelas: TABELAS,
    entrada: z.object({
      atendimento: idPositivo,
      paciente: idPositivo,
      data: dataZ,
      hora: horaZ,
      convidado: idPositivo,
      motivo: z.string().trim().min(1).max(4000),
      vinculoSolicitante: idPositivo,
    }),
    gravar: corpo(async (tx, en, est) => {
      const id = await tx.incluir(TABELA, {
        estabelecimento_id: est,
        modalidade: 'teleinterconsulta',
        atendimento_id: en.atendimento,
        paciente_id: en.paciente,
        profissional_id: en.convidado,
        solicitante_profissional_id: en.vinculoSolicitante,
        situacao: 'solicitada',
        agendada_para: instanteNoFuso(await fusoDe(tx, est), en.data, en.hora),
        pergunta: en.motivo,
      });
      return { id };
    }),
    eventos: (e, r) =>
      evento('telemedicina.teleinterconsulta_solicitada', {
        teleconsulta: r.id,
        atendimento: e.atendimento,
        convidado: e.convidado,
      }),
    alvo: (_e, r) => ({ tabela: TABELA, id: r.id }),
  }),
  abrirSalaInterconsulta: operacao<{ versao: number }>()({
    nome: 'telemedicina.abrir_sala_interconsulta',
    tabelas: TABELAS,
    entrada: z.object({
      id: idPositivo,
      versao: versaoZ,
      provedor: provedorZ,
      sala: z.string().min(1).max(128),
    }),
    gravar: corpo(async (tx, en, est) => {
      const r = await travar(
        tx,
        est,
        en.id,
        en.versao,
        'sala da teleinterconsulta',
        (x) => x['modalidade'] === 'teleinterconsulta' && naSituacao(x, 'solicitada'),
      );
      const versao = await alterar(tx, r, {
        situacao: 'sala_aberta',
        provedor_video: en.provedor,
        identificador_sala: en.sala,
        sala_aberta_em: new Date(),
      });
      return { versao };
    }),
    alvo: (e) => ({ tabela: TABELA, id: e.id }),
  }),
  responderInterconsulta: operacao<{ versao: number }>()({
    nome: 'telemedicina.responder_interconsulta',
    tabelas: TABELAS,
    entrada: z.object({
      id: idPositivo,
      versao: versaoZ,
      parecer: z.string().trim().min(1).max(60000),
      vinculo: idPositivo,
    }),
    gravar: corpo(async (tx, en, est) => {
      const r = await travar(
        tx,
        est,
        en.id,
        en.versao,
        'parecer',
        (x) =>
          x['modalidade'] === 'teleinterconsulta' &&
          naSituacao(x, 'solicitada', 'sala_aberta') &&
          Number(x['profissional_id']) === en.vinculo,
      );
      const versao = await alterar(tx, r, {
        situacao: 'respondida',
        parecer: en.parecer,
        respondida_em: new Date(),
      });
      return { versao };
    }),
    eventos: (e) => evento('telemedicina.teleinterconsulta_respondida', { teleconsulta: e.id }),
    alvo: (e) => ({ tabela: TABELA, id: e.id }),
  }),
  cancelarInterconsulta: operacao<{ versao: number }>()({
    nome: 'telemedicina.cancelar_interconsulta',
    tabelas: TABELAS,
    entrada: z.object({
      id: idPositivo,
      versao: versaoZ,
      motivo: z.string().trim().min(1).max(200),
      por: z.string().min(1).max(60),
    }),
    gravar: corpo(async (tx, en, est) => {
      const r = await travar(
        tx,
        est,
        en.id,
        en.versao,
        'cancelamento',
        (x) => x['modalidade'] === 'teleinterconsulta' && naSituacao(x, 'solicitada', 'sala_aberta'),
      );
      const quem = await tx.uma<{ login: string }>('SELECT login FROM usuario WHERE id = ?', [
        r['criado_por'] ?? 0,
      ]);
      if (!quem || quem.login !== en.por) throw versaoVelha('cancelamento');
      const versao = await alterar(tx, r, {
        situacao: 'cancelada',
        cancelada_em: new Date(),
        motivo_cancelamento: en.motivo,
      });
      return { versao };
    }),
    alvo: (e) => ({ tabela: TABELA, id: e.id }),
  }),
} as const;

type Rodar = <E, S extends ResultadoOperacao>(op: Operacao<E, S>, entrada: E) => Promise<S>;

/** O gravador da porta: cada método é uma operação declarada; os campos só da tela (por, nomes) ficam de fora. */
function gravadorDe(rodar: Rodar): GravadorTelemedicina {
  const O = OPERACOES_TELEMEDICINA;
  return {
    agendar: async (t) =>
      rodar(O.agendar, {
        marcacao: t.marcacao,
        profissional: t.profissional,
        data: t.data,
        hora: t.hora,
        paciente: t.paciente,
      }),
    entrarSalaEspera: async (id, versao, d) =>
      rodar(O.entrarSalaEspera, { id, versao, termo: d.termo, uf: d.local.uf, tipo: d.local.tipo }),
    registrarEntradaPaciente: async (id) => (await rodar(O.registrarEntradaPaciente, { id })).registrada,
    abrirSala: async (id, versao, d) =>
      rodar(O.abrirSala, {
        id,
        versao,
        provedor: d.provedor,
        sala: d.sala,
        declaracao: d.declaracao,
        vinculo: d.vinculo,
        cienteAlerta: d.cienteAlerta,
      }),
    vincularAtendimento: async (d) =>
      (
        await rodar(O.vincularAtendimento, {
          id: d.id,
          atendimento: d.atendimento,
          profissional: d.profissional,
        })
      ).ligada,
    encerrar: async (id, versao, d) =>
      rodar(O.encerrar, { id, versao, motivo: d.motivo, vinculo: d.vinculo }),
    cancelarDaMarcacao: async (marcacao) => (await rodar(O.cancelarDaMarcacao, { marcacao })).canceladas,
    mover: async (d) => (await rodar(O.mover, { de: d.de, para: d.para })).movidas,
    solicitarInterconsulta: async (t) =>
      rodar(O.solicitarInterconsulta, {
        atendimento: t.atendimento,
        paciente: t.paciente,
        data: t.data,
        hora: t.hora,
        convidado: t.convidado,
        motivo: t.motivo.slice(0, 4000),
        vinculoSolicitante: t.vinculoSolicitante,
      }),
    abrirSalaInterconsulta: async (id, versao, d) =>
      rodar(O.abrirSalaInterconsulta, { id, versao, provedor: d.provedor, sala: d.sala }),
    responderInterconsulta: async (id, versao, d) =>
      rodar(O.responderInterconsulta, { id, versao, parecer: d.parecer, vinculo: d.vinculo }),
    cancelarInterconsulta: async (id, versao, d) =>
      rodar(O.cancelarInterconsulta, { id, versao, motivo: d.motivo.slice(0, 200), por: d.por }),
  };
}

export function portaTelemedicinaIndisponivel(): PortaTelemedicina {
  return portaIndisponivel<PortaTelemedicina>(METODOS_PORTA_TELEMEDICINA);
}
