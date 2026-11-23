// Portal do paciente, etapa 2 do M50 (ficha, seções 4, 5, 7 e 8; regras 3, 4 e 8): agendamento online, pré-check-in,
// pagamento do particular e pesquisa de satisfação; e as telas internas da configuração da agenda online e da
// conferência do pré-check-in. O portal nunca manda o ID do paciente: o servidor o tira da sessão (o titular escolhido).
// A marcação vai pelas receitas do M17 e do M18 (canal "portal", usuário de integração SGH.PORTAL); o pré-check-in só
// vira cadastro depois da conferência da recepção (receita do M11); o pagamento só pelo gateway (simulado fora de
// produção) e nunca duas vezes para a mesma transação.
import { z } from 'zod';
import { esquemaHora } from '../formatacao/hora.js';
import { MODALIDADES_MARCACAO, type SituacaoTeleconsulta } from '../telemedicina/teleconsulta.js';
import { textoCp1252 } from '../texto-cp1252.js';
import { idBanco } from '../validacao/id-banco.js';

export const CHAVE_PORTAL_AGENDA = 'portal.agenda';
export const CHAVE_PORTAL_PAGAMENTO = 'portal.pagamento';

export const TIPOS_AGENDA_ONLINE = ['consulta', 'exame'] as const;
export type TipoAgendaOnline = (typeof TIPOS_AGENDA_ONLINE)[number];

/** Convênio particular (código 10 do cadastro de convênios): o único cobrado pelo portal. */
export const CONVENIO_PARTICULAR_PORTAL = 10;
/** Teto de horários devolvidos numa busca do portal (ficha, seção 4). */
export const TETO_HORARIOS_PORTAL = 200;
/** Dias depois do atendimento em que a pesquisa de satisfação fica aberta. */
export const DIAS_PESQUISA_PORTAL = 30;
/** Antecedência máxima do pré-check-in (dias antes do horário). */
export const DIAS_ANTES_PRECHECKIN = 7;
/** Validade da cobrança Pix ou cartão aberta no portal (minutos). */
export const MINUTOS_COBRANCA_PORTAL = 30;

const id = idBanco;
const data = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, 'Data no formato AAAA-MM-DD.');
/** Hora do dia do horário ("HH:MM"). */
const horaDoDia = esquemaHora;
/** Convênio: fonte_pagadora.id (BIGINT); 0 = particular. */
const codigo = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

// ── Configuração da agenda online (tela interna, `agenda.configurarAgendaOnline`) ──────────────────────────────────

export const esquemaConfigAgendaOnline = z
  .object({
    tipo: z.enum(TIPOS_AGENDA_ONLINE),
    agenda: id,
    ativa: z.boolean(),
    /** Convênios liberados no portal (vazio = os aceitos pela própria agenda). */
    convenios: z.array(codigo).max(60),
    /** Especialidades (consulta) ou exames (exame) liberados (vazio = todos os da agenda). */
    servicos: z.array(id).max(60),
    antecedenciaHoras: z.number().int().min(0).max(720),
    horizonteDias: z.number().int().min(1).max(180),
    cancelaAteHoras: z.number().int().min(0).max(168),
    precheckin: z.boolean(),
    /** Valor da consulta ou do exame no particular cobrado pelo portal (null = sem pagamento online). */
    valorParticular: z.number().positive().max(99_999.99).multipleOf(0.01).nullable(),
    /** M50, etapa 4: a agenda de consulta também oferece a teleconsulta (o paciente escolhe a modalidade). */
    teleconsulta: z.boolean().default(false),
    /** Versão lida (null = a agenda ainda não tem configuração). */
    versao: z.number().int().positive().nullable(),
  })
  .strict()
  .refine((c) => c.convenios.length === new Set(c.convenios).size, {
    message: 'Convênio repetido.',
    path: ['convenios'],
  })
  .refine((c) => !c.teleconsulta || c.tipo === 'consulta', {
    message: 'A teleconsulta é só da agenda de consultas.',
    path: ['teleconsulta'],
  });
export type ConfigAgendaOnlineEntrada = z.infer<typeof esquemaConfigAgendaOnline>;

