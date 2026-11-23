// NIR: solicitação de leito, fila priorizada, reserva, alta prevista (DPA), barreiras de alta, quadro de permanência e
// reunião de leitos (M44, etapa 2; ficha, seções 4 a 8; cap-05a §5.4): vocabulário, entradas e respostas. A indicação
// de internação é ato médico (regra 9); o NIR opera a fila pela máquina `solicitado → em_analise → reservado →
// em_transito → internado`, ou `cancelado`/`rejeitado` com motivo. A solicitação atendida termina numa admissão ou numa
// transferência gravadas pelas operações do M21 (mesma gravação, a origem fica no novo). As 23 situações de regulação de
// leito do sistema anterior têm um de-para proposto para os estados do NIR (regra 10; a aprovar pelo NIR). A reserva vale
// no novo (regra 11; a reserva no sistema anterior fica especificada até o cenário controlado); a ocupação feita por fora
// de um leito reservado aparece como conflito no mapa e avisa o NIR, nunca é desfeita (regra 12). O quadro de
// permanência conta os dias pela Portaria 312, nunca pelas diárias faturáveis (regra 13). Nenhum nome de tabela aqui.
import { z } from 'zod';
import { esquemaDataIso } from '../preco/entradas.js';
import { textoCp1252 } from '../texto-cp1252.js';
import { CODIGOS_PRECAUCAO, esquemaChaveLeito } from './adt.js';
import { idBanco } from '../validacao/id-banco.js';

const id = idBanco;
const livre = (max: number) => textoCp1252(max).overwrite((t) => t.replace(/\s+/g, ' ').trim());
const motivo = (min: number, max: number, msg: string) => livre(max).pipe(z.string().min(min, msg));

// ── Máquina de estados do NIR (regra 9) ───────────────────────────────────────────────────────────

export const ESTADOS_SOLICITACAO_NIR = [
  { codigo: 'solicitado', rotulo: 'Solicitado', final: false },
  { codigo: 'em_analise', rotulo: 'Em análise pelo NIR', final: false },
  { codigo: 'reservado', rotulo: 'Leito reservado', final: false },
  { codigo: 'em_transito', rotulo: 'Em trânsito para o leito', final: false },
  { codigo: 'internado', rotulo: 'Internado', final: true },
  { codigo: 'cancelado', rotulo: 'Cancelado', final: true },
  { codigo: 'rejeitado', rotulo: 'Rejeitado', final: true },
] as const;
export type EstadoSolicitacaoNir = (typeof ESTADOS_SOLICITACAO_NIR)[number]['codigo'];
export const CODIGOS_ESTADO_NIR = ESTADOS_SOLICITACAO_NIR.map((e) => e.codigo) as [
  EstadoSolicitacaoNir,
  ...EstadoSolicitacaoNir[],
];
export const ESTADOS_FINAIS_NIR: readonly EstadoSolicitacaoNir[] = ['internado', 'cancelado', 'rejeitado'];

/** As ações sobre a solicitação. As que mudam o estado e as que só a reordenam (priorizar). */
export const ACOES_SOLICITACAO_NIR = [
  { codigo: 'analisar', rotulo: 'Começar a análise' },
  { codigo: 'reservar', rotulo: 'Reservar o leito' },
  { codigo: 'liberarReserva', rotulo: 'Reserva encerrada (expirada ou cancelada)' },
  { codigo: 'transito', rotulo: 'Paciente a caminho do leito' },
  { codigo: 'internar', rotulo: 'Admitido ou transferido para o leito' },
  { codigo: 'priorizar', rotulo: 'Mudar a prioridade' },
  { codigo: 'cancelar', rotulo: 'Cancelar a solicitação' },
  { codigo: 'rejeitar', rotulo: 'Rejeitar a solicitação' },
] as const;
export type AcaoSolicitacaoNir = (typeof ACOES_SOLICITACAO_NIR)[number]['codigo'];
/** As ações que a tela do NIR pede pela rota de transição (as demais vêm da reserva ou da admissão). */
export const ACOES_TRANSICAO_TELA = ['analisar', 'transito', 'priorizar', 'cancelar', 'rejeitar'] as const;
export type AcaoTransicaoTela = (typeof ACOES_TRANSICAO_TELA)[number];

