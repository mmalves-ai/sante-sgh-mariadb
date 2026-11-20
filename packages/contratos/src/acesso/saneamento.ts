// Contratos do M59-F4 (saneamento dos grupos genéricos; ficha do M59, seções 5, 7 e 8, regra 8; cap-08 §8.7, §8.15):
// os grupos de acesso amplo (MASTER, MASTER_SEM_FINANCEIRO, MASTER_CONSULTA_FINANCEIRO e SEM GRUPO) são dissolvidos
// em perfis de função: cada usuário ativo passa a um grupo de trabalho (o perfil de função vem do grupo, pelo mapa dos
// grupos do M06), fica como administrador (só no MASTER, até o máximo configurado no estabelecimento) ou é bloqueado
// (sem entrar há mais de 180 dias, por decisão do gestor de acessos). O simulador mostra, por usuário, o antes e o
// depois; quem perderia uma opção usada nos últimos 180 dias só muda com a aprovação do dono da área (outra pessoa).
// Esvaziado o grupo (nenhum usuário ativo), as opções dele são retiradas (dissolução), exceto no MASTER, que fica
// com os administradores configurados. As gravações no banco vão pelas operações do M10 (acesso.trocarGrupoUsuario,
// acesso.bloquearUsuario, acesso.revogarOpcoesGrupo), uma transação por usuário (ou por lote de opções).
import { z } from 'zod';
import { esquemaLogin } from './entrada.js';

/** Os grupos de acesso amplo que o saneamento dissolve (os mesmos da revisão individual do M10). */
export const GRUPOS_GENERICOS = [
  'MASTER',
  'MASTER_SEM_FINANCEIRO',
  'MASTER_CONSULTA_FINANCEIRO',
  'SEM GRUPO',
] as const;
export type GrupoGenerico = (typeof GRUPOS_GENERICOS)[number];

/** O grupo que fica com os administradores configurados (os demais são dissolvidos por inteiro). */
export const GRUPO_ADMINISTRADORES: GrupoGenerico = 'MASTER';

/** Janela do uso das opções (regra 8) e do "sem entrar" do bloqueio (cap-08 §8.7). */
export const DIAS_USO_SANEAMENTO = 180;

/** Parâmetro do estabelecimento: quantos administradores (usuários ativos do MASTER) ficam depois do saneamento. */
export const PARAMETRO_ADMINISTRADORES_MAXIMO = 'acesso.saneamento.administradoresMaximo';

/** Itens de cada lista do simulador (ganhas e perdidas). */
export const LISTA_SIMULACAO = 300;

/** Opções retiradas por transação na dissolução (a receita do M10 recebe a lista; teto de cada chamada). */
export const LOTE_OPCOES_DISSOLUCAO = 200;

/**
 * Validade da reserva de um item para a aplicação (APLICADO_POR e APLICADO_EM com a situação ainda viva): enquanto
 * vale, o item não é descartado, substituído nem aplicado por outro pedido; vencida, o processo que reservou caiu.
 */
export const RESERVA_APLICACAO_MINUTOS = 15;

export const DECISOES_SANEAMENTO = [
  /** Passa a um grupo de trabalho (acesso.trocarGrupoUsuario). */
  'trocar-grupo',
  /** Fica no MASTER como administrador (até o máximo configurado; nada é gravado no banco). */
  'manter-administrador',
  /** Bloqueado: sem entrar há mais de 180 dias (acesso.bloquearUsuario). */
  'bloquear',
  /** Retirada das opções do grupo já vazio (acesso.revogarOpcoesGrupo, em lotes). */
  'dissolver-grupo',
] as const;
export type DecisaoSaneamento = (typeof DECISOES_SANEAMENTO)[number];

export const ROTULOS_DECISAO_SANEAMENTO: Readonly<Record<DecisaoSaneamento, string>> = {
  'trocar-grupo': 'Passar a um grupo de trabalho',
  'manter-administrador': 'Manter como administrador',
  bloquear: 'Bloquear (sem entrar há mais de 180 dias)',
  'dissolver-grupo': 'Retirar as opções do grupo vazio',
};

export const SITUACOES_ITEM_SANEAMENTO = [
  'proposto',
  'aprovado',
  'aplicado',
  'descartado',
  'falhou',
] as const;
export type SituacaoItemSaneamento = (typeof SITUACOES_ITEM_SANEAMENTO)[number];