export interface ConfigAgendaOnlineItem {
  readonly tipo: TipoAgendaOnline;
  readonly agenda: number;
  readonly nomeAgenda: string;
  readonly procedimento: string;
  readonly profissional: string | null;
  readonly agendaAtiva: boolean;
  /** null = a agenda ainda não foi configurada para o portal (desligada). */
  readonly config: {
    readonly ativa: boolean;
    readonly convenios: number[];
    readonly servicos: number[];
    readonly antecedenciaHoras: number;
    readonly horizonteDias: number;
    readonly cancelaAteHoras: number;
    readonly precheckin: boolean;
    readonly valorParticular: number | null;
    /** M50, etapa 4: a agenda oferece a teleconsulta no portal. */
    readonly teleconsulta: boolean;
    readonly alteradoPor: string;
    readonly alteradoEm: string | null;
    readonly versao: number;
  } | null;
}

/**
 * O detalhe de uma agenda na tela de configuração (lido só ao abrir: a lista não carrega os convênios nem os serviços
 * de cada agenda). Os serviços da agenda de exame sem cobertura são os exames da categoria (até 300; a tela busca).
 */
export interface ConfigAgendaOnlineDetalhe extends ConfigAgendaOnlineItem {
  readonly conveniosDaAgenda: { codigo: number; nome: string }[];
  readonly servicosDaAgenda: { codigo: number; nome: string }[];
}

export interface ListaConfigAgendaOnline {
  readonly itens: ConfigAgendaOnlineItem[];
  /** A chave `portal.agenda` no estabelecimento (desligada: nada aparece no portal, mesmo com agendas configuradas). */
  readonly portalLigado: boolean;
  readonly motivo: string | null;
  readonly podeConfigurar: boolean;
}

// ── Portal: agendar ────────────────────────────────────────────────────────────────────────────────────────────────

export const esquemaBuscaHorariosPortal = z
  .object({
    tipo: z.enum(TIPOS_AGENDA_ONLINE),
    servico: id.nullable().default(null),
    agenda: id.nullable().default(null),
    convenio: codigo,
    de: data.nullable().default(null),
    /** M50, etapa 4: só as agendas que oferecem a teleconsulta (consulta). */
    modalidade: z.enum(MODALIDADES_MARCACAO).default('presencial'),
  })
  .strict();
export type BuscaHorariosPortal = z.infer<typeof esquemaBuscaHorariosPortal>;

export interface OpcaoServicoPortal {
  readonly codigo: number;
  readonly nome: string;
}

export interface AgendaDoPortal {
  readonly agenda: number;
  readonly procedimento: string;
  readonly profissional: string | null;
  readonly servicos: number[];
  readonly convenios: number[];
  readonly valorParticular: number | null;
  /** M50, etapa 4: a agenda oferece a teleconsulta. */
  readonly teleconsulta: boolean;
}

export interface OpcoesAgendarPortal {
  readonly tipo: TipoAgendaOnline;
  readonly servicos: OpcaoServicoPortal[];
  readonly convenios: { codigo: number; nome: string }[];
  readonly agendas: AgendaDoPortal[];
}

export interface HorarioPortal {
  readonly agenda: number;
  readonly procedimento: string;
  readonly profissional: string | null;
  readonly data: string;
  /** HH:MM. */
  readonly hora: string;
}

export interface HorariosPortal {
  readonly itens: HorarioPortal[];
  readonly truncado: boolean;
  readonly de: string;
  readonly ate: string;
}

export const esquemaAgendarPortal = z
  .object({
    tipo: z.enum(TIPOS_AGENDA_ONLINE),
    agenda: id,
    data,
    hora: horaDoDia,
    convenio: codigo,
    /** Exame escolhido (só no tipo exame; null = a recepção define na chegada). */
    servico: id.nullable().default(null),
    /** M50, etapa 4: a consulta por teleconsulta (só nas agendas que a oferecem). */
    modalidade: z.enum(MODALIDADES_MARCACAO).default('presencial'),
  })
  .strict()
  .refine((e) => e.modalidade === 'presencial' || e.tipo === 'consulta', {
    message: 'A teleconsulta é só para consulta.',
    path: ['modalidade'],
  });
export type AgendarPortal = z.infer<typeof esquemaAgendarPortal>;

export const MOTIVOS_CANCELAMENTO_PORTAL = [
  { codigo: 'PAC-DESISTIU', rotulo: 'Não preciso mais' },
  { codigo: 'PAC-OUTRA-DATA', rotulo: 'Vou marcar outra data' },
  { codigo: 'PAC-SAUDE', rotulo: 'Estou sem condição de ir' },
] as const;
export type MotivoCancelamentoPortal = (typeof MOTIVOS_CANCELAMENTO_PORTAL)[number]['codigo'];
const motivos = MOTIVOS_CANCELAMENTO_PORTAL.map((m) => m.codigo) as [
  MotivoCancelamentoPortal,
  ...MotivoCancelamentoPortal[],
];

