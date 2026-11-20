// Prescrição de medicamento pelo enfermeiro (M45, etapa 4; ficha, seções 5, 6, 7 e regra 17; Res. COFEN 801/2026): só
// em consulta de enfermagem e com protocolo institucional ou de programa de saúde publicado; a receita tem o conteúdo
// mínimo do art. 3º (protocolo e ano, instituição e CNPJ, nome, COREN e categoria do prescritor, assinatura, data,
// paciente com o segundo identificador, medicamento pelo nome genérico, via e posologia; modelo simples ou de
// retenção); a lista de medicamentos do anexo II é parâmetro versionado. Recurso novo, só do novo, desligado pela chave
// `enfermagem.prescricaoMedicamento` (POL-3). Vocabulário de produto.
import { z } from 'zod';
import { textoCp1252 } from '../texto-cp1252.js';

const livre = (max: number) => textoCp1252(max).overwrite((t) => t.replace(/\s+/g, ' ').trim());

/** Chave de liberação (POL-3): desligada por padrão (ficha, seção 12). */
export const CHAVE_LIBERACAO_PRESCRICAO_MEDICAMENTO = 'enfermagem.prescricaoMedicamento';
/** Os protocolos publicados: `CODIGO/ANO:tipo:genérico,genérico;...` (tipo `institucional` ou `programa`). */
export const PARAMETRO_PROTOCOLOS_ENFERMEIRO = 'enfermagem.prescricaoMedicamento.protocolos';
/** A lista do anexo II (versionada): `VERSAO=genérico,genérico,...`. */
export const PARAMETRO_ANEXO_II_ENFERMEIRO = 'enfermagem.prescricaoMedicamento.anexoII';

export const MODELOS_RECEITA_ENFERMEIRO = ['simples', 'retencao'] as const;
export type ModeloReceitaEnfermeiro = (typeof MODELOS_RECEITA_ENFERMEIRO)[number];
export const TIPOS_PROTOCOLO_ENFERMEIRO = ['institucional', 'programa'] as const;
export type TipoProtocoloEnfermeiro = (typeof TIPOS_PROTOCOLO_ENFERMEIRO)[number];
/** O segundo identificador do paciente na receita (art. 3º): o CPF ou a data de nascimento. */
export const SEGUNDOS_IDENTIFICADORES = ['cpf', 'nascimento'] as const;
export type SegundoIdentificador = (typeof SEGUNDOS_IDENTIFICADORES)[number];

export interface ProtocoloEnfermeiro {
  readonly codigo: string;
  readonly ano: number;
  readonly tipo: TipoProtocoloEnfermeiro;
  /** Os genéricos que o protocolo permite (todos da lista do anexo II vigente). */
  readonly medicamentos: readonly string[];
}
export interface ListaAnexoII {
  readonly versao: string;
  readonly medicamentos: readonly string[];
}

const generico = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-zà-ú0-9 ,.+()-]{3,80}$/, 'Nome genérico inválido.');

export const esquemaItemReceitaEnfermeiro = z
  .object({
    /** O nome genérico (da lista do anexo II e do protocolo). */
    medicamento: generico,
    via: livre(30).pipe(z.string().min(2, 'Informe a via.')),
    posologia: livre(200).pipe(z.string().min(5, 'Informe a posologia.')),
    quantidade: livre(60).pipe(z.string().min(1, 'Informe a quantidade.')),
  })
  .strict();
export type ItemReceitaEnfermeiro = z.infer<typeof esquemaItemReceitaEnfermeiro>;

export const esquemaPrescreverMedicamentoEnfermeiro = z
  .object({
    /** O protocolo publicado (CODIGO/ANO). */
    protocolo: z.string().regex(/^[A-Za-z0-9.\-_]{1,20}\/\d{4}$/, 'Protocolo no formato CODIGO/ANO.'),
    modelo: z.enum(MODELOS_RECEITA_ENFERMEIRO),
    segundoIdentificador: z.enum(SEGUNDOS_IDENTIFICADORES),
    itens: z.array(esquemaItemReceitaEnfermeiro).min(1).max(10),
    /** A impressão do conteúdo que a tela mostrou para assinar (o servidor recalcula e confere). */
    impressaoVista: z.string().regex(/^[0-9a-f]{64}$/, 'Impressão da receita inválida.'),
    /** A assinatura: a senha conferida de novo (reautenticação). */
    senha: z.string().min(1).max(200),
    /** W0-03: a reemissão aponta a receita anterior, já suspensa ou cancelada (o vínculo fica na receita nova). */
    anterior: z.number().int().positive().optional(),
  })
  .strict();