/** De onde vem o pedido de leito (regra 9; mina, regra 11). */
export const ORIGENS_SOLICITACAO_NIR = [
  { codigo: 'pa', rotulo: 'Pronto atendimento (decisão de internar)' },
  { codigo: 'cirurgia', rotulo: 'Centro cirúrgico (pós-operatório)' },
  { codigo: 'internado', rotulo: 'Paciente internado (troca de leito ou UTI)' },
  { codigo: 'eletiva', rotulo: 'Internação eletiva' },
  { codigo: 'externa', rotulo: 'Origem externa (outro serviço)' },
] as const;
export type OrigemSolicitacaoNir = (typeof ORIGENS_SOLICITACAO_NIR)[number]['codigo'];
export const CODIGOS_ORIGEM_NIR = ORIGENS_SOLICITACAO_NIR.map((o) => o.codigo) as [
  OrigemSolicitacaoNir,
  ...OrigemSolicitacaoNir[],
];

/**
 * Prioridade da solicitação (1 = a mais urgente) com o prazo padrão para ter leito, em minutos. O prazo de cada
 * prioridade é parâmetro do estabelecimento (`internacao.nirPrazo<Prioridade>Min`); o estouro alerta o NIR.
 */
export const PRIORIDADES_NIR = [
  { codigo: 'emergencia', rotulo: 'Emergência', ordem: 1, prazoPadraoMin: 60 },
  { codigo: 'urgente', rotulo: 'Urgente', ordem: 2, prazoPadraoMin: 240 },
  { codigo: 'prioritario', rotulo: 'Prioritário', ordem: 3, prazoPadraoMin: 720 },
  { codigo: 'eletivo', rotulo: 'Eletivo', ordem: 4, prazoPadraoMin: 2880 },
] as const;
export type PrioridadeNir = (typeof PRIORIDADES_NIR)[number]['codigo'];
export const CODIGOS_PRIORIDADE_NIR = PRIORIDADES_NIR.map((p) => p.codigo) as [
  PrioridadeNir,
  ...PrioridadeNir[],
];
export const PARAMETRO_PRAZO_NIR: Readonly<Record<PrioridadeNir, string>> = {
  emergencia: 'internacao.nirPrazoEmergenciaMin',
  urgente: 'internacao.nirPrazoUrgenteMin',
  prioritario: 'internacao.nirPrazoPrioritarioMin',
  eletivo: 'internacao.nirPrazoEletivoMin',
};
export const PARAMETRO_VALIDADE_RESERVA = 'internacao.nirValidadeReservaMin';
export const PARAMETRO_PERMANENCIA_AMARELO = 'internacao.permanenciaAmareloDias';
export const PARAMETRO_PERMANENCIA_VERMELHO = 'internacao.permanenciaVermelhoDias';

/** Chave de liberação do NIR (SGH_CFG_LIBERACAO; ficha, seção 12), por estabelecimento e setor. */
export const CHAVE_LIBERACAO_NIR = 'nir';

// ── Situações de regulação do sistema anterior (regra 10) ─────────────────────────────────────────

/**
 * De-para PROPOSTO das 23 situações de regulação de leito do sistema anterior para os estados do NIR (mina M41, regra
 * 12; a aprovar pelo NIR). As 6 marcadas `aConfirmar` ficam com a legenda "a confirmar" até o aceite (códigos de baixa
 * confiança). Os rótulos vêm do cadastro do próprio estabelecimento; estes são os do perfil, para a proposta.
 */
