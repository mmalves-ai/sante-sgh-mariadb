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
import { dataHora, fusoValido } from './registro-porta-propria.js';
import type { ContextoGravacaoPep, DocumentoProprioLido, LiberacaoConsultada } from './tipos-pep.js';

/** O que a porta usa do NucleoProprio (os testes trocam). */
export interface NucleoDocumentosPep {
  lerSomente<T>(
    contexto: { readonly cliente: string; readonly correlacao: string },
    fn: (l: Leitor) => Promise<T>,
  ): Promise<T>;
  criarExecutor(): Executor;
}

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

export function recusaPendente(metodo: string): ErroOperacao {
  return new ErroOperacao(
    501,
    'pendente-modelo-proprio',
    'Ainda não disponível no banco próprio',
    `A leitura ou gravação "${metodo}" dos documentos do prontuário ainda não tem adaptador no banco próprio.`,
  );
}

const recusar = (status: number, codigo: string, detalhe: string): ErroOperacao =>
  new ErroOperacao(status, codigo, 'Operação recusada', detalhe);

/** O autor do documento: a conta ligada ao profissional no estabelecimento do documento, vigente. */
const SQL_LOGIN_DO_AUTOR = `
  (SELECT u.login FROM usuario_vinculo_profissional v JOIN usuario u ON u.id = v.usuario_id
    WHERE v.profissional_id = dp.profissional_id AND v.estabelecimento_id = dp.estabelecimento_id
      AND v.excluido_em IS NULL AND u.excluido_em IS NULL
      AND v.vigencia_inicio <= CURRENT_DATE AND (v.vigencia_fim IS NULL OR v.vigencia_fim >= CURRENT_DATE)
    ORDER BY v.vigencia_inicio DESC, v.id DESC LIMIT 1)`;

/** A última assinatura na cadeia do documento (evento). */
const SQL_ULTIMA_ASSINATURA = (coluna: string) => `
  (SELECT ev.${coluna} FROM documento_prontuario_evento ev
    WHERE ev.documento_prontuario_id = dp.id AND ev.acao = 'assinatura'
    ORDER BY ev.ocorrido_em DESC, ev.id DESC LIMIT 1)`;

