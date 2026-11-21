// Fonte PRÓPRIA da gestão de acessos (F2.2, lote 02-02): o banco do cliente pelo @sgh/nucleo. Leituras em transação
// somente leitura, sempre no estabelecimento da sessão (vínculo vigente em usuario_estabelecimento) e sem registros
// excluídos; gravações pelo Executor (trilha, outbox e idempotência na mesma transação), com a linha travada (FOR UPDATE)
// e a versão conferida (trava otimista) antes de mudar.
// Tabelas: usuario, usuario_estabelecimento, usuario_perfil, perfil_acesso, papel_seguranca, usuario_papel_seguranca,
// usuario_situacao_historico, estabelecimento.
// Melhoria: a concessão de perfil é usuario_perfil com vigência e estabelecimento; a revogação encerra a vigência e marca a
// exclusão lógica (quem e quando), com o motivo na trilha; concessão sobreposta do mesmo perfil é recusada
// (perfil-ja-concedido) e a revogada no mesmo início é reaberta (a chave única cobre as revogadas).
// Melhoria: a entrada real de cada gravação passa pelo Executor (esquema e hash da idempotência: a mesma chave com outra
// entrada é recusada); toda recusa lança erro (sem trilha nem idempotência); o estado anterior vai à trilha (dados.antes).
// Melhoria: o bloqueio da conta grava a situação e a linha do tempo (usuario_situacao_historico) na mesma transação.
// Melhoria: papéis de segurança com vigência (usuario_papel_seguranca): retirar encerra, reativar abre vigência nova.
// Melhoria: só as contas com vínculo vigente no estabelecimento da sessão aparecem e podem ser alteradas.
// Sem grupos no modelo próprio (o perfil é a unidade de concessão): grupos, mapa grupo → perfil e decisões do mapa não
// existem no banco; as leituras devolvem a lista vazia e as gravações são recusadas com o motivo (SEM_GRUPOS).
// Tabelas da gestão (F2.4): o histórico das alterações da concessão (usuario_perfil_alteracao) e o motivo da revogação
// (usuario_perfil.revogado_motivo); as versões da política de senha com vigência futura (politica_senha_versao); os
// limites de sessão por perfil (limite_sessao_perfil); as exceções das contas dormentes (excecao_conta_dormente); a
// conferência do registro no conselho (conferencia_registro_conselho, sobre inscricao_conselho do profissional da conta);
// o RH (perfil_cargo_rh, resolucao_tarefa_rh, com vínculos, histórico de cargo, férias e afastamentos lidos do RH).
// Todas só por inclusão (linha nova), com a trilha na mesma transação. Pedidos de acesso e campanhas de recertificação:
// tabelas existem, adaptador a escrever (pedido ao orquestrador; respondem "adaptador-pendente").
import { randomUUID } from 'node:crypto';
import {
  type ContextoOperacao,
  definirOperacao,
  erroConflitoVersao,
  ErroOperacao,
  type Executor,
  type Leitor,
  type Linha,
  recusa,
  type ResultadoOperacao,
  type TxOperacao,
} from '@sgh/nucleo';
import { esquemaLogin } from '@sgh/contratos';
import { chaveCargoRh, REF_CRIAR_ACESSO } from '@sgh/dominio-acesso';
import { type ZodType, z } from 'zod';
import type { EstadoReceita, FonteGestao } from './gestao-fonte.js';
import {
  CODIGOS_PAPEL,
  type ContextoGestao,
  type ConcessaoPerfilNova,
  ehOperacaoConta,
  NOMES_PAPEL,
  OPERACOES_CONTA,
  type OperacaoConta,
  PERFIL_GESTOR_ACESSOS,
  type PerfilConcedidoLido,
  SEM_GRUPOS,
  type TrilhaGestao,
  type UsuarioGestao,
} from './gestao-tipos.js';
import type { ValidarResolucaoRhMemoria } from './rh-memoria.js';
import {
  type AfastamentoRhLido,
  type AlteracaoPerfilLida,
  type ConferenciaConselhoLida,
  type DadosRhLidos,
  diferencaPoliticaSenha,
  type ExcecaoDormenciaLida,
  type FonteConferenciaConselho,
  FONTES_CONFERENCIA_CONSELHO,
  type MudancaRhLida,
  type NovaConferenciaConselho,
  type NovaExcecaoDormencia,
  type NovaPoliticaSenha,
  type NovaResolucaoRh,
  type NovoLimiteSessao,
  type NovoPerfilCargoRh,
  normalizarSenhasProibidas,
  type PerfilCargoRhLido,
  type RegistroConselhoUsuario,
  type RegistroLimiteSessaoLido,
  type ResolucaoRhSghLida,
  type SituacaoConselho,
  SITUACOES_CONSELHO,
  type TipoTarefaRhSgh,
  type VersaoPoliticaSenhaLida,
  type VinculoRhLido,
} from './tipos-gestao-acesso.js';

/** O que a fonte usa do NucleoProprio (os testes trocam). */
export interface NucleoGestao {
  lerSomente<T>(
    contexto: { readonly cliente: string; readonly correlacao: string; readonly estabelecimento?: number | null },
    fn: (l: Leitor) => Promise<T>,
  ): Promise<T>;
  criarExecutor(): Executor;
}

const num = (v: unknown): number => Number(v);
const txt = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
const txtOuNull = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const bool = (v: unknown): boolean => v === true || Number(v) === 1;
const data = (v: unknown): Date | null => (v instanceof Date ? v : v ? new Date(String(v)) : null);
const dia = (d: Date): string => d.toISOString().slice(0, 10);
const PAPEL_DO_CODIGO = new Map(Object.entries(CODIGOS_PAPEL).map(([n, c]) => [c, Number(n)]));
const TETO = 5_000;

/** As tabelas existem, mas o adaptador próprio ainda não foi escrito: recusa explícita, nunca lista vazia. */
export function adaptadorPendenteGestao(recurso: string): Promise<never> {
  return Promise.reject(new ErroOperacao(
    409,
    'adaptador-pendente',
    `${recurso} indisponível`,
    `${recurso} ainda não grava no banco próprio deste servidor: nada foi lido nem gravado.`,
  ));
}

/**
 * A gravação da política de senha por versão e do limite de sessões por perfil só abre quando a sessão (login e troca de
 * senha) aplicar o que se grava: hoje ela lê só a política vigente e não lê o limite por perfil (pedido em
 * docs/obra/fatias/f24/saida/07-acesso.json). Até lá a gravação recusa com motivo explícito, para o gestor nunca achar
 * que uma regra vale quando ela não é aplicada. A leitura do histórico segue liberada.
 */
const SESSAO_APLICA_POLITICA_VERSIONADA: boolean = false;
const SESSAO_APLICA_LIMITE_POR_PERFIL: boolean = false;

const aplicacaoPendente = (recurso: string): never => {
  throw new ErroOperacao(
    409,
    'aplicacao-pendente',
    `${recurso} ainda não é aplicado`,
    `${recurso} ainda não é aplicado no login nem na troca de senha deste servidor: nada foi gravado e a regra em vigor continua a mesma.`,
  );
};

const semGrupos = (): never => {
  throw recusa('sem-grupos', SEM_GRUPOS);
};

/** Vínculo vigente do usuário (alias u) com o estabelecimento (parâmetro). */
const VINCULO = `EXISTS (SELECT 1 FROM usuario_estabelecimento ue WHERE ue.usuario_id = u.id AND ue.estabelecimento_id = ?
  AND ue.excluido_em IS NULL AND ue.vigencia_inicio <= CURDATE() AND (ue.vigencia_fim IS NULL OR ue.vigencia_fim >= CURDATE()))`;
const PERFIL_VIGENTE = `up.excluido_em IS NULL AND up.vigencia_inicio <= CURDATE() AND (up.vigencia_fim IS NULL OR up.vigencia_fim >= CURDATE())`;
const PAPEL_VIGENTE = `ups.excluido_em IS NULL AND ups.vigencia_inicio <= CURDATE() AND (ups.vigencia_fim IS NULL OR ups.vigencia_fim >= CURDATE())`;

function usuarioDaLinha(x: Linha): UsuarioGestao {
  const situacao = txt(x['situacao']);
  return {
    login: txt(x['login']),
    nome: txt(x['nome']),
    grupo: null,
    ativo: situacao !== 'inativo',
    bloqueado: situacao === 'bloqueado',
    id: num(x['id']),
  };
}

// As entradas das gravações de perfil (planas, datas como dia ISO): vão ao Executor, que valida e calcula o hash da
// idempotência sobre elas.
const DIA = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const fimDepoisDoInicio = (p: { inicio: string | null; fim: string | null }) => !p.fim || !p.inicio || p.fim >= p.inicio;
const ESQUEMA_CONCESSAO = z
  .object({
    login: esquemaLogin,
    perfil: z.string().trim().min(1).max(60),
    inicio: DIA.nullable(),
    fim: DIA.nullable(),
    motivo: z.string().trim().min(1).max(500),
    areaAprovou: z.string().trim().min(1).max(40),
  })
  .strict()
  .refine(fimDepoisDoInicio, { path: ['fim'] });
const ESQUEMA_REVOGACAO = z.object({ id: z.number().int().positive(), motivo: z.string().trim().min(1).max(500) }).strict();
const ESQUEMA_ALTERACAO = z
  .object({
    id: z.number().int().positive(),
    inicio: DIA,
    fim: DIA.nullable(),
    motivo: z.string().trim().min(1).max(500),
    justificativa: z.string().trim().min(1).max(500),
    por: esquemaLogin,
    versao: z.number().int().positive().optional(),
  })
  .strict()
  .refine(fimDepoisDoInicio, { path: ['fim'] });

/** O estado anterior da concessão, para a trilha (dados.antes). */
function estadoConcessao(x: Linha, revogada: boolean): Readonly<Record<string, unknown>> {
  const fim = data(x['vigencia_fim']);
  return {
    vigenciaInicio: dia(data(x['vigencia_inicio']) as Date),
    vigenciaFim: fim ? dia(fim) : null,
    motivo: txtOuNull(x['motivo']),
    versao: num(x['versao']),
    ...(revogada ? { revogada: true } : {}),
  };
}


// ── Leituras e esquemas das tabelas de gestão (política de senha, limites, dormência, conselho e RH) ─────────────

