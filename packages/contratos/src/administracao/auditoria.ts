// Contratos de Administração › Auditoria e privacidade (M10, ficha seções 4, 6 e 7; cap-08 §8.12, §8.13): as
// duas trilhas (a do banco e a própria) em ordem cronológica, com período obrigatório de até 31 dias; o registro
// de acesso ao prontuário; exclusões e conexões; os pedidos do titular (SGH_AUD_PEDIDO_TITULAR) e o backup. Só o
// papel Auditor consulta e exporta a trilha; toda abertura é evento auditado.
import { z } from 'zod';
import { textoCp1252 } from '../texto-cp1252.js';

const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data no formato AAAA-MM-DD.');

export const ORIGENS_TRILHA = ['todas', 'legado', 'novo'] as const;
export type OrigemTrilha = (typeof ORIGENS_TRILHA)[number];

export const TETO_PAGINA_TRILHA = 500;
/**
 * Até onde a consulta pagina (20 páginas de 500 = 10.000 eventos): a junção das duas trilhas é feita em memória.
 * Além disso, a tela pede para refinar o filtro (usuário, evento ou período menor); a exportação leva no máximo
 * esse teto e diz no arquivo quando cortou.
 */
export const PAGINAS_MAXIMAS_TRILHA = 20;
export const TETO_EXPORTACAO_TRILHA = PAGINAS_MAXIMAS_TRILHA * TETO_PAGINA_TRILHA;

export const esquemaConsultaTrilha = z.object({
  inicio: data.optional(),
  fim: data.optional(),
  usuario: z.string().max(31).optional(),
  origem: z.enum(ORIGENS_TRILHA).optional(),
  /** Tipo de ação do banco (TBTPACAOAUDIT.ID). */
  tipo: z.coerce.number().int().min(0).max(999).optional(),
  /** Evento da trilha própria (código do catálogo). */
  evento: z.string().max(80).optional(),
  paciente: z.coerce.number().int().positive().optional(),
  /** Prontuário do paciente (RICADPAC.PRONT): o filtro de quem chega pelo número, não pelo ID interno. */
  prontuario: z.coerce.number().int().positive().max(2_147_483_647).optional(),
  pagina: z.coerce.number().int().min(1).max(10_000).optional(),
});
export type ConsultaTrilha = z.infer<typeof esquemaConsultaTrilha>;

export const esquemaLinhaTrilha = z.object({
  origem: z.enum(['legado', 'novo']),
  id: z.string(),
  dataHora: z.string(),
  usuario: z.string().nullable(),
  acao: z.string(),
  opcao: z.string().nullable(),
  criticidade: z.string().nullable(),
  estacao: z.string().nullable(),
  alvo: z.string().nullable(),
  paciente: z.number().int().nullable(),
  resultado: z.string().nullable(),
  /** Ator real (sessão "como" ou acesso total da plataforma), na trilha própria. */
  atorReal: z.string().nullable(),
});
export type LinhaTrilha = z.infer<typeof esquemaLinhaTrilha>;

export const esquemaPaginaTrilha = z.object({
  itens: z.array(esquemaLinhaTrilha),
  pagina: z.number().int(),
  porPagina: z.number().int(),
  temMais: z.boolean(),
  /** Última página permitida e ainda há eventos no período: a tela pede para refinar o filtro. */
  cortado: z.boolean(),
  periodo: z.object({ inicio: z.string(), fim: z.string(), dias: z.number().int() }),
  tipos: z.array(z.object({ id: z.number().int(), nome: z.string() })),
  tempoMs: z.number().int(),
  destino: z.enum(['banco', 'memoria']),
});
export type PaginaTrilha = z.infer<typeof esquemaPaginaTrilha>;

export const FORMATOS_EXPORTACAO_TRILHA = ['csv', 'xml', 'html'] as const;
export type FormatoExportacaoTrilha = (typeof FORMATOS_EXPORTACAO_TRILHA)[number];