export type PrescreverMedicamentoEnfermeiroEntrada = z.infer<typeof esquemaPrescreverMedicamentoEnfermeiro>;

/** A prévia: o mesmo conteúdo sem a senha (a tela mostra o texto e a impressão que vai assinar). */
export const esquemaPreviaReceitaEnfermeiro = esquemaPrescreverMedicamentoEnfermeiro.omit({
  impressaoVista: true,
  senha: true,
});
export type PreviaReceitaEnfermeiroEntrada = z.infer<typeof esquemaPreviaReceitaEnfermeiro>;

/** W0-03: suspensão (interrompe o tratamento) ou cancelamento (emitida errada) da receita, com motivo e a senha. */
export const TIPOS_INATIVACAO_RECEITA = ['suspensao', 'cancelamento'] as const;
export type TipoInativacaoReceita = (typeof TIPOS_INATIVACAO_RECEITA)[number];
export const esquemaInativarReceitaEnfermeiro = z
  .object({
    tipo: z.enum(TIPOS_INATIVACAO_RECEITA),
    motivo: z.string().trim().min(10, 'Descreva o motivo (pelo menos 10 caracteres).').max(300),
    senha: z.string().min(1).max(200),
  })
  .strict();
export type InativarReceitaEnfermeiroEntrada = z.infer<typeof esquemaInativarReceitaEnfermeiro>;

/** O que a receita leva do cadastro (lido no momento da prévia e da assinatura). */
export interface CabecalhoReceitaEnfermeiro {
  readonly instituicao: string;
  readonly cnpj: string | null;
  readonly prescritor: string;
  /** O conselho do prescritor (COREN-UF número). */
  readonly coren: string | null;
  readonly categoria: string;
  readonly paciente: string;
  /** O segundo identificador já formatado (CPF mascarado ou a data de nascimento). */
  readonly segundoIdentificador: string | null;
  readonly data: string;
}

export interface ReceitaEnfermeiroLida {
  readonly id: number;
  readonly protocolo: string;
  readonly ano: number;
  readonly tipoProtocolo: TipoProtocoloEnfermeiro;
  readonly modelo: ModeloReceitaEnfermeiro;
  readonly listaVersao: string;
  readonly segundoIdentificador: SegundoIdentificador;
  readonly coren: string;
  readonly categoria: string;
  readonly itens: readonly ItemReceitaEnfermeiro[];
  readonly impressao: string;
  readonly assinadaEm: string;
  readonly usuario: string;
  /** W0-03: a receita que esta reemite (já suspensa ou cancelada). */
  readonly anterior?: number | null;
  /** W0-03: a reemissão desta, quando houver. */
  readonly reemitidaEm?: number | null;
  /** W0-03: a suspensão ou o cancelamento (a receita fica legível e inativa; o texto assinado não muda). */
  readonly inativacao?: {
    readonly tipo: TipoInativacaoReceita;
    readonly motivo: string;
    readonly usuario: string;
    readonly em: string;
  } | null;
}

/** O atendimento da consulta de enfermagem (externo, com o profissional do atendimento enfermeiro). */
export interface ConsultaEnfermagemLida {
  readonly atendimento: number;
  readonly paciente: number;
  readonly numero: number;
  readonly nome: string;
  readonly entrada: string | null;
}

export interface PrescricaoEnfermeiroDoAtendimento {
  readonly atendimento: number;
  readonly paciente: number;
  readonly numero: number;
  readonly nome: string;
  readonly agora: string;
  /** É consulta de enfermagem (atendimento externo com o profissional enfermeiro)? Sem ela, a tela recusa com o motivo. */
  readonly consultaDeEnfermagem: boolean;
  readonly motivo: string | null;
  readonly protocolos: readonly ProtocoloEnfermeiro[];
  readonly lista: ListaAnexoII | null;
  readonly receitas: readonly (ReceitaEnfermeiroLida & { readonly texto: string })[];
  readonly gravacao: {
    readonly ligada: boolean;
    readonly motivo: string | null;
    readonly enfermeiro: boolean;
    readonly prescrever: boolean;
  };
}

export interface PreviaReceitaEnfermeiro {
  readonly texto: string;
  readonly impressao: string;
  readonly cabecalho: CabecalhoReceitaEnfermeiro;
}

export interface ResultadoReceitaEnfermeiro {
  readonly ok: true;
  readonly id: number;
  readonly impressao: string;
  readonly mensagem: string;
}