/** Limite de sessões que vale para todos os perfis (perfil_acesso_id nulo). */
const TODOS_PERFIS = '*';
const MOTIVO = z.string().trim().min(1).max(500);
const ESQUEMA_POLITICA_SENHA = z
  .object({
    minimoCaracteres: z.number().int().min(6).max(128),
    exigeEspecial: z.boolean(),
    exigeMinuscula: z.boolean(),
    exigeMaiuscula: z.boolean(),
    trocaDias: z.number().int().min(0).max(3650),
    reusoDias: z.number().int().min(0).max(3650),
    recusaNome: z.boolean(),
    recusaNascimento: z.boolean(),
    recusaComuns: z.boolean(),
    senhasProibidas: z.array(z.string().max(128)).max(1000),
    vigenteDesde: z.iso.datetime(),
    motivo: MOTIVO,
  })
  .strict();
const ESQUEMA_CANCELAR_POLITICA = z.object({ versao: z.number().int().positive(), motivo: MOTIVO }).strict();
const ESQUEMA_LIMITE_SESSAO = z
  .object({ perfil: z.string().trim().min(1).max(60), limite: z.number().int().nullable(), motivo: MOTIVO })
  .strict();
const ESQUEMA_EXCECAO_DORMENCIA = z
  .object({ login: esquemaLogin, ate: z.string().max(10).nullable(), retirar: z.boolean(), motivo: z.string().max(500) })
  .strict();
const ESQUEMA_CONFERENCIA_CONSELHO = z
  .object({
    login: esquemaLogin,
    registro: z.number().int().positive(),
    situacao: z.string().max(20),
    conferidoEm: z.string().max(10),
    fonte: z.string().max(20),
    observacao: z.string().max(500),
    hoje: DIA,
  })
  .strict();
const ESQUEMA_PERFIL_CARGO = z
  .object({ cargo: z.string().max(200), perfil: z.string().trim().min(1).max(60).nullable(), motivo: MOTIVO })
  .strict();
const ESQUEMA_RESOLUCAO_RH = z
  .object({
    tipo: z.enum(['criar-acesso', 'revisar-acesso', 'suspender-acesso']),
    vinculo: z.number().int().positive(),
    ref: z.string().trim().min(1).max(80),
    situacao: z.enum(['feita', 'dispensada']),
    login: esquemaLogin.nullable(),
    motivo: z.string().max(500),
  })
  .strict();

const SQL_POLITICA_SENHA = `SELECT v.id, v.numero_versao, v.tamanho_minimo, v.exige_maiuscula, v.exige_minuscula, v.exige_especial,
       v.validade_dias, v.reuso_dias, v.recusa_nome, v.recusa_nascimento, v.recusa_comuns, v.senhas_proibidas,
       v.vigente_desde, v.motivo, v.situacao, v.cancelada_em, v.motivo_cancelamento, v.criado_em,
       c.login AS criado_por, x.login AS cancelada_por
  FROM politica_senha_versao v LEFT JOIN usuario c ON c.id = v.criado_por
  LEFT JOIN usuario x ON x.id = v.cancelada_por_usuario_id`;

function listaJson(v: unknown): string[] {
  if (v === null || v === undefined || v === '') return [];
  try {
    const l: unknown = typeof v === 'string' ? JSON.parse(v) : v;
    return Array.isArray(l) ? l.map(String) : [];
  } catch {
    return [];
  }
}

function politicaSenhaDaLinha(x: Linha): VersaoPoliticaSenhaLida {
  const inteiro = (v: unknown) => (v === null || v === undefined ? 0 : num(v));
  return {
    id: String(x['id']),
    versao: num(x['numero_versao']),
    minimoCaracteres: num(x['tamanho_minimo']),
    exigeEspecial: bool(x['exige_especial']),
    exigeMinuscula: bool(x['exige_minuscula']),
    exigeMaiuscula: bool(x['exige_maiuscula']),
    trocaDias: inteiro(x['validade_dias']),
    reusoDias: inteiro(x['reuso_dias']),
    recusaNome: bool(x['recusa_nome']),
    recusaNascimento: bool(x['recusa_nascimento']),
    recusaComuns: bool(x['recusa_comuns']),
    senhasProibidas: listaJson(x['senhas_proibidas']),
    vigenteDesde: data(x['vigente_desde']),
    motivo: txt(x['motivo']),
    criadoPor: txt(x['criado_por']),
    criadoEm: data(x['criado_em']),
    situacao: txt(x['situacao']) === 'cancelada' ? 'cancelada' : 'publicada',
    canceladaEm: data(x['cancelada_em']),
    canceladaPor: txtOuNull(x['cancelada_por']),
    motivoCancelamento: txtOuNull(x['motivo_cancelamento']),
  };
}

/** As inscrições no conselho do profissional que a conta representa (vigente), com vínculo no estabelecimento. */
const SQL_REGISTROS_CONSELHO = `SELECT ic.id, u.id AS usuario_id, cc.sigla, ic.numero_inscricao, uf.sigla AS uf, oc.descricao AS ocupacao
  FROM usuario u
  JOIN usuario_profissional up ON up.usuario_id = u.id AND up.excluido_em IS NULL
   AND up.vigencia_inicio <= CURDATE() AND (up.vigencia_fim IS NULL OR up.vigencia_fim >= CURDATE())
  JOIN inscricao_conselho ic ON ic.profissional_id = up.profissional_id AND ic.excluido_em IS NULL
  JOIN conselho_classe cc ON cc.id = ic.conselho_classe_id
  LEFT JOIN unidade_federativa uf ON uf.id = ic.unidade_federativa_id
  LEFT JOIN ocupacao_cbo oc ON oc.id = ic.ocupacao_cbo_id
 WHERE u.login = ? AND u.excluido_em IS NULL AND ${VINCULO}
 ORDER BY ic.principal DESC, ic.id`;

function registroConselhoDaLinha(x: Linha): RegistroConselhoUsuario {
  return {
    registro: num(x['id']),
    sigla: txtOuNull(x['sigla']),
    numero: txtOuNull(x['numero_inscricao']),
    uf: txtOuNull(x['uf']),
    ocupacao: txtOuNull(x['ocupacao']),
  };
}

/** A referência da tarefa do RH no banco: o fato que a gerou (vínculo, mudança de cargo, férias ou afastamento). */
function referenciaRh(tipo: string, ref: string, vinculo: number): { entidade: string; id: number } | null {
  if (tipo === 'criar-acesso') return ref === REF_CRIAR_ACESSO ? { entidade: 'vinculo_trabalho', id: vinculo } : null;
  if (tipo === 'revisar-acesso') return /^\d{1,18}$/.test(ref) ? { entidade: 'historico_cargo', id: Number(ref) } : null;
  const m = /^(ferias|afastamento):(\d{1,18})$/.exec(ref);
  if (tipo !== 'suspender-acesso' || !m) return null;
  return { entidade: m[1] === 'ferias' ? 'programacao_ferias' : 'afastamento', id: Number(m[2]) };
}

function refDaResolucao(entidade: string, id: number): string {
  if (entidade === 'vinculo_trabalho') return REF_CRIAR_ACESSO;
  if (entidade === 'historico_cargo') return String(id);
  return `${entidade === 'programacao_ferias' ? 'ferias' : 'afastamento'}:${id}`;
}

/** Vínculos ativos ou desligados nos últimos 90 dias (as tarefas de acesso olham para eles). */
const VINCULO_RH_RECENTE = `v.estabelecimento_id = ? AND v.excluido_em IS NULL
  AND (v.data_desligamento IS NULL OR v.data_desligamento >= CURDATE() - INTERVAL 90 DAY)`;

