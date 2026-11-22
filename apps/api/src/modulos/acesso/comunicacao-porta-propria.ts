// Porta PRÓPRIA da comunicação interna do M27 sobre o banco do cliente, pelo @sgh/nucleo:
//   - mensagens diretas: mensagem_interna e mensagem_interna_destinatario (leitura, arquivo e resposta por destinatário);
//   - comunicados: comunicado, comunicado_destinatario (o público) e comunicado_ciencia (exibição e ciência por usuário);
//   - central de avisos: notificacao_usuario (lida e resolvida, com a chave de agrupamento que evita repetição);
//   - mensagens anteriores: as mensagens diretas trazidas pelo conector (origem 'migracao'), só consulta;
//   - dicionário pessoal: dicionario_usuario, pelas operações do Executor (comunicacao-operacoes.ts);
//   - destinatários: usuário (login), grupo (perfil_acesso por código, usuario_perfil vigente), setor
//     (usuario_escopo do tipo de recorte 'setor', pelo id) e unidade (usuario_unidade), só contas ativas, dentro da
//     validade e com vínculo vigente no estabelecimento (usuario_estabelecimento).
// Toda leitura filtra o estabelecimento da sessão e os excluídos; as gravações vão numa operação do Executor
// (trilha, outbox e idempotência na mesma transação). O texto e o assunto nunca vão à trilha.
// Melhoria: o comunicado guarda a vigência, a exigência de ciência e o público próprios (sem tipo dentro da mensagem);
// a ciência e a primeira exibição são de cada usuário (comunicado_ciencia, uma linha por par).
// Melhoria: os eventos do comunicado (correção, vigência, encerramento) são lidos da trilha da operação, com o motivo;
// da versão anterior a trilha guarda só o tamanho e um resumo (sha256), nunca o assunto nem o texto.
// Melhoria: o envio e a publicação usam a Idempotency-Key do pedido no Executor, com o resumo do conteúdo na entrada:
// o reenvio igual devolve a mesma mensagem; o reenvio com outro conteúdo é recusado (idempotência divergente).
// Melhoria: cada ação grava com o próprio nome de operação (acesso.enviar-mensagem, acesso.publicar-comunicado...),
// para a liberação e a idempotência por ação.
// Melhoria: a ciência resolve os avisos pelo objeto (tabela e id), por SQL na mesma transação.
// Melhoria: o aviso repetido (mesmo evento e objeto, não resolvido) não é gravado de novo (chave de agrupamento).
// Pendências de modelo (pedidos do lote 02-01): a via de cada destinatário ("grupo MEDICOS") não tem coluna (fica
// vazia na leitura); a ciência da mensagem direta usa solicita_resposta/respondida_em até haver exige_ciencia/ciente_em;
// o tipo do aviso vai em `detalhes` (JSON) até haver coluna; a versão anterior do comunicado corrigido não é guardada
// por inteiro até haver comunicado_versao; mensagens e comunicados têm ids de tabelas diferentes, então
// a abertura sem o tipo prefere a mensagem direta (a rota passa `?tipo=comunicado`).
import {
  foneticaDoDicionario,
  type GravidadeAviso,
  type MensagemAnterior,
  type MensagemEnviada,
  type MensagemRecebida,
  type NovoAviso,
  palavraDoDicionario,
  TETO_DICIONARIO,
} from '@sgh/contratos';
import {
  type ContextoNucleo,
  type ContextoOperacao,
  definirOperacao,
  ErroOperacao,
  type Executor,
  type Leitor,
  type NucleoProprio,
  recusa,
  type ResultadoOperacao,
  type TxOperacao,
} from '@sgh/nucleo';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ENTRADA_DICIONARIO, OPERACOES_DICIONARIO, operacaoDoDicionario } from './comunicacao-operacoes.js';
import type {
  AvisoRegistrado,
  ComunicadoRegistrado,
  ContextoComunicacao,
  ContextoOperacaoComunicacao,
  DestinatarioResolvido,
  DestinoComunicacao,
  GravadorComunicacao,
  LiberacaoComunicacao,
  NovaMensagem,
  PedidoGravacao,
  PortaComunicacao,
  TrilhaComunicacao,
} from './comunicacao-porta.js';
import { descricaoVersaoAnterior } from './comunicacao-porta.js';

/** O mínimo do núcleo que a porta usa. */
export type NucleoComunicacao = Pick<NucleoProprio, 'lerSomente' | 'criarExecutor'>;

export const TETO_MENSAGENS = 100;
export const TETO_AVISOS = 100;
export const TETO_DESTINATARIOS_DETALHE = 2000;
const TETO_EVENTOS = 200;

/** Tabelas das gravações da comunicação (a transação do Executor recusa as outras). */
const TABELAS_GRAVACAO = [
  'mensagem_interna',
  'mensagem_interna_destinatario',
  'comunicado',
  'comunicado_destinatario',
  'comunicado_ciencia',
  'notificacao_usuario',
] as const;

