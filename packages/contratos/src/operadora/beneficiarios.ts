// Contratos da fatia F1 da operadora própria (M56.2; ficha, seções 4, 6, 7 e 8): a operadora como empresa distinta
// (registro na ANS, CNPJ e modalidade; regra 3), os produtos e planos com registro na ANS (natureza, segmentação,
// abrangência, acomodação, coparticipação, carências e a tabela de preços por faixa etária; regra 2), os contratos de
// pessoa física e jurídica (reajuste e vigência) e os beneficiários (titular e dependentes, carteirinha, segunda via,
// baixa e a ligação só por ID com o paciente do hospital; regra 8), mais a elegibilidade pela carteirinha. Tudo em
// SGH_OPE_* (nenhuma escrita em tabela do sistema anterior), atrás da chave `operadora.beneficiarios` (que só vale com
// a do módulo). Os códigos dos domínios são os do vocabulário (vocabulario.ts); a tela mostra o rótulo.
import { z } from 'zod';
import { idBancoTexto } from '../validacao/id-banco.js';
import { esquemaDataIso } from '../preco/entradas.js';
import { normalizarTextoCp1252, textoCp1252 } from '../texto-cp1252.js';

// ── Vocabulário próprio da fatia (códigos do novo, gravados em SGH_OPE_*) ────────────────────────────────────────

/** Modalidade da operadora na ANS (classificação das operadoras de planos de saúde). */
export const MODALIDADES_OPERADORA = {
  medicinaGrupo: 'Medicina de grupo',
  cooperativaMedica: 'Cooperativa médica',
  autogestao: 'Autogestão',
  filantropia: 'Filantropia',
  seguradora: 'Seguradora especializada em saúde',
  odontologiaGrupo: 'Odontologia de grupo',
  cooperativaOdontologica: 'Cooperativa odontológica',
} as const;
export type ModalidadeOperadora = keyof typeof MODALIDADES_OPERADORA;

export const SITUACOES_OPERADORA = { ativa: 'Ativa', inativa: 'Inativa' } as const;
export type SituacaoOperadoraEmpresa = keyof typeof SITUACOES_OPERADORA;

export const SITUACOES_PRODUTO = {
  ativo: 'Ativo',
  suspenso: 'Comercialização suspensa',
  cancelado: 'Cancelado',
} as const;
export type SituacaoProduto = keyof typeof SITUACOES_PRODUTO;

export const SITUACOES_CONTRATO = { ativo: 'Ativo', suspenso: 'Suspenso', encerrado: 'Encerrado' } as const;
export type SituacaoContrato = keyof typeof SITUACOES_CONTRATO;

export const SITUACOES_BENEFICIARIO = { ativo: 'Ativo', suspenso: 'Suspenso', excluido: 'Excluído' } as const;
export type SituacaoBeneficiario = keyof typeof SITUACOES_BENEFICIARIO;

export const SEXOS_BENEFICIARIO = { F: 'Feminino', M: 'Masculino', I: 'Não informado' } as const;
export type SexoBeneficiario = keyof typeof SEXOS_BENEFICIARIO;

/**
 * As 10 faixas etárias da tabela de preços (RN ANS 63/2003): o preço da última não passa de 6 vezes o da primeira e a
 * variação acumulada entre a 7ª e a 10ª não passa da variação acumulada entre a 1ª e a 7ª.
 */
export const FAIXAS_ETARIAS_ANS = [
  { de: 0, ate: 18, rotulo: '0 a 18 anos' },
  { de: 19, ate: 23, rotulo: '19 a 23 anos' },
  { de: 24, ate: 28, rotulo: '24 a 28 anos' },
  { de: 29, ate: 33, rotulo: '29 a 33 anos' },
  { de: 34, ate: 38, rotulo: '34 a 38 anos' },
  { de: 39, ate: 43, rotulo: '39 a 43 anos' },
  { de: 44, ate: 48, rotulo: '44 a 48 anos' },
  { de: 49, ate: 53, rotulo: '49 a 53 anos' },
  { de: 54, ate: 58, rotulo: '54 a 58 anos' },
  { de: 59, ate: null, rotulo: '59 anos ou mais' },
] as const;