/** O retrato do RH para as tarefas de acesso, lido do modelo próprio (vale na leitura e dentro da gravação). */
async function lerDadosRh(l: Leitor, est: number): Promise<DadosRhLidos> {
  const resol = await l.consultar(
    `SELECT r.id, r.tipo, r.referencia_entidade, r.referencia_id, r.decisao, r.motivo, r.resolvido_em, r.usuario_id,
            u.login, x.login AS resolvido_por,
            CASE r.referencia_entidade
              WHEN 'vinculo_trabalho' THEN r.referencia_id
              WHEN 'historico_cargo' THEN (SELECT h.vinculo_trabalho_id FROM historico_cargo h WHERE h.id = r.referencia_id)
              WHEN 'afastamento' THEN (SELECT a.vinculo_trabalho_id FROM afastamento a WHERE a.id = r.referencia_id)
              WHEN 'programacao_ferias' THEN (SELECT v.id FROM programacao_ferias pf JOIN vinculo_trabalho v
                  ON v.colaborador_id = pf.colaborador_id AND v.estabelecimento_id = pf.estabelecimento_id
                WHERE pf.id = r.referencia_id ORDER BY v.data_desligamento IS NULL DESC, v.id DESC LIMIT 1)
            END AS vinculo
       FROM resolucao_tarefa_rh r LEFT JOIN usuario u ON u.id = r.usuario_id
       LEFT JOIN usuario x ON x.id = r.resolvido_por_usuario_id
      WHERE r.estabelecimento_id = ? AND r.excluido_em IS NULL ORDER BY r.id DESC`,
    [est],
    { teto: TETO * 4 },
  );
  const resolucoes: ResolucaoRhSghLida[] = resol.map((r) => ({
    id: String(r['id']),
    tipo: txt(r['tipo']).replace(/_/g, '-') as TipoTarefaRhSgh,
    vinculo: num(r['vinculo']),
    ref: refDaResolucao(txt(r['referencia_entidade']), num(r['referencia_id'])),
    situacao: txt(r['decisao']) === 'atendida' ? 'feita' : 'dispensada',
    login: txtOuNull(r['login']),
    motivo: txt(r['motivo']),
    resolvidoPor: txt(r['resolvido_por']),
    resolvidoEm: data(r['resolvido_em']),
  }));
  // A conta criada pela tarefa 'criar-acesso' feita é o usuário do vínculo enquanto o cadastro do colaborador não a liga.
  const criadas = new Map<number, { usuario: number; login: string }>();
  for (const r of resol)
    if (txt(r['tipo']) === 'criar_acesso' && txt(r['decisao']) === 'atendida' && r['usuario_id'] !== null && r['usuario_id'] !== undefined)
      criadas.set(num(r['vinculo']), { usuario: num(r['usuario_id']), login: txt(r['login']) });
  const vinculos: VinculoRhLido[] = (
    await l.consultar(
      `SELECT v.id, c.nome, cg.nome AS cargo, f.nome AS funcao, s.nome AS setor,
              DATE_FORMAT(v.data_admissao, '%Y-%m-%d') AS admissao, DATE_FORMAT(v.data_desligamento, '%Y-%m-%d') AS desligamento,
              u.id AS usuario_id, u.login
         FROM vinculo_trabalho v JOIN colaborador c ON c.id = v.colaborador_id JOIN cargo cg ON cg.id = v.cargo_id
         LEFT JOIN funcao f ON f.id = v.funcao_id LEFT JOIN setor_funcional s ON s.id = v.setor_funcional_id
         LEFT JOIN usuario u ON u.id = c.usuario_id AND u.excluido_em IS NULL
        WHERE ${VINCULO_RH_RECENTE} ORDER BY v.id`,
      [est],
      { teto: TETO * 4 },
    )
  ).map((v) => {
    const proprio = v['usuario_id'] === null || v['usuario_id'] === undefined ? null : { usuario: num(v['usuario_id']), login: txt(v['login']) };
    const conta = proprio ?? criadas.get(num(v['id'])) ?? null;
    return {
      id: num(v['id']),
      nome: txt(v['nome']),
      cargo: txt(v['cargo']),
      funcao: txtOuNull(v['funcao']),
      setor: txtOuNull(v['setor']),
      admissao: txt(v['admissao']),
      desligamento: txtOuNull(v['desligamento']),
      usuario: conta?.usuario ?? null,
      login: conta?.login ?? null,
    };
  });
  // Mudanças de cargo ou função: cada linha do histórico comparada com a anterior do mesmo vínculo.
  const historico = await l.consultar(
    `SELECT h.id, h.vinculo_trabalho_id, h.cargo_id, cg.nome AS cargo, h.funcao_id, f.nome AS funcao,
            DATE_FORMAT(h.data_inicio, '%Y-%m-%d') AS inicio
       FROM historico_cargo h JOIN vinculo_trabalho v ON v.id = h.vinculo_trabalho_id AND ${VINCULO_RH_RECENTE}
       JOIN cargo cg ON cg.id = h.cargo_id LEFT JOIN funcao f ON f.id = h.funcao_id
      WHERE h.operacao <> 'exclusao' ORDER BY h.vinculo_trabalho_id, h.data_inicio, h.id`,
    [est],
    { teto: TETO * 4 },
  );
  const revisado = new Map<number, number>();
  for (const r of resolucoes)
    if (r.tipo === 'revisar-acesso') revisado.set(r.vinculo, Math.max(revisado.get(r.vinculo) ?? 0, Number(r.ref)));
  const mudancas: MudancaRhLida[] = [];
  for (let i = 1; i < historico.length; i++) {
    const a = historico[i - 1] as Linha;
    const h = historico[i] as Linha;
    const vinculo = num(h['vinculo_trabalho_id']);
    if (num(a['vinculo_trabalho_id']) !== vinculo || num(h['id']) <= (revisado.get(vinculo) ?? 0)) continue;
    const base = { id: num(h['id']), vinculo, vigencia: txt(h['inicio']) };
    if (num(a['cargo_id']) !== num(h['cargo_id'])) mudancas.push({ ...base, tipo: 'cargo', antes: txt(a['cargo']), depois: txt(h['cargo']) });
    else if (txt(a['funcao_id']) !== txt(h['funcao_id']))
      mudancas.push({ ...base, tipo: 'funcao', antes: txtOuNull(a['funcao']), depois: txtOuNull(h['funcao']) });
  }
  mudancas.sort((a, b) => a.id - b.id);
  const afastamentos: AfastamentoRhLido[] = [
    ...(
      await l.consultar(
        `SELECT pf.id, v.id AS vinculo, DATE_FORMAT(pf.inicio_gozo, '%Y-%m-%d') AS inicio, DATE_FORMAT(pf.fim_gozo, '%Y-%m-%d') AS fim
           FROM programacao_ferias pf JOIN vinculo_trabalho v ON v.colaborador_id = pf.colaborador_id
            AND v.estabelecimento_id = pf.estabelecimento_id AND v.excluido_em IS NULL AND v.data_desligamento IS NULL
          WHERE pf.estabelecimento_id = ? AND pf.excluido_em IS NULL AND pf.situacao <> 'cancelada' AND pf.fim_gozo >= CURDATE()
          ORDER BY pf.id`,
        [est],
        { teto: TETO * 4 },
      )
    ).map((x) => ({ vinculo: num(x['vinculo']), ref: `ferias:${num(x['id'])}`, natureza: 'ferias' as const, inicio: txt(x['inicio']), fim: txtOuNull(x['fim']) })),
    ...(
      await l.consultar(
        `SELECT a.id, a.vinculo_trabalho_id, DATE_FORMAT(a.data_inicio, '%Y-%m-%d') AS inicio, DATE_FORMAT(a.data_fim, '%Y-%m-%d') AS fim
           FROM afastamento a
          WHERE a.estabelecimento_id = ? AND a.excluido_em IS NULL AND a.situacao IN ('previsto', 'em_andamento')
            AND (a.data_fim IS NULL OR a.data_fim >= CURDATE())
          ORDER BY a.id`,
        [est],
        { teto: TETO * 4 },
      )
    ).map((x) => ({ vinculo: num(x['vinculo_trabalho_id']), ref: `afastamento:${num(x['id'])}`, natureza: 'afastamento' as const, inicio: txt(x['inicio']), fim: txtOuNull(x['fim']) })),
  ];
  const perfisCargo: PerfilCargoRhLido[] = (
    await l.consultar(
      `SELECT x.id, cg.nome AS cargo, pa.codigo AS perfil, x.motivo, x.criado_em, u.login AS criado_por
         FROM perfil_cargo_rh x JOIN cargo cg ON cg.id = x.cargo_id
         LEFT JOIN perfil_acesso pa ON pa.id = x.perfil_acesso_id LEFT JOIN usuario u ON u.id = x.criado_por
        WHERE x.estabelecimento_id = ? AND x.excluido_em IS NULL ORDER BY x.id DESC`,
      [est],
      { teto: TETO },
    )
  ).map((x) => {
    const perfil = txtOuNull(x['perfil']);
    return {
      id: String(x['id']),
      cargo: chaveCargoRh(txt(x['cargo'])),
      perfil,
      situacao: perfil === null ? ('retirado' as const) : ('vigente' as const),
      motivo: txt(x['motivo']),
      criadoPor: txt(x['criado_por']),
      criadoEm: data(x['criado_em']),
    };
  });
  return { vinculos, mudancas, afastamentos, resolucoes, perfisCargo };
}

