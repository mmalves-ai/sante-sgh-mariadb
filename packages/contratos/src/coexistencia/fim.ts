// Fim da coexistência por hospital (M43; cap-15 §15.3.3, §15.3.5, §15.4.1, §15.5; cap-14 §14.8.2, §14.9.4; cap-08
// §8.3). Contratos do painel "Fim da coexistência" (aba da tela de migração gradual do M37) e do registro versionado
// do fim por hospital (`docs/coexistencia/fim/<cod>.yaml`), SEM dado pessoal: contagens, papéis, datas e os logins
// técnicos (contas combinadas e logins de painel de TV, que não são de pessoa).
//
// O critério de acompanhamento é o do cap-15 §15.3.5 (padrão aprovado da DP-5, 2026-10-19); o conjunto do cap-14
// §14.9.4 aparece ao lado para o dono decidir (regra 2). Registrar o fim é do dono; o fim não desliga nada (regra 8).
import { z } from 'zod';
import { RE_TEXTO_SEM_DADO_PESSOAL } from '../homologacao/homologacao.js';

const codigoEstabelecimento = z.string().regex(/^[a-z][a-z0-9]{0,9}$/);
const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'AAAA-MM-DD');
const nomeOperacao = z.string().regex(/^[a-z]+\.[a-z][A-Za-z0-9]+$/);
/** Login do usuário no sistema de origem (texto de até 31 caracteres). */
const login = z
  .string()
  .trim()
  .min(1)
  .max(31)
  .regex(/^[^\s@]+$/, 'login sem espaço nem e-mail');
/** Contagem agregada: abaixo de 5 (e acima de 0) vira '<5' (dado agregado nunca reidentifica). */
const contagemAgregada = z.union([z.number().int().nonnegative(), z.literal('<5')]);
export const contagemFim = (n: number): number | '<5' => (n > 0 && n < 5 ? '<5' : n);
const textoCurto = z.string().regex(RE_TEXTO_SEM_DADO_PESSOAL, 'texto sem dado pessoal (até 600 caracteres)');

/** Itens do critério de acompanhamento (cap-15 §15.3.5; DP-5, padrão aprovado em 2026-10-19). Regra 1. */
export const ITENS_FIM_CAP15 = [
  'operacoes-liberadas',
  'usuarios-com-trilha',
  'sem-sessao-14-dias',
  'competencia-pelo-novo',
  'sem-s1-aberto',
] as const;
export type ItemFimCap15 = (typeof ITENS_FIM_CAP15)[number];

/** Itens do conjunto do cap-14 §14.9.4, medidos ao lado (regra 2). */
export const ITENS_FIM_CAP14 = [
  'sem-sessao-30-dias',
  'assinaturas-verdes',
  'contingencia-pronta',
  'aceite-diretoria',
] as const;
export type ItemFimCap14 = (typeof ITENS_FIM_CAP14)[number];

export type ItemFim = ItemFimCap15 | ItemFimCap14;

/** Dias seguidos sem sessão de pessoa no sistema anterior exigidos por cada conjunto (regras 1 e 2). */
export const DIAS_SEM_SESSAO = { cap15: 14, cap14: 30 } as const;

/** Situação de um item: medido e cumprido, medido e não cumprido, ou sem medida (falha fechada: não é verde). */
export const SITUACOES_ITEM_FIM = ['verde', 'pendente', 'sem-medida'] as const;
export type SituacaoItemFim = (typeof SITUACOES_ITEM_FIM)[number];

/** Fonte de cada item (o painel mostra de onde veio o número; a conferência à mão refaz pela mesma fonte). */
export const FONTE_ITEM_FIM: Readonly<Record<ItemFim, string>> = {
  'operacoes-liberadas': 'catálogo de operações (pnpm operacoes:estado), por hospital',
  'usuarios-com-trilha': 'usuários ativos × conclusões de trilha e chaves de acesso (M37)',
  'sem-sessao-14-dias': 'retratos diários das conexões (M37) e série diária de MON$ATTACHMENTS (M09)',
  'competencia-pelo-novo': 'fechamento mensal e lotes TISS da competência, com a trilha do novo (M42)',
  'sem-s1-aberto': 'chamados (M37), severidade S1 em aberto',
  'sem-sessao-30-dias': 'retratos diários das conexões (M37) e série diária de MON$ATTACHMENTS (M09)',
  'assinaturas-verdes':
    'último resultado do teste de assinatura de cada operação de uso real (pnpm assinatura:testar)',
  'contingencia-pronta': 'ensaios de contingência registrados (docs/coexistencia/fim/<cod>.yaml)',
  'aceite-diretoria': 'aceite da diretoria registrado (docs/coexistencia/fim/<cod>.yaml)',
};

