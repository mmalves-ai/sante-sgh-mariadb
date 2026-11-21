// Registros clínicos nos modelos de formulário do legado (M22; ficha, seções 4, 5, 7 e 8; cap-11 §11.1). O
// contrato é o que a tela e a API trocam: a VISÃO do formulário para o renderizador (derivada da representação do
// parser DFM do M09, sem nome de tabela nem de coluna do legado), as respostas digitadas por item, o rascunho, a
// finalização, a suspensão e as listas (modelos permitidos, atendimentos, rascunhos). O formato de gravação
// (colunas, índices, RTF, XML) é do gravador em @sgh/dominio-pep e do adaptador; aqui só a forma da tela.
import { z } from 'zod';
import { esquemaFluxoParecer } from './documentos.js';
import { esquemaParagrafo } from './prontuario.js';
import { textoCp1252 } from '../texto-cp1252.js';

// ── Visão do formulário (renderizador) ─────────────────────────────────────────────────────────────────

/** Tipos de campo do renderizador (os 13 da classe do componente, mais "sem-campo" para o não mapeado). */
export const TIPOS_CAMPO_REGISTRO = [
  'secao',
  'texto-formatado',
  'data',
  'hora',
  'escolha',
  'escolha-com-texto',
  'multipla',
  'texto',
  'quantidade',
  'grade',
  'cid',
  'cid-multiplo',
  'alergias',
  'sem-campo',
] as const;
export type TipoCampoRegistro = (typeof TIPOS_CAMPO_REGISTRO)[number];

/** Regra em JSON Logic (expressão do formulário de origem convertida; avaliada na tela e no servidor). */
export type RegraJsonLogic = unknown;

export const esquemaOpcaoRegistro = z.object({
  /** Índice da lista do formulário de origem (é o que se grava como escolha). */
  indice: z.number().int().min(0).max(99),
  texto: z.string(),
});
export type OpcaoRegistro = z.infer<typeof esquemaOpcaoRegistro>;

export const esquemaColunaGrade = z.object({
  coluna: z.number().int().min(1).max(30),
  titulo: z.string(),
  /** Tipo do valor da célula na tela (texto, número ou hora). */
  tipo: z.enum(['texto', 'numero', 'hora']),
  unidade: z.string().nullable(),
});
export type ColunaGrade = z.infer<typeof esquemaColunaGrade>;

/** Pré-preenchimento pelo histórico (DP-28: só o nível 1 traz valor; 2 e 3 só mostram o histórico). */
export const NIVEIS_MANTER_HISTORICO = [0, 1, 2, 3] as const;

export interface CampoRegistro {
  readonly linkId: string;
  /** Vínculo do modelo (chave da resposta). */
  readonly vinculo: number;
  /** Nome do componente no formulário de origem (as regras o citam: cmpNNN, cmpNNNItemIndex). */
  readonly componente: string | null;
  readonly tipo: TipoCampoRegistro;
  readonly titulo: string;
  readonly obrigatorio: boolean;
  readonly unidade: string | null;
  readonly tamanhoMaximo: number | null;
  /** Colunas na grade de 12 (layout fluido pela largura do componente de origem). */
  readonly colunas: number;
  readonly opcoes: readonly OpcaoRegistro[];
  readonly colunasGrade: readonly ColunaGrade[];
  /** Habilitar e calcular (JSON Logic) convertidos das expressões do formulário de origem. */
  readonly habilitar: RegraJsonLogic | null;
  readonly calcular: RegraJsonLogic | null;
  /** Expressão que não converteu: o campo fica sempre habilitado / sem cálculo, com aviso ao administrador. */
  readonly regraPendente: boolean;
  readonly manterHistorico: number;
  /** Escolha cuja leitura do índice é ambígua (DP-28): o modelo não é liberado com ela. */
  readonly ambiguo: boolean;
  readonly itens: readonly CampoRegistro[];
}

