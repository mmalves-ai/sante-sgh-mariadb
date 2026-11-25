// Internação, leitos, higienização e SAME (M21; ficha, seções 5 a 8): o vocabulário e as entradas das operações,
// validadas na tela, na API e no executor (o mesmo Zod). Vocabulário do novo: a internação é o número que a recepção vê
// (o registro do legado), o leito é a chave natural do mapa (bloco + acomodação + leito, texto: o legado não tem ID
// estável), o paciente é o ID do cadastro, o profissional é o ID do vínculo profissional × CBO (o conselho vem dele).
// Data e hora vêm sempre do relógio do banco (nunca da tela), salvo a data prevista da pré-internação e a hora da
// alta informada pela enfermagem (dentro do dia, conferida no servidor). Nenhum nome de tabela nem de coluna aqui.
import { z } from 'zod';
import { esquemaHora } from '../formatacao/hora.js';
import { esquemaDataIso } from '../preco/entradas.js';
import { textoCp1252 } from '../texto-cp1252.js';
import { idBanco } from '../validacao/id-banco.js';

const id = idBanco;
const smallint = z.number().int().min(0).max(32_767);
const maiusculas = (max: number) =>
  textoCp1252(max)
    .overwrite((t) => t.replace(/\s+/g, ' ').trim().toLocaleUpperCase('pt-BR'))
    .pipe(textoCp1252(max));
const livre = (max: number) => textoCp1252(max).overwrite((t) => t.replace(/\s+/g, ' ').trim());

/** Número da internação (o registro que a recepção, a enfermagem e o faturamento veem). */
export const esquemaRegInternacao = id;

/** Leito pela chave natural do mapa (bloco + acomodação + leito; texto como o mapa mostra). */
export const esquemaChaveLeito = z
  .object({
    bloco: textoCp1252(5)
      .overwrite((t) => t.trim())
      .pipe(z.string().min(1, 'Informe o bloco.')),
    acomodacao: textoCp1252(6)
      .overwrite((t) => t.trim())
      .pipe(z.string().min(1, 'Informe a acomodação.')),
    leito: textoCp1252(5)
      .overwrite((t) => t.trim())
      .pipe(z.string().min(1, 'Informe o leito.')),
  })
  .strict();
export type ChaveLeito = z.infer<typeof esquemaChaveLeito>;

/** Chave em texto do leito (bloco|acomodação|leito), a ligação das tabelas próprias do novo. */
export function chaveTextoLeito(l: ChaveLeito): string {
  return `${l.bloco}|${l.acomodacao}|${l.leito}`;
}
export function leitoDaChaveTexto(t: string): ChaveLeito | null {
  const [bloco, acomodacao, leito, ...resto] = t.split('|');
  if (!bloco || !acomodacao || !leito || resto.length > 0) return null;
  return { bloco, acomodacao, leito };
}

// ── Vocabulário ───────────────────────────────────────────────────────────────────────────────────

/** Caráter da internação, como o legado grava (1 eletivo, 2 urgência: 570 e 757 de 2025-10 a 2026-07). */
export const CARATERES_INTERNACAO = [
  { codigo: 'eletivo', legado: '1', rotulo: 'Eletivo' },
  { codigo: 'urgencia', legado: '2', rotulo: 'Urgência ou emergência' },
] as const;
export const CODIGOS_CARATER_INTERNACAO = ['eletivo', 'urgencia'] as const;
export type CaraterInternacao = (typeof CODIGOS_CARATER_INTERNACAO)[number];
export function caraterInternacaoLegado(c: CaraterInternacao): '1' | '2' {
  return c === 'eletivo' ? '1' : '2';
}

/** Clínica da internação (as letras do cadastro de clínicas vistas: M médica, C cirúrgica, N neonatal). */
export const CLINICAS_INTERNACAO = [
  { codigo: 'M', rotulo: 'Clínica médica' },
  { codigo: 'C', rotulo: 'Clínica cirúrgica' },
  { codigo: 'N', rotulo: 'Neonatologia' },
] as const;
export const CODIGOS_CLINICA_INTERNACAO = ['M', 'C', 'N'] as const;

/** Origem da internação (o legado grava o encaminhamento 0 em 100%; a origem fica no novo). */
export const ORIGENS_INTERNACAO = [
  { codigo: 'pa', rotulo: 'Pronto atendimento' },
  { codigo: 'ambulatorio', rotulo: 'Ambulatório' },
  { codigo: 'transferenciaExterna', rotulo: 'Transferência de outro serviço' },
  { codigo: 'eletiva', rotulo: 'Eletiva (pré-internação)' },
  { codigo: 'cirurgia', rotulo: 'Cirurgia eletiva agendada' },
] as const;
export const CODIGOS_ORIGEM_INTERNACAO = [
  'pa',
  'ambulatorio',
  'transferenciaExterna',
  'eletiva',
  'cirurgia',
] as const;
export type OrigemInternacao = (typeof CODIGOS_ORIGEM_INTERNACAO)[number];

