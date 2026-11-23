// Faturamento SUS próprio (M51; ficha, seções 5, 7, 8 e 10): vocabulário e entradas da competência SUS por instrumento,
// da crítica prévia e da exportação da CIHA (etapa 1). As etapas 2 a 4 (BPA, APAC, AIH) usam o mesmo vocabulário e ficam
// desligadas por estabelecimento (DP-35, POL-3). A conta é uma só, com financiador (regra 1): nada aqui cria conta SUS.
// Nenhuma entrada carrega dado pessoal: a tela manda competência, instrumento e chaves; o servidor lê o resto.
import { z } from 'zod';
import { textoCp1252 } from '../texto-cp1252.js';
import { idBanco, idBancoTexto } from '../validacao/id-banco.js';

/** Instrumentos de saída do faturamento SUS (cap-06b §6.6; cap-12 §12.4). */
export const INSTRUMENTOS_SUS = ['ciha', 'bpa', 'apac', 'aih'] as const;
export type InstrumentoSus = (typeof INSTRUMENTOS_SUS)[number];

/** Situação da competência SUS (SGH_FAT_SUS_COMPETENCIA.SITUACAO). */
export const SITUACOES_COMPETENCIA_SUS = ['aberta', 'fechada'] as const;
export type SituacaoCompetenciaSus = (typeof SITUACOES_COMPETENCIA_SUS)[number];

/** Competência no formato do Ministério: AAAAMM, mês 01 a 12, de 2008 (início da SIGTAP) a 2099. */
export const FORMATO_COMPETENCIA_SUS = /^(20[0-9]{2})(0[1-9]|1[0-2])$/;
export const esquemaCompetenciaSus = z
  .string()
  .regex(FORMATO_COMPETENCIA_SUS)
  .refine((c) => c >= '200801', { message: 'competencia-antes-da-sigtap' });
export type CompetenciaSus = z.infer<typeof esquemaCompetenciaSus>;

/** Modalidade do registro CIHA: internação (sempre informada) ou atendimento ambulatorial não informado no SIA. */
export const MODALIDADES_CIHA = ['internacao', 'ambulatorial'] as const;
export type ModalidadeCiha = (typeof MODALIDADES_CIHA)[number];

/**
 * Fontes de remuneração aceitas pela CIHA (Portaria GM/MS 1.171/2011; Portaria GM/MS 2.905/2022; referência 08 do
 * planejamento). O código numérico de cada fonte no arquivo vem do leiaute do CIHA01 (a conferir na versão vigente).
 */
export const FONTES_REMUNERACAO_CIHA = [
  'plano-privado',
  'plano-publico',
  'particular-pf',
  'particular-pj',
  'programa-federal',
  'recurso-proprio-gestor',
  'dpvat',
  'gratuidade',
  'consorcio-publico',
] as const;
export type FonteRemuneracaoCiha = (typeof FONTES_REMUNERACAO_CIHA)[number];

/** Gravidade da crítica: a bloqueante impede o fechamento e a geração; o aviso só registra. */
export const GRAVIDADES_CRITICA_SUS = ['bloqueante', 'aviso'] as const;
export type GravidadeCriticaSus = (typeof GRAVIDADES_CRITICA_SUS)[number];

/**
 * Regras da crítica prévia (ficha, seção 5: `faturamento.criticarSus`; regras 2, 3 e 5). Cada código tem texto em
 * `apps/web/src/modulos/faturamento/i18n-sus.ts`. A etapa 2 acrescenta as do validador de compatibilidade (CID, CBO,
 * habilitação, leito e instrumento de registro pela SIGTAP da competência) e as da identificação do profissional.
 */