export const esquemaCampoRegistro: z.ZodType<CampoRegistro> = z.lazy(() =>
  z.object({
    linkId: z.string(),
    vinculo: z.number().int(),
    componente: z.string().nullable(),
    tipo: z.enum(TIPOS_CAMPO_REGISTRO),
    titulo: z.string(),
    obrigatorio: z.boolean(),
    unidade: z.string().nullable(),
    tamanhoMaximo: z.number().int().nullable(),
    colunas: z.number().int().min(1).max(12),
    opcoes: z.array(esquemaOpcaoRegistro),
    colunasGrade: z.array(esquemaColunaGrade),
    habilitar: z.unknown(),
    calcular: z.unknown(),
    regraPendente: z.boolean(),
    manterHistorico: z.number().int(),
    ambiguo: z.boolean(),
    itens: z.array(esquemaCampoRegistro),
  }),
) as z.ZodType<CampoRegistro>;

// ── Valores digitados ─────────────────────────────────────────────────────────────────────────────────

const LIMITE_TEXTO_LIVRE = 32_000;

export const esquemaValorResposta = z.discriminatedUnion('tipo', [
  z.object({ tipo: z.literal('texto'), texto: textoCp1252(LIMITE_TEXTO_LIVRE) }),
  z.object({
    tipo: z.literal('formatado'),
    paragrafos: z.array(esquemaParagrafo).max(2_000),
  }),
  z.object({ tipo: z.literal('numero'), valor: z.number().finite() }),
  z.object({ tipo: z.literal('data'), data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
  z.object({ tipo: z.literal('hora'), hora: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/) }),
  z.object({
    tipo: z.literal('escolha'),
    indice: z.number().int().min(0).max(99),
    /** Texto digitado junto da escolha (resposta com texto). */
    complemento: textoCp1252(LIMITE_TEXTO_LIVRE).optional(),
  }),
  z.object({ tipo: z.literal('multipla'), indices: z.array(z.number().int().min(0).max(99)).max(99) }),
  z.object({
    tipo: z.literal('grade'),
    /** Uma linha por registro da grade; cada célula na ordem das colunas (vazio = null). */
    linhas: z.array(z.array(textoCp1252(250).nullable()).max(30)).max(50),
  }),
  z.object({
    tipo: z.literal('cid'),
    codigos: z
      .array(z.string().regex(/^[A-Z]\d{2}(\.?\d{1,2})?$/))
      .min(1)
      .max(20),
  }),
]);
export type ValorResposta = z.infer<typeof esquemaValorResposta>;

export const esquemaRespostaRegistro = z.object({
  vinculo: z.number().int().positive(),
  valor: esquemaValorResposta,
  /** Valor trazido do histórico (MANTERHIST): exige confirmação e grava a marca de pré-preenchido. */
  autopreenchido: z.boolean().default(false),
  confirmado: z.boolean().default(false),
});
export type RespostaRegistro = z.infer<typeof esquemaRespostaRegistro>;

const esquemaIdPositivo = z.number().int().positive();
/** Horário clínico em hora local do estabelecimento (AAAA-MM-DDTHH:MM), sem fuso: o banco do legado é local. */
const esquemaHoraLocal = z.string().regex(/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/);

// ── Rascunho (pep.salvarRascunho, pep.descartarRascunho) ─────────────────────────────────────────────

export const esquemaSalvarRascunho = z
  .object({
    paciente: esquemaIdPositivo,
    modelo: esquemaIdPositivo,
    /** Atendimento ou internação a que o registro pertence (âncora do M20/M21). */
    atendimento: esquemaIdPositivo,
    /** Rascunho já gravado (atualização) e o carimbo lido (colisão com outro terminal ou sistema). */
    rascunho: z.object({ id: esquemaIdPositivo, versao: z.string().min(1).max(64) }).optional(),
    dataHoraClinica: esquemaHoraLocal,
    justificativaRetroativo: textoCp1252(255).optional(),
    respostas: z.array(esquemaRespostaRegistro).max(1_000),
    /** Rascunho de uma correção: o registro suspenso que ela vai corrigir. */
    corrige: esquemaIdPositivo.optional(),
  })
  .strict();
export type SalvarRascunhoEntrada = z.infer<typeof esquemaSalvarRascunho>;

export const esquemaDescartarRascunho = z
  .object({ rascunho: esquemaIdPositivo, versao: z.string().min(1).max(64) })
  .strict();
export type DescartarRascunhoEntrada = z.infer<typeof esquemaDescartarRascunho>;

// ── Finalização (pep.registrarEvolucao) e suspensão (pep.suspenderEvolucao) ───────────────────────────

export const esquemaRegistrarEvolucao = z
  .object({
    paciente: esquemaIdPositivo,
    modelo: esquemaIdPositivo,
    atendimento: esquemaIdPositivo,
    /** Rascunho de origem: arquivado na mesma transação (como o legado). */
    rascunho: z.object({ id: esquemaIdPositivo, versao: z.string().min(1).max(64) }).optional(),
    dataHoraClinica: esquemaHoraLocal,
    justificativaRetroativo: textoCp1252(255).optional(),
    /** Impressão digital da representação mostrada (a gravada tem de ser a mesma). */
    impressao: z.string().regex(/^[0-9a-f]{64}$/),
    respostas: z.array(esquemaRespostaRegistro).min(1).max(1_000),
    /**
     * Correção: o registro SUSPENSO que este corrige (mesmo paciente e modelo), gravado como no legado na ligação do
     * registro novo com o original (cap-05b §5.6: corrigir é registrar de novo, nunca apagar).
     */
    corrige: esquemaIdPositivo.optional(),
    /** M23 (regra 10): o registro é o pedido de parecer (vai à fila) ou a resposta a um parecer da fila. */
    parecer: esquemaFluxoParecer.optional(),
    /** M23 (regra 3): o login do preceptor que coassina o registro do residente. */
    preceptor: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9._-]{1,31}$/)
      .optional(),
  })
  .strict();