/** Primeiro nível de cuidado (classificação de Fugulin, Cofen 543/2017). */
export const NIVEIS_CUIDADO = [
  { codigo: 'minimo', rotulo: 'Cuidado mínimo' },
  { codigo: 'intermediario', rotulo: 'Cuidado intermediário' },
  { codigo: 'altaDependencia', rotulo: 'Alta dependência' },
  { codigo: 'semiIntensivo', rotulo: 'Semi-intensivo' },
  { codigo: 'intensivo', rotulo: 'Intensivo' },
] as const;
export const CODIGOS_NIVEL_CUIDADO = [
  'minimo',
  'intermediario',
  'altaDependencia',
  'semiIntensivo',
  'intensivo',
] as const;
export type NivelCuidado = (typeof CODIGOS_NIVEL_CUIDADO)[number];

/** Acomodação do plano do paciente (o que a carteirinha cobre), como o legado grava (99,5% das internações). */
export const ACOMODACOES_PLANO = ['APARTAMENTO', 'ENFERMARIA'] as const;
export type AcomodacaoPlano = (typeof ACOMODACOES_PLANO)[number];

/** Precauções de isolamento (CCIH; a limpeza terminal com o protocolo antes da liberação, regra 9). */
export const PRECAUCOES = [
  { codigo: 'contato', rotulo: 'Precaução de contato' },
  { codigo: 'goticulas', rotulo: 'Precaução para gotículas' },
  { codigo: 'aerossois', rotulo: 'Precaução para aerossóis' },
] as const;
export const CODIGOS_PRECAUCAO = ['contato', 'goticulas', 'aerossois'] as const;
export type Precaucao = (typeof CODIGOS_PRECAUCAO)[number];

/** Estados do leito só do novo (o outro sistema não os vê; o mapa mostra o conflito, regra 8). */
export const ESTADOS_LEITO_NOVO = ['bloqueio', 'precaucao', 'extra', 'higienizacao'] as const;
export type EstadoLeitoNovo = (typeof ESTADOS_LEITO_NOVO)[number];

/** Motivos de bloqueio do leito (o legado só tem ativo e inativo). */
export const MOTIVOS_BLOQUEIO_LEITO = [
  { codigo: 'manutencao', rotulo: 'Manutenção' },
  { codigo: 'reserva', rotulo: 'Reservado pela coordenação' },
  { codigo: 'isolamento', rotulo: 'Isolamento de coorte' },
  { codigo: 'faltaEquipe', rotulo: 'Falta de equipe' },
  { codigo: 'outro', rotulo: 'Outro motivo' },
] as const;
export const CODIGOS_MOTIVO_BLOQUEIO_LEITO = [
  'manutencao',
  'reserva',
  'isolamento',
  'faltaEquipe',
  'outro',
] as const;

/** Destino codificado da alta médica (o grupo do motivo de alta do legado segue o motivo escolhido). */
export const DESTINOS_ALTA = [
  { codigo: 'domicilio', rotulo: 'Domicílio' },
  { codigo: 'internacaoDomiciliar', rotulo: 'Internação ou atenção domiciliar' },
  { codigo: 'transferenciaExterna', rotulo: 'Transferência para outro serviço' },
  { codigo: 'obito', rotulo: 'Óbito' },
  { codigo: 'aPedido', rotulo: 'A pedido ou evasão' },
  { codigo: 'administrativo', rotulo: 'Encerramento administrativo' },
] as const;
export const CODIGOS_DESTINO_ALTA = [
  'domicilio',
  'internacaoDomiciliar',
  'transferenciaExterna',
  'obito',
  'aPedido',
  'administrativo',
] as const;
export type DestinoAlta = (typeof CODIGOS_DESTINO_ALTA)[number];

/** Tipo de saída do legado (-1 e 0 vistos; 0 na internação aberta). */
export const TIPOS_SAIDA_LEGADO = [0, -1] as const;

// ── Higienização ──────────────────────────────────────────────────────────────────────────────────