type Linha = Record<string, unknown>;
type TipoItem = 'mensagem' | 'comunicado';
const n = (v: unknown) => Number(v ?? 0);
const nn = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const t = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const tn = (v: unknown) => (v === null || v === undefined || v === '' ? null : String(v));
const bool = (v: unknown) => v === true || v === 1 || v === '1';
const iso = (v: unknown): string | null => {
  if (v === null || v === undefined || v === '') return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

/** Gravidade da tela ↔ gravidade da central do modelo. */
const GRAVIDADE_DO_MODELO: Readonly<Record<GravidadeAviso, string>> = {
  grave: 'critica',
  atencao: 'atencao',
  informacao: 'informativa',
};
const gravidadeDaTela = (g: unknown): GravidadeAviso =>
  g === 'critica' || g === 'alta' ? 'grave' : g === 'atencao' ? 'atencao' : 'informacao';

// ── SQL comum ───────────────────────────────────────────────────────────────────────────────────────

/** Conta ativa, dentro da validade e com vínculo vigente no estabelecimento (parâmetros: agora, est, hoje, hoje). */
const CONTA_ATIVA = `u.situacao = 'ativo' AND u.excluido_em IS NULL AND (u.expira_em IS NULL OR u.expira_em > ?)
  AND EXISTS (SELECT 1 FROM usuario_estabelecimento ue WHERE ue.usuario_id = u.id AND ue.estabelecimento_id = ?
              AND ue.excluido_em IS NULL AND ue.vigencia_inicio <= ? AND (ue.vigencia_fim IS NULL OR ue.vigencia_fim >= ?))`;

/** O público do comunicado alcança o usuário (parâmetros: est, usuario, usuario, est, hoje, hoje, usuario). */
const PUBLICO_ALCANCA = `(cd.tipo_destinatario = 'todos'
   OR (cd.tipo_destinatario = 'estabelecimento' AND cd.estabelecimento_id = ?)
   OR (cd.tipo_destinatario = 'usuario' AND cd.usuario_id = ?)
   OR (cd.tipo_destinatario = 'perfil' AND EXISTS (SELECT 1 FROM usuario_perfil up WHERE up.usuario_id = ?
        AND up.perfil_acesso_id = cd.perfil_acesso_id AND up.estabelecimento_id = ? AND up.excluido_em IS NULL
        AND up.vigencia_inicio <= ? AND (up.vigencia_fim IS NULL OR up.vigencia_fim >= ?)))
   OR (cd.tipo_destinatario = 'unidade' AND EXISTS (SELECT 1 FROM usuario_unidade uu WHERE uu.usuario_id = ?
        AND uu.unidade_assistencial_id = cd.unidade_assistencial_id AND uu.excluido_em IS NULL)))`;

/** O último evento do comunicado na trilha (o encerramento: quando, quem e o motivo). */
const EVENTO_NA_TRILHA = (campo: string, evento: string) =>
  `(SELECT ${campo} FROM trilha_auditoria tr WHERE tr.entidade = 'comunicado' AND tr.entidade_id = k.id
     AND JSON_VALUE(tr.dados_depois, '$.dados.evento') = '${evento}' ORDER BY tr.id DESC LIMIT 1)`;

const hojeDe = (agora: Date) => agora.toISOString().slice(0, 10);

function contextoDe(c: ContextoNucleo, rotulo: string): ContextoNucleo {
  return {
    cliente: c.cliente,
    estabelecimento: c.estabelecimento,
    usuario: c.usuario,
    correlacao: (c.correlacao || rotulo).slice(0, 64),
  };
}

function estDe(c: ContextoComunicacao): number {
  if (c.estabelecimento === null) throw recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.');
  return c.estabelecimento;
}

async function usuarioDoLogin(l: Leitor, login: string): Promise<number | null> {
  const r = await l.uma('SELECT id FROM usuario WHERE login = ? AND excluido_em IS NULL', [login]);
  return r ? n(r['id']) : null;
}

async function exigirUsuario(l: Leitor, login: string): Promise<number> {
  const id = await usuarioDoLogin(l, login);
  if (id === null) throw recusa('usuario-inexistente', 'A conta da sessão não existe neste banco.');
  return id;
}

function recebidaDe(r: Linha, tipo: TipoItem): MensagemRecebida {
  return {
    id: n(r['id']),
    tipo,
    assunto: t(r['assunto']),
    texto: t(r['texto']),
    remetente: t(r['remetente']),
    enviadaEm: iso(r['em']) ?? '',
    cienciaObrigatoria: bool(r['ciencia']),
    lidaEm: iso(r['lida_em']),
    cienciaEm: iso(r['ciencia_em']),
    contextoAtendimento: nn(r['atendimento_id']),
    contextoPaciente: nn(r['paciente_id']),
    vigenciaInicio: iso(r['vig_ini']),
    vigenciaFim: iso(r['vig_fim']),
    via: t(r['via']),
    encerradoEm: iso(r['encerrado_em']),
    motivoEncerramento: tn(r['motivo_encerramento']),
  };
}

const SQL_MENSAGENS_RECEBIDAS = `
  SELECT m.id, m.assunto, m.texto, r.login AS remetente, m.enviada_em AS em, m.solicita_resposta AS ciencia,
         d.lida_em, d.respondida_em AS ciencia_em, m.atendimento_id, a.paciente_id, '' AS via
    FROM mensagem_interna_destinatario d
    JOIN mensagem_interna m ON m.id = d.mensagem_interna_id
    JOIN usuario r ON r.id = m.remetente_usuario_id
    LEFT JOIN atendimento a ON a.id = m.atendimento_id AND a.estabelecimento_id = m.estabelecimento_id
   WHERE d.destinatario_usuario_id = ? AND m.estabelecimento_id = ? AND m.situacao = 'enviada'
     AND m.origem <> 'migracao' AND d.pasta <> 'lixeira' AND d.excluido_em IS NULL AND m.excluido_em IS NULL`;

const SQL_COMUNICADOS_RECEBIDOS = `
  SELECT k.id, k.titulo AS assunto, k.texto, p.login AS remetente, k.publicado_em AS em, k.exige_ciencia AS ciencia,
         ci.primeira_exibicao_em AS lida_em, ci.ocorrido_em AS ciencia_em, k.exibir_de AS vig_ini,
         k.exibir_ate AS vig_fim, MIN(cd.tipo_destinatario) AS via, k.situacao,
         ${EVENTO_NA_TRILHA('tr.ocorrido_em', 'encerramento')} AS encerrado_em,
         ${EVENTO_NA_TRILHA('tr.motivo', 'encerramento')} AS motivo_encerramento
    FROM comunicado k
    JOIN comunicado_destinatario cd ON cd.comunicado_id = k.id AND cd.excluido_em IS NULL
    LEFT JOIN usuario p ON p.id = k.publicador_usuario_id
    LEFT JOIN comunicado_ciencia ci ON ci.comunicado_id = k.id AND ci.usuario_id = ?
   WHERE k.estabelecimento_id = ? AND k.excluido_em IS NULL AND ${PUBLICO_ALCANCA}
     AND ((k.situacao = 'publicado' AND k.exibir_de <= ?
           AND (k.exibir_ate IS NULL OR k.exibir_ate > ? OR (k.exige_ciencia AND ci.ocorrido_em IS NULL)))
          OR (k.situacao = 'encerrado' AND ci.primeira_exibicao_em IS NOT NULL))`;

export class PortaComunicacaoPropria implements PortaComunicacao {
  readonly destino = 'banco' as const;
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: NucleoComunicacao,
    executorPronto?: Executor,
    private readonly agora: () => Date = () => new Date(),
  ) {
    this.executor = executorPronto ?? nucleo.criarExecutor();
  }

  private ler<T>(c: ContextoComunicacao, fn: (l: Leitor, est: number) => Promise<T>): Promise<T> {
    const est = estDe(c);
    return this.nucleo.lerSomente(contextoDe(c, 'comunicacao'), (l) => fn(l, est));
  }

  // ── Mensagens e comunicados ───────────────────────────────────────────────────────────────────────

  private paramsPublico(est: number, u: number, hoje: string): unknown[] {
    return [est, u, u, est, hoje, hoje, u];
  }

  recebidas(c: ContextoComunicacao, login: string): Promise<MensagemRecebida[]> {
    return this.ler(c, async (l, est) => {
      const u = await usuarioDoLogin(l, login);
      if (u === null) return [];
      const agora = this.agora();
      const [ms, ks] = await Promise.all([
        l.consultar(
          `${SQL_MENSAGENS_RECEBIDAS} ORDER BY m.enviada_em DESC, m.id DESC LIMIT ${TETO_MENSAGENS}`,
          [u, est],
          {
            teto: TETO_MENSAGENS,
          },
        ),
        l.consultar(
          `${SQL_COMUNICADOS_RECEBIDOS} GROUP BY k.id ORDER BY k.publicado_em DESC, k.id DESC LIMIT ${TETO_MENSAGENS}`,
          [u, est, ...this.paramsPublico(est, u, hojeDe(agora)), agora, agora],
          { teto: TETO_MENSAGENS },
        ),
      ]);
      return [...ms.map((r) => recebidaDe(r, 'mensagem')), ...ks.map((r) => recebidaDe(r, 'comunicado'))]
        .sort((a, b) => b.enviadaEm.localeCompare(a.enviadaEm) || b.id - a.id)
        .slice(0, TETO_MENSAGENS);
    });
  }

  recebida(
    c: ContextoComunicacao,
    login: string,
    id: number,
    tipo?: TipoItem,
  ): Promise<MensagemRecebida | null> {
    return this.ler(c, (l, est) => this.recebidaNa(l, est, login, id, tipo));
  }

  private async recebidaNa(
    l: Leitor,
    est: number,
    login: string,
    id: number,
    tipo?: TipoItem,
  ): Promise<MensagemRecebida | null> {
    const u = await usuarioDoLogin(l, login);
    if (u === null) return null;
    if (tipo !== 'comunicado') {
      const m = await l.uma(`${SQL_MENSAGENS_RECEBIDAS} AND m.id = ?`, [u, est, id]);
      if (m) return recebidaDe(m, 'mensagem');
      if (tipo === 'mensagem') return null;
    }
    const agora = this.agora();
    const k = await l.uma(`${SQL_COMUNICADOS_RECEBIDOS} AND k.id = ? GROUP BY k.id`, [
      u,
      est,
      ...this.paramsPublico(est, u, hojeDe(agora)),
      agora,
      agora,
      id,
    ]);
    return k ? recebidaDe(k, 'comunicado') : null;
  }

  enviadas(c: ContextoComunicacao, login: string): Promise<MensagemEnviada[]> {
    return this.ler(c, async (l, est) => {
      const u = await usuarioDoLogin(l, login);
      if (u === null) return [];
      const [ms, ks] = await Promise.all([
        l.consultar(
          `SELECT m.id, m.assunto, m.enviada_em AS em, m.solicita_resposta AS ciencia,
                  (SELECT COUNT(*) FROM mensagem_interna_destinatario d WHERE d.mensagem_interna_id = m.id AND d.excluido_em IS NULL) AS n,
                  (SELECT COUNT(*) FROM mensagem_interna_destinatario d WHERE d.mensagem_interna_id = m.id AND d.excluido_em IS NULL AND d.lida) AS lidas,
                  (SELECT COUNT(*) FROM mensagem_interna_destinatario d WHERE d.mensagem_interna_id = m.id AND d.excluido_em IS NULL AND d.respondida_em IS NOT NULL) AS ciencias
             FROM mensagem_interna m
            WHERE m.remetente_usuario_id = ? AND m.estabelecimento_id = ? AND m.situacao = 'enviada'
              AND m.origem <> 'migracao' AND m.excluido_em IS NULL
            ORDER BY m.enviada_em DESC, m.id DESC LIMIT ${TETO_MENSAGENS}`,
          [u, est],
          { teto: TETO_MENSAGENS },
        ),
        l.consultar(
          `SELECT k.id, k.titulo AS assunto, k.publicado_em AS em, k.exige_ciencia AS ciencia, k.exibir_de AS vig_ini,
                  k.exibir_ate AS vig_fim, ${EVENTO_NA_TRILHA('tr.ocorrido_em', 'encerramento')} AS encerrado_em,
                  (SELECT COUNT(*) FROM comunicado_destinatario cd WHERE cd.comunicado_id = k.id AND cd.excluido_em IS NULL) AS n,
                  (SELECT COUNT(*) FROM comunicado_ciencia ci WHERE ci.comunicado_id = k.id AND ci.primeira_exibicao_em IS NOT NULL) AS lidas,
                  (SELECT COUNT(*) FROM comunicado_ciencia ci WHERE ci.comunicado_id = k.id AND ci.ocorrido_em IS NOT NULL) AS ciencias
             FROM comunicado k
            WHERE k.publicador_usuario_id = ? AND k.estabelecimento_id = ? AND k.excluido_em IS NULL
              AND k.situacao IN ('publicado', 'encerrado')
            ORDER BY k.publicado_em DESC, k.id DESC LIMIT ${TETO_MENSAGENS}`,
          [u, est],
          { teto: TETO_MENSAGENS },
        ),
      ]);
      const item = (r: Linha, tipo: TipoItem): MensagemEnviada => ({
        id: n(r['id']),
        tipo,
        assunto: t(r['assunto']),
        enviadaEm: iso(r['em']) ?? '',
        destinatarios: n(r['n']),
        lidas: n(r['lidas']),
        ciencias: n(r['ciencias']),
        cienciaObrigatoria: bool(r['ciencia']),
        vigenciaInicio: iso(r['vig_ini']),
        vigenciaFim: iso(r['vig_fim']),
        encerradoEm: iso(r['encerrado_em']),
      });
      return [...ms.map((r) => item(r, 'mensagem')), ...ks.map((r) => item(r, 'comunicado'))]
        .sort((a, b) => b.enviadaEm.localeCompare(a.enviadaEm) || b.id - a.id)
        .slice(0, TETO_MENSAGENS);
    });
  }

  comunicado(c: ContextoComunicacao, id: number): Promise<ComunicadoRegistrado | null> {
    return this.ler(c, async (l, est) => {
      const k = await l.uma(
        `SELECT k.id, p.login AS remetente, k.titulo, k.texto, k.exige_ciencia, k.publicado_em, k.exibir_de,
                k.exibir_ate
           FROM comunicado k LEFT JOIN usuario p ON p.id = k.publicador_usuario_id
          WHERE k.id = ? AND k.estabelecimento_id = ? AND k.excluido_em IS NULL
            AND k.situacao IN ('publicado', 'encerrado')`,
        [id, est],
      );
      if (!k) return null;
      const [ds, es] = await Promise.all([
        l.consultar(
          `SELECT u.login, 'usuario' AS via, ci.primeira_exibicao_em AS lida_em, ci.ocorrido_em AS ciencia_em
             FROM comunicado_destinatario cd JOIN usuario u ON u.id = cd.usuario_id
             LEFT JOIN comunicado_ciencia ci ON ci.comunicado_id = cd.comunicado_id AND ci.usuario_id = cd.usuario_id
            WHERE cd.comunicado_id = ? AND cd.tipo_destinatario = 'usuario' AND cd.excluido_em IS NULL
           UNION ALL
           SELECT u.login, 'publico' AS via, ci.primeira_exibicao_em, ci.ocorrido_em
             FROM comunicado_ciencia ci JOIN usuario u ON u.id = ci.usuario_id
            WHERE ci.comunicado_id = ? AND NOT EXISTS (SELECT 1 FROM comunicado_destinatario cd
                    WHERE cd.comunicado_id = ci.comunicado_id AND cd.tipo_destinatario = 'usuario'
                      AND cd.usuario_id = ci.usuario_id AND cd.excluido_em IS NULL)
            ORDER BY login LIMIT ${TETO_DESTINATARIOS_DETALHE}`,
          [id, id],
          { teto: TETO_DESTINATARIOS_DETALHE },
        ),
        l.consultar(
          `SELECT JSON_VALUE(tr.dados_depois, '$.dados.evento') AS evento,
                  JSON_VALUE(tr.dados_depois, '$.dados.antes') AS antes,
                  JSON_VALUE(tr.dados_depois, '$.dados.por') AS por, tr.motivo, tr.ocorrido_em
             FROM trilha_auditoria tr
            WHERE tr.entidade = 'comunicado' AND tr.entidade_id = ? AND tr.estabelecimento_id = ?
              AND JSON_VALUE(tr.dados_depois, '$.dados.evento') IN ('correcao', 'vigencia', 'encerramento')
            ORDER BY tr.ocorrido_em, tr.id LIMIT ${TETO_EVENTOS}`,
          [id, est],
          { teto: TETO_EVENTOS },
        ),
      ]);
      const eventos = es.map((e) => ({
        evento: t(e['evento']) as 'correcao' | 'vigencia' | 'encerramento',
        antes: tn(e['antes']),
        motivo: t(e['motivo']),
        por: t(e['por']),
        em: iso(e['ocorrido_em']) ?? '',
      }));
      const fim = [...eventos].reverse().find((e) => e.evento === 'encerramento') ?? null;
      return {
        id: n(k['id']),
        remetente: t(k['remetente']),
        assunto: t(k['titulo']),
        texto: t(k['texto']),
        cienciaObrigatoria: bool(k['exige_ciencia']),
        publicadoEm: iso(k['publicado_em']) ?? '',
        vigenciaInicio: iso(k['exibir_de']) ?? '',
        vigenciaFim: iso(k['exibir_ate']) ?? '',
        encerradoEm: fim?.em ?? null,
        encerradoPor: fim?.por ?? null,
        motivoEncerramento: fim?.motivo ?? null,
        destinatarios: ds.map((d) => ({
          login: t(d['login']),
          via: t(d['via']),
          lidaEm: iso(d['lida_em']),
          cienciaEm: iso(d['ciencia_em']),
        })),
        eventos,
      };
    });
  }

  atendimentoDoContexto(c: ContextoComunicacao, atendimento: number): Promise<{ paciente: number } | null> {
    return this.ler(c, async (l, est) => {
      const r = await l.uma(
        'SELECT paciente_id FROM atendimento WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [atendimento, est],
      );
      return r ? { paciente: n(r['paciente_id']) } : null;
    });
  }

  destinatarios(
    c: ContextoComunicacao,
    destinos: readonly DestinoComunicacao[],
    teto: number,
  ): Promise<{ destinatarios: DestinatarioResolvido[]; desconhecidos: string[]; passou: boolean }> {
    return this.ler(c, async (l, est) => {
      const agora = this.agora();
      const hoje = hojeDe(agora);
      const ativa = [agora, est, hoje, hoje];
      const vistos = new Map<string, string>();
      const desconhecidos: string[] = [];
      for (const d of destinos) {
        let ls: Linha[] = [];
        const numero = /^\d{1,15}$/.test(d.valor) ? Number(d.valor) : null;
        if (d.tipo === 'usuario')
          ls = await l.consultar(
            `SELECT u.login FROM usuario u WHERE u.login = ? AND ${CONTA_ATIVA}`,
            [d.valor, ...ativa],
            {
              teto: 1,
            },
          );
        else if (d.tipo === 'grupo')
          ls = await l.consultar(
            `SELECT DISTINCT u.login FROM usuario u
               JOIN usuario_perfil up ON up.usuario_id = u.id AND up.estabelecimento_id = ? AND up.excluido_em IS NULL
                AND up.vigencia_inicio <= ? AND (up.vigencia_fim IS NULL OR up.vigencia_fim >= ?)
               JOIN perfil_acesso pa ON pa.id = up.perfil_acesso_id AND pa.ativo AND pa.excluido_em IS NULL
                AND (pa.estabelecimento_id IS NULL OR pa.estabelecimento_id = ?)
              WHERE pa.codigo = ? AND ${CONTA_ATIVA} LIMIT ${teto + 1}`,
            [est, hoje, hoje, est, d.valor, ...ativa],
            { teto: teto + 1 },
          );
        else if (d.tipo === 'setor' && numero !== null)
          ls = await l.consultar(
            `SELECT DISTINCT u.login FROM usuario u
               JOIN usuario_escopo ue2 ON ue2.usuario_id = u.id AND ue2.estabelecimento_id = ? AND ue2.excluido_em IS NULL
                AND ue2.entidade_id = ? AND ue2.vigencia_inicio <= ? AND (ue2.vigencia_fim IS NULL OR ue2.vigencia_fim >= ?)
               JOIN tipo_escopo_acesso te ON te.id = ue2.tipo_escopo_acesso_id AND te.codigo = 'setor' AND te.ativo
              WHERE ${CONTA_ATIVA} LIMIT ${teto + 1}`,
            [est, numero, hoje, hoje, ...ativa],
            { teto: teto + 1 },
          );
        else if (d.tipo === 'unidade' && numero !== null)
          ls = await l.consultar(
            `SELECT DISTINCT u.login FROM usuario u
               JOIN usuario_unidade uu ON uu.usuario_id = u.id AND uu.excluido_em IS NULL
               JOIN unidade_assistencial ua ON ua.id = uu.unidade_assistencial_id AND ua.estabelecimento_id = ?
                AND ua.excluido_em IS NULL
              WHERE uu.unidade_assistencial_id = ? AND ${CONTA_ATIVA} LIMIT ${teto + 1}`,
            [est, numero, ...ativa],
            { teto: teto + 1 },
          );
        if (ls.length === 0) desconhecidos.push(`${d.tipo} ${d.valor}`);
        const via = (d.tipo === 'usuario' ? 'usuario' : `${d.tipo} ${d.valor}`).slice(0, 40);
        for (const x of ls) {
          const login = t(x['login']);
          if (login && !vistos.has(login)) vistos.set(login, via);
        }
        if (vistos.size > teto) break;
      }
      return {
        destinatarios: [...vistos].slice(0, teto).map(([login, via]) => ({ login, via })),
        desconhecidos,
        passou: vistos.size > teto,
      };
    });
  }

  anteriores(c: ContextoComunicacao, login: string): Promise<MensagemAnterior[]> {
    return this.ler(c, async (l, est) => {
      const u = await usuarioDoLogin(l, login);
      if (u === null) return [];
      const ls = await l.consultar(
        `SELECT m.id, r.login AS origem, m.texto, m.enviada_em, d.lida_em
           FROM mensagem_interna_destinatario d
           JOIN mensagem_interna m ON m.id = d.mensagem_interna_id
           LEFT JOIN usuario r ON r.id = m.remetente_usuario_id
          WHERE d.destinatario_usuario_id = ? AND m.estabelecimento_id = ? AND m.origem = 'migracao'
            AND d.excluido_em IS NULL AND m.excluido_em IS NULL
          ORDER BY m.enviada_em DESC, m.id DESC LIMIT ${TETO_MENSAGENS}`,
        [u, est],
        { teto: TETO_MENSAGENS },
      );
      return ls.map((r) => ({
        sequencia: n(r['id']),
        origem: tn(r['origem']),
        texto: t(r['texto']),
        enviadaEm: iso(r['enviada_em']),
        lidaEm: iso(r['lida_em']),
      }));
    });
  }

  dicionario(c: ContextoComunicacao, login: string): Promise<{ palavra: string; fonetica: string }[]> {
    // O dicionário é da pessoa, na rede inteira (sem estabelecimento).
    return this.ler(c, async (l) => {
      const u = await usuarioDoLogin(l, login);
      if (u === null) return [];
      const ls = await l.consultar(
        `SELECT palavra, fonetica FROM dicionario_usuario WHERE usuario_id = ? AND excluido_em IS NULL
          ORDER BY palavra LIMIT ${TETO_DICIONARIO}`,
        [u],
        { teto: TETO_DICIONARIO },
      );
      return ls.map((r) => ({ palavra: t(r['palavra']), fonetica: t(r['fonetica']) }));
    });
  }

  avisos(c: ContextoComunicacao, login: string): Promise<AvisoRegistrado[]> {
    return this.ler(c, async (l, est) => {
      const u = await usuarioDoLogin(l, login);
      if (u === null) return [];
      const ls = await l.consultar(
        `SELECT a.id, a.titulo, a.link, a.gravidade, a.lida, a.resolvida, a.gerada_em, a.detalhes, ms.codigo AS modulo
           FROM notificacao_usuario a LEFT JOIN modulo_sistema ms ON ms.id = a.modulo_sistema_id
          WHERE a.usuario_id = ? AND a.estabelecimento_id = ? AND a.excluido_em IS NULL
            AND (a.expira_em IS NULL OR a.expira_em > ?)
            AND (a.resolvida = FALSE OR a.resolvida_em > ?)
          ORDER BY CASE WHEN a.resolvida THEN 2 WHEN a.lida THEN 1 ELSE 0 END, a.gerada_em DESC, a.id DESC
          LIMIT ${TETO_AVISOS}`,
        [u, est, this.agora(), new Date(this.agora().getTime() - 7 * 86_400_000)],
        { teto: TETO_AVISOS },
      );
      return ls.map((r) => {
        const det = lerDetalhes(r['detalhes']);
        return {
          id: n(r['id']),
          tipo: det.tipo ?? 'aviso',
          gravidade: gravidadeDaTela(r['gravidade']),
          modulo: tn(r['modulo']) ?? det.modulo ?? '',
          evento: det.evento ?? '',
          titulo: t(r['titulo']),
          link: tn(r['link']),
          estado: bool(r['resolvida']) ? 'resolvido' : bool(r['lida']) ? 'lido' : 'novo',
          criadoEm: iso(r['gerada_em']) ?? '',
        };
      });
    });
  }

  // ── Gravação ──────────────────────────────────────────────────────────────────────────────────────

  async podeGravar(c: ContextoComunicacao, operacao: string): Promise<LiberacaoComunicacao> {
    const op = OPERACOES_PROPRIAS.get(operacao);
    if (!op) return { pode: false, codigo: 'operacao-desconhecida', motivo: 'Operação fora da comunicação.' };
    return this.executor.liberacao(op, {
      ...contextoDe(c, 'comunicacao'),
      chaveIdempotencia: 'consulta-liberacao',
    });
  }

  async executar(
    c: ContextoComunicacao,
    operacao: string,
    entrada: unknown,
    octx: ContextoOperacaoComunicacao,
  ): Promise<{ resultado: Record<string, unknown>; repetida: boolean }> {
    const op = OPERACOES_PROPRIAS.get(operacao);
    if (!op) throw recusa('operacao-desconhecida', 'Operação fora da comunicação.');
    const ctx: ContextoOperacao = {
      cliente: c.cliente,
      estabelecimento: octx.estabelecimento,
      usuario: octx.usuario,
      correlacao: octx.correlacao,
      chaveIdempotencia: octx.chaveIdempotencia,
      ...(octx.reautenticadoEm !== undefined ? { reautenticadoEm: octx.reautenticadoEm } : {}),
    };
    const r = await this.executor.executar(op, c.cliente, entrada, ctx);
    return { resultado: { ...r.resultado }, repetida: r.repetida };
  }

  async gravarSgh<T>(
    c: ContextoComunicacao,
    trilha: TrilhaComunicacao | ((r: T) => TrilhaComunicacao),
    fn: (g: GravadorComunicacao) => Promise<T>,
    pedido?: PedidoGravacao,
  ): Promise<T> {
    const est = estDe(c);
    let saida: { valor: T } | null = null;
    const extras: Extras = { motivo: null, dados: {} };
    const linha = () => (typeof trilha === 'function' ? (saida ? trilha(saida.valor) : null) : trilha);
    const operacaoDaTrilha = (l: TrilhaComunicacao | null) =>
      String((l?.dadosDepois as { operacao?: unknown } | undefined)?.operacao ?? 'comunicacao');
    const operacao =
      pedido?.operacao ?? (typeof trilha === 'function' ? 'acesso.comunicacao' : operacaoDaTrilha(trilha));
    const op = definirOperacao({
      nome: nomeDaOperacao(operacao),
      tabelas: TABELAS_GRAVACAO,
      entrada: z.object({ chave: z.string(), operacao: z.string(), resumo: z.string().nullable() }),
      gravar: async (tx) => {
        saida = { valor: await fn(gravador(tx, est, c.usuario, this.agora, extras)) };
        // O resultado (ids) fica na idempotência: o reenvio do pedido o recebe sem gravar de novo.
        return { valor: JSON.stringify(saida.valor ?? null) } as ResultadoOperacao;
      },
      alvo: () => {
        const l = linha();
        return { tabela: l?.entidade ?? 'mensagem_interna', id: l?.entidadeId ?? null };
      },
      trilha: () => {
        const depois = linha()?.dadosDepois;
        const dados =
          depois && typeof depois === 'object'
            ? { ...(depois as object), ...extras.dados }
            : (depois ?? extras.dados);
        return { acao: linha()?.acao ?? 'operacao', dados, motivo: extras.motivo ?? linha()?.motivo ?? null };
      },
    });
    const chaveUsada = pedido?.chave ?? `comunicacao:${randomUUID()}`;
    const r = await this.executor.executar(
      op,
      c.cliente,
      { chave: chaveUsada, operacao, resumo: pedido?.resumo ?? null },
      { ...contextoDe(c, 'comunicacao'), chaveIdempotencia: chaveUsada },
    );
    if (r.repetida) {
      const anterior = JSON.parse(String(r.resultado['valor'] ?? 'null')) as T;
      return anterior !== null && typeof anterior === 'object' && 'repetida' in (anterior as object)
        ? ({ ...(anterior as object), repetida: true } as T)
        : anterior;
    }
    if (!saida) throw new Error('Gravação da comunicação sem resultado.');
    return (saida as { valor: T }).valor;
  }
}