export const DEPARA_SITUACAO_REGULACAO: readonly {
  readonly situacao: number;
  readonly rotulo: string;
  readonly estado: EstadoSolicitacaoNir | null;
  readonly aConfirmar: boolean;
}[] = [
  { situacao: 1, rotulo: 'Aguardando disponibilidade', estado: 'em_analise', aConfirmar: false },
  { situacao: 2, rotulo: 'Aguardando esclarecimentos', estado: 'em_analise', aConfirmar: false },
  { situacao: 3, rotulo: 'Aguardando regulação', estado: 'em_analise', aConfirmar: false },
  { situacao: 4, rotulo: 'Alta', estado: null, aConfirmar: true },
  { situacao: 5, rotulo: 'Confirmação', estado: 'reservado', aConfirmar: false },
  { situacao: 6, rotulo: 'Cancelada', estado: 'cancelado', aConfirmar: false },
  { situacao: 7, rotulo: 'Em digitação', estado: 'solicitado', aConfirmar: false },
  { situacao: 8, rotulo: 'Em trânsito', estado: 'em_transito', aConfirmar: false },
  { situacao: 9, rotulo: 'Internado', estado: 'internado', aConfirmar: false },
  { situacao: 10, rotulo: 'Regulado', estado: 'em_analise', aConfirmar: false },
  { situacao: 11, rotulo: 'Rejeitado', estado: 'rejeitado', aConfirmar: false },
  { situacao: 12, rotulo: 'Reserva confirmada', estado: 'reservado', aConfirmar: false },
  { situacao: 13, rotulo: 'Reserva rejeitada', estado: 'rejeitado', aConfirmar: false },
  { situacao: 14, rotulo: 'Retorno', estado: null, aConfirmar: true },
  { situacao: 15, rotulo: 'Retorno Central Máster', estado: null, aConfirmar: true },
  { situacao: 16, rotulo: 'Aguardando transferência', estado: 'em_analise', aConfirmar: false },
  { situacao: 17, rotulo: 'Transferência autorizada', estado: null, aConfirmar: true },
  { situacao: 18, rotulo: 'Aguardando confirmação', estado: 'em_analise', aConfirmar: false },
  { situacao: 19, rotulo: 'Auto internação', estado: 'internado', aConfirmar: false },
  { situacao: 20, rotulo: 'Confirmar internação', estado: null, aConfirmar: true },
  { situacao: 21, rotulo: 'Em transferência', estado: 'em_transito', aConfirmar: false },
  { situacao: 22, rotulo: 'Evoluir paciente', estado: null, aConfirmar: true },
  { situacao: 23, rotulo: 'Aguardando autorização', estado: 'em_analise', aConfirmar: false },
];

// ── Reserva (regra 11) ────────────────────────────────────────────────────────────────────────────

export const SITUACOES_RESERVA = [
  { codigo: 'ativa', rotulo: 'Reservado (aguardando confirmação)' },
  { codigo: 'confirmada', rotulo: 'Reserva confirmada' },
  { codigo: 'consumida', rotulo: 'Paciente no leito' },
  { codigo: 'expirada', rotulo: 'Reserva expirada' },
  { codigo: 'cancelada', rotulo: 'Reserva cancelada' },
] as const;
export type SituacaoReserva = (typeof SITUACOES_RESERVA)[number]['codigo'];
export const SITUACOES_RESERVA_VIGENTES: readonly SituacaoReserva[] = ['ativa', 'confirmada'];

// ── Barreiras de alta e DPA ───────────────────────────────────────────────────────────────────────

export const TIPOS_BARREIRA_ALTA = [
  { codigo: 'exame', rotulo: 'Aguardando exame' },
  { codigo: 'parecer', rotulo: 'Aguardando parecer' },
  { codigo: 'opme', rotulo: 'Aguardando material especial (OPME)' },
  { codigo: 'transporte', rotulo: 'Aguardando transporte' },
  { codigo: 'familia', rotulo: 'Aguardando a família' },
  { codigo: 'social', rotulo: 'Questão social' },
  { codigo: 'outro', rotulo: 'Outro motivo' },
] as const;
export type TipoBarreiraAlta = (typeof TIPOS_BARREIRA_ALTA)[number]['codigo'];
export const CODIGOS_TIPO_BARREIRA = TIPOS_BARREIRA_ALTA.map((t) => t.codigo) as [
  TipoBarreiraAlta,
  ...TipoBarreiraAlta[],
];