/** Estados da higienização no novo (regra 9): Solicitado → Atribuído → Em execução → Concluído → Inspecionado → Liberado. */
export const ETAPAS_LIMPEZA = [
  { codigo: 'solicitado', rotulo: 'Solicitado' },
  { codigo: 'atribuido', rotulo: 'Atribuído' },
  { codigo: 'emExecucao', rotulo: 'Em execução' },
  { codigo: 'pausado', rotulo: 'Pausado' },
  { codigo: 'concluido', rotulo: 'Concluído' },
  { codigo: 'reprovado', rotulo: 'Reprovado na inspeção' },
  { codigo: 'inspecionado', rotulo: 'Inspecionado' },
  { codigo: 'liberado', rotulo: 'Liberado' },
  { codigo: 'cancelado', rotulo: 'Cancelado' },
] as const;
export const CODIGOS_ETAPA_LIMPEZA = [
  'solicitado',
  'atribuido',
  'emExecucao',
  'pausado',
  'concluido',
  'reprovado',
  'inspecionado',
  'liberado',
  'cancelado',
] as const;
export type EtapaLimpeza = (typeof CODIGOS_ETAPA_LIMPEZA)[number];

/** Origem da solicitação de limpeza. */
export const ORIGENS_LIMPEZA = ['alta', 'manual', 'qrcode'] as const;
export type OrigemLimpeza = (typeof ORIGENS_LIMPEZA)[number];

/**
 * Situação da execução da limpeza (1 Alta hospitalar, 2, 3 Em higienização, 4 Liberado). Só 1 e 2 foram
 * gravados (6.857 e 11): 3 e 4 ficam recusados até a decisão registrada (DP nova, ESTADO.md) e a conferência na tela.
 */
export const SITUACOES_LIMPEZA_LEGADO = [1, 2, 3, 4] as const;
export const SITUACOES_LIMPEZA_LIBERADAS = [1, 2] as const;

// ── SAME ──────────────────────────────────────────────────────────────────────────────────────────

/** Operações da movimentação de prontuário e conta (o cadastro do legado: 6 operações). */
export const OPERACOES_SAME = [
  { codigo: 1, chave: 'registro', rotulo: 'Registro' },
  { codigo: 2, chave: 'saida', rotulo: 'Saída' },
  { codigo: 3, chave: 'devolucao', rotulo: 'Devolução' },
  { codigo: 4, chave: 'descarte', rotulo: 'Descarte' },
  { codigo: 5, chave: 'transferencia', rotulo: 'Transferência' },
  { codigo: 6, chave: 'recebimento', rotulo: 'Recebimento' },
] as const;
export const CODIGOS_OPERACAO_SAME = [1, 2, 3, 4, 5, 6] as const;
export type OperacaoSame = (typeof CODIGOS_OPERACAO_SAME)[number];
export function operacaoSame(codigo: number) {
  return OPERACOES_SAME.find((o) => o.codigo === codigo) ?? null;
}

// ── internacao.internar ───────────────────────────────────────────────────────────────────────────

/** O responsável pela internação; sem ele, o próprio paciente (1.093 de 1.327 internações). */
export const esquemaResponsavelInternacao = z
  .object({
    nome: maiusculas(70).refine((t) => t !== '', 'Informe o nome do responsável.'),
    /** Parentesco como o legado grava (1 a 6; 9 o próprio paciente). */
    parentesco: z.number().int().min(1).max(9),
    sexo: z.enum(['M', 'F']),
    nascimento: esquemaDataIso.optional(),
    identidade: livre(15).optional(),
    cpf: z
      .string()
      .transform((t) => t.replace(/\D/g, ''))
      .pipe(z.string().length(11, 'CPF com 11 dígitos.'))
      .optional(),
    telefone: z
      .string()
      .transform((t) => t.replace(/\D/g, ''))
      .pipe(z.string().min(10).max(15))
      .optional(),
  })
  .strict();
export type ResponsavelInternacao = z.infer<typeof esquemaResponsavelInternacao>;