export const esquemaCancelarPortal = z.object({ motivo: z.enum(motivos) }).strict();
export type CancelarPortal = z.infer<typeof esquemaCancelarPortal>;

export const esquemaRemarcarPortal = z
  .object({
    destino: z.object({ agenda: id, data, hora: horaDoDia }).strict(),
    // W0-10: o motivo escolhido na tela (a mesma lista do cancelamento); sem ele vale "outra data".
    motivo: z.enum(motivos).optional(),
  })
  .strict();
export type RemarcarPortal = z.infer<typeof esquemaRemarcarPortal>;

export const SITUACOES_AGENDAMENTO_PORTAL = [
  'marcado',
  'atendido',
  'faltou',
  'cancelado',
  'transferido',
] as const;
export type SituacaoAgendamentoPortal = (typeof SITUACOES_AGENDAMENTO_PORTAL)[number];

export interface AgendamentoPortal {
  readonly tipo: TipoAgendaOnline;
  /** ID da marcação (de consulta ou de exame) como texto. */
  readonly id: string;
  readonly procedimento: string;
  readonly profissional: string | null;
  readonly data: string;
  readonly hora: string;
  readonly situacao: SituacaoAgendamentoPortal;
  readonly peloPortal: boolean;
  readonly cancelar: { pode: boolean; motivo: string | null };
  readonly remarcar: { pode: boolean; motivo: string | null };
  readonly precheckin: {
    readonly pode: boolean;
    readonly situacao: 'enviado' | 'conferido' | 'recusado' | 'cancelado' | null;
    readonly motivoRecusa: string | null;
  };
  readonly pagamento: {
    readonly valor: number | null;
    readonly situacao: SituacaoCobrancaPortal | null;
  };
  readonly pesquisa: 'pendente' | 'respondida' | null;
  /** M50, etapa 4: a teleconsulta da marcação (a sala de espera no portal). */
  readonly teleconsulta: { readonly id: number; readonly situacao: SituacaoTeleconsulta } | null;
}

export interface ListaAgendamentosPortal {
  readonly itens: AgendamentoPortal[];
  readonly truncado: boolean;
}

export interface ResultadoAgendamentoPortal {
  readonly ok: boolean;
  readonly agendamento: AgendamentoPortal | null;
  /** Na colisão (o horário acabou de ser ocupado por outro canal), o próximo livre da mesma agenda. */
  readonly proximo: HorarioPortal | null;
  readonly mensagem: string;
}

// ── Pré-check-in ──────────────────────────────────────────────────────────────────────────────────────────────────

const soDigitos = (s: string) => s.replace(/\D/g, '');
const fone = z
  .string()
  .transform(soDigitos)
  .pipe(z.string().regex(/^\d{10,11}$/, 'Telefone com DDD (10 ou 11 dígitos).'));

/** Os campos que o paciente pode propor (os mesmos nomes da alteração do cadastro do M11; CP1252 validado). */
export const esquemaDadosPreCheckin = z
  .object({
    celular: fone.optional(),
    telefone: fone.optional(),
    email: textoCp1252(50)
      .overwrite((t) => t.trim().toLowerCase())
      .pipe(z.email('E-mail inválido.'))
      .optional(),
    cep: z
      .string()
      .transform(soDigitos)
      .pipe(z.string().regex(/^\d{8}$/, 'CEP com 8 dígitos.'))
      .optional(),
    logradouro: textoCp1252(40)
      .overwrite((t) => t.trim().toUpperCase())
      .pipe(z.string().min(3))
      .optional(),
    numero: z.number().int().min(0).max(999_999).optional(),
    complemento: textoCp1252(15)
      .overwrite((t) => t.trim().toUpperCase())
      .optional(),
    bairro: textoCp1252(30)
      .overwrite((t) => t.trim().toUpperCase())
      .pipe(z.string().min(2))
      .optional(),
    contatoNome: textoCp1252(40)
      .overwrite((t) => t.trim().toUpperCase())
      .pipe(z.string().min(3))
      .optional(),
    contatoTelefone: fone.optional(),
  })
  .strict();
export type DadosPreCheckin = z.infer<typeof esquemaDadosPreCheckin>;
export const CAMPOS_PRECHECKIN = [
  'celular',
  'telefone',
  'email',
  'cep',
  'logradouro',
  'numero',
  'complemento',
  'bairro',
  'contatoNome',
  'contatoTelefone',
] as const;
export type CampoPreCheckin = (typeof CAMPOS_PRECHECKIN)[number];

