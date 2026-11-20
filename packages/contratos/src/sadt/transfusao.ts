// Agência transfusional, etapa 1 (M47; ficha, seções 5 a 8): requisição transfusional nascida do item de hemoterapia
// da prescrição, amostra identificada à beira do leito, ato transfusional com dupla checagem e sinais vitais nos tempos
// previstos, reação transfusional e hemovigilância. Escopo comum às duas respostas da DP-21 (agência própria ou
// hemocentro): a imuno-hematologia, a prova cruzada e o estoque de bolsas são da etapa 2 (chave `agencia.completa`).
// Perfil da cópia pc (só agregados, 2026-10-24):
//   - itens de hemoterapia prescritos: 910 (2020 a 2026; 93 em 2026), todos no ato 99 do cadastro de procedimentos:
//     CH concentrado de hemácias 801, CP concentrado de plaquetas 79, PLC plasma fresco congelado 27, CR
//     crioprecipitado <5; unidade da dose BOLS ou UN; indicação clínica escrita em 136; "iniciar agora" em 6;
//   - horários de checagem nascidos para o item: 864 (P prescrito 810, O oculto 27, S suspenso 27; nenhum com
//     acompanhante de checagem); 49 itens sem horário (o ato fica só no novo, ficha seção 5, condicional);
//   - os 4 tipos de transfusão do cadastro do outro sistema são os da RDC 34/2014 (programada, rotina em 24 h,
//     urgência em 3 h, emergência): o novo usa os mesmos códigos 1 a 4;
//   - tipo sanguíneo (4: A, B, AB, O) e fator Rh (2: positivo, negativo) do cadastro do outro sistema; o tipo e o fator
//     do paciente estão preenchidos em 1.290 cadastros (de cerca de 47 mil);
//   - nenhuma transfusão, reação, bolsa ou pré-transfusão registrada (os cadastros da agência têm só a linha 0 "NAO
//     INFORMADO").
// Nenhum nome de tabela do legado sai daqui para a tela (ADR 0023).
import { z } from 'zod';
import { esquemaConferente, esquemaLeituraPulseira } from '../enfermagem/entradas.js';
import { textoCp1252 } from '../texto-cp1252.js';

// ── Vocabulário ──────────────────────────────────────────────────────────────────────────────────────

/** Ato do cadastro de procedimentos que agrupa os hemocomponentes prescritíveis (o único visto no perfil). */
export const ATO_HEMOCOMPONENTE = 99;

/** Classe clínica do hemocomponente: decide a regra de compatibilidade ABO e Rh (regra 3). */
export const CLASSES_HEMOCOMPONENTE = [
  'hemacias',
  'plaquetas',
  'plasma',
  'crioprecipitado',
  'outro',
] as const;
export type ClasseHemocomponente = (typeof CLASSES_HEMOCOMPONENTE)[number];

/** Códigos vistos no perfil (ato 99) → classe e rótulo de produto; código não visto vale "outro". */
export const HEMOCOMPONENTES_VISTOS: Readonly<
  Record<string, { readonly classe: ClasseHemocomponente; readonly rotulo: string }>
> = Object.freeze({
  CH: { classe: 'hemacias', rotulo: 'Concentrado de hemácias' },
  CP: { classe: 'plaquetas', rotulo: 'Concentrado de plaquetas' },
  PLC: { classe: 'plasma', rotulo: 'Plasma fresco congelado' },
  CR: { classe: 'crioprecipitado', rotulo: 'Crioprecipitado' },
});

export function classeDoHemocomponente(codigo: string): ClasseHemocomponente {
  return HEMOCOMPONENTES_VISTOS[codigo.trim().toUpperCase()]?.classe ?? 'outro';
}

/**
 * Tipos de transfusão (RDC 34/2014): os mesmos 4 códigos do cadastro do outro sistema. A ficha chama a 4 de "extrema
 * urgência"; o rótulo de produto segue a ficha.
 */
