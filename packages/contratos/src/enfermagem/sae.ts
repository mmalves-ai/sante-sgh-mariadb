// Processo de enfermagem (SAE) e prescrição de enfermagem aprazada e checada (M45, etapa 4; ficha, seções 5, 6, 7 e
// regras 7 e 8). As cinco etapas da Res. COFEN 736/2024 (avaliação, diagnóstico com as características definidoras e
// os fatores, planejamento com o resultado esperado na escala de 1 a 5 e a meta, implementação com a prescrição das
// atividades aprazadas e checadas, e a evolução que reavalia a meta). SAE, diagnóstico e prescrição de enfermagem são
// privativos do enfermeiro; o técnico executa e checa. A atividade não feita exige motivo; a checagem não se apaga
// (estorno justificado). A terminologia (NANDA-I/NIC/NOC ou CIPE) é a da DP-19: até lá, a sintética de teste abaixo
// (nunca conteúdo licenciado em código). Só do novo; vocabulário de produto.
import { z } from 'zod';
import { textoCp1252 } from '../texto-cp1252.js';
import { esquemaDataHoraLocal } from './entradas.js';
import { idBanco } from '../validacao/id-banco.js';

const livre = (max: number) => textoCp1252(max).overwrite((t) => t.replace(/\s+/g, ' ').trim());
const textoLongo = (max: number) => textoCp1252(max).overwrite((t) => t.trim());

// ── Vocabulário ────────────────────────────────────────────────────────────────────────────────────

/** As cinco etapas do processo de enfermagem (COFEN 736/2024, art. 4º). */
export const ETAPAS_SAE = ['avaliacao', 'diagnostico', 'planejamento', 'implementacao', 'evolucao'] as const;
export type EtapaSae = (typeof ETAPAS_SAE)[number];

/** O sistema da terminologia: a sintética de teste, NANDA-I/NIC/NOC ou CIPE (DP-19). */
export const SISTEMAS_TERMINOLOGIA_SAE = ['SINT', 'NNN', 'CIPE'] as const;
export type SistemaTerminologiaSae = (typeof SISTEMAS_TERMINOLOGIA_SAE)[number];
export const TIPOS_TERMO_SAE = [
  'diagnostico',
  'caracteristica',
  'fator',
  'resultado',
  'intervencao',
  'atividade',
] as const;
export type TipoTermoSae = (typeof TIPOS_TERMO_SAE)[number];

/** A meta do resultado esperado (o domínio de classificação das metas do estabelecimento: 3 linhas na cópia `pc`). */
export const SENTIDOS_META_SAE = ['aumentar', 'manter', 'diminuir'] as const;
export type SentidoMetaSae = (typeof SENTIDOS_META_SAE)[number];

/** A situação do resultado na evolução (a meta reavaliada). */
export const SITUACOES_EVOLUCAO_SAE = ['atingida', 'melhorou', 'mantida', 'piorou'] as const;
export type SituacaoEvolucaoSae = (typeof SITUACOES_EVOLUCAO_SAE)[number];

/** O estado do horário de uma atividade prescrita no turno. */
export const ESTADOS_CUIDADO = ['pendente', 'atrasada', 'feita', 'naoFeita'] as const;
export type EstadoCuidado = (typeof ESTADOS_CUIDADO)[number];

/** Chave de liberação (POL-3): a SAE e a prescrição de enfermagem nascem desligadas por estabelecimento e unidade. */
export const CHAVE_LIBERACAO_SAE = 'enfermagem.sae';

/** A tolerância (minutos) do horário da atividade antes de ficar atrasada (a da checagem de cuidados do M25). */
export const TOLERANCIA_CUIDADO_MIN = 60;

// ── Terminologia ────────────────────────────────────────────────────────────────────────────────────

export interface TermoSae {
  readonly codigo: string;
  readonly descricao: string;
}
export interface DiagnosticoTermoSae extends TermoSae {
  /** Diagnóstico de risco: pede os fatores de risco e não tem características definidoras. */
  readonly risco: boolean;
  readonly caracteristicas: readonly TermoSae[];
  readonly fatores: readonly TermoSae[];
}
export interface IntervencaoTermoSae extends TermoSae {
  readonly atividades: readonly TermoSae[];
}
export interface TerminologiaSae {
  readonly sistema: SistemaTerminologiaSae;
  readonly versao: string;
  readonly licenca: string;
  /** A sintética de teste do código (a DP-19 ainda não escolheu nem carregou a terminologia licenciada). */
  readonly sintetica: boolean;
  readonly diagnosticos: readonly DiagnosticoTermoSae[];
  readonly resultados: readonly TermoSae[];
  readonly intervencoes: readonly IntervencaoTermoSae[];
}

