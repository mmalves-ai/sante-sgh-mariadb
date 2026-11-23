// W0-03, mercado M4 (plano-final.json, item W0-03): o registro de feridas e de lesão por pressão (LPP). A lesão tem o
// local no mapa corporal, o tipo, o estágio da classificação NPUAP/NPIAP 2016 (adotada no Brasil pelo consenso
// SOBEST/SOBENDE), as medidas, o leito da ferida, a cobertura e a foto como anexo do prontuário; cada curativo registra
// a evolução. A LPP adquirida na internação (não presente na admissão) gera a sugestão de notificação ao Núcleo de
// Segurança do Paciente (RDC 36/2013; Protocolo de Prevenção de Úlcera por Pressão do Ministério da Saúde/ANVISA, 2013)
// e entra na incidência de LPP, com o numerador e o denominador. Registro clínico: a ficha da lesão é rascunho livre do
// autor até finalizar; depois, só o autor corrige, por versão nova com justificativa (SBIS NGS1.12.01); o lançamento
// errado se inativa com motivo e continua visível (NGS1.12.03). Nenhum nome de tabela nem do sistema anterior em texto
// visto pelo usuário (ADR 0023).
import { z } from 'zod';
import { textoCp1252 } from '../texto-cp1252.js';
import { idBanco } from '../validacao/id-banco.js';

/** Tipo da ferida. Só a LPP tem estágio NPUAP e entra na incidência. */
export const TIPOS_LESAO = [
  'lpp',
  'cirurgica',
  'traumatica',
  'venosa',
  'arterial',
  'diabetica',
  'dermatite',
  'queimadura',
  'outra',
] as const;
export type TipoLesao = (typeof TIPOS_LESAO)[number];
export const ROTULOS_TIPO_LESAO: Readonly<Record<TipoLesao, string>> = {
  lpp: 'Lesão por pressão',
  cirurgica: 'Ferida cirúrgica',
  traumatica: 'Ferida traumática',
  venosa: 'Úlcera venosa',
  arterial: 'Úlcera arterial',
  diabetica: 'Úlcera do pé diabético',
  dermatite: 'Dermatite associada à incontinência',
  queimadura: 'Queimadura',
  outra: 'Outra',
};

/** Estágios da LPP (NPUAP/NPIAP 2016; consenso SOBEST/SOBENDE 2016). */
export const ESTAGIOS_LPP = [
  'estagio1',
  'estagio2',
  'estagio3',
  'estagio4',
  'naoClassificavel',
  'tissularProfunda',
  'mucosa',
] as const;
export type EstagioLpp = (typeof ESTAGIOS_LPP)[number];
export const ROTULOS_ESTAGIO_LPP: Readonly<Record<EstagioLpp, string>> = {
  estagio1: 'Estágio 1: pele íntegra com eritema que não embranquece',
  estagio2: 'Estágio 2: perda da pele em sua espessura parcial, com exposição da derme',
  estagio3: 'Estágio 3: perda da pele em sua espessura total',
  estagio4: 'Estágio 4: perda da pele e do tecido em sua espessura total',
  naoClassificavel: 'Não classificável: perda total obscurecida por esfacelo ou escara',
  tissularProfunda: 'Lesão tissular profunda: descoloração vermelho-escura, marrom ou púrpura persistente',
  mucosa: 'Lesão em membrana mucosa',
};

/**
 * Os estágios graves da LPP (perda da pele em espessura total ou profunda): a sugestão de notificação ao NSP sai como
 * grave (a enfermagem e a qualidade usam a mesma lista).
 */
export const ESTAGIOS_GRAVES_LPP: readonly EstagioLpp[] = [
  'estagio3',
  'estagio4',
  'naoClassificavel',
  'tissularProfunda',
];