export const REGRAS_CRITICA_SUS = [
  'sem-sigtap',
  'item-sem-sigtap',
  'sigtap-fora-da-competencia',
  'sem-cid-principal',
  'cid-invalido',
  'sem-identificacao',
  'cns-invalido',
  'cpf-invalido',
  'sexo-incompativel',
  'idade-incompativel',
  'quantidade-acima-do-maximo',
  'fonte-remuneracao-indefinida',
  'data-fora-da-competencia',
  'dado-minimo-ausente',
  'sem-cnes',
  // Etapa 2 (validador de compatibilidade da SIGTAP da competência e identificação do profissional; BPA).
  'cid-incompativel',
  'cbo-incompativel',
  'sem-cbo',
  'habilitacao-ausente',
  'leito-incompativel',
  'instrumento-incompativel',
  'profissional-sem-identificacao',
  'sem-cns-paciente',
  // Etapa 3 (APAC): a produção do procedimento de APAC sem autorização, a APAC sem produção na competência, o número e o
  // autorizador da autorização e o laudo específico exigido pelo procedimento.
  'apac-sem-autorizacao',
  'apac-sem-producao',
  'apac-numero-invalido',
  'autorizador-sem-identificacao',
  'laudo-especifico-ausente',
  // Etapa 4 (AIH; regra 6): a internação SUS sem AIH, o laudo sem autorização, o número fora do dígito ou da faixa, a AIH
  // autorizada ainda não fechada, a permanência incoerente (ou abaixo da metade da média da SIGTAP) e as diárias de UTI
  // sem tipo do SIH ou sem leito habilitado.
  'aih-sem-laudo',
  'aih-sem-autorizacao',
  'aih-numero-invalido',
  'aih-nao-fechada',
  'permanencia-incoerente',
  'permanencia-abaixo-da-media',
  'uti-sem-tipo-sih',
  'uti-nao-habilitada',
] as const;
export type RegraCriticaSus = (typeof REGRAS_CRITICA_SUS)[number];

/** Gravidade padrão de cada regra (o administrador não rebaixa bloqueante: é exigência do leiaute ou da norma). */
export const GRAVIDADE_DA_REGRA_SUS: Readonly<Record<RegraCriticaSus, GravidadeCriticaSus>> = {
  'sem-sigtap': 'bloqueante',
  'item-sem-sigtap': 'aviso',
  'sigtap-fora-da-competencia': 'bloqueante',
  'sem-cid-principal': 'bloqueante',
  'cid-invalido': 'bloqueante',
  'sem-identificacao': 'bloqueante',
  'cns-invalido': 'bloqueante',
  'cpf-invalido': 'bloqueante',
  'sexo-incompativel': 'bloqueante',
  'idade-incompativel': 'bloqueante',
  'quantidade-acima-do-maximo': 'aviso',
  'fonte-remuneracao-indefinida': 'bloqueante',
  'data-fora-da-competencia': 'bloqueante',
  'dado-minimo-ausente': 'bloqueante',
  'sem-cnes': 'bloqueante',
  'cid-incompativel': 'bloqueante',
  'cbo-incompativel': 'bloqueante',
  'sem-cbo': 'bloqueante',
  'habilitacao-ausente': 'bloqueante',
  'leito-incompativel': 'bloqueante',
  'instrumento-incompativel': 'bloqueante',
  'profissional-sem-identificacao': 'bloqueante',
  'sem-cns-paciente': 'bloqueante',
  'apac-sem-autorizacao': 'aviso',
  'apac-sem-producao': 'aviso',
  'apac-numero-invalido': 'bloqueante',
  'autorizador-sem-identificacao': 'bloqueante',
  'laudo-especifico-ausente': 'bloqueante',
  'aih-sem-laudo': 'aviso',
  'aih-sem-autorizacao': 'bloqueante',
  'aih-numero-invalido': 'bloqueante',
  'aih-nao-fechada': 'aviso',
  'permanencia-incoerente': 'bloqueante',
  'permanencia-abaixo-da-media': 'aviso',
  'uti-sem-tipo-sih': 'bloqueante',
  'uti-nao-habilitada': 'bloqueante',
};

/** Situação da crítica: aberta, corrigida na origem (a nova crítica não a acusa) ou justificada (só aviso). */
export const SITUACOES_CRITICA_SUS = ['aberta', 'corrigida', 'justificada'] as const;
export type SituacaoCriticaSus = (typeof SITUACOES_CRITICA_SUS)[number];

/** Estado do arquivo exportado (SGH_FAT_SUS_ARQUIVO.SITUACAO): gerado, conferido contra o envio atual, enviado. */
export const SITUACOES_ARQUIVO_SUS = ['gerado', 'conferido', 'enviado', 'substituido'] as const;
export type SituacaoArquivoSus = (typeof SITUACOES_ARQUIVO_SUS)[number];

