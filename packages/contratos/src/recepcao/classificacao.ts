// Classificação de risco no pronto atendimento (M44, etapa 1; ficha, seções 5 a 8; cap-05a §5.3; cap-11 §11.1):
// vocabulário, entradas e respostas do motor de protocolo (Manchester licenciado ou ACCR próprio, DP-18), da
// classificação e da reclassificação. O protocolo é dado (regra 2): versão publicada imutável, com autor, aprovador e
// licença; a classificação guarda a versão usada. As cores do novo vivem na versão do protocolo (SGH_PA_PROTOCOLO_COR);
// a tabela de cores do sistema anterior (PRMANCHESTER, 7 linhas) é só consulta e referência opcional.
// O formulário de classificação do prontuário (modelo E08, 28.755 registros) continua recebendo a classificação pelo
// registro clínico do M22 (pep.registrarEvolucao), com a cor convertida para a opção de "Prioridade clínica" por um
// de-para aprovado pela enfermagem (regra 7): só índices já vistos no perfil; cor sem opção grava só no novo.
import { z } from 'zod';
import { textoCp1252 } from '../texto-cp1252.js';

// ── Cores, prioridades e tempos-alvo (regra 4) ───────────────────────────────────────────────────

/**
 * As cinco cores da classificação, em ordem de prioridade (1 = a mais grave), com o nome escrito (a cor nunca
 * aparece sozinha: acessibilidade e painel de TV) e o tempo-alvo padrão em minutos (vermelho 0, laranja 10,
 * amarelo 60, verde 120, azul 240; regra 4). Cada versão de protocolo pode mudar o tempo e o nome, nunca a ordem.
 */
export const CORES_RISCO = [
  { codigo: 'vermelho', rotulo: 'Vermelho', nome: 'Emergência', prioridade: 1, tempoAlvoPadraoMin: 0 },
  { codigo: 'laranja', rotulo: 'Laranja', nome: 'Muito urgente', prioridade: 2, tempoAlvoPadraoMin: 10 },
  { codigo: 'amarelo', rotulo: 'Amarelo', nome: 'Urgente', prioridade: 3, tempoAlvoPadraoMin: 60 },
  { codigo: 'verde', rotulo: 'Verde', nome: 'Pouco urgente', prioridade: 4, tempoAlvoPadraoMin: 120 },
  { codigo: 'azul', rotulo: 'Azul', nome: 'Não urgente', prioridade: 5, tempoAlvoPadraoMin: 240 },
] as const;
export type CorRisco = (typeof CORES_RISCO)[number]['codigo'];
export const CODIGOS_COR_RISCO = CORES_RISCO.map((c) => c.codigo) as [CorRisco, ...CorRisco[]];

/** Tipo do protocolo (DP-18): Manchester exige a licença do GBCR registrada para publicar (regra 2). */
export const TIPOS_PROTOCOLO_CLASSIFICACAO = [
  { codigo: 'manchester', rotulo: 'Manchester (licenciado)', exigeLicenca: true },
  { codigo: 'accr', rotulo: 'Acolhimento com classificação de risco próprio', exigeLicenca: false },
] as const;
export type TipoProtocoloClassificacao = (typeof TIPOS_PROTOCOLO_CLASSIFICACAO)[number]['codigo'];
export const CODIGOS_TIPO_PROTOCOLO = TIPOS_PROTOCOLO_CLASSIFICACAO.map((t) => t.codigo) as [
  TipoProtocoloClassificacao,
  ...TipoProtocoloClassificacao[],
];

/**
 * Situação da versão do protocolo: o rascunho se edita; a publicada é imutável e vale para as classificações novas;
 * a substituída continua legível (as classificações antigas apontam para ela).
 */
export const SITUACOES_PROTOCOLO = ['rascunho', 'publicado', 'substituido'] as const;
export type SituacaoProtocolo = (typeof SITUACOES_PROTOCOLO)[number];

/** Motivo de uma nova linha de classificação (só inclusão): a inicial, o estouro do tempo-alvo, a mudança de quadro. */
export const MOTIVOS_CLASSIFICACAO = [
  { codigo: 'inicial', rotulo: 'Classificação inicial' },
  { codigo: 'estouro', rotulo: 'Reclassificação por estouro do tempo-alvo' },
  { codigo: 'mudanca_quadro', rotulo: 'Reclassificação por mudança do quadro' },
] as const;
export type MotivoClassificacao = (typeof MOTIVOS_CLASSIFICACAO)[number]['codigo'];
export const MOTIVOS_RECLASSIFICACAO = ['estouro', 'mudanca_quadro'] as const;
export type MotivoReclassificacao = (typeof MOTIVOS_RECLASSIFICACAO)[number];