export const ROTULOS_SITUACAO_SANEAMENTO: Readonly<Record<SituacaoItemSaneamento, string>> = {
  proposto: 'Proposto',
  aprovado: 'Aprovado pela área',
  aplicado: 'Aplicado',
  descartado: 'Descartado',
  falhou: 'Não aplicado (erro)',
};

const esquemaNomeGrupo = z.string().trim().min(1).max(60);
const esquemaMotivo = z.string().trim().min(5, 'Explique o motivo (5 caracteres ou mais).').max(200);
const esquemaDia = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Uma opção do legado com o título e quantas vezes o usuário a usou na janela. */
export const esquemaOpcaoSaneamento = z.object({
  id: z.number().int(),
  titulo: z.string(),
  usos: z.number().int().nonnegative(),
});
export type OpcaoSaneamento = z.infer<typeof esquemaOpcaoSaneamento>;

/** Um grupo genérico com a situação do saneamento. */
export const esquemaGrupoSaneamento = z.object({
  grupo: z.string(),
  existe: z.boolean(),
  ativo: z.boolean(),
  usuarios: z.number().int().nonnegative(),
  ativos: z.number().int().nonnegative(),
  opcoes: z.number().int().nonnegative(),
  /** Itens do plano por situação (só os vivos: proposto e aprovado; aplicados à parte). */
  propostos: z.number().int().nonnegative(),
  aprovados: z.number().int().nonnegative(),
  aplicados: z.number().int().nonnegative(),
  /** Usuários ativos ainda sem decisão no plano. */
  semDecisao: z.number().int().nonnegative(),
  /** Usuários inativos ou bloqueados que continuam no grupo (saem pela troca de grupo, que não exige estar ativo). */
  inativosNoGrupo: z.number().int().nonnegative(),
  /** Pode retirar as opções (nenhum usuário ativo; nunca o MASTER). */
  dissolvivel: z.boolean(),
});
export type GrupoSaneamento = z.infer<typeof esquemaGrupoSaneamento>;

export const esquemaPainelSaneamento = z.object({
  grupos: z.array(esquemaGrupoSaneamento),
  administradores: z.object({
    maximo: z.number().int().nonnegative(),
    /** Ativos do MASTER marcados para ficar (vivos ou aplicados). */
    mantidos: z.number().int().nonnegative(),
    /** Usuários ativos e não bloqueados que estão hoje no MASTER (lidos do banco, não do plano). */
    ativosNoMaster: z.number().int().nonnegative(),
    /** ativosNoMaster passou do máximo configurado. */
    excedido: z.boolean(),
  }),
  /** Grupos de trabalho que podem ser destino (ativos, não genéricos, com pelo menos uma opção). */
  destinos: z.array(z.object({ grupo: z.string(), opcoes: z.number().int().nonnegative() })),
  janelaDias: z.number().int(),
});
export type PainelSaneamento = z.infer<typeof esquemaPainelSaneamento>;

/** Item do plano de saneamento (SGH_ACESSO_SANEAMENTO). */
export const esquemaItemSaneamento = z.object({
  id: z.string(),
  grupoOrigem: z.string(),
  login: z.string().nullable(),
  idUsuario: z.number().int().nullable(),
  decisao: z.enum(DECISOES_SANEAMENTO),
  grupoDestino: z.string().nullable(),
  perdasTotal: z.number().int().nonnegative(),
  perdasUsadas: z.number().int().nonnegative(),
  exigeAprovacao: z.boolean(),
  situacao: z.enum(SITUACOES_ITEM_SANEAMENTO),
  motivo: z.string(),
  criadoPor: z.string(),
  criadoEm: z.string(),
  aprovacao: z.object({ area: z.string(), por: z.string(), em: z.string(), motivo: z.string() }).nullable(),
  aplicadoEm: z.string().nullable(),
  aplicadoPor: z.string().nullable(),
  erro: z.string().nullable(),
});
export type ItemSaneamento = z.infer<typeof esquemaItemSaneamento>;

/** Usuário de um grupo genérico, com a última entrada, a sugestão de destino e o item vivo do plano. */
export const esquemaUsuarioSaneamento = z.object({
  login: z.string(),
  idUsuario: z.number().int(),
  nome: z.string().nullable(),
  ativo: z.boolean(),
  bloqueado: z.boolean(),
  ultimoAcesso: esquemaDia.nullable(),
  /** Dias desde a última entrada (null: nunca entrou). */
  diasSemAcesso: z.number().int().nullable(),
  sugestao: z.object({ grupo: z.string(), cobertas: z.number().int(), usadas: z.number().int() }).nullable(),
  item: esquemaItemSaneamento.nullable(),
});
export type UsuarioSaneamento = z.infer<typeof esquemaUsuarioSaneamento>;