export const TIPOS_DOCUMENTO_PRECHECKIN = ['identidade', 'carteirinha', 'pedido-medico'] as const;
export type TipoDocumentoPreCheckin = (typeof TIPOS_DOCUMENTO_PRECHECKIN)[number];
export const TIPOS_ARQUIVO_PRECHECKIN = ['image/jpeg', 'image/png', 'application/pdf'] as const;
export const TAMANHO_MAXIMO_PRECHECKIN = 700_000;
/** Versão vigente do termo de ciência do atendimento aceito no pré-check-in. */
export const VERSAO_TERMO_PRECHECKIN = '2026.1';

export const esquemaArquivoPreCheckin = z
  .object({
    tipo: z.enum(TIPOS_ARQUIVO_PRECHECKIN),
    /** Base64 do arquivo (a tela reduz a foto antes de enviar). */
    conteudo: z
      .string()
      .min(8)
      .max(Math.ceil((TAMANHO_MAXIMO_PRECHECKIN * 4) / 3) + 4)
      .regex(/^[A-Za-z0-9+/]+={0,2}$/, 'Arquivo inválido.'),
  })
  .strict();

export const esquemaPreCheckinPortal = z
  .object({
    dados: esquemaDadosPreCheckin,
    documentos: z
      .array(
        z
          .object({ tipo: z.enum(TIPOS_DOCUMENTO_PRECHECKIN), arquivo: z.string().regex(/^[a-f0-9]{32}$/) })
          .strict(),
      )
      .max(3),
    carteirinha: z
      .object({
        numero: z
          .string()
          .trim()
          .regex(/^[A-Za-z0-9.\-/ ]{3,30}$/, 'Número da carteirinha com 3 a 30 letras ou números.'),
        validade: data.nullable(),
      })
      .strict()
      .nullable(),
    termo: z.literal(VERSAO_TERMO_PRECHECKIN),
  })
  .strict()
  .refine((p) => new Set(p.documentos.map((d) => d.tipo)).size === p.documentos.length, {
    message: 'Um arquivo por tipo de documento.',
    path: ['documentos'],
  });
export type PreCheckinPortal = z.infer<typeof esquemaPreCheckinPortal>;

export interface PreCheckinDoPortal {
  readonly agendamento: AgendamentoPortal;
  readonly situacao: 'enviado' | 'conferido' | 'recusado' | 'cancelado' | null;
  readonly motivoRecusa: string | null;
  /** O que está no cadastro hoje, só dos campos do pré-check-in (o próprio paciente vê o seu contato). */
  readonly atual: Partial<Record<CampoPreCheckin, string | number | null>>;
  readonly proposto: Partial<Record<CampoPreCheckin, string | number>>;
  readonly documentos: { tipo: TipoDocumentoPreCheckin }[];
  readonly carteirinha: { numero: string; validade: string | null } | null;
  readonly termo: string;
  readonly pedeCarteirinha: boolean;
}

// ── Conferência do pré-check-in (tela interna) ─────────────────────────────────────────────────────────────────────

export const esquemaFiltroFilaPreCheckin = z
  .object({
    situacao: z.enum(['enviado', 'conferido', 'recusado']).default('enviado'),
    data: data.nullable().default(null),
    depoisDe: z.number().int().positive().nullable().default(null),
    /** Nome ou prontuário do paciente (a busca do cadastro, com o teto dela); null = a fila inteira. */
    termo: z.string().trim().min(2).max(60).nullable().default(null),
  })
  .strict();
export type FiltroFilaPreCheckin = z.infer<typeof esquemaFiltroFilaPreCheckin>;

export interface ItemFilaPreCheckin {
  readonly id: string;
  readonly tipo: TipoAgendaOnline;
  readonly data: string;
  readonly hora: string;
  readonly agenda: string;
  readonly paciente: { id: number; nome: string; prontuario: number };
  readonly situacao: 'enviado' | 'conferido' | 'recusado' | 'cancelado';
  readonly enviadoEm: string | null;
  readonly campos: number;
  readonly documentos: number;
  /** A marcação já não existe (cancelada ou transferida por outro canal): o pré-check-in não é mais conferido. */
  readonly marcacaoCancelada: boolean;
}

export interface FilaPreCheckin {
  readonly itens: ItemFilaPreCheckin[];
  readonly proximo: number | null;
  readonly podeConferir: boolean;
  /** A busca por paciente achou mais do que o teto: refine o nome. */
  readonly buscaTruncada: boolean;
}