const t = (codigo: string, descricao: string): TermoSae => ({ codigo, descricao });

/**
 * A terminologia SINTÉTICA de teste (DP-19 em aberto): rótulos genéricos escritos para o teste, marcados como
 * sintéticos, sem copiar o conteúdo licenciado de nenhuma terminologia. Serve ao motor, às telas e aos testes; a
 * terminologia escolhida pela diretoria de enfermagem é carregada como dado (com a licença e a versão).
 */
export const TERMINOLOGIA_SAE_SINTETICA: TerminologiaSae = {
  sistema: 'SINT',
  versao: 'SINT-2026.1',
  licenca: 'Terminologia sintética de teste (DP-19: a terminologia do hospital ainda não foi escolhida)',
  sintetica: true,
  diagnosticos: [
    {
      codigo: 'S-D01',
      descricao: 'Sintético: risco de lesão da pele por pressão',
      risco: true,
      caracteristicas: [],
      fatores: [
        t('S-F011', 'Mobilidade reduzida no leito'),
        t('S-F012', 'Umidade da pele'),
        t('S-F013', 'Escore de risco de lesão alterado'),
      ],
    },
    {
      codigo: 'S-D02',
      descricao: 'Sintético: risco de queda',
      risco: true,
      caracteristicas: [],
      fatores: [
        t('S-F021', 'Uso de medicamento sedativo'),
        t('S-F022', 'Marcha instável'),
        t('S-F023', 'Escore de risco de queda alterado'),
      ],
    },
    {
      codigo: 'S-D03',
      descricao: 'Sintético: padrão respiratório alterado',
      risco: false,
      caracteristicas: [
        t('S-C031', 'Frequência respiratória aumentada'),
        t('S-C032', 'Uso de musculatura acessória'),
        t('S-C033', 'Saturação abaixo do esperado'),
      ],
      fatores: [t('S-F031', 'Secreção nas vias aéreas'), t('S-F032', 'Fadiga')],
    },
    {
      codigo: 'S-D04',
      descricao: 'Sintético: dor aguda',
      risco: false,
      caracteristicas: [
        t('S-C041', 'Relato de dor em escala'),
        t('S-C042', 'Expressão facial de dor'),
        t('S-C043', 'Posição de proteção'),
      ],
      fatores: [t('S-F041', 'Lesão por procedimento'), t('S-F042', 'Processo inflamatório')],
    },
    {
      codigo: 'S-D05',
      descricao: 'Sintético: risco de infecção',
      risco: true,
      caracteristicas: [],
      fatores: [t('S-F051', 'Dispositivo invasivo'), t('S-F052', 'Ferida operatória')],
    },
  ],
  resultados: [
    t('S-R01', 'Integridade da pele preservada'),
    t('S-R02', 'Ausência de queda'),
    t('S-R03', 'Padrão respiratório eficaz'),
    t('S-R04', 'Nível de dor controlado'),
    t('S-R05', 'Ausência de sinais de infecção'),
  ],
  intervencoes: [
    {
      codigo: 'S-I01',
      descricao: 'Prevenção de lesão por pressão',
      atividades: [
        t('S-A011', 'Mudar o decúbito'),
        t('S-A012', 'Inspecionar a pele das proeminências ósseas'),
        t('S-A013', 'Manter a pele limpa e seca'),
      ],
    },
    {
      codigo: 'S-I02',
      descricao: 'Prevenção de queda',
      atividades: [
        t('S-A021', 'Manter as grades do leito elevadas'),
        t('S-A022', 'Orientar o paciente a pedir ajuda para levantar'),
      ],
    },
    {
      codigo: 'S-I03',
      descricao: 'Controle das vias aéreas',
      atividades: [
        t('S-A031', 'Elevar a cabeceira'),
        t('S-A032', 'Aspirar as vias aéreas'),
        t('S-A033', 'Monitorar a saturação'),
      ],
    },
    {
      codigo: 'S-I04',
      descricao: 'Controle da dor',
      atividades: [t('S-A041', 'Avaliar a dor em escala'), t('S-A042', 'Aplicar compressa fria')],
    },
    {
      codigo: 'S-I05',
      descricao: 'Proteção contra infecção',
      atividades: [
        t('S-A051', 'Inspecionar o local de inserção do dispositivo'),
        t('S-A052', 'Fazer o curativo da ferida'),
      ],
    },
  ],
};