export const esquemaInternar = z
  .object({
    paciente: id,
    leito: esquemaChaveLeito,
    convenio: smallint.refine((c) => c > 0, 'Informe o convênio.'),
    matricula: livre(24).optional(),
    validadeCarteira: esquemaDataIso.optional(),
    senhaConvenio: livre(20).optional(),
    validadeSenha: esquemaDataIso.optional(),
    /** Guia da internação; sem ela, o legado usa a regra do convênio (o próprio número da internação). */
    guia: livre(20).optional(),
    /** Diárias autorizadas na guia inicial (0, 1 e 10 vistos). */
    diariasAutorizadas: z.number().int().min(0).max(999).default(0),
    acomodacaoPlano: z.enum(ACOMODACOES_PLANO),
    carater: z.enum(CODIGOS_CARATER_INTERNACAO),
    clinica: z.enum(CODIGOS_CLINICA_INTERNACAO).default('M'),
    especialidade: smallint.refine((e) => e > 0, 'Informe a especialidade.'),
    /** Médico assistente (vínculo) e o solicitante (vínculo); o legado confere os dois pelo conselho. */
    medicoAssistente: id,
    medicoSolicitante: id,
    cidPrincipal: id,
    cidSecundario: id.optional(),
    /** Procedimento da internação (tabela do convênio). */
    procedimento: z.number().int().positive().max(999_999_999),
    centroCusto: z.number().int().positive(),
    unidade: smallint.refine((u) => u > 0, 'Informe a unidade.'),
    origem: z.enum(CODIGOS_ORIGEM_INTERNACAO),
    /** O atendimento de pronto atendimento de onde o paciente vem (herda o atendimento: a ficha externa). */
    atendimentoOrigem: id.optional(),
    /** A cirurgia agendada ligada (M18). */
    cirurgia: id.optional(),
    nivelCuidado: z.enum(CODIGOS_NIVEL_CUIDADO).optional(),
    /** Paciente em isolamento (a acomodação inteira fica com ele, como o legado confere). */
    isolamento: z.boolean().default(false),
    responsavel: esquemaResponsavelInternacao.optional(),
    observacao: livre(400).optional(),
    /** M44: a solicitação de leito do NIR atendida por esta admissão (o leito reservado para ela; mesma gravação). */
    solicitacaoNir: id.optional(),
  })
  .strict()
  .superRefine((e, ctx) => {
    if (e.origem === 'pa' && !e.atendimentoOrigem)
      ctx.addIssue({
        code: 'custom',
        path: ['atendimentoOrigem'],
        message: 'Informe o atendimento do pronto atendimento de onde o paciente vem.',
      });
    if (e.origem === 'cirurgia' && !e.cirurgia)
      ctx.addIssue({ code: 'custom', path: ['cirurgia'], message: 'Informe a cirurgia agendada.' });
    if (e.cidSecundario && e.cidSecundario === e.cidPrincipal)
      ctx.addIssue({
        code: 'custom',
        path: ['cidSecundario'],
        message: 'O CID secundário é diferente do principal.',
      });
  });
export type InternarEntrada = z.infer<typeof esquemaInternar>;

// ── internacao.transferirLeito ────────────────────────────────────────────────────────────────────

export const esquemaTransferirLeito = z
  .object({
    internacao: esquemaRegInternacao,
    destino: esquemaChaveLeito,
    /** Carimbo da internação lido pela tela (controle otimista contra o outro sistema). */
    versao: z.string().min(10).max(30),
    justificativa: livre(80).optional(),
    /** M44: a solicitação de leito do NIR atendida por esta transferência (o leito reservado para ela). */
    solicitacaoNir: id.optional(),
  })
  .strict();
export type TransferirLeitoEntrada = z.infer<typeof esquemaTransferirLeito>;

// ── internacao.darAlta (a saída, alta administrativa) ─────────────────────────────────────────────

export const esquemaDarAlta = z
  .object({
    internacao: esquemaRegInternacao,
    /** Motivo de alta do cadastro (grupo pela regra 6). */
    motivo: smallint.refine((m) => m > 0, 'Informe o motivo da alta.'),
    /** Médico que deu a alta (vínculo; vem da alta médica registrada). */
    medicoAlta: id,
    /** Hora da saída ("HH:MM", no fuso do estabelecimento) dentro do dia de hoje; sem ela, a hora do banco. */
    horaSaida: esquemaHora.optional(),
    versao: z.string().min(10).max(30),
  })
  .strict();
export type DarAltaEntrada = z.infer<typeof esquemaDarAlta>;

/** A alta médica (decisão, hora, médico) no novo: o legado tem um só momento, a saída. */
export const esquemaRegistrarAltaMedica = z
  .object({
    internacao: esquemaRegInternacao,
    motivo: smallint.refine((m) => m > 0, 'Informe o motivo da alta.'),
    destino: z.enum(CODIGOS_DESTINO_ALTA),
    /** O sumário de alta do prontuário eletrônico ligado (M23), quando já finalizado. */
    sumarioAlta: id.optional(),
    previsaoSaida: esquemaHora.optional(),
    observacao: livre(200).optional(),
  })
  .strict();
export type RegistrarAltaMedicaEntrada = z.infer<typeof esquemaRegistrarAltaMedica>;

export const esquemaCancelarAltaMedica = z
  .object({ internacao: esquemaRegInternacao, motivo: livre(200).pipe(z.string().min(5)) })
  .strict();

// ── internacao.preInternar e o saneamento ─────────────────────────────────────────────────────────