/**
 * O nome da operação no Executor a partir do nome da ação ('acesso.enviarMensagem' -> 'acesso.enviar-mensagem',
 * 'acesso.marcarAviso:lido' -> 'acesso.marcar-aviso-lido'), no formato do núcleo (minúsculas, ponto e hífen).
 */
export function nomeDaOperacao(acao: string): string {
  return acao
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, '-')
    .slice(0, 120);
}

interface Extras {
  motivo: string | null;
  dados: Record<string, unknown>;
}

function lerDetalhes(v: unknown): { tipo?: string; modulo?: string; evento?: string } {
  if (v === null || v === undefined) return {};
  try {
    const d = typeof v === 'string' ? (JSON.parse(v) as unknown) : v;
    return d && typeof d === 'object' ? (d as { tipo?: string; modulo?: string; evento?: string }) : {};
  } catch {
    return {};
  }
}

// ── Operações do dicionário ─────────────────────────────────────────────────────────────────────────

const incluirPalavra = definirOperacao({
  nome: OPERACOES_DICIONARIO.incluir,
  tabelas: ['dicionario_usuario'],
  entrada: ENTRADA_DICIONARIO,
  acao: 'inclusao',
  async gravar(tx, e, ctx) {
    if (ctx.usuario === null) throw recusa('sem-usuario', 'O dicionário é da conta da sessão.');
    const palavra = palavraDoDicionario(e.palavra);
    const ja = await tx.uma('SELECT id FROM dicionario_usuario WHERE usuario_id = ? AND palavra = ?', [
      ctx.usuario,
      palavra,
    ]);
    if (ja)
      throw recusa('palavra-existente', 'A palavra já está no seu dicionário.', { campos: ['palavra'] });
    const conta = await tx.uma(
      'SELECT COUNT(*) AS n FROM dicionario_usuario WHERE usuario_id = ? AND excluido_em IS NULL',
      [ctx.usuario],
    );
    if (n(conta?.['n']) >= TETO_DICIONARIO)
      throw recusa(
        'dicionario-cheio',
        `O dicionário chegou a ${TETO_DICIONARIO} palavras: exclua alguma antes de incluir outra.`,
      );
    const id = await tx.incluir('dicionario_usuario', {
      usuario_id: ctx.usuario,
      palavra,
      fonetica: foneticaDoDicionario(palavra).slice(0, 80) || null,
      origem: 'sistema',
    });
    return { id, palavras: 1 };
  },
  alvo: (_e, r) => ({ tabela: 'dicionario_usuario', id: Number(r.id) }),
});

