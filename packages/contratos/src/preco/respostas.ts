// Respostas da API do M12 (validadas pela tela). Nenhum nome de tabela do legado; as colunas de TBCONVEN que
// aparecem em consulta vão pelo campo público (camelCase) e, nas abas de consulta, com o código do legado
// como referência para quem confere no SPDATA. Credenciais nunca (regra 8).
import { z } from 'zod';
import { esquemaComponentes } from './entradas.js';

const opcao = z.object({ valor: z.string(), rotulo: z.string() });
const aceite = z.object({ aceita: z.boolean(), motivo: z.string().nullable() });

export const esquemaConvenioResumo = z.object({
  codigo: z.number(),
  nome: z.string(),
  situacao: z.string().nullable(),
  aceitaAtendimento: aceite,
  classificacao: z.string().nullable(),
  registroAns: z.number().nullable(),
  tabelas: z.object({
    honorariosInternacao: z.number().nullable(),
    honorariosExterna: z.number().nullable(),
    diarias: z.number().nullable(),
    matmed: z.number().nullable(),
  }),
});
export type ConvenioResumo = z.infer<typeof esquemaConvenioResumo>;

export const esquemaListaConvenios = z.object({
  itens: z.array(esquemaConvenioResumo),
  total: z.number(),
  destino: z.enum(['legado', 'memoria']),
});
export type ListaConvenios = z.infer<typeof esquemaListaConvenios>;

export const esquemaCampoContratoDescrito = z.object({
  campo: z.string(),
  rotulo: z.string(),
  /** Código da coluna no legado (só nas abas de consulta, para conferir no SPDATA). */
  codigoLegado: z.string().nullable(),
  tema: z.number(),
  valor: z.union([z.string(), z.number(), z.null()]),
  editavel: z.boolean(),
  aConfirmar: z.boolean(),
  tipo: z.enum(['texto', 'inteiro', 'opcao', 'decimal', 'data']),
  maxBytes: z.number().optional(),
  minimo: z.number().optional(),
  maximo: z.number().optional(),
  opcoes: z.array(opcao).optional(),
  obrigatorio: z.boolean().optional(),
});
export type CampoContratoDescrito = z.infer<typeof esquemaCampoContratoDescrito>;

export const esquemaAbaContrato = z.object({
  id: z.enum(['cadastro', 'tabelas', 'modificadores', 'faturabilidade', 'pacotes', 'tiss', 'financeiro']),
  titulo: z.string(),
  editavel: z.boolean(),
  campos: z.array(esquemaCampoContratoDescrito),
});
export type AbaContratoDescrita = z.infer<typeof esquemaAbaContrato>;

export const esquemaPlanoConvenio = z.object({
  id: z.number(),
  nome: z.string(),
  planoLegado: z.number().nullable(),
  inicio: z.string(),
  fim: z.string().nullable(),
  ativo: z.boolean(),
  criadoPor: z.string(),
  versao: z.number(),
});
export type PlanoConvenio = z.infer<typeof esquemaPlanoConvenio>;

export const esquemaVigenciaTabela = z.object({
  tipo: z.enum(['honorariosInternacao', 'honorariosExterna', 'diarias', 'matmed']),
  tabela: z.number(),
  inicio: z.string(),
  fim: z.string(),
  vigente: z.boolean(),
});

export const esquemaIndice = z.object({
  tipo: z.enum(['indice', 'indiceProcedimento', 'porte']),
  chave: z.string(),
  rotulo: z.string(),
  data: z.string(),
  valor: z.number(),
  vigente: z.boolean(),
  dataInvalida: z.boolean(),
});

export const esquemaEstadoGravacao = z.object({
  situacao: z.string().nullable(),
  contrato: z.string().nullable(),
  /** Gravação possível neste ambiente e fonte (dev sobre a cópia: não; motivo visível). */
  permitida: z.boolean(),
  motivo: z.string().nullable(),
});