export const URGENCIAS_TRANSFUSAO = [
  { codigo: 'programada', id: 1, rotulo: 'Programada (dia e hora marcados)', prazoHoras: null },
  { codigo: 'rotina', id: 2, rotulo: 'Rotina (em até 24 horas)', prazoHoras: 24 },
  { codigo: 'urgente', id: 3, rotulo: 'Urgente (em até 3 horas)', prazoHoras: 3 },
  { codigo: 'extremaUrgencia', id: 4, rotulo: 'Extrema urgência (risco imediato à vida)', prazoHoras: 0 },
] as const;
export type UrgenciaTransfusao = (typeof URGENCIAS_TRANSFUSAO)[number]['codigo'];
export const CODIGOS_URGENCIA_TRANSFUSAO = URGENCIAS_TRANSFUSAO.map((u) => u.codigo) as [
  UrgenciaTransfusao,
  ...UrgenciaTransfusao[],
];
export function urgenciaPorId(id: number): UrgenciaTransfusao | null {
  return URGENCIAS_TRANSFUSAO.find((u) => u.id === id)?.codigo ?? null;
}
export function rotuloUrgencia(u: UrgenciaTransfusao): string {
  return URGENCIAS_TRANSFUSAO.find((x) => x.codigo === u)?.rotulo ?? u;
}

/** Tipo sanguíneo (IDs do cadastro do outro sistema: 1 A, 2 B, 3 AB, 4 O). */
export const GRUPOS_ABO = ['A', 'B', 'AB', 'O'] as const;
export type GrupoAbo = (typeof GRUPOS_ABO)[number];
export const ID_GRUPO_ABO: Readonly<Record<GrupoAbo, number>> = Object.freeze({ A: 1, B: 2, AB: 3, O: 4 });
/** Fator Rh (IDs do cadastro do outro sistema: 1 positivo, 2 negativo). */
export const FATORES_RH = ['positivo', 'negativo'] as const;
export type FatorRh = (typeof FATORES_RH)[number];
export const ID_FATOR_RH: Readonly<Record<FatorRh, number>> = Object.freeze({ positivo: 1, negativo: 2 });

export function grupoAboPorId(id: number | null | undefined): GrupoAbo | null {
  return GRUPOS_ABO.find((g) => ID_GRUPO_ABO[g] === id) ?? null;
}
export function fatorRhPorId(id: number | null | undefined): FatorRh | null {
  return FATORES_RH.find((f) => ID_FATOR_RH[f] === id) ?? null;
}
/** Tipo do cadastro do paciente (texto de até 3 letras) → grupo; vazio ou desconhecido → null. */
export function grupoAboDoTexto(t: string | null | undefined): GrupoAbo | null {
  const v = (t ?? '').trim().toUpperCase();
  return (GRUPOS_ABO as readonly string[]).includes(v) ? (v as GrupoAbo) : null;
}

export interface TipagemSanguinea {
  readonly abo: GrupoAbo | null;
  readonly rh: FatorRh | null;
}
export function rotuloTipagem(t: TipagemSanguinea): string {
  if (!t.abo || !t.rh) return 'Tipagem não informada';
  return `${t.abo} ${t.rh === 'positivo' ? 'Rh positivo' : 'Rh negativo'}`;
}

/** Situações da requisição transfusional. */
export const ESTADOS_REQUISICAO_TRANSFUSAO = [
  { codigo: 'requisitada', rotulo: 'Requisitada' },
  { codigo: 'amostraColetada', rotulo: 'Amostra coletada' },
  { codigo: 'emAtendimento', rotulo: 'Em atendimento' },
  { codigo: 'atendida', rotulo: 'Atendida' },
  { codigo: 'cancelada', rotulo: 'Cancelada' },
] as const;
export type EstadoRequisicaoTransfusao = (typeof ESTADOS_REQUISICAO_TRANSFUSAO)[number]['codigo'];
export const CODIGOS_ESTADO_REQUISICAO_TRANSFUSAO = ESTADOS_REQUISICAO_TRANSFUSAO.map((e) => e.codigo) as [
  EstadoRequisicaoTransfusao,
  ...EstadoRequisicaoTransfusao[],
];

/** Situações do ato transfusional (uma bolsa por ato). */
export const ESTADOS_ATO_TRANSFUSIONAL = [
  { codigo: 'emCurso', rotulo: 'Em curso' },
  { codigo: 'concluido', rotulo: 'Concluído' },
  { codigo: 'interrompido', rotulo: 'Interrompido' },
] as const;
export type EstadoAtoTransfusional = (typeof ESTADOS_ATO_TRANSFUSIONAL)[number]['codigo'];
export const CODIGOS_ESTADO_ATO_TRANSFUSIONAL = ESTADOS_ATO_TRANSFUSIONAL.map((e) => e.codigo) as [
  EstadoAtoTransfusional,
  ...EstadoAtoTransfusional[],
];