/** Cor do quadro de permanência (regra 13). */
export const CORES_PERMANENCIA = [
  { codigo: 'verde', rotulo: 'Verde', nome: 'Dentro do previsto' },
  { codigo: 'amarelo', rotulo: 'Amarelo', nome: 'Alta prevista para amanhã ou no limite' },
  { codigo: 'vermelho', rotulo: 'Vermelho', nome: 'Alta prevista vencida ou acima do limite' },
] as const;
export type CorPermanencia = (typeof CORES_PERMANENCIA)[number]['codigo'];

/** Escopo do limite de permanência (amarelo e vermelho em dias da Portaria 312). */
export const ESCOPOS_LIMITE_PERMANENCIA = ['clinica', 'cid', 'procedimento'] as const;
export type EscopoLimitePermanencia = (typeof ESCOPOS_LIMITE_PERMANENCIA)[number];

// ── Entradas ──────────────────────────────────────────────────────────────────────────────────────

/** O perfil do leito pedido (regra 11): terapia intensiva, precaução de isolamento e tipos de acomodação aceitos. */
export const esquemaPerfilLeito = z
  .object({
    intensiva: z.boolean(),
    precaucao: z.enum(CODIGOS_PRECAUCAO).nullable().default(null),
    /** Tipos de acomodação aceitos (códigos do cadastro); vazio = qualquer um do perfil. */
    tiposAcomodacao: z.array(z.number().int().min(0).max(32_767)).max(20).default([]),
  })
  .strict();
export type PerfilLeito = z.infer<typeof esquemaPerfilLeito>;

export const esquemaSolicitarLeito = z
  .object({
    origem: z.enum(CODIGOS_ORIGEM_NIR),
    /** O paciente; do PA e do internado, o servidor o tira do atendimento ou da internação (confere se vier). */
    paciente: id.optional(),
    /** O atendimento do PA (a ficha) de onde vem a decisão de internar. */
    atendimento: id.optional(),
    /** A internação aberta (troca de leito, ida à UTI). */
    internacao: id.optional(),
    /** O agendamento cirúrgico que pede o leito (pendência de leito de UTI do M18). */
    cirurgia: id.optional(),
    prioridade: z.enum(CODIGOS_PRIORIDADE_NIR),
    perfil: esquemaPerfilLeito,
    clinica: z.enum(['M', 'C', 'N']),
    especialidade: z.number().int().positive().max(32_767).optional(),
    cid: id.optional(),
    justificativa: motivo(10, 500, 'Descreva a indicação da internação (ao menos 10 caracteres).'),
  })
  .strict()
  .superRefine((e, ctx) => {
    if (e.origem === 'pa' && !e.atendimento)
      ctx.addIssue({ code: 'custom', path: ['atendimento'], message: 'Informe o atendimento do PA.' });
    if (e.origem === 'internado' && !e.internacao)
      ctx.addIssue({ code: 'custom', path: ['internacao'], message: 'Informe a internação.' });
    if (e.origem === 'cirurgia' && !e.cirurgia)
      ctx.addIssue({ code: 'custom', path: ['cirurgia'], message: 'Informe a cirurgia agendada.' });
    if ((e.origem === 'eletiva' || e.origem === 'externa' || e.origem === 'cirurgia') && !e.paciente)
      ctx.addIssue({ code: 'custom', path: ['paciente'], message: 'Escolha o paciente.' });
  });
export type SolicitarLeitoEntrada = z.infer<typeof esquemaSolicitarLeito>;