const versao = z.string().min(10).max(40);
/** Texto livre gravado no banco charset NONE: só CP1252 (ADR 0008), com a troca proposta na recusa. */
const justificativa = textoCp1252(500).pipe(z.string().trim().min(10));

/** faturamento.abrirCompetenciaSus: uma competência por instrumento e estabelecimento (o hospital é a sessão). */
export const esquemaAbrirCompetenciaSus = z
  .object({ instrumento: z.enum(INSTRUMENTOS_SUS), competencia: esquemaCompetenciaSus })
  .strict();
export type AbrirCompetenciaSusEntrada = z.infer<typeof esquemaAbrirCompetenciaSus>;

/** faturamento.fecharCompetenciaSus: só sem crítica bloqueante aberta; versão para o controle otimista. */
export const esquemaFecharCompetenciaSus = z
  .object({
    instrumento: z.enum(INSTRUMENTOS_SUS),
    competencia: esquemaCompetenciaSus,
    versao,
  })
  .strict();
export type FecharCompetenciaSusEntrada = z.infer<typeof esquemaFecharCompetenciaSus>;

/** Reabrir a competência fechada (supervisor): só com justificativa; o arquivo gerado vira "substituído" ao gerar outro. */
export const esquemaReabrirCompetenciaSus = z
  .object({
    instrumento: z.enum(INSTRUMENTOS_SUS),
    competencia: esquemaCompetenciaSus,
    versao,
    justificativa,
  })
  .strict();
export type ReabrirCompetenciaSusEntrada = z.infer<typeof esquemaReabrirCompetenciaSus>;

/** faturamento.criticarSus: roda a crítica prévia da competência (substitui as críticas abertas da execução anterior). */
export const esquemaCriticarSus = z
  .object({ instrumento: z.enum(INSTRUMENTOS_SUS), competencia: esquemaCompetenciaSus })
  .strict();
export type CriticarSusEntrada = z.infer<typeof esquemaCriticarSus>;

/** Justificar uma crítica de aviso (a bloqueante só sai corrigindo a origem: de-para no M13, cadastro no M11). */
export const esquemaJustificarCriticaSus = z
  .object({ critica: z.number().int().positive(), versao, justificativa })
  .strict();
export type JustificarCriticaSusEntrada = z.infer<typeof esquemaJustificarCriticaSus>;

/** faturamento.gerarCiha: a competência precisa estar aberta e sem bloqueante; sem registro, remessa "sem movimento". */
export const esquemaGerarCiha = z.object({ competencia: esquemaCompetenciaSus, versao }).strict();
export type GerarCihaEntrada = z.infer<typeof esquemaGerarCiha>;

/** Filtro da lista de registros e de críticas da competência (paginação no servidor). */
export const esquemaFiltroCriticasSus = z
  .object({
    instrumento: z.enum(INSTRUMENTOS_SUS),
    competencia: esquemaCompetenciaSus,
    regra: z.enum(REGRAS_CRITICA_SUS).optional(),
    gravidade: z.enum(GRAVIDADES_CRITICA_SUS).optional(),
    situacao: z.enum(SITUACOES_CRITICA_SUS).optional(),
    pagina: z.coerce.number().int().min(0).default(0),
    porPagina: z.coerce.number().int().min(10).max(200).default(50),
  })
  .strict();
export type FiltroCriticasSus = z.infer<typeof esquemaFiltroCriticasSus>;

/**
 * faturamento.registrarEquivalenciaSus: o procedimento do hospital (o procedimento unificado de
 * uma tabela do convênio; o mesmo código PROCTO é outro procedimento em outra tabela) → o código SIGTAP (10 dígitos).
 * `versao`: a da equivalência que a tela leu, obrigatória quando já existe uma (ativa ou desativada) para o procedimento.
 */
export const esquemaRegistrarEquivalenciaSus = z
  .object({
    procedimento: idBanco,
    sigtap: z.string().regex(/^\d{10}$/),
    versao: versao.optional(),
  })
  .strict();
export type RegistrarEquivalenciaSusEntrada = z.infer<typeof esquemaRegistrarEquivalenciaSus>;