/**
 * Chave de liberação da classificação própria (SGH_CFG_LIBERACAO; ficha, seção 12) e a da classificação externa do
 * M34, que a primeira desliga na mesma mudança (regra 6). A gravação no formulário do prontuário segue a liberação do
 * registro clínico do M22 (`pep.evolucao.registro` e o modelo E08 em `pep.evolucao.modelosLiberados`).
 */
export const CHAVE_LIBERACAO_CLASSIFICACAO = 'pa.classificacao';
export const CHAVE_CLASSIFICACAO_EXTERNA = 'integracao.classificacaoExterna';
/** Código do modelo do formulário de classificação do prontuário (PREVOLUCAO.COD). */
export const MODELO_E08 = 'E08';

// ── Sinais vitais da classificação (variáveis das regras dos discriminadores) ─────────────────────

/**
 * Variáveis que as regras dos discriminadores podem ler (JSON Logic `var`): os sinais vitais e as escalas da
 * classificação, com faixa plausível (fora dela a tela pede confirmação e o valor não entra na regra). A pressão é
 * gravada em texto no formulário do prontuário ("120/80"); aqui vai em duas variáveis.
 */
export const VARIAVEIS_CLASSIFICACAO = [
  { codigo: 'pas', rotulo: 'Pressão sistólica', unidade: 'mmHg', min: 0, max: 350, inteiro: true },
  { codigo: 'pad', rotulo: 'Pressão diastólica', unidade: 'mmHg', min: 0, max: 250, inteiro: true },
  { codigo: 'fc', rotulo: 'Frequência cardíaca', unidade: 'bpm', min: 0, max: 300, inteiro: true },
  { codigo: 'fr', rotulo: 'Frequência respiratória', unidade: 'irpm', min: 0, max: 100, inteiro: true },
  { codigo: 'temperatura', rotulo: 'Temperatura', unidade: '°C', min: 25, max: 45, inteiro: false },
  { codigo: 'saturacao', rotulo: 'Saturação de oxigênio', unidade: '%', min: 0, max: 100, inteiro: true },
  { codigo: 'glicemia', rotulo: 'Glicemia capilar', unidade: 'mg/dl', min: 0, max: 1500, inteiro: true },
  { codigo: 'dor', rotulo: 'Dor (0 a 10)', unidade: '', min: 0, max: 10, inteiro: true },
  { codigo: 'glasgow', rotulo: 'Escala de coma de Glasgow', unidade: '', min: 3, max: 15, inteiro: true },
  { codigo: 'idadeAnos', rotulo: 'Idade (anos)', unidade: 'anos', min: 0, max: 130, inteiro: true },
] as const;
export type VariavelClassificacao = (typeof VARIAVEIS_CLASSIFICACAO)[number]['codigo'];
export const CODIGOS_VARIAVEL_CLASSIFICACAO = VARIAVEIS_CLASSIFICACAO.map((v) => v.codigo) as [
  VariavelClassificacao,
  ...VariavelClassificacao[],
];

const sinal = (codigo: VariavelClassificacao) => {
  const v = VARIAVEIS_CLASSIFICACAO.find((x) => x.codigo === codigo)!;
  const base = z.number().finite().min(v.min).max(v.max);
  return (v.inteiro ? base.int() : base).nullable().default(null);
};

export const esquemaSinaisClassificacao = z
  .object({
    pas: sinal('pas'),
    pad: sinal('pad'),
    fc: sinal('fc'),
    fr: sinal('fr'),
    temperatura: sinal('temperatura'),
    saturacao: sinal('saturacao'),
    glicemia: sinal('glicemia'),
    dor: sinal('dor'),
    glasgow: sinal('glasgow'),
  })
  .strict();
export type SinaisClassificacao = z.infer<typeof esquemaSinaisClassificacao>;

/** Comorbidades prévias do formulário de classificação (as opções vistas no perfil pc, na ordem do formulário). */
export const COMORBIDADES_CLASSIFICACAO = ['has', 'dm', 'coronopatias', 'gravidez', 'outros'] as const;
export type ComorbidadeClassificacao = (typeof COMORBIDADES_CLASSIFICACAO)[number];

