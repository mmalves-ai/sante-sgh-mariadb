// Contratos do prontuário ao vivo (M15; ficha, seções 4, 7 e 8): busca do paciente, lista dos registros com as
// marcas legais, as cinco abas de um registro (como emitido, layout da época, texto formatado, respostas,
// contexto do ato), a busca de palavra e o registro de acesso ao prontuário. Tudo é LIDO ao vivo do banco do
// estabelecimento, sem cópia; nada aqui grava em tabela clínica. Nenhum nome de tabela nem coluna do banco sai
// daqui (fronteira). O texto clínico só vai a quem tem a permissão e nunca à trilha, a log ou a cache nominal.
import { z } from 'zod';
import { CATEGORIAS_PROFISSIONAL } from '../cadastro/telas.js';

// ── Motivo de acesso (regra 11) ───────────────────────────────────────────────────────────────────────

/** Lista fechada do motivo da primeira abertura de cada paciente na sessão (Fase 1, sem vínculo assistencial). */
export const MOTIVOS_ACESSO_PRONTUARIO = [
  'assistencia',
  'auditoria-contas',
  'same',
  'comissao-prontuario',
  'juridico',
  'pedido-titular',
] as const;
export type MotivoAcessoProntuario = (typeof MOTIVOS_ACESSO_PRONTUARIO)[number];

export const ROTULOS_MOTIVO_ACESSO: Readonly<Record<MotivoAcessoProntuario, string>> = {
  assistencia: 'Assistência ao paciente',
  'auditoria-contas': 'Auditoria de contas',
  same: 'Serviço de arquivo médico (SAME)',
  'comissao-prontuario': 'Comissão de revisão de prontuário',
  juridico: 'Jurídico',
  'pedido-titular': 'Pedido do titular',
};

export const esquemaPedidoMotivo = z.object({ motivo: z.enum(MOTIVOS_ACESSO_PRONTUARIO) }).strict();
export type PedidoMotivo = z.infer<typeof esquemaPedidoMotivo>;

export const esquemaMotivoAberto = z.object({
  paciente: z.number().int().positive(),
  motivo: z.enum(MOTIVOS_ACESSO_PRONTUARIO).nullable(),
  /** O parâmetro do estabelecimento que restringe o acesso a paciente fora do atendimento (respeitado). */
  restricaoAtendimento: z.boolean(),
});
export type MotivoAberto = z.infer<typeof esquemaMotivoAberto>;

// ── Partes abertas (trilha) ──────────────────────────────────────────────────────────────────────────

export const ABAS_REGISTRO = ['como-emitido', 'layout', 'texto', 'respostas', 'contexto'] as const;
export type AbaRegistro = (typeof ABAS_REGISTRO)[number];

/** Parte do prontuário aberta (vai à trilha, nunca o conteúdo). */
export const PARTES_PRONTUARIO = ['lista', 'registro', ...ABAS_REGISTRO, 'busca'] as const;
export type ParteProntuario = (typeof PARTES_PRONTUARIO)[number];

// ── Lista de registros ──────────────────────────────────────────────────────────────────────────────

export const TETO_REGISTROS_PAGINA = 50;
export const TETO_BUSCA_PALAVRA = 500;

const data = z.iso.date();

export const esquemaFiltrosRegistros = z
  .object({
    de: data.optional(),
    ate: data.optional(),
    modelo: z.coerce.number().int().positive().optional(),
    categoria: z.enum(CATEGORIAS_PROFISSIONAL).optional(),
    profissional: z.coerce.number().int().positive().optional(),
    pagina: z.coerce.number().int().min(1).max(10_000).default(1),
  })
  .strict();
export type FiltrosRegistros = z.infer<typeof esquemaFiltrosRegistros>;

/** Marcas legais visíveis (regra 8) e exceções que aparecem, não somem (regra 9). */
export const MARCAS_REGISTRO = [
  'suspenso',
  'correcao',
  'retroativo',
  'supervisao',
  'sem-conteudo',
  'data-impossivel',
  'sem-assinatura-icp',
] as const;
export type MarcaRegistro = (typeof MARCAS_REGISTRO)[number];