/** Momentos dos sinais vitais do ato (regra 4): antes, aos 10 a 15 minutos e depois. */
export const MOMENTOS_SINAIS_TRANSFUSAO = [
  { codigo: 'antes', rotulo: 'Antes do início' },
  { codigo: 'durante', rotulo: 'Aos 10 a 15 minutos' },
  { codigo: 'depois', rotulo: 'Ao término' },
] as const;
export type MomentoSinaisTransfusao = (typeof MOMENTOS_SINAIS_TRANSFUSAO)[number]['codigo'];
export const CODIGOS_MOMENTO_SINAIS = MOMENTOS_SINAIS_TRANSFUSAO.map((m) => m.codigo) as [
  MomentoSinaisTransfusao,
  ...MomentoSinaisTransfusao[],
];

/**
 * Reações transfusionais (Marco conceitual e operacional de hemovigilância da Anvisa e IN 196/2022): o código, o
 * rótulo e se é imediata (até 24 horas) ou tardia. A lista é a do formulário de notificação; o comitê transfusional
 * confere na validação.
 */
export const TIPOS_REACAO_TRANSFUSIONAL = [
  { codigo: 'febrilNaoHemolitica', rotulo: 'Reação febril não hemolítica', tempo: 'imediata' },
  { codigo: 'alergica', rotulo: 'Reação alérgica', tempo: 'imediata' },
  { codigo: 'hemoliticaAgudaImune', rotulo: 'Reação hemolítica aguda imunológica', tempo: 'imediata' },
  { codigo: 'hemoliticaAgudaNaoImune', rotulo: 'Reação hemolítica aguda não imune', tempo: 'imediata' },
  { codigo: 'trali', rotulo: 'Lesão pulmonar aguda relacionada à transfusão (TRALI)', tempo: 'imediata' },
  { codigo: 'taco', rotulo: 'Sobrecarga circulatória associada à transfusão (TACO)', tempo: 'imediata' },
  { codigo: 'dispneiaAssociada', rotulo: 'Dispneia associada à transfusão', tempo: 'imediata' },
  { codigo: 'hipotensiva', rotulo: 'Reação hipotensiva', tempo: 'imediata' },
  { codigo: 'contaminacaoBacteriana', rotulo: 'Contaminação bacteriana', tempo: 'imediata' },
  {
    codigo: 'disturbioMetabolico',
    rotulo: 'Distúrbio metabólico (hipocalcemia, hipercalemia, hipotermia)',
    tempo: 'imediata',
  },
  { codigo: 'dorAguda', rotulo: 'Dor aguda relacionada à transfusão', tempo: 'imediata' },
  { codigo: 'hemoliticaTardia', rotulo: 'Reação hemolítica tardia', tempo: 'tardia' },
  {
    codigo: 'aloimunizacao',
    rotulo: 'Aloimunização ou aparecimento de anticorpo irregular',
    tempo: 'tardia',
  },
  { codigo: 'dechT', rotulo: 'Doença do enxerto contra o hospedeiro pós-transfusional', tempo: 'tardia' },
  { codigo: 'purpuraPosTransfusional', rotulo: 'Púrpura pós-transfusional', tempo: 'tardia' },
  { codigo: 'sobrecargaFerro', rotulo: 'Sobrecarga de ferro', tempo: 'tardia' },
  { codigo: 'transmissaoInfecciosa', rotulo: 'Transmissão de doença infecciosa', tempo: 'tardia' },
  { codigo: 'outra', rotulo: 'Outra reação', tempo: 'imediata' },
] as const;
export type TipoReacaoTransfusional = (typeof TIPOS_REACAO_TRANSFUSIONAL)[number]['codigo'];
export const CODIGOS_TIPO_REACAO = TIPOS_REACAO_TRANSFUSIONAL.map((t) => t.codigo) as [
  TipoReacaoTransfusional,
  ...TipoReacaoTransfusional[],
];
export function rotuloTipoReacao(t: TipoReacaoTransfusional): string {
  return TIPOS_REACAO_TRANSFUSIONAL.find((x) => x.codigo === t)?.rotulo ?? t;
}