export const esquemaTransicionarSolicitacao = z
  .object({
    acao: z.enum(ACOES_TRANSICAO_TELA),
    /** O estado que a tela viu (a transição confere: outra pessoa pode ter mudado antes). */
    estadoVisto: z.enum(CODIGOS_ESTADO_NIR),
    prioridade: z.enum(CODIGOS_PRIORIDADE_NIR).optional(),
    motivo: livre(300).optional(),
  })
  .strict()
  .superRefine((e, ctx) => {
    if (
      (e.acao === 'cancelar' || e.acao === 'rejeitar' || e.acao === 'priorizar') &&
      (e.motivo ?? '').length < 5
    )
      ctx.addIssue({
        code: 'custom',
        path: ['motivo'],
        message: 'Informe o motivo (ao menos 5 caracteres).',
      });
    if (e.acao === 'priorizar' && !e.prioridade)
      ctx.addIssue({ code: 'custom', path: ['prioridade'], message: 'Escolha a nova prioridade.' });
  });
export type TransicionarSolicitacaoEntrada = z.infer<typeof esquemaTransicionarSolicitacao>;

export const esquemaRegistrarReserva = z
  .object({
    solicitacao: id,
    leito: esquemaChaveLeito,
    /** Validade em minutos; sem ela, o parâmetro do estabelecimento. */
    validadeMin: z.number().int().min(15).max(1440).optional(),
    /** Exceção do supervisor ao perfil (leito incompatível), com o motivo. */
    excecao: motivo(10, 300, 'Descreva a exceção ao perfil (ao menos 10 caracteres).').optional(),
    /** A senha do supervisor (a exceção é crítica: reautenticação). */
    senha: z.string().min(1).max(200).optional(),
  })
  .strict()
  .refine((e) => !e.excecao || !!e.senha, {
    message: 'A exceção ao perfil pede a sua senha.',
    path: ['senha'],
  });
export type RegistrarReservaEntrada = z.infer<typeof esquemaRegistrarReserva>;

export const esquemaEncerrarReserva = z
  .object({ motivo: motivo(5, 300, 'Informe o motivo (ao menos 5 caracteres).') })
  .strict();

export const esquemaRegistrarDpa = z
  .object({
    internacao: id,
    data: esquemaDataIso,
    /** A versão vista (null: a primeira DPA da internação). A mudança confere: outra pessoa pode ter mudado. */
    anterior: id.nullable(),
    motivo: livre(200).optional(),
  })
  .strict()
  .superRefine((e, ctx) => {
    if (e.anterior !== null && (e.motivo ?? '').length < 5)
      ctx.addIssue({
        code: 'custom',
        path: ['motivo'],
        message: 'Mudar a alta prevista pede o motivo (ao menos 5 caracteres).',
      });
  });
export type RegistrarDpaEntrada = z.infer<typeof esquemaRegistrarDpa>;

export const esquemaRegistrarBarreira = z
  .object({
    internacao: id,
    tipo: z.enum(CODIGOS_TIPO_BARREIRA),
    descricao: motivo(5, 300, 'Descreva a barreira (ao menos 5 caracteres).'),
    /** Quem resolve (setor ou função; nunca o nome do paciente). */
    responsavel: motivo(3, 60, 'Informe quem resolve (setor ou função).'),
    prazo: esquemaDataIso,
  })
  .strict();
export type RegistrarBarreiraEntrada = z.infer<typeof esquemaRegistrarBarreira>;

export const esquemaResolverBarreira = z
  .object({ observacao: livre(300).optional(), cancelar: z.boolean().default(false) })
  .strict();

export const esquemaRegistrarLimite = z
  .object({
    escopo: z.enum(ESCOPOS_LIMITE_PERMANENCIA),
    chave: textoCp1252(20)
      .overwrite((t) => t.trim().toUpperCase())
      .pipe(z.string().min(1, 'Informe a chave.')),
    amareloDias: z.number().int().min(1).max(365),
    vermelhoDias: z.number().int().min(1).max(365),
    origem: z.enum(['manual', 'calibrado']),
    amostra: z.number().int().min(0).max(1_000_000).optional(),
    /** W0-07: obrigatório ao alterar um limite próprio que já existe (a gravação recusa 'motivo-obrigatorio'). */
    motivo: textoCp1252(300).optional(),
  })
  .strict()
  .refine((e) => e.vermelhoDias > e.amareloDias, {
    message: 'O limite vermelho tem de ser maior que o amarelo.',
    path: ['vermelhoDias'],
  });