/**
 * Carências do produto, com o teto legal de cada uma (Lei 9.656/1998, art. 12, V; e a cobertura parcial temporária
 * das doenças e lesões preexistentes, até 24 meses).
 */
export const CARENCIAS_PRODUTO = {
  urgencia: { rotulo: 'Urgência e emergência', unidade: 'dias', maximo: 1 },
  partos: { rotulo: 'Partos a termo', unidade: 'dias', maximo: 300 },
  demais: { rotulo: 'Demais casos (consultas, exames, internações)', unidade: 'dias', maximo: 180 },
  cpt: { rotulo: 'Cobertura parcial temporária (doença preexistente)', unidade: 'meses', maximo: 24 },
} as const;
export type TipoCarencia = keyof typeof CARENCIAS_PRODUTO;
export const TIPOS_CARENCIA = Object.keys(CARENCIAS_PRODUTO) as TipoCarencia[];

// ── Esquemas comuns ─────────────────────────────────────────────────────────────────────────────────────────────

/** Data de calendário (dia que existe) a partir de 1900: as datas sentinela do outro sistema (1899-12-30, 0001-01-01) saem. */
export const DATA_MINIMA_OPERADORA = '1900-01-01';
const data = esquemaDataIso.refine((d) => d >= DATA_MINIMA_OPERADORA, 'Data anterior a 1900 não é aceita.');
/** Texto que vai a SGH_OPE_* (coluna sem charset, gravada em CP1252): o mesmo validador da tela (ADR 0008). */
const textoAparado = (max: number) =>
  z
    .string()
    .overwrite((t) => normalizarTextoCp1252(t).trim())
    .pipe(textoCp1252(max));
const texto = (max: number) => textoAparado(max).refine((t) => t !== '', 'Campo obrigatório.');
const textoOpcional = (max: number) =>
  textoAparado(max)
    .nullable()
    .optional()
    .transform((v) => (v ? v : null));
const digitos = (min: number, max: number) =>
  z
    .string()
    .transform((v) => v.replace(/\D/g, ''))
    .pipe(z.string().min(min).max(max));
const id = z.coerce.number().int().positive().max(9_007_199_254_740_991);
const versao = z.coerce.number().int().min(0).max(2_147_483_647);
const chaves = <T extends Record<string, unknown>>(o: T) =>
  Object.keys(o) as [keyof T & string, ...(keyof T & string)[]];

// ── Operadora (empresa) ─────────────────────────────────────────────────────────────────────────────────────────

export const esquemaOperadoraEntrada = z.object({
  registroAns: digitos(6, 6),
  cnpj: digitos(14, 14),
  razaoSocial: texto(120),
  nomeFantasia: textoOpcional(60),
  modalidade: z.enum(chaves(MODALIDADES_OPERADORA)),
  situacao: z.enum(chaves(SITUACOES_OPERADORA)).default('ativa'),
  /** Na alteração: a versão lida (concorrência otimista). */
  versao: versao.optional(),
});
export type OperadoraEntrada = z.infer<typeof esquemaOperadoraEntrada>;

export const esquemaOperadoraEmpresa = z.object({
  id: z.number().int(),
  registroAns: z.string(),
  cnpj: z.string(),
  razaoSocial: z.string(),
  nomeFantasia: z.string().nullable(),
  modalidade: z.enum(chaves(MODALIDADES_OPERADORA)),
  situacao: z.enum(chaves(SITUACOES_OPERADORA)),
  versao: z.number().int(),
  alteradoEm: z.string(),
});
export type OperadoraEmpresa = z.infer<typeof esquemaOperadoraEmpresa>;

// ── Produto e plano ─────────────────────────────────────────────────────────────────────────────────────────────

