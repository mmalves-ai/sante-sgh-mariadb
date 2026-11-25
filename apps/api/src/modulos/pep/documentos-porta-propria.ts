// Porta PRÓPRIA dos documentos do prontuário (M23) sobre o banco do cliente (MariaDB, pelo @sgh/nucleo). Leituras pelo
// Leitor (somente leitura); gravações pelo Executor (trilha, idempotência e versão na mesma transação).
// Ciclo principal desta etapa (o que a tela de assinaturas e a linha do tempo do documento usam):
//   - profissional da sessão: usuario → usuario_vinculo_profissional (estabelecimento, vigente) → profissional →
//     pessoa_fisica (nome), inscricao_conselho (+ ocupacao_cbo) e profissional_especialidade;
//   - documentos do prontuário: documento_prontuario (+ tipo_documento_clinico, situacao_documento_prontuario), o
//     envelope assinado (documento_assinado) e a cadeia de eventos (documento_prontuario_evento);
//   - emitir o documento do registro clínico (registro_assistencial → documento_prontuario, evento "criacao", e o
//     vínculo de volta em registro_assistencial.documento_prontuario_id);
//   - assinar na sessão (situação de categoria "assinado", fechado_em e evento "assinatura" com nível e resumo);
//   - eventos de impressão, segunda via e exportação na cadeia; a visualização vai só à trilha (consulta).
//   - paciente, atendimentos (com internação, leito, fonte pagadora e médico), retratos (referência = id vigente) e
//     a linha do tempo (atendimentos, registros e pareceres): a abertura de "Registros do paciente".
// Autoria do documento: o login de quem emitiu (evento "criacao"), nunca o vínculo de hoje; a fila, a prévia e a
// assinatura usam esse mesmo critério. O vínculo encerrado mantém a categoria do autor (o sigilo não abre).
// Tipo de negócio do documento pela origem e pela categoria do tipo (registro-clinico, receita, tcle...), nunca o
// código do catálogo do cliente.
// O que ainda não tem adaptador próprio recusa com 501 `pendente-modelo-proprio` (falha fechada, nada lido nem gravado).
// Registro clínico nunca é apagado: nenhuma exclusão física; a correção é nova versão ou cancelamento com motivo.
// Melhoria: o resumo (SHA-256) do documento ainda sem envelope fica no conteúdo estruturado (conteudo.hash_conteudo),
// gravado na emissão; com o envelope assinado, vale o resumo do envelope.
// Melhoria: a situação gravada é escolhida pela categoria (lancado, assinado) no catálogo do cliente, sem código fixo.
// Melhoria: só documentos em situação assinável (lançado, validado, aguardando assinatura) entram na fila e são
// assinados; os demais (rascunho, suspenso, corrigido, cancelado, arquivado) aparecem como suspensos.
import { createHash, randomUUID } from 'node:crypto';
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
import type { ContextoDocs, PortaDocumentos, ProfissionalPep } from './documentos-porta.js';
import * as Alergias from './alergias-propria.js';
import * as HistoricoAlergias from './alergias-historico-propria.js';
import * as Painel from './documentos-propria-painel.js';
import * as NovaVia from './documentos-nova-via-propria.js';
import { DocumentosPropriaExames, type LeitorArquivos } from './documentos-propria-exames.js';
import { OPERACOES_PEP_RESTO, operacoesDocumentosPropria } from './documentos-propria-operacoes.js';
import {
  OPERACOES_PEP_RESTO_2,
  operacoesDocumentosPropria2,
  type GravadorArquivos,
} from './documentos-propria-operacoes-2.js';
import { DocumentosPropriaPareceres } from './documentos-propria-pareceres.js';
import { dataHora, fusoValido } from './registro-porta-propria.js';
import type { NucleoDocumentosPep } from './documentos-propria-comum.js';
import type {
  AtendimentoPepLido,
  ContextoGravacaoPep,
  DocumentoProprioLido,
  EventoLido,
  PacientePepLido,
  RetratosAtuais,
} from './tipos-pep.js';

// A base comum continua exportada por aqui (as partes da porta a importam desta porta).
export { type NucleoDocumentosPep, recusaPendente } from './documentos-propria-comum.js';

/** Situações em que o documento pode ser assinado (lista positiva). */
export const CATEGORIAS_ASSINAVEIS: readonly string[] = ['lancado', 'validado', 'aguardando_assinatura'];
/** Teto de documentos devolvidos por paciente e na fila do autor. */
export const TETO_DOCUMENTOS = 500;
/** Teto de itens por lote de assinatura e de ids por lista. */
export const TETO_LOTE = 200;

export const MOTIVO_GRAVACAO_PENDENTE =
  'A gravação pelo executor do estabelecimento ainda não tem adaptador no banco próprio.';

const TABELAS_DOCUMENTOS = [
  'documento_prontuario',
  'documento_prontuario_evento',
  'registro_assistencial',
  'exportacao_documento',
  'registro_reimpressao',
] as const;

const num = (v: unknown): number => Number(v);
const numOuNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const textoOuNull = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const sha256 = (t: string): string => createHash('sha256').update(t, 'utf8').digest('hex');
const marcadores = (n: number): string => Array.from({ length: n }, () => '?').join(', ');
const idsValidos = (ids: readonly number[]): number[] =>
  [...new Set(ids)].filter((i) => Number.isSafeInteger(i) && i > 0).slice(0, TETO_LOTE);