/** faturamento.desativarEquivalenciaSus: a equivalência deixa de valer (nada é apagado; a crítica volta na CIHA). */
export const esquemaDesativarEquivalenciaSus = z.object({ procedimento: idBanco, versao }).strict();
export type DesativarEquivalenciaSusEntrada = z.infer<typeof esquemaDesativarEquivalenciaSus>;

/** A lista de equivalências (paginação no servidor; busca por código ou nome de qualquer dos dois procedimentos). */
export const esquemaFiltroEquivalenciasSus = z
  .object({
    termo: z.string().trim().max(60).optional(),
    /** Só a do procedimento do hospital (o diálogo confere se já existe uma). */
    procedimento: idBancoTexto.optional(),
    inativas: z.enum(['sim', 'nao']).default('nao'),
    pagina: z.coerce.number().int().min(0).default(0),
    porPagina: z.coerce.number().int().min(10).max(200).default(50),
  })
  .strict();
export type FiltroEquivalenciasSus = z.infer<typeof esquemaFiltroEquivalenciasSus>;

/** Busca no servidor (lista grande: o catálogo SIGTAP e o cadastro de procedimentos do hospital), de 2 a 60 caracteres. */
export const esquemaBuscaProcedimentoSus = z
  .object({
    termo: z.string().trim().min(2).max(60),
    /** SIGTAP: a competência que diz a vigência (o resultado marca o fora de vigência). */
    competencia: esquemaCompetenciaSus.optional(),
  })
  .strict();
export type BuscaProcedimentoSus = z.infer<typeof esquemaBuscaProcedimentoSus>;

/** Um procedimento SIGTAP achado na busca. */
export const esquemaSigtapAchado = z.object({
  id: z.number().int(),
  codigo: z.string(),
  nome: z.string(),
  /** Vigente na competência pedida (sem competência: true). */
  vigente: z.boolean(),
});
export type SigtapAchado = z.infer<typeof esquemaSigtapAchado>;

/** Um procedimento do hospital (o código na tabela do convênio, o nome e a tabela). */
export const esquemaProcedimentoHospitalSus = z.object({
  id: z.number().int(),
  codigo: z.number().int(),
  nome: z.string(),
  tabela: z.string(),
});
export type ProcedimentoHospitalSus = z.infer<typeof esquemaProcedimentoHospitalSus>;

const carimbo = z.string();

/** Uma competência SUS como a tela lista (sem dado pessoal). */
export const esquemaCompetenciaSusResumo = z.object({
  instrumento: z.enum(INSTRUMENTOS_SUS),
  competencia: esquemaCompetenciaSus,
  situacao: z.enum(SITUACOES_COMPETENCIA_SUS),
  registros: z.number().int(),
  criticasBloqueantes: z.number().int(),
  avisos: z.number().int(),
  abertaPor: z.string(),
  abertaEm: carimbo,
  /** Quando a crítica rodou pela última vez (null: nunca; o fechamento e a geração exigem). */
  criticadaEm: carimbo.nullable(),
  fechadaPor: z.string().nullable(),
  fechadaEm: carimbo.nullable(),
  reabertaPor: z.string().nullable(),
  reabertaEm: carimbo.nullable(),
  /** CNES usado na última crítica (público; nenhum dado de pessoa). */
  cnes: z.string().nullable(),
  /** Chave da funcionalidade ligada no estabelecimento (as de BPA, APAC e AIH desligadas, DP-35). */
  liberada: z.boolean(),
  versao,
});
export type CompetenciaSusResumo = z.infer<typeof esquemaCompetenciaSusResumo>;

/** A crítica como a tela lista: a origem é a chave do registro (conta, atendimento), nunca o nome do paciente. */
export const esquemaCriticaSusLida = z.object({
  id: z.number().int(),
  regra: z.enum(REGRAS_CRITICA_SUS),
  gravidade: z.enum(GRAVIDADES_CRITICA_SUS),
  situacao: z.enum(SITUACOES_CRITICA_SUS),
  origem: z.object({
    conta: z.number().int().nullable(),
    atendimento: z.number().int().nullable(),
    item: z.number().int().nullable(),
  }),
  /** Valores técnicos que explicam a crítica (código SIGTAP, CID, competência, campo); sem dado pessoal. */
  detalhe: z.record(z.string(), z.union([z.string(), z.number(), z.null()])),
  justificativa: z.string().nullable(),
  versao,
});
export type CriticaSusLida = z.infer<typeof esquemaCriticaSusLida>;