export const esquemaMarcas = z.object({
  suspenso: z.boolean(),
  /** Data e hora da suspensão (AAAA-MM-DDTHH:MM) e a justificativa, quando suspenso. */
  suspensoEm: z.string().nullable(),
  justificativaSuspensao: z.string().nullable(),
  /** Correção: o registro original que este corrige. */
  corrigeRegistro: z.number().int().nullable(),
  retroativo: z.boolean(),
  justificativaRetroativo: z.string().nullable(),
  supervisao: z.boolean(),
  semConteudo: z.boolean(),
  dataImpossivel: z.boolean(),
  /** Registro eletrônico sem assinatura ICP (o tipo de documento "somente lançamento"). */
  semAssinaturaIcp: z.boolean(),
});
export type Marcas = z.infer<typeof esquemaMarcas>;

export const esquemaRegistroResumo = z.object({
  id: z.number().int().positive(),
  /** AAAA-MM-DDTHH:MM do ato clínico (hora do estabelecimento), ou null quando impossível. */
  dataHora: z.string().nullable(),
  /** Hora em que foi gravado (lançamento). */
  lancadoEm: z.string().nullable(),
  modelo: z.object({ id: z.number().int(), codigo: z.string().nullable(), nome: z.string().nullable() }),
  profissional: z.object({
    id: z.number().int().nullable(),
    nome: z.string().nullable(),
    categoria: z.enum(CATEGORIAS_PROFISSIONAL),
    cbo: z.string().nullable(),
  }),
  atendimento: z.number().int().nullable(),
  /** Qual fonte abre o "como emitido" (regra 3). */
  fonteComoEmitido: z.enum(['documento', 'layout', 'texto', 'nenhuma']),
  marcas: esquemaMarcas,
});
export type RegistroResumo = z.infer<typeof esquemaRegistroResumo>;

export const esquemaCabecalhoProntuario = z.object({
  paciente: z.number().int().positive(),
  prontuario: z.number().int(),
  nome: z.string(),
  nomeSocial: z.string().nullable(),
  nascimento: z.string().nullable(),
  sexo: z.enum(['F', 'M']).nullable(),
  obito: z.boolean(),
  estabelecimento: z.string(),
});
export type CabecalhoProntuario = z.infer<typeof esquemaCabecalhoProntuario>;

export const esquemaListaRegistros = z.object({
  cabecalho: esquemaCabecalhoProntuario,
  itens: z.array(esquemaRegistroResumo),
  pagina: z.number().int(),
  porPagina: z.number().int(),
  /** Há página seguinte (a contagem total não é feita: a lista é por página, ao vivo). */
  haMais: z.boolean(),
  /** Modelos e profissionais que aparecem nos registros do paciente (para os filtros). */
  modelos: z.array(
    z.object({ id: z.number().int(), codigo: z.string().nullable(), nome: z.string().nullable() }),
  ),
  profissionais: z.array(z.object({ id: z.number().int(), nome: z.string() })),
  /** Avisos de exceção (cabeçalho sem conteúdo, data impossível) para o SAME, sem conteúdo. */
  excecoes: z.object({ semConteudo: z.number().int(), dataImpossivel: z.number().int() }),
});
export type ListaRegistros = z.infer<typeof esquemaListaRegistros>;

// ── Texto formatado (RTF → parágrafos) ────────────────────────────────────────────────────────────────