const excluirPalavra = definirOperacao({
  nome: OPERACOES_DICIONARIO.excluir,
  tabelas: ['dicionario_usuario'],
  entrada: ENTRADA_DICIONARIO,
  acao: 'exclusao',
  async gravar(tx, e, ctx) {
    if (ctx.usuario === null) throw recusa('sem-usuario', 'O dicionário é da conta da sessão.');
    const palavra = palavraDoDicionario(e.palavra);
    const r = await tx.uma('SELECT id, versao FROM dicionario_usuario WHERE usuario_id = ? AND palavra = ?', [
      ctx.usuario,
      palavra,
    ]);
    if (!r)
      throw recusa('palavra-inexistente', 'A palavra não está no seu dicionário.', { campos: ['palavra'] });
    await tx.excluir('dicionario_usuario', n(r['id']), n(r['versao']));
    return { id: n(r['id']), palavras: 1 };
  },
  alvo: (_e, r) => ({ tabela: 'dicionario_usuario', id: Number(r.id) }),
});

const OPERACOES_PROPRIAS = new Map<string, typeof incluirPalavra>([
  [OPERACOES_DICIONARIO.incluir, incluirPalavra],
  [OPERACOES_DICIONARIO.excluir, excluirPalavra],
]);

/** O nome da operação do dicionário (a memória e o banco aceitam os mesmos). */
export const operacaoComunicacaoConhecida = (nome: string) => operacaoDoDicionario(nome) !== null;