export const esquemaUsuariosSaneamento = z.object({
  grupo: z.string(),
  /** O uso das opções foi lido (falso: a leitura da trilha não respondeu a tempo; sugestão indisponível). */
  usoLido: z.boolean(),
  usuarios: z.array(esquemaUsuarioSaneamento),
});
export type UsuariosSaneamento = z.infer<typeof esquemaUsuariosSaneamento>;

/** O antes e o depois de um usuário (o simulador do saneamento, regra 8). */
export const esquemaSimulacaoSaneamento = z.object({
  login: z.string(),
  grupoOrigem: z.string(),
  grupoDestino: z.string(),
  antes: z.number().int().nonnegative(),
  depois: z.number().int().nonnegative(),
  mantidas: z.number().int().nonnegative(),
  /** As listas vêm com no máximo LISTA_SIMULACAO itens (as perdidas usadas primeiro); os totais dizem quantas são. */
  ganhas: z.array(esquemaOpcaoSaneamento),
  ganhasTotal: z.number().int().nonnegative(),
  perdidas: z.array(esquemaOpcaoSaneamento),
  perdidasTotal: z.number().int().nonnegative(),
  /** Perdidas que o usuário usou na janela: exigem a aprovação do dono da área. */
  perdidasUsadas: z.number().int().nonnegative(),
  exigeAprovacao: z.boolean(),
  usoLido: z.boolean(),
  janelaDias: z.number().int(),
});
export type SimulacaoSaneamento = z.infer<typeof esquemaSimulacaoSaneamento>;

export const esquemaFiltroSimulacaoSaneamento = z
  .object({ login: esquemaLogin, destino: esquemaNomeGrupo })
  .strict();

/** Inclui (ou troca) a decisão de um usuário de um grupo genérico. */
export const esquemaNovoItemSaneamento = z
  .object({
    login: esquemaLogin,
    decisao: z.enum(['trocar-grupo', 'manter-administrador', 'bloquear']),
    grupoDestino: esquemaNomeGrupo.nullable().default(null),
    motivo: esquemaMotivo,
  })
  .strict()
  .refine((x) => (x.decisao === 'trocar-grupo') === (x.grupoDestino !== null), {
    message: 'Informe o grupo de destino só ao passar a um grupo de trabalho.',
    path: ['grupoDestino'],
  });
export type NovoItemSaneamento = z.infer<typeof esquemaNovoItemSaneamento>;

/** Aprovação do dono da área (quem perde opção usada; regra 8). */
export const esquemaAprovarItemSaneamento = z
  .object({ area: z.string().trim().min(2).max(60), motivo: esquemaMotivo })
  .strict();
export type AprovarItemSaneamento = z.infer<typeof esquemaAprovarItemSaneamento>;

/** Descarte: fica quem descartou e quando (a decisão nova, se houver, leva o motivo). */
export const esquemaDescartarItemSaneamento = z.object({}).strict();

/** Dissolução de um grupo vazio (retirada das opções em lotes). */
export const esquemaDissolverGrupo = z.object({ motivo: esquemaMotivo }).strict();

/** Resultado da aplicação de um item (ou da dissolução: lotes aplicados). */
export const esquemaResultadoAplicacaoSaneamento = z.object({
  item: esquemaItemSaneamento,
  operacao: z.string().nullable(),
  lotes: z.number().int().nonnegative(),
});
export type ResultadoAplicacaoSaneamento = z.infer<typeof esquemaResultadoAplicacaoSaneamento>;

/** Códigos de recusa das regras puras (a tela traduz). */
export const RECUSAS_SANEAMENTO = [
  'grupo-nao-generico',
  'usuario-fora-do-grupo',
  'usuario-inativo',
  'a-si-mesmo',
  'destino-invalido',
  'destino-generico',
  'administrador-so-no-master',
  'administradores-no-limite',
  'bloqueio-com-uso-recente',
  'ja-bloqueado',
  'aprovacao-desnecessaria',
  'aprovacao-pelo-proponente',
  'aprovacao-pelo-proprio',
  'situacao-nao-permite',
  'exige-aprovacao',
  'perdas-aumentaram',
  'grupo-com-ativos',
  'master-nao-dissolve',
  'grupo-sem-opcoes',
] as const;
export type RecusaSaneamento = (typeof RECUSAS_SANEAMENTO)[number];