export const esquemaPreInternar = z
  .object({
    paciente: id,
    /** Data prevista (plausível: de 2000 a dois anos à frente); sem ela, a fila de espera com a data nula. */
    dataPrevista: esquemaDataIso.optional(),
    horaPrevista: esquemaHora.optional(),
    convenio: smallint.refine((c) => c > 0, 'Informe o convênio.'),
    /** O plano do convênio, pelo código ou pela descrição do cadastro; sem casamento, a gravação é recusada (422). */
    plano: maiusculas(40).pipe(z.string().min(1, 'Informe o plano.')),
    matricula: livre(24).optional(),
    validadeCarteira: esquemaDataIso.optional(),
    senhaConvenio: livre(20).optional(),
    especialidade: smallint.refine((e) => e > 0, 'Informe a especialidade.'),
    /** A clínica assistencial (id do cadastro de clínicas), sem valor padrão. */
    clinica: id,
    carater: z.enum(CODIGOS_CARATER_INTERNACAO).default('eletivo'),
    medicoSolicitante: id,
    medicoAssistente: id.optional(),
    /** O procedimento previsto, pelo código (item faturável ou tabela do SUS); ausente quando ainda não definido. */
    procedimento: z.number().int().positive().max(9_999_999_999).optional(),
    /** Diárias previstas (0, 1, 2 e 4 vistas). */
    diariasPrevistas: z.number().int().min(0).max(99).default(1),
    /** O código do CID-10 provável; código fora da terminologia é recusado (422). */
    cid: livre(6).optional(),
    /** Acomodação desejada (o mapa), pelos códigos do bloco e da acomodação; sem leito definido. */
    acomodacao: z
      .object({
        bloco: z.string().trim().max(30),
        acomodacao: z.string().trim().min(1).max(30),
      })
      .strict()
      .optional(),
    /** A cirurgia agendada do mesmo paciente que motiva a internação. */
    cirurgia: id.optional(),
    observacao: livre(400).optional(),
  })
  .strict()
  .superRefine((e, ctx) => {
    if (e.dataPrevista && dataPrevistaPlausivel(e.dataPrevista, hojeIsoUtc()) === 'impossivel')
      ctx.addIssue({
        code: 'custom',
        path: ['dataPrevista'],
        message: 'Data prevista fora do plausível: sem data, deixe em branco.',
      });
  });
export type PreInternarEntrada = z.infer<typeof esquemaPreInternar>;

export const esquemaCorrigirPreInternacao = z
  .object({
    paciente: id,
    dataPrevista: esquemaDataIso.optional(),
    /** A versão do agendamento que a tela leu (controle otimista). */
    versao: z.number().int().positive(),
  })
  .strict();
export type CorrigirPreInternacaoEntrada = z.infer<typeof esquemaCorrigirPreInternacao>;

const hojeIsoUtc = () => new Date().toISOString().slice(0, 10);
/** Ano mínimo e máximo plausíveis da data prevista: a entrada recusa fora disso; a lista marca o dado antigo. */
export function dataPrevistaPlausivel(iso: string | null, hojeIso: string): 'ok' | 'sem-data' | 'impossivel' {
  if (iso === null) return 'sem-data';
  const ano = Number(iso.slice(0, 4));
  const hoje = Number(hojeIso.slice(0, 4));
  if (ano < 2000 || ano > hoje + 2) return 'impossivel';
  return 'ok';
}

// ── Trocas e guias ────────────────────────────────────────────────────────────────────────────────

export const esquemaTrocarConvenio = z
  .object({
    internacao: esquemaRegInternacao,
    convenio: smallint.refine((c) => c > 0, 'Informe o convênio.'),
    versao: z.string().min(10).max(30),
  })
  .strict();
export type TrocarConvenioEntrada = z.infer<typeof esquemaTrocarConvenio>;

export const esquemaTrocarClinica = z
  .object({
    internacao: esquemaRegInternacao,
    clinica: z.enum(CODIGOS_CLINICA_INTERNACAO),
    versao: z.string().min(10).max(30),
  })
  .strict();
export type TrocarClinicaEntrada = z.infer<typeof esquemaTrocarClinica>;

export const esquemaTrocarEspecialidade = z
  .object({
    internacao: esquemaRegInternacao,
    especialidade: smallint.refine((e) => e > 0, 'Informe a especialidade.'),
    versao: z.string().min(10).max(30),
  })
  .strict();
export type TrocarEspecialidadeEntrada = z.infer<typeof esquemaTrocarEspecialidade>;

export const esquemaTrocarMedico = z
  .object({
    internacao: esquemaRegInternacao,
    /** O tipo da troca como o legado guarda: só o solicitante (S) foi visto (2 de 2); o assistente (A) é recusado. */
    tipo: z.enum(['A', 'S']).default('S'),
    medico: id,
    versao: z.string().min(10).max(30),
  })
  .strict();
export type TrocarMedicoEntrada = z.infer<typeof esquemaTrocarMedico>;