/** O mapa corporal: a região (com o lado quando há) e a vista em que aparece no desenho. */
export const REGIOES_LESAO = [
  'occipital',
  'orelhaD',
  'orelhaE',
  'nariz',
  'escapulaD',
  'escapulaE',
  'cotoveloD',
  'cotoveloE',
  'sacral',
  'coccigea',
  'isquiaticaD',
  'isquiaticaE',
  'trocanterD',
  'trocanterE',
  'joelhoD',
  'joelhoE',
  'maleoloD',
  'maleoloE',
  'calcaneoD',
  'calcaneoE',
  'abdome',
  'torax',
  'membroSuperiorD',
  'membroSuperiorE',
  'membroInferiorD',
  'membroInferiorE',
  'peD',
  'peE',
  'outra',
] as const;
export type RegiaoLesao = (typeof REGIOES_LESAO)[number];
export const ROTULOS_REGIAO_LESAO: Readonly<Record<RegiaoLesao, string>> = {
  occipital: 'Occipital',
  orelhaD: 'Orelha direita',
  orelhaE: 'Orelha esquerda',
  nariz: 'Nariz',
  escapulaD: 'Escápula direita',
  escapulaE: 'Escápula esquerda',
  cotoveloD: 'Cotovelo direito',
  cotoveloE: 'Cotovelo esquerdo',
  sacral: 'Sacral',
  coccigea: 'Coccígea',
  isquiaticaD: 'Isquiática direita',
  isquiaticaE: 'Isquiática esquerda',
  trocanterD: 'Trocantérica direita',
  trocanterE: 'Trocantérica esquerda',
  joelhoD: 'Joelho direito',
  joelhoE: 'Joelho esquerdo',
  maleoloD: 'Maléolo direito',
  maleoloE: 'Maléolo esquerdo',
  calcaneoD: 'Calcâneo direito',
  calcaneoE: 'Calcâneo esquerdo',
  abdome: 'Abdome',
  torax: 'Tórax',
  membroSuperiorD: 'Membro superior direito',
  membroSuperiorE: 'Membro superior esquerdo',
  membroInferiorD: 'Membro inferior direito',
  membroInferiorE: 'Membro inferior esquerdo',
  peD: 'Pé direito',
  peE: 'Pé esquerdo',
  outra: 'Outra (descrever)',
};

export const EXSUDATOS = ['ausente', 'escasso', 'moderado', 'abundante'] as const;
export type Exsudato = (typeof EXSUDATOS)[number];

/** Coberturas e terapias tópicas usuais (a lista é de apoio; "outra" exige a descrição). */
export const COBERTURAS = [
  'filmeTransparente',
  'hidrocoloide',
  'espuma',
  'alginato',
  'hidrogel',
  'carvaoPrata',
  'acidosGraxos',
  'papaina',
  'colagenase',
  'gazeSoro',
  'pressaoNegativa',
  'outra',
] as const;
export type Cobertura = (typeof COBERTURAS)[number];
export const ROTULOS_COBERTURA: Readonly<Record<Cobertura, string>> = {
  filmeTransparente: 'Filme transparente',
  hidrocoloide: 'Hidrocoloide',
  espuma: 'Espuma (com ou sem borda)',
  alginato: 'Alginato de cálcio',
  hidrogel: 'Hidrogel',
  carvaoPrata: 'Carvão ativado com prata',
  acidosGraxos: 'Ácidos graxos essenciais',
  papaina: 'Papaína',
  colagenase: 'Colagenase',
  gazeSoro: 'Gaze com soro fisiológico',
  pressaoNegativa: 'Terapia por pressão negativa',
  outra: 'Outra (descrever)',
};

export const DESFECHOS_LESAO = ['cicatrizada', 'alta', 'transferido', 'obito'] as const;
export type DesfechoLesao = (typeof DESFECHOS_LESAO)[number];
export const ROTULOS_DESFECHO_LESAO: Readonly<Record<DesfechoLesao, string>> = {
  cicatrizada: 'Cicatrizada',
  alta: 'Alta com a lesão (orientação de cuidado)',
  transferido: 'Transferido de estabelecimento com a lesão',
  obito: 'Óbito',
};