/** Conteúdo estruturado (JSON) lido do banco: objeto, texto JSON ou nulo. */
function conteudoDe(v: unknown): Record<string, unknown> {
  if (v === null || v === undefined) return {};
  if (typeof v === 'object' && !Buffer.isBuffer(v)) return v as Record<string, unknown>;
  try {
    const o: unknown = JSON.parse(String(v));
    return o && typeof o === 'object' ? (o as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Número de negócio do atendimento (texto) como número; sem dígitos, o id. */
function numeroDeNegocio(numero: unknown, id: unknown): number {
  const n = Number(String(numero ?? '').replace(/\D/g, ''));
  return Number.isSafeInteger(n) && n > 0 ? n : num(id);
}

const recusar = (status: number, codigo: string, detalhe: string): ErroOperacao =>
  new ErroOperacao(status, codigo, 'Operação recusada', detalhe);

/**
 * O autor do documento, fixado pelo próprio documento e nunca pelo vínculo de hoje: a conta que emitiu (usuário do
 * evento "criacao", gravado na emissão, como o login gravado na porta de memória). Documento sem evento de criação
 * (vindo de importação): a conta ligada ao profissional do documento no estabelecimento, vigente primeiro e, sem ela,
 * a mais recente, mesmo vencida ou excluída (o autor de um documento não muda quando o vínculo acaba).
 */
const SQL_LOGIN_DO_AUTOR = `
  COALESCE(
    (SELECT u.login FROM documento_prontuario_evento ec JOIN usuario u ON u.id = ec.usuario_id
      WHERE ec.documento_prontuario_id = dp.id AND ec.acao = 'criacao'
      ORDER BY ec.ocorrido_em, ec.id LIMIT 1),
    (SELECT u.login FROM usuario_vinculo_profissional v JOIN usuario u ON u.id = v.usuario_id
      WHERE v.profissional_id = dp.profissional_id AND v.estabelecimento_id = dp.estabelecimento_id
      ORDER BY (v.excluido_em IS NULL AND v.vigencia_inicio <= CURRENT_DATE
                AND (v.vigencia_fim IS NULL OR v.vigencia_fim >= CURRENT_DATE)) DESC,
               v.vigencia_inicio DESC, v.id DESC LIMIT 1))`;

/** A última assinatura na cadeia do documento (evento). */
const SQL_ULTIMA_ASSINATURA = (coluna: string) => `
  (SELECT ev.${coluna} FROM documento_prontuario_evento ev
    WHERE ev.documento_prontuario_id = dp.id AND ev.acao = 'assinatura'
    ORDER BY ev.ocorrido_em DESC, ev.id DESC LIMIT 1)`;

const SQL_DOCUMENTOS = `
  SELECT dp.id, t.categoria AS categoria_tipo, dp.entidade_origem, dp.entidade_origem_id, dp.paciente_id, dp.atendimento_id,
         dp.lancado_em, dp.conteudo, s.categoria, da.hash_conteudo, da.nivel_exigido, da.concluido_em,
         ${SQL_ULTIMA_ASSINATURA('ocorrido_em')} AS assinado_em,
         ${SQL_ULTIMA_ASSINATURA('dados')} AS dados_assinatura,
         ${SQL_LOGIN_DO_AUTOR} AS autor
    FROM documento_prontuario dp
    JOIN tipo_documento_clinico t ON t.id = dp.tipo_documento_clinico_id
    JOIN situacao_documento_prontuario s ON s.id = dp.situacao_documento_prontuario_id
    LEFT JOIN documento_assinado da ON da.id = dp.documento_assinado_id AND da.excluido_em IS NULL
   WHERE dp.estabelecimento_id = ? AND dp.excluido_em IS NULL`;

/** Estabelecimento da sessão: id e fuso IANA em que as datas e horas são mostradas. */
interface Estabelecimento {
  readonly id: number;
  readonly fuso: string;
}

/** Tipo de negócio do documento pela tabela de origem (o vocabulário que o serviço usa nos títulos e regras). */
const TIPO_DA_ORIGEM: Readonly<Record<string, string>> = {
  registro_assistencial: 'registro-clinico',
  receita_medica: 'receita',
  requisicao_exame: 'pedido-exame',
  exame_lancado_prontuario: 'exame-externo',
  anexo_prontuario: 'anexo',
  alergia_paciente: 'alergia',
  relatorio_transferencia: 'rel-transferencia',
  declaracao_obito: 'declaracao-obito',
  fechamento_checagem_paciente: 'registro-enfermagem-turno',
};
/** Sem origem conhecida: pela categoria do tipo de documento clínico do cliente. */
const TIPO_DA_CATEGORIA: Readonly<Record<string, string>> = {
  receita: 'receita',
  atestado: 'atestado',
  declaracao: 'declaracao',
  sumario: 'sumario-alta',
  termo: 'tcle',
  prescricao: 'registro-clinico',
  evolucao: 'registro-clinico',
  anamnese: 'registro-clinico',
  admissao: 'registro-clinico',
  exame_fisico: 'registro-clinico',
  diagnostico: 'registro-clinico',
  laudo: 'registro-clinico',
  registro_cirurgico: 'registro-clinico',
  parecer: 'registro-clinico',
  relatorio: 'registro-clinico',
};

/** Origem e categoria do tipo de documento → tipo de negócio; categoria "outro" ou desconhecida: 'documento'. */
export function tipoDeNegocio(origem: string, categoriaTipo: string): string {
  return TIPO_DA_ORIGEM[origem] ?? TIPO_DA_CATEGORIA[categoriaTipo] ?? 'documento';
}

/** Linha do documento → tipo de negócio (vocabulário neutro). */
/** O documento lido com o conteúdo estruturado gravado nele (o registro de enfermagem do turno, C1-023). */
export type DocumentoComRegistro = DocumentoProprioLido & {
  readonly registro?: Readonly<Record<string, unknown>> | null;
};

export function documentoLido(x: Record<string, unknown>, fuso: string): DocumentoComRegistro {
  const conteudo = conteudoDe(x['conteudo']);
  const assinatura = conteudoDe(x['dados_assinatura']);
  const assinadoEm = x['concluido_em'] ?? x['assinado_em'] ?? null;
  const categoria = String(x['categoria']);
  return {
    id: num(x['id']),
    tipo: tipoDeNegocio(String(x['entidade_origem']), String(x['categoria_tipo'])),
    origemTabela: String(x['entidade_origem']),
    origemId: num(x['entidade_origem_id']),
    paciente: num(x['paciente_id']),
    atendimento: numOuNull(x['atendimento_id']),
    usuario: textoOuNull(x['autor']) ?? '',
    // O resumo do envelope assinado; antes dele, o gravado na emissão; sem os dois, o do conteúdo estruturado.
    hash:
      textoOuNull(x['hash_conteudo']) ??
      textoOuNull(conteudo['hash_conteudo']) ??
      sha256(JSON.stringify(x['conteudo'] ?? null)),
    nivel:
      textoOuNull(x['nivel_exigido']) ??
      textoOuNull(assinatura['nivel']) ??
      textoOuNull(conteudo['nivel']) ??
      'sem-assinatura',
    criadoEm: dataHora(x['lancado_em'], fuso),
    assinadoEm: dataHora(assinadoEm, fuso),
    suspenso: !CATEGORIAS_ASSINAVEIS.includes(categoria) && categoria !== 'assinado',
    comoSuporte: conteudo['como_suporte'] === true || assinatura['comoSuporte'] === true,
    // Só o documento com conteúdo estruturado gravado (o registro de enfermagem do turno) traz o campo.
    ...(conteudo['registro'] && typeof conteudo['registro'] === 'object'
      ? { registro: conteudo['registro'] as Record<string, unknown> }
      : {}),
  };
}

export class PortaDocumentosPropria implements PortaDocumentos {
  readonly destino = 'proprio' as const;
  private readonly executor: Executor;
  private readonly exames: DocumentosPropriaExames;
  private readonly pareceres: DocumentosPropriaPareceres;
  /** Alergia, emissão de documento, exame externo e sumário de alta (documentos-propria-operacoes.ts). */
  private readonly opsResto: Readonly<Record<string, Painel.GravacaoDocumentos>>;

  constructor(
    private readonly nucleo: NucleoDocumentosPep,
    /** Cliente desta API (configuração; um banco por cliente), quando o contexto da sessão não o traz. */
    private readonly cliente: string,
    executor?: Executor,
    /** Porta de armazenamento de arquivos (ADR 0004); sem ela, abrir e anexar recusam com 503. */
    arquivos: (LeitorArquivos & Partial<GravadorArquivos>) | null = null,
  ) {
    this.executor = executor ?? nucleo.criarExecutor();
    this.exames = new DocumentosPropriaExames(nucleo, cliente, arquivos, this.executor);
    this.pareceres = new DocumentosPropriaPareceres(nucleo, cliente, this.executor);
    this.opsResto = {
      ...operacoesDocumentosPropria(nucleo, cliente, this.executor),
      ...operacoesDocumentosPropria2(nucleo, cliente, arquivos, this.executor),
    };
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

  /** O profissional ligado ao login no estabelecimento (vínculo vigente), ou null. */
  private async profissionalDoLogin(
    l: Leitor,
    est: number,
    login: string,
  ): Promise<{ usuario: number; profissional: number | null; nome: string | null } | null> {
    if (!login) return null;
    const u = await l.uma(
      `SELECT u.id AS usuario, p.id AS profissional, pf.nome
         FROM usuario u
         LEFT JOIN usuario_vinculo_profissional v ON v.usuario_id = u.id AND v.estabelecimento_id = ?
               AND v.profissional_id IS NOT NULL AND v.excluido_em IS NULL
               AND v.vigencia_inicio <= CURRENT_DATE AND (v.vigencia_fim IS NULL OR v.vigencia_fim >= CURRENT_DATE)
         LEFT JOIN profissional p ON p.id = v.profissional_id AND p.excluido_em IS NULL
         LEFT JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id AND pf.excluido_em IS NULL
        WHERE u.login = ? AND u.excluido_em IS NULL
        ORDER BY (p.id IS NULL), v.vigencia_inicio DESC, v.id DESC LIMIT 1`,
      [est, login],
    );
    if (!u) return null;
    return {
      usuario: num(u['usuario']),
      profissional: numOuNull(u['profissional']),
      nome: textoOuNull(u['nome']),
    };
  }

  // ── Leituras do ciclo principal ─────────────────────────────────────────────────────────────────

  agora(c: ContextoDocs): Promise<string> {
    // O relógio é o do banco (instante em UTC), mostrado no fuso do estabelecimento.
    return this.ler(c, 'agora', async (l, est) => {
      const x = await l.uma('SELECT UTC_TIMESTAMP(3) AS agora');
      const v = x?.['agora'];
      const instante = v instanceof Date ? v : new Date(`${String(v).replace(' ', 'T')}Z`);
      return dataHora(instante, est.fuso) ?? '';
    });
  }

  /**
   * O vínculo encerrado (vencido ou excluído) mais recente do login no estabelecimento: o autor de um documento antigo
   * continua com a sua categoria (o sigilo da categoria não abre quando o vínculo acaba).
   */
  private async profissionalEncerrado(
    l: Leitor,
    est: number,
    login: string,
  ): Promise<{ usuario: number; profissional: number; nome: string | null } | null> {
    if (!login) return null;
    const u = await l.uma(
      `SELECT u.id AS usuario, p.id AS profissional, pf.nome
         FROM usuario u
         JOIN usuario_vinculo_profissional v ON v.usuario_id = u.id AND v.estabelecimento_id = ?
         JOIN profissional p ON p.id = v.profissional_id
         LEFT JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
        WHERE u.login = ?
        ORDER BY v.vigencia_inicio DESC, v.id DESC LIMIT 1`,
      [est, login],
    );
    return u
      ? { usuario: num(u['usuario']), profissional: num(u['profissional']), nome: textoOuNull(u['nome']) }
      : null;
  }

  profissional(c: ContextoDocs, login: string): Promise<ProfissionalPep | null> {
    return this.ler(c, 'profissional', async (l, est) => {
      const vigente = await this.profissionalDoLogin(l, est.id, login);
      // Sem vínculo vigente, o vínculo encerrado dá a categoria (sigilo), com o conselho tido como inativo: nada é
      // liberado para praticar por ele (falha fechada).
      const p =
        vigente && vigente.profissional !== null
          ? { ...vigente, profissional: vigente.profissional, ativo: true }
          : await this.profissionalEncerrado(l, est.id, login).then((x) =>
              x ? { ...x, ativo: false } : null,
            );
      if (!p) return null;
      // A inscrição no conselho é a "ocupação do registro" (cbo = id da inscrição; codigo = CBO 2002).
      const inscricoes = await l.consultar(
        `SELECT i.id, i.situacao, o.codigo_cbo
           FROM inscricao_conselho i
           LEFT JOIN ocupacao_cbo o ON o.id = i.ocupacao_cbo_id
          WHERE i.profissional_id = ? AND i.excluido_em IS NULL
          ORDER BY i.principal DESC, i.sequencia, i.id`,
        [p.profissional],
      );
      const ocupacoes = inscricoes
        .filter((i) => textoOuNull(i['codigo_cbo']) !== null)
        .map((i) => ({
          cbo: num(i['id']),
          codigo: String(i['codigo_cbo']),
          conselhoAtivo: p.ativo && ['ativa', 'provisoria'].includes(String(i['situacao'])),
        }));
      const principal = ocupacoes.find((o) => o.conselhoAtivo) ?? ocupacoes[0];
      if (!principal) return null;
      const especialidades = await l.consultar(
        `SELECT especialidade_medica_id FROM profissional_especialidade
          WHERE profissional_id = ? AND ativo = TRUE AND excluido_em IS NULL
          ORDER BY principal DESC, especialidade_medica_id`,
        [p.profissional],
      );
      return {
        idUsuario: p.usuario,
        idProfissional: p.profissional,
        nome: p.nome,
        cbo: principal.cbo,
        cbos: ocupacoes.map((o) => o.cbo),
        especialidades: especialidades.map((e) => num(e['especialidade_medica_id'])),
        // A tolerância de lançamento retroativo é do tipo de documento; aqui fica fechada (falha fechada).
        permiteRetroativo: false,
        ocupacoes,
      };
    });
  }

  ocupacaoDoCbo(c: ContextoDocs, cbo: number): Promise<string | null> {
    return this.ler(c, 'ocupacao', async (l) => {
      const x = await l.uma(
        `SELECT o.codigo_cbo FROM inscricao_conselho i JOIN ocupacao_cbo o ON o.id = i.ocupacao_cbo_id
          WHERE i.id = ? AND i.excluido_em IS NULL`,
        [cbo],
      );
      return x ? textoOuNull(x['codigo_cbo']) : null;
    });
  }

  nomes(c: ContextoDocs, ids: readonly number[]): Promise<Map<number, string>> {
    const validos = idsValidos(ids);
    if (!validos.length) return Promise.resolve(new Map());
    return this.ler(c, 'nomes', async (l) => {
      const ls = await l.consultar(
        `SELECT p.id, COALESCE(pf.nome_social, pf.nome) AS nome
           FROM paciente p JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
          WHERE p.id IN (${marcadores(validos.length)}) AND p.excluido_em IS NULL`,
        validos,
      );
      return new Map(ls.map((x) => [num(x['id']), String(x['nome'])]));
    });
  }

  unidades(c: ContextoDocs): Promise<{ id: number; nome: string }[]> {
    return this.ler(c, 'unidades', async (l, est) => {
      const ls = await l.consultar(
        `SELECT id, nome FROM unidade_assistencial
          WHERE estabelecimento_id = ? AND excluido_em IS NULL ORDER BY nome, id`,
        [est.id],
      );
      return ls.map((x) => ({ id: num(x['id']), nome: String(x['nome']) }));
    });
  }

  documentosSgh(c: ContextoDocs, paciente: number): Promise<DocumentoProprioLido[]> {
    return this.ler(c, 'lista', async (l, est) => {
      const ls = await l.consultar(
        `${SQL_DOCUMENTOS} AND dp.paciente_id = ? ORDER BY dp.referencia_em DESC, dp.id DESC LIMIT ${TETO_DOCUMENTOS}`,
        [est.id, paciente],
      );
      return ls.map((x) => documentoLido(x, est.fuso));
    });
  }

  documentoSgh(c: ContextoDocs, id: number): Promise<DocumentoProprioLido | null> {
    return this.ler(c, 'documento', async (l, est) => {
      const x = await l.uma(`${SQL_DOCUMENTOS} AND dp.id = ?`, [est.id, id]);
      return x ? documentoLido(x, est.fuso) : null;
    });
  }

  documentoSghDaOrigem(c: ContextoDocs, tabela: string, id: number): Promise<DocumentoProprioLido | null> {
    return this.ler(c, 'origem', async (l, est) => {
      // A versão vigente do documento da origem (a de maior número).
      const x = await l.uma(
        `${SQL_DOCUMENTOS} AND dp.entidade_origem = ? AND dp.entidade_origem_id = ?
          ORDER BY dp.numero_versao DESC, dp.id DESC LIMIT 1`,
        [est.id, tabela, id],
      );
      return x ? documentoLido(x, est.fuso) : null;
    });
  }

  pendencias(c: ContextoDocs, login: string): Promise<DocumentoProprioLido[]> {
    // A autoria é a mesma da prévia e da assinatura: o login fixado no documento (SQL_LOGIN_DO_AUTOR).
    if (!login) return Promise.resolve([]);
    return this.ler(c, 'pendencias', async (l, est) => {
      const ls = await l.consultar(
        `${SQL_DOCUMENTOS} AND ${SQL_LOGIN_DO_AUTOR} = ? AND s.categoria IN (${marcadores(CATEGORIAS_ASSINAVEIS.length)})
            AND (da.id IS NULL OR da.concluido_em IS NULL)
            AND NOT EXISTS (SELECT 1 FROM documento_prontuario_evento ev
                             WHERE ev.documento_prontuario_id = dp.id AND ev.acao = 'assinatura'
                               AND (ev.profissional_id IS NULL OR ev.profissional_id = dp.profissional_id))
          ORDER BY dp.lancado_em, dp.id LIMIT ${TETO_DOCUMENTOS}`,
        [est.id, login, ...CATEGORIAS_ASSINAVEIS],
      );
      return ls.map((x) => documentoLido(x, est.fuso));
    });
  }

  /**
   * Passo 0 do executor: a operação com adaptador próprio (Painel.OPERACOES_PAINEL) pede o profissional da sessão com
   * inscrição ativa no conselho; a sem adaptador recusa com `pendente-modelo-proprio` (falha fechada).
   */
  podeGravar(...a: Parameters<PortaDocumentos['podeGravar']>) {
    return Painel.podeGravar(this.nucleo, this.cliente, ...a, [
      ...Painel.OPERACOES_PAINEL,
      ...OPERACOES_PEP_RESTO,
      ...OPERACOES_PEP_RESTO_2,
    ]);
  }

  /** No banco próprio não há outro sistema de onde trazer pedidos de parecer: nada a trazer. */
  async trazerPedidosAnteriores(): Promise<number> {
    return 0;
  }

  // ── Gravações do ciclo principal (Executor, com a trilha) ───────────────────────────────────────

  /**
   * Uma gravação pelo Executor: a transação, a trilha (com a ação e os dados extras) e a idempotência do núcleo. O
   * resultado completo volta a quem chama; à trilha vai só o resumo (ids e contagens).
   */
  private async gravar<T>(
    c: ContextoGravacaoPep,
    nome: string,
    fn: (tx: TxOperacao, est: number, usuario: number) => Promise<T>,
    alvo: (r: T) => { tabela: string; id: number | null },
    extras: (r: T) => ExtrasTrilha,
  ): Promise<T> {
    const cliente = this.clienteDe(c);
    const ident = await this.ler(c, 'identidade', async (l, est) => ({
      est: est.id,
      usuario: c.usuario ?? (await this.profissionalDoLogin(l, est.id, c.usuarioLogin))?.usuario ?? null,
    }));
    if (ident.usuario === null)
      throw recusar(403, 'usuario-inexistente', 'O usuário da sessão não existe neste cliente.');
    const usuario = ident.usuario;
    const contexto: ContextoOperacao = {
      cliente,
      estabelecimento: ident.est,
      usuario,
      correlacao: (c.correlacao || c.traceId || nome).slice(0, 64),
      chaveIdempotencia: `${nome}:${randomUUID()}`,
    };
    let feito: { r: T } | null = null;
    const op = definirOperacao({
      nome,
      tabelas: TABELAS_DOCUMENTOS,
      entrada: z.object({}).strict(),
      gravar: async (tx: TxOperacao) => {
        const r = await fn(tx, ident.est, usuario);
        feito = { r };
        const a = alvo(r);
        return { tabela: a.tabela, id: a.id };
      },
      alvo: (_e, s) => ({ tabela: String(s['tabela']), id: s['id'] === null ? null : Number(s['id']) }),
      trilha: () => (feito ? extras((feito as { r: T }).r) : {}),
    });
    await this.executor.executar(op, cliente, {}, contexto);
    if (!feito) throw new Error(`A operação ${nome} terminou sem resultado.`);
    return (feito as { r: T }).r;
  }

  /** Primeira situação ativa da categoria no catálogo do cliente (ordem, id); sem ela, recusa (falha fechada). */
  private async situacaoDaCategoria(tx: TxOperacao, categoria: string): Promise<number> {
    const s = await tx.uma(
      `SELECT id FROM situacao_documento_prontuario WHERE categoria = ? AND ativo = TRUE
        ORDER BY (ordem IS NULL), ordem, id LIMIT 1`,
      [categoria],
    );
    if (!s)
      throw recusar(
        409,
        'situacao-documento-sem-cadastro',
        `O cliente não tem situação de documento ativa na categoria "${categoria}".`,
      );
    return num(s['id']);
  }

  async documentoDoRegistroClinico(
    c: ContextoGravacaoPep,
    r: { registro: number; paciente: number; atendimento: number | null; hash: string },
  ): Promise<number> {
    const existente = await this.documentoSghDaOrigem(c, 'registro_assistencial', r.registro);
    if (existente) return existente.id;
    const feito = await this.gravar(
      c,
      'pep.documento.emitir-registro',
      async (tx, est, usuario) => {
        const [reg] = await tx.consultarParaAtualizar(
          `SELECT ra.id, ra.versao, ra.paciente_id, ra.atendimento_id, ra.autor_profissional_id, ra.especialidade_medica_id,
                  ra.setor_funcional_id, ra.local_assistencia_id, ra.data_hora_clinica, ra.justificativa_retroativo,
                  ra.confidencial, ra.documento_prontuario_id, ra.modelo_documento_clinico_id,
                  COALESCE(ra.tipo_documento_clinico_id, m.tipo_documento_clinico_id) AS tipo, m.titulo
             FROM registro_assistencial ra
             JOIN modelo_documento_clinico m ON m.id = ra.modelo_documento_clinico_id
            WHERE ra.id = ? AND ra.estabelecimento_id = ? AND ra.excluido_em IS NULL`,
          [r.registro, est],
        );
        if (!reg)
          throw recusar(404, 'registro-inexistente', 'O registro clínico não existe neste estabelecimento.');
        if (
          num(reg['paciente_id']) !== r.paciente ||
          (r.atendimento !== null && num(reg['atendimento_id']) !== r.atendimento)
        )
          throw recusar(
            409,
            'registro-de-outro-paciente',
            'O registro clínico não é deste paciente ou atendimento.',
          );
        // Concorrência: outra emissão gravou o documento entre a leitura e a trava.
        if (reg['documento_prontuario_id'] !== null && reg['documento_prontuario_id'] !== undefined)
          return { documento: num(reg['documento_prontuario_id']), novo: false };
        const situacao = await this.situacaoDaCategoria(tx, 'lancado');
        const agora = new Date();
        const documento = await tx.incluir('documento_prontuario', {
          estabelecimento_id: est,
          paciente_id: num(reg['paciente_id']),
          atendimento_id: numOuNull(reg['atendimento_id']),
          tipo_documento_clinico_id: num(reg['tipo']),
          modelo_documento_clinico_id: num(reg['modelo_documento_clinico_id']),
          situacao_documento_prontuario_id: situacao,
          entidade_origem: 'registro_assistencial',
          entidade_origem_id: r.registro,
          titulo: (textoOuNull(reg['titulo']) ?? 'Registro clínico').slice(0, 150),
          profissional_id: num(reg['autor_profissional_id']),
          especialidade_medica_id: numOuNull(reg['especialidade_medica_id']),
          setor_funcional_id: numOuNull(reg['setor_funcional_id']),
          local_assistencia_id: numOuNull(reg['local_assistencia_id']),
          referencia_em: reg['data_hora_clinica'],
          lancado_em: agora,
          justificativa_retroativo: textoOuNull(reg['justificativa_retroativo']),
          numero_versao: 1,
          confidencial: Boolean(Number(reg['confidencial'])),
          conteudo: JSON.stringify({ hash_conteudo: r.hash, como_suporte: false }),
          origem: 'sistema',
        });
        await tx.incluir('documento_prontuario_evento', {
          documento_prontuario_id: documento,
          operacao: 'inclusao',
          acao: 'criacao',
          situacao_documento_prontuario_id: situacao,
          profissional_id: num(reg['autor_profissional_id']),
          evento_em: agora,
          dados: JSON.stringify({ hash: r.hash }),
          ocorrido_em: agora,
          usuario_id: usuario,
        });
        await tx.alterar('registro_assistencial', r.registro, num(reg['versao']), {
          documento_prontuario_id: documento,
        });
        return { documento, novo: true };
      },
      (x) => ({ tabela: 'documento_prontuario', id: x.documento }),
      (x) => ({ dados: { evento: 'documento.registro.emitido', novo: x.novo, registro: r.registro } }),
    );
    return feito.documento;
  }

  async assinar(
    c: ContextoGravacaoPep,
    itens: readonly { documento: number; hash: string }[],
    comoSuporte?: boolean,
  ): Promise<{ assinados: number[]; recusados: { documento: number; motivo: string }[] }> {
    if (itens.length > TETO_LOTE)
      throw recusar(422, 'lote-grande', `O lote de assinatura aceita até ${TETO_LOTE} documentos.`);
    const nivel = comoSuporte ? 'avancada-sessao-suporte' : 'avancada-sessao';
    const r = await this.gravar(
      c,
      'pep.documento.assinar',
      async (tx, est, usuario) => {
        const autor = await this.profissionalDoLogin(tx, est, c.usuarioLogin);
        const assinadoSituacao = await tx
          .uma(
            `SELECT id FROM situacao_documento_prontuario WHERE categoria = 'assinado' AND ativo = TRUE
              ORDER BY (ordem IS NULL), ordem, id LIMIT 1`,
          )
          .then((s) => (s ? num(s['id']) : null));
        const assinados: number[] = [];
        const recusados: { documento: number; motivo: string }[] = [];
        for (const it of itens) {
          const [d] = await tx.consultarParaAtualizar(
            `SELECT dp.id, dp.versao, dp.profissional_id, dp.situacao_documento_prontuario_id, dp.conteudo,
                    s.categoria, da.hash_conteudo, da.concluido_em, ${SQL_LOGIN_DO_AUTOR} AS autor,
                    (SELECT COUNT(*) FROM documento_prontuario_evento ev
                      WHERE ev.documento_prontuario_id = dp.id AND ev.acao = 'assinatura'
                        AND (ev.profissional_id IS NULL OR ev.profissional_id = dp.profissional_id)) AS assinaturas
               FROM documento_prontuario dp
               JOIN situacao_documento_prontuario s ON s.id = dp.situacao_documento_prontuario_id
               LEFT JOIN documento_assinado da ON da.id = dp.documento_assinado_id AND da.excluido_em IS NULL
              WHERE dp.id = ? AND dp.estabelecimento_id = ? AND dp.excluido_em IS NULL`,
            [it.documento, est],
          );
          if (
            !d ||
            autor?.profissional == null ||
            num(d['profissional_id']) !== autor.profissional ||
            textoOuNull(d['autor']) !== c.usuarioLogin
          ) {
            recusados.push({
              documento: it.documento,
              motivo: 'Documento não encontrado entre as suas pendências.',
            });
            continue;
          }
          if (num(d['assinaturas']) > 0 || d['concluido_em'] !== null || d['categoria'] === 'assinado') {
            recusados.push({ documento: it.documento, motivo: 'Já assinado.' });
            continue;
          }
          if (!CATEGORIAS_ASSINAVEIS.includes(String(d['categoria']))) {
            recusados.push({
              documento: it.documento,
              motivo: 'O documento não está em situação de assinatura.',
            });
            continue;
          }
          const hash =
            textoOuNull(d['hash_conteudo']) ??
            textoOuNull(conteudoDe(d['conteudo'])['hash_conteudo']) ??
            sha256(JSON.stringify(d['conteudo'] ?? null));
          if (hash !== it.hash) {
            recusados.push({ documento: it.documento, motivo: 'O conteúdo mudou desde a prévia.' });
            continue;
          }
          const agora = new Date();
          const situacao = assinadoSituacao ?? num(d['situacao_documento_prontuario_id']);
          await tx.alterar('documento_prontuario', it.documento, num(d['versao']), {
            situacao_documento_prontuario_id: situacao,
            fechado_em: agora,
          });
          await tx.incluir('documento_prontuario_evento', {
            documento_prontuario_id: it.documento,
            operacao: 'alteracao',
            acao: 'assinatura',
            situacao_documento_prontuario_id: situacao,
            profissional_id: comoSuporte ? null : autor.profissional,
            evento_em: agora,
            dados: JSON.stringify({ nivel, hash, comoSuporte: comoSuporte === true }),
            ocorrido_em: agora,
            usuario_id: usuario,
          });
          assinados.push(it.documento);
        }
        return { assinados, recusados };
      },
      (x) => ({ tabela: 'documento_prontuario', id: x.assinados[0] ?? null }),
      (x) => ({
        dados: {
          evento: 'documento.documento.assinado',
          nivel,
          assinados: x.assinados,
          recusados: x.recusados.map((y) => y.documento),
        },
      }),
    );
    return r;
  }

  async registrarEventoDocumento(
    c: ContextoGravacaoPep,
    ev: {
      documento: number;
      tipo: 'visualizado' | 'impresso' | 'segunda-via' | 'exportado';
      justificativa?: string | null;
    },
  ): Promise<void> {
    await this.gravar(
      c,
      'pep.documento.evento',
      async (tx, est, usuario) => {
        const [d] = await tx.consultarParaAtualizar(
          `SELECT id, versao, situacao_documento_prontuario_id, vias_impressas, paciente_id, atendimento_id
             FROM documento_prontuario
            WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
          [ev.documento, est],
        );
        // Documento de outro estabelecimento ou inexistente: nada a registrar (como na memória).
        if (!d) return { documento: null as number | null, gravado: false };
        // A visualização não muda o documento: vai só à trilha (consulta).
        if (ev.tipo === 'visualizado') return { documento: ev.documento as number | null, gravado: false };
        const agora = new Date();
        const impressao = ev.tipo !== 'exportado';
        if (impressao)
          await tx.alterar('documento_prontuario', ev.documento, num(d['versao']), {
            impresso_em: agora,
            vias_impressas: num(d['vias_impressas']) + 1,
          });
        await tx.incluir('documento_prontuario_evento', {
          documento_prontuario_id: ev.documento,
          operacao: 'alteracao',
          acao: impressao ? 'impressao' : 'exportacao',
          situacao_documento_prontuario_id: num(d['situacao_documento_prontuario_id']),
          justificativa: textoOuNull(ev.justificativa ?? null)?.slice(0, 3000) ?? null,
          evento_em: agora,
          dados: JSON.stringify({ tipo: ev.tipo }),
          ocorrido_em: agora,
          usuario_id: usuario,
        });
        // Um registro só de toda impressão e exportação (01-ADM L82): quem, quando, a via e a justificativa.
        await tx.incluir('exportacao_documento', {
          estabelecimento_id: est,
          documento_prontuario_id: ev.documento,
          paciente_id: num(d['paciente_id']),
          atendimento_id: numOuNull(d['atendimento_id']),
          tipo_operacao:
            ev.tipo === 'impresso' ? 'impressao' : ev.tipo === 'segunda-via' ? 'reimpressao' : 'exportacao',
          formato: 'pdf',
          destino: 'download',
          justificativa: textoOuNull(ev.justificativa ?? null)?.slice(0, 500) ?? null,
          ocorrido_em: agora,
          usuario_id: usuario,
        });
        return { documento: ev.documento as number | null, gravado: true };
      },
      (x) => ({ tabela: 'documento_prontuario', id: x.documento }),
      () => ({
        acao: ev.tipo === 'visualizado' ? 'consulta' : ev.tipo === 'exportado' ? 'exportacao' : 'impressao',
        motivo: ev.justificativa ?? null,
        dados: { evento: `documento.${ev.tipo}` },
      }),
    );
  }

  motivosReimpressao(c: ContextoDocs) {
    return this.ler(c, 'motivos-reimpressao', (l) => NovaVia.lerMotivosReimpressaoAtivos(l));
  }

  motivoReimpressao(c: ContextoDocs, id: number) {
    return this.ler(c, 'motivo-reimpressao', (l) => NovaVia.lerMotivoReimpressao(l, id));
  }

  registrarNovaVia(c: ContextoGravacaoPep, e: NovaVia.NovaViaDocumento) {
    return this.gravar(
      c,
      'pep.documento.nova-via',
      (tx, est, usuario) => NovaVia.gravarNovaVia(tx, est, usuario, e),
      (r) => ({ tabela: 'registro_reimpressao', id: r.registro }),
      (r) => ({
        acao: 'impressao',
        motivo: r.texto,
        dados: { evento: 'documento.segunda-via', via: r.via, motivoReimpressao: e.motivo },
      }),
    );
  }

  fecharNovaVia(c: ContextoGravacaoPep, registro: number, d: NovaVia.DesfechoNovaVia) {
    return this.gravar(
      c,
      'pep.documento.nova-via-desfecho',
      (tx, est) => NovaVia.fecharNovaVia(tx, est, registro, d),
      (r) => ({ tabela: 'registro_reimpressao', id: r.registro }),
      (r) => ({
        acao: 'impressao',
        dados: {
          evento: d.emitida ? 'documento.segunda-via.emitida' : 'documento.segunda-via.nao-emitida',
          via: r.via,
        },
      }),
    );
  }

  async registrarExportacaoProntuario(
    c: ContextoGravacaoPep,
    e: {
      paciente: number;
      justificativa: string;
      tipoJustificativa?: number | null;
      linhas: number;
      hash: string;
    },
  ): Promise<{ id: number }> {
    return this.gravar(
      c,
      'pep.prontuario.exportacao',
      async (tx, est, usuario) => {
        const p = await tx.uma('SELECT id FROM paciente WHERE id = ? AND excluido_em IS NULL', [e.paciente]);
        if (!p) throw recusar(404, 'paciente-inexistente', 'Paciente não encontrado.');
        if (e.tipoJustificativa != null) {
          const t = await tx.uma('SELECT id FROM tipo_justificativa_exportacao WHERE id = ? AND ativo', [
            e.tipoJustificativa,
          ]);
          if (!t)
            throw recusar(
              400,
              'tipo-justificativa-invalido',
              'O tipo de justificativa não existe ou está inativo.',
            );
        }
        const agora = new Date();
        const id = await tx.incluir('exportacao_documento', {
          estabelecimento_id: est,
          entidade: 'paciente',
          entidade_id: e.paciente,
          paciente_id: e.paciente,
          tipo_operacao: 'exportacao',
          formato: 'texto',
          destino: 'download',
          tipo_justificativa_exportacao_id: e.tipoJustificativa ?? null,
          justificativa: e.justificativa.slice(0, 500),
          hash_sha256: e.hash,
          dados: JSON.stringify({ linhas: e.linhas }),
          ocorrido_em: agora,
          usuario_id: usuario,
        });
        return { id: Number(id) };
      },
      (x) => ({ tabela: 'exportacao_documento', id: x.id }),
      () => ({ acao: 'exportacao', motivo: e.justificativa, dados: { evento: 'prontuario.exportado' } }),
    );
  }

  // ── Paciente, atendimentos e linha do tempo (a abertura de "Registros do paciente") ─────────────

  paciente(c: ContextoDocs, id: number): Promise<PacientePepLido | null> {
    if (!Number.isSafeInteger(id) || id <= 0) return Promise.resolve(null);
    return this.ler(c, 'paciente', async (l, est) => {
      // Cadastro unificado em outro não abre: o prontuário é o do sobrevivente.
      const x = await l.uma(
        `SELECT p.id, pf.nome, CASE WHEN p.usa_nome_social THEN COALESCE(p.nome_social, pf.nome_social) END AS nome_social,
                DATE_FORMAT(pf.data_nascimento, '%Y-%m-%d') AS nascimento, sx.sigla AS sexo, p.numero_prontuario,
                COALESCE(p.data_hora_obito, pf.data_obito) AS obito
           FROM paciente p
           JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
           LEFT JOIN sexo sx ON sx.id = pf.sexo_id
          WHERE p.id = ? AND p.excluido_em IS NULL AND p.situacao <> 'unificado'`,
        [id],
      );
      if (!x) return null;
      return {
        id: num(x['id']),
        nome: String(x['nome']),
        nomeSocial: textoOuNull(x['nome_social']),
        nascimento: textoOuNull(x['nascimento']),
        sexo: textoOuNull(x['sexo']),
        prontuario: num(x['numero_prontuario']),
        obito: dataHora(x['obito'], est.fuso),
      };
    });
  }

  atendimentos(c: ContextoDocs, paciente: number): Promise<AtendimentoPepLido[]> {
    return this.ler(c, 'atendimentos', async (l, est) => {
      const ls = await l.consultar(
        `SELECT a.id, a.numero, k.tipo_base, a.entrada_em, COALESCE(a.saida_em, a.alta_medica_em) AS alta,
                COALESCE(ui.nome, ua.nome) AS unidade, lh.codigo AS leito, fp.nome AS convenio, pfm.nome AS medico
           FROM atendimento a
           JOIN categoria_atendimento k ON k.id = a.categoria_atendimento_id
           LEFT JOIN unidade_assistencial ua ON ua.id = a.unidade_assistencial_id
           LEFT JOIN internacao i ON i.atendimento_id = a.id AND i.excluido_em IS NULL
           LEFT JOIN unidade_assistencial ui ON ui.id = i.unidade_internacao_id
           LEFT JOIN leito_hospitalar lh ON lh.id = i.leito_hospitalar_id
           LEFT JOIN fonte_pagadora fp ON fp.id = a.fonte_pagadora_id
           LEFT JOIN profissional pm ON pm.id = COALESCE(i.medico_assistente_profissional_id, a.profissional_id)
           LEFT JOIN pessoa_fisica pfm ON pfm.id = pm.pessoa_fisica_id
          WHERE a.paciente_id = ? AND a.estabelecimento_id = ? AND a.excluido_em IS NULL
          ORDER BY a.entrada_em DESC, a.id DESC LIMIT ${TETO_DOCUMENTOS}`,
        [paciente, est.id],
      );
      return ls.map((x) => ({
        id: num(x['id']),
        registro: numeroDeNegocio(x['numero'], x['id']),
        tipo: String(x['tipo_base']) === 'internacao' ? ('internacao' as const) : ('externo' as const),
        entrada: dataHora(x['entrada_em'], est.fuso),
        alta: dataHora(x['alta'], est.fuso),
        unidade: textoOuNull(x['unidade']),
        leito: textoOuNull(x['leito']),
        convenio: textoOuNull(x['convenio']),
        medico: textoOuNull(x['medico']),
      }));
    });
  }

  /**
   * No banco próprio não há "retrato" do paciente e do atendimento à parte: a referência é o próprio id (versão
   * vigente). `doPaciente` diz se o atendimento é do paciente; atendimento de outro estabelecimento: null.
   */
  retratos(c: ContextoDocs, atendimento: number, paciente: number): Promise<RetratosAtuais | null> {
    return this.ler(c, 'retratos', async (l, est) => {
      const a = await l.uma(
        'SELECT id, paciente_id FROM atendimento WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [atendimento, est.id],
      );
      if (!a) return null;
      return {
        htAtendimento: num(a['id']),
        htPaciente: paciente,
        doPaciente: num(a['paciente_id']) === paciente,
      };
    });
  }

  /**
   * Linha do tempo do paciente no estabelecimento: atendimentos e registros clínicos (parecer pela categoria do tipo
   * do documento). As demais famílias (exames, alergias, anexos, termos, cirurgias) ainda não têm adaptador próprio e
   * não entram (a lista volta sem elas, nunca com dado de outra origem).
   */
  eventos(
    c: ContextoDocs,
    paciente: number,
    periodo: { de: string; ate: string },
    tipos: ReadonlySet<string>,
    limite: number,
  ): Promise<EventoLido[]> {
    return this.ler(c, 'eventos', async (l, est) => {
      const r: EventoLido[] = [];
      const ate = `${periodo.ate}T23:59:59`;
      // Janela larga em UTC (o fuso do estabelecimento fica a menos de 1 dia); o recorte exato é no fuso, abaixo.
      const janela = [`${periodo.de} 00:00:00`, `${periodo.ate} 23:59:59`];
      if (tipos.has('atendimento'))
        for (const a of await this.atendimentos(c, paciente))
          r.push({
            chave: `atendimento:${a.id}`,
            tipo: 'atendimento',
            quando: a.entrada ?? '',
            titulo: a.tipo === 'internacao' ? `Internação ${a.registro}` : `Atendimento ${a.registro}`,
            detalhe: a.unidade,
            profissional: a.medico,
            cbo: null,
            suspenso: false,
            situacao: a.alta ? 'Encerrado' : 'Aberto',
            documento: null,
          });
      if (tipos.has('registro') || tipos.has('parecer')) {
        const ls = await l.consultar(
          `SELECT ra.id, ra.data_hora_clinica, ra.situacao, m.titulo, t.categoria, pf.nome AS profissional,
                  o.codigo_cbo
             FROM registro_assistencial ra
             JOIN modelo_documento_clinico m ON m.id = ra.modelo_documento_clinico_id
             LEFT JOIN tipo_documento_clinico t
                    ON t.id = COALESCE(ra.tipo_documento_clinico_id, m.tipo_documento_clinico_id)
             LEFT JOIN profissional p ON p.id = ra.autor_profissional_id
             LEFT JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
             LEFT JOIN ocupacao_cbo o ON o.id = ra.ocupacao_cbo_id
            WHERE ra.paciente_id = ? AND ra.estabelecimento_id = ? AND ra.excluido_em IS NULL
              AND ra.data_hora_clinica >= DATE_SUB(?, INTERVAL 1 DAY)
              AND ra.data_hora_clinica <= DATE_ADD(?, INTERVAL 1 DAY)
            ORDER BY ra.data_hora_clinica DESC, ra.id DESC LIMIT ${TETO_DOCUMENTOS}`,
          [paciente, est.id, ...janela],
        );
        for (const x of ls) {
          const tipo = String(x['categoria']) === 'parecer' ? 'parecer' : 'registro';
          if (!tipos.has(tipo)) continue;
          const situacao = String(x['situacao']);
          const suspenso = situacao === 'suspenso' || situacao === 'corrigido';
          r.push({
            chave: `registro:${num(x['id'])}`,
            tipo,
            quando: dataHora(x['data_hora_clinica'], est.fuso) ?? '',
            titulo: String(x['titulo']),
            detalhe: null,
            profissional: textoOuNull(x['profissional']),
            cbo: textoOuNull(x['codigo_cbo']),
            suspenso,
            situacao: suspenso ? 'Suspenso' : null,
            documento: { tipo: 'registro', id: num(x['id']) },
          });
        }
      }
      return r
        .filter((x) => x.quando.slice(0, 10) >= periodo.de && x.quando <= ate)
        .sort((a, b) => b.quando.localeCompare(a.quando))
        .slice(0, limite);
    });
  }

  // ── Famílias painel, exames, pareceres e alergias (arquivos *-propria-*.ts) ─────────────
  painel(...a: Parameters<PortaDocumentos['painel']>) {
    return Painel.painel(this.nucleo, this.cliente, ...a);
  }
  episodio(...a: Parameters<PortaDocumentos['episodio']>) {
    return Painel.episodio(this.nucleo, this.cliente, ...a);
  }
  completudePainel(...a: Parameters<PortaDocumentos['completudePainel']>) {
    return Painel.completudePainel(this.nucleo, this.cliente, ...a);
  }
  preferenciasPainel(...a: Parameters<PortaDocumentos['preferenciasPainel']>) {
    return Painel.preferenciasPainel(this.nucleo, this.cliente, ...a);
  }
  lerReceita(...a: Parameters<PortaDocumentos['lerReceita']>) {
    return Painel.lerReceita(this.nucleo, this.cliente, ...a);
  }
  lerAtestado(...a: Parameters<PortaDocumentos['lerAtestado']>) {
    return Painel.lerAtestado(this.nucleo, this.cliente, ...a);
  }
  lerExameExterno(...a: Parameters<PortaDocumentos['lerExameExterno']>) {
    return Painel.lerExameExterno(this.nucleo, this.cliente, ...a);
  }
  documentoDaTrilha() {
    return Painel.documentoDaTrilha();
  }
  documentos(...a: Parameters<PortaDocumentos['documentos']>) {
    return Painel.documentos(this.nucleo, this.cliente, ...a);
  }
  fichas(...a: Parameters<PortaDocumentos['fichas']>) {
    return Painel.fichas(this.nucleo, this.cliente, ...a);
  }
  modelosEmUso(...a: Parameters<PortaDocumentos['modelosEmUso']>) {
    return Painel.modelosEmUso(this.nucleo, this.cliente, ...a);
  }
  cabecalhoDocumento(...a: Parameters<PortaDocumentos['cabecalhoDocumento']>) {
    return Painel.cabecalhoDocumento(this.nucleo, this.cliente, ...a);
  }
  alergias(...a: Parameters<PortaDocumentos['alergias']>) {
    return Alergias.alergias(this.nucleo, this.cliente, ...a);
  }
  catalogoAlergias(...a: Parameters<PortaDocumentos['catalogoAlergias']>) {
    return Alergias.catalogoAlergias(this.nucleo, this.cliente, ...a);
  }
  registrosParaAlergia(...a: Parameters<PortaDocumentos['registrosParaAlergia']>) {
    return Alergias.registrosParaAlergia(this.nucleo, this.cliente, ...a);
  }
  versaoAlergias(...a: Parameters<PortaDocumentos['versaoAlergias']>) {
    return Alergias.versaoAlergias(this.nucleo, this.cliente, ...a);
  }
  historicoAlergia(...a: Parameters<PortaDocumentos['historicoAlergia']>) {
    return HistoricoAlergias.historicoDaAlergia(this.nucleo, this.cliente, ...a);
  }
  manifestacoesAlergicas(...a: Parameters<PortaDocumentos['manifestacoesAlergicas']>) {
    return HistoricoAlergias.catalogoManifestacoes(this.nucleo, this.cliente, ...a);
  }
  catalogoExames(...a: Parameters<PortaDocumentos['catalogoExames']>) {
    return this.exames.catalogoExames(...a);
  }
  examesPorId(...a: Parameters<PortaDocumentos['examesPorId']>) {
    return this.exames.examesPorId(...a);
  }
  kits(...a: Parameters<PortaDocumentos['kits']>) {
    return this.exames.kits(...a);
  }
  pedidos(...a: Parameters<PortaDocumentos['pedidos']>) {
    return this.exames.pedidos(...a);
  }
  resultados(...a: Parameters<PortaDocumentos['resultados']>) {
    return this.exames.resultados(...a);
  }
  examesExternos(...a: Parameters<PortaDocumentos['examesExternos']>) {
    return this.exames.examesExternos(...a);
  }
  anexos(...a: Parameters<PortaDocumentos['anexos']>) {
    return this.exames.anexos(...a);
  }
  arquivoAnexo(...a: Parameters<PortaDocumentos['arquivoAnexo']>) {
    return this.exames.arquivoAnexo(...a);
  }
  tiposTermo(...a: Parameters<PortaDocumentos['tiposTermo']>) {
    return this.exames.tiposTermo(...a);
  }
  tiposAnexo(...a: Parameters<PortaDocumentos['tiposAnexo']>) {
    return this.exames.tiposAnexo(...a);
  }
  tcleHerdado(...a: Parameters<PortaDocumentos['tcleHerdado']>) {
    return this.exames.tcleHerdado(...a);
  }
  tempos(...a: Parameters<PortaDocumentos['tempos']>) {
    return Painel.tempos(this.nucleo, this.cliente, ...a);
  }
  historicoPareceres(...a: Parameters<PortaDocumentos['historicoPareceres']>) {
    return this.pareceres.historicoPareceres(...a);
  }
  especialidades(...a: Parameters<PortaDocumentos['especialidades']>) {
    return this.pareceres.especialidades(...a);
  }
  especialidadesDoCbo(...a: Parameters<PortaDocumentos['especialidadesDoCbo']>) {
    return this.pareceres.especialidadesDoCbo(...a);
  }
  coassinaturas(...a: Parameters<PortaDocumentos['coassinaturas']>) {
    return this.pareceres.coassinaturas(...a);
  }
  supervisao(...a: Parameters<PortaDocumentos['supervisao']>) {
    return this.pareceres.supervisao(...a);
  }
  coassinarNoNovo(...a: Parameters<PortaDocumentos['coassinarNoNovo']>) {
    return this.pareceres.coassinarNoNovo(...a);
  }
  registrosDevolvidos(...a: Parameters<NonNullable<PortaDocumentos['registrosDevolvidos']>>) {
    return this.pareceres.registrosDevolvidos(...a);
  }
  novaRodadaCoassinatura(...a: Parameters<NonNullable<PortaDocumentos['novaRodadaCoassinatura']>>) {
    return this.pareceres.novaRodadaCoassinatura(...a);
  }
  registrosSemAssinatura(...a: Parameters<PortaDocumentos['registrosSemAssinatura']>) {
    return this.pareceres.registrosSemAssinatura(...a);
  }
  problemas(...a: Parameters<PortaDocumentos['problemas']>) {
    return this.pareceres.problemas(...a);
  }
  tcles(...a: Parameters<PortaDocumentos['tcles']>) {
    return this.exames.tcles(...a);
  }
  sumarios(...a: Parameters<PortaDocumentos['sumarios']>) {
    return this.pareceres.sumarios(...a);
  }
  transferencias(...a: Parameters<PortaDocumentos['transferencias']>) {
    return this.pareceres.transferencias(...a);
  }
  obito(...a: Parameters<PortaDocumentos['obito']>) {
    return this.pareceres.obito(...a);
  }
  ciencias(...a: Parameters<PortaDocumentos['ciencias']>) {
    return this.pareceres.ciencias(...a);
  }
  fila(...a: Parameters<PortaDocumentos['fila']>) {
    return Painel.fila(this.nucleo, this.cliente, ...a);
  }
  fluxo(...a: Parameters<PortaDocumentos['fluxo']>) {
    return Painel.fluxo(this.nucleo, this.cliente, ...a);
  }
  /** Gravações pelo executor: a suspensão de receita/atestado; as demais operações ainda recusam (pendente). */
  executar(...a: Parameters<PortaDocumentos['executar']>) {
    return Painel.executar(this.nucleo, this.cliente, this.executor, ...a, this.opsResto);
  }
  gravarProblema(...a: Parameters<PortaDocumentos['gravarProblema']>) {
    return this.pareceres.gravarProblema(...a);
  }
  registrarCiencia(...a: Parameters<PortaDocumentos['registrarCiencia']>) {
    return this.pareceres.registrarCiencia(...a);
  }
  aceitarParecer(...a: Parameters<PortaDocumentos['aceitarParecer']>) {
    return this.pareceres.aceitarParecer(...a);
  }
  cancelarParecer(...a: Parameters<PortaDocumentos['cancelarParecer']>) {
    return this.pareceres.cancelarParecer(...a);
  }
  emitirTcle(...a: Parameters<PortaDocumentos['emitirTcle']>) {
    return this.exames.emitirTcle(...a);
  }
  mudarSituacaoTcle(...a: Parameters<PortaDocumentos['mudarSituacaoTcle']>) {
    return this.exames.mudarSituacaoTcle(...a);
  }
  salvarRascunhoSumario(...a: Parameters<PortaDocumentos['salvarRascunhoSumario']>) {
    return this.pareceres.salvarRascunhoSumario(...a);
  }
  registrarTransferencia(...a: Parameters<PortaDocumentos['registrarTransferencia']>) {
    return this.pareceres.registrarTransferencia(...a);
  }
  registrarObito(...a: Parameters<PortaDocumentos['registrarObito']>) {
    return this.pareceres.registrarObito(...a);
  }
  cancelarObito(...a: Parameters<PortaDocumentos['cancelarObito']>) {
    return this.pareceres.cancelarObito(...a);
  }
}