// ── Domínios do estabelecimento (escala de 1 a 5 e meta) ─────────────────────────────────────────────

/** Um ponto da escala de resultado (1 a 5; `valor` nulo é o "não se aplica"). */
export interface PontoEscalaSae {
  readonly codigo: number;
  readonly rotulo: string;
  readonly valor: number | null;
}
export interface ClassificacaoMetaSae {
  readonly codigo: number;
  readonly rotulo: string;
  /** O sentido interpretado do rótulo (aumentar para, manter em, diminuir para); nulo: rótulo nunca visto (regra 15). */
  readonly sentido: SentidoMetaSae | null;
}
export interface DominiosSae {
  readonly escala: readonly PontoEscalaSae[];
  readonly metas: readonly ClassificacaoMetaSae[];
}

// ── Entradas ──────────────────────────────────────────────────────────────────────────────────────

const codigoTermo = z.string().regex(/^[A-Za-z0-9.\-_]{1,20}$/, 'Código de termo inválido.');
const codigoDominio = z.number().int().min(1).max(32_767);
const idItem = idBanco;
const horaDoDia = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Hora no formato HH:mm.');

export const esquemaResultadoSae = z
  .object({
    codigo: codigoTermo,
    /** O ponto da escala de agora (código do domínio). */
    escalaAtual: codigoDominio,
    /** A classificação da meta (código do domínio: aumentar para, manter em, diminuir para). */
    meta: codigoDominio,
    /** O ponto da escala da meta (código do domínio). */
    escalaMeta: codigoDominio,
  })
  .strict();

export const esquemaDiagnosticoSae = z
  .object({
    codigo: codigoTermo,
    caracteristicas: z.array(codigoTermo).max(30).default([]),
    fatores: z.array(codigoTermo).max(30).default([]),
    resultados: z.array(esquemaResultadoSae).min(1).max(5),
    intervencoes: z
      .array(z.object({ codigo: codigoTermo }).strict())
      .min(1)
      .max(8),
  })
  .strict();
export type DiagnosticoSaeEntrada = z.infer<typeof esquemaDiagnosticoSae>;

/**
 * Registrar o processo (avaliação, diagnóstico e planejamento): a primeira versão ou a revisão (versão nova que
 * substitui a vigente; a tela manda a versão que viu — se outra foi gravada no meio, o servidor recusa).
 */
export const esquemaRegistrarSae = z
  .object({
    avaliacao: textoLongo(4000).pipe(
      z.string().min(20, 'Descreva a avaliação de enfermagem (20 caracteres ou mais).'),
    ),
    diagnosticos: z.array(esquemaDiagnosticoSae).min(1).max(15),
    /** A versão vigente que a tela viu (0: nenhuma). */
    versaoVista: z.number().int().min(0).max(32_767),
  })
  .strict();
export type RegistrarSaeEntrada = z.infer<typeof esquemaRegistrarSae>;

/** A evolução de enfermagem: reavalia cada resultado do processo vigente (o ponto da escala de agora). */
export const esquemaEvoluirSae = z
  .object({
    versaoVista: z.number().int().min(1).max(32_767),
    resultados: z
      .array(
        z
          .object({
            resultado: idItem,
            escala: codigoDominio,
          })
          .strict(),
      )
      .min(1)
      .max(40),
    nota: textoLongo(1000).pipe(
      z.string().min(10, 'Registre a evolução de enfermagem (10 caracteres ou mais).'),
    ),
  })
  .strict();
export type EvoluirSaeEntrada = z.infer<typeof esquemaEvoluirSae>;

export const esquemaAtividadeCuidado = z
  .object({
    /** A intervenção do processo vigente de onde vem a atividade. */
    intervencao: idItem,
    /** A atividade da terminologia (ou nula: atividade descrita pelo enfermeiro). */
    codigo: codigoTermo.nullable().default(null),
    descricao: livre(300).pipe(z.string().min(3, 'Descreva a atividade.')),
    /** Vezes por dia (1 a 24); 0 = se necessário (sem horário aprazado). */
    frequenciaDia: z.number().int().min(0).max(24),
    /** Os horários aprazados (HH:mm), um por vez do dia; vazio no "se necessário". */
    horarios: z.array(horaDoDia).max(24).default([]),
    /** Início da atividade (sem ele, agora). */
    inicio: esquemaDataHoraLocal.nullable().default(null),
    /** Fim (opcional; sem ele, até suspender ou revisar o processo). */
    fim: esquemaDataHoraLocal.nullable().default(null),
  })
  .strict();