export const esquemaCarencias = z.object({
  urgencia: z.coerce.number().int().min(0).max(9999),
  partos: z.coerce.number().int().min(0).max(9999),
  demais: z.coerce.number().int().min(0).max(9999),
  cpt: z.coerce.number().int().min(0).max(9999),
});
export type CarenciasProduto = z.infer<typeof esquemaCarencias>;

export const esquemaProdutoEntrada = z.object({
  operadora: id,
  codigo: texto(20),
  nome: texto(80),
  natureza: z.enum(['plano', 'cartaoDesconto']),
  registroAns: z
    .string()
    .nullable()
    .optional()
    .transform((v) => (v ? v.replace(/\D/g, '') || v : null)),
  tipoContratacao: z.coerce.number().int().min(1).max(3),
  segmentacao: z
    .enum([
      'ambulatorial',
      'hospitalarSemObstetricia',
      'hospitalarComObstetricia',
      'ambulatorialHospitalar',
      'odontologico',
      'referencia',
    ])
    .nullable()
    .optional()
    .transform((v) => v ?? null),
  abrangencia: z
    .enum(['municipal', 'grupoMunicipios', 'estadual', 'grupoEstados', 'nacional'])
    .nullable()
    .optional()
    .transform((v) => v ?? null),
  acomodacao: z.coerce
    .number()
    .int()
    .min(1)
    .max(3)
    .nullable()
    .optional()
    .transform((v) => v ?? null),
  coparticipacao: z.object({
    tipo: z.coerce.number().int().min(1).max(3),
    valor: z.coerce.number().min(0).max(99_999_999).nullable(),
  }),
  carencias: esquemaCarencias,
  /** Preço mensal por faixa etária (as 10 da RN 63), em reais; null no cartão de desconto sem tabela. */
  precos: z.array(z.coerce.number().min(0).max(999_999)).length(10).nullable(),
  situacao: z.enum(chaves(SITUACOES_PRODUTO)).default('ativo'),
  versao: versao.optional(),
});
export type ProdutoEntrada = z.infer<typeof esquemaProdutoEntrada>;

export const esquemaProdutoOperadora = z.object({
  id: z.number().int(),
  operadora: z.number().int(),
  codigo: z.string(),
  nome: z.string(),
  natureza: z.enum(['plano', 'cartaoDesconto']),
  registroAns: z.string().nullable(),
  tipoContratacao: z.number().int(),
  segmentacao: z.string().nullable(),
  abrangencia: z.string().nullable(),
  acomodacao: z.number().int().nullable(),
  coparticipacao: z.object({ tipo: z.number().int(), valor: z.number().nullable() }),
  carencias: esquemaCarencias,
  precos: z.array(z.number()).nullable(),
  situacao: z.enum(chaves(SITUACOES_PRODUTO)),
  versao: z.number().int(),
  alteradoEm: z.string(),
});
export type ProdutoOperadora = z.infer<typeof esquemaProdutoOperadora>;

// ── Contrato ────────────────────────────────────────────────────────────────────────────────────────────────────

export const esquemaContratoEntrada = z.object({
  produto: id,
  numero: texto(20),
  /** 1 pessoa física (individual ou familiar), 2 pessoa jurídica (coletivo). */
  tipo: z.coerce.number().int().min(1).max(2),
  contratanteNome: texto(120),
  /** CPF (11 dígitos) na pessoa física, CNPJ (14) na jurídica. */
  contratanteDocumento: digitos(11, 14),
  formaReajuste: z.coerce.number().int().min(1).max(8),
  mesReajuste: z.coerce.number().int().min(1).max(12),
  tipoVigencia: z.coerce.number().int().min(1).max(2),
  inicio: data,
  fim: data
    .nullable()
    .optional()
    .transform((v) => v ?? null),
  diaVencimento: z.coerce
    .number()
    .int()
    .min(1)
    .max(31)
    .nullable()
    .optional()
    .transform((v) => v ?? null),
  situacao: z.enum(chaves(SITUACOES_CONTRATO)).default('ativo'),
  motivoSituacao: textoOpcional(200),
  versao: versao.optional(),
});
export type ContratoEntrada = z.infer<typeof esquemaContratoEntrada>;