/** Ensaios da contingência pós-coexistência (regra 7; cap-14 §14.8.1 e §14.8.2). */
export const ENSAIOS_CONTINGENCIA = [
  'kit-papel',
  'relatorio-por-posto',
  'pwa-offline',
  'queda-do-banco',
] as const;
export type EnsaioContingencia = (typeof ENSAIOS_CONTINGENCIA)[number];

/** Papéis aceitos no registro (nunca o nome da pessoa). */
export const PAPEIS_FIM = [
  'comite-coexistencia',
  'dono-do-projeto',
  'gestor-de-acessos',
  'ti',
  'coordenador-do-projeto',
  'diretoria',
  'responsavel-tecnico',
] as const;
export type PapelFim = (typeof PAPEIS_FIM)[number];

/** Uma parcela de um número agregado (toda conta do painel sai com as parcelas impressas). */
export const esquemaParcelaFim = z
  .object({ rotulo: z.string().min(1), valor: z.number().int().nonnegative() })
  .strict();
export type ParcelaFim = z.infer<typeof esquemaParcelaFim>;

/** Um item do painel de fim: valor, fonte, situação e a data em que ficou verde (critério de aceite). */
export const esquemaItemPainelFim = z
  .object({
    item: z.enum([...ITENS_FIM_CAP15, ...ITENS_FIM_CAP14]),
    conjunto: z.enum(['cap15', 'cap14']),
    situacao: z.enum(SITUACOES_ITEM_FIM),
    /** Valor medido em texto curto (ex.: "512 de 525", "9 dias"); null sem medida. */
    valor: z.string().nullable(),
    parcelas: z.array(esquemaParcelaFim),
    fonte: z.string().min(1),
    /** Primeiro dia da sequência verde atual; null quando não está verde. */
    verdeDesde: data.nullable(),
    /** Por que não está verde (pendente ou sem medida). */
    motivo: z.string().nullable(),
  })
  .strict();
export type ItemPainelFim = z.infer<typeof esquemaItemPainelFim>;

/** Resposta do painel de fim de um hospital. */
export const esquemaPainelFimCoexistencia = z
  .object({
    estabelecimento: codigoEstabelecimento,
    medidoEm: z.string().min(1),
    cap15: z.array(esquemaItemPainelFim),
    cap14: z.array(esquemaItemPainelFim),
    /** Todos os itens do cap-15 verdes e a contingência pronta (regras 1 e 7): o dono pode registrar o fim. */
    fimRegistravel: z.boolean(),
    pendencias: z.array(z.string()),
    /** Fim já registrado (data do registro do dono), ou null. */
    fimRegistradoEm: data.nullable(),
    /** Divergência entre os conjuntos (regra 2): itens verdes num e não no outro, para ESTADO.md › Desvios. */
    divergencias: z.array(z.string()),
  })
  .strict();
export type PainelFimCoexistencia = z.infer<typeof esquemaPainelFimCoexistencia>;

/** Login de painel ou totem substituído por dispositivo com token (regra 4; cap-08 §8.3). */
export const esquemaSubstituicaoPainel = z
  .object({
    login,
    /** Id do dispositivo do novo (SGH_ACESSO_DISPOSITIVO.ID, M19). */
    dispositivo: z.number().int().positive(),
    /** Data em que a TI conferiu, no setor, a TV ou o totem com o token do novo. */
    conferidoEm: data,
    papel: z.enum(PAPEIS_FIM),
  })
  .strict();
export type SubstituicaoPainel = z.infer<typeof esquemaSubstituicaoPainel>;

/**
 * Registro versionado do fim por hospital (`docs/coexistencia/fim/<cod>.yaml`): contas combinadas, ensaios de
 * contingência, substituições de painel, operações que ficam no sistema anterior por decisão, ata do comitê, aceite
 * da diretoria, registro do fim pelo dono e a decisão da DP-6 (ou a data em que será tomada).
 */