export const esquemaContratoConvenio = z.object({
  codigo: z.number(),
  nome: z.string(),
  situacao: z.string().nullable(),
  aceitaAtendimento: aceite,
  abas: z.array(esquemaAbaContrato),
  /** Colunas constantes nos convênios ativos, ocultas (regra 6). */
  constantesOcultas: z.number(),
  planos: z.array(esquemaPlanoConvenio),
  vigencias: z.array(esquemaVigenciaTabela),
  indices: z.array(esquemaIndice),
  tiss: z.object({
    configurado: z.boolean(),
    campos: z.array(esquemaCampoContratoDescrito),
    parametros: z.array(z.object({ codigo: z.number(), nome: z.string(), padrao: z.string().nullable() })),
  }),
  historicoNome: z.array(
    z.object({ quando: z.string(), nome: z.string(), classificacao: z.number().nullable() }),
  ),
  gravacao: esquemaEstadoGravacao,
  permissoes: z.object({ alterarSituacao: z.boolean(), editarContrato: z.boolean() }),
  opcoesClassificacao: z.array(opcao),
});
export type ContratoConvenio = z.infer<typeof esquemaContratoConvenio>;

export const esquemaPaginaModificadores = z.object({
  tipo: z.enum([
    'honorarios',
    'matmed',
    'referencia',
    'referenciaItem',
    'planos',
    'formulas',
    'horarios',
    'subgrupos',
    'pacotes',
    'entregas',
  ]),
  colunas: z.array(z.object({ campo: z.string(), rotulo: z.string(), aConfirmar: z.boolean().optional() })),
  itens: z.array(z.record(z.string(), z.union([z.string(), z.number(), z.null()]))),
  total: z.number(),
  pagina: z.number(),
  porPagina: z.number(),
});
export type PaginaModificadores = z.infer<typeof esquemaPaginaModificadores>;

export const esquemaImpactoSituacao = z.object({
  convenio: z.number(),
  nome: z.string(),
  operacao: z.enum(['suspender', 'reativar']),
  situacaoAtual: z.string().nullable(),
  situacaoDepois: z.string(),
  impacto: z.object({
    agendasConsulta: z.number(),
    agendasExame: z.number(),
    agendamentosFuturos: z.number(),
    contasAbertas: z.number(),
    profissionais: z.number(),
  }),
  alertas: z.array(z.string()),
  /** Recusa antecipada (ex.: diária de acompanhante inválida): a gravação seria recusada. */
  recusa: z.string().nullable(),
});
export type ImpactoSituacao = z.infer<typeof esquemaImpactoSituacao>;

export const esquemaResultadoGravacaoPreco = z.object({
  operacao: z.string(),
  destino: z.enum(['legado', 'memoria']),
  lote: z.string().nullable(),
  linhas: z.number(),
  partes: z.number(),
  mensagem: z.string(),
});
export type ResultadoGravacaoPreco = z.infer<typeof esquemaResultadoGravacaoPreco>;

// ── Tabelas de preço ───────────────────────────────────────────────────────────────────────────────

export const esquemaTabelaPreco = z.object({
  tipo: z.enum(['honorarios', 'diarias', 'matmed']),
  codigo: z.number(),
  nome: z.string(),
  situacao: z.string().nullable(),
  modelo: z.enum(['VALOR', 'PORTE', 'CH']).nullable(),
  compartilhada: z.boolean(),
  comPercentual: z.boolean(),
  convenios: z.array(
    z.object({ codigo: z.number(), nome: z.string(), ativo: z.boolean(), usos: z.array(z.string()) }),
  ),
});
export type TabelaPreco = z.infer<typeof esquemaTabelaPreco>;
export const esquemaListaTabelas = z.object({ tabelas: z.array(esquemaTabelaPreco) });

export const esquemaItemHonorario = z.object({
  codigo: z.number(),
  nome: z.string(),
  situacao: z.string().nullable(),
  ch: z.number(),
  porte: z.string().nullable(),
  modelo: z.enum(['VALOR', 'PORTE', 'CH']),
  vigencia: z.string().nullable(),
  valores: esquemaComponentes.nullable(),
  total: z.number().nullable(),
  vigencias: z.number(),
  futura: z.string().nullable(),
});
export type ItemHonorario = z.infer<typeof esquemaItemHonorario>;

export const esquemaPaginaItens = <T extends z.ZodType>(item: T) =>
  z.object({
    itens: z.array(item),
    total: z.number(),
    pagina: z.number(),
    porPagina: z.number(),
    dataBase: z.string(),
    truncada: z.boolean(),
  });