export type AtividadeCuidadoEntrada = z.infer<typeof esquemaAtividadeCuidado>;

/** Prescrever os cuidados (as atividades das intervenções) do processo vigente. */
export const esquemaPrescreverCuidado = z
  .object({
    versaoVista: z.number().int().min(1).max(32_767),
    atividades: z.array(esquemaAtividadeCuidado).min(1).max(20),
  })
  .strict();
export type PrescreverCuidadoEntrada = z.infer<typeof esquemaPrescreverCuidado>;

export const esquemaSuspenderCuidado = z
  .object({ motivo: livre(300).pipe(z.string().min(10, 'Justifique a suspensão (10 caracteres ou mais).')) })
  .strict();

/** Checar um horário da atividade (feita, ou não feita com o motivo: regra 8). */
export const esquemaChecarCuidado = z
  .object({
    previsto: esquemaDataHoraLocal,
    feita: z.boolean(),
    motivo: livre(200).nullable().default(null),
    /** A hora real do ato (a do aparelho sem rede); sem ela, a do banco. */
    horaReal: esquemaDataHoraLocal.nullable().default(null),
    origemOffline: z.boolean().default(false),
  })
  .strict();
export type ChecarCuidadoEntrada = z.infer<typeof esquemaChecarCuidado>;

export const esquemaEstornarCuidado = z
  .object({ motivo: livre(200).pipe(z.string().min(10, 'Justifique o estorno (10 caracteres ou mais).')) })
  .strict();

/** Carregar uma versão da terminologia escolhida pela DP-19 (dado licenciado, com a licença e a versão). */
export const esquemaCarregarTerminologiaSae = z
  .object({
    sistema: z.enum(['NNN', 'CIPE']),
    versao: z.string().regex(/^[A-Za-z0-9.\-_]{1,20}$/, 'Versão inválida.'),
    licenca: livre(200).pipe(z.string().min(10, 'Informe a licença de uso (10 caracteres ou mais).')),
    termos: z
      .array(
        z
          .object({
            tipo: z.enum(TIPOS_TERMO_SAE),
            codigo: codigoTermo,
            /** O diagnóstico da característica e do fator; a intervenção da atividade. */
            pai: codigoTermo.nullable().default(null),
            descricao: livre(300).pipe(z.string().min(2)),
            risco: z.boolean().default(false),
          })
          .strict(),
      )
      .min(3)
      .max(5_000),
    /** A carga é crítica: a senha conferida de novo (reautenticação). */
    senha: z.string().min(1).max(200),
  })
  .strict();
export type CarregarTerminologiaSaeEntrada = z.infer<typeof esquemaCarregarTerminologiaSae>;

// ── Respostas ─────────────────────────────────────────────────────────────────────────────────────

export interface EvolucaoResultadoLida {
  readonly id: number;
  readonly escala: number;
  readonly situacao: SituacaoEvolucaoSae;
  readonly usuario: string;
  readonly em: string;
}
export interface ResultadoSaeLido {
  readonly id: number;
  readonly codigo: string | null;
  readonly descricao: string;
  readonly escalaAtual: number;
  readonly meta: number;
  readonly escalaMeta: number;
  readonly evolucoes: readonly EvolucaoResultadoLida[];
}
export interface AtividadeSaeLida {
  readonly id: number;
  readonly codigo: string | null;
  readonly descricao: string;
  readonly frequenciaDia: number;
  readonly horarios: readonly string[];
  readonly inicio: string;
  readonly fim: string | null;
  readonly suspensa: { readonly motivo: string; readonly usuario: string; readonly em: string } | null;
  readonly usuario: string;
  readonly em: string;
}
export interface IntervencaoSaeLida {
  readonly id: number;
  readonly codigo: string | null;
  readonly descricao: string;
  readonly atividades: readonly AtividadeSaeLida[];
}
export interface DiagnosticoSaeLido {
  readonly id: number;
  readonly codigo: string;
  readonly descricao: string;
  readonly caracteristicas: readonly TermoSae[];
  readonly fatores: readonly TermoSae[];
  readonly resultados: readonly ResultadoSaeLido[];
  readonly intervencoes: readonly IntervencaoSaeLida[];
}
export interface EvolucaoSaeLida {
  readonly id: number;
  readonly nota: string;
  readonly usuario: string;
  readonly em: string;
}
export interface ProcessoSaeLido {
  readonly id: number;
  readonly versao: number;
  readonly avaliacao: string;
  readonly sistema: SistemaTerminologiaSae;
  readonly versaoTerminologia: string;
  readonly usuario: string;
  readonly em: string;
  /** O registro no prontuário (nulo até a DP-27 escolher o modelo do registro-resumo). */
  readonly registroProntuario: number | null;
  readonly diagnosticos: readonly DiagnosticoSaeLido[];
  readonly evolucoes: readonly EvolucaoSaeLida[];
}