/** Gravidade (graus 1 a 4 do marco de hemovigilância). */
export const GRAVIDADES_REACAO = [
  { grau: 1, rotulo: 'Grau 1 (leve)' },
  { grau: 2, rotulo: 'Grau 2 (moderada)' },
  { grau: 3, rotulo: 'Grau 3 (grave)' },
  { grau: 4, rotulo: 'Grau 4 (óbito)' },
] as const;
export type GrauReacao = (typeof GRAVIDADES_REACAO)[number]['grau'];

/** Correlação com a transfusão (imputabilidade). */
export const CORRELACOES_REACAO = [
  { codigo: 'confirmada', rotulo: 'Confirmada' },
  { codigo: 'provavel', rotulo: 'Provável' },
  { codigo: 'possivel', rotulo: 'Possível' },
  { codigo: 'improvavel', rotulo: 'Improvável' },
  { codigo: 'descartada', rotulo: 'Descartada' },
  { codigo: 'inconclusiva', rotulo: 'Inconclusiva' },
] as const;
export type CorrelacaoReacao = (typeof CORRELACOES_REACAO)[number]['codigo'];
export const CODIGOS_CORRELACAO = CORRELACOES_REACAO.map((c) => c.codigo) as [
  CorrelacaoReacao,
  ...CorrelacaoReacao[],
];

/** Condutas imediatas na suspeita de reação. */
export const CONDUTAS_REACAO = [
  { codigo: 'interromperTransfusao', rotulo: 'Interromper a transfusão' },
  { codigo: 'manterAcesso', rotulo: 'Manter o acesso venoso com solução fisiológica' },
  { codigo: 'conferirIdentificacao', rotulo: 'Conferir de novo a identificação da bolsa e do paciente' },
  { codigo: 'comunicarMedico', rotulo: 'Comunicar o médico assistente' },
  { codigo: 'comunicarAgencia', rotulo: 'Comunicar a agência transfusional' },
  { codigo: 'enviarBolsaEAmostra', rotulo: 'Enviar a bolsa e uma amostra nova à agência' },
  { codigo: 'medicar', rotulo: 'Medicar conforme prescrição' },
  { codigo: 'outra', rotulo: 'Outra conduta' },
] as const;
export type CondutaReacao = (typeof CONDUTAS_REACAO)[number]['codigo'];
export const CODIGOS_CONDUTA_REACAO = CONDUTAS_REACAO.map((c) => c.codigo) as [
  CondutaReacao,
  ...CondutaReacao[],
];

/** Destino da bolsa depois da reação. */
export const DESTINOS_BOLSA_REACAO = ['devolvida', 'descartada', 'naoSeAplica'] as const;
export type DestinoBolsaReacao = (typeof DESTINOS_BOLSA_REACAO)[number];

// ── Entradas (o mesmo Zod na tela, na API e no serviço) ──────────────────────────────────────────────

const id = z.number().int().positive().max(2_147_483_647);
const idLongo = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const livre = (max: number) => textoCp1252(max).overwrite((t) => t.replace(/\s+/g, ' ').trim());
const instante = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?/, 'Data e hora no formato ISO.');
/** Número da bolsa como impresso na etiqueta (ISBT 128 ou o número do hemocentro): letras, dígitos e hífen. */
export const esquemaNumeroBolsa = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[0-9A-Z][0-9A-Z-]{3,23}$/, 'Número da bolsa inválido.');
/** A leitura da pulseira e o segundo profissional são os da checagem do M25 (mesmo Zod, mesmos motivos). */
const leituraPulseira = esquemaLeituraPulseira;
const tipagem = z.object({ abo: z.enum(GRUPOS_ABO), rh: z.enum(FATORES_RH) }).strict();
const sinais = z
  .object({
    pas: z.number().min(40).max(300),
    pad: z.number().min(20).max(200),
    fc: z.number().min(20).max(250),
    temperatura: z.number().min(30).max(43),
    fr: z.number().min(4).max(70).optional(),
    spo2: z.number().min(50).max(100).optional(),
  })
  .strict();
export type SinaisTransfusao = z.infer<typeof sinais>;
export const esquemaSinaisTransfusao = sinais;