export const esquemaRegistroFimCoexistencia = z
  .object({
    formato: z.literal(1),
    estabelecimento: codigoEstabelecimento,
    /** Contas técnicas e de contingência combinadas (ESTADO.md › Autorizações): fora da contagem de sessões. */
    contasCombinadas: z
      .array(z.object({ login, motivo: textoCurto, registradaEm: data }).strict())
      .default([]),
    ensaios: z
      .array(
        z
          .object({
            tipo: z.enum(ENSAIOS_CONTINGENCIA),
            data,
            papeis: z.array(z.enum(PAPEIS_FIM)).min(1),
            resultado: z.enum(['aprovado', 'reprovado']),
            observacao: textoCurto.optional(),
          })
          .strict(),
      )
      .default([]),
    paineis: z.array(esquemaSubstituicaoPainel).default([]),
    /** Operações de uso real que ficam no sistema anterior por decisão (critério de aceite: listadas, com a decisão). */
    excecoesOperacao: z
      .array(z.object({ operacao: nomeOperacao, decisao: textoCurto, decididaEm: data }).strict())
      .default([]),
    /**
     * O ativo sem grupo de login vazio (regra 5): nenhuma operação do Sante age sobre ele (o login vazio não entra nem é
     * endereçável). A decisão do gestor de acessos fica aqui e aparece como exceção na revisão; sem ela, o caso segue
     * pendente e a lista dos sem grupo não fica vazia (falha fechada).
     */
    loginVazio: z
      .object({ decisao: textoCurto, decididaEm: data, papel: z.enum(PAPEIS_FIM) })
      .strict()
      .nullable()
      .default(null),
    ata: z.object({ data, referencia: textoCurto }).strict().nullable().default(null),
    aceiteDiretoria: z
      .object({ data, papel: z.literal('diretoria') })
      .strict()
      .nullable()
      .default(null),
    fimRegistrado: z
      .object({ data, papel: z.literal('dono-do-projeto') })
      .strict()
      .nullable()
      .default(null),
    dp6: z
      .union([
        z.object({ decididaEm: data, decisao: textoCurto }).strict(),
        z.object({ previstaPara: data }).strict(),
      ])
      .nullable()
      .default(null),
  })
  .strict()
  .superRefine((r, ctx) => {
    const vistos = new Set<string>();
    for (const [i, p] of r.paineis.entries()) {
      const k = p.login.toUpperCase();
      if (vistos.has(k))
        ctx.addIssue({ code: 'custom', path: ['paineis', i, 'login'], message: 'login de painel repetido' });
      vistos.add(k);
    }
    if (r.fimRegistrado && !r.ata)
      ctx.addIssue({
        code: 'custom',
        path: ['fimRegistrado'],
        message: 'o fim registrado exige a ata do comitê',
      });
  });
export type RegistroFimCoexistencia = z.infer<typeof esquemaRegistroFimCoexistencia>;

export const caminhoRegistroFim = (estabelecimento: string): string =>
  `docs/coexistencia/fim/${estabelecimento}.yaml`;

/**
 * Permissões usadas pelo M43 (nenhuma nova; ficha, campo 7): o painel de fim é aba da tela do M37 e lê com a
 * permissão dela; a revisão dos usuários sem grupo e dos logins de painel usa as do M10; os dispositivos, as do M19.
 */
export const PERMISSOES_M43 = {
  painelFimLer: 'config.coexistencia.ler',
  usuarioLer: 'acesso.usuario.ler',
  usuarioEditar: 'acesso.usuario.editar',
  usuarioBloquear: 'acesso.usuario.bloquear',
  opcaoConceder: 'acesso.opcao.conceder',
  dispositivoLer: 'recepcao.dispositivo.ler',
  dispositivoEditar: 'recepcao.dispositivo.editar',
} as const;

/** Grupos especiais de usuários do sistema de origem: usuário sem grupo e logins de TV (regras 4 e 5). */
export const GRUPO_SEM_GRUPO = 'SEM GRUPO';
export const GRUPO_PAINEIS = 'PAINEIS';

// ── Respostas da API do M43 (aba "Fim da coexistência" e a revisão dos sem grupo e dos logins de painel) ──────────