export const esquemaLeituraProntuarioTrilha = z.object({
  dataHora: z.string(),
  usuario: z.string(),
  evento: z.string(),
  paciente: z.number().int().nullable(),
  /** Prontuário do paciente (RICADPAC.PRONT). */
  prontuario: z.number().int().nullable(),
  /** Atendimento (registro) gravado na trilha, quando o evento o leva. */
  atendimento: z.number().int().nullable(),
  estacao: z.string().nullable(),
  atorReal: z.string().nullable(),
});
export const esquemaPaginaAcessosProntuario = z.object({
  itens: z.array(esquemaLeituraProntuarioTrilha),
  pagina: z.number().int(),
  temMais: z.boolean(),
  cortado: z.boolean(),
  periodo: z.object({ inicio: z.string(), fim: z.string(), dias: z.number().int() }),
  destino: z.enum(['banco', 'memoria']),
});
export type PaginaAcessosProntuario = z.infer<typeof esquemaPaginaAcessosProntuario>;

export const esquemaExclusoes = z.object({
  periodo: z.object({ inicio: z.string(), fim: z.string(), dias: z.number().int() }),
  /** Contagem por tipo de registro no período (nunca o conteúdo). */
  tipos: z.array(z.object({ chave: z.string(), rotulo: z.string(), quantidade: z.number().int() })),
  conexoes: z.array(z.object({ modulo: z.number().int(), nome: z.string(), usuarios: z.number().int() })),
  destino: z.enum(['banco', 'memoria']),
});
export type Exclusoes = z.infer<typeof esquemaExclusoes>;

/** Consulta linha a linha de um tipo de exclusão ou das conexões: período obrigatório, usuário, 500 por página. */
export const esquemaConsultaRegistros = z.object({
  inicio: data.optional(),
  fim: data.optional(),
  usuario: z.string().max(31).optional(),
  pagina: z.coerce.number().int().min(1).max(PAGINAS_MAXIMAS_TRILHA).optional(),
});

export const esquemaPaginaExclusoes = z.object({
  chave: z.string(),
  rotulo: z.string(),
  /** A tabela guarda quem fez? (o filtro por usuário só vale quando guarda) */
  comUsuario: z.boolean(),
  itens: z.array(
    z.object({
      dataHora: z.string(),
      usuario: z.string().nullable(),
      /** Só o ID do registro afetado (nenhum outro dado do paciente). */
      registro: z.number().int().nullable(),
      justificativa: z.string().nullable(),
    }),
  ),
  pagina: z.number().int(),
  temMais: z.boolean(),
  cortado: z.boolean(),
  periodo: z.object({ inicio: z.string(), fim: z.string(), dias: z.number().int() }),
  destino: z.enum(['banco', 'memoria']),
});
export type PaginaExclusoes = z.infer<typeof esquemaPaginaExclusoes>;

export const esquemaPaginaConexoes = z.object({
  itens: z.array(
    z.object({ dataHora: z.string(), usuario: z.string(), modulo: z.number().int(), nome: z.string() }),
  ),
  pagina: z.number().int(),
  temMais: z.boolean(),
  cortado: z.boolean(),
  periodo: z.object({ inicio: z.string(), fim: z.string(), dias: z.number().int() }),
  destino: z.enum(['banco', 'memoria']),
});
export type PaginaConexoes = z.infer<typeof esquemaPaginaConexoes>;

// ── Pedidos do titular (SGH_AUD_PEDIDO_TITULAR) ───────────────────────────────────────────────────