// ── Protocolo (recepcao.publicarProtocoloClassificacao) ──────────────────────────────────────────

const codigo = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9-]{1,59}$/, 'Código em minúsculas, sem espaço (letras, números e hífen).');
const id = z.number().int().positive().max(2_147_483_647);

/** Regra em JSON Logic (cap-11 §11.1) sobre as variáveis da classificação; avaliada na tela e no servidor. */
export const esquemaRegraDiscriminador: z.ZodType<unknown> = z
  .unknown()
  .refine((r) => r === null || typeof r === 'boolean' || (typeof r === 'object' && !Array.isArray(r)), {
    message: 'Regra do discriminador em JSON Logic (objeto) ou nula (marcado à mão).',
  });

export const esquemaCorProtocolo = z
  .object({
    cor: z.enum(CODIGOS_COR_RISCO),
    nome: textoCp1252(40).pipe(z.string().min(2)),
    tempoAlvoMin: z.number().int().min(0).max(1_440),
    /** Índice da opção de "Prioridade clínica" do formulário de classificação do prontuário (null: sem opção). */
    opcaoE08: z.number().int().min(0).max(99).nullable(),
    /** Referência opcional à cor equivalente da tabela de cores antiga (PRMANCHESTER.ID). */
    corLegado: z.number().int().min(1).max(9).nullable().default(null),
  })
  .strict();
export type CorProtocolo = z.infer<typeof esquemaCorProtocolo>;

export const esquemaFluxograma = z
  .object({
    codigo,
    titulo: textoCp1252(80).pipe(z.string().min(2)),
  })
  .strict();
export type Fluxograma = z.infer<typeof esquemaFluxograma>;

export const esquemaDiscriminador = z
  .object({
    codigo,
    fluxograma: codigo,
    titulo: textoCp1252(120).pipe(z.string().min(2)),
    /** Cor que o discriminador presente propõe (a proposta é a de maior prioridade entre os presentes; regra 3). */
    cor: z.enum(CODIGOS_COR_RISCO),
    /** Regra que marca o discriminador sozinho a partir dos sinais (null: só o enfermeiro marca). */
    regra: esquemaRegraDiscriminador.nullable().default(null),
    /** Protocolo gerenciado que o discriminador sugere abrir (etapa 3: sepse, dor torácica, AVC, trauma). */
    sugereProtocolo: codigo.nullable().default(null),
  })
  .strict();
export type Discriminador = z.infer<typeof esquemaDiscriminador>;

export const esquemaLicencaProtocolo = z
  .object({
    /** Número ou identificação do contrato de licença (nunca senha nem chave de acesso). */
    registro: textoCp1252(60).pipe(z.string().min(3)),
    titular: textoCp1252(120).pipe(z.string().min(2)),
    validaAte: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })
  .strict();
export type LicencaProtocolo = z.infer<typeof esquemaLicencaProtocolo>;

/** O conteúdo de uma versão do protocolo (o que a publicação congela). */
export const esquemaConteudoProtocolo = z
  .object({
    tipo: z.enum(CODIGOS_TIPO_PROTOCOLO),
    nome: textoCp1252(80).pipe(z.string().min(3)),
    cores: z.array(esquemaCorProtocolo).length(CORES_RISCO.length),
    fluxogramas: z.array(esquemaFluxograma).min(1).max(120),
    discriminadores: z.array(esquemaDiscriminador).min(1).max(3_000),
    licenca: esquemaLicencaProtocolo.nullable().default(null),
  })
  .strict();
export type ConteudoProtocolo = z.infer<typeof esquemaConteudoProtocolo>;

export const esquemaPublicarProtocoloClassificacao = z
  .object({
    /** Protocolo existente (nova versão) ou ausente (primeiro protocolo do estabelecimento). */
    protocolo: id.optional(),
    /**
     * Quem redigiu a versão (login): a sessão é a do aprovador (diretoria clínica), e autor e aprovador não podem ser a
     * mesma pessoa (regra 2). O rascunho é o editor da tela, com o simulador: nada é gravado antes de publicar.
     */
    autor: z.string().trim().min(2).max(31),
    conteudo: esquemaConteudoProtocolo,
    /** Notas da versão (o que mudou), para a diretoria clínica. */
    notas: textoCp1252(1_000).pipe(z.string().min(3)),
    /** Reautenticação (permissão crítica): a senha de quem aprova. */
    senha: z.string().min(1).max(128),
  })
  .strict();