export interface CampoConferencia {
  readonly campo: CampoPreCheckin;
  readonly atual: string | number | null;
  readonly proposto: string | number;
  readonly muda: boolean;
}

export interface DetalhePreCheckin {
  readonly item: ItemFilaPreCheckin;
  readonly campos: CampoConferencia[];
  readonly documentos: { tipo: TipoDocumentoPreCheckin; indice: number }[];
  readonly carteirinha: { numero: string; validade: string | null } | null;
  readonly termo: string;
  readonly motivoRecusa: string | null;
  readonly conferidoPor: string | null;
  /** Outra pessoa está conferindo agora (a reserva vence em minutos). */
  readonly reservadoPor: string | null;
  readonly camposGravados: string[];
  /** Versão do pré-check-in (controle otimista). */
  readonly versao: number;
  /** Versão do cadastro lida (a alteração do M11 confere a mesma). */
  readonly versaoCadastro: string;
}

export const esquemaConferirPreCheckin = z
  .object({
    versao: z.number().int().positive(),
    versaoCadastro: z.string().min(2).max(8000),
    /** Os campos aprovados (gravados no cadastro); vazio = conferido sem mudar o cadastro. */
    campos: z.array(z.enum(CAMPOS_PRECHECKIN)).max(CAMPOS_PRECHECKIN.length),
  })
  .strict();
export type ConferirPreCheckin = z.infer<typeof esquemaConferirPreCheckin>;

export const esquemaRecusarPreCheckin = z
  .object({
    versao: z.number().int().positive(),
    motivo: textoCp1252(300)
      .overwrite((t) => t.replace(/\s+/g, ' ').trim())
      .pipe(z.string().min(5, 'Diga ao paciente o que corrigir (ao menos 5 caracteres).')),
  })
  .strict();
export type RecusarPreCheckin = z.infer<typeof esquemaRecusarPreCheckin>;

// ── Pagamento ─────────────────────────────────────────────────────────────────────────────────────────────────────

export const FORMAS_PAGAMENTO_PORTAL = ['pix', 'cartao-credito'] as const;
/**
 * `duplicado`: o gateway aprovou quando a marcação já estava paga (a cobrança vencida paga no fim do prazo, por
 * exemplo); o valor vai ao caixa do portal e o faturamento devolve. A marcação nunca fica com dois pagamentos.
 */
export const SITUACOES_COBRANCA_PORTAL = [
  'pendente',
  'confirmado',
  'recusado',
  'expirado',
  'duplicado',
] as const;
export type SituacaoCobrancaPortal = (typeof SITUACOES_COBRANCA_PORTAL)[number];
export type FormaPagamentoPortal = (typeof FORMAS_PAGAMENTO_PORTAL)[number];

export const esquemaIniciarPagamentoPortal = z.object({ forma: z.enum(FORMAS_PAGAMENTO_PORTAL) }).strict();
export type IniciarPagamentoPortal = z.infer<typeof esquemaIniciarPagamentoPortal>;

export interface CobrancaPortal {
  readonly id: string;
  readonly agendamento: string;
  readonly tipo: TipoAgendaOnline;
  readonly valor: number;
  readonly forma: FormaPagamentoPortal;
  readonly situacao: SituacaoCobrancaPortal;
  readonly expiraEm: string;
  /** Pix: o código copia e cola do gateway (o QR é desenhado na tela). */
  readonly pixCopiaECola: string | null;
  /** Cartão: o endereço da página segura do gateway (o portal nunca vê o número do cartão). */
  readonly enderecoCartao: string | null;
  readonly simulado: boolean;
  readonly confirmadoEm: string | null;
}

export interface ListaPagamentosPortal {
  readonly itens: CobrancaPortal[];
  readonly ligado: boolean;
}

/** O retorno do gateway (notificação assinada); o servidor relê a transação no gateway antes de confirmar. */
export const esquemaRetornoGateway = z
  .object({
    transacao: z
      .string()
      .min(4)
      .max(80)
      .regex(/^[A-Za-z0-9._-]+$/),
    hospital: z.string().regex(/^[a-z0-9]{1,10}$/),
  })
  .strict();
export type RetornoGateway = z.infer<typeof esquemaRetornoGateway>;

