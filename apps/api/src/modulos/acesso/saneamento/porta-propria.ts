// Porta própria do saneamento dos perfis de acesso amplo (M59-F4) sobre o banco do cliente, pelo @sgh/nucleo:
// leituras numa transação somente leitura; o plano e a aplicação pelo Executor (trilha e idempotência na mesma
// transação, cada operação declarando as tabelas que grava).
// - "Grupo" é o código do perfil (perfil_acesso.codigo). Quem tem o grupo: toda conta com um perfil vigente desse código
//   visível no estabelecimento, seja o do estabelecimento ou o da rede (os dois podem existir juntos com o mesmo código). As
//   ações do grupo e o destino da troca são os do perfil que prevalece (o do estabelecimento). "Opção" é a ação do
//   catálogo (acao_sistema.id), permitida pelo perfil_acao.
// - Quem tem o perfil: usuario_perfil vigente (UTC_DATE entre o início e o fim, inclusive) no estabelecimento da sessão.
// - Uso das ações: a tabela uso_acao_usuario (pedido de DDL do lote 02-04: contagem por conta, ação e dia, gravada pela
//   guarda de permissão). Sem ela, ou com a contagem começada depois do início da janela, `uso` LANÇA "uso
//   indisponível": o serviço trata como uso não lido e toda troca que tira ação exige a aprovação da área (falha
//   fechada), nunca um uso vazio tomado por "não usou".
// - O plano fica na tabela saneamento_acesso_item (pedido de DDL do lote 02-04): sem ela, `pronto` responde false e o
//   serviço devolve 503 com o motivo ("ainda não está instalado"), nunca uma lista vazia enganosa.
// Melhoria: o uso vem de uma contagem própria por ação (sem a trilha paralela do sistema de origem) e o plano guarda ids
// (usuário, perfis, aprovador) com FK, em vez de logins e nomes de grupo em texto.
// Melhoria: o item que exige aprovação só é reservado e aplicado depois de aprovado também na gravação condicional
// (não só no serviço), e a chave de idempotência de cada gravação do plano deriva do estado do item (não é aleatória).
// Melhoria: o bloqueio pelo saneamento (vale na rede toda) é recusado se a conta tem perfil vigente em outro
// estabelecimento: o gestor de um estabelecimento não tira o acesso de quem trabalha em outro.
// Melhoria: a troca de perfil encerra a vigência do perfil amplo (ontem) e abre a do perfil de trabalho (hoje), sem
// apagar o histórico; o bloqueio grava a linha do tempo da conta (usuario_situacao_historico) na mesma transação.
// Melhoria: a retirada das ações de um perfil da rede é recusada se outro estabelecimento ainda o usa (a dissolução
// num estabelecimento nunca muda o acesso de outro).
import { createHash } from 'node:crypto';
import {
  DECISOES_SANEAMENTO,
  type DecisaoSaneamento,
  GRUPOS_GENERICOS,
  type ItemSaneamento,
  LOTE_OPCOES_DISSOLUCAO,
  RESERVA_APLICACAO_MINUTOS,
  SITUACOES_ITEM_SANEAMENTO,
  type SituacaoItemSaneamento,
} from '@sgh/contratos';
import { chaveGrupo } from '@sgh/dominio-acesso';
import {
  type ContextoOperacao,
  definirOperacao,
  ErroOperacao,
  type Executor,
  type Leitor,
  type NucleoProprio,
  recusa,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';
import type {
  DecisaoSaneamentoNova,
  GrupoComOpcoes,
  PortaSaneamento,
  SituacaoGrupo,
  TrilhaSaneamento,
  UsuarioDoGrupo,
} from './porta.js';
import { type ContextoExecucaoSaneamento, type ExecutorSaneamento, OPERACOES_SANEAMENTO } from './servico.js';

/** O mínimo do núcleo que a porta e o executor usam. */
export type NucleoSaneamento = Pick<NucleoProprio, 'lerSomente' | 'criarExecutor'>;

type Linha = Record<string, unknown>;

export const TABELA_PLANO_SANEAMENTO = 'saneamento_acesso_item';
/** Contagem do uso das ações por conta e dia (pedido de DDL do lote 02-04; gravada pela guarda de permissão). */
export const TABELA_USO_ACOES = 'uso_acao_usuario';
/** Recusa da leitura do uso enquanto a tabela do uso não existe (o serviço trata como uso não lido). */
export const USO_INDISPONIVEL = 'uso-indisponivel';
/** Recusa interna: a gravação condicional não achou o item no estado pedido (a porta devolve false). */
const SEM_MUDANCA = 'saneamento-sem-mudanca';

const texto = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
const textoOuNulo = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const numero = (v: unknown): number => Number(v ?? 0);
const numeroOuNulo = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const bool = (v: unknown): boolean => v === true || Number(v) === 1;

/** DATETIME do banco (sessão em UTC) em ISO. */
export function isoDoBanco(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  const t = String(v).trim();
  if (!t) return null;
  const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(t) ? t : `${t.replace(' ', 'T')}Z`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Dia (AAAA-MM-DD, UTC) de `ms` deslocado em dias. */
export function diaUtc(ms: number, deslocamento = 0): string {
  return new Date(ms + deslocamento * 86_400_000).toISOString().slice(0, 10);
}

// Decisão: o contrato usa hífen; o banco, snake_case (convenção do DDL).
const DECISAO_NO_BANCO: Readonly<Record<DecisaoSaneamento, string>> = {
  'trocar-grupo': 'trocar_perfil',
  bloquear: 'bloquear',
  'manter-administrador': 'manter_administrador',
  'dissolver-grupo': 'dissolver_perfil',
};
const DECISAO_DO_BANCO = new Map(
  Object.entries(DECISAO_NO_BANCO).map(([k, v]) => [v, k as DecisaoSaneamento]),
);

/** O perfil amplo de uma conta: o primeiro da lista dos amplos que ela tem; sem nenhum, o primeiro código; ou null. */
export function grupoPrincipal(codigos: readonly string[]): string | null {
  for (const g of GRUPOS_GENERICOS) {
    const achado = codigos.find((c) => chaveGrupo(c) === chaveGrupo(g));
    if (achado) return achado;
  }
  return codigos[0] ?? null;
}

const VIGENTE_UP = `up.excluido_em IS NULL AND up.vigencia_inicio <= UTC_DATE()
  AND (up.vigencia_fim IS NULL OR up.vigencia_fim >= UTC_DATE())`;
/** Conta ativa (não inativa e dentro da validade) e sem bloqueio. */
const CONTA_ATIVA = `u.situacao IN ('ativo', 'dormente') AND (u.expira_em IS NULL OR u.expira_em > UTC_TIMESTAMP(3))`;
/** Item sem reserva viva de aplicação (a reserva vence em RESERVA_APLICACAO_MINUTOS). */
const SEM_RESERVA = `(situacao = 'falhou' OR reservado_por IS NULL
  OR reservado_em < UTC_TIMESTAMP(3) - INTERVAL ${Number(RESERVA_APLICACAO_MINUTOS)} MINUTE)`;
/** Item que exige a aprovação da área só segue (reserva e aplicação) depois de aprovado. */
const APROVADO_SE_EXIGE = `(NOT exige_aprovacao OR situacao = 'aprovado')`;
const MARCA_ALTERACAO = 'alterado_em = UTC_TIMESTAMP(3), alterado_por = ?, versao = versao + 1';

const marcadores = (n: number) => Array.from({ length: n }, () => '?').join(', ');

interface PerfilLido {
  readonly id: number;
  readonly codigo: string;
  readonly ativo: boolean;
  /** null: perfil da rede inteira. */
  readonly estabelecimento: number | null;
}

async function idEstabelecimento(l: Leitor, codigo: string): Promise<number | null> {
  const r = await l.uma<Linha>('SELECT id FROM estabelecimento WHERE codigo = ? AND excluido_em IS NULL', [
    codigo,
  ]);
  return r ? Number(r['id']) : null;
}

/** Perfis visíveis no estabelecimento (dele ou da rede), um por código: o do estabelecimento prevalece. */
async function perfisDoEstabelecimento(l: Leitor, est: number): Promise<Map<string, PerfilLido>> {
  const linhas = await l.consultar<Linha>(
    `SELECT p.id, p.codigo, p.ativo, p.estabelecimento_id
       FROM perfil_acesso p
      WHERE p.excluido_em IS NULL AND (p.estabelecimento_id = ? OR p.estabelecimento_id IS NULL)
      ORDER BY p.codigo, p.estabelecimento_id IS NULL`,
    [est],
    { teto: 20_000 },
  );
  const r = new Map<string, PerfilLido>();
  for (const x of linhas) {
    const codigo = texto(x['codigo']);
    if (!r.has(codigo))
      r.set(codigo, {
        id: Number(x['id']),
        codigo,
        ativo: bool(x['ativo']),
        estabelecimento: numeroOuNulo(x['estabelecimento_id']),
      });
  }
  return r;
}

/** Ids dos perfis com o código visíveis no estabelecimento (o dele e o da rede): juntos formam o "grupo". */
async function idsDoCodigo(l: Leitor, est: number, codigo: string): Promise<number[]> {
  const linhas = await l.consultar<Linha>(
    `SELECT p.id FROM perfil_acesso p
      WHERE p.excluido_em IS NULL AND p.codigo = ? AND (p.estabelecimento_id = ? OR p.estabelecimento_id IS NULL)`,
    [codigo, est],
    { teto: 2 },
  );
  return linhas.map((x) => Number(x['id']));
}

async function tabelaExiste(l: Leitor, nome: string): Promise<boolean> {
  const r = await l.uma<Linha>(
    'SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?',
    [nome],
  );
  return numero(r?.['n']) === 1;
}

/** Conta com perfil vigente em outro estabelecimento (o parâmetro é o estabelecimento da sessão). */
const EM_OUTRO_ESTABELECIMENTO = `EXISTS (SELECT 1 FROM usuario_perfil o
     WHERE o.usuario_id = u.id AND o.estabelecimento_id <> ? AND o.excluido_em IS NULL
       AND o.vigencia_inicio <= UTC_DATE() AND (o.vigencia_fim IS NULL OR o.vigencia_fim >= UTC_DATE()))`;

async function perfilPorCodigo(l: Leitor, est: number, codigo: string): Promise<PerfilLido | null> {
  const r = await l.uma<Linha>(
    `SELECT p.id, p.codigo, p.ativo, p.estabelecimento_id
       FROM perfil_acesso p
      WHERE p.excluido_em IS NULL AND p.codigo = ? AND (p.estabelecimento_id = ? OR p.estabelecimento_id IS NULL)
      ORDER BY p.estabelecimento_id IS NULL LIMIT 1`,
    [codigo, est],
  );
  return r
    ? {
        id: Number(r['id']),
        codigo: texto(r['codigo']),
        ativo: bool(r['ativo']),
        estabelecimento: numeroOuNulo(r['estabelecimento_id']),
      }
    : null;
}

const COLUNAS_ITEM = `s.id, po.codigo AS grupo_origem, s.usuario_id, ua.login AS login, s.decisao,
       pd.codigo AS grupo_destino, s.perdas_total, s.perdas_usadas, s.exige_aprovacao, s.situacao, s.motivo,
       uc.login AS criado_por_login, s.criado_em, s.area, uap.login AS aprovado_por_login, s.aprovado_em,
       s.motivo_aprovacao, COALESCE(upl.login, ur.login) AS aplicado_por_login,
       COALESCE(s.aplicado_em, s.reservado_em) AS aplicado_em, s.erro
  FROM saneamento_acesso_item s
  JOIN perfil_acesso po ON po.id = s.perfil_origem_id
  LEFT JOIN perfil_acesso pd ON pd.id = s.perfil_destino_id
  LEFT JOIN usuario ua ON ua.id = s.usuario_id
  LEFT JOIN usuario uc ON uc.id = s.criado_por
  LEFT JOIN usuario uap ON uap.id = s.aprovador_usuario_id
  LEFT JOIN usuario ur ON ur.id = s.reservado_por
  LEFT JOIN usuario upl ON upl.id = s.aplicado_por`;

export function itemDaLinha(x: Linha): ItemSaneamento {
  const aprovadoPor = textoOuNulo(x['aprovado_por_login']);
  const situacao = texto(x['situacao']);
  return {
    id: texto(x['id']),
    grupoOrigem: texto(x['grupo_origem']),
    login: textoOuNulo(x['login']),
    idUsuario: numeroOuNulo(x['usuario_id']),
    decisao: DECISAO_DO_BANCO.get(texto(x['decisao'])) ?? DECISOES_SANEAMENTO[0],
    grupoDestino: textoOuNulo(x['grupo_destino']),
    perdasTotal: numero(x['perdas_total']),
    perdasUsadas: numero(x['perdas_usadas']),
    exigeAprovacao: bool(x['exige_aprovacao']),
    situacao: (SITUACOES_ITEM_SANEAMENTO as readonly string[]).includes(situacao)
      ? (situacao as SituacaoItemSaneamento)
      : 'falhou',
    motivo: texto(x['motivo']),
    criadoPor: texto(x['criado_por_login']),
    criadoEm: isoDoBanco(x['criado_em']) ?? '',
    aprovacao: aprovadoPor
      ? {
          area: texto(x['area']),
          por: aprovadoPor,
          em: isoDoBanco(x['aprovado_em']) ?? '',
          motivo: texto(x['motivo_aprovacao']),
        }
      : null,
    aplicadoEm: isoDoBanco(x['aplicado_em']),
    aplicadoPor: textoOuNulo(x['aplicado_por_login']),
    erro: textoOuNulo(x['erro']),
  };
}

// ── operações do plano ────────────────────────────────────────────────────────────────────────────

const esquemaTrilha = {
  estabelecimento: z.number().int().positive(),
  evento: z.string().min(1).max(80),
  recurso: z.string().min(1).max(80),
  estacao: z.string().max(80).nullable(),
};
const extrasTrilha = (e: { evento: string; recurso: string; estacao: string | null }) => ({
  dados: { evento: e.evento, recurso: e.recurso, estacao: e.estacao },
});

const opIncluir = definirOperacao({
  nome: 'acesso.saneamento.incluir-decisao',
  tabelas: [TABELA_PLANO_SANEAMENTO],
  acao: 'inclusao',
  entrada: z
    .object({
      ...esquemaTrilha,
      grupoOrigem: z.string().trim().min(1).max(60),
      grupoDestino: z.string().trim().min(1).max(60).nullable(),
      idUsuario: z.number().int().positive().nullable(),
      decisao: z.enum(DECISOES_SANEAMENTO),
      perdasTotal: z.number().int().nonnegative(),
      perdasUsadas: z.number().int().nonnegative(),
      exigeAprovacao: z.boolean(),
      motivo: z.string().trim().min(1).max(200),
    })
    .strict(),
  async gravar(tx, e, ctx) {
    const origem = await perfilPorCodigo(tx, e.estabelecimento, e.grupoOrigem);
    if (!origem) throw recusa('perfil-inexistente', 'O perfil de origem não existe neste estabelecimento.');
    const destino = e.grupoDestino ? await perfilPorCodigo(tx, e.estabelecimento, e.grupoDestino) : null;
    if (e.grupoDestino && !destino)
      throw recusa('destino-invalido', 'O perfil de destino não existe neste estabelecimento.');
    if (e.idUsuario !== null && e.idUsuario === ctx.usuario)
      throw recusa('a-si-mesmo', 'Ninguém decide o saneamento sobre si.');
    // Uma decisão viva por alvo: a anterior (sem reserva de aplicação) é descartada na mesma transação.
    await tx.executar(
      `UPDATE saneamento_acesso_item
          SET situacao = 'descartado', descartado_por = ?, descartado_em = UTC_TIMESTAMP(3), ${MARCA_ALTERACAO}
        WHERE estabelecimento_id = ? AND excluido_em IS NULL AND situacao IN ('proposto', 'aprovado', 'falhou')
          AND ${SEM_RESERVA} AND ${e.idUsuario !== null ? 'usuario_id = ?' : 'usuario_id IS NULL AND perfil_origem_id = ?'}`,
      [ctx.usuario, ctx.usuario, e.estabelecimento, e.idUsuario ?? origem.id],
    );
    const id = await tx.incluir(TABELA_PLANO_SANEAMENTO, {
      estabelecimento_id: e.estabelecimento,
      perfil_origem_id: origem.id,
      usuario_id: e.idUsuario,
      decisao: DECISAO_NO_BANCO[e.decisao],
      perfil_destino_id: destino?.id ?? null,
      perdas_total: e.perdasTotal,
      perdas_usadas: e.perdasUsadas,
      exige_aprovacao: e.exigeAprovacao,
      situacao: 'proposto',
      motivo: e.motivo,
    });
    return { id };
  },
  alvo: (_e, r) => ({ tabela: TABELA_PLANO_SANEAMENTO, id: r.id }),
  trilha: (e) => extrasTrilha(e),
});

/** Mudança condicional de um item do plano; 0 linha: recusa interna (a porta devolve false). */
async function mudarItem(tx: TxOperacao, sql: string, parametros: readonly unknown[]): Promise<void> {
  const n = await tx.executar(sql, parametros);
  if (n !== 1) throw recusa(SEM_MUDANCA, 'A decisão não está no estado esperado.');
}

const esquemaItem = { ...esquemaTrilha, id: z.number().int().positive() };

const opAprovar = definirOperacao({
  nome: 'acesso.saneamento.aprovar-decisao',
  tabelas: [TABELA_PLANO_SANEAMENTO],
  acao: 'alteracao',
  entrada: z
    .object({
      ...esquemaItem,
      area: z.string().trim().min(1).max(60),
      motivo: z.string().trim().min(1).max(200),
    })
    .strict(),
  async gravar(tx, e, ctx) {
    const [atual] = await tx.consultarParaAtualizar<Linha>(
      `SELECT criado_por, usuario_id FROM saneamento_acesso_item
        WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
      [e.id, e.estabelecimento],
      { teto: 1 },
    );
    if (
      atual &&
      (numeroOuNulo(atual['criado_por']) === ctx.usuario || numeroOuNulo(atual['usuario_id']) === ctx.usuario)
    )
      throw recusa('aprovacao-pelo-proponente', 'A aprovação da área tem de ser de outra pessoa.');
    await mudarItem(
      tx,
      `UPDATE saneamento_acesso_item
          SET situacao = 'aprovado', area = ?, aprovador_usuario_id = ?, aprovado_em = UTC_TIMESTAMP(3),
              motivo_aprovacao = ?, ${MARCA_ALTERACAO}
        WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL AND situacao = 'proposto' AND exige_aprovacao`,
      [e.area, ctx.usuario, e.motivo, ctx.usuario, e.id, e.estabelecimento],
    );
    return { id: e.id };
  },
  alvo: (e) => ({ tabela: TABELA_PLANO_SANEAMENTO, id: e.id }),
  trilha: (e) => extrasTrilha(e),
});

const opDescartar = definirOperacao({
  nome: 'acesso.saneamento.descartar-decisao',
  tabelas: [TABELA_PLANO_SANEAMENTO],
  acao: 'alteracao',
  entrada: z.object(esquemaItem).strict(),
  async gravar(tx, e, ctx) {
    await mudarItem(
      tx,
      `UPDATE saneamento_acesso_item
          SET situacao = 'descartado', descartado_por = ?, descartado_em = UTC_TIMESTAMP(3), ${MARCA_ALTERACAO}
        WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL
          AND situacao IN ('proposto', 'aprovado', 'falhou') AND ${SEM_RESERVA}`,
      [ctx.usuario, ctx.usuario, e.id, e.estabelecimento],
    );
    return { id: e.id };
  },
  alvo: (e) => ({ tabela: TABELA_PLANO_SANEAMENTO, id: e.id }),
  trilha: (e) => extrasTrilha(e),
});

const opReservar = definirOperacao({
  nome: 'acesso.saneamento.reservar-decisao',
  tabelas: [TABELA_PLANO_SANEAMENTO],
  acao: 'alteracao',
  entrada: z.object(esquemaItem).strict(),
  async gravar(tx, e, ctx) {
    await mudarItem(
      tx,
      `UPDATE saneamento_acesso_item
          SET reservado_por = ?, reservado_em = UTC_TIMESTAMP(3), ${MARCA_ALTERACAO}
        WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL
          AND situacao IN ('proposto', 'aprovado') AND ${APROVADO_SE_EXIGE} AND ${SEM_RESERVA}`,
      [ctx.usuario, ctx.usuario, e.id, e.estabelecimento],
    );
    return { id: e.id };
  },
  alvo: (e) => ({ tabela: TABELA_PLANO_SANEAMENTO, id: e.id }),
  trilha: (e) => extrasTrilha(e),
});

const opConcluir = definirOperacao({
  nome: 'acesso.saneamento.concluir-decisao',
  tabelas: [TABELA_PLANO_SANEAMENTO],
  acao: 'alteracao',
  entrada: z
    .object({
      ...esquemaItem,
      resultado: z.enum(['aplicado', 'falhou']),
      erro: z.string().max(200).nullable(),
    })
    .strict(),
  async gravar(tx, e, ctx) {
    await mudarItem(
      tx,
      e.resultado === 'aplicado'
        ? `UPDATE saneamento_acesso_item
              SET situacao = 'aplicado', aplicado_por = reservado_por, aplicado_em = UTC_TIMESTAMP(3), erro = NULL,
                  ${MARCA_ALTERACAO}
            WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL
              AND situacao IN ('proposto', 'aprovado') AND ${APROVADO_SE_EXIGE} AND reservado_por = ?`
        : `UPDATE saneamento_acesso_item
              SET situacao = 'falhou', erro = ?, reservado_por = NULL, reservado_em = NULL, ${MARCA_ALTERACAO}
            WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL
              AND situacao IN ('proposto', 'aprovado') AND reservado_por = ?`,
      e.resultado === 'aplicado'
        ? [ctx.usuario, e.id, e.estabelecimento, ctx.usuario]
        : [e.erro ?? 'erro', ctx.usuario, e.id, e.estabelecimento, ctx.usuario],
    );
    return { id: e.id, resultado: e.resultado };
  },
  alvo: (e) => ({ tabela: TABELA_PLANO_SANEAMENTO, id: e.id }),
  trilha: (e) => ({ ...extrasTrilha(e), ...(e.resultado === 'falhou' ? { motivo: e.erro } : {}) }),
});

// ── operações da aplicação ────────────────────────────────────────────────────────────────────────

const esquemaLogin = z.string().trim().min(1).max(60);

/** Troca do perfil amplo pelo de trabalho no estabelecimento: encerra a vigência do amplo e abre a do destino. */
export const opTrocarPerfil = definirOperacao({
  nome: OPERACOES_SANEAMENTO.trocarGrupo,
  tabelas: ['usuario_perfil'],
  critica: true,
  entrada: z
    .object({
      estabelecimento: z.number().int().positive(),
      login: esquemaLogin,
      grupoOrigem: z.string().trim().min(1).max(60),
      grupo: z.string().trim().min(1).max(60),
    })
    .strict(),
  async gravar(tx, e, ctx) {
    const u = await tx.uma<Linha>('SELECT id FROM usuario WHERE login = ? AND excluido_em IS NULL', [
      e.login,
    ]);
    if (!u) throw recusa('usuario-inexistente', 'A conta não existe.');
    const usuario = Number(u['id']);
    // A origem é o grupo inteiro: o perfil do estabelecimento e o da rede com o mesmo código.
    const origem = await idsDoCodigo(tx, e.estabelecimento, e.grupoOrigem);
    const destino = await perfilPorCodigo(tx, e.estabelecimento, e.grupo);
    if (!destino || !destino.ativo || destino.codigo === e.grupoOrigem)
      throw recusa('destino-invalido', 'Escolha um perfil de trabalho ativo e diferente do atual.');
    const vigentes =
      origem.length > 0
        ? await tx.consultarParaAtualizar<Linha>(
            `SELECT up.id, up.versao, up.vigencia_inicio < UTC_DATE() AS antes
               FROM usuario_perfil up
              WHERE up.usuario_id = ? AND up.perfil_acesso_id IN (${marcadores(origem.length)})
                AND up.estabelecimento_id = ? AND ${VIGENTE_UP}`,
            [usuario, ...origem, e.estabelecimento],
            { teto: 100 },
          )
        : [];
    if (vigentes.length === 0)
      throw recusa('usuario-fora-do-grupo', 'A conta já não tem o perfil de origem neste estabelecimento.');
    const agora = Date.now();
    for (const v of vigentes)
      await tx.alterar(
        'usuario_perfil',
        Number(v['id']),
        Number(v['versao']),
        // Começou antes de hoje: a vigência termina ontem. Começou hoje: a atribuição é desfeita (exclusão lógica).
        bool(v['antes'])
          ? { vigencia_fim: diaUtc(agora, -1) }
          : { excluido_em: new Date(agora), excluido_por: ctx.usuario },
      );
    const ja = await tx.uma<Linha>(
      `SELECT up.id FROM usuario_perfil up
        WHERE up.usuario_id = ? AND up.perfil_acesso_id = ? AND up.estabelecimento_id = ? AND ${VIGENTE_UP}`,
      [usuario, destino.id, e.estabelecimento],
    );
    const id = ja
      ? Number(ja['id'])
      : await tx.incluir('usuario_perfil', {
          usuario_id: usuario,
          perfil_acesso_id: destino.id,
          estabelecimento_id: e.estabelecimento,
          vigencia_inicio: diaUtc(agora),
          provisorio: false,
          motivo: 'Saneamento dos perfis de acesso amplo',
        });
    return { usuario, encerrados: vigentes.length, atribuicao: id };
  },
  alvo: (_e, r) => ({ tabela: 'usuario_perfil', id: r.atribuicao }),
});

/** Bloqueio da conta (vale em toda a rede: a conta é do cliente), com a linha do tempo da situação. */
export const opBloquearUsuario = definirOperacao({
  nome: OPERACOES_SANEAMENTO.bloquear,
  tabelas: ['usuario', 'usuario_situacao_historico'],
  critica: true,
  entrada: z
    .object({
      estabelecimento: z.number().int().positive(),
      login: esquemaLogin,
      motivo: z.string().trim().min(1).max(500),
    })
    .strict(),
  async gravar(tx, e, ctx) {
    const [u] = await tx.consultarParaAtualizar<Linha>(
      'SELECT id, versao, situacao FROM usuario WHERE login = ? AND excluido_em IS NULL',
      [e.login],
      { teto: 1 },
    );
    if (!u) throw recusa('usuario-inexistente', 'A conta não existe.');
    const anterior = texto(u['situacao']);
    if (anterior === 'bloqueado') throw recusa('ja-bloqueado', 'A conta já está bloqueada.');
    const usuario = Number(u['id']);
    const fora = await tx.uma<Linha>(
      `SELECT COUNT(*) AS n FROM usuario_perfil o
        WHERE o.usuario_id = ? AND o.estabelecimento_id <> ? AND o.excluido_em IS NULL
          AND o.vigencia_inicio <= UTC_DATE() AND (o.vigencia_fim IS NULL OR o.vigencia_fim >= UTC_DATE())`,
      [usuario, e.estabelecimento],
    );
    if (numero(fora?.['n']) > 0)
      throw recusa(
        'conta-em-outro-estabelecimento',
        'A conta tem perfil vigente em outro estabelecimento: o bloqueio vale na rede toda; troque o perfil aqui.',
      );
    const agora = new Date();
    await tx.alterar('usuario', usuario, Number(u['versao']), { situacao: 'bloqueado', bloqueado_em: agora });
    await tx.incluir('usuario_situacao_historico', {
      usuario_id: usuario,
      operacao: 'alteracao',
      situacao_anterior: anterior,
      situacao_nova: 'bloqueado',
      evento: 'bloqueio',
      motivo: e.motivo,
      ocorrido_em: agora,
      responsavel_usuario_id: ctx.usuario,
    });
    return { usuario };
  },
  alvo: (_e, r) => ({ tabela: 'usuario', id: r.usuario }),
});

/** Retirada de um lote de ações de um perfil (exclusão lógica do perfil_acao). */
export const opRetirarAcoes = definirOperacao({
  nome: OPERACOES_SANEAMENTO.retirarOpcoes,
  tabelas: ['perfil_acao'],
  critica: true,
  entrada: z
    .object({
      estabelecimento: z.number().int().positive(),
      grupo: z.string().trim().min(1).max(60),
      opcoes: z.array(z.number().int().positive()).min(1).max(LOTE_OPCOES_DISSOLUCAO),
    })
    .strict(),
  async gravar(tx, e, ctx) {
    const perfil = await perfilPorCodigo(tx, e.estabelecimento, e.grupo);
    if (!perfil) throw recusa('perfil-inexistente', 'O perfil não existe neste estabelecimento.');
    if (perfil.estabelecimento === null) {
      const outros = await tx.uma<Linha>(
        `SELECT COUNT(*) AS n FROM usuario_perfil up
          WHERE up.perfil_acesso_id = ? AND up.estabelecimento_id <> ? AND ${VIGENTE_UP}`,
        [perfil.id, e.estabelecimento],
      );
      if (numero(outros?.['n']) > 0)
        throw recusa(
          'perfil-em-uso-em-outro-estabelecimento',
          'O perfil é da rede e ainda tem contas em outro estabelecimento: retire as ações pela gestão de perfis.',
        );
    }
    const n = await tx.executar(
      `UPDATE perfil_acao SET excluido_em = UTC_TIMESTAMP(3), excluido_por = ?, ${MARCA_ALTERACAO}
        WHERE perfil_acesso_id = ? AND excluido_em IS NULL AND acao_sistema_id IN (${marcadores(e.opcoes.length)})`,
      [ctx.usuario, ctx.usuario, perfil.id, ...e.opcoes],
    );
    return { perfil: perfil.id, retiradas: n };
  },
  alvo: (_e, r) => ({ tabela: 'perfil_acesso', id: r.perfil }),
});

// ── contexto da gravação ──────────────────────────────────────────────────────────────────────────

interface Ator {
  readonly hospital: string;
  readonly login: string;
  readonly correlacao: string;
}

class Gravador {
  private executorCache: Executor | null = null;
  constructor(
    protected readonly nucleo: NucleoSaneamento,
    protected readonly cliente: string,
  ) {}

  protected executor(): Executor {
    this.executorCache ??= this.nucleo.criarExecutor();
    return this.executorCache;
  }

  protected ler<T>(hospital: string, fn: (l: Leitor) => Promise<T>): Promise<T> {
    return this.nucleo.lerSomente(
      { cliente: this.cliente, correlacao: `acesso-saneamento-${hospital}`.slice(0, 64) },
      fn,
    );
  }

  /** O contexto do executor: estabelecimento e usuário por id (lidos pelo código e pelo login da sessão). */
  protected async contexto(
    a: Ator,
    chave: string,
    reautenticadoEm?: number,
  ): Promise<ContextoOperacao & { readonly estabelecimento: number }> {
    const ids = await this.ler(a.hospital, async (l) => ({
      est: await idEstabelecimento(l, a.hospital),
      usu: await l.uma<Linha>('SELECT id FROM usuario WHERE login = ? AND excluido_em IS NULL', [a.login]),
    }));
    if (ids.est === null)
      throw recusa('estabelecimento-desconhecido', 'O estabelecimento não existe neste cliente.');
    if (!ids.usu) throw recusa('usuario-desconhecido', 'A conta de quem opera não existe neste cliente.');
    return {
      cliente: this.cliente,
      estabelecimento: ids.est,
      usuario: Number(ids.usu['id']),
      correlacao: a.correlacao.slice(0, 64) || 'acesso-saneamento',
      chaveIdempotencia: chave,
      ...(reautenticadoEm !== undefined ? { reautenticadoEm } : {}),
    };
  }
}

/** As operações da aplicação do saneamento pelo executor do núcleo (a liberação é conferida na execução). */
export class ExecutorSaneamentoProprio extends Gravador implements ExecutorSaneamento {
  receita(): { readonly ligada: boolean; readonly motivo: string | null } {
    return { ligada: true, motivo: null };
  }

  async executar(
    nome: string,
    hospital: string,
    entrada: unknown,
    c: ContextoExecucaoSaneamento,
  ): Promise<void> {
    const op =
      nome === OPERACOES_SANEAMENTO.trocarGrupo
        ? opTrocarPerfil
        : nome === OPERACOES_SANEAMENTO.bloquear
          ? opBloquearUsuario
          : nome === OPERACOES_SANEAMENTO.retirarOpcoes
            ? opRetirarAcoes
            : null;
    if (!op)
      throw new ErroOperacao(400, 'operacao-desconhecida', 'Operação desconhecida', 'Operação desconhecida.');
    const ctx = await this.contexto(
      { hospital, login: c.login, correlacao: c.correlacao },
      c.chaveIdempotencia,
      c.reautenticadoEm,
    );
    const corpo = { ...(entrada as Record<string, unknown>), estabelecimento: ctx.estabelecimento };
    await this.executor().executar(op as typeof opRetirarAcoes, this.cliente, corpo, ctx);
  }
}

export class PortaSaneamentoPropria extends Gravador implements PortaSaneamento {
  readonly destino = 'banco' as const;

  private comEstabelecimento<T>(
    hospital: string,
    vazio: T,
    fn: (l: Leitor, est: number) => Promise<T>,
  ): Promise<T> {
    return this.ler(hospital, async (l) => {
      const est = await idEstabelecimento(l, hospital);
      return est === null ? vazio : fn(l, est);
    });
  }

  pronto(hospital: string): Promise<boolean> {
    return this.ler(hospital, async (l) => {
      const r = await l.uma<Linha>(
        `SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
        [TABELA_PLANO_SANEAMENTO],
      );
      return numero(r?.['n']) === 1 && (await idEstabelecimento(l, hospital)) !== null;
    });
  }

  grupos(hospital: string, nomes: readonly string[]): Promise<SituacaoGrupo[]> {
    const vazio = nomes.map((grupo) => ({
      grupo,
      existe: false,
      ativo: false,
      usuarios: 0,
      ativos: 0,
      opcoes: 0,
    }));
    return this.comEstabelecimento(hospital, vazio, async (l, est) => {
      const perfis = await perfisDoEstabelecimento(l, est);
      const ids = nomes.map((n) => perfis.get(n)?.id).filter((x): x is number => x !== undefined);
      const contas = new Map<string, Linha>();
      const acoes = new Map<number, number>();
      if (ids.length > 0) {
        // Contas pelo código (o perfil do estabelecimento e o da rede com o mesmo código), cada conta uma vez.
        const codigos = nomes.filter((n) => perfis.has(n));
        for (const x of await l.consultar<Linha>(
          `SELECT p.codigo, COUNT(DISTINCT u.id) AS usuarios,
                  COUNT(DISTINCT CASE WHEN ${CONTA_ATIVA} THEN u.id END) AS ativos
             FROM usuario_perfil up
             JOIN perfil_acesso p ON p.id = up.perfil_acesso_id AND p.excluido_em IS NULL
                                 AND (p.estabelecimento_id = ? OR p.estabelecimento_id IS NULL)
             JOIN usuario u ON u.id = up.usuario_id AND u.excluido_em IS NULL
            WHERE up.estabelecimento_id = ? AND ${VIGENTE_UP} AND p.codigo IN (${marcadores(codigos.length)})
            GROUP BY p.codigo`,
          [est, est, ...codigos],
          { teto: codigos.length * 2 },
        ))
          contas.set(texto(x['codigo']), x);
        for (const x of await l.consultar<Linha>(
          `SELECT perfil_acesso_id AS perfil, COUNT(*) AS n FROM perfil_acao
            WHERE excluido_em IS NULL AND permitido AND perfil_acesso_id IN (${marcadores(ids.length)})
            GROUP BY perfil_acesso_id`,
          ids,
          { teto: ids.length },
        ))
          acoes.set(Number(x['perfil']), numero(x['n']));
      }
      return nomes.map((grupo) => {
        const p = perfis.get(grupo);
        if (!p) return { grupo, existe: false, ativo: false, usuarios: 0, ativos: 0, opcoes: 0 };
        const c = contas.get(grupo);
        return {
          grupo,
          existe: true,
          ativo: p.ativo,
          usuarios: numero(c?.['usuarios']),
          ativos: numero(c?.['ativos']),
          opcoes: acoes.get(p.id) ?? 0,
        };
      });
    });
  }

  private conta(x: Linha, grupo: string | null): UsuarioDoGrupo {
    const situacao = texto(x['situacao']);
    const expirada = bool(x['expirada']);
    return {
      login: texto(x['login']),
      idUsuario: Number(x['id']),
      nome: textoOuNulo(x['nome']),
      grupo,
      ativo: situacao !== 'inativo' && !expirada,
      bloqueado: situacao === 'bloqueado',
      ultimoAcesso: textoOuNulo(x['ultimo']),
      emOutroEstabelecimento: bool(x['em_outro']),
    };
  }

  private static readonly COLUNAS_CONTA = `u.id, u.login, u.nome, u.situacao,
    (u.expira_em IS NOT NULL AND u.expira_em <= UTC_TIMESTAMP(3)) AS expirada,
    DATE_FORMAT(u.ultimo_acesso_em, '%Y-%m-%d') AS ultimo, ${EM_OUTRO_ESTABELECIMENTO} AS em_outro`;

  usuarios(hospital: string, grupo: string): Promise<UsuarioDoGrupo[]> {
    return this.comEstabelecimento(hospital, [] as UsuarioDoGrupo[], async (l, est) => {
      const ids = await idsDoCodigo(l, est, grupo);
      if (ids.length === 0) return [];
      const linhas = await l.consultar<Linha>(
        `SELECT DISTINCT ${PortaSaneamentoPropria.COLUNAS_CONTA}
           FROM usuario_perfil up JOIN usuario u ON u.id = up.usuario_id AND u.excluido_em IS NULL
          WHERE up.estabelecimento_id = ? AND up.perfil_acesso_id IN (${marcadores(ids.length)}) AND ${VIGENTE_UP}`,
        [est, est, ...ids],
        { teto: 50_000 },
      );
      const inativo = (u: UsuarioDoGrupo) => !u.ativo || u.bloqueado;
      return linhas
        .map((x) => this.conta(x, grupo))
        .sort((a, b) => Number(inativo(a)) - Number(inativo(b)) || a.login.localeCompare(b.login));
    });
  }

  usuario(hospital: string, login: string): Promise<UsuarioDoGrupo | null> {
    return this.comEstabelecimento(hospital, null as UsuarioDoGrupo | null, async (l, est) => {
      const u = await l.uma<Linha>(
        `SELECT ${PortaSaneamentoPropria.COLUNAS_CONTA} FROM usuario u WHERE u.login = ? AND u.excluido_em IS NULL`,
        [est, login],
      );
      if (!u) return null;
      const perfis = await l.consultar<Linha>(
        `SELECT DISTINCT p.codigo
           FROM usuario_perfil up JOIN perfil_acesso p ON p.id = up.perfil_acesso_id AND p.excluido_em IS NULL
          WHERE up.usuario_id = ? AND up.estabelecimento_id = ? AND ${VIGENTE_UP}
          ORDER BY p.codigo`,
        [Number(u['id']), est],
        { teto: 1_000 },
      );
      return this.conta(u, grupoPrincipal(perfis.map((x) => texto(x['codigo']))));
    });
  }

  gruposComOpcoes(hospital: string): Promise<GrupoComOpcoes[]> {
    return this.comEstabelecimento(hospital, [] as GrupoComOpcoes[], async (l, est) => {
      const perfis = await perfisDoEstabelecimento(l, est);
      const pares = await l.consultar<Linha>(
        `SELECT pa.perfil_acesso_id AS perfil, pa.acao_sistema_id AS acao
           FROM perfil_acao pa JOIN perfil_acesso p ON p.id = pa.perfil_acesso_id AND p.excluido_em IS NULL
          WHERE pa.excluido_em IS NULL AND pa.permitido
            AND (p.estabelecimento_id = ? OR p.estabelecimento_id IS NULL)
          ORDER BY pa.perfil_acesso_id, pa.acao_sistema_id`,
        [est],
        { teto: 500_000, tempoMaximoMs: 60_000 },
      );
      const por = new Map<number, number[]>();
      for (const x of pares) {
        const id = Number(x['perfil']);
        const lista = por.get(id) ?? [];
        lista.push(Number(x['acao']));
        por.set(id, lista);
      }
      return [...perfis.values()].map((p) => ({
        grupo: p.codigo,
        ativo: p.ativo,
        opcoes: por.get(p.id) ?? [],
      }));
    });
  }

  /** Descrições das ações (o catálogo é do cliente inteiro: sem filtro de estabelecimento). */
  titulos(hospital: string, ids: readonly number[]): Promise<Map<number, string>> {
    const unicos = [...new Set(ids)].filter((x) => Number.isSafeInteger(x) && x > 0);
    return this.ler(hospital, async (l) => {
      const r = new Map<number, string>();
      for (let i = 0; i < unicos.length; i += 500) {
        const lote = unicos.slice(i, i + 500);
        for (const x of await l.consultar<Linha>(
          `SELECT id, descricao FROM acao_sistema WHERE id IN (${marcadores(lote.length)})`,
          lote,
          { teto: lote.length },
        ))
          r.set(Number(x['id']), texto(x['descricao']).trim());
      }
      return r;
    });
  }

  /**
   * Uso das ações do grupo na janela: soma da contagem diária (uso_acao_usuario) das contas ativas com o grupo. Sem a
   * tabela, lança USO_INDISPONIVEL (503): o serviço trata como uso não lido (falha fechada), nunca como "não usou".
   */
  uso(hospital: string, grupo: string, desde: Date): Promise<Map<string, Map<number, number>>> {
    return this.ler(hospital, async (l) => {
      if (!(await tabelaExiste(l, TABELA_USO_ACOES)))
        throw new ErroOperacao(
          503,
          USO_INDISPONIVEL,
          'Uso indisponível',
          'O registro do uso das ações ainda não está instalado: a perda de ação exige a aprovação da área.',
        );
      const est = await idEstabelecimento(l, hospital);
      if (est === null)
        throw recusa('estabelecimento-desconhecido', 'O estabelecimento não existe neste cliente.');
      // A contagem tem de cobrir a janela inteira: começou depois do início dela (ou nem começou), o uso não é sabido.
      const inicio = await l.uma<Linha>(
        "SELECT DATE_FORMAT(MIN(dia), '%Y-%m-%d') AS inicio FROM uso_acao_usuario WHERE estabelecimento_id = ?",
        [est],
      );
      const desdeDia = diaUtc(desde.getTime());
      const comecou = textoOuNulo(inicio?.['inicio']);
      if (comecou === null || comecou > desdeDia)
        throw new ErroOperacao(
          503,
          USO_INDISPONIVEL,
          'Uso indisponível',
          'A contagem do uso das ações ainda não cobre a janela: a perda de ação exige a aprovação da área.',
        );
      const ids = await idsDoCodigo(l, est, grupo);
      const r = new Map<string, Map<number, number>>();
      if (ids.length === 0) return r;
      const linhas = await l.consultar<Linha>(
        `SELECT u.login, x.acao_sistema_id AS acao, SUM(x.quantidade) AS n
           FROM uso_acao_usuario x
           JOIN usuario u ON u.id = x.usuario_id AND u.excluido_em IS NULL
          WHERE x.estabelecimento_id = ? AND x.dia >= ?
            AND x.usuario_id IN (SELECT up.usuario_id FROM usuario_perfil up
                                  WHERE up.estabelecimento_id = ? AND up.perfil_acesso_id IN (${marcadores(ids.length)})
                                    AND ${VIGENTE_UP})
            AND ${CONTA_ATIVA}
          GROUP BY u.login, x.acao_sistema_id`,
        [est, desdeDia, est, ...ids],
        { teto: 500_000, tempoMaximoMs: 180_000 },
      );
      for (const x of linhas) {
        const login = texto(x['login']);
        const m = r.get(login) ?? new Map<number, number>();
        m.set(Number(x['acao']), numero(x['n']));
        r.set(login, m);
      }
      return r;
    });
  }

  plano(hospital: string, grupo?: string): Promise<ItemSaneamento[]> {
    return this.comEstabelecimento(hospital, [] as ItemSaneamento[], async (l, est) => {
      const linhas = await l.consultar<Linha>(
        `SELECT ${COLUNAS_ITEM}
          WHERE s.estabelecimento_id = ? AND s.excluido_em IS NULL${grupo ? ' AND po.codigo = ?' : ''}
          ORDER BY s.id DESC LIMIT 5000`,
        grupo ? [est, grupo] : [est],
        { teto: 5_000 },
      );
      return linhas.map(itemDaLinha);
    });
  }

  item(hospital: string, id: string): Promise<ItemSaneamento | null> {
    if (!/^\d{1,18}$/.test(id)) return Promise.resolve(null);
    return this.comEstabelecimento(hospital, null as ItemSaneamento | null, async (l, est) => {
      const x = await l.uma<Linha>(
        `SELECT ${COLUNAS_ITEM} WHERE s.estabelecimento_id = ? AND s.id = ? AND s.excluido_em IS NULL`,
        [est, Number(id)],
      );
      return x ? itemDaLinha(x) : null;
    });
  }

  private async gravar<E extends Record<string, unknown>>(
    hospital: string,
    op: typeof opDescartar | typeof opReservar | typeof opAprovar | typeof opConcluir | typeof opIncluir,
    entrada: E,
    t: TrilhaSaneamento,
  ): Promise<{ id: number } | null> {
    const estado = await this.estadoDoAlvo(hospital, entrada);
    if (estado === null) return null;
    // Chave determinística: a mesma gravação (operação, quem, conteúdo) sobre o mesmo estado do item (a versão) ou do
    // alvo (a última decisão dele) é a mesma; repetida, o executor devolve o resultado gravado em vez de gravar de novo.
    const chave = `san.${createHash('sha256')
      .update(JSON.stringify([op.nome, hospital, t.usuario, estado, entrada]))
      .digest('hex')
      .slice(0, 40)}`;
    const ctx = await this.contexto({ hospital, login: t.usuario, correlacao: t.correlacao }, chave);
    try {
      const r = await this.executor().executar(
        op as typeof opDescartar,
        this.cliente,
        {
          ...entrada,
          estabelecimento: ctx.estabelecimento,
          evento: t.evento,
          recurso: t.recurso,
          estacao: t.estacao?.slice(0, 80) ?? null,
        },
        ctx,
      );
      return { id: Number(r.resultado['id']) };
    } catch (e) {
      if (e instanceof ErroOperacao && e.problema.codigo === SEM_MUDANCA) return null;
      throw e;
    }
  }

  /**
   * Estado do alvo para a chave: a versão do item (null: o item não existe no estabelecimento) ou, na inclusão, a
   * última decisão do mesmo alvo (conta, ou perfil na dissolução).
   */
  private estadoDoAlvo(hospital: string, entrada: Record<string, unknown>): Promise<string | null> {
    return this.ler(hospital, async (l) => {
      const est = await idEstabelecimento(l, hospital);
      if (est === null) return null;
      if (typeof entrada['id'] === 'number') {
        const r = await l.uma<Linha>(
          `SELECT versao, DATE_FORMAT(criado_em, '%Y%m%d%H%i%s%f') AS criado
             FROM saneamento_acesso_item WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
          [entrada['id'], est],
        );
        // A versão e o instante da criação: o mesmo id numa tabela recriada nunca repete a chave de outro item.
        return r ? `v${numero(r['versao'])}.${texto(r['criado'])}` : null;
      }
      const alvoConta = typeof entrada['idUsuario'] === 'number';
      const r = await l.uma<Linha>(
        `SELECT COALESCE(MAX(s.id), 0) AS ultimo FROM saneamento_acesso_item s
          WHERE s.estabelecimento_id = ? AND ${
            alvoConta
              ? 's.usuario_id = ?'
              : 's.usuario_id IS NULL AND s.perfil_origem_id IN (SELECT p.id FROM perfil_acesso p WHERE p.codigo = ?)'
          }`,
        [est, alvoConta ? entrada['idUsuario'] : entrada['grupoOrigem']],
      );
      return `u${numero(r?.['ultimo'])}`;
    });
  }

  async incluir(hospital: string, n: DecisaoSaneamentoNova, t: TrilhaSaneamento): Promise<{ id: string }> {
    const r = await this.gravar(
      hospital,
      opIncluir,
      {
        grupoOrigem: n.grupoOrigem,
        grupoDestino: n.grupoDestino,
        idUsuario: n.idUsuario,
        decisao: n.decisao,
        perdasTotal: n.perdasTotal,
        perdasUsadas: n.perdasUsadas,
        exigeAprovacao: n.exigeAprovacao,
        motivo: n.motivo.slice(0, 200),
      },
      t,
    );
    if (!r) throw recusa('situacao-nao-permite', 'A decisão não foi incluída.');
    return { id: String(r.id) };
  }

  private idItem(id: string): number | null {
    return /^\d{1,15}$/.test(id) && Number(id) > 0 ? Number(id) : null;
  }

  async aprovar(
    hospital: string,
    a: { id: string; area: string; aprovadoPor: string; motivo: string },
    t: TrilhaSaneamento,
  ): Promise<boolean> {
    const id = this.idItem(a.id);
    if (id === null) return false;
    const r = await this.gravar(
      hospital,
      opAprovar,
      { id, area: a.area.slice(0, 60), motivo: a.motivo.slice(0, 200) },
      {
        ...t,
        usuario: a.aprovadoPor,
      },
    );
    return r !== null;
  }

  async descartar(hospital: string, d: { id: string; por: string }, t: TrilhaSaneamento): Promise<boolean> {
    const id = this.idItem(d.id);
    if (id === null) return false;
    return (await this.gravar(hospital, opDescartar, { id }, { ...t, usuario: d.por })) !== null;
  }

  async reservar(hospital: string, r: { id: string; por: string }, t: TrilhaSaneamento): Promise<boolean> {
    const id = this.idItem(r.id);
    if (id === null) return false;
    return (await this.gravar(hospital, opReservar, { id }, { ...t, usuario: r.por })) !== null;
  }

  async concluir(
    hospital: string,
    c: { id: string; por: string; resultado: 'aplicado' | 'falhou'; erro: string | null },
    t: TrilhaSaneamento,
  ): Promise<boolean> {
    const id = this.idItem(c.id);
    if (id === null) return false;
    const r = await this.gravar(
      hospital,
      opConcluir,
      { id, resultado: c.resultado, erro: c.erro?.slice(0, 200) ?? null },
      { ...t, usuario: c.por },
    );
    return r !== null;
  }
}