export type RegistrarLimiteEntrada = z.infer<typeof esquemaRegistrarLimite>;

export const esquemaAprovarDepara = z
  .object({
    estado: z.enum(CODIGOS_ESTADO_NIR),
    observacao: livre(200).optional(),
  })
  .strict();

// ── Respostas ─────────────────────────────────────────────────────────────────────────────────────

const esquemaChave = esquemaChaveLeito;

export const esquemaReservaNir = z.object({
  id: z.number().int(),
  solicitacao: z.number().int(),
  leito: esquemaChave,
  chave: z.string(),
  situacao: z.enum(['ativa', 'confirmada', 'consumida', 'expirada', 'cancelada']),
  validaAte: z.string(),
  minutosRestantes: z.number().int(),
  excecao: z.string().nullable(),
  criadaPor: z.string(),
  criadaEm: z.string(),
  confirmadaEm: z.string().nullable(),
  conflito: z.object({ internacao: z.number().int(), em: z.string() }).nullable(),
});
export type ReservaNir = z.infer<typeof esquemaReservaNir>;

export const esquemaSolicitacaoNir = z.object({
  id: z.number().int(),
  origem: z.enum(CODIGOS_ORIGEM_NIR),
  estado: z.enum(CODIGOS_ESTADO_NIR),
  prioridade: z.enum(CODIGOS_PRIORIDADE_NIR),
  paciente: z.object({
    id: z.number().int(),
    /** O prontuário (a admissão vinda do NIR acha o cadastro por ele). */
    prontuario: z.number().int().nullable(),
    nome: z.string(),
    idade: z.number().int().nullable(),
    sexo: z.string().nullable(),
  }),
  atendimento: z.number().int().nullable(),
  internacao: z.number().int().nullable(),
  cirurgia: z.number().int().nullable(),
  perfil: esquemaPerfilLeito,
  clinica: z.string(),
  justificativa: z.string(),
  solicitadoPor: z.string(),
  solicitadoEm: z.string(),
  prazoEm: z.string(),
  minutosEspera: z.number().int(),
  /** Passou do prazo da prioridade sem leito (alerta ao NIR). */
  prazoEstourado: z.boolean(),
  reserva: esquemaReservaNir.nullable(),
  /** A situação equivalente do sistema anterior (o de-para; "a confirmar" quando não aprovado). */
  situacaoEquivalente: z
    .object({ codigo: z.number().int(), rotulo: z.string(), aConfirmar: z.boolean() })
    .nullable(),
  internacaoGerada: z.number().int().nullable(),
  /** W0-07: a versão (a correção confere), os recursos pedidos e a observação do NIR. */
  versao: z.number().int().default(1),
  recursos: z.array(z.string()).default([]),
  observacao: z.string().nullable().default(null),
  historico: z.array(
    z.object({
      de: z.string().nullable(),
      para: z.string(),
      acao: z.string(),
      motivo: z.string().nullable(),
      por: z.string(),
      em: z.string(),
    }),
  ),
});
export type SolicitacaoNir = z.infer<typeof esquemaSolicitacaoNir>;

export const esquemaFilaNir = z.object({
  itens: z.array(esquemaSolicitacaoNir),
  /** Leitos reservados no novo que o outro sistema ocupou (regra 12): o NIR vê e decide. */
  conflitos: z.array(
    z.object({
      reserva: z.number().int(),
      solicitacao: z.number().int(),
      chave: z.string(),
      internacao: z.number().int(),
      em: z.string(),
    }),
  ),
  /** Cirurgias dos próximos dias com a pendência de leito de UTI aberta e ainda sem solicitação. */
  cirurgiasUti: z.array(
    z.object({
      agendamento: z.number().int(),
      paciente: z.number().int().nullable(),
      nome: z.string(),
      dataHora: z.string(),
      sala: z.number().int(),
      comSolicitacao: z.boolean(),
    }),
  ),
  contagens: z.record(z.string(), z.number().int()),
  estourados: z.number().int(),
  lidoEm: z.string(),
});
export type FilaNir = z.infer<typeof esquemaFilaNir>;