export const esquemaPaginaHonorarios = esquemaPaginaItens(esquemaItemHonorario);
export type PaginaHonorarios = z.infer<typeof esquemaPaginaHonorarios>;

export const esquemaVigenciaItem = z.object({
  data: z.string(),
  valores: esquemaComponentes,
  total: z.number(),
  vigente: z.boolean(),
  futura: z.boolean(),
  autoria: z
    .object({ autor: z.string(), quando: z.string(), origem: z.string(), lote: z.string().nullable() })
    .nullable(),
});
export const esquemaVigenciasItem = z.object({
  tabela: z.number(),
  codigo: z.number(),
  nome: z.string(),
  vigencias: z.array(esquemaVigenciaItem),
});
export type VigenciasItem = z.infer<typeof esquemaVigenciasItem>;

/** Vigências de diária/taxa (TBVLRDTH) ou de mat/med (TBVLRMEM): o valor de cada data, sem autoria do novo. */
export const esquemaVigenciasValor = z.object({
  tipo: z.enum(['diaria', 'matmed']),
  tabela: z.number(),
  codigo: z.number(),
  nome: z.string(),
  vigencias: z.array(
    z.object({
      data: z.string(),
      valor: z.number().nullable(),
      pmc: z.number().nullable(),
      pf: z.number().nullable(),
      edicao: z.number().nullable(),
      vigente: z.boolean(),
      futura: z.boolean(),
    }),
  ),
});
export type VigenciasValor = z.infer<typeof esquemaVigenciasValor>;

export const esquemaItemDiaria = z.object({
  id: z.number(),
  codigo: z.string().nullable(),
  operacao: z.number(),
  nome: z.string(),
  tipo: z.number().nullable(),
  subtipo: z.number().nullable(),
  situacao: z.string().nullable(),
  vigencia: z.string().nullable(),
  valor: z.number().nullable(),
  vigencias: z.number(),
});
export const esquemaPaginaDiarias = esquemaPaginaItens(esquemaItemDiaria);
export type PaginaDiarias = z.infer<typeof esquemaPaginaDiarias>;

export const esquemaItemMatmed = z.object({
  id: z.number(),
  codigo: z.number(),
  nome: z.string(),
  classificacao: z.number().nullable(),
  unidade: z.string().nullable(),
  referencia: z.string().nullable(),
  situacao: z.string().nullable(),
  vigencia: z.string().nullable(),
  valor: z.number().nullable(),
  pmc: z.number().nullable(),
  pf: z.number().nullable(),
  edicao: z.number().nullable(),
});
export const esquemaPaginaMatmed = esquemaPaginaItens(esquemaItemMatmed);
export type PaginaMatmed = z.infer<typeof esquemaPaginaMatmed>;

export const esquemaEdicoesReferencia = z.object({
  edicoes: z.array(z.object({ id: z.number(), versao: z.number() })),
  total: z.number(),
});

export const esquemaVeto = z.object({ codigo: z.string(), mensagem: z.string(), itens: z.array(z.number()) });
export const esquemaAlerta = z.object({
  codigo: z.string(),
  mensagem: z.string(),
  confirmacao: z.enum(['tabelaCompartilhada', 'percentualTabela']).nullable(),
});
export const esquemaPropostaReajuste = z.object({
  tabela: z.number(),
  data: z.string(),
  hoje: z.string(),
  linhas: z.array(
    z.object({
      codigo: z.number(),
      nome: z.string(),
      vigenciaAtual: z.string().nullable(),
      atuais: esquemaComponentes.nullable(),
      novos: esquemaComponentes,
      totalAtual: z.number().nullable(),
      totalNovo: z.number(),
      variacao: z.number().nullable(),
      muda: z.boolean(),
    }),
  ),
  vetos: z.array(esquemaVeto),
  alertas: z.array(esquemaAlerta),
  confirmacoes: z.array(z.enum(['tabelaCompartilhada', 'percentualTabela'])),
  resumo: z.object({
    itens: z.number(),
    mudam: z.number(),
    somaChAtual: z.number(),
    somaChNova: z.number(),
    variacao: z.number().nullable(),
    conveniosAfetados: z.number(),
    conveniosAtivosAfetados: z.number(),
    transacoes: z.number(),
  }),
});
export type PropostaReajusteResposta = z.infer<typeof esquemaPropostaReajuste>;