// sadt.requisitarTransfusao (regra 1)
export const esquemaRequisitarTransfusao = z
  .object({
    /** Item de hemoterapia da prescrição (PRPRESCHEMO.ID). */
    itemHemoterapia: id,
    atendimento: idLongo,
    quantidadeBolsas: z.number().int().min(1).max(20),
    volumeMl: z.number().int().min(1).max(5_000).nullable(),
    urgencia: z.enum(CODIGOS_URGENCIA_TRANSFUSAO),
    /** Só na programada: quando. */
    programadaPara: instante.nullable(),
    indicacao: livre(2_000).pipe(z.string().min(10, 'Escreva a indicação clínica (ao menos 10 caracteres).')),
    /** Exames que embasam a indicação (hemoglobina, plaquetas, coagulograma), como o médico escreveu. */
    examesDeApoio: livre(500).nullable(),
    /** Termo de consentimento da transfusão (SGH_PEP_TCLE.ID, M23). */
    termo: idLongo.nullable(),
    /** Extrema urgência sem termo nem provas: a justificativa do médico (termo de responsabilidade). */
    justificativaUrgencia: livre(500).nullable(),
    transfusaoAnterior: z.enum(['sim', 'nao', 'naoSabe']),
    reacaoAnterior: z.enum(['sim', 'nao', 'naoSabe']),
    gestacaoAnterior: z.enum(['sim', 'nao', 'naoSeAplica']),
  })
  .strict()
  .refine((r) => r.urgencia !== 'programada' || r.programadaPara !== null, {
    message: 'A transfusão programada exige o dia e a hora.',
    path: ['programadaPara'],
  })
  .refine((r) => r.termo !== null || r.urgencia === 'extremaUrgencia', {
    message: 'Anexe o termo de consentimento da transfusão.',
    path: ['termo'],
  })
  .refine(
    (r) =>
      r.urgencia !== 'extremaUrgencia' ||
      r.termo !== null ||
      (r.justificativaUrgencia !== null && r.justificativaUrgencia.length >= 10),
    { message: 'Na extrema urgência sem termo, escreva a justificativa.', path: ['justificativaUrgencia'] },
  );
export type RequisitarTransfusaoEntrada = z.infer<typeof esquemaRequisitarTransfusao>;

// sadt.registrarAmostraTransfusional
export const esquemaRegistrarAmostraTransfusional = z
  .object({
    requisicao: idLongo,
    pulseira: leituraPulseira,
    /** Nome completo e data de nascimento conferidos com o paciente (ou o acompanhante). */
    identificadoresConferidos: z.literal(true, {
      message: 'Confira o nome completo e a data de nascimento.',
    }),
    /** Tubo rotulado à beira do leito, na frente do paciente. */
    rotuladaNoLeito: z.literal(true, { message: 'A amostra é rotulada à beira do leito.' }),
    coletadaEm: instante,
  })
  .strict();
export type RegistrarAmostraTransfusionalEntrada = z.infer<typeof esquemaRegistrarAmostraTransfusional>;

// sadt.iniciarTransfusao (enfermagem.checarAdministracao, cenário hemocomponente; regra 2)
export const esquemaIniciarTransfusao = z
  .object({
    requisicao: idLongo,
    /** Horário de checagem do item no outro sistema (PRCHKGERAL.ID), quando nasceu. */
    horario: id.nullable(),
    pulseira: leituraPulseira,
    bolsa: z
      .object({
        numero: esquemaNumeroBolsa,
        hemocomponente: z.string().trim().toUpperCase().min(1).max(4),
        tipagem,
        validade: instante,
        volumeMl: z.number().int().min(1).max(1_000),
        /** A etiqueta de identificação do receptor na bolsa confere com o paciente (nome e registro). */
        etiquetaDoReceptorConfere: z.literal(true, {
          message: 'Confira a etiqueta do receptor na bolsa com o paciente.',
        }),
        /** Inspeção visual (sem coágulo, hemólise, vazamento, cor alterada). */
        inspecaoVisualOk: z.literal(true, { message: 'Faça a inspeção visual da bolsa.' }),
      })
      .strict(),
    /** Segundo profissional (login e senha conferidos na hora pelo servidor; nunca guardados). */
    segundoProfissional: esquemaConferente,
    sinaisAntes: sinais,
    /** Bolsa Rh positivo em receptor Rh negativo: só com a justificativa do médico. */
    justificativaRh: livre(300).nullable(),
  })
  .strict();