export const esquemaContratoOperadora = z.object({
  id: z.number().int(),
  operadora: z.number().int(),
  produto: z.number().int(),
  produtoNome: z.string(),
  numero: z.string(),
  tipo: z.number().int(),
  tipoContratacao: z.number().int(),
  contratanteNome: z.string(),
  /** Mascarado na lista; inteiro só na leitura do contrato (auditada). */
  contratanteDocumento: z.string(),
  formaReajuste: z.number().int(),
  mesReajuste: z.number().int(),
  tipoVigencia: z.number().int(),
  inicio: z.string(),
  fim: z.string().nullable(),
  diaVencimento: z.number().int().nullable(),
  situacao: z.enum(chaves(SITUACOES_CONTRATO)),
  motivoSituacao: z.string().nullable(),
  beneficiariosAtivos: z.number().int(),
  versao: z.number().int(),
  alteradoEm: z.string(),
});
export type ContratoOperadora = z.infer<typeof esquemaContratoOperadora>;

export const esquemaFiltroContratos = z.object({
  operadora: id.optional(),
  produto: id.optional(),
  /** Número do contrato (início) ou trecho do nome do contratante (início, sem acento). */
  busca: z.string().trim().min(1).max(60).optional(),
  apos: id.optional(),
});
export type FiltroContratos = z.infer<typeof esquemaFiltroContratos>;
export const esquemaContratos = z.object({
  itens: z.array(esquemaContratoOperadora),
  proxima: z.number().int().nullable(),
});
export type ContratosOperadora = z.infer<typeof esquemaContratos>;

// ── Beneficiário ────────────────────────────────────────────────────────────────────────────────────────────────

export const esquemaBeneficiarioEntrada = z.object({
  contrato: id,
  /** O titular (null para o próprio titular, vínculo 1). */
  titular: id
    .nullable()
    .optional()
    .transform((v) => v ?? null),
  vinculo: z.coerce.number().int().min(1).max(8),
  nome: texto(120),
  nomeSocial: textoOpcional(120),
  cpf: z
    .string()
    .nullable()
    .optional()
    .transform((v) => (v ? v.replace(/\D/g, '') || v : null)),
  nascimento: data,
  sexo: z.enum(chaves(SEXOS_BENEFICIARIO)),
  cns: z
    .string()
    .nullable()
    .optional()
    .transform((v) => (v ? v.replace(/\D/g, '') || v : null)),
  nomeMae: texto(120),
  /** Data de adesão (início das carências). */
  inclusao: data,
  /** Regra 8: o paciente do hospital que é o mesmo beneficiário (só o ID, sem dado clínico). */
  pacienteHospital: idBancoTexto
    .nullable()
    .optional()
    .transform((v) => v ?? null),
  versao: versao.optional(),
});
export type BeneficiarioEntrada = z.infer<typeof esquemaBeneficiarioEntrada>;

export const esquemaBaixaBeneficiario = z.object({
  motivo: z.coerce.number().int().min(0).max(32767),
  data,
  versao,
});
export type BaixaBeneficiario = z.infer<typeof esquemaBaixaBeneficiario>;

export const esquemaReativacaoBeneficiario = z.object({ versao });

export const esquemaPedidoCarteirinha = z.object({
  /** Motivo da segunda via (domínio dos motivos de solicitação de carteirinha); null na primeira via. */
  motivo: z.coerce
    .number()
    .int()
    .min(0)
    .max(32767)
    .nullable()
    .optional()
    .transform((v) => v ?? null),
  versao,
});
export type PedidoCarteirinha = z.infer<typeof esquemaPedidoCarteirinha>;