const SQL_DOCUMENTOS = `
  SELECT dp.id, t.codigo AS tipo, dp.entidade_origem, dp.entidade_origem_id, dp.paciente_id, dp.atendimento_id,
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

/** Linha do documento → tipo de negócio (vocabulário neutro). */
export function documentoLido(x: Record<string, unknown>, fuso: string): DocumentoProprioLido {
  const conteudo = conteudoDe(x['conteudo']);
  const assinatura = conteudoDe(x['dados_assinatura']);
  const assinadoEm = x['concluido_em'] ?? x['assinado_em'] ?? null;
  const categoria = String(x['categoria']);
  return {
    id: num(x['id']),
    tipo: String(x['tipo']),
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
  };
}

export class PortaDocumentosPropria implements PortaDocumentos {
  readonly destino = 'proprio' as const;
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: NucleoDocumentosPep,
    /** Cliente desta API (configuração; um banco por cliente), quando o contexto da sessão não o traz. */
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

  /** O profissional ligado ao login no estabelecimento (vínculo vigente), ou null. */
  private async profissionalDoLogin(
    l: Leitor,
    est: number,
    login: string,
  ): Promise<{ usuario: number; profissional: number | null; nome: string | null } | null> {
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

  profissional(c: ContextoDocs, login: string): Promise<ProfissionalPep | null> {
    return this.ler(c, 'profissional', async (l, est) => {
      const p = await this.profissionalDoLogin(l, est.id, login);
      if (!p || p.profissional === null) return null;
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
          conselhoAtivo: ['ativa', 'provisoria'].includes(String(i['situacao'])),
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
    return this.ler(c, 'pendencias', async (l, est) => {
      const p = await this.profissionalDoLogin(l, est.id, login);
      if (!p || p.profissional === null) return [];
      const ls = await l.consultar(
        `${SQL_DOCUMENTOS} AND dp.profissional_id = ? AND s.categoria IN (${marcadores(CATEGORIAS_ASSINAVEIS.length)})
            AND (da.id IS NULL OR da.concluido_em IS NULL)
            AND NOT EXISTS (SELECT 1 FROM documento_prontuario_evento ev
                             WHERE ev.documento_prontuario_id = dp.id AND ev.acao = 'assinatura')
          ORDER BY dp.lancado_em, dp.id LIMIT ${TETO_DOCUMENTOS}`,
        [est.id, p.profissional, ...CATEGORIAS_ASSINAVEIS],
      );
      return ls.map((x) => documentoLido(x, est.fuso));
    });
  }

  /** A gravação pelo executor do estabelecimento fica desligada até o adaptador (a tela abre em consulta). */
  async podeGravar(): Promise<LiberacaoConsultada> {
    return { pode: false, codigo: 'pendente-modelo-proprio', motivo: MOTIVO_GRAVACAO_PENDENTE };
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
                    s.categoria, da.hash_conteudo, da.concluido_em,
                    (SELECT COUNT(*) FROM documento_prontuario_evento ev
                      WHERE ev.documento_prontuario_id = dp.id AND ev.acao = 'assinatura') AS assinaturas
               FROM documento_prontuario dp
               JOIN situacao_documento_prontuario s ON s.id = dp.situacao_documento_prontuario_id
               LEFT JOIN documento_assinado da ON da.id = dp.documento_assinado_id AND da.excluido_em IS NULL
              WHERE dp.id = ? AND dp.estabelecimento_id = ? AND dp.excluido_em IS NULL`,
            [it.documento, est],
          );
          if (!d || autor?.profissional == null || num(d['profissional_id']) !== autor.profissional) {
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
          `SELECT id, versao, situacao_documento_prontuario_id, vias_impressas FROM documento_prontuario
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

  // ── Pendentes (sem adaptador próprio nesta etapa): recusa 501, nada lido nem gravado ─────────────
  painel(): Promise<never> {
    return Promise.reject(recusaPendente('painel'));
  }
  episodio(): Promise<never> {
    return Promise.reject(recusaPendente('episodio'));
  }
  completudePainel(): Promise<never> {
    return Promise.reject(recusaPendente('completudePainel'));
  }
  preferenciasPainel(): Promise<never> {
    return Promise.reject(recusaPendente('preferenciasPainel'));
  }
  paciente(): Promise<never> {
    return Promise.reject(recusaPendente('paciente'));
  }
  atendimentos(): Promise<never> {
    return Promise.reject(recusaPendente('atendimentos'));
  }
  retratos(): Promise<never> {
    return Promise.reject(recusaPendente('retratos'));
  }
  eventos(): Promise<never> {
    return Promise.reject(recusaPendente('eventos'));
  }
  lerReceita(): Promise<never> {
    return Promise.reject(recusaPendente('lerReceita'));
  }
  lerAtestado(): Promise<never> {
    return Promise.reject(recusaPendente('lerAtestado'));
  }
  lerExameExterno(): Promise<never> {
    return Promise.reject(recusaPendente('lerExameExterno'));
  }
  documentoDaTrilha(): Promise<never> {
    return Promise.reject(recusaPendente('documentoDaTrilha'));
  }
  documentos(): Promise<never> {
    return Promise.reject(recusaPendente('documentos'));
  }
  fichas(): Promise<never> {
    return Promise.reject(recusaPendente('fichas'));
  }
  modelosEmUso(): Promise<never> {
    return Promise.reject(recusaPendente('modelosEmUso'));
  }
  cabecalhoDocumento(): Promise<never> {
    return Promise.reject(recusaPendente('cabecalhoDocumento'));
  }
  alergias(): Promise<never> {
    return Promise.reject(recusaPendente('alergias'));
  }
  catalogoAlergias(): Promise<never> {
    return Promise.reject(recusaPendente('catalogoAlergias'));
  }
  registrosParaAlergia(): Promise<never> {
    return Promise.reject(recusaPendente('registrosParaAlergia'));
  }
  versaoAlergias(): Promise<never> {
    return Promise.reject(recusaPendente('versaoAlergias'));
  }
  catalogoExames(): Promise<never> {
    return Promise.reject(recusaPendente('catalogoExames'));
  }
  examesPorId(): Promise<never> {
    return Promise.reject(recusaPendente('examesPorId'));
  }
  kits(): Promise<never> {
    return Promise.reject(recusaPendente('kits'));
  }
  pedidos(): Promise<never> {
    return Promise.reject(recusaPendente('pedidos'));
  }
  resultados(): Promise<never> {
    return Promise.reject(recusaPendente('resultados'));
  }
  examesExternos(): Promise<never> {
    return Promise.reject(recusaPendente('examesExternos'));
  }
  anexos(): Promise<never> {
    return Promise.reject(recusaPendente('anexos'));
  }
  arquivoAnexo(): Promise<never> {
    return Promise.reject(recusaPendente('arquivoAnexo'));
  }
  tiposTermo(): Promise<never> {
    return Promise.reject(recusaPendente('tiposTermo'));
  }
  tiposAnexo(): Promise<never> {
    return Promise.reject(recusaPendente('tiposAnexo'));
  }
  tcleHerdado(): Promise<never> {
    return Promise.reject(recusaPendente('tcleHerdado'));
  }
  tempos(): Promise<never> {
    return Promise.reject(recusaPendente('tempos'));
  }
  historicoPareceres(): Promise<never> {
    return Promise.reject(recusaPendente('historicoPareceres'));
  }
  especialidades(): Promise<never> {
    return Promise.reject(recusaPendente('especialidades'));
  }
  especialidadesDoCbo(): Promise<never> {
    return Promise.reject(recusaPendente('especialidadesDoCbo'));
  }
  coassinaturas(): Promise<never> {
    return Promise.reject(recusaPendente('coassinaturas'));
  }
  supervisao(): Promise<never> {
    return Promise.reject(recusaPendente('supervisao'));
  }
  coassinarNoNovo(): Promise<never> {
    return Promise.reject(recusaPendente('coassinarNoNovo'));
  }
  registrosSemAssinatura(): Promise<never> {
    return Promise.reject(recusaPendente('registrosSemAssinatura'));
  }
  problemas(): Promise<never> {
    return Promise.reject(recusaPendente('problemas'));
  }
  tcles(): Promise<never> {
    return Promise.reject(recusaPendente('tcles'));
  }
  sumarios(): Promise<never> {
    return Promise.reject(recusaPendente('sumarios'));
  }
  transferencias(): Promise<never> {
    return Promise.reject(recusaPendente('transferencias'));
  }
  obito(): Promise<never> {
    return Promise.reject(recusaPendente('obito'));
  }
  ciencias(): Promise<never> {
    return Promise.reject(recusaPendente('ciencias'));
  }
  fila(): Promise<never> {
    return Promise.reject(recusaPendente('fila'));
  }
  fluxo(): Promise<never> {
    return Promise.reject(recusaPendente('fluxo'));
  }
  executar(): Promise<never> {
    return Promise.reject(recusaPendente('executar'));
  }
  gravarProblema(): Promise<never> {
    return Promise.reject(recusaPendente('gravarProblema'));
  }
  registrarCiencia(): Promise<never> {
    return Promise.reject(recusaPendente('registrarCiencia'));
  }
  aceitarParecer(): Promise<never> {
    return Promise.reject(recusaPendente('aceitarParecer'));
  }
  cancelarParecer(): Promise<never> {
    return Promise.reject(recusaPendente('cancelarParecer'));
  }
  emitirTcle(): Promise<never> {
    return Promise.reject(recusaPendente('emitirTcle'));
  }
  mudarSituacaoTcle(): Promise<never> {
    return Promise.reject(recusaPendente('mudarSituacaoTcle'));
  }
  salvarRascunhoSumario(): Promise<never> {
    return Promise.reject(recusaPendente('salvarRascunhoSumario'));
  }
  registrarTransferencia(): Promise<never> {
    return Promise.reject(recusaPendente('registrarTransferencia'));
  }
  registrarObito(): Promise<never> {
    return Promise.reject(recusaPendente('registrarObito'));
  }
}