export type RegistrarEvolucaoEntrada = z.infer<typeof esquemaRegistrarEvolucao>;

export const esquemaSuspenderEvolucao = z
  .object({
    /** Senha de quem suspende (operação crítica: reautenticação). */
    senha: z.string().min(1).max(100),
    registro: esquemaIdPositivo,
    justificativa: textoCp1252(200).pipe(
      z.string().trim().min(10, 'Justificativa com pelo menos 10 letras.'),
    ),
  })
  .strict();
export type SuspenderEvolucaoEntrada = z.infer<typeof esquemaSuspenderEvolucao>;

// ── Listas e telas ────────────────────────────────────────────────────────────────────────────────────

export const SITUACOES_MODELO = [
  'liberado',
  'desligado',
  'nao-permitido',
  'descontinuado',
  'ambiguo',
] as const;
export type SituacaoModelo = (typeof SITUACOES_MODELO)[number];

export const esquemaModeloRegistro = z.object({
  id: z.number().int(),
  codigo: z.string().nullable(),
  nome: z.string().nullable(),
  situacao: z.enum(SITUACOES_MODELO),
  /** Por que o modelo não está disponível para registrar (texto de produto). */
  motivo: z.string().nullable(),
  /** Uso em 2026 (contagem agregada; "<5" de 1 a 4). */
  usoRecente: z.union([z.number().int().min(0), z.literal('<5')]),
});
export type ModeloRegistro = z.infer<typeof esquemaModeloRegistro>;

export const esquemaAtendimentoRegistro = z.object({
  id: z.number().int(),
  numero: z.number().int().nullable(),
  tipo: z.enum(['internacao', 'externo']),
  entrada: z.string().nullable(),
  unidade: z.string().nullable(),
  leito: z.string().nullable(),
  aberto: z.boolean(),
});
export type AtendimentoRegistro = z.infer<typeof esquemaAtendimentoRegistro>;

export const esquemaRascunhoResumo = z.object({
  id: z.number().int(),
  paciente: z.number().int(),
  pacienteNome: z.string().nullable(),
  modelo: z.number().int(),
  modeloCodigo: z.string().nullable(),
  modeloNome: z.string().nullable(),
  atendimento: z.number().int().nullable(),
  dataHoraClinica: z.string().nullable(),
  atualizadoEm: z.string().nullable(),
  versao: z.string(),
  /** Rascunho de outro profissional ou do outro sistema: no novo, só leitura (ficha, seção 5). */
  somenteLeitura: z.boolean(),
  /** Começado no outro sistema (sem a marca de origem do novo): só leitura até o cenário controlado da Fase 4. */
  deOutroSistema: z.boolean(),
  /** Rascunho de correção: o registro suspenso que ele vai corrigir. */
  corrige: z.number().int().nullable(),
  respostas: z.number().int(),
});
export type RascunhoResumo = z.infer<typeof esquemaRascunhoResumo>;

export const esquemaHistoricoPergunta = z.object({
  vinculo: z.number().int(),
  valores: z.array(
    z.object({ registro: z.number().int(), dataHora: z.string().nullable(), valor: z.string() }),
  ),
});
export type HistoricoPergunta = z.infer<typeof esquemaHistoricoPergunta>;