export type IniciarTransfusaoEntrada = z.infer<typeof esquemaIniciarTransfusao>;

// Sinais aos 10 a 15 minutos e ao término (regra 4)
export const esquemaRegistrarSinaisTransfusao = z
  .object({
    ato: idLongo,
    momento: z.enum(['durante', 'depois']),
    sinais,
    medidoEm: instante,
  })
  .strict();
export type RegistrarSinaisTransfusaoEntrada = z.infer<typeof esquemaRegistrarSinaisTransfusao>;

export const esquemaConcluirTransfusao = z
  .object({
    ato: idLongo,
    terminoEm: instante,
    volumeTransfundidoMl: z.number().int().min(0).max(1_000),
    interrompida: z.boolean(),
    motivoInterrupcao: livre(300).nullable(),
  })
  .strict()
  .refine((c) => !c.interrompida || (c.motivoInterrupcao !== null && c.motivoInterrupcao.length >= 5), {
    message: 'Escreva o motivo da interrupção.',
    path: ['motivoInterrupcao'],
  });
export type ConcluirTransfusaoEntrada = z.infer<typeof esquemaConcluirTransfusao>;

// sadt.registrarReacaoTransfusional (regra 5)
export const esquemaRegistrarReacaoTransfusional = z
  .object({
    ato: idLongo,
    tipo: z.enum(CODIGOS_TIPO_REACAO),
    descricaoOutra: livre(200).nullable(),
    grau: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
    correlacao: z.enum(CODIGOS_CORRELACAO),
    inicioEm: instante,
    sinaisESintomas: livre(1_000).pipe(z.string().min(5, 'Descreva os sinais e sintomas.')),
    condutas: z.array(z.enum(CODIGOS_CONDUTA_REACAO)).min(1, 'Marque a conduta tomada.').max(8),
    condutaOutra: livre(300).nullable(),
    destinoBolsa: z.enum(DESTINOS_BOLSA_REACAO),
    sinaisNaReacao: sinais.nullable(),
    /** Com a transfusão em curso: o volume transfundido até a interrupção (a reação interrompe o ato). */
    volumeTransfundidoMl: z.number().int().min(0).max(1_000).nullable().default(null),
  })
  .strict()
  .refine((r) => r.tipo !== 'outra' || (r.descricaoOutra !== null && r.descricaoOutra.length >= 3), {
    message: 'Descreva a reação.',
    path: ['descricaoOutra'],
  })
  .refine((r) => !r.condutas.includes('outra') || (r.condutaOutra !== null && r.condutaOutra.length >= 3), {
    message: 'Descreva a outra conduta.',
    path: ['condutaOutra'],
  });
export type RegistrarReacaoTransfusionalEntrada = z.infer<typeof esquemaRegistrarReacaoTransfusional>;

export const esquemaCancelarRequisicaoTransfusao = z
  .object({
    requisicao: idLongo,
    motivo: livre(200).pipe(z.string().min(5, 'Escreva o motivo (ao menos 5 caracteres).')),
  })
  .strict();
export type CancelarRequisicaoTransfusaoEntrada = z.infer<typeof esquemaCancelarRequisicaoTransfusao>;

/** Filtro da lista de requisições e da hemovigilância. */
export const esquemaFiltroTransfusao = z
  .object({
    estado: z.enum(CODIGOS_ESTADO_REQUISICAO_TRANSFUSAO).optional(),
    urgencia: z.enum(CODIGOS_URGENCIA_TRANSFUSAO).optional(),
    de: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    ate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    termo: z.string().trim().max(60).optional(),
  })
  .strict();
export type FiltroTransfusao = z.infer<typeof esquemaFiltroTransfusao>;

// ── Respostas (o que a API devolve; nome do paciente só nas telas de trabalho com a permissão) ───────────