export const esquemaLoteReajuste = z.object({
  lote: z.string(),
  tabela: z.number(),
  data: z.string(),
  origem: z.string(),
  itens: z.number(),
  autor: z.string(),
  quando: z.string(),
  justificativa: z.string(),
  /** Itens já desfeitos; `desfeito` = todos (entre 0 e o total: desfeito em parte, o desfazer continua). */
  desfeitos: z.number(),
  desfeito: z.boolean(),
});
export const esquemaListaLotes = z.object({ lotes: z.array(esquemaLoteReajuste) });
export type LoteReajuste = z.infer<typeof esquemaLoteReajuste>;

export const esquemaValorVigente = z.object({
  convenio: z.object({ codigo: z.number(), nome: z.string(), situacao: z.string().nullable() }),
  tipo: z.enum(['honorario', 'diaria', 'matmed']),
  conta: z.enum(['externa', 'internacao']),
  tabela: z.number().nullable(),
  item: z.object({ codigo: z.number(), nome: z.string() }).nullable(),
  dataBase: z.string(),
  vigencia: z.string().nullable(),
  valores: esquemaComponentes.nullable(),
  /** Regra da sante-api (valores.js): soma dos 5 componentes de TBVLRTHM na vigência; igual à grade. */
  total: z.number().nullable(),
  modelo: z.enum(['VALOR', 'PORTE', 'CH']).nullable(),
  /**
   * Só explicação (modelos CH e PORTE): o valor pela regra do modelo com os índices do convênio. Nunca é o
   * total; o novo não calcula a conta (o motor é o do legado). null no modelo VALOR ou se falta índice.
   */
  estimativaPeloModelo: z.number().nullable(),
  passos: z.array(z.string()),
  falta: z.array(z.string()),
});
export type ValorVigente = z.infer<typeof esquemaValorVigente>;

// ── Importação versionada ──────────────────────────────────────────────────────────────────────────

export const esquemaCargaResumo = z.object({
  id: z.number(),
  catalogo: z.string(),
  tabela: z.number().nullable(),
  arquivo: z.string(),
  sha256: z.string(),
  bytes: z.number(),
  situacao: z.enum(['preparada', 'validada', 'comparada', 'publicada', 'rejeitada']),
  responsavel: z.string(),
  aprovador: z.string().nullable(),
  criadaEm: z.string(),
  totais: z.object({
    linhas: z.number(),
    validas: z.number(),
    erros: z.number(),
    novos: z.number(),
    removidos: z.number(),
    alterados: z.number(),
    iguais: z.number(),
  }),
  lote: z.string().nullable(),
  motivo: z.string().nullable(),
});
export type CargaResumo = z.infer<typeof esquemaCargaResumo>;
export const esquemaListaCargas = z.object({ cargas: z.array(esquemaCargaResumo) });

export const esquemaCargaDetalhe = z.object({
  carga: esquemaCargaResumo,
  linhas: z.array(
    z.object({
      linha: z.number().nullable(),
      codigo: z.number().nullable(),
      nome: z.string().nullable(),
      resultado: z.string(),
      comparacao: z.string().nullable(),
      antes: esquemaComponentes.nullable(),
      depois: z.record(z.string(), z.number()).nullable(),
      motivo: z.string().nullable(),
    }),
  ),
  total: z.number(),
  pagina: z.number(),
  porPagina: z.number(),
});
export type CargaDetalhe = z.infer<typeof esquemaCargaDetalhe>;

// ── Motor de preços (consulta) ─────────────────────────────────────────────────────────────────────

export const esquemaPaginaGenerica = z.object({
  colunas: z.array(z.object({ campo: z.string(), rotulo: z.string() })),
  itens: z.array(z.record(z.string(), z.union([z.string(), z.number(), z.null()]))),
  total: z.number(),
  pagina: z.number(),
  porPagina: z.number(),
  avisos: z.array(z.string()),
});
export type PaginaGenerica = z.infer<typeof esquemaPaginaGenerica>;

export const esquemaSaneamento = z.object({
  porOrigem: z.record(z.string(), z.number()),
  achados: z.array(
    z.object({ origem: z.string(), chave: z.string(), data: z.string().nullable(), motivo: z.string() }),
  ),
});
export type Saneamento = z.infer<typeof esquemaSaneamento>;