export const esquemaFormularioRegistro = z.object({
  modelo: esquemaModeloRegistro,
  /** Impressão digital da representação (vai de volta na finalização). */
  impressao: z.string(),
  campos: z.array(esquemaCampoRegistro),
  /** Valores pré-preenchidos pelo histórico (marcados; exigem confirmação). */
  preenchidos: z.array(esquemaRespostaRegistro),
  /** Rascunhos abertos deste formulário para este paciente (deste profissional e dos outros). */
  rascunhos: z.array(esquemaRascunhoResumo),
  /** O rascunho pedido (?rascunho=), com as respostas gravadas nele. */
  rascunho: z
    .object({ resumo: esquemaRascunhoResumo, respostas: z.array(esquemaRespostaRegistro) })
    .nullable(),
  atendimentos: z.array(esquemaAtendimentoRegistro),
  /** Tolerância do horário clínico retroativo sem justificativa (minutos). */
  toleranciaRetroativoMin: z.number().int(),
  /** Relógio do estabelecimento (horário local "AAAA-MM-DDTHH:MM"): o horário clínico sugerido e a base do retroativo. */
  agora: z.string(),
  /** O executor grava agora? Se não, a tela fica em consulta e diz por quê. */
  gravacao: z.object({ pode: z.boolean(), motivo: z.string().nullable() }),
  avisos: z.array(z.string()),
});
export type FormularioRegistro = z.infer<typeof esquemaFormularioRegistro>;

export const esquemaRegistroGravado = z.object({
  registro: z.number().int(),
  /** SHA-256 do conteúdo canônico (JCS) gravado na trilha documental própria. */
  hash: z.string(),
  avisos: z.array(z.string()),
});
export type RegistroGravado = z.infer<typeof esquemaRegistroGravado>;

export const esquemaRascunhoGravado = z.object({ rascunho: z.number().int(), versao: z.string() });
export type RascunhoGravado = z.infer<typeof esquemaRascunhoGravado>;

/** Visualização do registro gravado (FormRenderer em modo visualização): campos e valores lidos de volta. */
export const esquemaRegistroVisualizado = z.object({
  registro: z.number().int(),
  modelo: esquemaModeloRegistro,
  dataHoraClinica: z.string().nullable(),
  lancadoEm: z.string().nullable(),
  profissional: z.string().nullable(),
  suspenso: z.boolean(),
  justificativaSuspensao: z.string().nullable(),
  campos: z.array(esquemaCampoRegistro),
  respostas: z.array(esquemaRespostaRegistro),
  /** Prova: hash guardado × conteúdo atual (alterado depois pelo outro sistema? regra 11). */
  prova: z.object({
    situacao: z.enum(['confere', 'alterado', 'sem-prova']),
    hash: z.string().nullable(),
  }),
  podeSuspender: z.boolean(),
  /** Registro suspenso que este corrige (ligação com o original), ou nulo. */
  corrige: z.number().int().nullable(),
  /** O registro está suspenso e quem vê pode registrar a correção (o mesmo modelo, ligado ao original). */
  podeCorrigir: z.boolean(),
  /**
   * Marcas visíveis da sessão "como" (ADR 0021, R1): "Registrado pelo suporte técnico em nome de <autor>" no
   * registro e na suspensão feitos pelo suporte; aparecem na tela e na impressão.
   */
  marcas: z.array(z.string()),
});
export type RegistroVisualizado = z.infer<typeof esquemaRegistroVisualizado>;

// ── Administração do PEP (consulta) ───────────────────────────────────────────────────────────────────

export const esquemaModeloAdmin = z.object({
  id: z.number().int(),
  codigo: z.string().nullable(),
  nome: z.string().nullable(),
  vinculos: z.number().int(),
  vinculosAtivos: z.number().int(),
  componentes: z.number().int(),
  componentesMapeados: z.number().int(),
  expressoes: z.number().int(),
  expressoesConvertidas: z.number().int(),
  escolhasPendentes: z.number().int(),
  versoesLayout: z.number().int(),
  impressao: z.string(),
  usoRecente: z.union([z.number().int().min(0), z.literal('<5')]),
  situacao: z.enum(SITUACOES_MODELO),
  /** Por que o modelo não está disponível para registro (fora da liberação, em conferência, fora de uso). */
  motivo: z.string().nullable(),
});
export type ModeloAdmin = z.infer<typeof esquemaModeloAdmin>;