/** Item de hemoterapia da prescrição vigente ainda sem requisição (consulta "Prescrições de hemoterapia a atender"). */
export interface ItemHemoterapiaAAtender {
  readonly item: number;
  readonly prescricao: number;
  readonly atendimento: number;
  readonly paciente: { readonly id: number; readonly nome: string; readonly prontuario: number | null };
  readonly hemocomponente: {
    readonly codigo: string;
    readonly rotulo: string;
    readonly classe: ClasseHemocomponente;
  };
  readonly dose: number;
  readonly unidadeDose: string;
  readonly indicacao: string | null;
  readonly iniciarAgora: boolean;
  readonly prescritoEm: string;
  readonly vigenteAte: string | null;
  readonly suspenso: boolean;
  readonly horarios: number;
}

export interface RequisicaoTransfusionalLida {
  readonly id: number;
  readonly item: number;
  readonly atendimento: number;
  readonly paciente: { readonly id: number; readonly nome: string; readonly prontuario: number | null };
  readonly hemocomponente: { readonly codigo: string; readonly rotulo: string };
  readonly quantidadeBolsas: number;
  readonly bolsasTransfundidas: number;
  readonly volumeMl: number | null;
  readonly urgencia: UrgenciaTransfusao;
  readonly programadaPara: string | null;
  readonly prazo: string | null;
  readonly estado: EstadoRequisicaoTransfusao;
  readonly indicacao: string;
  readonly termo: number | null;
  readonly amostra: {
    readonly codigo: string;
    readonly coletadaEm: string;
    readonly validaAte: string;
  } | null;
  readonly tipagem: TipagemSanguinea;
  readonly requisitadaEm: string;
  readonly requisitadaPor: string;
  readonly prescricao: number;
  readonly examesDeApoio: string | null;
  readonly justificativaUrgencia: string | null;
  readonly transfusaoAnterior: string;
  readonly reacaoAnterior: string;
  readonly gestacaoAnterior: string;
  readonly motivoCancelamento: string | null;
  /** Passou do prazo sem ser atendida nem cancelada (calculado no instante da leitura). */
  readonly atrasada: boolean;
}

export interface SinaisRegistrados extends SinaisTransfusao {
  readonly momento: MomentoSinaisTransfusao;
  readonly medidoEm: string;
}

export interface AtoTransfusionalLido {
  readonly id: number;
  readonly requisicao: number;
  readonly bolsa: {
    readonly numero: string;
    readonly hemocomponente: string;
    readonly tipagem: TipagemSanguinea;
    readonly volumeMl: number;
  };
  readonly estado: EstadoAtoTransfusional;
  readonly inicioEm: string;
  readonly terminoEm: string | null;
  readonly volumeTransfundidoMl: number | null;
  readonly profissional: string;
  readonly segundoProfissional: string;
  readonly sinais: readonly SinaisRegistrados[];
  readonly reacao: number | null;
  /** Horário da prescrição checado como administrado no início (null: o item não tinha horário pendente). */
  readonly horario: number | null;
  readonly pulseiraLida: boolean;
  readonly alertas: readonly string[];
  readonly motivoInterrupcao: string | null;
  /** O volume entrou no balanço hídrico (uma vez só). */
  readonly ganhoLancado: boolean;
}

export interface ReacaoTransfusionalLida {
  readonly id: number;
  readonly ato: number;
  readonly tipo: TipoReacaoTransfusional;
  readonly grau: GrauReacao;
  readonly correlacao: CorrelacaoReacao;
  readonly inicioEm: string;
  readonly destinoBolsa: DestinoBolsaReacao;
  readonly condutas: readonly CondutaReacao[];
  readonly notificacao: {
    readonly sugerida: boolean;
    readonly prioridade: 'imediata' | 'rotina';
    readonly enviadaEm: string | null;
  };
  readonly registradaEm: string;
  readonly registradaPor: string;
  readonly descricaoOutra: string | null;
  readonly sinaisESintomas: string;
  readonly condutaOutra: string | null;
  readonly paciente: { readonly id: number; readonly nome: string; readonly prontuario: number | null };
  readonly bolsa: { readonly numero: string; readonly hemocomponente: string };
  readonly transfusaoIniciadaEm: string;
  readonly requisicao: number;
}

/** A notificação digitada no portal da vigilância sanitária: a data do envio. */
export const esquemaNotificacaoEnviada = z
  .object({
    enviadaEm: instante,
  })
  .strict();
export type NotificacaoEnviadaEntrada = z.infer<typeof esquemaNotificacaoEnviada>;