export const esquemaLeitoCompativel = z.object({
  chave: z.string(),
  leito: esquemaChave,
  tipo: z.object({ codigo: z.number().int(), nome: z.string() }),
  intensiva: z.boolean(),
  compativel: z.boolean(),
  /** Por que o leito não atende o perfil (sexo, idade, isolamento, tipo); null quando atende. */
  motivo: z.string().nullable(),
});
export const esquemaLeitosCompativeis = z.object({
  solicitacao: z.number().int(),
  leitos: z.array(esquemaLeitoCompativel),
  compativeis: z.number().int(),
  lidoEm: z.string(),
});
export type LeitosCompativeis = z.infer<typeof esquemaLeitosCompativeis>;

export const esquemaBarreiraAlta = z.object({
  id: z.number().int(),
  tipo: z.enum(CODIGOS_TIPO_BARREIRA),
  descricao: z.string(),
  responsavel: z.string(),
  prazo: z.string(),
  vencida: z.boolean(),
  situacao: z.enum(['aberta', 'resolvida', 'cancelada']),
  criadaPor: z.string(),
  criadaEm: z.string(),
  resolvidaEm: z.string().nullable(),
});
export type BarreiraAlta = z.infer<typeof esquemaBarreiraAlta>;

export const esquemaDpaLida = z.object({
  id: z.number().int(),
  data: z.string(),
  motivo: z.string().nullable(),
  por: z.string(),
  em: z.string(),
  /** W0-07: a versão que retirou a alta prevista (a internação fica sem DPA). */
  retirada: z.boolean().default(false),
});

export const esquemaInternadoNir = z.object({
  internacao: z.number().int(),
  paciente: z.number().int(),
  /** Nome no painel do NIR (lista auditada); o painel de TV não existe para o NIR. */
  nome: z.string(),
  leito: esquemaChave,
  clinica: z.string(),
  entrada: z.string(),
  /** Dias de permanência pela Portaria 312 (nunca as diárias faturáveis). */
  dias312: z.number().int(),
  /** Dias em terapia intensiva pela trajetória (os trechos nos tipos intensivos). */
  diasUti: z.number().int(),
  dpa: esquemaDpaLida.nullable(),
  historicoDpa: z.array(esquemaDpaLida),
  limite: z
    .object({
      amareloDias: z.number().int(),
      vermelhoDias: z.number().int(),
      origem: z.string(),
      escopo: z.string(),
    })
    .nullable(),
  cor: z.enum(['verde', 'amarelo', 'vermelho']),
  motivoCor: z.string(),
  barreiras: z.array(esquemaBarreiraAlta),
  altaMedicaDecidida: z.boolean(),
});
export type InternadoNir = z.infer<typeof esquemaInternadoNir>;

export const esquemaQuadroPermanencia = z.object({
  colunas: z.object({
    verde: z.array(esquemaInternadoNir),
    amarelo: z.array(esquemaInternadoNir),
    vermelho: z.array(esquemaInternadoNir),
  }),
  /** Reunião de leitos: as solicitações abertas, as altas previstas para hoje e amanhã e os indicadores. */
  reuniao: z.object({
    altasHoje: z.array(z.number().int()),
    altasAmanha: z.array(z.number().int()),
    semDpa: z.number().int(),
    barreirasAbertas: z.number().int(),
    barreirasVencidas: z.number().int(),
    solicitacoesAbertas: z.number().int(),
    reservasVigentes: z.number().int(),
    indicadores: z.array(
      z.object({
        codigo: z.string(),
        nome: z.string(),
        numerador: z.number(),
        denominador: z.number(),
        valor: z.number().nullable(),
        unidade: z.string(),
      }),
    ),
  }),
  hoje: z.string(),
  lidoEm: z.string(),
});
export type QuadroPermanencia = z.infer<typeof esquemaQuadroPermanencia>;