export const esquemaRegistrarGuia = z
  .object({
    internacao: esquemaRegInternacao,
    /**
     * A conta (parcial) da internação a que a guia pertence: a guia começa no início da conta (660 de 660 guias
     * registradas de 2025-10 a 2026-07); a conta parcial é aberta pelo faturamento.
     */
    conta: z.number().int().positive(),
    guia: livre(20).pipe(z.string().min(1, 'Informe o número da guia.')),
    senha: livre(20).optional(),
    /**
     * Dias autorizados (o legado guarda a validade em dias e a data final = início + validade em 100%; as colunas de
     * diárias solicitadas e autorizadas ficam 0, como em 100% das guias).
     */
    validadeDias: z.number().int().min(1).max(999),
    /** F3.4 (04-INT 68): início da validade (AAAA-MM-DD); sem ele, a entrada (inicial) ou o dia seguinte ao fim da anterior. */
    inicio: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a data no formato AAAA-MM-DD.')
      .optional(),
    /** Quem autorizou na operadora. */
    autorizador: livre(150).optional(),
    observacao: livre(400).optional(),
  })
  .strict();
export type RegistrarGuiaEntrada = z.infer<typeof esquemaRegistrarGuia>;

// ── Supervisor: cancelar a alta e excluir a internação ────────────────────────────────────────────

export const esquemaCancelarAlta = z
  .object({
    internacao: esquemaRegInternacao,
    justificativa: livre(255).refine((t) => t.length >= 10, 'Justifique com pelo menos 10 caracteres.'),
  })
  .strict();
export type CancelarAltaEntrada = z.infer<typeof esquemaCancelarAlta>;

export const esquemaExcluirInternacao = z
  .object({
    internacao: esquemaRegInternacao,
    /** Motivo do cadastro de motivos de cancelamento (vazio na cópia: o legado grava nulo em 30 de 30; opcional). */
    motivo: z.number().int().positive().optional(),
    justificativa: livre(80).refine((t) => t.length >= 10, 'Justifique com pelo menos 10 caracteres.'),
    /** Dupla confirmação: a pessoa viu o que será apagado (contas, guias, períodos e trocas). */
    confirmaApagarConta: z.literal(true),
    confirmaApagarPeriodos: z.literal(true),
  })
  .strict();
export type ExcluirInternacaoEntrada = z.infer<typeof esquemaExcluirInternacao>;

// ── Higienização ──────────────────────────────────────────────────────────────────────────────────

export const esquemaSolicitarLimpeza = z
  .object({
    leito: esquemaChaveLeito,
    /** Tipo de limpeza (cadastro de tipos; fica no novo: o legado grava vazio em 100%). */
    tipoLimpeza: smallint.refine((t) => t > 0, 'Informe o tipo de limpeza.'),
    origem: z.enum(ORIGENS_LIMPEZA).default('manual'),
    precaucao: z.enum(CODIGOS_PRECAUCAO).optional(),
    observacao: livre(200).optional(),
  })
  .strict();
export type SolicitarLimpezaEntrada = z.infer<typeof esquemaSolicitarLimpeza>;

export const esquemaAvancarLimpeza = z
  .object({
    solicitacao: id,
    /** Situação do legado pedida (só 2 grava: 3 e 4 nunca vistos, recusados). */
    situacao: z.number().int().min(1).max(4),
  })
  .strict();
export type AvancarLimpezaEntrada = z.infer<typeof esquemaAvancarLimpeza>;

export const esquemaLiberarLeito = z.object({ solicitacao: id }).strict();
export type LiberarLeitoEntrada = z.infer<typeof esquemaLiberarLeito>;

/** Etapa da higienização registrada no novo (atribuir, iniciar, pausar, concluir, inspecionar, liberar). */
export const esquemaEtapaLimpeza = z
  .object({
    solicitacao: id,
    etapa: z.enum(CODIGOS_ETAPA_LIMPEZA),
    profissional: smallint.optional(),
    /** Itens do checklist marcados (chaves do checklist do tipo de limpeza). */
    checklist: z
      .array(z.string().regex(/^[a-z][a-zA-Z0-9]{1,30}$/))
      .max(40)
      .optional(),
    /** Chave da foto no armazenamento de objetos local (nunca a imagem no banco). */
    foto: z
      .string()
      .regex(/^higienizacao\/[a-z0-9-]{8,80}\.(jpg|jpeg|png|webp)$/)
      .optional(),
    observacao: livre(200).optional(),
  })
  .strict();
export type EtapaLimpezaEntrada = z.infer<typeof esquemaEtapaLimpeza>;

// ── SAME ──────────────────────────────────────────────────────────────────────────────────────────