// ── W0-10: tesouraria das cobranças do portal (conciliação; linha 'Financeiro' da matriz) ─────────────────────────────
/**
 * Cada ato é um fato novo (nada se altera nem se apaga): a baixa ('conciliado', o valor do extrato confere), a
 * divergência com motivo (antes da baixa) e o estorno com motivo (devolução pelo gateway; depois da baixa é o único
 * caminho). Segregação: quem concilia não é quem cobrou; quem estorna não é quem conciliou.
 */
export const ACOES_TESOURARIA_PORTAL = ['conciliado', 'divergente', 'estorno'] as const;
export type AcaoTesourariaPortal = (typeof ACOES_TESOURARIA_PORTAL)[number];
export const SITUACOES_TESOURARIA_PORTAL = ['a-conciliar', 'divergente', 'conciliado', 'estornado'] as const;
export type SituacaoTesourariaPortal = (typeof SITUACOES_TESOURARIA_PORTAL)[number];

const DATA_ISO = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data no formato AAAA-MM-DD.');
export const esquemaFiltroTesourariaPortal = z
  .object({ de: DATA_ISO, ate: DATA_ISO })
  .strict()
  .refine((f) => f.de <= f.ate, { message: 'O início vem antes do fim.', path: ['ate'] })
  .refine((f) => Date.parse(f.ate) - Date.parse(f.de) <= 92 * 86_400_000, {
    message: 'Período de até 92 dias.',
    path: ['ate'],
  });
export type FiltroTesourariaPortal = z.infer<typeof esquemaFiltroTesourariaPortal>;

const motivoTesouraria = textoCp1252(250)
  .overwrite((t) => t.replace(/\s+/g, ' ').trim())
  .pipe(z.string().min(5, 'Informe o motivo (ao menos 5 caracteres).'));
const referenciaExtrato = z
  .string()
  .trim()
  .max(80)
  .regex(/^[A-Za-z0-9 ._/-]*$/, 'Só letras, números, espaço e . _ / -')
  .nullable()
  .default(null);
const valorExtrato = z.number().positive().max(9_999_999).multipleOf(0.01);

/** A baixa ou a divergência pelo extrato do gateway. */
export const esquemaConciliarPagamentoPortal = z.discriminatedUnion('acao', [
  z.object({ acao: z.literal('conciliado'), valor: valorExtrato, referencia: referenciaExtrato }).strict(),
  z
    .object({
      acao: z.literal('divergente'),
      valor: valorExtrato,
      referencia: referenciaExtrato,
      motivo: motivoTesouraria,
    })
    .strict(),
]);
export type ConciliarPagamentoPortal = z.infer<typeof esquemaConciliarPagamentoPortal>;

/** O estorno (valor total, pelo gateway); a senha da reautenticação vai à parte. */
export const esquemaEstornarPagamentoPortal = z.object({ motivo: motivoTesouraria }).strict();
export type EstornarPagamentoPortal = z.infer<typeof esquemaEstornarPagamentoPortal>;

export interface AtoTesourariaPortal {
  readonly id: string;
  readonly acao: AcaoTesourariaPortal;
  readonly valor: number;
  readonly referencia: string | null;
  readonly motivo: string | null;
  readonly usuario: string;
  readonly em: string | null;
}

export interface PagamentoTesourariaPortal {
  readonly id: string;
  readonly tipo: TipoAgendaOnline;
  readonly marcacao: string;
  readonly paciente: string;
  readonly valor: number;
  readonly forma: FormaPagamentoPortal;
  readonly conector: 'simulado' | 'gateway';
  readonly transacao: string;
  /** 'confirmado' ou 'duplicado' (o dinheiro entrou; o duplicado é o candidato natural ao estorno). */
  readonly situacaoCobranca: SituacaoCobrancaPortal;
  readonly confirmadoEm: string | null;
  readonly cobradoPor: string | null;
  readonly situacao: SituacaoTesourariaPortal;
  readonly atos: readonly AtoTesourariaPortal[];
}

export interface ListaTesourariaPortal {
  readonly itens: readonly PagamentoTesourariaPortal[];
  /** O gateway aceita estorno neste ambiente (sem gateway, o estorno fica indisponível com o motivo). */
  readonly estornoDisponivel: boolean;
}

// ── Pesquisa de satisfação ────────────────────────────────────────────────────────────────────────────────────────

export const esquemaPesquisaPortal = z
  .object({
    nota: z.number().int().min(0).max(10),
    comentario: textoCp1252(500)
      .overwrite((t) => t.replace(/\s+/g, ' ').trim())
      .nullable()
      .default(null),
  })
  .strict();
export type PesquisaPortal = z.infer<typeof esquemaPesquisaPortal>;