const esquemaBeneficiarioBase = z.object({
  id: z.number().int(),
  contrato: z.number().int(),
  contratoNumero: z.string(),
  produtoNome: z.string(),
  titular: z.number().int().nullable(),
  vinculo: z.number().int(),
  nome: z.string(),
  nomeSocial: z.string().nullable(),
  carteirinha: z.string(),
  via: z.number().int(),
  situacao: z.enum(chaves(SITUACOES_BENEFICIARIO)),
  /** CPF mascarado na lista (só os dígitos do meio). */
  cpf: z.string().nullable(),
});

export const esquemaBeneficiarioLista = esquemaBeneficiarioBase;
export type BeneficiarioLista = z.infer<typeof esquemaBeneficiarioLista>;

export const esquemaCarteirinhaEmitida = z.object({
  via: z.number().int(),
  motivo: z.number().int().nullable(),
  validade: z.string(),
  emitidaPor: z.string(),
  emitidaEm: z.string(),
});
export type CarteirinhaEmitida = z.infer<typeof esquemaCarteirinhaEmitida>;

export const esquemaBeneficiarioFicha = esquemaBeneficiarioBase.extend({
  /** Inteiro na ficha (leitura auditada). */
  cpf: z.string().nullable(),
  nascimento: z.string(),
  sexo: z.enum(chaves(SEXOS_BENEFICIARIO)),
  cns: z.string().nullable(),
  nomeMae: z.string(),
  inclusao: z.string(),
  exclusao: z.string().nullable(),
  motivoBaixa: z.number().int().nullable(),
  pacienteHospital: z.number().int().nullable(),
  operadora: z.number().int(),
  registroAnsOperadora: z.string(),
  dependentes: z.array(esquemaBeneficiarioBase),
  carteirinhas: z.array(esquemaCarteirinhaEmitida),
  versao: z.number().int(),
  alteradoEm: z.string(),
});
export type BeneficiarioFicha = z.infer<typeof esquemaBeneficiarioFicha>;

export const esquemaFiltroBeneficiarios = z.object({
  operadora: id.optional(),
  contrato: id.optional(),
  /** Carteirinha (só números, 16 dígitos), CPF (11 dígitos) ou o início do nome (sem acento). */
  busca: z.string().trim().min(2).max(60).optional(),
  situacao: z.enum(chaves(SITUACOES_BENEFICIARIO)).optional(),
  apos: id.optional(),
});
export type FiltroBeneficiarios = z.infer<typeof esquemaFiltroBeneficiarios>;
export const esquemaBeneficiarios = z.object({
  itens: z.array(esquemaBeneficiarioLista),
  proxima: z.number().int().nullable(),
});
export type BeneficiariosOperadora = z.infer<typeof esquemaBeneficiarios>;

// ── Elegibilidade ───────────────────────────────────────────────────────────────────────────────────────────────

export const MOTIVOS_INELEGIBILIDADE = [
  'carteirinha-invalida',
  'nao-encontrado',
  'beneficiario-suspenso',
  'beneficiario-excluido',
  'contrato-inativo',
  'contrato-fora-da-vigencia',
  'produto-cancelado',
  'antes-da-inclusao',
  /** W0-10 (M7): a via mais recente da carteirinha venceu antes da data do atendimento (portal do prestador). */
  'carteirinha-vencida',
] as const;
export type MotivoInelegibilidade = (typeof MOTIVOS_INELEGIBILIDADE)[number];

export const esquemaFiltroElegibilidade = z.object({
  carteirinha: z
    .string()
    .trim()
    .min(1)
    .max(30)
    .transform((v) => v.replace(/\D/g, '')),
  /** Data do atendimento (padrão: hoje). */
  data: data.optional(),
});

export const esquemaCarenciaSituacao = z.object({
  tipo: z.enum(['urgencia', 'partos', 'demais', 'cpt']),
  cumpridaEm: z.string(),
  cumprida: z.boolean(),
});
export type CarenciaSituacao = z.infer<typeof esquemaCarenciaSituacao>;