class FonteGestaoPropria implements FonteGestao {
  readonly destino = 'banco' as const;
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: NucleoGestao,
    private readonly cliente: string,
    executor?: Executor,
  ) {
    this.executor = executor ?? nucleo.criarExecutor();
  }

  private async estabelecimento(l: Leitor, hospital: string): Promise<number> {
    const r = await l.uma('SELECT id FROM estabelecimento WHERE codigo = ? AND excluido_em IS NULL', [hospital]);
    if (!r) throw recusa('sem-estabelecimento', 'O estabelecimento da sessão não existe neste banco.');
    return num(r['id']);
  }

  private ler<T>(hospital: string, fn: (l: Leitor, est: number) => Promise<T>): Promise<T> {
    return this.nucleo.lerSomente({ cliente: this.cliente, correlacao: 'acesso-gestao' }, async (l) =>
      fn(l, await this.estabelecimento(l, hospital)),
    );
  }

  /**
   * Uma gravação pelo Executor: estabelecimento e operador resolvidos antes. A ENTRADA real da operação (login, papel,
   * concessão) passa pelo esquema e pelo hash da idempotência do núcleo: a mesma chave com outra entrada é recusada
   * (idempotencia-divergente). A função grava na transação e devolve o resultado (plano, guardado na idempotência) e o
   * estado anterior lido sob trava, que vai à trilha (dados.antes). Toda recusa LANÇA erro: a transação é desfeita,
   * sem trilha nem registro de idempotência.
   */
  private async gravar<E, R extends ResultadoOperacao & { readonly id: number }>(
    def: {
      readonly nome: string;
      readonly tabelas: readonly string[];
      readonly esquema: ZodType<E>;
      readonly alvo: string;
      readonly motivo?: (e: E) => string | null;
      readonly dados?: (e: E) => Readonly<Record<string, unknown>>;
    },
    hospital: string,
    quem: { readonly usuario: string; readonly correlacao: string; readonly chave?: string; readonly reautenticadoEm?: number },
    entrada: unknown,
    fn: (tx: TxOperacao, e: E, est: number, operador: number) => Promise<{ resultado: R; antes?: Readonly<Record<string, unknown>> }>,
  ): Promise<R> {
    const [est, operador] = await this.nucleo.lerSomente(
      { cliente: this.cliente, correlacao: 'acesso-gestao' },
      async (l) => {
        const e = await this.estabelecimento(l, hospital);
        const u = await l.uma('SELECT id FROM usuario WHERE login = ? AND excluido_em IS NULL', [quem.usuario]);
        if (!u) throw recusa('operador-desconhecido', 'O usuário da sessão não existe neste banco.');
        return [e, num(u['id'])] as const;
      },
    );
    let antes: Readonly<Record<string, unknown>> | undefined;
    const op = definirOperacao<E, R>({
      nome: def.nome,
      tabelas: def.tabelas,
      entrada: def.esquema,
      async gravar(tx, e) {
        const saida = await fn(tx, e, est, operador);
        antes = saida.antes;
        return saida.resultado;
      },
      alvo: (_e, r) => ({ tabela: def.alvo, id: r.id }),
      trilha: (e) => ({
        motivo: def.motivo?.(e) ?? null,
        dados: { ...(def.dados?.(e) ?? {}), ...(antes ? { antes } : {}) },
      }),
    });
    const ctx: ContextoOperacao = {
      cliente: this.cliente,
      estabelecimento: est,
      usuario: operador,
      correlacao: quem.correlacao.slice(0, 64) || 'acesso-gestao',
      chaveIdempotencia: quem.chave ?? `acesso-gestao:${randomUUID()}`,
      ...(quem.reautenticadoEm !== undefined ? { reautenticadoEm: quem.reautenticadoEm } : {}),
    };
    // Primeira execução ou repetição da mesma chave com a mesma entrada: o mesmo resultado guardado.
    return (await this.executor.executar(op, this.cliente, entrada, ctx)).resultado;
  }

  /** A conta pelo login, com vínculo vigente no estabelecimento, travada para a gravação. */
  private async contaTravada(tx: TxOperacao, est: number, login: string): Promise<Linha> {
    const [u] = await tx.consultarParaAtualizar(
      `SELECT u.id, u.login, u.situacao, u.versao FROM usuario u WHERE u.login = ? AND u.excluido_em IS NULL AND ${VINCULO}`,
      [login, est],
      { teto: 1 },
    );
    if (!u) throw new ErroOperacao(404, 'nao-encontrado', 'Conta não encontrada', 'A conta não tem vínculo vigente com este estabelecimento.');
    return u;
  }

  // ── Usuários e papéis ──────────────────────────────────────────────────────────────────────

  buscarUsuarios(_rede: string, hospital: string, termo: string) {
    const t = `%${termo.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    return this.ler(hospital, async (l, est) =>
      (
        await l.consultar(
          `SELECT u.id, u.login, u.nome, u.situacao FROM usuario u
            WHERE u.excluido_em IS NULL AND (u.login LIKE ? OR u.nome LIKE ?) AND ${VINCULO}
            ORDER BY u.login LIMIT 50`,
          [t, t, est],
          { teto: 50 },
        )
      ).map(usuarioDaLinha),
    );
  }

  usuario(_rede: string, hospital: string, login: string) {
    return this.ler(hospital, async (l, est) => {
      const x = await l.uma(
        `SELECT u.id, u.login, u.nome, u.situacao FROM usuario u WHERE u.login = ? AND u.excluido_em IS NULL AND ${VINCULO}`,
        [login, est],
      );
      return x ? usuarioDaLinha(x) : null;
    });
  }

  papeisDoUsuario(_rede: string, hospital: string, login: string) {
    // Rede inteira: o papel de segurança é da conta (sem estabelecimento); a conta é conferida pelo vínculo.
    return this.ler(hospital, async (l, est) => {
      const ls = await l.consultar(
        `SELECT p.codigo, p.nome, MAX(CASE WHEN ${PAPEL_VIGENTE} THEN 1 ELSE 0 END) AS ativo
           FROM usuario u JOIN usuario_papel_seguranca ups ON ups.usuario_id = u.id
           JOIN papel_seguranca p ON p.id = ups.papel_seguranca_id AND p.excluido_em IS NULL
          WHERE u.login = ? AND u.excluido_em IS NULL AND ${VINCULO}
          GROUP BY p.codigo, p.nome`,
        [login, est],
        { teto: 100 },
      );
      return ls
        .filter((x) => PAPEL_DO_CODIGO.has(txt(x['codigo'])))
        .map((x) => ({ papel: PAPEL_DO_CODIGO.get(txt(x['codigo'])) as number, nome: txt(x['nome']), ativo: bool(x['ativo']) }))
        .sort((a, b) => a.papel - b.papel);
    });
  }

  papeis(_rede: string, hospital: string) {
    // Só os cinco papéis da certificação; as ações de cada papel vêm de papel_seguranca_acao (não há "opções").
    return this.ler(hospital, async (l) =>
      (await l.consultar('SELECT codigo, nome FROM papel_seguranca WHERE ativo AND excluido_em IS NULL ORDER BY codigo', [], { teto: 100 }))
        .filter((x) => PAPEL_DO_CODIGO.has(txt(x['codigo'])))
        .map((x) => {
          const papel = PAPEL_DO_CODIGO.get(txt(x['codigo'])) as number;
          return { papel, nome: txt(x['nome']) || (NOMES_PAPEL[papel] ?? ''), opcoes: [] as number[] };
        })
        .sort((a, b) => a.papel - b.papel),
    );
  }

  // ── Perfis concedidos ──────────────────────────────────────────────────────────────────────

  historicoPerfis(_rede: string, hospital: string, login: string): Promise<PerfilConcedidoLido[]> {
    return this.ler(hospital, async (l, est) =>
      (
        await l.consultar(
          `SELECT up.id, up.versao, pa.codigo, up.vigencia_inicio, up.vigencia_fim, up.motivo, up.excluido_em, up.revogado_motivo,
                  c.login AS concedido_por, x.login AS revogado_por
             FROM usuario u JOIN usuario_perfil up ON up.usuario_id = u.id
             JOIN perfil_acesso pa ON pa.id = up.perfil_acesso_id
             LEFT JOIN usuario c ON c.id = up.criado_por
             LEFT JOIN usuario x ON x.id = up.excluido_por
            WHERE u.login = ? AND u.excluido_em IS NULL AND up.estabelecimento_id = ?
            ORDER BY up.id DESC`,
          [login, est],
          { teto: TETO },
        )
      ).map((x) => ({
        id: String(x['id']),
        perfil: txt(x['codigo']),
        inicio: data(x['vigencia_inicio']) as Date,
        fim: data(x['vigencia_fim']),
        motivo: txtOuNull(x['motivo']),
        concedidoPor: txt(x['concedido_por']),
        revogadoEm: data(x['excluido_em']),
        revogadoPor: txtOuNull(x['revogado_por']),
        revogadoMotivo: txtOuNull(x['revogado_motivo']),
        versao: num(x['versao']),
      })),
    );
  }

  concederPerfil(_rede: string, hospital: string, c: ConcessaoPerfilNova, t: TrilhaGestao) {
    const entrada = {
      login: c.login,
      perfil: c.perfil,
      inicio: c.inicio ? dia(c.inicio) : null,
      fim: c.fim ? dia(c.fim) : null,
      motivo: c.motivo,
      areaAprovou: c.areaAprovou,
    };
    return this.gravar(
      { nome: 'acesso.perfil.conceder', tabelas: ['usuario_perfil'], esquema: ESQUEMA_CONCESSAO, alvo: 'usuario_perfil',
        motivo: (e) => e.motivo, dados: (e) => ({ perfil: e.perfil, areaAprovou: e.areaAprovou, inicio: e.inicio, fim: e.fim }) },
      hospital, t, entrada,
      async (tx, e, est) => {
        const u = await this.contaTravada(tx, est, e.login);
        const p = await tx.uma(
          `SELECT id FROM perfil_acesso WHERE codigo = ? AND (estabelecimento_id = ? OR estabelecimento_id IS NULL)
             AND ativo AND excluido_em IS NULL ORDER BY estabelecimento_id IS NULL LIMIT 1`,
          [e.perfil, est],
        );
        if (!p) throw recusa('perfil-inexistente', 'O perfil não está cadastrado (ou está inativo) neste estabelecimento.');
        const inicio = e.inicio ?? dia(new Date());
        // As concessões do mesmo perfil, pessoa e estabelecimento, travadas: nenhuma concessão vigente sobreposta.
        const linhas = await tx.consultarParaAtualizar(
          `SELECT id, versao, vigencia_inicio, vigencia_fim, motivo, excluido_em IS NOT NULL AS revogada,
                  (excluido_em IS NULL AND (vigencia_fim IS NULL OR vigencia_fim >= ?) AND (? IS NULL OR vigencia_inicio <= ?)) AS sobrepoe,
                  (vigencia_inicio = ?) AS mesmo_inicio
             FROM usuario_perfil WHERE usuario_id = ? AND perfil_acesso_id = ? AND estabelecimento_id = ? ORDER BY id DESC`,
          [inicio, e.fim, e.fim, inicio, num(u['id']), num(p['id']), est],
          { teto: TETO },
        );
        if (linhas.some((x) => bool(x['sobrepoe'])))
          throw recusa('perfil-ja-concedido', 'A pessoa já tem este perfil em vigor (ou agendado) no período: altere a concessão existente.');
        // Revogada com o mesmo início (a chave única cobre as revogadas): reabre a mesma concessão; o anterior vai à trilha.
        const revogada = linhas.find((x) => bool(x['mesmo_inicio']) && bool(x['revogada']));
        if (revogada) {
          await tx.alterar('usuario_perfil', num(revogada['id']), num(revogada['versao']), {
            vigencia_fim: e.fim,
            motivo: e.motivo.slice(0, 500),
            excluido_em: null,
            excluido_por: null,
            revogado_motivo: null,
          });
          return { resultado: { id: num(revogada['id']) }, antes: estadoConcessao(revogada, true) };
        }
        const id = await tx.incluir('usuario_perfil', {
          usuario_id: num(u['id']),
          perfil_acesso_id: num(p['id']),
          estabelecimento_id: est,
          vigencia_inicio: inicio,
          vigencia_fim: e.fim,
          provisorio: false,
          motivo: e.motivo.slice(0, 500),
        });
        return { resultado: { id } };
      },
    ).then((r) => ({ id: String(r.id) }));
  }

  /** A concessão não revogada do estabelecimento, travada; outra (ou revogada): 404 e nada gravado. */
  private async concessaoTravada(tx: TxOperacao, est: number, id: number): Promise<Linha> {
    const [x] = await tx.consultarParaAtualizar(
      `SELECT up.id, up.versao, up.vigencia_inicio, up.vigencia_fim, up.motivo, u.login, pa.codigo FROM usuario_perfil up
         JOIN usuario u ON u.id = up.usuario_id JOIN perfil_acesso pa ON pa.id = up.perfil_acesso_id
        WHERE up.id = ? AND up.estabelecimento_id = ? AND up.excluido_em IS NULL`,
      [id, est],
      { teto: 1 },
    );
    if (!x)
      throw new ErroOperacao(404, 'nao-encontrado', 'Concessão não encontrada', 'A concessão não existe neste estabelecimento ou já foi revogada.');
    return x;
  }

  revogarPerfil(_rede: string, hospital: string, id: string, _por: string, t: TrilhaGestao, motivo: string) {
    return this.gravar(
      { nome: 'acesso.perfil.revogar', tabelas: ['usuario_perfil'], esquema: ESQUEMA_REVOGACAO, alvo: 'usuario_perfil', motivo: (e) => e.motivo },
      hospital, t, { id: Number(id), motivo },
      async (tx, e, est, operador) => {
        const x = await this.concessaoTravada(tx, est, e.id);
        const inicio = data(x['vigencia_inicio']) as Date;
        const fim = new Date(Math.max(Date.now(), inicio.getTime()));
        await tx.alterar('usuario_perfil', num(x['id']), num(x['versao']), {
          vigencia_fim: dia(fim),
          excluido_em: new Date(),
          excluido_por: operador,
          revogado_motivo: e.motivo.slice(0, 500),
        });
        return { resultado: { id: num(x['id']), login: txt(x['login']), perfil: txt(x['codigo']) }, antes: estadoConcessao(x, false) };
      },
    ).then((r) => ({ login: r.login, perfil: r.perfil }));
  }

  alterarPerfil(_rede: string, hospital: string, a: Parameters<FonteGestao['alterarPerfil']>[2], t: TrilhaGestao) {
    const entrada = {
      id: Number(a.id),
      inicio: dia(a.inicio),
      fim: a.fim ? dia(a.fim) : null,
      motivo: a.motivo,
      justificativa: a.justificativa,
      por: a.por,
      ...(a.versao !== undefined ? { versao: a.versao } : {}),
    };
    return this.gravar(
      { nome: 'acesso.perfil.alterar', tabelas: ['usuario_perfil', 'usuario_perfil_alteracao'], esquema: ESQUEMA_ALTERACAO, alvo: 'usuario_perfil',
        motivo: (e) => e.justificativa, dados: (e) => ({ depois: { inicio: e.inicio, fim: e.fim, motivo: e.motivo } }) },
      hospital, t, entrada,
      async (tx, e, est) => {
        const x = await this.concessaoTravada(tx, est, e.id);
        if (txt(x['login']) === e.por) throw recusa('a-si-mesmo', 'Ninguém altera o próprio perfil (segregação de funções).');
        // A versão que a tela leu (quando informada): outra, 409 conflito-versao e nada gravado.
        if (e.versao !== undefined && num(x['versao']) !== e.versao) throw erroConflitoVersao(['versao']);
        const versao = await tx.alterar('usuario_perfil', num(x['id']), num(x['versao']), {
          vigencia_inicio: e.inicio,
          vigencia_fim: e.fim,
          motivo: e.motivo.slice(0, 500),
        });
        // O antes e o depois ficam na alteração (só inclusão) e na trilha (dados.antes).
        await tx.incluir('usuario_perfil_alteracao', {
          usuario_perfil_id: num(x['id']),
          vigencia_inicio_antes: dia(data(x['vigencia_inicio']) as Date),
          vigencia_fim_antes: data(x['vigencia_fim']) ? dia(data(x['vigencia_fim']) as Date) : null,
          motivo_antes: txtOuNull(x['motivo']),
          vigencia_inicio: e.inicio,
          vigencia_fim: e.fim,
          motivo: e.motivo.slice(0, 500),
          justificativa: e.justificativa.slice(0, 500),
        });
        return {
          resultado: { id: num(x['id']), login: txt(x['login']), perfil: txt(x['codigo']), alteracao: `${num(x['id'])}.${versao}` },
          antes: estadoConcessao(x, false),
        };
      },
    ).then((r) => ({ situacao: 'ok' as const, login: r.login, perfil: r.perfil, alteracao: r.alteracao }));
  }

  gestoresAcesso(_rede: string, hospital: string) {
    return this.ler(hospital, async (l, est) => {
      const ls = await l.consultar(
        `SELECT u.login,
                (SELECT COUNT(*) FROM usuario_papel_seguranca ups JOIN papel_seguranca p ON p.id = ups.papel_seguranca_id AND p.excluido_em IS NULL
                  WHERE ups.usuario_id = u.id AND p.codigo = ? AND ${PAPEL_VIGENTE}) AS papel_gestor,
                (SELECT GROUP_CONCAT(up.id ORDER BY up.id) FROM usuario_perfil up JOIN perfil_acesso pa ON pa.id = up.perfil_acesso_id
                  WHERE up.usuario_id = u.id AND up.estabelecimento_id = ? AND pa.codigo = ? AND ${PERFIL_VIGENTE}) AS concessoes
           FROM usuario u
          WHERE u.excluido_em IS NULL AND u.situacao IN ('ativo','dormente') AND ${VINCULO}
          ORDER BY u.login`,
        [CODIGOS_PAPEL[0], est, PERFIL_GESTOR_ACESSOS, est],
        { teto: TETO },
      );
      return ls
        .map((x) => ({
          login: txt(x['login']),
          grupo: null,
          papelGestor: num(x['papel_gestor']) > 0,
          concessoes: txt(x['concessoes']).split(',').filter((s) => s !== ''),
        }))
        .filter((g) => g.papelGestor || g.concessoes.length > 0);
    });
  }

  // ── Contas para as rotinas (dormência e recertificação) ─────────────────────────────────────

  contasDormencia(_rede: string, hospital: string) {
    return this.ler(hospital, async (l, est) =>
      (
        await l.consultar(
          `SELECT u.login, u.ultimo_acesso_em FROM usuario u
            WHERE u.excluido_em IS NULL AND u.situacao = 'ativo' AND u.tipo_conta = 'pessoa' AND ${VINCULO}
            ORDER BY u.login`,
          [est],
          { teto: TETO * 4 },
        )
      ).map((x) => ({
        login: txt(x['login']),
        grupo: null,
        ativo: true,
        bloqueado: false,
        ultimoAcesso: data(x['ultimo_acesso_em'])?.toISOString() ?? null,
      })),
    );
  }

  contasRecert(_rede: string, hospital: string) {
    return this.ler(hospital, async (l, est) =>
      (
        await l.consultar(
          `SELECT u.login,
                  (SELECT GROUP_CONCAT(DISTINCT pa.codigo ORDER BY pa.codigo) FROM usuario_perfil up
                     JOIN perfil_acesso pa ON pa.id = up.perfil_acesso_id
                    WHERE up.usuario_id = u.id AND up.estabelecimento_id = ? AND ${PERFIL_VIGENTE}) AS perfis
             FROM usuario u
            WHERE u.excluido_em IS NULL AND u.situacao = 'ativo' AND ${VINCULO}
            ORDER BY u.login`,
          [est, est],
          { teto: TETO * 4 },
        )
      ).map((x) => ({
        login: txt(x['login']),
        grupo: null,
        ativo: true,
        bloqueado: false,
        setores: [],
        perfis: txt(x['perfis']).split(',').filter((s) => s !== ''),
      })),
    );
  }

  // ── Operações da conta (bloqueio e papéis de segurança) ─────────────────────────────────────

  receita(nome: string): EstadoReceita {
    return ehOperacaoConta(nome)
      ? { estado: null, ligada: true, motivo: null }
      : { estado: null, ligada: false, motivo: SEM_GRUPOS };
  }

  async executar(nome: string, hospital: string, entrada: unknown, c: ContextoGestao): Promise<void> {
    if (!ehOperacaoConta(nome)) semGrupos();
    const op = nome as OperacaoConta;
    const quem = { usuario: c.usuario, correlacao: c.correlacao, chave: c.chaveIdempotencia, ...(c.reautenticadoEm !== undefined ? { reautenticadoEm: c.reautenticadoEm } : {}) };
    // A entrada real (login, papel) vai ao Executor: esquema do contrato e hash da idempotência.
    const esquema = OPERACOES_CONTA[op] as unknown as ZodType<{ login: string; papel?: number }>;
    if (op === 'acesso.bloquearUsuario') {
      await this.gravar({ nome: 'acesso.conta.bloquear', tabelas: ['usuario', 'usuario_situacao_historico'], esquema, alvo: 'usuario' }, hospital, quem, entrada, async (tx, e, est, operador) => {
        const u = await this.contaTravada(tx, est, e.login);
        const antes = txt(u['situacao']);
        if (antes === 'bloqueado') throw recusa('ja-bloqueado', 'A conta já está bloqueada.');
        if (antes === 'inativo') throw recusa('conta-inativa', 'A conta está desativada.');
        const agora = new Date();
        await tx.alterar('usuario', num(u['id']), num(u['versao']), { situacao: 'bloqueado', bloqueado_em: agora });
        await tx.incluir('usuario_situacao_historico', {
          usuario_id: num(u['id']),
          operacao: 'alteracao',
          situacao_anterior: antes,
          situacao_nova: 'bloqueado',
          evento: 'bloqueio',
          ocorrido_em: agora,
          responsavel_usuario_id: operador,
        });
        return { resultado: { id: num(u['id']) }, antes: { situacao: antes, versao: num(u['versao']) } };
      });
      return;
    }
    const acao = op === 'acesso.concederPapelUsuario' ? 'conceder' : op === 'acesso.revogarPapelUsuario' ? 'revogar' : 'reativar';
    await this.gravar({ nome: `acesso.papel.${acao}`, tabelas: ['usuario_papel_seguranca'], esquema, alvo: 'usuario_papel_seguranca', dados: (e) => ({ papel: e.papel ?? null }) }, hospital, quem, entrada, async (tx, e, est, operador) => {
      const codigo = CODIGOS_PAPEL[e.papel ?? -1];
      if (!codigo) throw new ErroOperacao(400, 'entrada-invalida', 'Dados inválidos', 'Papel desconhecido.');
      const u = await this.contaTravada(tx, est, e.login);
      const papel = await tx.uma('SELECT id FROM papel_seguranca WHERE codigo = ? AND ativo AND excluido_em IS NULL', [codigo]);
      if (!papel) throw recusa('papel-inexistente', 'O papel não está cadastrado neste banco.');
      const linhas = await tx.consultarParaAtualizar(
        `SELECT ups.id, ups.versao, ups.vigencia_inicio, ups.vigencia_fim, ups.excluido_em,
                (${PAPEL_VIGENTE}) AS vigente, (ups.vigencia_inicio = CURDATE()) AS de_hoje
           FROM usuario_papel_seguranca ups WHERE ups.usuario_id = ? AND ups.papel_seguranca_id = ? ORDER BY ups.id DESC`,
        [num(u['id']), num(papel['id'])],
        { teto: 100 },
      );
      const estado = (x: Linha) => ({
        vigenciaInicio: dia(data(x['vigencia_inicio']) as Date),
        vigenciaFim: data(x['vigencia_fim']) ? dia(data(x['vigencia_fim']) as Date) : null,
        retirado: x['excluido_em'] !== null && x['excluido_em'] !== undefined,
        versao: num(x['versao']),
      });
      const vigente = linhas.find((x) => bool(x['vigente']));
      if (op === 'acesso.revogarPapelUsuario') {
        if (!vigente) throw recusa('papel-nao-concedido', 'A conta não tem este papel em vigor.');
        const inicio = data(vigente['vigencia_inicio']) as Date;
        await tx.alterar('usuario_papel_seguranca', num(vigente['id']), num(vigente['versao']), {
          vigencia_fim: dia(new Date(Math.max(Date.now(), inicio.getTime()))),
          excluido_em: new Date(),
          excluido_por: operador,
        });
        return { resultado: { id: num(vigente['id']) }, antes: estado(vigente) };
      }
      if (vigente) throw recusa('papel-ja-concedido', 'A conta já tem este papel em vigor.');
      if (op === 'acesso.reativarPapelUsuario' && linhas.length === 0)
        throw recusa('papel-nao-concedido', 'A conta nunca teve este papel: conceda-o.');
      const deHoje = linhas.find((x) => bool(x['de_hoje']));
      if (deHoje) {
        await tx.alterar('usuario_papel_seguranca', num(deHoje['id']), num(deHoje['versao']), {
          vigencia_fim: null,
          excluido_em: null,
          excluido_por: null,
        });
        return { resultado: { id: num(deHoje['id']) }, antes: estado(deHoje) };
      }
      const id = await tx.incluir('usuario_papel_seguranca', {
        usuario_id: num(u['id']),
        papel_seguranca_id: num(papel['id']),
        vigencia_inicio: dia(new Date()),
      });
      return { resultado: { id } };
    });
  }

  // ── Sem grupos no modelo próprio ────────────────────────────────────────────────────────────

  mapa() {
    return Promise.resolve([]);
  }
  grupos() {
    return Promise.resolve([]);
  }
  candidatosMapa() {
    return Promise.resolve({ logins: [], limitado: false });
  }
  decisoesMapa() {
    return Promise.resolve([]);
  }
  decidirMapa(): Promise<never> {
    return Promise.reject(recusa('sem-grupos', SEM_GRUPOS));
  }
  versoesDescricaoGrupo(): Promise<never> {
    return Promise.reject(recusa('sem-grupos', SEM_GRUPOS));
  }
  descreverGrupo(): Promise<never> {
    return Promise.reject(recusa('sem-grupos', SEM_GRUPOS));
  }

  alteracoesPerfil(_rede: string, hospital: string, id: string): Promise<AlteracaoPerfilLida[]> {
    return this.ler(hospital, async (l, est) =>
      (
        await l.consultar(
          `SELECT a.id, a.vigencia_inicio_antes, a.vigencia_fim_antes, a.motivo_antes, a.vigencia_inicio, a.vigencia_fim,
                  a.motivo, a.justificativa, a.criado_em, u.login AS alterado_por
             FROM usuario_perfil_alteracao a JOIN usuario_perfil up ON up.id = a.usuario_perfil_id
             LEFT JOIN usuario u ON u.id = a.criado_por
            WHERE a.usuario_perfil_id = ? AND up.estabelecimento_id = ? AND a.excluido_em IS NULL
            ORDER BY a.id DESC`,
          [Number(id) || 0, est],
          { teto: TETO },
        )
      ).map((x) => ({
        id: String(x['id']),
        inicioAntes: data(x['vigencia_inicio_antes']) as Date,
        fimAntes: data(x['vigencia_fim_antes']),
        motivoAntes: txtOuNull(x['motivo_antes']),
        inicio: data(x['vigencia_inicio']) as Date,
        fim: data(x['vigencia_fim']),
        motivo: txt(x['motivo']),
        justificativa: txt(x['justificativa']),
        alteradoPor: txt(x['alterado_por']),
        alteradoEm: data(x['criado_em']) as Date,
      })),
    );
  }

  // ── Política de senha por versão (politica_senha_versao) ─────────────────────────────────────

  versoesPoliticaSenha(_rede: string, hospital: string): Promise<VersaoPoliticaSenhaLida[]> {
    return this.ler(hospital, async (l, est) =>
      (await l.consultar(`${SQL_POLITICA_SENHA} WHERE v.estabelecimento_id = ? AND v.excluido_em IS NULL ORDER BY v.numero_versao DESC`, [est], { teto: TETO })).map(
        politicaSenhaDaLinha,
      ),
    );
  }

  publicarPoliticaSenha(_rede: string, hospital: string, p: NovaPoliticaSenha, agora: Date, t: TrilhaGestao) {
    const entrada = {
      minimoCaracteres: p.minimoCaracteres,
      exigeEspecial: p.exigeEspecial,
      exigeMinuscula: p.exigeMinuscula,
      exigeMaiuscula: p.exigeMaiuscula,
      trocaDias: p.trocaDias,
      reusoDias: p.reusoDias,
      recusaNome: p.recusaNome,
      recusaNascimento: p.recusaNascimento,
      recusaComuns: p.recusaComuns,
      senhasProibidas: normalizarSenhasProibidas(p.senhasProibidas ?? []),
      vigenteDesde: p.vigenteDesde instanceof Date ? p.vigenteDesde.toISOString() : String(p.vigenteDesde),
      motivo: p.motivo,
    };
    return this.gravar(
      { nome: 'acesso.politica-senha.publicar', tabelas: ['politica_senha_versao'], esquema: ESQUEMA_POLITICA_SENHA, alvo: 'politica_senha_versao',
        motivo: (e) => e.motivo, dados: (e) => ({ vigenteDesde: e.vigenteDesde, proibidas: e.senhasProibidas.length }) },
      hospital, t, entrada,
      async (tx, e, est) => {
        if (!SESSAO_APLICA_POLITICA_VERSIONADA) aplicacaoPendente('A nova versão da política de senha');
        const desde = new Date(e.vigenteDesde);
        if (desde.getTime() < agora.getTime() - 60_000) throw recusa('vigencia-no-passado', 'A vigência começa agora ou no futuro.');
        const versoes = await tx.consultarParaAtualizar(
          `${SQL_POLITICA_SENHA} WHERE v.estabelecimento_id = ? AND v.excluido_em IS NULL ORDER BY v.numero_versao DESC`,
          [est],
          { teto: TETO },
        );
        const ultimaLinha = versoes.find((x) => txt(x['situacao']) === 'publicada');
        const ultima = ultimaLinha ? politicaSenhaDaLinha(ultimaLinha) : null;
        if (ultima?.vigenteDesde && desde.getTime() < ultima.vigenteDesde.getTime())
          throw recusa('vigencia-anterior', `A vigência não pode ser anterior à da versão ${ultima.versao}; cancele a versão agendada antes.`);
        // A diferença lê só as regras (campos da política e lista proibida); vigência e motivo não entram na comparação.
        const diferenca = diferencaPoliticaSenha(ultima, e);
        if (ultima && diferenca.length === 0) throw recusa('sem-mudanca', 'As regras informadas são iguais às da última versão publicada.');
        const versao = Math.max(0, ...versoes.map((x) => num(x['numero_versao']))) + 1;
        const id = await tx.incluir('politica_senha_versao', {
          estabelecimento_id: est,
          numero_versao: versao,
          tamanho_minimo: e.minimoCaracteres,
          exige_maiuscula: e.exigeMaiuscula,
          exige_minuscula: e.exigeMinuscula,
          exige_numero: true,
          exige_especial: e.exigeEspecial,
          // Troca sem prazo (0) é a ausência de validade.
          validade_dias: e.trocaDias > 0 ? e.trocaDias : null,
          reuso_dias: e.reusoDias,
          recusa_nome: e.recusaNome,
          recusa_nascimento: e.recusaNascimento,
          recusa_comuns: e.recusaComuns,
          senhas_proibidas: e.senhasProibidas.length ? JSON.stringify(e.senhasProibidas) : null,
          vigente_desde: desde,
          motivo: e.motivo.slice(0, 500),
          situacao: 'publicada',
        });
        return { resultado: { id, versao, anterior: ultima?.versao ?? null, diferenca: diferenca.join('\n') } };
      },
    ).then((r) => ({ id: String(r.id), versao: r.versao, anterior: r.anterior, diferenca: r.diferenca ? r.diferenca.split('\n') : [] }));
  }

  cancelarPoliticaSenha(_rede: string, hospital: string, c: { versao: number; motivo: string; por: string }, agora: Date, t: TrilhaGestao) {
    return this.gravar(
      { nome: 'acesso.politica-senha.cancelar', tabelas: ['politica_senha_versao'], esquema: ESQUEMA_CANCELAR_POLITICA, alvo: 'politica_senha_versao', motivo: (e) => e.motivo },
      hospital, t, { versao: c.versao, motivo: c.motivo },
      async (tx, e, est, operador) => {
        const [v] = await tx.consultarParaAtualizar(
          `SELECT id, versao, situacao, vigente_desde FROM politica_senha_versao
            WHERE estabelecimento_id = ? AND numero_versao = ? AND excluido_em IS NULL`,
          [est, e.versao],
          { teto: 1 },
        );
        if (!v) throw recusa('nao-encontrado', `A versão ${e.versao} da política não existe.`);
        if (txt(v['situacao']) !== 'publicada') throw recusa('ja-cancelada', `A versão ${e.versao} já está cancelada.`);
        const desde = data(v['vigente_desde']);
        if (!desde || desde.getTime() <= agora.getTime())
          throw recusa('ja-em-vigor', `A versão ${e.versao} já entrou em vigor e não se cancela: publique uma versão nova.`);
        await tx.alterar('politica_senha_versao', num(v['id']), num(v['versao']), {
          situacao: 'cancelada',
          cancelada_em: agora,
          cancelada_por_usuario_id: operador,
          motivo_cancelamento: e.motivo.slice(0, 500),
        });
        return { resultado: { id: num(v['id']), versao: e.versao }, antes: { situacao: 'publicada', vigenteDesde: desde.toISOString() } };
      },
    ).then((r) => ({ id: String(r.id), versao: r.versao }));
  }

  // ── Limite de sessões por perfil (limite_sessao_perfil) ──────────────────────────────────────

  historicoLimitesSessao(_rede: string, hospital: string): Promise<RegistroLimiteSessaoLido[]> {
    return this.ler(hospital, async (l, est) =>
      (
        await l.consultar(
          `SELECT x.id, pa.codigo, x.limite, x.motivo, x.criado_em, u.login AS criado_por
             FROM limite_sessao_perfil x LEFT JOIN perfil_acesso pa ON pa.id = x.perfil_acesso_id
             LEFT JOIN usuario u ON u.id = x.criado_por
            WHERE x.estabelecimento_id = ? AND x.excluido_em IS NULL ORDER BY x.id DESC`,
          [est],
          { teto: TETO },
        )
      ).map((x) => {
        const limite = x['limite'] === null || x['limite'] === undefined ? null : num(x['limite']);
        return {
          id: String(x['id']),
          // Sem perfil: o limite vale para todos os perfis ('*' na tela).
          perfil: txtOuNull(x['codigo']) ?? TODOS_PERFIS,
          limite,
          situacao: limite === null ? ('retirado' as const) : ('vigente' as const),
          motivo: txt(x['motivo']),
          criadoPor: txt(x['criado_por']),
          criadoEm: data(x['criado_em']),
        };
      }),
    );
  }

  definirLimiteSessao(_rede: string, hospital: string, p: NovoLimiteSessao, t: TrilhaGestao) {
    return this.gravar(
      { nome: 'acesso.limite-sessao.definir', tabelas: ['limite_sessao_perfil'], esquema: ESQUEMA_LIMITE_SESSAO, alvo: 'limite_sessao_perfil',
        motivo: (e) => e.motivo, dados: (e) => ({ perfil: e.perfil, limite: e.limite }) },
      hospital, t, { perfil: p.perfil, limite: p.limite, motivo: p.motivo },
      async (tx, e, est) => {
        if (!SESSAO_APLICA_LIMITE_POR_PERFIL) aplicacaoPendente('O limite de sessões por perfil');
        if (e.limite !== null && (e.limite < 1 || e.limite > 50)) throw recusa('limite-invalido', 'O limite vai de 1 a 50 sessões.');
        const perfilId = e.perfil === TODOS_PERFIS ? null : await this.perfilId(tx, est, e.perfil);
        const [ultima] = await tx.consultarParaAtualizar(
          `SELECT id, limite FROM limite_sessao_perfil
            WHERE estabelecimento_id = ? AND perfil_acesso_id <=> ? AND excluido_em IS NULL ORDER BY id DESC LIMIT 1`,
          [est, perfilId],
          { teto: 1 },
        );
        const anterior = ultima && ultima['limite'] !== null && ultima['limite'] !== undefined ? num(ultima['limite']) : null;
        if (e.limite === null && anterior === null) throw recusa('sem-limite', 'Este perfil não tem limite próprio para retirar.');
        if (e.limite !== null && anterior === e.limite) throw recusa('sem-mudanca', 'O limite informado é igual ao que já vale para este perfil.');
        const id = await tx.incluir('limite_sessao_perfil', {
          estabelecimento_id: est,
          perfil_acesso_id: perfilId,
          limite: e.limite,
          motivo: e.motivo.slice(0, 500),
          vigente_desde: new Date(),
        });
        return { resultado: { id, anterior, limite: e.limite }, antes: { limite: anterior } };
      },
    ).then((r) => ({ id: String(r.id), anterior: r.anterior, limite: r.limite }));
  }

  // ── Exceções das contas dormentes (excecao_conta_dormente) ───────────────────────────────────

  historicoExcecoesDormencia(_rede: string, hospital: string): Promise<ExcecaoDormenciaLida[]> {
    return this.ler(hospital, async (l, est) =>
      (
        await l.consultar(
          `SELECT x.id, u.login, DATE_FORMAT(x.valida_ate, '%Y-%m-%d') AS ate, x.motivo, x.criado_em, c.login AS criado_por
             FROM excecao_conta_dormente x JOIN usuario u ON u.id = x.usuario_id
             LEFT JOIN usuario c ON c.id = x.criado_por
            WHERE x.estabelecimento_id = ? AND x.excluido_em IS NULL ORDER BY x.id DESC`,
          [est],
          { teto: TETO * 4 },
        )
      ).map((x) => {
        const ate = txtOuNull(x['ate']);
        return {
          id: String(x['id']),
          login: txt(x['login']),
          ate,
          situacao: ate === null ? ('retirada' as const) : ('vigente' as const),
          motivo: txt(x['motivo']),
          criadoPor: txt(x['criado_por']),
          criadoEm: data(x['criado_em']),
        };
      }),
    );
  }

  registrarExcecaoDormencia(_rede: string, hospital: string, p: NovaExcecaoDormencia, t: TrilhaGestao) {
    return this.gravar(
      { nome: 'acesso.dormencia.excecao', tabelas: ['excecao_conta_dormente'], esquema: ESQUEMA_EXCECAO_DORMENCIA, alvo: 'excecao_conta_dormente',
        motivo: (e) => e.motivo, dados: (e) => ({ login: e.login, ate: e.retirar ? null : e.ate, retirar: e.retirar }) },
      hospital, t, { login: p.login, ate: p.ate, retirar: p.retirar, motivo: p.motivo },
      async (tx, e, est) => {
        const motivo = e.motivo.trim();
        if (motivo.length < 10) throw recusa('motivo-curto', 'Justifique a exceção (ao menos 10 caracteres).');
        // Melhor prática: toda exceção à rotina das contas dormentes tem prazo (no banco, a validade nula é a retirada).
        if (!e.retirar && e.ate === null) throw recusa('prazo-obrigatorio', 'Informe até quando vale a exceção (AAAA-MM-DD).');
        if (!e.retirar && e.ate !== null && !/^\d{4}-\d{2}-\d{2}$/.test(e.ate))
          throw recusa('prazo-invalido', 'Informe o prazo como data (AAAA-MM-DD).');
        const u = await tx.uma(`SELECT u.id FROM usuario u WHERE u.login = ? AND u.excluido_em IS NULL AND ${VINCULO}`, [e.login, est]);
        if (!u) throw recusa('usuario-inexistente', 'Usuário não encontrado.');
        const [ant] = await tx.consultarParaAtualizar(
          `SELECT id, DATE_FORMAT(valida_ate, '%Y-%m-%d') AS ate FROM excecao_conta_dormente
            WHERE usuario_id = ? AND estabelecimento_id = ? AND excluido_em IS NULL ORDER BY id DESC LIMIT 1`,
          [num(u['id']), est],
          { teto: 1 },
        );
        const anterior = ant ? txtOuNull(ant['ate']) : null;
        if (e.retirar && anterior === null) throw recusa('sem-excecao', 'Este usuário não tem exceção para retirar.');
        if (!e.retirar && anterior === e.ate) throw recusa('sem-mudanca', 'A exceção informada é igual à que já vale para este usuário.');
        const atual = e.retirar ? null : e.ate;
        const id = await tx.incluir('excecao_conta_dormente', {
          usuario_id: num(u['id']),
          estabelecimento_id: est,
          valida_ate: atual,
          motivo: motivo.slice(0, 500),
        });
        return { resultado: { id, anterior, atual }, antes: { ate: anterior } };
      },
    ).then((r) => ({ id: String(r.id), anterior: r.anterior, atual: r.atual }));
  }

  // ── Conferência do registro no conselho (conferencia_registro_conselho) ───────────────────────

  registrosConselho(_rede: string, hospital: string, login: string): Promise<RegistroConselhoUsuario[]> {
    return this.ler(hospital, async (l, est) => (await l.consultar(SQL_REGISTROS_CONSELHO, [login, est], { teto: 50 })).map(registroConselhoDaLinha));
  }

  conferenciasConselho(_rede: string, hospital: string, login: string): Promise<ConferenciaConselhoLida[]> {
    return this.ler(hospital, async (l, est) =>
      (
        await l.consultar(
          `SELECT x.id, u.login, x.inscricao_conselho_id, x.situacao, DATE_FORMAT(x.conferido_em, '%Y-%m-%d') AS conferido_dia,
                  x.fonte, x.observacao, x.criado_em, c.login AS criado_por
             FROM conferencia_registro_conselho x JOIN usuario u ON u.id = x.usuario_id
             LEFT JOIN usuario c ON c.id = x.criado_por
            WHERE u.login = ? AND x.estabelecimento_id = ? AND x.excluido_em IS NULL ORDER BY x.id DESC`,
          [login, est],
          { teto: TETO },
        )
      ).map((x) => ({
        id: String(x['id']),
        login: txt(x['login']),
        registro: num(x['inscricao_conselho_id']),
        situacao: txt(x['situacao']).replace(/_/g, '-') as SituacaoConselho,
        conferidoEm: txt(x['conferido_dia']),
        fonte: txt(x['fonte']).replace(/_/g, '-') as FonteConferenciaConselho,
        observacao: txt(x['observacao']),
        criadoPor: txt(x['criado_por']),
        criadoEm: data(x['criado_em']),
      })),
    );
  }

  registrarConferenciaConselho(_rede: string, hospital: string, p: NovaConferenciaConselho, t: TrilhaGestao) {
    const entrada = { login: p.login, registro: p.registro, situacao: p.situacao, conferidoEm: p.conferidoEm, fonte: p.fonte, observacao: p.observacao, hoje: p.hoje };
    return this.gravar(
      { nome: 'acesso.conselho.conferir', tabelas: ['conferencia_registro_conselho'], esquema: ESQUEMA_CONFERENCIA_CONSELHO, alvo: 'conferencia_registro_conselho',
        dados: (e) => ({ login: e.login, registro: e.registro, situacao: e.situacao, conferidoEm: e.conferidoEm, fonte: e.fonte }) },
      hospital, t, entrada,
      async (tx, e, est) => {
        const observacao = e.observacao.trim();
        if (observacao.length < 10) throw recusa('observacao-curta', 'Descreva a conferência (ao menos 10 caracteres).');
        if (!(SITUACOES_CONSELHO as readonly string[]).includes(e.situacao)) throw recusa('situacao-invalida', 'Situação no conselho fora da lista.');
        if (!(FONTES_CONFERENCIA_CONSELHO as readonly string[]).includes(e.fonte)) throw recusa('fonte-invalida', 'Fonte da conferência fora da lista.');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(e.conferidoEm)) throw recusa('data-invalida', 'Informe o dia da consulta à fonte (AAAA-MM-DD).');
        if (e.conferidoEm > e.hoje) throw recusa('data-futura', 'O dia da consulta à fonte não pode ser depois de hoje.');
        const registros = await tx.consultar(SQL_REGISTROS_CONSELHO, [e.login, est], { teto: 50 });
        const reg = registros.find((x) => num(x['id']) === e.registro);
        if (!reg) throw recusa('registro-nao-vinculado', 'Este registro de conselho não está ligado ao profissional da conta.');
        const [ant] = await tx.consultarParaAtualizar(
          `SELECT id, situacao, fonte, DATE_FORMAT(conferido_em, '%Y-%m-%d') AS conferido_dia FROM conferencia_registro_conselho
            WHERE usuario_id = ? AND estabelecimento_id = ? AND inscricao_conselho_id = ? AND excluido_em IS NULL
            ORDER BY id DESC LIMIT 1`,
          [num(reg['usuario_id']), est, e.registro],
          { teto: 1 },
        );
        const diaAnt = ant ? txt(ant['conferido_dia']) : null;
        if (diaAnt && diaAnt > e.conferidoEm)
          throw recusa('conferencia-anterior', `Já há conferência mais recente deste registro (${diaAnt}): registre a consulta mais nova.`);
        const id = await tx.incluir('conferencia_registro_conselho', {
          usuario_id: num(reg['usuario_id']),
          estabelecimento_id: est,
          inscricao_conselho_id: e.registro,
          situacao: e.situacao.replace(/-/g, '_'),
          fonte: e.fonte.replace(/-/g, '_'),
          conferido_em: e.conferidoEm,
          observacao: observacao.slice(0, 500),
        });
        const rotulo = (s: string, d: string, f: string) => `${s} em ${d} (${f})`;
        return {
          resultado: {
            id,
            anterior: ant ? rotulo(txt(ant['situacao']).replace(/_/g, '-'), diaAnt ?? '', txt(ant['fonte']).replace(/_/g, '-')) : null,
            atual: rotulo(e.situacao, e.conferidoEm, e.fonte),
          },
        };
      },
    ).then((r) => ({ id: String(r.id), anterior: r.anterior, atual: r.atual }));
  }

  // ── Integração com o RH (perfil_cargo_rh e resolucao_tarefa_rh) ──────────────────────────────

  dadosRh(_rede: string, hospital: string): Promise<DadosRhLidos> {
    return this.ler(hospital, (l, est) => lerDadosRh(l, est));
  }

  definirPerfilCargoRh(_rede: string, hospital: string, p: NovoPerfilCargoRh, t: TrilhaGestao) {
    return this.gravar(
      { nome: 'acesso.rh.perfil-cargo', tabelas: ['perfil_cargo_rh'], esquema: ESQUEMA_PERFIL_CARGO, alvo: 'perfil_cargo_rh',
        motivo: (e) => e.motivo, dados: (e) => ({ cargo: e.cargo, perfil: e.perfil }) },
      hospital, t, { cargo: p.cargo, perfil: p.perfil, motivo: p.motivo },
      async (tx, e, est) => {
        if (!e.cargo.trim() || e.cargo.length > 60) throw recusa('cargo-invalido', 'Informe o cargo (até 60 caracteres).');
        const cargo = (await tx.consultar('SELECT id, nome FROM cargo WHERE excluido_em IS NULL ORDER BY id', [], { teto: TETO }))
          .find((x) => chaveCargoRh(txt(x['nome'])) === chaveCargoRh(e.cargo));
        if (!cargo) throw recusa('cargo-inexistente', 'O cargo não está cadastrado no RH.');
        const perfilId = e.perfil === null ? null : await this.perfilId(tx, est, e.perfil);
        const hoje = dia(new Date());
        const [ultima] = await tx.consultarParaAtualizar(
          `SELECT x.id, x.versao, x.vigencia_inicio = ? AS de_hoje, pa.codigo FROM perfil_cargo_rh x
             LEFT JOIN perfil_acesso pa ON pa.id = x.perfil_acesso_id
            WHERE x.estabelecimento_id = ? AND x.cargo_id = ? AND x.excluido_em IS NULL AND x.vigencia_fim IS NULL
            ORDER BY x.id DESC LIMIT 1`,
          [hoje, est, num(cargo['id'])],
          { teto: 1 },
        );
        const anterior = ultima ? txtOuNull(ultima['codigo']) : null;
        if (e.perfil === null && anterior === null) throw recusa('sem-sugestao', 'Este cargo não tem perfil sugerido para retirar.');
        if (e.perfil !== null && anterior === e.perfil) throw recusa('sem-mudanca', 'O perfil informado é igual ao que já se sugere para este cargo.');
        // Uma linha por dia de vigência: a mudança no mesmo dia altera a linha do dia (o anterior vai à trilha).
        if (ultima && bool(ultima['de_hoje'])) {
          await tx.alterar('perfil_cargo_rh', num(ultima['id']), num(ultima['versao']), { perfil_acesso_id: perfilId, motivo: e.motivo.slice(0, 500) });
          return { resultado: { id: num(ultima['id']), anterior, perfil: e.perfil }, antes: { perfil: anterior } };
        }
        if (ultima) {
          const ontem = dia(new Date(Date.now() - 86_400_000));
          await tx.alterar('perfil_cargo_rh', num(ultima['id']), num(ultima['versao']), { vigencia_fim: ontem });
        }
        const id = await tx.incluir('perfil_cargo_rh', {
          estabelecimento_id: est,
          cargo_id: num(cargo['id']),
          perfil_acesso_id: perfilId,
          motivo: e.motivo.slice(0, 500),
          vigencia_inicio: hoje,
        });
        return { resultado: { id, anterior, perfil: e.perfil }, antes: { perfil: anterior } };
      },
    ).then((r) => ({ id: String(r.id), anterior: r.anterior, perfil: r.perfil }));
  }

  resolverTarefaRh(_rede: string, hospital: string, p: NovaResolucaoRh, t: TrilhaGestao, validar: ValidarResolucaoRhMemoria) {
    const entrada = { tipo: p.tipo, vinculo: p.vinculo, ref: p.ref, situacao: p.situacao, login: p.login, motivo: p.motivo };
    return this.gravar(
      { nome: 'acesso.rh.resolver', tabelas: ['resolucao_tarefa_rh'], esquema: ESQUEMA_RESOLUCAO_RH, alvo: 'resolucao_tarefa_rh',
        motivo: (e) => e.motivo, dados: (e) => ({ tipo: e.tipo, vinculo: e.vinculo, ref: e.ref, situacao: e.situacao, login: e.login }) },
      hospital, t, entrada,
      async (tx, e, est, operador) => {
        const alvo = referenciaRh(e.tipo, e.ref, e.vinculo);
        if (!alvo) throw recusa('ref-invalida', 'A referência da tarefa não corresponde ao tipo.');
        const v = await tx.uma('SELECT id FROM vinculo_trabalho WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL', [e.vinculo, est]);
        if (!v) throw new ErroOperacao(404, 'nao-encontrado', 'Vínculo não encontrado', 'O vínculo não existe neste estabelecimento.');
        const [ja] = await tx.consultarParaAtualizar(
          `SELECT r.id, r.decisao, u.login FROM resolucao_tarefa_rh r LEFT JOIN usuario u ON u.id = r.resolvido_por_usuario_id
            WHERE r.estabelecimento_id = ? AND r.tipo = ? AND r.referencia_entidade = ? AND r.referencia_id = ?`,
          [est, e.tipo.replace(/-/g, '_'), alvo.entidade, alvo.id],
          { teto: 1 },
        );
        if (ja)
          throw recusa('ja-resolvida', `Esta tarefa já foi resolvida por ${txt(ja['login'])} (${txt(ja['decisao']) === 'atendida' ? 'feita' : 'dispensada'}).`);
        const problema = validar(await lerDadosRh(tx, est));
        if (problema) throw new ErroOperacao(409, problema.codigo, 'Operação recusada', problema.mensagem, { campos: problema.campos ?? [] });
        let usuarioId: number | null = null;
        if (e.login) {
          const u = await tx.uma('SELECT id FROM usuario WHERE login = ? AND excluido_em IS NULL', [e.login]);
          if (!u) throw recusa('usuario-inexistente', 'O login informado não existe.');
          usuarioId = num(u['id']);
        }
        const id = await tx.incluir('resolucao_tarefa_rh', {
          estabelecimento_id: est,
          usuario_id: usuarioId,
          tipo: e.tipo.replace(/-/g, '_'),
          referencia_entidade: alvo.entidade,
          referencia_id: alvo.id,
          decisao: e.situacao === 'feita' ? 'atendida' : 'dispensada',
          motivo: e.motivo.trim().slice(0, 500),
          resolvido_em: new Date(),
          resolvido_por_usuario_id: operador,
        });
        return { resultado: { id } };
      },
    ).then((r) => ({ id: String(r.id) }));
  }

  /** O perfil pelo código (do estabelecimento ou da rede inteira); inexistente: recusa. */
  private async perfilId(tx: TxOperacao, est: number, codigo: string): Promise<number> {
    const p = await tx.uma(
      `SELECT id FROM perfil_acesso WHERE codigo = ? AND (estabelecimento_id = ? OR estabelecimento_id IS NULL)
         AND excluido_em IS NULL ORDER BY estabelecimento_id IS NULL LIMIT 1`,
      [codigo, est],
    );
    if (!p) throw recusa('perfil-inexistente', 'O perfil não está cadastrado neste estabelecimento.');
    return num(p['id']);
  }

  // ── Tabelas existentes, adaptador a escrever (pedido ao orquestrador) ──────────────────────────

  campanhasRecert(): Promise<never> {
    return adaptadorPendenteGestao('A campanha de recertificação');
  }
  campanhaRecert(): Promise<never> {
    return adaptadorPendenteGestao('A campanha de recertificação');
  }
  abrirCampanhaRecert(): Promise<never> {
    return adaptadorPendenteGestao('A campanha de recertificação');
  }
  decidirRecert(): Promise<never> {
    return adaptadorPendenteGestao('A campanha de recertificação');
  }
  fecharCampanhaRecert(): Promise<never> {
    return adaptadorPendenteGestao('A campanha de recertificação');
  }
  pedidosAcesso(): Promise<never> {
    return adaptadorPendenteGestao('O pedido de acesso');
  }
  pedidoAcesso(): Promise<never> {
    return adaptadorPendenteGestao('O pedido de acesso');
  }
  pedirAcesso(): Promise<never> {
    return adaptadorPendenteGestao('O pedido de acesso');
  }
  decidirPedidoAcesso(): Promise<never> {
    return adaptadorPendenteGestao('O pedido de acesso');
  }
  concederPedidoAprovado(): Promise<never> {
    return adaptadorPendenteGestao('O pedido de acesso');
  }
  concessaoPedidoAcesso(): Promise<never> {
    return adaptadorPendenteGestao('O pedido de acesso');
  }
  cancelarPedidoAcesso(): Promise<never> {
    return adaptadorPendenteGestao('O pedido de acesso');
  }
}

/** A fonte da gestão de acessos sobre o banco do cliente (`cliente`: configuracao.clientePadrao). */
export function fonteGestaoPropria(nucleo: NucleoGestao, cliente: string, executor?: Executor): FonteGestao {
  return new FonteGestaoPropria(nucleo, cliente, executor);
}