export const esquemaPaginaCriticasSus = z.object({
  itens: z.array(esquemaCriticaSusLida),
  total: z.number().int(),
  /** Contagem das abertas por regra (o filtro e o cabeçalho da tela). */
  porRegra: z.record(z.string(), z.number().int()),
});
export type PaginaCriticasSus = z.infer<typeof esquemaPaginaCriticasSus>;

/** O arquivo exportado (SGH_FAT_SUS_ARQUIVO): o conteúdo fica guardado; a tela recebe metadados e o download. */
export const esquemaArquivoSusLido = z.object({
  id: z.number().int(),
  instrumento: z.enum(INSTRUMENTOS_SUS),
  competencia: esquemaCompetenciaSus,
  leiaute: z.string(),
  versaoLeiaute: z.string(),
  /** O descritor foi conferido contra o documento oficial (sem isso, a tela avisa para não enviar). */
  conferidoContraOficial: z.boolean(),
  nomeArquivo: z.string(),
  linhas: z.number().int(),
  registros: z.number().int(),
  procedimentos: z.number().int(),
  semMovimento: z.boolean(),
  /** SHA-256 do conteúdo, em hexadecimal. */
  hash: z.string().regex(/^[0-9a-f]{64}$/),
  bytes: z.number().int(),
  situacao: z.enum(SITUACOES_ARQUIVO_SUS),
  geradoPor: z.string(),
  geradoEm: carimbo,
});
export type ArquivoSusLido = z.infer<typeof esquemaArquivoSusLido>;

/** O resultado da crítica (contagens por regra; sem dado pessoal), com a competência relida. */
export const esquemaResultadoCriticaSus = z.object({
  competencia: esquemaCompetenciaSusResumo,
  registros: z.number().int(),
  foraPorSerSus: z.number().int(),
  bloqueantes: z.number().int(),
  avisos: z.number().int(),
  corrigidas: z.number().int(),
  porRegra: z.record(z.string(), z.number().int()),
  /** Tempo da leitura e da montagem, em milissegundos (a meta de carga da ficha, seção 10). */
  tempoMs: z.number().int(),
});
export type ResultadoCriticaSus = z.infer<typeof esquemaResultadoCriticaSus>;

export const esquemaArquivoSusGerado = z.object({
  arquivo: esquemaArquivoSusLido,
  competencia: esquemaCompetenciaSusResumo,
  substituidos: z.number().int(),
  tempoMs: z.number().int(),
});
export type ArquivoSusGerado = z.infer<typeof esquemaArquivoSusGerado>;

/** A equivalência SIGTAP registrada no Sante para um procedimento do hospital (sem dado pessoal). */
export const esquemaEquivalenciaSusLida = z.object({
  id: z.number().int(),
  /** O procedimento do hospital. */
  procedimento: z.number().int(),
  /** Código, nome e tabela do procedimento do hospital (null quando o cadastro não o tem mais). */
  procedimentoCodigo: z.number().int().nullable(),
  procedimentoNome: z.string().nullable(),
  tabela: z.string().nullable(),
  sigtap: z.string(),
  sigtapNome: z.string().nullable(),
  ativa: z.boolean(),
  registradaPor: z.string(),
  registradaEm: carimbo,
  versao,
});
export type EquivalenciaSusLida = z.infer<typeof esquemaEquivalenciaSusLida>;

export const esquemaPaginaEquivalenciasSus = z.object({
  itens: z.array(esquemaEquivalenciaSusLida),
  total: z.number().int(),
});
export type PaginaEquivalenciasSus = z.infer<typeof esquemaPaginaEquivalenciasSus>;

/** A versão opaca das linhas SGH_ do faturamento SUS (o contador VERSAO com zeros: atende o mínimo do contrato). */
export function versaoSus(n: number): string {
  return String(Math.max(0, Math.trunc(n))).padStart(10, '0');
}