export const esquemaElegibilidade = z.object({
  carteirinha: z.string(),
  data: z.string(),
  elegivel: z.boolean(),
  motivos: z.array(z.enum(MOTIVOS_INELEGIBILIDADE)),
  /** Null quando a carteirinha não existe. */
  beneficiario: z
    .object({ id: z.number().int(), nome: z.string(), situacao: z.enum(chaves(SITUACOES_BENEFICIARIO)) })
    .nullable(),
  plano: z
    .object({
      nome: z.string(),
      registroAns: z.string().nullable(),
      natureza: z.enum(['plano', 'cartaoDesconto']),
      segmentacao: z.string().nullable(),
      abrangencia: z.string().nullable(),
      acomodacao: z.number().int().nullable(),
    })
    .nullable(),
  carencias: z.array(esquemaCarenciaSituacao),
});
export type Elegibilidade = z.infer<typeof esquemaElegibilidade>;

// ── Tela ────────────────────────────────────────────────────────────────────────────────────────────────────────

export const esquemaItemDominioOperadora = z.object({ codigo: z.number().int(), nome: z.string() });
export type ItemDominioOperadora = z.infer<typeof esquemaItemDominioOperadora>;

export const esquemaTelaBeneficiarios = z.object({
  /** A chave da fatia vale (com a do módulo)? Desligada: a tela só diz o que falta. */
  liberacao: z.object({ ligada: z.boolean(), motivo: z.string().nullable() }),
  acoes: z.object({
    editar: z.boolean(),
    editarEmpresa: z.boolean(),
    motivo: z.string().nullable(),
  }),
  operadoras: z.array(esquemaOperadoraEmpresa),
  produtos: z.array(esquemaProdutoOperadora),
  dominios: z.object({
    motivosBaixa: z.array(esquemaItemDominioOperadora),
    motivosSegundaVia: z.array(esquemaItemDominioOperadora),
    /** Dias de vencimento permitidos (vazio: qualquer dia de 1 a 28). */
    diasVencimento: z.array(z.number().int()),
  }),
});
export type TelaBeneficiarios = z.infer<typeof esquemaTelaBeneficiarios>;

export const esquemaResultadoOperadora = z.object({
  ok: z.literal(true),
  id: z.number().int(),
  mensagem: z.string(),
  /** A carteirinha gerada na inclusão do beneficiário. */
  carteirinha: z.string().optional(),
});
export type ResultadoOperadora = z.infer<typeof esquemaResultadoOperadora>;

/** Permissões e rotas da fatia F1 (D-EMPRESA-56: a empresa pede `operadora.empresa.editar`, só do gestor). */
export const ROTAS_OPERADORA_F1 = {
  tela: { caminho: 'operadora/beneficiarios/tela', permissao: 'operadora.beneficiario.ler' },
  operadoras: { caminho: 'operadora/empresas', permissao: 'operadora.beneficiario.ler' },
  gravarOperadora: { caminho: 'operadora/empresas', permissao: 'operadora.empresa.editar' },
  produtos: { caminho: 'operadora/produtos', permissao: 'operadora.beneficiario.ler' },
  gravarProduto: { caminho: 'operadora/produtos', permissao: 'operadora.beneficiario.editar' },
  contratos: { caminho: 'operadora/contratos', permissao: 'operadora.beneficiario.ler' },
  gravarContrato: { caminho: 'operadora/contratos', permissao: 'operadora.beneficiario.editar' },
  beneficiarios: { caminho: 'operadora/beneficiarios', permissao: 'operadora.beneficiario.ler' },
  gravarBeneficiario: { caminho: 'operadora/beneficiarios', permissao: 'operadora.beneficiario.editar' },
  elegibilidade: { caminho: 'operadora/elegibilidade', permissao: 'operadora.beneficiario.ler' },
} as const;

/** Chave da fatia F1 em SGH_CFG_LIBERACAO. */
export const CHAVE_FATIA_BENEFICIARIOS = 'operadora.beneficiarios' as const;