/** Uma checagem (ou o estorno dela) de um horário de atividade. */
export interface ChecagemCuidadoLida {
  readonly id: number;
  readonly atividade: number;
  readonly previsto: string;
  readonly feita: boolean;
  readonly motivo: string | null;
  readonly horaReal: string;
  readonly origemOffline: boolean;
  readonly categoria: 'enfermeiro' | 'tecnico';
  readonly usuario: string;
  readonly em: string;
  /** O estorno que anulou esta checagem (a checagem fica guardada). */
  readonly estorno: { readonly id: number; readonly motivo: string; readonly usuario: string } | null;
}

/** Um horário de atividade no turno (a linha do tempo da prescrição de enfermagem). */
export interface HorarioCuidado {
  readonly atividade: number;
  readonly atendimento: number;
  readonly paciente: number;
  readonly nome: string;
  readonly leito: string;
  readonly descricao: string;
  readonly previsto: string;
  readonly estado: EstadoCuidado;
  readonly seNecessario: boolean;
  /** A checagem vigente (a última não estornada). */
  readonly checagem: ChecagemCuidadoLida | null;
  /** Os estornos já feitos deste horário. */
  readonly estornos: number;
}

export interface GravacaoSae {
  readonly ligada: boolean;
  readonly motivo: string | null;
  /** O vínculo da sessão é de enfermeiro com o conselho ativo (SAE, diagnóstico e prescrição: privativos). */
  readonly enfermeiro: boolean;
  /** Enfermeiro ou técnico de enfermagem (quem checa). */
  readonly enfermagem: boolean;
  readonly operacoes: Readonly<Record<string, { readonly pode: boolean; readonly motivo: string | null }>>;
}

export interface SaeDoPaciente {
  readonly atendimento: number;
  readonly paciente: number;
  readonly numero: number;
  readonly nome: string;
  readonly leito: string;
  readonly unidade: string;
  readonly agora: string;
  readonly terminologia: Omit<TerminologiaSae, 'diagnosticos' | 'resultados' | 'intervencoes'>;
  readonly catalogo: Pick<TerminologiaSae, 'diagnosticos' | 'resultados' | 'intervencoes'>;
  readonly dominios: DominiosSae;
  /** O processo vigente (a última versão), nulo antes do primeiro. */
  readonly atual: ProcessoSaeLido | null;
  readonly versoes: readonly {
    readonly id: number;
    readonly versao: number;
    readonly usuario: string;
    readonly em: string;
  }[];
  /** As etapas feitas do processo vigente (as cinco da COFEN 736/2024). */
  readonly etapas: readonly { readonly etapa: EtapaSae; readonly feita: boolean }[];
  /** Os horários de hoje das atividades vigentes, com a checagem. */
  readonly horarios: readonly HorarioCuidado[];
  /** A grade de horários-padrão da unidade por vezes ao dia (HH:mm), para propor o aprazamento. */
  readonly grade: Readonly<Record<string, readonly string[]>>;
  readonly gravacao: GravacaoSae;
}

export interface CuidadosDoTurno {
  readonly unidade: string;
  readonly turno: { readonly nome: 'diurno' | 'noturno'; readonly inicio: string; readonly fim: string };
  readonly agora: string;
  readonly horarios: readonly HorarioCuidado[];
  readonly resumo: Readonly<Record<EstadoCuidado | 'seNecessario', number>>;
  readonly gravacao: GravacaoSae;
  /** A leitura chegou ao teto (500 horários): a tela avisa. */
  readonly cortada: boolean;
}

export interface ResultadoSae {
  readonly ok: true;
  readonly ids: readonly number[];
  readonly mensagem: string;
}