export const esquemaMovimentarProntuario = z
  .object({
    /** A conta do atendimento (o código de barras da etiqueta é a conta). */
    conta: z.number().int().positive(),
    operacao: z.number().int().min(1).max(6),
    setorOrigem: smallint.refine((s) => s > 0, 'Informe o setor de origem.'),
    setorDestino: smallint.refine((s) => s > 0, 'Informe o setor de destino.'),
    /** Quem retira ou recebe o volume (o nome que assina o protocolo). */
    responsavel: maiusculas(70).pipe(z.string().min(3, 'Informe o responsável.')),
    /** Motivo do cadastro de motivos do arquivo (saída, descarte e transferência; o registro e o recebimento sem). */
    motivo: smallint.refine((m) => m > 0).optional(),
    observacao: livre(400).optional(),
    /** Protocolo de remessa (a guia de várias contas) e o prazo de devolução, no novo. */
    protocolo: livre(30).optional(),
    prazoDevolucao: esquemaDataIso.optional(),
    /** Aval da comissão de revisão de prontuários (obrigatório no descarte: Lei 13.787/2018). */
    avalComissao: livre(60).optional(),
  })
  .strict()
  .superRefine((e, ctx) => {
    if (e.operacao === 4 && !e.avalComissao)
      ctx.addIssue({
        code: 'custom',
        path: ['avalComissao'],
        message: 'O descarte exige o aval da comissão de revisão de prontuários.',
      });
    if ([2, 4, 5].includes(e.operacao) && !e.motivo)
      ctx.addIssue({ code: 'custom', path: ['motivo'], message: 'Informe o motivo da movimentação.' });
    if (e.operacao !== 1 && e.setorOrigem === e.setorDestino && e.operacao !== 6)
      ctx.addIssue({
        code: 'custom',
        path: ['setorDestino'],
        message: 'A saída e a transferência vão para outro setor.',
      });
  });
export type MovimentarProntuarioEntrada = z.infer<typeof esquemaMovimentarProntuario>;

export const esquemaExcluirMovimento = z
  .object({
    movimento: z.number().int().positive(),
    motivo: livre(200).refine((t) => t.length >= 10, 'Justifique com pelo menos 10 caracteres.'),
  })
  .strict();
export type ExcluirMovimentoEntrada = z.infer<typeof esquemaExcluirMovimento>;

/**
 * O que o legado não guarda do SAME, gravado só no novo (SGH_HOT_SAME_EXT): a ocorrência (o recebimento do que não foi
 * enviado, com o motivo), o aceite da remessa por quem recebe (o movimento recebido, com o protocolo) e a cobrança da
 * devolução atrasada (o movimento que levou o volume para fora do SAME).
 */
export const TIPOS_REGISTRO_SAME = ['ocorrencia', 'aceite', 'cobranca'] as const;
export const esquemaRegistroSame = z
  .object({
    conta: z.number().int().positive(),
    tipo: z.enum(TIPOS_REGISTRO_SAME),
    movimento: z.number().int().positive().optional(),
    motivo: livre(200).optional(),
    protocolo: livre(30).optional(),
  })
  .strict()
  .superRefine((e, ctx) => {
    if (e.tipo === 'ocorrencia' && (e.motivo ?? '').trim().length < 5)
      ctx.addIssue({
        code: 'custom',
        path: ['motivo'],
        message: 'Descreva a ocorrência (pelo menos 5 caracteres).',
      });
    if (e.tipo !== 'ocorrencia' && e.movimento === undefined)
      ctx.addIssue({ code: 'custom', path: ['movimento'], message: 'Informe o movimento.' });
  });
export type RegistroSameEntrada = z.infer<typeof esquemaRegistroSame>;

// ── Leito no novo (bloqueio, precaução, atributos) ────────────────────────────────────────────────

export const esquemaBloquearLeito = z
  .object({
    leito: esquemaChaveLeito,
    estado: z.enum(['bloqueio', 'precaucao', 'extra']),
    motivo: z.enum(CODIGOS_MOTIVO_BLOQUEIO_LEITO).optional(),
    precaucao: z.enum(CODIGOS_PRECAUCAO).optional(),
    previsaoFim: esquemaDataIso.optional(),
    observacao: livre(200).optional(),
  })
  .strict()
  .superRefine((e, ctx) => {
    if (e.estado === 'bloqueio' && !e.motivo)
      ctx.addIssue({ code: 'custom', path: ['motivo'], message: 'Informe o motivo do bloqueio.' });
    if (e.estado === 'precaucao' && !e.precaucao)
      ctx.addIssue({ code: 'custom', path: ['precaucao'], message: 'Informe a precaução.' });
  });
export type BloquearLeitoEntrada = z.infer<typeof esquemaBloquearLeito>;

export const esquemaAtributoLeito = z
  .object({
    leito: esquemaChaveLeito,
    andar: z.number().int().min(-5).max(99).optional(),
    sexo: z.enum(['M', 'F', 'A']).default('A'),
    idadeMinima: z.number().int().min(0).max(130).optional(),
    idadeMaxima: z.number().int().min(0).max(130).optional(),
    criticidade: smallint.optional(),
    ramal: z.number().int().min(0).max(99_999).optional(),
    /** W0-07: obrigatório ao alterar atributos próprios que já existem (a gravação recusa 'motivo-obrigatorio'). */
    motivo: textoCp1252(300).optional(),
  })
  .strict();