export const TIPOS_PEDIDO_TITULAR = [
  'confirmacao',
  'acesso',
  'correcao',
  'anonimizacao',
  'eliminacao',
  'portabilidade',
  'compartilhamento',
  'revogacao-consentimento',
] as const;
export const SITUACOES_PEDIDO_TITULAR = [
  'aberto',
  'identidade-verificada',
  'atendido',
  'negado',
  /** W0-10: cancelado com motivo pelo titular antes da resposta. */
  'cancelado',
] as const;
export const FUNDAMENTOS_PEDIDO = [
  'guarda-legal-prontuario',
  'obrigacao-legal',
  'exercicio-de-direito',
  'identidade-nao-confirmada',
  'outro',
] as const;
export const CANAIS_PEDIDO = ['presencial', 'email', 'telefone', 'carta', 'outro'] as const;
/**
 * Revisão do W0-10: os canais que a LISTA da privacidade mostra. O pedido aberto pelo portal do paciente grava
 * CANAL = 'portal' (CANAL_PEDIDO_PORTAL) na mesma SGH_AUD_PEDIDO_TITULAR; o balcão não escolhe esse canal
 * (CANAIS_PEDIDO no registro), mas a lista o lê, senão a tela recusava a resposta inteira.
 */
export const CANAIS_PEDIDO_LIDOS = [...CANAIS_PEDIDO, 'portal'] as const;

export const esquemaPedidoTitular = z.object({
  id: z.string(),
  protocolo: z.string(),
  tipo: z.enum(TIPOS_PEDIDO_TITULAR),
  canal: z.enum(CANAIS_PEDIDO_LIDOS),
  situacao: z.enum(SITUACOES_PEDIDO_TITULAR),
  idPaciente: z.number().int(),
  prontuario: z.number().int().nullable(),
  abertoEm: z.string(),
  prazo: z.string(),
  atrasado: z.boolean(),
  identidadeVerificada: z.boolean(),
  fundamento: z.enum(FUNDAMENTOS_PEDIDO).nullable(),
  decididoPor: z.string().nullable(),
  decididoEm: z.string().nullable(),
  registradoPor: z.string(),
});
export type PedidoTitularTela = z.infer<typeof esquemaPedidoTitular>;

export const esquemaListaPedidos = z.object({
  itens: z.array(esquemaPedidoTitular),
  abertos: z.number().int(),
  atrasados: z.number().int(),
  destino: z.enum(['banco', 'memoria']),
});
export type ListaPedidos = z.infer<typeof esquemaListaPedidos>;

/**
 * Registrar o pedido: o titular pelo PRONTUÁRIO (o número que o hospital usa; a tela não pede o ID interno) ou, por
 * quem já tem, pelo ID do paciente. Um dos dois, nunca os dois.
 */
export const esquemaRegistrarPedido = z
  .object({
    prontuario: z.number().int().positive().max(2_147_483_647).optional(),
    idPaciente: z.number().int().positive().optional(),
    tipo: z.enum(TIPOS_PEDIDO_TITULAR),
    canal: z.enum(CANAIS_PEDIDO),
    descricao: textoCp1252(1000).optional(),
  })
  .strict()
  .refine((p) => (p.prontuario === undefined) !== (p.idPaciente === undefined), {
    message: 'Informe o prontuário do titular.',
    path: ['prontuario'],
  });
export type RegistrarPedido = z.infer<typeof esquemaRegistrarPedido>;

export const esquemaTratarPedido = z
  .object({
    acao: z.enum(['confirmar-identidade', 'atender', 'negar']),
    fundamento: z.enum(FUNDAMENTOS_PEDIDO).optional(),
    resposta: textoCp1252(1000).optional(),
  })
  .strict();
export type TratarPedido = z.infer<typeof esquemaTratarPedido>;

// ── Backup ───────────────────────────────────────────────────────────────────────────────────────

export const esquemaBackup = z.object({
  situacoes: z.array(z.object({ id: z.number().int(), descricao: z.string() })),
  procedimentos: z.array(z.object({ id: z.number().int(), descricao: z.string() })),
  destino: z.enum(['banco', 'memoria']),
});
export type Backup = z.infer<typeof esquemaBackup>;