/** GET /api/administracao/coexistencia/migracao/fim: o painel e o que o registro versionado do hospital diz. */
export const esquemaTelaFimCoexistencia = z
  .object({
    painel: esquemaPainelFimCoexistencia,
    /**
     * Operações de uso real fora de `liberada`, em agregados por estado e por módulo (o comitê vê o que falta; a lista
     * por operação é a do catálogo e a da tela de testes de gravação).
     */
    foraPorEstado: z.array(z.object({ estado: z.string(), n: z.number().int().nonnegative() }).strict()),
    foraPorModulo: z.array(z.object({ modulo: z.string(), n: z.number().int().nonnegative() }).strict()),
    /**
     * Campo 4 ("agregado por papel"): os ativos sem a trilha concluída ou sem o acesso a este sistema, por papel do
     * treinamento; abaixo de 5 (e acima de 0) vira '<5'. Vazio quando os usuários não se mediram.
     */
    usuariosPorPapel: z.array(
      z
        .object({
          papel: z.string(),
          ativos: contagemAgregada,
          semTrilha: contagemAgregada,
          semAcesso: contagemAgregada,
        })
        .strict(),
    ),
    /** Operações que ficam no outro sistema por decisão (listadas, com a decisão; critério de aceite). */
    excecoes: z.array(z.object({ operacao: z.string(), decisao: z.string(), decididaEm: data }).strict()),
    /** Os ensaios da contingência pós-coexistência, o último de cada tipo (regra 7). */
    ensaios: z.array(
      z
        .object({
          tipo: z.enum(ENSAIOS_CONTINGENCIA),
          data: data.nullable(),
          resultado: z.enum(['aprovado', 'reprovado']).nullable(),
        })
        .strict(),
    ),
    contasCombinadas: z.number().int().nonnegative(),
    ata: z.object({ data, referencia: z.string() }).strict().nullable(),
    aceiteDiretoria: data.nullable(),
    dp6: z
      .object({ decididaEm: data.nullable(), previstaPara: data.nullable(), decisao: z.string().nullable() })
      .strict(),
    /** Regra 9: setores depois da meta da onda, ainda no outro sistema, com a nova data proposta (o dono revê). */
    setoresAtrasados: z.array(
      z
        .object({
          codigo: z.string(),
          nome: z.string(),
          onda: z.number().int(),
          situacao: z.string(),
          meta: data,
          novaData: data,
        })
        .strict(),
    ),
    /** Onde o registro do fim fica (para o comitê): o caminho versionado, sem dado pessoal. */
    registro: z.string(),
    /** O registro versionado do hospital não existe ou está fora do esquema (falha fechada: nada conta como feito). */
    registroInvalido: z.string().nullable(),
  })
  .strict();
export type TelaFimCoexistencia = z.infer<typeof esquemaTelaFimCoexistencia>;

export const SITUACOES_LOGIN_PAINEL = [
  'bloqueado',
  'sem-substituicao',
  'dispositivo-invalido',
  'pode-bloquear',
  'bloqueado-sem-substituicao',
] as const;

/**
 * GET /api/administracao/coexistencia/migracao/fim/revisao: os ativos sem grupo (regra 5) e os logins de painel com a
 * situação do aparelho (regra 4), para o gestor de acessos (a leitura por pessoa vai à trilha). As ações são as do M10
 * (troca de grupo e bloqueio) e do M19 (conferir o aparelho).
 */
export const esquemaRevisaoFimCoexistencia = z
  .object({
    estabelecimento: codigoEstabelecimento,
    contagem: z
      .object({
        total: z.number().int().nonnegative(),
        ativos: z.number().int().nonnegative(),
        ativosSemGrupo: z.number().int().nonnegative(),
        ativosGrupoNulo: z.number().int().nonnegative(),
        paineisLivres: z.number().int().nonnegative(),
        paineisBloqueados: z.number().int().nonnegative(),
      })
      .strict(),
    semGrupo: z.array(
      z
        .object({
          login: z.string(),
          grupo: z.string().nullable(),
          loginVazio: z.boolean(),
          /** A exceção registrada no registro do fim (só para o login vazio); com ela, o caso não conta como pendente. */
          excecao: z.object({ decisao: z.string(), decididaEm: data }).strict().nullable(),
        })
        .strict(),
    ),
    parcelas: z
      .object({
        semGrupo: z.number().int().nonnegative(),
        nulo: z.number().int().nonnegative(),
        loginVazio: z.number().int().nonnegative(),
      })
      .strict(),
    /** Grupos de trabalho ativos (o destino da troca: nunca "SEM GRUPO" nem o de painéis). */
    gruposDestino: z.array(z.string()),
    paineis: z.array(
      z
        .object({
          login: z.string(),
          situacao: z.enum(SITUACOES_LOGIN_PAINEL),
          dispositivo: z.number().int().nullable(),
          dispositivoNome: z.string().nullable(),
          conferidoEm: data.nullable(),
        })
        .strict(),
    ),
    /**
     * Critério de aceite: a lista dos sem grupo vazia (nenhum pendente; o login vazio com a exceção registrada não conta)
     * e nenhum login de painel esperando o bloqueio.
     */
    listaVazia: z.boolean(),
    paineisResolvidos: z.boolean(),
  })
  .strict();
export type RevisaoFimCoexistencia = z.infer<typeof esquemaRevisaoFimCoexistencia>;

/** O motivo da recusa do bloqueio de login de painel com TV ou totem ainda no login (regra 4). */
export const CODIGO_LOGIN_PAINEL_EM_USO = 'login-de-painel-em-uso';

/** Regra 4 em falha fechada: a ficha, os aparelhos ou o relógio do banco não se leram; o bloqueio do login espera. */
export const CODIGO_CONFERENCIA_PAINEL_INDISPONIVEL = 'conferencia-de-painel-indisponivel';