const id = idBanco;
const hora = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, 'Hora no formato AAAA-MM-DDTHH:mm.');
const motivoLivre = textoCp1252(300)
  .overwrite((t) => t.replace(/\s+/g, ' ').trim())
  .pipe(z.string().min(10, 'Descreva o motivo (10 caracteres ou mais).'));
/** Centímetros com uma casa (0,1 a 99,9). */
const cm = z.number().min(0).max(99.9).multipleOf(0.1);
const pct = z.number().int().min(0).max(100);

/** As medidas (régua, em centímetros): comprimento (cabeça-pés) × largura; a profundidade é opcional. */
export const esquemaMedidasLesao = z
  .object({ comprimento: cm, largura: cm, profundidade: cm.nullable() })
  .strict();
export type MedidasLesao = z.infer<typeof esquemaMedidasLesao>;

/** O leito da ferida: os tecidos em percentual (a soma é 100), o exsudato, as bordas e a pele em volta. */
export const esquemaLeitoLesao = z
  .object({
    granulacao: pct,
    epitelizacao: pct,
    esfacelo: pct,
    necrose: pct,
    exsudato: z.enum(EXSUDATOS),
    odor: z.boolean(),
    sinaisInfeccao: z.boolean(),
    bordas: textoCp1252(120).optional(),
    pelePerilesional: textoCp1252(120).optional(),
    dor: z.number().int().min(0).max(10).nullable(),
  })
  .strict();
export type LeitoLesao = z.infer<typeof esquemaLeitoLesao>;

/** Os dados versionados da ficha da lesão. */
export const esquemaDadosLesao = z
  .object({
    tipo: z.enum(TIPOS_LESAO),
    regiao: z.enum(REGIOES_LESAO),
    regiaoDescricao: textoCp1252(80).optional(),
    estagio: z.enum(ESTAGIOS_LPP).nullable(),
    relacionadaDispositivo: z.boolean(),
    presenteNaAdmissao: z.boolean(),
    identificadaEm: hora,
    medidas: esquemaMedidasLesao.nullable(),
    leito: esquemaLeitoLesao.nullable(),
    cobertura: z.enum(COBERTURAS).nullable(),
    coberturaDescricao: textoCp1252(120).optional(),
    observacao: textoCp1252(400).optional(),
  })
  .strict();
export type DadosLesao = z.infer<typeof esquemaDadosLesao>;

/** A ficha nova (primeira versão); `finalizar` fecha a ficha. A foto vai à parte, como anexo do prontuário. */
export const esquemaRegistroLesao = z
  .object({ paciente: id, atendimento: id, dados: esquemaDadosLesao, finalizar: z.boolean() })
  .strict();
export type RegistroLesaoEntrada = z.infer<typeof esquemaRegistroLesao>;

/** A versão seguinte (só do autor). Depois de finalizada, a versão é a correção, finalizada, com a justificativa. */
export const esquemaVersaoLesao = z
  .object({ dados: esquemaDadosLesao, finalizar: z.boolean(), motivo: motivoLivre.optional() })
  .strict();
export type VersaoLesaoEntrada = z.infer<typeof esquemaVersaoLesao>;

/** O curativo: a evolução da lesão naquele momento (medidas, leito, estágio atual da LPP e a cobertura usada). */
export const esquemaCurativo = z
  .object({
    realizadoEm: hora,
    estagio: z.enum(ESTAGIOS_LPP).nullable(),
    medidas: esquemaMedidasLesao.nullable(),
    leito: esquemaLeitoLesao,
    limpeza: textoCp1252(120).optional(),
    cobertura: z.enum(COBERTURAS),
    coberturaDescricao: textoCp1252(120).optional(),
    observacao: textoCp1252(400).optional(),
  })
  .strict();
export type CurativoEntrada = z.infer<typeof esquemaCurativo>;