export const esquemaTrecho = z.object({
  texto: z.string(),
  negrito: z.boolean(),
  italico: z.boolean(),
  sublinhado: z.boolean(),
  /** Índice da tabela de cores do texto (0 = automática). */
  cor: z.number().int().min(0).max(255),
});
export const esquemaParagrafo = z.object({
  alinhamento: z.enum(['esquerda', 'centro', 'direita', 'justificado']),
  /** Recuo em níveis de 0,5 cm (a partir do \li em twips). */
  recuo: z.number().int().min(0).max(20),
  trechos: z.array(esquemaTrecho),
});
export const esquemaTextoFormatado = z.object({
  paragrafos: z.array(esquemaParagrafo),
  /** Cores da tabela do texto (#rrggbb), na ordem dos índices (o 0 é a automática). */
  cores: z.array(z.string().regex(/^#[0-9a-f]{6}$/)),
  /** Comandos ignorados por nome (contagem; sem conteúdo). */
  ignorados: z.record(z.string(), z.number().int()),
  /** Conteúdo ativo neutralizado (objeto, imagem, campo com link): não aparece. */
  conteudoAtivoRemovido: z.number().int(),
});
export type TextoFormatado = z.infer<typeof esquemaTextoFormatado>;
export type Paragrafo = z.infer<typeof esquemaParagrafo>;

// ── Formulário (layout da época e documento como emitido) ─────────────────────────────────────────────

export type ValorCampoRegistro =
  | { readonly tipo: 'vazio' }
  | { readonly tipo: 'texto'; readonly texto: string }
  | { readonly tipo: 'formatado'; readonly texto: TextoFormatado }
  | { readonly tipo: 'lista'; readonly itens: readonly string[] };

export const esquemaValorCampoRegistro: z.ZodType<ValorCampoRegistro> = z.discriminatedUnion('tipo', [
  z.object({ tipo: z.literal('vazio') }),
  z.object({ tipo: z.literal('texto'), texto: z.string() }),
  z.object({ tipo: z.literal('formatado'), texto: esquemaTextoFormatado }),
  z.object({ tipo: z.literal('lista'), itens: z.array(z.string()) }),
]);

export const esquemaCampoFormulario = z.object({
  /** Nome do componente no formulário de origem. */
  nome: z.string(),
  /** Classe do componente (o tipo de campo do formulário de origem). */
  classe: z.string(),
  titulo: z.string(),
  secao: z.boolean(),
  valor: esquemaValorCampoRegistro,
  /** Posição no formulário de origem (px): ordem de leitura. */
  topo: z.number().int(),
  esquerda: z.number().int(),
  /** Colunas na grade de 12 (layout fluido pela largura). */
  colunas: z.number().int().min(1).max(12),
  autopreenchido: z.boolean(),
  /** Classe de componente sem correspondência conhecida (aparece como texto). */
  naoMapeado: z.boolean(),
});
export type CampoFormulario = z.infer<typeof esquemaCampoFormulario>;

export const esquemaLayoutEpoca = z.object({
  modelo: z.number().int().nullable(),
  composicao: z.string().nullable(),
  campos: z.array(esquemaCampoFormulario),
});
export type LayoutEpoca = z.infer<typeof esquemaLayoutEpoca>;

export const esquemaBlocoDocumento = z.object({
  titulo: z.string(),
  campos: z.array(z.object({ rotulo: z.string(), valor: z.string() })),
});

export const esquemaEventoDocumento = z.object({
  situacao: z.string(),
  em: z.string().nullable(),
  profissional: z.string().nullable(),
});

export const esquemaComoEmitido = z.object({
  fonte: z.enum(['documento', 'layout', 'texto', 'nenhuma']),
  /** Cabeçalho congelado do documento (hospital, paciente, atendimento, lançamento). */
  blocos: z.array(esquemaBlocoDocumento),
  campos: z.array(esquemaCampoFormulario),
  /** Eventos do documento (lançado, suspenso, suspenso por correção…), em ordem. */
  eventos: z.array(esquemaEventoDocumento),
  /** Quando não há documento: o texto formatado do registro ("como emitido" pelo texto). */
  texto: esquemaTextoFormatado.nullable(),
  aviso: z.string().nullable(),
});
export type ComoEmitido = z.infer<typeof esquemaComoEmitido>;

// ── Respostas estruturadas ─────────────────────────────────────────────────────────────────────────

export interface ItemResposta {
  readonly ordem: string;
  readonly titulo: string;
  readonly tipo: string;
  readonly valores: readonly string[];
  readonly grade: {
    readonly colunas: readonly string[];
    readonly linhas: readonly (readonly string[])[];
  } | null;
  readonly autopreenchido: boolean;
  /** Leitura sem certeza (DP-28): índice sem rótulo, tipo sem coluna conhecida, vínculo inativo. */
  readonly aConfirmar: string | null;
  readonly itens: readonly ItemResposta[];
}

export const esquemaItemResposta: z.ZodType<ItemResposta> = z.lazy(() =>
  z.object({
    ordem: z.string(),
    titulo: z.string(),
    tipo: z.string(),
    valores: z.array(z.string()),
    grade: z.object({ colunas: z.array(z.string()), linhas: z.array(z.array(z.string())) }).nullable(),
    autopreenchido: z.boolean(),
    aConfirmar: z.string().nullable(),
    itens: z.array(esquemaItemResposta),
  }),
);

export const esquemaRespostas = z.object({
  itens: z.array(esquemaItemResposta),
  /** Representação usada: a do layout de origem com a impressão digital (curta) e a origem. */
  representacao: z.object({
    impressao: z.string().nullable(),
    origem: z.enum(['banco', 'convertida', 'ausente']),
  }),
  total: z.number().int(),
  aConfirmar: z.number().int(),
});
export type Respostas = z.infer<typeof esquemaRespostas>;

// ── Contexto do ato (retratos do momento) ─────────────────────────────────────────────────────────────

export const esquemaContextoAto = z.object({
  paciente: z.object({
    nome: z.string().nullable(),
    nomeSocial: z.string().nullable(),
    nascimento: z.string().nullable(),
  }),
  atendimento: z.object({
    numero: z.number().int().nullable(),
    entrada: z.string().nullable(),
    unidade: z.string().nullable(),
    leito: z.string().nullable(),
    convenio: z.string().nullable(),
    cidPrincipal: z.string().nullable(),
    cidSecundario: z.string().nullable(),
    medicoAssistente: z.string().nullable(),
  }),
  /** Responsável do atendimento (só dentro do registro; nunca em lista, log ou cache nominal). */
  responsavel: z.object({ nome: z.string().nullable(), parentesco: z.string().nullable() }).nullable(),
  profissional: z.object({
    nome: z.string().nullable(),
    conselho: z.string().nullable(),
    cbo: z.string().nullable(),
  }),
});
export type ContextoAto = z.infer<typeof esquemaContextoAto>;

// ── Registro aberto ────────────────────────────────────────────────────────────────────────────────

export const esquemaRegistroAberto = z.object({
  cabecalho: esquemaCabecalhoProntuario,
  registro: esquemaRegistroResumo,
  /** Abas com conteúdo (as outras aparecem desabilitadas com o motivo). */
  abas: z.record(z.enum(ABAS_REGISTRO), z.object({ disponivel: z.boolean(), motivo: z.string().nullable() })),
});
export type RegistroAberto = z.infer<typeof esquemaRegistroAberto>;

/** Aba "Texto formatado": o texto e, quando ele não pôde ser lido, o aviso (regra 9: a exceção aparece). */
export const esquemaTextoDaAba = esquemaTextoFormatado.extend({ aviso: z.string().nullable() });
export type TextoDaAba = z.infer<typeof esquemaTextoDaAba>;

export const esquemaAbaRegistro = z.discriminatedUnion('aba', [
  z.object({ aba: z.literal('como-emitido'), conteudo: esquemaComoEmitido }),
  z.object({ aba: z.literal('layout'), conteudo: esquemaLayoutEpoca }),
  z.object({ aba: z.literal('texto'), conteudo: esquemaTextoDaAba }),
  z.object({ aba: z.literal('respostas'), conteudo: esquemaRespostas }),
  z.object({ aba: z.literal('contexto'), conteudo: esquemaContextoAto }),
]);
export type AbaRegistroConteudo = z.infer<typeof esquemaAbaRegistro>;

// ── Busca de palavra nos registros do paciente ──────────────────────────────────────────────────────

export const esquemaConsultaPalavra = z
  .object({
    termo: z.string().trim().min(3).max(60),
    de: data.optional(),
    ate: data.optional(),
  })
  .strict();
export type ConsultaPalavra = z.infer<typeof esquemaConsultaPalavra>;

export const esquemaResultadoPalavra = z.object({
  itens: z.array(
    z.object({
      registro: z.number().int(),
      dataHora: z.string().nullable(),
      modelo: z.string().nullable(),
      ocorrencias: z.number().int(),
      /** Trecho em volta da primeira ocorrência (até 160 caracteres). */
      trecho: z.string(),
    }),
  ),
  lidos: z.number().int(),
  /** Passou do teto de registros lidos (refine o período). */
  truncado: z.boolean(),
});
export type ResultadoPalavra = z.infer<typeof esquemaResultadoPalavra>;

// ── Registro de acesso ao prontuário (trilha de leituras) ────────────────────────────────────────────

export const TETO_ACESSOS_PAGINA = 100;

export const esquemaFiltrosAcessos = z
  .object({
    paciente: z.coerce.number().int().positive().optional(),
    usuario: z.string().trim().min(1).max(31).optional(),
    de: data.optional(),
    ate: data.optional(),
    /** Só os alertas ao Auditor (o e-mail do alerta leva a esta tela). */
    soAlertas: z.enum(['sim']).optional(),
    pagina: z.coerce.number().int().min(1).max(10_000).default(1),
  })
  .strict();
export type FiltrosAcessos = z.infer<typeof esquemaFiltrosAcessos>;

export const esquemaAcessoProntuario = z.object({
  id: z.string(),
  em: z.string(),
  usuario: z.string(),
  estacao: z.string().nullable(),
  paciente: z.number().int().nullable(),
  registro: z.number().int().nullable(),
  parte: z.string().nullable(),
  motivo: z.string().nullable(),
  resultado: z.string(),
  /** Ator real numa sessão "como" (suporte técnico), quando houver. */
  origem: z.string().nullable(),
  /** Alerta ao Auditor (muitos prontuários, fora do horário) com a criticidade; null nas leituras. */
  alerta: z
    .object({ tipo: z.enum(['muitos-prontuarios', 'fora-do-horario']), criticidade: z.number().int() })
    .nullable(),
});
export type AcessoProntuario = z.infer<typeof esquemaAcessoProntuario>;

export const esquemaListaAcessos = z.object({
  itens: z.array(esquemaAcessoProntuario),
  pagina: z.number().int(),
  porPagina: z.number().int(),
  haMais: z.boolean(),
});
export type ListaAcessos = z.infer<typeof esquemaListaAcessos>;

/** Chave natural da trilha da leitura: parte e motivo (nunca o texto clínico, o nome ou o termo da busca). */
export function chaveLeitura(
  parte: ParteProntuario,
  motivo: MotivoAcessoProntuario | null,
  extra?: string,
): string {
  return [`parte:${parte}`, `motivo:${motivo ?? '-'}`, ...(extra ? [extra] : [])].join(';').slice(0, 120);
}

/** Lê a chave natural gravada por `chaveLeitura` (registro de acesso). */
export function lerChaveLeitura(chave: string | null): { parte: string | null; motivo: string | null } {
  const m = new Map(
    (chave ?? '')
      .split(';')
      .map((p) => p.split(':'))
      .filter((p): p is [string, string] => p.length >= 2 && typeof p[0] === 'string')
      .map(([k, ...v]) => [k, v.join(':')]),
  );
  const motivo = m.get('motivo') ?? null;
  return { parte: m.get('parte') ?? null, motivo: motivo === '-' ? null : motivo };
}

// ── Liberação por estabelecimento e setor (ficha, seção 12) ──────────────────────────────────────────

/** Chave de liberação do prontuário ao vivo (SGH_CFG_LIBERACAO, tipo recurso): recolher = desligar. */
export const CHAVE_LIBERACAO_PRONTUARIO = 'pep.prontuario.consulta';

export const esquemaLiberacaoProntuario = z.object({
  ligada: z.boolean(),
  /** Por que está desligada (texto de produto); null quando ligada. */
  motivo: z.string().nullable(),
});
export type LiberacaoProntuario = z.infer<typeof esquemaLiberacaoProntuario>;

// ── Exceções do prontuário (regra 9): relatório agregado para o SAME e a comissão de prontuário ─────

export const TIPOS_EXCECAO_PRONTUARIO = ['sem-conteudo', 'data-impossivel'] as const;
export type TipoExcecaoProntuario = (typeof TIPOS_EXCECAO_PRONTUARIO)[number];

/** Contagem publicada: o número a partir de 5; de 1 a 4 vira "<5" (nenhum estrato pequeno identifica alguém). */
export const esquemaContagemAgregada = z.union([z.number().int().min(0), z.literal('<5')]);
export type ContagemAgregada = z.infer<typeof esquemaContagemAgregada>;

export function contagemAgregada(n: number): ContagemAgregada {
  return n > 0 && n < 5 ? '<5' : n;
}

export const esquemaLinhaExcecao = z.object({
  tipo: z.enum(TIPOS_EXCECAO_PRONTUARIO),
  modelo: z.object({ id: z.number().int(), codigo: z.string().nullable(), nome: z.string().nullable() }),
  /** Mês do lançamento (AAAA-MM); null sem data de lançamento. */
  mes: z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .nullable(),
  registros: esquemaContagemAgregada,
});
export type LinhaExcecao = z.infer<typeof esquemaLinhaExcecao>;

export const esquemaRelatorioExcecoes = z.object({
  estabelecimento: z.string(),
  geradoEm: z.string(),
  linhas: z.array(esquemaLinhaExcecao),
  totais: z.object({ 'sem-conteudo': esquemaContagemAgregada, 'data-impossivel': esquemaContagemAgregada }),
});
export type RelatorioExcecoes = z.infer<typeof esquemaRelatorioExcecoes>;
