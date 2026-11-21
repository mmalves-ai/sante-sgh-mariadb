// Contratos do painel de leitos ao vivo, da divergência de cadastro e do censo diário (M16; ficha, seções 4, 7 e
// 8). Tudo é LIDO ao vivo do banco do estabelecimento (as tabelas de leito e internação são pequenas); o censo
// fechado fica no retrato próprio do sistema. Nenhum nome de tabela nem coluna do banco sai daqui (fronteira).
// Regra 16: o cartão do leito leva só iniciais, idade, sexo, dias de internação e convênio; o nome só ao abrir o
// cartão, com a permissão do cadastro de pacientes, e a abertura vai à trilha. CPF e nome da reserva nunca saem.
import { z } from 'zod';
import { GRUPOS_MOTIVO_ALTA, type GrupoMotivoAlta } from '../legendas/legendas.js';

// ── Parâmetros e chaves ───────────────────────────────────────────────────────────────────────────────

/** Tipos de acomodação de terapia intensiva (regra 4; parâmetro `internacao.acomodacao.intensiva`). */
export const TIPOS_INTENSIVA_PADRAO = [3, 7, 8, 9, 17] as const;

/** Hora de fechamento padrão do censo (1 a 24; 24 = meia-noite, fim do dia; regra 7). */
export const HORA_FECHAMENTO_PADRAO = 24;

/** Chaves de liberação do M16 (ficha, seção 12): recolher = desligar por estabelecimento. */
export const CHAVES_LIBERACAO_M16 = {
  painel: 'internacao.leitos.painel',
  paineis: 'relatorio.paineis',
  fechamento: 'internacao.censo.fechamento',
  bi: 'relatorio.bi',
} as const;

// ── Painel de leitos ──────────────────────────────────────────────────────────────────────────────────

export const SITUACOES_LEITO = ['livre', 'ocupado', 'inativo'] as const;
export type SituacaoLeito = (typeof SITUACOES_LEITO)[number];

const tipoAcomodacao = z.object({ id: z.number().int(), nome: z.string() });

export const esquemaCartaoPaciente = z.object({
  /** Número da internação (identificador da internação; não é dado da pessoa). */
  internacao: z.number().int().positive(),
  iniciais: z.string().max(8),
  idade: z.number().int().min(0).nullable(),
  sexo: z.enum(['M', 'F']).nullable(),
  diasInternacao: z.number().int().min(0),
  convenio: z.string().nullable(),
  /** Tipo de acomodação do trecho em curso (regra 4: a terapia intensiva pelo tipo do trecho). */
  tipoTrecho: tipoAcomodacao.nullable(),
  intensivo: z.boolean(),
});
export type CartaoPaciente = z.infer<typeof esquemaCartaoPaciente>;

export const esquemaLeitoPainel = z.object({
  id: z.number().int(),
  leito: z.string(),
  situacao: z.enum(SITUACOES_LEITO),
  ramal: z.number().int().nullable(),
  cartao: esquemaCartaoPaciente.nullable(),
});
export type LeitoPainel = z.infer<typeof esquemaLeitoPainel>;

const totaisLeitos = z.object({
  leitos: z.number().int(),
  ativos: z.number().int(),
  inativos: z.number().int(),
  ocupados: z.number().int(),
  livres: z.number().int(),
});

export const esquemaAcomodacaoPainel = z.object({
  acomodacao: z.string(),
  nome: z.string(),
  tipo: tipoAcomodacao.nullable(),
  intensiva: z.boolean(),
  totais: totaisLeitos,
  leitos: z.array(esquemaLeitoPainel),
});

export const TIPOS_AVISO_OCUPACAO = [
  'leito-ocupado-sem-internacao',
  'internacao-sem-leito-ocupado',
  'leito-com-outra-internacao',
  'leito-inativo-ocupado',
] as const;
export type TipoAvisoOcupacao = (typeof TIPOS_AVISO_OCUPACAO)[number];

export const esquemaAvisoOcupacao = z.object({
  tipo: z.enum(TIPOS_AVISO_OCUPACAO),
  /** Chave natural do leito (bloco/acomodação/leito) ou o número da internação. */
  chave: z.string(),
  mensagem: z.string(),
});
export type AvisoOcupacao = z.infer<typeof esquemaAvisoOcupacao>;

export const esquemaPainelLeitos = z.object({
  /** Momento da leitura (ISO) e o último ciclo do vigia que a disparou ("dados até", regra 14). */
  lidoEm: z.string(),
  dadosAte: z.string(),
  destino: z.enum(['banco', 'memoria']),
  totais: totaisLeitos.extend({
    /** Ocupados ÷ ativos (%), uma casa; null sem leito ativo. */
    ocupacao: z.number().nullable(),
    intensivos: totaisLeitos,
  }),
  blocos: z.array(
    z.object({
      bloco: z.string(),
      nome: z.string(),
      totais: totaisLeitos,
      acomodacoes: z.array(esquemaAcomodacaoPainel),
    }),
  ),
  /** Regra 1: diferença entre a ocupação do leito e as internações em aberto (aviso, nunca correção). */
  avisos: z.array(esquemaAvisoOcupacao),
});
export type PainelLeitos = z.infer<typeof esquemaPainelLeitos>;

/** Abertura do cartão (regra 16): o nome, com a permissão do cadastro; vai à trilha. */
export const esquemaPacienteDoLeito = z.object({
  internacao: z.number().int().positive(),
  nome: z.string(),
  entrada: z.string(),
  convenio: z.string().nullable(),
  clinica: z.string().nullable(),
});
export type PacienteDoLeito = z.infer<typeof esquemaPacienteDoLeito>;