/** A correção do curativo pelo autor: versão nova com a justificativa; a anterior fica inativa e legível. */
export const esquemaCorrigirCurativo = z.object({ dados: esquemaCurativo, motivo: motivoLivre }).strict();

/** O encerramento do acompanhamento da lesão (com a hora e o desfecho). */
export const esquemaEncerrarLesao = z
  .object({ desfecho: z.enum(DESFECHOS_LESAO), em: hora, observacao: textoCp1252(300).optional() })
  .strict();

/** A inativação do lançado errado (a ficha inteira, um curativo ou uma foto), com o motivo e a senha. */
export const esquemaInativarLesao = z
  .object({ motivo: motivoLivre, senha: z.string().min(1).max(128) })
  .strict();

export interface InativacaoLesaoLida {
  readonly motivo: string;
  readonly usuario: string;
  readonly em: string;
}

/** A foto da lesão: a referência ao anexo do prontuário (o arquivo fica no anexo, não aqui). */
export const esquemaFotoLesao = z.object({ anexo: id, curativo: id.optional(), tiradaEm: hora }).strict();
export type FotoLesaoEntrada = z.infer<typeof esquemaFotoLesao>;

export interface FotoLesaoLida {
  readonly id: number;
  readonly anexo: number;
  readonly curativo: number | null;
  readonly tiradaEm: string;
  readonly usuario: string;
  readonly inativacao: InativacaoLesaoLida | null;
}

export interface CurativoLido {
  readonly id: number;
  readonly lesao: number;
  readonly anterior: number | null;
  readonly dados: CurativoEntrada;
  /** Área em cm² (comprimento × largura), null sem medidas. */
  readonly areaCm2: number | null;
  readonly autor: string;
  readonly criadoEm: string;
  readonly motivo: string | null;
  readonly inativacao: InativacaoLesaoLida | null;
  /** Falso para a versão corrigida (substituída) e para o inativado: aparece tachado. */
  readonly vigente: boolean;
}

export interface LesaoLida {
  readonly id: number;
  readonly paciente: number;
  readonly atendimento: number;
  readonly unidade: string | null;
  readonly uti: boolean;
  readonly versao: number;
  readonly situacao: 'rascunho' | 'finalizada';
  readonly dados: DadosLesao;
  /** Admitida (presente na admissão) ou adquirida na internação; só a adquirida entra na incidência. */
  readonly origem: 'admitida' | 'adquirida';
  readonly areaCm2: number | null;
  readonly autor: string;
  readonly criadoEm: string;
  readonly motivo: string | null;
  readonly encerramento: {
    readonly desfecho: DesfechoLesao;
    readonly em: string;
    readonly usuario: string;
  } | null;
  readonly inativacao: InativacaoLesaoLida | null;
  /** Versões anteriores (inativas, legíveis), da mais nova para a mais antiga. */
  readonly versoes: readonly {
    readonly id: number;
    readonly versao: number;
    readonly situacao: 'rascunho' | 'finalizada';
    readonly criadoEm: string;
    readonly autor: string;
    readonly motivo: string | null;
    readonly dados: DadosLesao | null;
  }[];
  readonly curativos: readonly CurativoLido[];
  /** As fotos (anexos do prontuário), da ficha ou de um curativo; a inativada aparece tachada. */
  readonly fotos: readonly FotoLesaoLida[];
  /** A sugestão de notificação ao Núcleo de Segurança do Paciente (LPP adquirida, finalizada, não inativada). */
  readonly sugerirNotificacao: boolean;
}

/** A incidência de LPP do período (disponível ao painel de indicadores), com o numerador e o denominador. */
export interface IncidenciaLpp {
  readonly de: string;
  readonly ate: string;
  readonly densidade: {
    readonly numerador: number;
    readonly denominador: number;
    readonly por1000: number | null;
  };
  readonly pacientes: {
    readonly numerador: number;
    readonly denominador: number;
    readonly percentual: number | null;
  };
  readonly porEstagio: Readonly<Partial<Record<EstagioLpp, number>>>;
  readonly impressao: string;
}