// ── Gravador sobre a transação da operação ──────────────────────────────────────────────────────────

function gravador(
  tx: TxOperacao,
  est: number,
  operador: number | null,
  agora: () => Date,
  extras: Extras,
): GravadorComunicacao {
  async function idsDosLogins(logins: readonly string[]): Promise<Map<string, number>> {
    const r = new Map<string, number>();
    for (let i = 0; i < logins.length; i += 500) {
      const parte = logins.slice(i, i + 500);
      const ls = await tx.consultar(
        `SELECT id, login FROM usuario WHERE excluido_em IS NULL AND login IN (${parte.map(() => '?').join(', ')})`,
        parte,
        { teto: parte.length },
      );
      for (const l of ls) r.set(t(l['login']), n(l['id']));
    }
    return r;
  }

  async function comunicadoParaMudar(id: number): Promise<Linha> {
    const [k] = await tx.consultarParaAtualizar(
      `SELECT id, versao, situacao, exibir_de, exibir_ate, titulo, texto FROM comunicado
        WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL AND situacao IN ('publicado', 'encerrado')`,
      [id, est],
      { teto: 1 },
    );
    if (!k)
      throw new ErroOperacao(
        404,
        'nao-encontrado',
        'Não encontrado',
        'Comunicado não encontrado neste estabelecimento.',
      );
    if (t(k['situacao']) === 'encerrado')
      throw recusa('comunicado-encerrado', 'Este comunicado já foi encerrado: publique outro.');
    return k;
  }

  async function mensagemDoDestinatario(login: string, id: number): Promise<{ u: number; d: Linha } | null> {
    const u = await exigirUsuario(tx, login);
    const [d] = await tx.consultarParaAtualizar(
      `SELECT d.id, d.lida, d.respondida_em FROM mensagem_interna_destinatario d
         JOIN mensagem_interna m ON m.id = d.mensagem_interna_id
        WHERE d.mensagem_interna_id = ? AND d.destinatario_usuario_id = ? AND m.estabelecimento_id = ?
          AND d.excluido_em IS NULL AND m.excluido_em IS NULL`,
      [id, u, est],
      { teto: 1 },
    );
    return d ? { u, d } : null;
  }

  async function cienciaDoComunicado(
    login: string,
    id: number,
  ): Promise<{ u: number; k: Linha; ci: Linha | null }> {
    const u = await exigirUsuario(tx, login);
    const hoje = hojeDe(agora());
    const k = await tx.uma(
      `SELECT k.id, k.situacao FROM comunicado k
         JOIN comunicado_destinatario cd ON cd.comunicado_id = k.id AND cd.excluido_em IS NULL
        WHERE k.id = ? AND k.estabelecimento_id = ? AND k.excluido_em IS NULL AND ${PUBLICO_ALCANCA} LIMIT 1`,
      [id, est, est, u, u, est, hoje, hoje, u],
    );
    if (!k) throw recusa('nao-destinatario', 'Esta mensagem não é para você.');
    const [ci] = await tx.consultarParaAtualizar(
      'SELECT id, versao, primeira_exibicao_em, ocorrido_em FROM comunicado_ciencia WHERE comunicado_id = ? AND usuario_id = ?',
      [id, u],
      { teto: 1 },
    );
    return { u, k, ci: ci ?? null };
  }

  return {
    async gravarMensagem(m: NovaMensagem) {
      if (m.destinatarios.length === 0)
        throw recusa('sem-destinatario', 'Nenhum destinatário ativo nos destinos escolhidos.');
      const remetente = await exigirUsuario(tx, m.remetente);
      const ids = await idsDosLogins(m.destinatarios.map((d) => d.login));
      const dest = m.destinatarios.filter((d) => ids.has(d.login));
      if (dest.length === 0)
        throw recusa('sem-destinatario', 'Nenhum destinatário ativo nos destinos escolhidos.');
      const instante = agora();
      extras.dados = { destinatarios: dest.length, cienciaObrigatoria: m.cienciaObrigatoria };
      if (m.tipo === 'mensagem') {
        const id = await tx.incluir('mensagem_interna', {
          estabelecimento_id: est,
          remetente_usuario_id: remetente,
          assunto: m.assunto,
          texto: m.texto,
          prioridade: 'normal',
          situacao: 'enviada',
          enviada_em: instante,
          solicita_resposta: m.cienciaObrigatoria,
          atendimento_id: m.atendimento,
          origem: 'sistema',
        });
        let seq = 0;
        for (const d of dest)
          await tx.incluir('mensagem_interna_destinatario', {
            mensagem_interna_id: id,
            sequencia: ++seq,
            destinatario_usuario_id: ids.get(d.login),
            tipo_destino: 'para',
            pasta: 'entrada',
            lida: false,
            origem: 'sistema',
          });
        return { id, repetida: false };
      }
      if (!m.vigenciaInicio)
        throw recusa('vigencia-invalida', 'Informe o início da vigência.', { campos: ['vigenciaInicio'] });
      const id = await tx.incluir('comunicado', {
        estabelecimento_id: est,
        titulo: m.assunto,
        texto: m.texto,
        formato_texto: 'texto',
        prioridade: 'normal',
        exibir_de: new Date(m.vigenciaInicio),
        exibir_ate: m.vigenciaFim ? new Date(m.vigenciaFim) : null,
        exige_ciencia: m.cienciaObrigatoria,
        exibir_na_entrada: m.cienciaObrigatoria,
        situacao: 'publicado',
        publicado_em: instante,
        publicador_usuario_id: remetente,
        origem: 'sistema',
      });
      for (const d of dest)
        await tx.incluir('comunicado_destinatario', {
          comunicado_id: id,
          tipo_destinatario: 'usuario',
          usuario_id: ids.get(d.login),
        });
      return { id, repetida: false };
    },

    async marcarLida({ login, id, tipo }: { login: string; id: number; tipo?: TipoItem }) {
      const instante = agora();
      if (tipo !== 'comunicado') {
        const m = await mensagemDoDestinatario(login, id);
        if (m) {
          if (bool(m.d['lida'])) return false;
          await tx.executar(
            `UPDATE mensagem_interna_destinatario SET lida = TRUE, lida_em = ?, alterado_em = ?, alterado_por = ?,
                    versao = versao + 1 WHERE id = ?`,
            [instante, instante, operador, n(m.d['id'])],
          );
          return true;
        }
        if (tipo === 'mensagem') throw recusa('nao-destinatario', 'Esta mensagem não é para você.');
      }
      const { u, ci } = await cienciaDoComunicado(login, id);
      if (ci?.['primeira_exibicao_em']) {
        await tx.executar(
          `UPDATE comunicado_ciencia SET quantidade_exibicoes = quantidade_exibicoes + 1, alterado_em = ?,
                  alterado_por = ?, versao = versao + 1 WHERE id = ?`,
          [instante, operador, n(ci['id'])],
        );
        return false;
      }
      if (ci)
        await tx.executar(
          `UPDATE comunicado_ciencia SET primeira_exibicao_em = ?, quantidade_exibicoes = quantidade_exibicoes + 1,
                  alterado_em = ?, alterado_por = ?, versao = versao + 1 WHERE id = ?`,
          [instante, instante, operador, n(ci['id'])],
        );
      else
        await tx.incluir('comunicado_ciencia', {
          comunicado_id: id,
          usuario_id: u,
          primeira_exibicao_em: instante,
          quantidade_exibicoes: 1,
        });
      return true;
    },

    async registrarCiencia({ login, id, tipo }: { login: string; id: number; tipo?: TipoItem }) {
      const instante = agora();
      if (tipo !== 'comunicado') {
        const m = await mensagemDoDestinatario(login, id);
        if (m) {
          if (m.d['respondida_em']) return false;
          await tx.executar(
            `UPDATE mensagem_interna_destinatario SET respondida_em = ?, lida = TRUE, lida_em = COALESCE(lida_em, ?),
                    alterado_em = ?, alterado_por = ?, versao = versao + 1 WHERE id = ?`,
            [instante, instante, instante, operador, n(m.d['id'])],
          );
          return true;
        }
        if (tipo === 'mensagem') throw recusa('nao-destinatario', 'Esta mensagem não é para você.');
      }
      const { u, k, ci } = await cienciaDoComunicado(login, id);
      if (t(k['situacao']) === 'encerrado')
        throw recusa('comunicado-encerrado', 'Este comunicado foi encerrado e não pede mais ciência.');
      if (ci?.['ocorrido_em']) return false;
      if (ci)
        await tx.executar(
          `UPDATE comunicado_ciencia SET ocorrido_em = ?, primeira_exibicao_em = COALESCE(primeira_exibicao_em, ?),
                  alterado_em = ?, alterado_por = ?, versao = versao + 1 WHERE id = ?`,
          [instante, instante, instante, operador, n(ci['id'])],
        );
      else
        await tx.incluir('comunicado_ciencia', {
          comunicado_id: id,
          usuario_id: u,
          primeira_exibicao_em: instante,
          quantidade_exibicoes: 1,
          ocorrido_em: instante,
        });
      return true;
    },

    async gravarAviso(a: NovoAviso) {
      const u = await usuarioDoLogin(tx, a.login);
      if (u === null) throw recusa('destinatario-inexistente', 'O destinatário do aviso não existe.');
      const agrupamento = `${a.evento}:${a.objetoChave}`.slice(0, 100);
      const ja = await tx.uma(
        `SELECT id FROM notificacao_usuario WHERE usuario_id = ? AND chave_agrupamento = ? AND estabelecimento_id = ?
            AND resolvida = FALSE AND excluido_em IS NULL LIMIT 1`,
        [u, agrupamento, est],
      );
      if (ja) return null;
      const modulo = await tx.uma('SELECT id FROM modulo_sistema WHERE codigo = ?', [a.modulo]);
      return tx.incluir('notificacao_usuario', {
        estabelecimento_id: est,
        usuario_id: u,
        modulo_sistema_id: modulo ? n(modulo['id']) : null,
        titulo: a.titulo,
        texto: a.titulo,
        detalhes: JSON.stringify({ tipo: a.tipo, modulo: a.modulo, evento: a.evento }),
        link: a.link,
        gravidade: GRAVIDADE_DO_MODELO[a.gravidade],
        entidade: a.objetoTabela,
        entidade_id: /^\d{1,15}$/.test(a.objetoChave) ? Number(a.objetoChave) : null,
        chave_agrupamento: agrupamento,
        gerada_em: agora(),
        lida: false,
        resolvida: false,
        origem: 'sistema',
      });
    },

    async mudarEstadoAviso({ login, id, estado }) {
      const u = await exigirUsuario(tx, login);
      const [a] = await tx.consultarParaAtualizar(
        `SELECT id, lida, resolvida FROM notificacao_usuario
          WHERE id = ? AND usuario_id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
        [id, u, est],
        { teto: 1 },
      );
      if (!a) throw recusa('aviso-inexistente', 'Aviso não encontrado.');
      const instante = agora();
      if (estado === 'lido') {
        if (bool(a['lida']) || bool(a['resolvida'])) return false;
        await tx.executar(
          `UPDATE notificacao_usuario SET lida = TRUE, lida_em = ?, alterado_em = ?, alterado_por = ?,
                  versao = versao + 1 WHERE id = ?`,
          [instante, instante, operador, id],
        );
        return true;
      }
      if (bool(a['resolvida'])) return false;
      await tx.executar(
        `UPDATE notificacao_usuario SET resolvida = TRUE, resolvida_em = ?, resolvida_por_usuario_id = ?,
                lida = TRUE, lida_em = COALESCE(lida_em, ?), alterado_em = ?, alterado_por = ?, versao = versao + 1
          WHERE id = ?`,
        [instante, u, instante, instante, operador, id],
      );
      return true;
    },

    async resolverAvisosDoObjeto({ login, tabela, id }) {
      const u = await exigirUsuario(tx, login);
      const instante = agora();
      return tx.executar(
        `UPDATE notificacao_usuario SET resolvida = TRUE, resolvida_em = ?, resolvida_por_usuario_id = ?,
                lida = TRUE, lida_em = COALESCE(lida_em, ?), alterado_em = ?, alterado_por = ?, versao = versao + 1
          WHERE usuario_id = ? AND estabelecimento_id = ? AND entidade = ? AND entidade_id = ?
            AND resolvida = FALSE AND excluido_em IS NULL`,
        [instante, u, instante, instante, operador, u, est, tabela, id],
      );
    },

    async corrigirComunicado(r) {
      const k = await comunicadoParaMudar(r.id);
      const c = await tx.uma(
        `SELECT SUM(primeira_exibicao_em IS NOT NULL) AS lidas, SUM(ocorrido_em IS NOT NULL) AS ciencias
           FROM comunicado_ciencia WHERE comunicado_id = ?`,
        [r.id],
      );
      const lidas = n(c?.['lidas']);
      const ciencias = n(c?.['ciencias']);
      if (lidas > 0 || ciencias > 0)
        throw recusa(
          'comunicado-ja-lido',
          `O texto já foi lido por ${lidas} destinatário(s), ${ciencias} com ciência, e não se edita. ` +
            'Para corrigir, encerre o comunicado com o motivo e publique outro.',
        );
      await tx.alterar('comunicado', r.id, n(k['versao']), { titulo: r.assunto, texto: r.texto });
      extras.motivo = r.motivo;
      extras.dados = {
        evento: 'correcao',
        antes: descricaoVersaoAnterior(t(k['titulo']), t(k['texto'])),
        versaoAnterior: n(k['versao']),
        por: r.por,
      };
    },

    async encurtarVigencia(r) {
      const k = await comunicadoParaMudar(r.id);
      const fim = new Date(r.vigenciaFim);
      const atual = k['exibir_ate'] ? new Date(String(iso(k['exibir_ate']))) : null;
      const inicio = new Date(String(iso(k['exibir_de'])));
      if (Number.isNaN(fim.getTime()) || (atual !== null && fim >= atual))
        throw recusa(
          'vigencia-invalida',
          'A vigência só pode ser encurtada: o fim novo tem de ser antes do fim atual.',
          {
            campos: ['vigenciaFim'],
          },
        );
      if (fim <= inicio)
        throw recusa('vigencia-invalida', 'O fim novo tem de ser depois do início da vigência.', {
          campos: ['vigenciaFim'],
        });
      if (fim <= agora())
        throw recusa(
          'vigencia-invalida',
          'O fim novo já passou: para tirar o comunicado do ar agora, encerre-o com o motivo.',
          { campos: ['vigenciaFim'] },
        );
      await tx.alterar('comunicado', r.id, n(k['versao']), { exibir_ate: fim });
      extras.motivo = r.motivo;
      extras.dados = { evento: 'vigencia', antes: atual ? atual.toISOString() : null, por: r.por };
    },

    async encerrarComunicado(r) {
      const k = await comunicadoParaMudar(r.id);
      await tx.alterar('comunicado', r.id, n(k['versao']), { situacao: 'encerrado' });
      extras.motivo = r.motivo;
      extras.dados = { evento: 'encerramento', antes: null, por: r.por };
    },
  } as GravadorComunicacao;
}
