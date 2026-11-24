// Porta PRÓPRIA dos documentos do prontuário, família "pareceres" (pep-gravacao): pareceres (interconsulta),
// especialidades, coassinatura de residentes (supervisão), registros sem assinatura, lista de problemas, sumário de alta
// (rascunho), relatório de transferência, óbito e ciência de valor crítico, sobre o banco do cliente (MariaDB, pelo
// @sgh/nucleo). A especificação é a porta de memória (documentos-porta-memoria.ts): mesmos filtros, ordem, versão e
// erros de domínio (ErroProntuario com o mesmo código e status). O integrador liga cada método da
// PortaDocumentosPropria a esta classe.
// Leituras pelo Leitor; gravações pelo Executor (transação, trilha e idempotência do núcleo), sempre com o
// profissional da sessão (usuário → vínculo vigente no estabelecimento → profissional → inscrição ativa no conselho).
// Registro clínico nunca é apagado (SBIS-26): nenhuma exclusão física; problema muda por nova versão
// (problema_paciente_versao), sumário por nova versão (sumario_alta.numero_versao), parecer por cancelamento com motivo.
// Tabelas novas ou colunas: migração 06_PEP/98_pareceres (relatorio_transferencia; rascunho do sumário; número da
// declaração de óbito opcional só no rascunho; conta que deu a ciência) e 06_PEP/99_obito_rascunho (rascunho cancelado
// sem data de emissão).
import { statusDaRecusaObito, validarCancelamentoObito, type LinhaCausaObito } from '@sgh/dominio-pep';
import { randomUUID } from 'node:crypto';
import {
  type ContextoOperacao,
  definirOperacao,
  ErroOperacao,
  type Executor,
  type ExtrasTrilha,
  type Leitor,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';
import type { ContextoDocs } from './documentos-porta.js';
import type { NucleoDocumentosPep } from './documentos-porta-propria.js';
import { dataHora, fusoValido } from './registro-porta-propria.js';
import {
  type CienciaLida,
  type ContextoGravacaoPep,
  ErroProntuario,
  type ProblemaLido,
  type ProblemaNovo,
  type SumarioLido,
  type SupervisaoLida,
} from './tipos-pep.js';

/** Teto de linhas devolvidas por lista (problemas, registros sem assinatura, coassinaturas). */
export const TETO_LISTA = 500;
/** Teto de ids por lista recebida (CBOs). */
export const TETO_IDS = 200;
/** Justificativa gravada quando a tela descarta um problema (o CHECK do banco exige uma; a tela não pede texto). */
export const JUSTIFICATIVA_DESCARTE = 'Descartado na lista de problemas.';

const num = (v: unknown): number => Number(v);
const numOuNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const textoOuNull = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const marcadores = (n: number): string => Array.from({ length: n }, () => '?').join(', ');
const idsValidos = (ids: readonly number[]): number[] =>
  [...new Set(ids)].filter((i) => Number.isSafeInteger(i) && i > 0).slice(0, TETO_IDS);
const HASH_VALIDO = /^[0-9a-f]{64}$/;

/** JSON lido do banco: objeto, texto JSON ou nulo. */
function jsonDe(v: unknown): Record<string, unknown> {
  if (v === null || v === undefined) return {};
  if (typeof v === 'object' && !Buffer.isBuffer(v)) return v as Record<string, unknown>;
  try {
    const o: unknown = JSON.parse(String(v));
    return o && typeof o === 'object' ? (o as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Texto que tem de ser JSON válido no banco: o próprio, se já for JSON; senão, embrulhado como texto JSON. */
export function comoJson(t: string): string {
  try {
    JSON.parse(t);
    return t;
  } catch {
    return JSON.stringify(t);
  }
}

/** Data civil (AAAA-MM-DD) de uma coluna DATE (o pool lê em UTC). */
export function dia(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  const s = String(v);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
}

// ── Vocabulário: banco ↔ neutro ───────────────────────────────────────────────────────────────────

type SituacaoProblema = ProblemaLido['situacao'];
/** Situação do problema no banco → a da tela (controlado é ativo; inativo e refutado são descartados). */
export function situacaoProblemaLida(v: unknown): SituacaoProblema {
  const s = String(v);
  if (s === 'resolvido') return 'resolvido';
  if (s === 'inativo' || s === 'refutado') return 'descartado';
  return 'ativo';
}
/** Situação da tela → a do banco (descartado = refutado, com a inativação). */
export function situacaoProblemaGravada(s: SituacaoProblema): 'ativo' | 'resolvido' | 'refutado' {
  return s === 'descartado' ? 'refutado' : s;
}
export function tipoProblemaLido(v: unknown): ProblemaLido['tipo'] {
  return String(v) === 'diagnostico' ? 'diagnostico' : 'problema';
}
/** Situação do sumário: rascunho (e cancelado) seguem editáveis; finalizado, assinado e retificado estão fechados. */
export function situacaoSumarioLida(v: unknown): SumarioLido['situacao'] {
  const s = String(v);
  return s === 'rascunho' || s === 'cancelado' ? 'rascunho' : 'finalizado';
}
/** Situação da supervisão: ajuste solicitado e cancelado não são coassinatura (recusado). */
export function situacaoSupervisaoLida(v: unknown): SupervisaoLida['situacao'] {
  const s = String(v);
  if (s === 'pendente') return 'pendente';
  if (s === 'coassinado') return 'coassinado';
  return 'recusado';
}

/** A conta ligada ao profissional no estabelecimento (vigente primeiro; sem ela, a mais recente). */
const SQL_LOGIN_DO_PROFISSIONAL = (profissional: string, estabelecimento: string) => `
  (SELECT u.login FROM usuario_vinculo_profissional v JOIN usuario u ON u.id = v.usuario_id
    WHERE v.profissional_id = ${profissional} AND v.estabelecimento_id = ${estabelecimento}
    ORDER BY (v.excluido_em IS NULL AND v.vigencia_inicio <= CURRENT_DATE
              AND (v.vigencia_fim IS NULL OR v.vigencia_fim >= CURRENT_DATE)) DESC,
             v.vigencia_inicio DESC, v.id DESC LIMIT 1)`;

const SQL_SUPERVISAO = `
  SELECT s.id, s.registro_assistencial_id, ra.paciente_id, ra.atendimento_id, ur.login AS residente,
         ${SQL_LOGIN_DO_PROFISSIONAL('s.preceptor_profissional_id', 'ra.estabelecimento_id')} AS preceptor,
         s.situacao, COALESCE(s.decidido_em, s.solicitado_em) AS em
    FROM registro_assistencial_supervisao s
    JOIN registro_assistencial ra ON ra.id = s.registro_assistencial_id AND ra.excluido_em IS NULL
    JOIN usuario ur ON ur.id = ra.autor_usuario_id
   WHERE ra.estabelecimento_id = ? AND s.excluido_em IS NULL`;

interface Estabelecimento {
  readonly id: number;
  readonly fuso: string;
}

/** O profissional da sessão, exigido em toda gravação. */
export interface SessaoClinica {
  readonly usuario: number;
  readonly profissional: number;
  /** Inscrições ativas (ou provisórias) do profissional no conselho: os "cbos" que ele pode usar. */
  readonly inscricoes: readonly number[];
}

export class DocumentosPropriaPareceres {
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: NucleoDocumentosPep,
    /** Cliente desta API (configuração), quando o contexto da sessão não o traz. */
    private readonly cliente: string,
    executor?: Executor,
  ) {
    this.executor = executor ?? nucleo.criarExecutor();
  }

  private clienteDe(c: ContextoDocs): string {
    return c.cliente || this.cliente;
  }

  private ler<T>(c: ContextoDocs, rotulo: string, fn: (l: Leitor, est: Estabelecimento) => Promise<T>) {
    return this.nucleo.lerSomente(
      { cliente: this.clienteDe(c), correlacao: `pep.documentos.${rotulo}` },
      async (l) => fn(l, await this.estabelecimento(l, c.hospital)),
    );
  }

  private async estabelecimento(l: Leitor, codigo: string): Promise<Estabelecimento> {
    const e = await l.uma<{ id: unknown; fuso_horario: unknown }>(
      'SELECT id, fuso_horario FROM estabelecimento WHERE codigo = ? AND excluido_em IS NULL',
      [codigo],
    );
    if (!e)
      throw new ErroOperacao(
        404,
        'estabelecimento-inexistente',
        'Estabelecimento não encontrado',
        'O estabelecimento da sessão não existe neste cliente.',
      );
    return { id: num(e.id), fuso: fusoValido(e.fuso_horario) };
  }

  /** Usuário → vínculo vigente → profissional → inscrições ativas; sem qualquer elo, null. */
  private async sessaoClinica(l: Leitor, est: number, login: string): Promise<SessaoClinica | null> {
    if (!login) return null;
    const u = await l.uma(
      `SELECT u.id AS usuario, p.id AS profissional
         FROM usuario u
         JOIN usuario_vinculo_profissional v ON v.usuario_id = u.id AND v.estabelecimento_id = ?
              AND v.profissional_id IS NOT NULL AND v.excluido_em IS NULL
              AND v.vigencia_inicio <= CURRENT_DATE AND (v.vigencia_fim IS NULL OR v.vigencia_fim >= CURRENT_DATE)
         JOIN profissional p ON p.id = v.profissional_id AND p.excluido_em IS NULL
        WHERE u.login = ? AND u.excluido_em IS NULL
        ORDER BY v.vigencia_inicio DESC, v.id DESC LIMIT 1`,
      [est, login],
    );
    if (!u) return null;
    const inscricoes = await l.consultar(
      `SELECT id FROM inscricao_conselho
        WHERE profissional_id = ? AND excluido_em IS NULL AND situacao IN ('ativa','provisoria')
        ORDER BY principal DESC, sequencia, id`,
      [num(u['profissional'])],
    );
    if (!inscricoes.length) return null;
    return {
      usuario: num(u['usuario']),
      profissional: num(u['profissional']),
      inscricoes: inscricoes.map((i) => num(i['id'])),
    };
  }

  /**
   * Uma gravação pelo Executor com o profissional da sessão. O erro de domínio levantado dentro da transação (via
   * `falhar`) desfaz tudo e volta a quem chama como ErroProntuario (o mesmo da porta de memória).
   */
  private async gravar<T>(
    c: ContextoGravacaoPep,
    nome: string,
    tabelas: readonly string[],
    fn: (
      tx: TxOperacao,
      est: Estabelecimento,
      s: SessaoClinica,
      falhar: (codigo: string, mensagem: string, status?: number) => never,
    ) => Promise<T>,
    alvo: (r: T) => { tabela: string; id: number | null },
    extras: (r: T) => ExtrasTrilha,
  ): Promise<T> {
    const cliente = this.clienteDe(c);
    const ident = await this.ler(c, 'identidade', async (l, est) => ({
      est,
      sessao: await this.sessaoClinica(l, est.id, c.usuarioLogin),
    }));
    if (!ident.sessao)
      throw new ErroProntuario(
        'sem-profissional',
        'A gravação exige um profissional com vínculo vigente e inscrição ativa no conselho.',
        403,
      );
    const sessao = ident.sessao;
    const contexto: ContextoOperacao = {
      cliente,
      estabelecimento: ident.est.id,
      usuario: sessao.usuario,
      correlacao: (c.correlacao || c.traceId || nome).slice(0, 64),
      chaveIdempotencia: `${nome}:${randomUUID()}`,
    };
    let dominio: ErroProntuario | null = null;
    const falhar = (codigo: string, mensagem: string, status = 409): never => {
      dominio = new ErroProntuario(codigo, mensagem, status);
      throw new ErroOperacao(status, codigo, 'Operação recusada', mensagem);
    };
    let feito: { r: T } | null = null;
    const op = definirOperacao({
      nome,
      tabelas,
      entrada: z.object({}).strict(),
      gravar: async (tx: TxOperacao) => {
        const r = await fn(tx, ident.est, sessao, falhar);
        feito = { r };
        const a = alvo(r);
        return { tabela: a.tabela, id: a.id };
      },
      alvo: (_e, s) => ({ tabela: String(s['tabela']), id: s['id'] === null ? null : Number(s['id']) }),
      trilha: () => (feito ? extras((feito as { r: T }).r) : {}),
    });
    try {
      await this.executor.executar(op, cliente, {}, contexto);
    } catch (e) {
      if (dominio) throw dominio;
      throw e;
    }
    if (!feito) throw new Error(`A operação ${nome} terminou sem resultado.`);
    return (feito as { r: T }).r;
  }

  /** O atendimento é do paciente e do estabelecimento (senão, recusa de domínio). */
  private async exigirAtendimento(
    tx: TxOperacao,
    est: number,
    paciente: number,
    atendimento: number,
    falhar: (codigo: string, mensagem: string, status?: number) => never,
  ): Promise<void> {
    const a = await tx.uma(
      'SELECT id FROM atendimento WHERE id = ? AND estabelecimento_id = ? AND paciente_id = ? AND excluido_em IS NULL',
      [atendimento, est, paciente],
    );
    if (!a) falhar('atendimento-invalido', 'O atendimento não é deste paciente neste estabelecimento.', 404);
  }

  /** A inscrição escolhida ("cbo") tem de ser do profissional da sessão. */
  private inscricaoDa(
    s: SessaoClinica,
    cbo: number | null,
    falhar: (codigo: string, mensagem: string, status?: number) => never,
  ): number | null {
    if (cbo === null) return null;
    if (!s.inscricoes.includes(cbo))
      falhar('cbo-invalido', 'A ocupação escolhida não é do profissional da sessão.', 422);
    return cbo;
  }

  /** Emite o documento do prontuário (situação "lançado", evento "criacao") para uma origem desta família. */
  private async emitirDocumento(
    tx: TxOperacao,
    est: number,
    s: SessaoClinica,
    d: {
      paciente: number;
      atendimento: number;
      origem: string;
      origemId: number;
      categoriaTipo: string;
      titulo: string;
      hash: string;
      comoSuporte: boolean;
      referencia: Date;
    },
    falhar: (codigo: string, mensagem: string, status?: number) => never,
  ): Promise<number> {
    const tipo = await tx.uma(
      `SELECT id FROM tipo_documento_clinico WHERE categoria = ? AND ativo = TRUE
        ORDER BY (ordem IS NULL), ordem, id LIMIT 1`,
      [d.categoriaTipo],
    );
    if (!tipo)
      falhar(
        'tipo-documento-sem-cadastro',
        `O cliente não tem tipo de documento clínico ativo na categoria "${d.categoriaTipo}".`,
      );
    const situacao = await tx.uma(
      `SELECT id FROM situacao_documento_prontuario WHERE categoria = 'lancado' AND ativo = TRUE
        ORDER BY (ordem IS NULL), ordem, id LIMIT 1`,
    );
    if (!situacao)
      falhar(
        'situacao-documento-sem-cadastro',
        'O cliente não tem situação de documento ativa na categoria "lancado".',
      );
    const agora = new Date();
    const documento = await tx.incluir('documento_prontuario', {
      estabelecimento_id: est,
      paciente_id: d.paciente,
      atendimento_id: d.atendimento,
      tipo_documento_clinico_id: num(tipo!['id']),
      situacao_documento_prontuario_id: num(situacao!['id']),
      entidade_origem: d.origem,
      entidade_origem_id: d.origemId,
      titulo: d.titulo,
      profissional_id: s.profissional,
      referencia_em: d.referencia,
      lancado_em: agora,
      numero_versao: 1,
      confidencial: false,
      conteudo: JSON.stringify({ hash_conteudo: d.hash, como_suporte: d.comoSuporte }),
      origem: 'sistema',
    });
    await tx.incluir('documento_prontuario_evento', {
      documento_prontuario_id: documento,
      operacao: 'inclusao',
      acao: 'criacao',
      situacao_documento_prontuario_id: num(situacao!['id']),
      profissional_id: s.profissional,
      evento_em: agora,
      dados: JSON.stringify({ hash: d.hash }),
      ocorrido_em: agora,
      usuario_id: s.usuario,
    });
    return documento;
  }

  // ── Pareceres e especialidades ─────────────────────────────────────────────────────────────────

  historicoPareceres(
    c: ContextoDocs,
    paciente: number | null,
  ): Promise<{ pedidos: number; respostas: number; encaminhamentos: number }> {
    return this.ler(c, 'historico-pareceres', async (l, est) => {
      const filtro = paciente === null ? '' : ' AND x.paciente_id = ?';
      const p = (n: number) => (paciente === null ? [est.id] : [est.id, paciente]).slice(0, n);
      const um = async (sql: string) => num((await l.uma(sql, p(2)))?.['n'] ?? 0);
      return {
        pedidos: await um(
          `SELECT COUNT(*) AS n FROM interconsulta x WHERE x.estabelecimento_id = ? AND x.excluido_em IS NULL${filtro}`,
        ),
        respostas: await um(
          `SELECT COUNT(*) AS n FROM interconsulta_resposta r JOIN interconsulta x ON x.id = r.interconsulta_id
            WHERE x.estabelecimento_id = ? AND x.excluido_em IS NULL AND r.excluido_em IS NULL${filtro}`,
        ),
        encaminhamentos: await um(
          `SELECT COUNT(*) AS n FROM encaminhamento_paciente x
            WHERE x.estabelecimento_id = ? AND x.excluido_em IS NULL${filtro}`,
        ),
      };
    });
  }

  especialidades(c: ContextoDocs): Promise<{ id: number; nome: string }[]> {
    return this.ler(c, 'especialidades', async (l) => {
      const ls = await l.consultar(
        'SELECT id, descricao FROM especialidade_medica WHERE ativo = TRUE ORDER BY descricao, id',
      );
      return ls.map((x) => ({ id: num(x['id']), nome: String(x['descricao']) }));
    });
  }

  /** As especialidades das ocupações (CBO 2002) das inscrições indicadas ("cbo" = id da inscrição no conselho). */
  especialidadesDoCbo(c: ContextoDocs, cbos: readonly number[]): Promise<number[]> {
    const ids = idsValidos(cbos);
    if (!ids.length) return Promise.resolve([]);
    return this.ler(c, 'especialidades-cbo', async (l) => {
      const ls = await l.consultar(
        `SELECT DISTINCT em.id FROM inscricao_conselho i
           JOIN especialidade_medica em ON em.ativo = TRUE
                AND (em.ocupacao_cbo_id = i.ocupacao_cbo_id
                     OR EXISTS (SELECT 1 FROM especialidade_ocupacao eo
                                 WHERE eo.especialidade_medica_id = em.id AND eo.ocupacao_cbo_id = i.ocupacao_cbo_id
                                   AND eo.excluido_em IS NULL))
          WHERE i.id IN (${marcadores(ids.length)}) AND i.excluido_em IS NULL AND i.ocupacao_cbo_id IS NOT NULL
          ORDER BY em.id`,
        ids,
      );
      return ls.map((x) => num(x['id']));
    });
  }

  async aceitarParecer(c: ContextoGravacaoPep, parecer: number): Promise<{ paciente: number }> {
    return this.gravar(
      c,
      'pep.parecer.aceitar',
      ['interconsulta'],
      async (tx, est, s, falhar) => {
        const [x] = await tx.consultarParaAtualizar(
          `SELECT id, versao, paciente_id, situacao, visualizado_em FROM interconsulta
            WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
          [parecer, est.id],
        );
        if (!x) return falhar('registro-inexistente', 'Parecer não encontrado.', 404);
        if (x['situacao'] !== 'solicitado')
          falhar('situacao-invalida', 'O parecer não está aguardando aceite.');
        const agora = new Date();
        await tx.alterar('interconsulta', parecer, num(x['versao']), {
          situacao: 'aceito',
          aceito_em: agora,
          aceito_por_profissional_id: s.profissional,
          visualizado_em: x['visualizado_em'] ?? agora,
        });
        return { paciente: num(x['paciente_id']) };
      },
      () => ({ tabela: 'interconsulta', id: parecer }),
      () => ({ dados: { evento: 'pep.parecer.aceito', parecer } }),
    );
  }

  async cancelarParecer(c: ContextoGravacaoPep, parecer: number, motivo: string): Promise<void> {
    const m = String(motivo ?? '').trim();
    if (!m) throw new ErroProntuario('motivo-obrigatorio', 'O cancelamento do parecer exige o motivo.', 422);
    await this.gravar(
      c,
      'pep.parecer.cancelar',
      ['interconsulta'],
      async (tx, est, s, falhar) => {
        const [x] = await tx.consultarParaAtualizar(
          `SELECT id, versao, situacao FROM interconsulta
            WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
          [parecer, est.id],
        );
        if (!x) return falhar('registro-inexistente', 'Parecer não encontrado.', 404);
        if (x['situacao'] === 'respondido' || x['situacao'] === 'cancelado')
          falhar('situacao-invalida', 'O parecer já foi encerrado.');
        await tx.alterar('interconsulta', parecer, num(x['versao']), {
          situacao: 'cancelado',
          cancelado_em: new Date(),
          cancelado_por_profissional_id: s.profissional,
          motivo_cancelamento: m.slice(0, 500),
        });
        return null;
      },
      () => ({ tabela: 'interconsulta', id: parecer }),
      () => ({ dados: { evento: 'pep.parecer.cancelado', parecer } }),
    );
  }

  // ── Supervisão (coassinatura de residentes) ─────────────────────────────────────────────────────

  private supervisaoLida(x: Record<string, unknown>, fuso: string, preceptor?: string): SupervisaoLida {
    return {
      id: num(x['id']),
      registro: num(x['registro_assistencial_id']),
      paciente: num(x['paciente_id']),
      atendimento: numOuNull(x['atendimento_id']),
      residente: String(x['residente']),
      preceptor: preceptor ?? textoOuNull(x['preceptor']) ?? '',
      situacao: situacaoSupervisaoLida(x['situacao']),
      em: dataHora(x['em'], fuso),
    };
  }

  /** Os registros que aguardam a coassinatura deste preceptor (pelos profissionais de vínculo vigente do login). */
  coassinaturas(c: ContextoDocs, preceptor: string): Promise<SupervisaoLida[]> {
    return this.ler(c, 'coassinaturas', async (l, est) => {
      const ls = await l.consultar(
        `${SQL_SUPERVISAO} AND s.situacao = 'pendente'
            AND s.preceptor_profissional_id IN (
              SELECT v.profissional_id FROM usuario_vinculo_profissional v JOIN usuario u ON u.id = v.usuario_id
               WHERE u.login = ? AND u.excluido_em IS NULL AND v.estabelecimento_id = ? AND v.excluido_em IS NULL
                 AND v.profissional_id IS NOT NULL AND v.vigencia_inicio <= CURRENT_DATE
                 AND (v.vigencia_fim IS NULL OR v.vigencia_fim >= CURRENT_DATE))
          ORDER BY s.solicitado_em, s.id LIMIT ${TETO_LISTA}`,
        [est.id, preceptor, est.id],
      );
      return ls.map((x) => this.supervisaoLida(x, est.fuso, preceptor));
    });
  }

  supervisao(c: ContextoDocs, id: number): Promise<SupervisaoLida | null> {
    return this.ler(c, 'supervisao', async (l, est) => {
      const x = await l.uma(`${SQL_SUPERVISAO} AND s.id = ?`, [est.id, id]);
      return x ? this.supervisaoLida(x, est.fuso) : null;
    });
  }

  async coassinarNoNovo(
    c: ContextoGravacaoPep,
    x: { id: number; decisao: 'coassinado' | 'recusado'; motivo?: string | null },
  ): Promise<{ registro: number; paciente: number }> {
    const motivo = textoOuNull(x.motivo)?.trim() || null;
    return this.gravar(
      c,
      'pep.evolucao.coassinar',
      ['registro_assistencial_supervisao', 'registro_assistencial'],
      async (tx, est, s, falhar) => {
        const [sup] = await tx.consultarParaAtualizar(
          `SELECT s.id, s.versao, s.situacao, s.preceptor_profissional_id, ra.id AS registro, ra.versao AS versao_registro,
                  ra.paciente_id, ra.situacao AS situacao_registro
             FROM registro_assistencial_supervisao s
             JOIN registro_assistencial ra ON ra.id = s.registro_assistencial_id AND ra.excluido_em IS NULL
            WHERE s.id = ? AND ra.estabelecimento_id = ? AND s.excluido_em IS NULL`,
          [x.id, est.id],
        );
        if (!sup) return falhar('nao-encontrado', 'Pedido de coassinatura não encontrado.', 404);
        if (num(sup['preceptor_profissional_id']) !== s.profissional)
          falhar('sem-permissao', 'Só o preceptor indicado coassina este registro.', 403);
        if (sup['situacao'] !== 'pendente')
          falhar('coassinatura-encerrada', 'O registro já foi coassinado ou recusado.');
        if (x.decisao === 'recusado' && !motivo)
          falhar('motivo-obrigatorio', 'A recusa da coassinatura exige o motivo.', 422);
        await tx.alterar('registro_assistencial_supervisao', x.id, num(sup['versao']), {
          situacao: x.decisao,
          decidido_em: new Date(),
          motivo: motivo?.slice(0, 500) ?? null,
        });
        const registro = num(sup['registro']);
        // Coassinado o último pedido pendente, o registro deixa de aguardar coassinatura.
        if (x.decisao === 'coassinado' && sup['situacao_registro'] === 'aguardando_coassinatura') {
          const resta = await tx.uma(
            `SELECT COUNT(*) AS n FROM registro_assistencial_supervisao
              WHERE registro_assistencial_id = ? AND situacao = 'pendente' AND excluido_em IS NULL`,
            [registro],
          );
          if (num(resta?.['n'] ?? 0) === 0)
            await tx.alterar('registro_assistencial', registro, num(sup['versao_registro']), {
              situacao: 'finalizado',
            });
        }
        return { registro, paciente: num(sup['paciente_id']) };
      },
      () => ({ tabela: 'registro_assistencial_supervisao', id: x.id }),
      (r) => ({
        dados: {
          evento:
            x.decisao === 'coassinado' ? 'pep.evolucao.coassinada' : 'pep.evolucao.coassinaturaRecusada',
          registro: r.registro,
        },
      }),
    );
  }

  /** Registros clínicos do autor (login) ainda sem assinatura no documento do prontuário. */
  registrosSemAssinatura(
    c: ContextoDocs,
    login: string,
  ): Promise<{ registro: number; hash: string; em: string; paciente: number; atendimento: number | null }[]> {
    return this.ler(c, 'registros-sem-assinatura', async (l, est) => {
      const ls = await l.consultar(
        `SELECT ra.id, ra.impressao_digital, ra.data_hora_lancamento, ra.paciente_id, ra.atendimento_id
           FROM registro_assistencial ra JOIN usuario u ON u.id = ra.autor_usuario_id
          WHERE ra.estabelecimento_id = ? AND u.login = ? AND ra.excluido_em IS NULL
            AND ra.situacao IN ('finalizado','aguardando_coassinatura')
            AND NOT EXISTS (SELECT 1 FROM documento_prontuario_evento ev
                             WHERE ev.documento_prontuario_id = ra.documento_prontuario_id AND ev.acao = 'assinatura')
            AND NOT EXISTS (SELECT 1 FROM documento_prontuario dp
                              JOIN documento_assinado da ON da.id = dp.documento_assinado_id AND da.excluido_em IS NULL
                             WHERE dp.id = ra.documento_prontuario_id AND da.concluido_em IS NOT NULL)
          ORDER BY ra.data_hora_lancamento, ra.id LIMIT ${TETO_LISTA}`,
        [est.id, login],
      );
      return ls.map((x) => ({
        registro: num(x['id']),
        hash: String(x['impressao_digital']),
        em: dataHora(x['data_hora_lancamento'], est.fuso) ?? '',
        paciente: num(x['paciente_id']),
        atendimento: numOuNull(x['atendimento_id']),
      }));
    });
  }

  // ── Lista de problemas (uma linha por versão; id = id da versão; anterior = versão anterior) ───────────

  problemas(c: ContextoDocs, paciente: number): Promise<ProblemaLido[]> {
    return this.ler(c, 'problemas', async (l, est) => {
      // O teto corta o histórico mais antigo, nunca o estado vigente: entram as versões mais recentes (até o teto)
      // e, sempre, a última versão de cada problema; a lista sai em ordem cronológica.
      const ls = await l.consultar(
        `SELECT x.* FROM (
           SELECT v.id, v.dados, v.situacao, v.ocorrido_em, u.login,
                  p.descricao, p.tipo, p.inicio_em, p.resolvido_em,
                  (SELECT v2.id FROM problema_paciente_versao v2
                    WHERE v2.problema_paciente_id = v.problema_paciente_id AND v2.numero_versao < v.numero_versao
                    ORDER BY v2.numero_versao DESC LIMIT 1) AS anterior,
                  ROW_NUMBER() OVER (ORDER BY v.ocorrido_em DESC, v.id DESC) AS recencia,
                  ROW_NUMBER() OVER (PARTITION BY v.problema_paciente_id ORDER BY v.numero_versao DESC) AS ultima
             FROM problema_paciente_versao v
             JOIN problema_paciente p ON p.id = v.problema_paciente_id
             LEFT JOIN usuario u ON u.id = v.usuario_id
            WHERE p.estabelecimento_id = ? AND p.paciente_id = ? AND p.excluido_em IS NULL
         ) x
         WHERE x.recencia <= ${TETO_LISTA} OR x.ultima = 1
         ORDER BY x.ocorrido_em, x.id`,
        [est.id, paciente],
      );
      return ls.map((x) => {
        const d = jsonDe(x['dados']);
        return {
          id: num(x['id']),
          anterior: numOuNull(x['anterior']),
          descricao: textoOuNull(d['descricao']) ?? String(x['descricao']),
          cid: textoOuNull(d['cid']),
          tipo: tipoProblemaLido(d['tipo'] ?? x['tipo']),
          inicio: d['inicio'] !== undefined ? textoOuNull(d['inicio']) : dia(x['inicio_em']),
          fim: d['fim'] !== undefined ? textoOuNull(d['fim']) : dia(x['resolvido_em']),
          situacao: situacaoProblemaLida(x['situacao']),
          usuario: textoOuNull(x['login']) ?? '',
          em: dataHora(x['ocorrido_em'], est.fuso) ?? '',
        };
      });
    });
  }

  async gravarProblema(c: ContextoGravacaoPep, p: ProblemaNovo): Promise<number> {
    const situacao = situacaoProblemaGravada(p.situacao);
    const r = await this.gravar(
      c,
      'pep.problema.gravar',
      ['problema_paciente', 'problema_paciente_versao'],
      async (tx, est, s, falhar) => {
        const agora = new Date();
        const hoje = agora.toISOString().slice(0, 10);
        const fim = situacao === 'ativo' ? null : (p.fim ?? hoje);
        if (p.inicio && fim && fim < p.inicio)
          falhar('periodo-invalido', 'O fim do problema não pode ser anterior ao início.', 422);
        if (p.atendimento !== null)
          await this.exigirAtendimento(tx, est.id, p.paciente, p.atendimento, falhar);
        const colunas = {
          tipo: p.tipo,
          descricao: p.descricao.slice(0, 500),
          cid_termo_terminologia_id: p.idCid,
          situacao,
          inicio_em: p.inicio,
          resolvido_em: situacao === 'resolvido' ? fim : null,
          inativado_em: situacao === 'refutado' ? agora : null,
          inativado_por_profissional_id: situacao === 'refutado' ? s.profissional : null,
          justificativa_inativacao: situacao === 'refutado' ? JUSTIFICATIVA_DESCARTE : null,
        };
        const dados = JSON.stringify({
          descricao: p.descricao,
          cid: p.cid,
          tipo: p.tipo,
          inicio: p.inicio,
          fim,
          situacao: p.situacao,
          atendimento: p.atendimento,
        });
        let problema: number;
        let numero: number;
        if (p.anterior === null) {
          problema = await tx.incluir('problema_paciente', {
            estabelecimento_id: est.id,
            paciente_id: p.paciente,
            atendimento_id: p.atendimento,
            ...colunas,
            registrado_em: agora,
            registrado_por_profissional_id: s.profissional,
            origem: 'sistema',
          });
          numero = 1;
        } else {
          const [v] = await tx.consultarParaAtualizar(
            `SELECT v.problema_paciente_id, v.numero_versao, p.versao,
                    (SELECT MAX(v2.numero_versao) FROM problema_paciente_versao v2
                      WHERE v2.problema_paciente_id = v.problema_paciente_id) AS ultima
               FROM problema_paciente_versao v
               JOIN problema_paciente p ON p.id = v.problema_paciente_id
              WHERE v.id = ? AND p.estabelecimento_id = ? AND p.paciente_id = ? AND p.excluido_em IS NULL`,
            [p.anterior, est.id, p.paciente],
          );
          if (!v) return falhar('nao-encontrado', 'Problema não encontrado.', 404);
          if (num(v['ultima']) !== num(v['numero_versao']))
            falhar('conflito-versao', 'O problema mudou desde a leitura.');
          problema = num(v['problema_paciente_id']);
          numero = num(v['numero_versao']) + 1;
          await tx.alterar('problema_paciente', problema, num(v['versao']), colunas);
        }
        return tx.incluir('problema_paciente_versao', {
          problema_paciente_id: problema,
          operacao: numero === 1 ? 'inclusao' : 'alteracao',
          dados,
          ocorrido_em: agora,
          usuario_id: s.usuario,
          numero_versao: numero,
          situacao,
          cid_termo_terminologia_id: p.idCid,
          profissional_id: s.profissional,
          justificativa: situacao === 'refutado' ? JUSTIFICATIVA_DESCARTE : null,
        });
      },
      (id) => ({ tabela: 'problema_paciente_versao', id }),
      (id) => ({ dados: { evento: 'pep.problema.gravado', versao: id, anterior: p.anterior } }),
    );
    return r;
  }

  // ── Sumário de alta (rascunho por versão) ───────────────────────────────────────────────────────

  sumarios(c: ContextoDocs, atendimento: number): Promise<SumarioLido[]> {
    return this.ler(c, 'sumarios', async (l, est) => {
      const ls = await l.consultar(
        `SELECT sa.numero_versao, sa.situacao, sa.conteudo_rascunho, sa.documento_prontuario_id, sa.registrado_em,
                COALESCE(ur.login, uf.login,
                         ${SQL_LOGIN_DO_PROFISSIONAL('sa.responsavel_profissional_id', 'sa.estabelecimento_id')}) AS login
           FROM sumario_alta sa
           LEFT JOIN usuario ur ON ur.id = sa.registrado_usuario_id
           LEFT JOIN usuario uf ON uf.id = sa.finalizado_usuario_id
          WHERE sa.estabelecimento_id = ? AND sa.atendimento_id = ? AND sa.excluido_em IS NULL
          ORDER BY sa.numero_versao`,
        [est.id, atendimento],
      );
      return ls.map((x) => ({
        versao: num(x['numero_versao']),
        situacao: situacaoSumarioLida(x['situacao']),
        conteudo: textoOuNull(x['conteudo_rascunho']),
        documento: numOuNull(x['documento_prontuario_id']),
        usuario: textoOuNull(x['login']) ?? '',
        em: dataHora(x['registrado_em'], est.fuso) ?? '',
      }));
    });
  }

  async salvarRascunhoSumario(
    c: ContextoGravacaoPep,
    s: { paciente: number; atendimento: number; versao: number; conteudo: string; hashConteudo: string },
  ): Promise<number> {
    if (!HASH_VALIDO.test(s.hashConteudo))
      throw new ErroProntuario('hash-invalido', 'O resumo do conteúdo do sumário é inválido.', 422);
    await this.gravar(
      c,
      'pep.sumario-alta.salvar',
      ['sumario_alta'],
      async (tx, est, sessao, falhar) => {
        await this.exigirAtendimento(tx, est.id, s.paciente, s.atendimento, falhar);
        const vs = await tx.consultarParaAtualizar(
          'SELECT id, numero_versao FROM sumario_alta WHERE atendimento_id = ? AND excluido_em IS NULL',
          [s.atendimento],
        );
        if (vs.some((v) => num(v['numero_versao']) >= s.versao))
          falhar('conflito-versao', 'Outra versão do sumário foi salva.');
        return tx.incluir('sumario_alta', {
          estabelecimento_id: est.id,
          atendimento_id: s.atendimento,
          paciente_id: s.paciente,
          numero_versao: s.versao,
          situacao: 'rascunho',
          responsavel_profissional_id: sessao.profissional,
          registrado_em: new Date(),
          conteudo_rascunho: comoJson(s.conteudo),
          hash_conteudo: s.hashConteudo,
          registrado_usuario_id: sessao.usuario,
          origem: 'sistema',
        });
      },
      (id) => ({ tabela: 'sumario_alta', id }),
      () => ({ dados: { evento: 'pep.sumarioAlta.salvo', versao: s.versao, atendimento: s.atendimento } }),
    );
    return s.versao;
  }

  // ── Relatório de transferência ──────────────────────────────────────────────────────────────────

  transferencias(
    c: ContextoDocs,
    atendimento: number,
  ): Promise<{ id: number; destino: string; em: string; documento: number | null }[]> {
    return this.ler(c, 'transferencias', async (l, est) => {
      const ls = await l.consultar(
        `SELECT id, destino, registrado_em, documento_prontuario_id FROM relatorio_transferencia
          WHERE estabelecimento_id = ? AND atendimento_id = ? AND excluido_em IS NULL AND situacao = 'registrado'
          ORDER BY registrado_em, id`,
        [est.id, atendimento],
      );
      return ls.map((x) => ({
        id: num(x['id']),
        destino: String(x['destino']),
        em: dataHora(x['registrado_em'], est.fuso) ?? '',
        documento: numOuNull(x['documento_prontuario_id']),
      }));
    });
  }

  async registrarTransferencia(
    c: ContextoGravacaoPep,
    t: {
      paciente: number;
      atendimento: number;
      destino: string;
      motivo: string;
      conteudo: string;
      cbo: number | null;
      hashConteudo: string;
      comoSuporte?: boolean;
    },
  ): Promise<{ id: number; documento: number }> {
    const destino = String(t.destino ?? '').trim();
    const motivo = String(t.motivo ?? '').trim();
    if (!destino || !motivo)
      throw new ErroProntuario('entrada-invalida', 'A transferência exige o destino e o motivo.', 422);
    if (!HASH_VALIDO.test(t.hashConteudo))
      throw new ErroProntuario('hash-invalido', 'O resumo do conteúdo do relatório é inválido.', 422);
    return this.gravar(
      c,
      'pep.transferencia.registrar',
      ['relatorio_transferencia', 'documento_prontuario', 'documento_prontuario_evento'],
      async (tx, est, s, falhar) => {
        await this.exigirAtendimento(tx, est.id, t.paciente, t.atendimento, falhar);
        const agora = new Date();
        const id = await tx.incluir('relatorio_transferencia', {
          estabelecimento_id: est.id,
          paciente_id: t.paciente,
          atendimento_id: t.atendimento,
          destino: destino.slice(0, 300),
          motivo: motivo.slice(0, 2000),
          conteudo: comoJson(t.conteudo),
          hash_conteudo: t.hashConteudo,
          profissional_id: s.profissional,
          usuario_id: s.usuario,
          inscricao_conselho_id: this.inscricaoDa(s, t.cbo, falhar),
          registrado_em: agora,
          situacao: 'registrado',
          origem: 'sistema',
        });
        const documento = await this.emitirDocumento(
          tx,
          est.id,
          s,
          {
            paciente: t.paciente,
            atendimento: t.atendimento,
            origem: 'relatorio_transferencia',
            origemId: id,
            categoriaTipo: 'relatorio',
            titulo: 'Relatório de transferência',
            hash: t.hashConteudo,
            comoSuporte: t.comoSuporte === true,
            referencia: agora,
          },
          falhar,
        );
        await tx.alterar('relatorio_transferencia', id, 1, { documento_prontuario_id: documento });
        return { id, documento };
      },
      (r) => ({ tabela: 'relatorio_transferencia', id: r.id }),
      (r) => ({ dados: { evento: 'pep.transferencia.registrada', documento: r.documento } }),
    );
  }

  // ── Óbito ───────────────────────────────────────────────────────────────────────────────────────

  obito(
    c: ContextoDocs,
    paciente: number,
  ): Promise<{
    id: number;
    em: string;
    numero: string | null;
    documento: number | null;
    atendimento: number;
  } | null> {
    return this.ler(c, 'obito', async (l, est) => {
      const x = await l.uma(
        `SELECT id, obito_em, numero, documento_prontuario_id, atendimento_id FROM declaracao_obito
          WHERE estabelecimento_id = ? AND paciente_id = ? AND excluido_em IS NULL AND situacao <> 'cancelada'
          ORDER BY obito_em DESC, id DESC LIMIT 1`,
        [est.id, paciente],
      );
      return x
        ? {
            id: num(x['id']),
            em: dataHora(x['obito_em'], est.fuso) ?? '',
            numero: textoOuNull(x['numero']),
            documento: numOuNull(x['documento_prontuario_id']),
            atendimento: num(x['atendimento_id']),
          }
        : null;
    });
  }

  async registrarObito(
    c: ContextoGravacaoPep,
    o: {
      paciente: number;
      atendimento: number;
      dataHora: Date;
      numero: string | null;
      causas: string;
      causasLinhas?: readonly LinhaCausaObito[];
      cbo: number | null;
      hashConteudo: string;
      comoSuporte?: boolean;
    },
  ): Promise<{ id: number; documento: number }> {
    const numero = textoOuNull(o.numero)?.trim() || null;
    if (numero !== null && numero.length > 11)
      throw new ErroProntuario(
        'numero-invalido',
        'O número da declaração de óbito tem até 11 caracteres.',
        422,
      );
    if (!(o.dataHora instanceof Date) || Number.isNaN(o.dataHora.getTime()))
      throw new ErroProntuario('entrada-invalida', 'A data e hora do óbito é inválida.', 422);
    if (!HASH_VALIDO.test(o.hashConteudo))
      throw new ErroProntuario('hash-invalido', 'O resumo do conteúdo da declaração é inválido.', 422);
    return this.gravar(
      c,
      'pep.obito.registrar',
      [
        'declaracao_obito',
        'declaracao_obito_causa',
        'declaracao_obito_evento',
        'documento_prontuario',
        'documento_prontuario_evento',
      ],
      async (tx, est, s, falhar) => {
        await this.exigirAtendimento(tx, est.id, o.paciente, o.atendimento, falhar);
        // A pessoa morre uma vez: qualquer declaração não cancelada do paciente, em qualquer estabelecimento, recusa.
        const ja = await tx.consultarParaAtualizar(
          `SELECT id FROM declaracao_obito WHERE paciente_id = ? AND excluido_em IS NULL AND situacao <> 'cancelada'`,
          [o.paciente],
        );
        if (ja.length) falhar('ja-registrado', 'O óbito do paciente já foi registrado.');
        // O número da declaração é único no estabelecimento (uq_declaracao_obito_numero): repetido, recusa com 409.
        if (
          numero !== null &&
          (await tx.uma(
            'SELECT id FROM declaracao_obito WHERE estabelecimento_id = ? AND numero = ? LIMIT 1',
            [est.id, numero],
          ))
        )
          falhar('numero-repetido', 'Já existe declaração de óbito com este número no estabelecimento.');
        this.inscricaoDa(s, o.cbo, falhar);
        const agora = new Date();
        const id = await tx.incluir('declaracao_obito', {
          estabelecimento_id: est.id,
          atendimento_id: o.atendimento,
          paciente_id: o.paciente,
          numero,
          obito_em: o.dataHora,
          profissional_id: s.profissional,
          situacao: numero === null ? 'rascunho' : 'emitida',
          emitida_em: numero === null ? null : agora,
          causas_declaradas: String(o.causas ?? ''),
          origem: 'sistema',
        });
        const documento = await this.emitirDocumento(
          tx,
          est.id,
          s,
          {
            paciente: o.paciente,
            atendimento: o.atendimento,
            origem: 'declaracao_obito',
            origemId: id,
            categoriaTipo: 'declaracao',
            titulo: 'Declaração de óbito',
            hash: o.hashConteudo,
            comoSuporte: o.comoSuporte === true,
            referencia: o.dataHora,
          },
          falhar,
        );
        await tx.alterar('declaracao_obito', id, 1, { documento_prontuario_id: documento });
        // As causas em linhas (parte I e II), na ordem em que o médico as declarou.
        for (const l of o.causasLinhas ?? [])
          await tx.incluir('declaracao_obito_causa', {
            declaracao_obito_id: id,
            sequencia: l.sequencia,
            parte: l.parte,
            linha: l.linha,
            descricao: l.descricao,
            origem: 'sistema',
          });
        // A emissão (com número) é o primeiro evento da declaração; o rascunho ainda não tem evento.
        if (numero !== null)
          await tx.incluir('declaracao_obito_evento', {
            declaracao_obito_id: id,
            operacao: 'inclusao',
            tipo_evento: 'emissao',
            numero,
            ocorrido_em: agora,
            usuario_id: s.usuario,
          });
        return { id, documento };
      },
      (r) => ({ tabela: 'declaracao_obito', id: r.id }),
      (r) => ({ dados: { evento: 'pep.obito.registrado', documento: r.documento } }),
    );
  }

  /**
   * Cancela a declaração vigente do paciente no estabelecimento (03-PEP L126), na mesma transação:
   *   - na declaração, a situação, a data e o motivo (o rascunho cancelado segue sem data de emissão: não houve emissão);
   *   - o evento de cancelamento da declaração;
   *   - o documento do prontuário sai de vigência (situação de categoria "cancelado") com o evento "cancelamento" e o
   *     motivo na cadeia de eventos do documento; a fila de assinatura e a validação deixam de tratá-lo como vigente.
   * Só o médico que emitiu cancela. Nada é apagado; o paciente pode receber uma nova declaração.
   */
  async cancelarObito(
    c: ContextoGravacaoPep,
    o: { paciente: number; motivo: string; cbo: number | null },
  ): Promise<{ id: number; documento: number | null }> {
    return this.gravar(
      c,
      'pep.obito.cancelar',
      ['declaracao_obito', 'declaracao_obito_evento', 'documento_prontuario', 'documento_prontuario_evento'],
      async (tx, est, s, falhar) => {
        this.inscricaoDa(s, o.cbo, falhar);
        const d = (
          await tx.consultarParaAtualizar(
            `SELECT id, versao, situacao, numero, documento_prontuario_id, profissional_id FROM declaracao_obito
              WHERE estabelecimento_id = ? AND paciente_id = ? AND excluido_em IS NULL AND situacao <> 'cancelada'
              ORDER BY obito_em DESC, id DESC LIMIT 1`,
            [est.id, o.paciente],
          )
        )[0];
        if (!d) falhar('registro-inexistente', 'O paciente não tem declaração de óbito vigente.', 404);
        const situacao = String(d!['situacao']) as 'rascunho' | 'emitida';
        const v = validarCancelamentoObito(situacao, o.motivo, num(d!['profissional_id']) === s.profissional);
        if (!v.ok) falhar(v.codigo, v.mensagem, statusDaRecusaObito(v.codigo));
        const motivo = (v as { motivo: string }).motivo;
        const agora = new Date();
        const id = num(d!['id']);
        // Sem data de emissão inventada: o rascunho cancelado fica com emitida_em nulo (06_PEP/99_obito_rascunho).
        await tx.alterar('declaracao_obito', id, num(d!['versao']), {
          situacao: 'cancelada',
          cancelada_em: agora,
          motivo_cancelamento: motivo,
        });
        await tx.incluir('declaracao_obito_evento', {
          declaracao_obito_id: id,
          operacao: 'alteracao',
          tipo_evento: 'cancelamento',
          numero: textoOuNull(d!['numero']),
          motivo,
          ocorrido_em: agora,
          usuario_id: s.usuario,
        });
        const documento = numOuNull(d!['documento_prontuario_id']);
        if (documento !== null) {
          const cancelado = await tx.uma(
            `SELECT id FROM situacao_documento_prontuario WHERE categoria = 'cancelado' AND ativo = TRUE
              ORDER BY (ordem IS NULL), ordem, id LIMIT 1`,
          );
          if (!cancelado)
            falhar(
              'situacao-documento-sem-cadastro',
              'O cliente não tem situação de documento ativa na categoria "cancelado".',
            );
          const [dp] = await tx.consultarParaAtualizar(
            'SELECT id, versao FROM documento_prontuario WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
            [documento, est.id],
          );
          if (dp) {
            await tx.alterar('documento_prontuario', documento, num(dp['versao']), {
              situacao_documento_prontuario_id: num(cancelado!['id']),
            });
            await tx.incluir('documento_prontuario_evento', {
              documento_prontuario_id: documento,
              operacao: 'alteracao',
              acao: 'cancelamento',
              situacao_documento_prontuario_id: num(cancelado!['id']),
              profissional_id: s.profissional,
              justificativa: motivo,
              evento_em: agora,
              dados: JSON.stringify({ declaracao_obito: id }),
              ocorrido_em: agora,
              usuario_id: s.usuario,
            });
          }
        }
        return { id, documento };
      },
      (r) => ({ tabela: 'declaracao_obito', id: r.id }),
      (r) => ({ motivo: o.motivo.trim(), dados: { evento: 'pep.obito.cancelado', documento: r.documento } }),
    );
  }

  // ── Ciência de valor crítico ────────────────────────────────────────────────────────────────────

  ciencias(c: ContextoDocs, paciente: number): Promise<CienciaLida[]> {
    return this.ler(c, 'ciencias', async (l, est) => {
      // O teto corta as ciências mais antigas (as mais recentes ficam), e a lista sai em ordem cronológica.
      const ls = await l.consultar(
        `SELECT x.* FROM (
           SELECT cr.id, cr.resultado_exame_id, cr.ciente_em, cr.conduta, cr.analito,
                  COALESCE(u.login, ${SQL_LOGIN_DO_PROFISSIONAL('cr.ciente_profissional_id', 'cr.estabelecimento_id')}) AS login
             FROM ciencia_resultado_critico cr
             LEFT JOIN usuario u ON u.id = cr.ciente_usuario_id
            WHERE cr.estabelecimento_id = ? AND cr.paciente_id = ? AND cr.excluido_em IS NULL AND cr.situacao = 'ciente'
            ORDER BY cr.ciente_em DESC, cr.id DESC LIMIT ${TETO_LISTA}
         ) x
         ORDER BY x.ciente_em, x.id`,
        [est.id, paciente],
      );
      return ls.map((x) => ({
        exame: num(x['resultado_exame_id']),
        usuario: textoOuNull(x['login']) ?? '',
        em: dataHora(x['ciente_em'], est.fuso) ?? '',
        conduta: textoOuNull(x['conduta']) ?? '',
        elemento: textoOuNull(x['analito']),
      }));
    });
  }

  /**
   * A ciência do valor crítico de um resultado (exame = id do resultado do exame). A comunicação já aberta pelo
   * laboratório (aguardando ciência ou sem contato) é fechada; sem ela, a ciência é registrada pelo próprio sistema.
   */
  async registrarCiencia(
    c: ContextoGravacaoPep,
    x: {
      paciente: number;
      exame: number;
      chave: string;
      resultado: number | null;
      elemento: string | null;
      conduta: string;
      escalonadoPara: string | null;
    },
  ): Promise<number> {
    const conduta = String(x.conduta ?? '').trim();
    if (!conduta) throw new ErroProntuario('entrada-invalida', 'A ciência exige a conduta.', 422);
    return this.gravar(
      c,
      'pep.resultado.ciencia',
      ['ciencia_resultado_critico'],
      async (tx, est, s, falhar) => {
        // O resultado tem de ser do paciente informado e do estabelecimento (do pedido ou do setor executante):
        // a ciência nunca é gravada no paciente errado.
        const r = await tx.uma(
          `SELECT r.id FROM resultado_exame r
             JOIN exame_item ei ON ei.id = r.exame_item_id
             JOIN requisicao_exame rq ON rq.id = ei.requisicao_exame_id
             JOIN setor_diagnostico sd ON sd.id = r.setor_diagnostico_id
            WHERE r.id = ? AND r.paciente_id = ? AND r.excluido_em IS NULL
              AND (rq.estabelecimento_id = ? OR sd.estabelecimento_id = ?)`,
          [x.exame, x.paciente, est.id, est.id],
        );
        if (!r) return falhar('nao-encontrado', 'Resultado não encontrado.', 404);
        const ls = await tx.consultarParaAtualizar(
          `SELECT id, versao, situacao FROM ciencia_resultado_critico
            WHERE estabelecimento_id = ? AND paciente_id = ? AND resultado_exame_id = ? AND excluido_em IS NULL
            ORDER BY id`,
          [est.id, x.paciente, x.exame],
        );
        if (ls.some((y) => y['situacao'] === 'ciente'))
          falhar('ja-ciente', 'A ciência deste resultado já foi registrada.');
        const agora = new Date();
        const ciencia = {
          situacao: 'ciente',
          ciente_profissional_id: s.profissional,
          ciente_usuario_id: s.usuario,
          ciente_em: agora,
          conduta,
          escalonado_para: textoOuNull(x.escalonadoPara)?.slice(0, 150) ?? null,
        };
        const aberta = ls.find(
          (y) => y['situacao'] === 'aguardando_ciencia' || y['situacao'] === 'sem_contato',
        );
        if (aberta) {
          const id = num(aberta['id']);
          await tx.alterar('ciencia_resultado_critico', id, num(aberta['versao']), {
            ...ciencia,
            ...(x.elemento ? { analito: x.elemento.slice(0, 150) } : {}),
          });
          return id;
        }
        return tx.incluir('ciencia_resultado_critico', {
          estabelecimento_id: est.id,
          resultado_exame_id: x.exame,
          paciente_id: x.paciente,
          analito: x.elemento?.slice(0, 150) ?? null,
          comunicante_usuario_id: s.usuario,
          comunicado_em: agora,
          canal_comunicacao: 'sistema',
          origem: 'sistema',
          ...ciencia,
        });
      },
      (id) => ({ tabela: 'ciencia_resultado_critico', id }),
      () => ({ dados: { evento: 'pep.resultado.ciente', exame: x.exame } }),
    );
  }
}