export type PublicarProtocoloClassificacaoEntrada = z.infer<typeof esquemaPublicarProtocoloClassificacao>;

// ── Classificar e reclassificar (recepcao.classificarRisco, recepcao.reclassificarRisco) ─────────

const justificativa = textoCp1252(500).pipe(
  z.string().trim().min(10, 'Explique em pelo menos 10 caracteres.'),
);

const camposClassificacao = {
  /** Número do atendimento do PA (RECADATE.REG). */
  atendimento: id,
  /** Versão publicada do protocolo usada (a classificação a guarda; regra 2). */
  versaoProtocolo: id,
  fluxograma: codigo,
  /** Discriminadores presentes (os marcados pela regra e os marcados à mão). */
  discriminadores: z.array(codigo).max(60),
  sinais: esquemaSinaisClassificacao,
  /** Queixa principal (vai também ao formulário do prontuário). */
  queixa: textoCp1252(2_000).pipe(z.string().trim().min(2)),
  observacoes: textoCp1252(2_000).nullable().default(null),
  /**
   * Alergia relatada (Sim/Não) e comorbidades prévias: perguntas ativas do formulário de classificação do prontuário,
   * respondidas em quase todo registro (perfil pc: alergia em 28.586 de 28.755). A lista de alergias em si é do
   * cadastro de alergias do PEP (o formulário não a recebe por esta tela; D-ALE do M22).
   */
  alergia: z.enum(['sim', 'nao']).nullable().default(null),
  comorbidades: z.array(z.enum(COMORBIDADES_CLASSIFICACAO)).max(5).default([]),
  /** Cor final; diferente da proposta exige justificativa e gera evento de auditoria (regra 3). */
  corFinal: z.enum(CODIGOS_COR_RISCO),
  justificativaSobreposicao: justificativa.nullable().default(null),
};

export const esquemaClassificarRisco = z.object(camposClassificacao).strict();
export type ClassificarRiscoEntrada = z.infer<typeof esquemaClassificarRisco>;

export const esquemaReclassificarRisco = z
  .object({
    ...camposClassificacao,
    /** A classificação vigente lida (a nova linha a substitui; colisão se outra chegou antes). */
    anterior: id,
    motivo: z.enum(MOTIVOS_RECLASSIFICACAO),
    /** Na mudança de quadro, o que mudou (obrigatório nela). */
    descricaoMudanca: justificativa.nullable().default(null),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.motivo === 'mudanca_quadro' && !v.descricaoMudanca)
      ctx.addIssue({ code: 'custom', path: ['descricaoMudanca'], message: 'Descreva a mudança do quadro.' });
  });
export type ReclassificarRiscoEntrada = z.infer<typeof esquemaReclassificarRisco>;

/** Sinais vitais registrados pelo técnico na mesma tela, sem concluir a classificação (regra 1). */
export const esquemaRegistrarSinaisTriagem = z
  .object({ atendimento: id, sinais: esquemaSinaisClassificacao })
  .strict();
export type RegistrarSinaisTriagemEntrada = z.infer<typeof esquemaRegistrarSinaisTriagem>;

// ── Respostas ────────────────────────────────────────────────────────────────────────────────────

const txt = z.string();
const n = z.number();
const nul = <T extends z.ZodType>(t: T) => t.nullable();

export const esquemaClassificacaoResumo = z.object({
  id: n,
  atendimento: n,
  cor: z.enum(CODIGOS_COR_RISCO),
  nomeCor: txt,
  prioridade: n,
  corProposta: z.enum(CODIGOS_COR_RISCO),
  sobreposta: z.boolean(),
  motivo: z.enum(
    MOTIVOS_CLASSIFICACAO.map((m) => m.codigo) as [MotivoClassificacao, ...MotivoClassificacao[]],
  ),
  tempoAlvoMin: n,
  classificadoEm: txt,
  /** Prazo do atendimento médico (classificação + tempo-alvo). */
  prazoEm: txt,
  versaoProtocolo: n,
  fluxograma: txt,
  /** Login de quem classificou (o nome sai do cadastro de profissionais na tela). */
  autor: txt,
  /** O formulário do prontuário: gravado (ID do registro), sem opção equivalente, ou desligado. */
  prontuario: z.discriminatedUnion('situacao', [
    z.object({ situacao: z.literal('gravado'), registro: n }),
    z.object({ situacao: z.literal('semPrioridade') }),
    z.object({ situacao: z.literal('desligado') }),
  ]),
});
export type ClassificacaoResumo = z.infer<typeof esquemaClassificacaoResumo>;