export const esquemaReguaCalibragem = z.object({
  n: z.number().int(),
  p50: z.number().nullable(),
  p75: z.number().nullable(),
  p90: z.number().nullable(),
  media: z.number().nullable(),
});
export const esquemaCalibragem = z.object({
  periodo: z.object({ inicio: z.string(), fim: z.string() }),
  escopo: z.enum(ESCOPOS_LIMITE_PERMANENCIA),
  linhas: z.array(
    z.object({
      chave: z.string(),
      nome: z.string(),
      /** Dias pela Portaria 312 (a régua do quadro). */
      portaria312: esquemaReguaCalibragem,
      /** As diárias faturáveis gravadas (só para comparar; nunca a base do limite). */
      diariasFaturaveis: esquemaReguaCalibragem,
      /** Dias em terapia intensiva pela trajetória. */
      uti: esquemaReguaCalibragem,
      proposta: z.object({ amareloDias: z.number().int(), vermelhoDias: z.number().int() }).nullable(),
      vigente: z
        .object({ amareloDias: z.number().int(), vermelhoDias: z.number().int(), origem: z.string() })
        .nullable(),
    }),
  ),
  /** Amostra mínima para propor um limite (abaixo dela, sem proposta). */
  amostraMinima: z.number().int(),
});
export type Calibragem = z.infer<typeof esquemaCalibragem>;

export const esquemaDeparaSituacoes = z.object({
  itens: z.array(
    z.object({
      situacao: z.number().int(),
      rotulo: z.string(),
      proposto: z.enum(CODIGOS_ESTADO_NIR).nullable(),
      estado: z.enum(CODIGOS_ESTADO_NIR).nullable(),
      aConfirmar: z.boolean(),
      aprovadoPor: z.string().nullable(),
      aprovadoEm: z.string().nullable(),
    }),
  ),
  comDestino: z.number().int(),
  aConfirmar: z.number().int(),
});
export type DeparaSituacoes = z.infer<typeof esquemaDeparaSituacoes>;

/** De onde o médico pede o leito: os atendimentos do PA abertos, os internados e as cirurgias que pedem UTI. */
export const esquemaOrigensNir = z.object({
  pa: z.array(
    z.object({
      atendimento: z.number().int(),
      nome: z.string(),
      chegada: z.string(),
      senha: z.string().nullable(),
    }),
  ),
  internados: z.array(
    z.object({
      internacao: z.number().int(),
      paciente: z.number().int(),
      nome: z.string(),
      leito: z.string(),
    }),
  ),
  cirurgias: z.array(
    z.object({
      agendamento: z.number().int(),
      paciente: z.number().int().nullable(),
      nome: z.string(),
      dataHora: z.string(),
    }),
  ),
  /** Os tipos de acomodação dos leitos do mapa (o cadastro do estabelecimento): o pedido pode restringir a eles. */
  tiposAcomodacao: z.array(z.object({ codigo: z.number().int(), nome: z.string() })),
});
export type OrigensNir = z.infer<typeof esquemaOrigensNir>;

export const esquemaReservasNir = z.object({
  vigentes: z.array(esquemaReservaNir),
  encerradas: z.array(esquemaReservaNir),
  lidoEm: z.string(),
});
export type ReservasNir = z.infer<typeof esquemaReservasNir>;

export const esquemaAltasPrevistas = z.object({
  itens: z.array(esquemaInternadoNir),
  cortada: z.boolean(),
  hoje: z.string(),
  lidoEm: z.string(),
});
export type AltasPrevistas = z.infer<typeof esquemaAltasPrevistas>;

export const esquemaResultadoNir = z.object({
  ok: z.literal(true),
  id: z.number().int(),
  mensagem: z.string(),
});
export type ResultadoNir = z.infer<typeof esquemaResultadoNir>;

export const esquemaGravacaoNir = z.object({
  ligada: z.boolean(),
  motivo: z.string().nullable(),
  operacoes: z.record(z.string(), z.object({ pode: z.boolean(), motivo: z.string().nullable() })),
});
export type GravacaoNir = z.infer<typeof esquemaGravacaoNir>;