// ── Liberação (o menu esconde o que está desligado) ──────────────────────────────────────────────────

export const esquemaLiberacaoM16 = z.object({
  painel: z.boolean(),
  paineis: z.boolean(),
  fechamento: z.boolean(),
  bi: z.boolean(),
  motivos: z.record(z.string(), z.string()),
});
export type LiberacaoM16 = z.infer<typeof esquemaLiberacaoM16>;

// ── Divergência de cadastro de leitos (regra 2) ──────────────────────────────────────────────────────

export const esquemaDivergenciasLeitos = z.object({
  lidoEm: z.string(),
  destino: z.enum(['banco', 'memoria']),
  divergencias: z.array(z.object({ tipo: z.string(), chave: z.string(), orientacao: z.string() })),
  contagens: z.object({
    leitosCadastro: z.number().int(),
    leitosEspelho: z.number().int(),
    leitosEspelhoExterno: z.number().int(),
    acomodacoesCadastro: z.number().int(),
    acomodacoesEspelho: z.number().int(),
    acomodacoesEspelhoExterno: z.number().int(),
    iguais: z.number().int(),
  }),
  porTipo: z.record(z.string(), z.number().int()),
  /** Retratos guardados do registro de conferência (só a quantidade; limitação do leito-dia, regra 10). */
  retratos: z.number().int(),
});
export type DivergenciasLeitos = z.infer<typeof esquemaDivergenciasLeitos>;

// ── Censo diário (regras 3, 5, 7 e 8) ────────────────────────────────────────────────────────────────

// Grupos do motivo de alta (regra 8): os do M14 (legendas/legendas.ts, grupoMotivoAlta), um só para o sistema.

const altasPorGrupo = z.object(
  Object.fromEntries(GRUPOS_MOTIVO_ALTA.map((g) => [g, z.number().int().min(0)])) as Record<
    GrupoMotivoAlta,
    z.ZodNumber
  >,
);

export const esquemaLinhaCenso = z.object({
  bloco: z.string(),
  acomodacao: z.string(),
  nome: z.string(),
  tipo: tipoAcomodacao,
  intensiva: z.boolean(),
  internados: z.number().int().min(0),
  admissoes: z.number().int().min(0),
  altas: altasPorGrupo,
  /** Saídas = soma das altas de todos os grupos (inclui os óbitos). */
  saidas: z.number().int().min(0),
  obitos: z.number().int().min(0),
  transferenciasEntrada: z.number().int().min(0),
  transferenciasSaida: z.number().int().min(0),
  leitosOperacionais: z.number().int().min(0),
});
export type LinhaCenso = z.infer<typeof esquemaLinhaCenso>;

export const SITUACOES_CENSO = ['aberto', 'fechado', 'calculado'] as const;
export type SituacaoCenso = (typeof SITUACOES_CENSO)[number];

export const esquemaCensoDia = z.object({
  data: z.iso.date(),
  /** aberto: o dia corrente; fechado: retrato guardado; calculado: dia passado calculado na hora. */
  situacao: z.enum(SITUACOES_CENSO),
  horaFechamento: z.number().int().min(1).max(24),
  versaoCalculo: z.number().int(),
  geradoEm: z.string().nullable(),
  linhas: z.array(esquemaLinhaCenso),
  totais: esquemaLinhaCenso.omit({ bloco: true, acomodacao: true, nome: true, tipo: true, intensiva: true }),
  /** Internações marcadas no cálculo (alta anterior à entrada, trecho sem internação…): só contagens. */
  marcas: z.record(z.string(), z.number().int()),
  dadosAte: z.string(),
  /** Último dia com movimento de internação (AAAA-MM-DD): mais de 2 dias atrás, a tela avisa. */
  ultimoMovimento: z.string().nullable(),
});
export type CensoDia = z.infer<typeof esquemaCensoDia>;

/**
 * Relatório das internações marcadas no cálculo (regra 5), para o arquivo médico conferir e corrigir: o número da
 * internação e o tipo da marca, nunca o nome nem outro dado do paciente.
 */
export const esquemaInternacoesMarcadas = z.object({
  casos: z.array(z.object({ internacao: z.number().int(), marca: z.string() })),
  /** Contagem por marca (inclui a diferença das transferências, que não tem caso). */
  marcas: z.record(z.string(), z.number().int()),
  dadosAte: z.string(),
});
export type InternacoesMarcadas = z.infer<typeof esquemaInternacoesMarcadas>;

export const esquemaPeriodoCenso = z.object({
  periodo: z.string(),
  dias: z.number().int().min(0),
  pacientesDia: z.number().int().min(0),
  admissoes: z.number().int().min(0),
  saidas: z.number().int().min(0),
  obitos: z.number().int().min(0),
  transferenciasEntrada: z.number().int().min(0),
  leitosDia: z.number().int().min(0),
  parcial: z.boolean(),
});
export type PeriodoCenso = z.infer<typeof esquemaPeriodoCenso>;

export const esquemaSerieCenso = z.object({
  agrupamento: z.enum(['dia', 'mes']),
  de: z.iso.date(),
  ate: z.iso.date(),
  periodos: z.array(esquemaPeriodoCenso),
  dadosAte: z.string(),
  /** Último dia com movimento de internação (AAAA-MM-DD): mais de 2 dias atrás, a tela avisa. */
  ultimoMovimento: z.string().nullable(),
});
export type SerieCenso = z.infer<typeof esquemaSerieCenso>;

export const esquemaConsultaSerieCenso = z
  .object({
    de: z.iso.date(),
    ate: z.iso.date(),
    agrupamento: z.enum(['dia', 'mes']).default('mes'),
  })
  .strict();