export const esquemaModeloAdminDetalhe = esquemaModeloAdmin.extend({
  campos: z.array(esquemaCampoRegistro),
  pendencias: z.array(z.object({ campo: z.string().nullable(), tipo: z.string(), detalhe: z.string() })),
  expressoesDetalhe: z.array(
    z.object({
      campo: z.string(),
      tipo: z.enum(['habilitar', 'calcular']),
      padrao: z.string(),
      convertida: z.boolean(),
      motivo: z.string().nullable(),
    }),
  ),
  versoes: z.array(z.object({ versao: z.number().int(), componentes: z.number().int() })),
});
export type ModeloAdminDetalhe = z.infer<typeof esquemaModeloAdminDetalhe>;

export const esquemaModeloImpressao = z.object({
  id: z.number().int(),
  nome: z.string().nullable(),
  tipo: z.string().nullable(),
  ativo: z.boolean().nullable(),
});
export type ModeloImpressao = z.infer<typeof esquemaModeloImpressao>;

// ── Liberação (ficha, seção 12) ───────────────────────────────────────────────────────────────────────

/** Chave do recurso (POL-3): registrar nos modelos do formulário de origem, por estabelecimento, setor e pessoa. */
export const CHAVE_LIBERACAO_REGISTRO = 'pep.evolucao.registro';
/** Parâmetro com os modelos liberados para registro (códigos separados por vírgula; vazio = nenhum). */
export const PARAMETRO_MODELOS_LIBERADOS = 'pep.evolucao.modelosLiberados';
/**
 * Modelos FORA da liberação (POL-3; ficha, seção 11: "modelo fora disso, com estado e motivo"): ficam desligados com
 * o motivo, mesmo que o parâmetro os liste, até a correção ser provada. Conferência cruzada do corretor do M22
 * (docs/marcos/M22/conferencia-pc.md, 2026-10-21): igualdade abaixo da meta de 99,5% em título e valor; e os
 * modelos com componente de alergia ativo, que o novo ainda não grava (D-ALE-1).
 */
export const MODELOS_FORA_DA_LIBERACAO: Readonly<Record<string, string>> = {
  ENF091:
    'Conferência do formulário abaixo da meta (84,44% de igualdade; meta 99,5%) e componente de alergia que esta versão ainda não grava.',
  M12: 'Conferência do formulário abaixo da meta (95,81%; meta 99,5%) e componente de alergia que esta versão ainda não grava.',
  ENF03:
    'Conferência do formulário abaixo da meta (76,77%; meta 99,5%) e componente de alergia que esta versão ainda não grava.',
  ENF0411: 'Conferência do formulário abaixo da meta (98,08%; meta 99,5%).',
  ENF041:
    'Conferência do formulário abaixo da meta (91,56%; meta 99,5%) e componente de alergia que esta versão ainda não grava.',
  FISIUTI: 'Conferência do formulário abaixo da meta (99,49%; meta 99,5%).',
  E08: 'Conferência do formulário abaixo da meta (92,26%; meta 99,5%) e componente de alergia que esta versão ainda não grava.',
};

/** O motivo de o modelo estar fora da liberação (texto de produto), ou nulo. */
export function modeloForaDaLiberacao(codigo: string | null | undefined): string | null {
  const m = codigo ? MODELOS_FORA_DA_LIBERACAO[codigo.trim().toUpperCase()] : undefined;
  return m
    ? `Este modelo ainda não está liberado para registro: ${m.charAt(0).toLowerCase()}${m.slice(1)}`
    : null;
}

/** Os modelos liberados por padrão: os do escopo mínimo que passaram na conferência (100%) e não têm alergia. */
export const MODELOS_LIBERADOS_PADRAO = ['EVAM', 'M9', 'M10'] as const;

/** Os 10 modelos de maior uso em 2026 (61.642 de 81.124 registros; ficha, seção 1). */
export const MODELOS_ESCOPO_MINIMO = [
  'ENF091',
  'EVAM',
  'M12',
  'ENF03',
  'ENF0411',
  'ENF041',
  'FISIUTI',
  'M9',
  'E08',
  'M10',
] as const;