export type AtributoLeitoEntrada = z.infer<typeof esquemaAtributoLeito>;

// ── Regras puras do legado que a gravação reproduz (o domínio da internação as reexporta) ─────────

/** Hora em que a diária vence (a saída às 12h ou depois conta mais uma diária; regra 5). */
export const HORA_CORTE_DIARIA = '12:00';

/**
 * Diárias faturáveis (PERMANEN, regra 5), como o legado grava na saída: a diferença de dias entre a entrada e a
 * saída, mais uma quando a saída é às 12h ou depois; no mínimo 1 (entrada e saída no mesmo dia). Medido na cópia pc:
 * 1.316 de 1.322 altas de 2025-10 a 2026-07. Não é a permanência da Portaria 312 (essa é calculada à parte).
 */
export function diariasFaturaveis(entradaIso: string, saidaIso: string, horaSaida: string): number {
  const dias = Math.round(
    (Date.parse(`${saidaIso}T00:00:00Z`) - Date.parse(`${entradaIso}T00:00:00Z`)) / 86_400_000,
  );
  if (!Number.isFinite(dias) || dias <= 0) return 1;
  // A hora da saída é "HH:MM"; a comparação é pelos dígitos, para valer também enquanto algum chamador manda sem os
  // dois-pontos.
  const digitos = (h: string) => h.replace(':', '').padStart(4, '0');
  return dias + (digitos(horaSaida) >= digitos(HORA_CORTE_DIARIA) ? 1 : 0);
}

// ── Entradas só da API (impressos, desbloqueio, foto) ─────────────────────────────────────────────

/** Impressos da internação: a ficha (PDF), a pulseira e a etiqueta (ZPL na fila da impressora da estação). */
export const IMPRESSOS_INTERNACAO = [
  { codigo: 'ficha', rotulo: 'Ficha de internação', formatos: ['pdf'] },
  { codigo: 'pulseira', rotulo: 'Pulseira de identificação', formatos: ['zpl'] },
  { codigo: 'etiqueta', rotulo: 'Etiqueta do prontuário', formatos: ['zpl'] },
] as const;
export const CODIGOS_IMPRESSO_INTERNACAO = ['ficha', 'pulseira', 'etiqueta'] as const;

export const esquemaEmitirImpressoInternacao = z
  .object({
    internacao: esquemaRegInternacao,
    impresso: z.enum(CODIGOS_IMPRESSO_INTERNACAO),
    formato: z.enum(['zpl', 'pdf']),
    copias: z.number().int().min(1).max(10).default(1),
    /** A ficha configurada (modelo das fichas a imprimir da internação): o PDF sai com o nome do modelo. */
    modelo: z.number().int().positive().max(32_767).optional(),
    /** Reimpressão da pulseira ou da etiqueta (01-ADM L79): motivo do catálogo, complemento e estação escolhida. */
    motivo: z.number().int().positive().optional(),
    complemento: z.string().trim().max(500).optional(),
    estacao: z.number().int().positive().optional(),
  })
  .strict();
export type EmitirImpressoInternacaoEntrada = z.infer<typeof esquemaEmitirImpressoInternacao>;

/** A etiqueta do leito com o QR code da solicitação de limpeza (ZPL na fila da impressora da estação). */
export const esquemaEmitirEtiquetaLeito = z
  .object({ leito: esquemaChaveLeito, copias: z.number().int().min(1).max(10).default(1) })
  .strict();
export type EmitirEtiquetaLeitoEntrada = z.infer<typeof esquemaEmitirEtiquetaLeito>;

/** Encerra um estado só do novo do leito (desbloquear, tirar a precaução, retirar o leito extra). */
export const esquemaEncerrarEstadoLeito = z
  .object({ leito: esquemaChaveLeito, estado: z.enum(['bloqueio', 'precaucao', 'extra']) })
  .strict();
export type EncerrarEstadoLeitoEntrada = z.infer<typeof esquemaEncerrarEstadoLeito>;

/** Foto da limpeza: a imagem em base64 (JPEG, PNG ou WEBP; até 1,5 MB) vai ao armazenamento de objetos local. */
export const esquemaFotoHigienizacao = z
  .object({
    solicitacao: id,
    tipo: z.enum(['image/jpeg', 'image/png', 'image/webp']),
    conteudo: z
      .string()
      .min(16)
      .max(2_100_000)
      .regex(/^[A-Za-z0-9+/=]+$/),
  })
  .strict();
export type FotoHigienizacaoEntrada = z.infer<typeof esquemaFotoHigienizacao>;