/** O que o cartão do quadro do PA ganha com a classificação (cor e cronômetro; ficha, seção 7). */
export const esquemaRiscoNoQuadro = z.object({
  cor: z.enum(CODIGOS_COR_RISCO),
  nomeCor: txt,
  prioridade: n,
  classificadoEm: txt,
  prazoEm: txt,
  /** Minutos até o prazo (negativo: estourado). */
  minutosRestantes: n,
  estourado: z.boolean(),
  /** Reclassificação obrigatória pendente (estouro sem atendimento médico; regra 4). */
  reclassificar: z.boolean(),
  reclassificacoes: n,
});
export type RiscoNoQuadro = z.infer<typeof esquemaRiscoNoQuadro>;

export const esquemaVersaoProtocoloResumo = z.object({
  id: n,
  protocolo: n,
  versao: n,
  situacao: z.enum(SITUACOES_PROTOCOLO),
  tipo: z.enum(CODIGOS_TIPO_PROTOCOLO),
  nome: txt,
  autor: txt,
  aprovador: nul(txt),
  publicadoEm: nul(txt),
  licencaValidaAte: nul(txt),
  /** Impressão digital do conteúdo publicado (SHA-256 do JSON canônico): prova a imutabilidade. */
  impressao: nul(txt),
});
export type VersaoProtocoloResumo = z.infer<typeof esquemaVersaoProtocoloResumo>;

/** Linha da tabela de cores antiga (consulta; ficha, seção 7: "Cores legadas (consulta)"). */
export const esquemaCorLegadoConsulta = z.object({
  id: n,
  codigoProtocolo: n,
  classificacao: txt,
  /** Cor no formato do sistema anterior (nome Delphi ou $00BBGGRR), convertida para #rrggbb quando possível. */
  corOriginal: txt,
  corHex: nul(txt),
  /** A cor do novo equivalente pela posição (1 a 5); 6 (óbito) e 7 (outros) não têm cor de classificação. */
  corEquivalente: nul(z.enum(CODIGOS_COR_RISCO)),
});
export type CorLegadoConsulta = z.infer<typeof esquemaCorLegadoConsulta>;

/** Classificação anterior do paciente lida do formulário do prontuário (histórico; leitura auditada). */
export const esquemaClassificacaoHistorico = z.object({
  registro: n,
  dataHora: txt,
  /** Cor reconhecida no texto da opção gravada; null quando o registro não tem prioridade. */
  cor: nul(z.enum(CODIGOS_COR_RISCO)),
  opcao: nul(txt),
  origem: z.enum(['prontuario', 'sante']),
});
export type ClassificacaoHistorico = z.infer<typeof esquemaClassificacaoHistorico>;

// ── Telas (fila, classificar, protocolos, simulador, painel) ───────────────────────────────────────

/** Ações que a tela oferece a quem está na sessão (regra 1: conferidas também no servidor). */
export const ACOES_CLASSIFICACAO = ['registrarSinais', 'concluir', 'reclassificar'] as const;
export type AcaoTelaClassificacao = (typeof ACOES_CLASSIFICACAO)[number];

/** Item da fila de classificação: chegou ao PA e ainda não foi classificado (sem nome no painel; aqui, com nome). */
export const esquemaItemFilaClassificacao = z.object({
  reg: n,
  paciente: txt,
  idade: nul(n),
  senha: nul(txt),
  /** Prioridade legal da senha (0 = sem, 1 = prioridade, 2 = 80+). */
  prioridadeLegal: z.enum(['0', '1', '2']),
  chegada: txt,
  minutosEspera: n,
  /** Sinais já registrados pelo técnico (a classificação ainda não foi concluída). */
  comSinais: z.boolean(),
});
export type ItemFilaClassificacao = z.infer<typeof esquemaItemFilaClassificacao>;

export const esquemaFilaClassificacao = z.object({
  itens: z.array(esquemaItemFilaClassificacao),
  cortada: z.boolean(),
  atualizadoEm: txt,
  /** Classificados no quadro com reclassificação obrigatória (estouro sem médico; regra 4). */
  reclassificarAgora: z.array(
    z.object({ reg: n, paciente: txt, cor: z.enum(CODIGOS_COR_RISCO), minutosPassados: n }),
  ),
  protocoloVigente: nul(esquemaVersaoProtocoloResumo),
});
export type FilaClassificacao = z.infer<typeof esquemaFilaClassificacao>;

