// Porta PRÓPRIA da etapa 2 do portal (M50): configuração da agenda online, pré-check-in, intenção de pagamento,
// conciliação da tesouraria e pesquisa de satisfação, sobre o MariaDB do cliente, pelo @sgh/nucleo.
//   - Leitura: `nucleo.lerSomente`. Gravação: o Executor (`definirOperacao`), com a trilha, o outbox e a idempotência
//     na mesma transação; o fato do serviço (RegistroTrilhaPortal) vai no motivo e nos dados da trilha, e o alvo é a
//     linha que a transação gravou de fato.
//   - Tabelas: agenda_online_configuracao (+ _convenio, _servico) por agenda_servico; pre_checkin (+ _documento, com o
//     arquivo); intencao_pagamento_portal; conciliacao_pagamento_portal; resposta_pesquisa_satisfacao (canal portal).
//   - O tipo (consulta ou exame) da marcação sai da natureza da categoria da agenda; a data e a hora, do horário no
//     fuso do estabelecimento; o nome da agenda e o CRM, da agenda_servico (nunca do que a tela manda).
//   - Situações do pré-check-in: enviado = `concluido` no banco; conferido, recusado e cancelado iguais.
//   - A confirmação do pagamento (porta-propria-pagamento.ts) dá a baixa num recebimento particular avulso no caixa
//     de código PORTAL, na forma de recebimento ativa do meio; faltando o caixa ou a forma, recusa com 503
//     `catalogo-incompleto` e nada é gravado.
// Melhoria: o nome da agenda, o CRM, a data e a hora do pré-check-in são relidos da marcação (fonte única).
// Melhoria: a reserva da conferência vence no banco (reservado_em) e o conferente é o usuário do hospital (FK).
import { randomUUID } from 'node:crypto';
import {
  type ContextoOperacao,
  definirOperacao,
  ErroOperacao,
  type Executor,
  type Leitor,
  type Linha,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';
import { localDe } from '../../agenda/porta-propria.js';
import { indisponivel, type NucleoPortal } from '../porta-propria.js';
import { ErroPortal, type RegistroTrilhaPortal } from '../tipos.js';
import {
  type ContextoAgendaOnline,
  type GravadorAgendaOnline,
  METODOS_PORTA_AGENDA_ONLINE,
  type PortaAgendaOnline,
  type TrilhaAgendaOnline,
} from './porta.js';
import {
  type ConciliacaoPortal,
  type ConfigAgendaOnline,
  conferirConciliacaoPortal,
  type DocumentoPreCheckin,
  type FiltroPreCheckins,
  MINUTOS_RESERVA_CONFERENCIA,
  OPERADOR_CAIXA_PORTAL,
  type PagamentoPortal,
  type PagamentoTesourariaPortal,
  type PesquisaPortal,
  type PreCheckinOnline,
  type SituacaoPagamentoPortal,
  type SituacaoPreCheckin,
  type TipoAgendaOnline,
} from './tipos.js';
import { confirmarPagamentoProprio, TABELAS_CONFIRMACAO_PAGAMENTO } from './porta-propria-pagamento.js';

/** Tabelas que a gravação da etapa 2 pode tocar (o executor recusa as outras). */
export const TABELAS_AGENDA_ONLINE = [
  'agenda_online_configuracao',
  'agenda_online_convenio',
  'agenda_online_servico',
  'pre_checkin',
  'pre_checkin_documento',
  'arquivo',
  'intencao_pagamento_portal',
  'conciliacao_pagamento_portal',
  'resposta_pesquisa_satisfacao',
  ...TABELAS_CONFIRMACAO_PAGAMENTO,
] as const;

const TETO_FILA = 50;
const TETO_PACIENTE = 100;
const TETO_TESOURARIA = 500;
const FUSO_PADRAO = 'America/Sao_Paulo';

/** Situação do pré-check-in: a do portal e a do banco. */
const SITUACAO_PRE_BANCO: Record<SituacaoPreCheckin, string> = {
  enviado: 'concluido',
  conferido: 'conferido',
  recusado: 'recusado',
  cancelado: 'cancelado',
};
const SITUACAO_PRE_PORTAL: Record<string, SituacaoPreCheckin> = {
  concluido: 'enviado',
  conferido: 'conferido',
  recusado: 'recusado',
  cancelado: 'cancelado',
};
/** Tipo do documento do pré-check-in: o do portal e o do banco. */
const DOC_BANCO: Record<string, string> = {
  identidade: 'documento_identidade',
  carteirinha: 'carteira_convenio',
  'pedido-medico': 'pedido_medico',
};
const DOC_PORTAL: Record<string, string> = Object.fromEntries(
  Object.entries(DOC_BANCO).map(([a, b]) => [b, a]),
);

const num = (v: unknown): number => Number(v);
const numOuNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const bool = (v: unknown): boolean => v === true || Number(v) === 1;
const texto = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
function dataIso(v: unknown): string {
  if (v instanceof Date) {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`;
  }
  return String(v ?? '').slice(0, 10);
}
const instante = (v: unknown): Date => (v instanceof Date ? v : new Date(String(v)));
/** O carimbo como a porta de memória o devolve (ISO sem o fuso, milissegundos). */
const carimbo = (v: unknown): string | null =>
  v === null || v === undefined ? null : instante(v).toISOString().slice(0, 23);
function json<T>(v: unknown, padrao: T): T {
  if (v === null || v === undefined || v === '') return padrao;
  if (typeof v === 'object') return v as T;
  try {
    return JSON.parse(String(v)) as T;
  } catch {
    return padrao;
  }
}
const crmDe = (v: unknown): number => {
  const n = Number(String(v ?? '').replace(/\D/g, ''));
  return Number.isFinite(n) ? n : 0;
};
const versaoVelha = () =>
  new ErroPortal('versao-desatualizada', 'O registro foi alterado por outra pessoa; recarregue.');

const SQL_CRM = `(SELECT ic.numero_inscricao FROM inscricao_conselho ic
    WHERE ic.profissional_id = a.profissional_id AND ic.excluido_em IS NULL ORDER BY ic.sequencia LIMIT 1)`;

const SQL_CONFIG = `SELECT c.id, c.tipo, c.agenda_servico_id, c.ativa, c.antecedencia_horas, c.horizonte_dias,
    c.cancela_ate_horas, c.pre_checkin, c.valor_particular, c.teleconsulta, c.criado_em, c.alterado_em, c.versao,
    a.nome AS nome_agenda, ${SQL_CRM} AS crm, COALESCE(ua.login, uc.login) AS alterado_login,
    (SELECT GROUP_CONCAT(x.fonte_pagadora_id ORDER BY x.fonte_pagadora_id) FROM agenda_online_convenio x
      WHERE x.agenda_online_configuracao_id = c.id) AS convenios,
    (SELECT GROUP_CONCAT(COALESCE(x.especialidade_medica_id, x.exame_id) ORDER BY COALESCE(x.especialidade_medica_id, x.exame_id))
       FROM agenda_online_servico x WHERE x.agenda_online_configuracao_id = c.id) AS servicos
  FROM agenda_online_configuracao c JOIN agenda_servico a ON a.id = c.agenda_servico_id
  LEFT JOIN usuario ua ON ua.id = c.alterado_por LEFT JOIN usuario uc ON uc.id = c.criado_por
 WHERE c.estabelecimento_id = ? AND c.excluido_em IS NULL`;

const lista = (v: unknown): number[] =>
  v === null || v === undefined || v === '' ? [] : String(v).split(',').map(Number);

function configDaLinha(x: Linha): ConfigAgendaOnline {
  return {
    id: num(x['id']),
    tipo: String(x['tipo']) as TipoAgendaOnline,
    agenda: num(x['agenda_servico_id']),
    nomeAgenda: String(x['nome_agenda']),
    crm: crmDe(x['crm']),
    ativa: bool(x['ativa']),
    convenios: lista(x['convenios']),
    servicos: lista(x['servicos']),
    antecedenciaHoras: num(x['antecedencia_horas']),
    horizonteDias: num(x['horizonte_dias']),
    cancelaAteHoras: num(x['cancela_ate_horas']),
    precheckin: bool(x['pre_checkin']),
    valorParticular: numOuNull(x['valor_particular']),
    teleconsulta: bool(x['teleconsulta']),
    alteradoPor: String(x['alterado_login'] ?? ''),
    alteradoEm: carimbo(x['alterado_em'] ?? x['criado_em']),
    versao: num(x['versao']),
  };
}

/** A marcação com o tipo (natureza da categoria), a agenda, o CRM e o horário. */
const SQL_MARCACAO = `JOIN marcacao_horario m ON m.id = X.marcacao_horario_id
  JOIN horario_agenda h ON h.id = m.horario_agenda_id JOIN agenda_servico a ON a.id = h.agenda_servico_id
  JOIN categoria_agenda ca ON ca.id = a.categoria_agenda_id`;
const tipoDaNatureza = (v: unknown): TipoAgendaOnline => (String(v) === 'exame' ? 'exame' : 'consulta');

const SQL_PRE = `SELECT pc.*, ca.natureza, a.nome AS nome_agenda, ${SQL_CRM} AS crm, h.inicio_em, h.data_referencia,
    ur.login AS reservado_login, uf.login AS conferido_login,
    (pc.reservado_em IS NOT NULL AND pc.reservado_em >= UTC_TIMESTAMP(3) - INTERVAL ${MINUTOS_RESERVA_CONFERENCIA} MINUTE) AS reserva_vale
  FROM pre_checkin pc ${SQL_MARCACAO.replace('X.', 'pc.')}
  LEFT JOIN usuario ur ON ur.id = pc.reservado_por_usuario_id LEFT JOIN usuario uf ON uf.id = pc.conferido_usuario_id
 WHERE pc.estabelecimento_id = ? AND pc.excluido_em IS NULL AND pc.canal = 'portal'
   AND pc.conta_portal_paciente_id IS NOT NULL`;

export const SQL_PAGAMENTO = `SELECT p.*, ca.natureza FROM intencao_pagamento_portal p
  LEFT JOIN marcacao_horario m ON m.id = p.marcacao_horario_id LEFT JOIN horario_agenda h ON h.id = m.horario_agenda_id
  LEFT JOIN agenda_servico a ON a.id = h.agenda_servico_id LEFT JOIN categoria_agenda ca ON ca.id = a.categoria_agenda_id
 WHERE p.estabelecimento_id = ? AND p.excluido_em IS NULL`;

export function pagamentoDaLinha(x: Linha): PagamentoPortal {
  return {
    id: num(x['id']),
    conta: num(x['conta_portal_paciente_id']),
    paciente: num(x['paciente_id']),
    tipo: tipoDaNatureza(x['natureza']),
    marcacao: num(x['marcacao_horario_id'] ?? 0),
    valor: num(x['valor']),
    forma: String(x['forma']) === 'cartao_credito' ? 'cartao-credito' : 'pix',
    conector: String(x['conector']) === 'gateway' ? 'gateway' : 'simulado',
    transacao: String(x['transacao']),
    situacao: String(x['situacao']) as SituacaoPagamentoPortal,
    expiraEm: instante(x['expira_em']),
    pagamentoCaixa: numOuNull(x['recebimento_particular_id']),
    criadoEm: carimbo(x['criado_em']),
    confirmadoEm: carimbo(x['confirmado_em']),
    confirmadoPor: texto(x['confirmado_por']),
    pixCopiaECola: texto(x['pix_copia_e_cola']),
    enderecoCartao: texto(x['endereco_cartao']),
    versao: num(x['versao']),
  };
}

function conciliacaoDaLinha(x: Linha): ConciliacaoPortal {
  return {
    id: num(x['id']),
    pagamento: num(x['intencao_pagamento_portal_id']),
    acao: String(x['acao']) as ConciliacaoPortal['acao'],
    valor: num(x['valor']),
    referencia: texto(x['referencia']),
    motivo: texto(x['motivo']),
    usuario: String(x['login'] ?? ''),
    em: carimbo(x['criado_em']),
  };
}
const SQL_CONCILIACOES = (ids: readonly number[]) =>
  `SELECT k.*, u.login FROM conciliacao_pagamento_portal k LEFT JOIN usuario u ON u.id = k.usuario_id
    WHERE k.intencao_pagamento_portal_id IN (${ids.map(() => '?').join(', ')}) ORDER BY k.id`;

const entradaGravacao = z.object({ correlacao: z.string().min(1).max(64) }).strict();

export class PortaAgendaOnlinePropria implements PortaAgendaOnline {
  readonly destino = 'banco' as const;
  private readonly executor: Executor;
  private readonly estabelecimentos = new Map<string, { id: number; fuso: string }>();

  constructor(
    private readonly nucleo: NucleoPortal,
    executor?: Executor,
  ) {
    this.executor = executor ?? nucleo.criarExecutor();
  }

  private ler<T>(c: ContextoAgendaOnline, fn: (l: Leitor) => Promise<T>): Promise<T> {
    return this.nucleo.lerSomente({ cliente: c.rede, correlacao: 'portal-agenda-online' }, fn);
  }

  /** O id e o fuso do estabelecimento pelo código da sessão (inexistente: 404). */
  private async estab(c: ContextoAgendaOnline): Promise<{ id: number; fuso: string }> {
    const chave = `${c.rede}:${c.hospital}`;
    const g = this.estabelecimentos.get(chave);
    if (g) return g;
    const l = await this.ler(c, (x) =>
      x.uma('SELECT id, fuso_horario FROM estabelecimento WHERE codigo = ? AND excluido_em IS NULL', [
        c.hospital,
      ]),
    );
    if (!l)
      throw new ErroOperacao(
        404,
        'estabelecimento-inexistente',
        'Estabelecimento inexistente',
        'O estabelecimento da sessão não existe neste cliente.',
      );
    const e = { id: num(l['id']), fuso: String(l['fuso_horario'] || FUSO_PADRAO) };
    this.estabelecimentos.set(chave, e);
    return e;
  }

  private async idDoLogin(c: ContextoAgendaOnline, login: string | null | undefined): Promise<number | null> {
    if (!login) return null;
    const l = await this.ler(c, (x) =>
      x.uma('SELECT id FROM usuario WHERE login = ? AND excluido_em IS NULL', [login]),
    );
    return l ? num(l['id']) : null;
  }

  async gravar<T>(
    c: ContextoAgendaOnline,
    fn: (g: GravadorAgendaOnline) => Promise<T>,
    trilha: TrilhaAgendaOnline<T>,
  ): Promise<T> {
    const { id: estabelecimento } = await this.estab(c);
    const correlacao = `portal-ao-${randomUUID()}`.slice(0, 64);
    // O autor da operação é o usuário do hospital do registro da trilha (o serviço manda o login de quem age): vai no
    // carimbo das linhas (criado_por/alterado_por) e em trilha_auditoria.usuario_id. Login que não é de usuário (conta
    // do portal, gateway) deixa a operação sem usuário, como processo do portal.
    const autor = trilha && typeof trilha !== 'function' ? await this.idDoLogin(c, trilha.usuario) : null;
    const contexto: ContextoOperacao = {
      cliente: c.rede,
      estabelecimento,
      usuario: autor,
      correlacao,
      chaveIdempotencia: correlacao,
    };
    let resultado!: T;
    let recusa: ErroPortal | null = null;
    let registro: RegistroTrilhaPortal | null = null;
    const escrita: { tabela: string; id: number | null } = { tabela: 'agenda_online_configuracao', id: null };
    const op = definirOperacao<{ correlacao: string }, { gravado: boolean }>({
      nome: 'portal-paciente.agenda-online.gravar',
      tabelas: [...TABELAS_AGENDA_ONLINE],
      entrada: entradaGravacao,
      gravar: async (tx) => {
        try {
          resultado = await fn(gravadorAgendaOnline(tx, estabelecimento, escrita, autor));
        } catch (e) {
          // A recusa de domínio (versão, situação, inexistente) sai como o serviço a espera, não como erro interno.
          if (e instanceof ErroPortal) recusa = e;
          throw e;
        }
        registro = typeof trilha === 'function' ? trilha(resultado) : trilha;
        return { gravado: true };
      },
      alvo: () => ({ tabela: escrita.tabela, id: escrita.id }),
      trilha: () => {
        const r = registro as RegistroTrilhaPortal | null;
        if (!r) return {};
        return {
          motivo: r.evento,
          dados: {
            evento: r.evento,
            recurso: r.recurso,
            operacao: r.operacao,
            resultado: r.resultado,
            chave: r.chaveNaturalAlvo,
            paciente: r.idPaciente ?? null,
            origem: r.origem ?? null,
            estacao: r.estacao,
            usuario: r.usuario,
            atendimento: r.atendimento ?? null,
            correlacao: r.correlacao,
          },
        };
      },
    });
    try {
      await this.executor.executar(op, c.rede, { correlacao }, contexto);
    } catch (e) {
      throw recusa ?? e;
    }
    return resultado;
  }

  // ---------------------------------------------------------------- configuração

  async configs(c: ContextoAgendaOnline): Promise<ConfigAgendaOnline[]> {
    const { id } = await this.estab(c);
    const ls = await this.ler(c, (l) => l.consultar(`${SQL_CONFIG} ORDER BY c.id`, [id]));
    return ls.map(configDaLinha);
  }

  async config(
    c: ContextoAgendaOnline,
    tipo: TipoAgendaOnline,
    agenda: number,
  ): Promise<ConfigAgendaOnline | null> {
    const { id } = await this.estab(c);
    const l = await this.ler(c, (x) =>
      x.uma(`${SQL_CONFIG} AND c.tipo = ? AND c.agenda_servico_id = ?`, [id, tipo, agenda]),
    );
    return l ? configDaLinha(l) : null;
  }

  // ---------------------------------------------------------------- pré-check-in

  private async preCheckins(
    c: ContextoAgendaOnline,
    filtro: string,
    p: unknown[],
  ): Promise<PreCheckinOnline[]> {
    const { id, fuso } = await this.estab(c);
    return this.ler(c, async (l) => {
      const ls = await l.consultar(`${SQL_PRE} ${filtro}`, [id, ...p]);
      if (ls.length === 0) return [];
      const ids = ls.map((x) => num(x['id']));
      const docs = await l.consultar(
        `SELECT d.pre_checkin_id, d.tipo, d.resumo_conteudo, d.tipo_midia, a.chave_armazenamento
           FROM pre_checkin_documento d JOIN arquivo a ON a.id = d.arquivo_id
          WHERE d.excluido_em IS NULL AND d.pre_checkin_id IN (${ids.map(() => '?').join(', ')}) ORDER BY d.id`,
        ids,
      );
      return ls.map((x) => preDaLinha(x, fuso, docs));
    });
  }

  async preCheckinDaMarcacao(
    c: ContextoAgendaOnline,
    tipo: TipoAgendaOnline,
    marcacao: number,
  ): Promise<PreCheckinOnline | null> {
    const r = await this.preCheckins(c, 'AND pc.marcacao_horario_id = ?', [marcacao]);
    return r.find((k) => k.tipo === tipo) ?? null;
  }

  async preCheckinPorId(c: ContextoAgendaOnline, id: number): Promise<PreCheckinOnline | null> {
    return (await this.preCheckins(c, 'AND pc.id = ?', [id]))[0] ?? null;
  }

  async preCheckinsDoPaciente(c: ContextoAgendaOnline, paciente: number): Promise<PreCheckinOnline[]> {
    return this.preCheckins(c, `AND pc.paciente_id = ? ORDER BY pc.id DESC LIMIT ${TETO_PACIENTE}`, [
      paciente,
    ]);
  }

  async filaPreCheckin(
    c: ContextoAgendaOnline,
    f: FiltroPreCheckins,
  ): Promise<{ itens: PreCheckinOnline[]; haMais: boolean }> {
    if (f.pacientes && f.pacientes.length === 0) return { itens: [], haMais: false };
    const p: unknown[] = [SITUACAO_PRE_BANCO[f.situacao], f.de, f.ate, f.depoisDe ?? 0];
    let filtro = 'AND pc.situacao = ? AND h.data_referencia BETWEEN ? AND ? AND pc.id > ?';
    if (f.pacientes) {
      filtro += ` AND pc.paciente_id IN (${f.pacientes.map(() => '?').join(', ')})`;
      p.push(...f.pacientes);
    }
    const r = await this.preCheckins(c, `${filtro} ORDER BY pc.id LIMIT ${TETO_FILA + 1}`, p);
    return { itens: r.slice(0, TETO_FILA), haMais: r.length > TETO_FILA };
  }

  // ---------------------------------------------------------------- pagamento e tesouraria

  async pagamentoPorTransacao(c: ContextoAgendaOnline, transacao: string): Promise<PagamentoPortal | null> {
    const { id } = await this.estab(c);
    const l = await this.ler(c, (x) => x.uma(`${SQL_PAGAMENTO} AND p.transacao = ?`, [id, transacao]));
    return l ? pagamentoDaLinha(l) : null;
  }

  async pagamentoPorId(c: ContextoAgendaOnline, pagamento: number): Promise<PagamentoPortal | null> {
    const { id } = await this.estab(c);
    const l = await this.ler(c, (x) => x.uma(`${SQL_PAGAMENTO} AND p.id = ?`, [id, pagamento]));
    return l ? pagamentoDaLinha(l) : null;
  }

  async pagamentosDoPaciente(c: ContextoAgendaOnline, paciente: number): Promise<PagamentoPortal[]> {
    const { id } = await this.estab(c);
    const ls = await this.ler(c, (x) =>
      x.consultar(`${SQL_PAGAMENTO} AND p.paciente_id = ? ORDER BY p.id DESC LIMIT ${TETO_PACIENTE}`, [
        id,
        paciente,
      ]),
    );
    return ls.map(pagamentoDaLinha);
  }

  private async tesourariaDe(c: ContextoAgendaOnline, filtro: string, p: unknown[]) {
    const { id } = await this.estab(c);
    return this.ler(c, async (l) => {
      const ls = await l.consultar(`${SQL_PAGAMENTO} ${filtro}`, [id, ...p]);
      if (ls.length === 0) return [];
      const ids = ls.map((x) => num(x['id']));
      const atos = (await l.consultar(SQL_CONCILIACOES(ids), ids)).map(conciliacaoDaLinha);
      return ls.map((x): PagamentoTesourariaPortal => ({
        pagamento: pagamentoDaLinha(x),
        cobradoPor: x['recebimento_particular_id'] ? OPERADOR_CAIXA_PORTAL : null,
        atos: atos.filter((a) => a.pagamento === num(x['id'])),
      }));
    });
  }

  async tesouraria(c: ContextoAgendaOnline, de: string, ate: string): Promise<PagamentoTesourariaPortal[]> {
    return this.tesourariaDe(
      c,
      `AND p.situacao IN ('confirmado', 'duplicado') AND p.confirmado_em >= ? AND p.confirmado_em < ? + INTERVAL 1 DAY
       ORDER BY p.id LIMIT ${TETO_TESOURARIA}`,
      [de, ate],
    );
  }

  async pagamentoTesouraria(c: ContextoAgendaOnline, id: number): Promise<PagamentoTesourariaPortal | null> {
    return (await this.tesourariaDe(c, 'AND p.id = ?', [id]))[0] ?? null;
  }

  // ---------------------------------------------------------------- pesquisa

  async pesquisasDoPaciente(c: ContextoAgendaOnline, paciente: number): Promise<PesquisaPortal[]> {
    const { id } = await this.estab(c);
    const ls = await this.ler(c, (l) =>
      l.consultar(
        `SELECT r.id, r.marcacao_horario_id, r.nota_recomendacao, r.comentario, r.respondida_em, ca.natureza,
                a.nome AS nome_agenda, h.data_referencia
           FROM resposta_pesquisa_satisfacao r ${SQL_MARCACAO.replace('X.', 'r.')}
          WHERE r.estabelecimento_id = ? AND r.paciente_id = ? AND r.canal = 'portal' AND r.excluido_em IS NULL
          ORDER BY r.id DESC LIMIT ${TETO_PACIENTE}`,
        [id, paciente],
      ),
    );
    return ls.map((x) => ({
      id: num(x['id']),
      tipo: tipoDaNatureza(x['natureza']),
      marcacao: num(x['marcacao_horario_id']),
      nomeAgenda: String(x['nome_agenda']),
      dataAtendimento: dataIso(x['data_referencia']),
      nota: num(x['nota_recomendacao']),
      comentario: texto(x['comentario']),
      respondidaEm: carimbo(x['respondida_em']),
    }));
  }
}

function preDaLinha(x: Linha, fuso: string, docs: readonly Linha[]): PreCheckinOnline {
  const id = num(x['id']);
  const vale = bool(x['reserva_vale']) && String(x['situacao']) === 'concluido';
  return {
    id,
    tipo: tipoDaNatureza(x['natureza']),
    marcacao: num(x['marcacao_horario_id']),
    nomeAgenda: String(x['nome_agenda']),
    crm: crmDe(x['crm']),
    data: dataIso(x['data_referencia']),
    hora: localDe(fuso, instante(x['inicio_em'])).hora,
    paciente: num(x['paciente_id']),
    conta: num(x['conta_portal_paciente_id']),
    dados: json<Record<string, unknown>>(x['dados_propostos'], {}),
    documentos: docs
      .filter((d) => num(d['pre_checkin_id']) === id)
      .map((d): DocumentoPreCheckin => ({
        tipo: DOC_PORTAL[String(d['tipo'])] ?? String(d['tipo']),
        chave: String(d['chave_armazenamento']),
        sha256: String(d['resumo_conteudo']),
        mime: String(d['tipo_midia']),
      })),
    carteirinha: texto(x['numero_carteira']),
    carteirinhaValidade: x['validade_carteira'] ? dataIso(x['validade_carteira']) : null,
    termos: String(x['termos_versao'] ?? ''),
    situacao: SITUACAO_PRE_PORTAL[String(x['situacao'])] ?? 'enviado',
    motivoRecusa: texto(x['motivo_recusa']),
    enviadoEm: carimbo(x['concluido_em']),
    conferidoPor: texto(x['conferido_login']),
    conferidoEm: carimbo(x['conferido_em']),
    reservadoPor: vale ? texto(x['reservado_login']) : null,
    camposGravados: json<string[]>(x['campos_gravados'], []),
    versao: num(x['versao']),
  };
}

// ---------------------------------------------------------------- gravações

async function usuarioDoLogin(tx: TxOperacao, login: string): Promise<number> {
  const l = await tx.uma('SELECT id FROM usuario WHERE login = ? AND excluido_em IS NULL', [login]);
  if (!l) throw new ErroPortal('nao-encontrado', `Usuário ${login} inexistente neste cliente.`);
  return num(l['id']);
}

/** A marcação do estabelecimento com o tipo pela natureza da agenda (outro tipo ou outro estabelecimento: null). */
async function marcacaoDoTipo(
  tx: TxOperacao,
  estabelecimento: number,
  tipo: TipoAgendaOnline,
  marcacao: number,
): Promise<boolean> {
  const l = await tx.uma(
    `SELECT ca.natureza FROM marcacao_horario m JOIN horario_agenda h ON h.id = m.horario_agenda_id
       JOIN agenda_servico a ON a.id = h.agenda_servico_id JOIN categoria_agenda ca ON ca.id = a.categoria_agenda_id
      WHERE m.id = ? AND m.estabelecimento_id = ? AND m.excluido_em IS NULL`,
    [marcacao, estabelecimento],
  );
  return l !== null && tipoDaNatureza(l['natureza']) === tipo;
}

const reservaVale = (x: Linha): boolean =>
  x['reservado_em'] !== null &&
  x['reservado_em'] !== undefined &&
  instante(x['reservado_em']).getTime() >= Date.now() - MINUTOS_RESERVA_CONFERENCIA * 60_000;

function gravadorAgendaOnline(
  tx: TxOperacao,
  estabelecimento: number,
  escrita: { tabela: string; id: number | null },
  autor: number | null,
): GravadorAgendaOnline {
  const marcar = (tabela: string, id: number) => {
    escrita.tabela = tabela;
    escrita.id = id;
  };
  const travarPre = async (id: number) =>
    (
      await tx.consultarParaAtualizar(
        'SELECT * FROM pre_checkin WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [id, estabelecimento],
      )
    )[0] ?? null;

  return {
    async gravarConfig(x) {
      const agenda = await tx.uma(
        'SELECT id FROM agenda_servico WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [x.agenda, estabelecimento],
      );
      if (!agenda) throw new ErroPortal('nao-encontrado', 'Agenda inexistente neste estabelecimento.');
      const [atual] = await tx.consultarParaAtualizar(
        `SELECT id, versao FROM agenda_online_configuracao
          WHERE estabelecimento_id = ? AND tipo = ? AND agenda_servico_id = ? AND excluido_em IS NULL`,
        [estabelecimento, x.tipo, x.agenda],
      );
      const valores = {
        ativa: x.ativa,
        antecedencia_horas: x.antecedenciaHoras,
        horizonte_dias: x.horizonteDias,
        cancela_ate_horas: x.cancelaAteHoras,
        pre_checkin: x.precheckin,
        valor_particular: x.valorParticular,
        teleconsulta: x.teleconsulta === true,
      };
      let id: number;
      let versao: number;
      if (x.versao === null) {
        if (atual) throw versaoVelha();
        id = await tx.incluir('agenda_online_configuracao', {
          estabelecimento_id: estabelecimento,
          tipo: x.tipo,
          agenda_servico_id: x.agenda,
          ...valores,
        });
        versao = 1;
      } else {
        if (!atual || num(atual['versao']) !== x.versao) throw versaoVelha();
        id = num(atual['id']);
        versao = await tx.alterar('agenda_online_configuracao', id, x.versao, valores);
      }
      // As listas são a configuração vigente: o que saiu é removido, o que entrou é incluído.
      const convenios = [...new Set(x.convenios)];
      const servicos = [...new Set(x.servicos)];
      const coluna = x.tipo === 'exame' ? 'exame_id' : 'especialidade_medica_id';
      const fora = (col: string, ids: number[]) =>
        ids.length ? ` AND ${col} NOT IN (${ids.map(() => '?').join(', ')})` : '';
      await tx.executar(
        `DELETE FROM agenda_online_convenio WHERE agenda_online_configuracao_id = ?${fora('fonte_pagadora_id', convenios)}`,
        [id, ...convenios],
      );
      await tx.executar(
        `DELETE FROM agenda_online_servico WHERE agenda_online_configuracao_id = ?
           AND (${coluna} IS NULL${servicos.length ? ` OR ${coluna} NOT IN (${servicos.map(() => '?').join(', ')})` : ' OR TRUE'})`,
        [id, ...servicos],
      );
      const temConv = new Set(
        (
          await tx.consultar(
            'SELECT fonte_pagadora_id FROM agenda_online_convenio WHERE agenda_online_configuracao_id = ?',
            [id],
          )
        ).map((l) => num(l['fonte_pagadora_id'])),
      );
      for (const f of convenios)
        if (!temConv.has(f))
          await tx.incluir('agenda_online_convenio', {
            agenda_online_configuracao_id: id,
            fonte_pagadora_id: f,
          });
      const temServ = new Set(
        (
          await tx.consultar(
            `SELECT ${coluna} AS s FROM agenda_online_servico WHERE agenda_online_configuracao_id = ?`,
            [id],
          )
        ).map((l) => num(l['s'])),
      );
      for (const s of servicos)
        if (!temServ.has(s))
          await tx.incluir('agenda_online_servico', { agenda_online_configuracao_id: id, [coluna]: s });
      // Quem configurou é o usuário do hospital do pedido (x.por), mesmo quando a operação não traz registro de trilha.
      await tx.executar(
        `UPDATE agenda_online_configuracao SET ${x.versao === null ? 'criado_por' : 'alterado_por'} = ? WHERE id = ?`,
        [await usuarioDoLogin(tx, x.por), id],
      );
      marcar('agenda_online_configuracao', id);
      return { id, versao };
    },

    async enviarPreCheckin(p) {
      if (!(await marcacaoDoTipo(tx, estabelecimento, p.tipo, p.marcacao)))
        throw new ErroPortal('nao-encontrado', 'Marcação inexistente neste estabelecimento.');
      const [atual] = await tx.consultarParaAtualizar(
        'SELECT * FROM pre_checkin WHERE marcacao_horario_id = ? AND excluido_em IS NULL',
        [p.marcacao],
      );
      if (atual && String(atual['situacao']) === 'conferido')
        throw new ErroPortal('situacao', 'O pré-check-in desta marcação já foi conferido pela recepção.');
      if (atual && String(atual['situacao']) === 'concluido' && reservaVale(atual))
        throw new ErroPortal(
          'situacao',
          'A recepção está conferindo o seu pré-check-in agora: aguarde alguns minutos para mudar.',
        );
      const valores = {
        paciente_id: p.paciente,
        conta_portal_paciente_id: p.conta,
        canal: 'portal',
        situacao: 'concluido',
        concluido_em: new Date(),
        iniciado_em: new Date(),
        numero_carteira: p.carteirinha,
        validade_carteira: p.carteirinhaValidade,
        documentos_enviados: p.documentos.length > 0,
        dados_propostos: JSON.stringify(p.dados),
        campos_gravados: '[]',
        termos_versao: p.termos.slice(0, 20),
        motivo_recusa: null,
        conferido_em: null,
        conferido_usuario_id: null,
        reservado_por_usuario_id: null,
        reservado_em: null,
      };
      let id: number;
      let versao: number;
      if (atual) {
        id = num(atual['id']);
        versao = await tx.alterar('pre_checkin', id, num(atual['versao']), valores);
      } else {
        id = await tx.incluir('pre_checkin', {
          estabelecimento_id: estabelecimento,
          marcacao_horario_id: p.marcacao,
          ...valores,
        });
        versao = 1;
      }
      // Documento do paciente nunca é apagado (SBIS-26): no reenvio, o que saiu recebe exclusão lógica e o arquivo
      // reenviado reaproveita a sua linha (reativada quando excluída), respeitando a chave (pré-check-in, arquivo).
      const anteriores = new Map(
        (
          await tx.consultarParaAtualizar(
            'SELECT id, versao, arquivo_id, excluido_em FROM pre_checkin_documento WHERE pre_checkin_id = ?',
            [id],
          )
        ).map((l) => [num(l['arquivo_id']), l] as const),
      );
      const enviados = new Set<number>();
      for (const d of p.documentos) {
        const ja = await tx.uma(
          'SELECT id FROM arquivo WHERE chave_armazenamento = ? AND hash_sha256 = ? AND excluido_em IS NULL',
          [d.chave, d.sha256],
        );
        // O arquivo já guardado pela porta de armazenamento é reaproveitado; sem ele, o registro do arquivo nasce
        // aqui (o tamanho não vem no pré-check-in: 0 até a porta de armazenamento conferir).
        const arquivo = ja
          ? num(ja['id'])
          : await tx.incluir('arquivo', {
              finalidade: 'pre_checkin',
              nome_original: d.tipo,
              tipo_mime: d.mime,
              tamanho_bytes: 0,
              hash_sha256: d.sha256,
              chave_armazenamento: d.chave,
              imutavel: true,
            });
        if (enviados.has(arquivo)) continue;
        enviados.add(arquivo);
        const doc = { tipo: DOC_BANCO[d.tipo] ?? 'outro', resumo_conteudo: d.sha256, tipo_midia: d.mime };
        const linha = anteriores.get(arquivo);
        if (linha)
          await tx.alterar('pre_checkin_documento', num(linha['id']), num(linha['versao']), {
            ...doc,
            excluido_em: null,
            excluido_por: null,
          });
        else await tx.incluir('pre_checkin_documento', { pre_checkin_id: id, arquivo_id: arquivo, ...doc });
      }
      for (const [arquivo, l] of anteriores)
        if (!enviados.has(arquivo) && (l['excluido_em'] === null || l['excluido_em'] === undefined))
          await tx.alterar('pre_checkin_documento', num(l['id']), num(l['versao']), {
            excluido_em: new Date(),
            excluido_por: autor,
          });
      marcar('pre_checkin', id);
      return { id, versao };
    },

    async decidirPreCheckin(id, versao, d) {
      const atual = await travarPre(id);
      if (!atual || num(atual['versao']) !== versao || String(atual['situacao']) !== 'concluido')
        throw versaoVelha();
      const usuario = await usuarioDoLogin(tx, d.por);
      if (reservaVale(atual) && num(atual['reservado_por_usuario_id']) !== usuario) throw versaoVelha();
      await tx.alterar('pre_checkin', id, versao, {
        situacao: d.conferido ? 'conferido' : 'recusado',
        motivo_recusa: d.conferido ? null : d.motivo,
        campos_gravados: JSON.stringify(d.conferido ? [...d.campos] : []),
        conferido_em: new Date(),
        conferido_usuario_id: usuario,
        reservado_por_usuario_id: null,
        reservado_em: null,
      });
      marcar('pre_checkin', id);
    },

    async reservarConferencia(id, versao, por) {
      const atual = await travarPre(id);
      if (
        !atual ||
        num(atual['versao']) !== versao ||
        String(atual['situacao']) !== 'concluido' ||
        reservaVale(atual)
      )
        throw versaoVelha();
      const usuario = await usuarioDoLogin(tx, por);
      const nova = await tx.alterar('pre_checkin', id, versao, {
        reservado_por_usuario_id: usuario,
        reservado_em: new Date(),
      });
      marcar('pre_checkin', id);
      return { versao: nova };
    },

    async liberarConferencia(id, versao) {
      const atual = await travarPre(id);
      if (!atual || num(atual['versao']) !== versao || String(atual['situacao']) !== 'concluido') return;
      await tx.alterar('pre_checkin', id, versao, { reservado_por_usuario_id: null, reservado_em: null });
      marcar('pre_checkin', id);
    },

    async cancelarPreCheckin(tipo, marcacao) {
      if (!(await marcacaoDoTipo(tx, estabelecimento, tipo, marcacao))) return 0;
      const ls = await tx.consultarParaAtualizar(
        `SELECT id, versao FROM pre_checkin WHERE marcacao_horario_id = ? AND estabelecimento_id = ?
            AND excluido_em IS NULL AND situacao IN ('concluido', 'recusado')`,
        [marcacao, estabelecimento],
      );
      for (const l of ls) {
        await tx.alterar('pre_checkin', num(l['id']), num(l['versao']), {
          situacao: 'cancelado',
          reservado_por_usuario_id: null,
          reservado_em: null,
        });
        marcar('pre_checkin', num(l['id']));
      }
      return ls.length;
    },

    async iniciarPagamento(p) {
      if (!(await marcacaoDoTipo(tx, estabelecimento, p.tipo, p.marcacao)))
        throw new ErroPortal('nao-encontrado', 'Marcação inexistente neste estabelecimento.');
      const t = Date.now();
      const ls = await tx.consultarParaAtualizar(
        `SELECT id, situacao, expira_em, versao FROM intencao_pagamento_portal
          WHERE marcacao_horario_id = ? AND estabelecimento_id = ? AND excluido_em IS NULL AND situacao IN ('pendente', 'confirmado')
          ORDER BY id`,
        [p.marcacao, estabelecimento],
      );
      for (const x of ls) {
        if (String(x['situacao']) === 'confirmado')
          throw new ErroPortal('situacao', 'Esta marcação já está paga.');
        if (instante(x['expira_em']).getTime() > t)
          throw new ErroPortal('situacao', 'Já existe um pagamento em andamento para esta marcação.');
        await tx.alterar('intencao_pagamento_portal', num(x['id']), num(x['versao']), {
          situacao: 'expirado',
        });
      }
      if (await tx.uma('SELECT id FROM intencao_pagamento_portal WHERE transacao = ?', [p.transacao]))
        throw new ErroPortal('situacao', 'Transação do gateway repetida.');
      const id = await tx.incluir('intencao_pagamento_portal', {
        estabelecimento_id: estabelecimento,
        conta_portal_paciente_id: p.conta,
        paciente_id: p.paciente,
        marcacao_horario_id: p.marcacao,
        valor: p.valor,
        forma: p.forma === 'cartao-credito' ? 'cartao_credito' : 'pix',
        conector: p.conector,
        transacao: p.transacao,
        situacao: 'pendente',
        expira_em: p.expiraEm,
        pix_copia_e_cola: p.pixCopiaECola,
        endereco_cartao: p.enderecoCartao,
      });
      marcar('intencao_pagamento_portal', id);
      return { id };
    },

    confirmarPagamento(x) {
      return confirmarPagamentoProprio(tx, estabelecimento, x, {
        sqlPagamento: SQL_PAGAMENTO,
        daLinha: pagamentoDaLinha,
        marcar,
      });
    },

    async registrarConciliacao(n) {
      const [p] = await tx.consultarParaAtualizar(
        `${SQL_PAGAMENTO} AND p.id = ?`.replace('SELECT p.*, ca.natureza', 'SELECT p.*, NULL AS natureza'),
        [estabelecimento, n.pagamento],
      );
      if (!p) throw new ErroPortal('nao-encontrado', 'Pagamento não encontrado.');
      const atos = (await tx.consultar(SQL_CONCILIACOES([n.pagamento]), [n.pagamento])).map(
        conciliacaoDaLinha,
      );
      const t: PagamentoTesourariaPortal = {
        pagamento: pagamentoDaLinha(p),
        cobradoPor: p['recebimento_particular_id'] ? OPERADOR_CAIXA_PORTAL : null,
        atos,
      };
      const r = conferirConciliacaoPortal(t, n);
      if (r) throw new ErroPortal('situacao', r.mensagem);
      const usuario = await usuarioDoLogin(tx, n.usuario);
      const id = await tx.incluir('conciliacao_pagamento_portal', {
        intencao_pagamento_portal_id: n.pagamento,
        acao: n.acao,
        valor: n.valor,
        referencia: n.referencia?.trim() || null,
        motivo: n.motivo?.trim() || null,
        usuario_id: usuario,
      });
      marcar('conciliacao_pagamento_portal', id);
      const l = await tx.uma(
        'SELECT k.*, u.login FROM conciliacao_pagamento_portal k LEFT JOIN usuario u ON u.id = k.usuario_id WHERE k.id = ?',
        [id],
      );
      return conciliacaoDaLinha(l as Linha);
    },

    async responderPesquisa(r) {
      if (!(await marcacaoDoTipo(tx, estabelecimento, r.tipo, r.marcacao)))
        throw new ErroPortal('nao-encontrado', 'Marcação inexistente neste estabelecimento.');
      if (
        await tx.uma('SELECT id FROM resposta_pesquisa_satisfacao WHERE marcacao_horario_id = ?', [
          r.marcacao,
        ])
      )
        throw new ErroPortal('situacao', 'A pesquisa deste atendimento já foi respondida.');
      const modelo = await tx.uma(
        `SELECT id FROM modelo_pesquisa_satisfacao
          WHERE canal_aplicacao = 'portal' AND situacao = 'vigente' AND NOT anonima
            AND (vigencia_inicio IS NULL OR vigencia_inicio <= CURRENT_DATE)
            AND (vigencia_fim IS NULL OR vigencia_fim >= CURRENT_DATE)
          ORDER BY id LIMIT 1`,
      );
      if (!modelo)
        throw new ErroPortal('situacao', 'Não há modelo de pesquisa de satisfação vigente para o portal.');
      const id = await tx.incluir('resposta_pesquisa_satisfacao', {
        estabelecimento_id: estabelecimento,
        modelo_pesquisa_satisfacao_id: num(modelo['id']),
        paciente_id: r.paciente,
        conta_portal_paciente_id: r.conta,
        marcacao_horario_id: r.marcacao,
        canal: 'portal',
        perfil_respondente: 'paciente',
        anonima: false,
        respondida_em: new Date(),
        nota_recomendacao: r.nota,
        comentario: r.comentario,
      });
      marcar('resposta_pesquisa_satisfacao', id);
      return { id };
    },
  };
}

/** As gravações da etapa 2: o gravador sobre a transação. */
export type { GravadorAgendaOnline };

export function portaAgendaOnlineIndisponivel(): PortaAgendaOnline {
  return indisponivel<PortaAgendaOnline>(METODOS_PORTA_AGENDA_ONLINE);
}