/** O protocolo vigente com o conteúdo (o motor roda também na tela; o servidor reconfere). */
export const esquemaProtocoloComConteudo = z.object({
  versao: esquemaVersaoProtocoloResumo,
  conteudo: esquemaConteudoProtocolo,
  notas: txt,
});
export type ProtocoloComConteudo = z.infer<typeof esquemaProtocoloComConteudo>;

export const esquemaTelaClassificacao = z.object({
  atendimento: z.object({
    reg: n,
    paciente: txt,
    idade: nul(n),
    senha: nul(txt),
    chegada: txt,
    prioridadeLegal: z.enum(['0', '1', '2']),
    encerrado: z.boolean(),
    atendimentoMedicoEm: nul(txt),
  }),
  protocolo: nul(esquemaProtocoloComConteudo),
  vigente: nul(esquemaClassificacaoResumo),
  /** O risco atual (prazo, estouro e a obrigação de reclassificar). */
  risco: nul(esquemaRiscoNoQuadro),
  historico: z.array(esquemaClassificacaoHistorico),
  /** Os sinais mais recentes do atendimento (do técnico, na mesma tela), para preencher. */
  sinaisRecentes: nul(esquemaSinaisClassificacao),
  acoes: z.array(z.enum(ACOES_CLASSIFICACAO)),
  /** Por que a ação principal não aparece (categoria, conselho, vínculo, liberação). */
  motivoSemAcao: nul(txt),
  /** O registro no formulário de classificação do prontuário (ligado ou desligado com o motivo). */
  prontuario: z.object({ ligado: z.boolean(), motivo: nul(txt) }),
  /** A liberação da classificação para a sessão (desligada: só consulta). */
  liberada: z.boolean(),
  motivoLiberacao: nul(txt),
});
export type TelaClassificacao = z.infer<typeof esquemaTelaClassificacao>;

export const esquemaResultadoClassificacao = z.object({
  classificacao: esquemaClassificacaoResumo,
  mensagem: txt,
  avisos: z.array(txt),
});
export type ResultadoClassificacao = z.infer<typeof esquemaResultadoClassificacao>;

/** O simulador do editor de protocolos (puro: a mesma proposta do motor, sem gravar). */
export const esquemaSimularProtocolo = z
  .object({
    conteudo: esquemaConteudoProtocolo,
    fluxograma: codigo,
    sinais: esquemaSinaisClassificacao,
    idadeAnos: z.number().int().min(0).max(130).nullable().default(null),
    discriminadores: z.array(codigo).max(60).default([]),
  })
  .strict();
export type SimularProtocoloEntrada = z.infer<typeof esquemaSimularProtocolo>;

export const esquemaResultadoSimulacaoProtocolo = z.object({
  cor: z.enum(CODIGOS_COR_RISCO),
  nomeCor: txt,
  tempoAlvoMin: n,
  presentes: z.array(z.object({ codigo: txt, titulo: txt, cor: z.enum(CODIGOS_COR_RISCO) })),
  automaticos: z.array(txt),
  semDiscriminador: z.boolean(),
  desconhecidos: z.array(txt),
  /** Problemas da publicação desta versão (vazio: pode publicar). */
  problemas: z.array(z.object({ codigo: txt, mensagem: txt, onde: nul(txt) })),
});
export type ResultadoSimulacaoProtocolo = z.infer<typeof esquemaResultadoSimulacaoProtocolo>;

/** Indicadores da classificação no período (regra 5: cada um com numerador e denominador). */
export const esquemaIndicadoresClassificacao = z.object({
  inicio: txt,
  fim: txt,
  portaClassificacao: z.object({ medianaMin: nul(n), atendimentos: n, comMarca: n }),
  portaMedico: z.object({ medianaMin: nul(n), atendimentos: n, comMarca: n }),
  dentroDoAlvo: z.array(
    z.object({ cor: z.enum(CODIGOS_COR_RISCO), numerador: n, denominador: n, percentual: nul(n) }),
  ),
  reclassificacoes: z.object({ numerador: n, denominador: n, percentual: nul(n) }),
});
export type IndicadoresClassificacaoPa = z.infer<typeof esquemaIndicadoresClassificacao>;
