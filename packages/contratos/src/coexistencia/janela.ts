// Janela em produção, verificação depois dela e retirada da restrição de entrada, por hospital (M58-F5; ficha do M58,
// seções 2, 5, 8 a 12; cap-10 §10.13; cap-09 §9.15). A execução em produção é da TI do hospital, com autorização do
// dono; a IA nunca conecta à produção (convencoes.md §1, regra 5). Aqui ficam:
//   - o roteiro da janela de cada passo (desligamento, Firebird 5, UTF-8): etapas em ordem, fase, papel responsável,
//     comando técnico (sem senha nem endereço), tempo estimado pelo ensaio da cópia e o critério de cada etapa;
//   - o relatório da verificação depois da janela (docs/marcos/M58/<h>/janela.json), gravado pelo comando
//     `pnpm janela:verificar`, que a TI roda na produção (ou o construtor roda na cópia, como ensaio do roteiro):
//     impressão do schema, plataforma, contagens por tabela antes e depois, saúde das conexões e operações-chave;
//   - a retirada da restrição de entrada (`entrada.utf8`): só depois do UTF-8 executado e verificado (regra 6).
//
// Só estrutura, tempos, números e nomes de objeto: nenhum dado de linha, nenhum login, nenhuma senha. Os ids ficam
// aqui; os textos da tela ficam no i18n da web (ADR 0023).
import { z } from 'zod';
import { RE_TEXTO_SEM_DADO_PESSOAL } from '../homologacao/homologacao.js';
import { CHARSETS_LEGADO, PASSOS_DESLIGAMENTO } from './desligamento.js';
import { TETO_NOMES_ENSAIO } from './ensaio-firebird5.js';

// ── Roteiro da janela ─────────────────────────────────────────────────────────────────────────────────────

/** As fases do roteiro, na ordem em que acontecem; a volta atrás vale só até a reabertura (regra 12). */
export const FASES_ROTEIRO_JANELA = [
  'antes',
  'parada',
  'execucao',
  'verificacao',
  'reabertura',
  'volta-atras',
] as const;
export type FaseRoteiroJanela = (typeof FASES_ROTEIRO_JANELA)[number];

/** Quem responde por cada etapa (papéis, nunca pessoas; ficha, seção 13). */
export const RESPONSAVEIS_JANELA = [
  'dono',
  'ti',
  'coordenacao',
  'chave-usuarios',
  'hal-ai',
  'parceiros',
] as const;
export type ResponsavelJanela = (typeof RESPONSAVEIS_JANELA)[number];

/** As etapas possíveis de um roteiro (ids estáveis; o texto de cada uma fica no i18n). */
export const ETAPAS_ROTEIRO_JANELA = [
  // antes
  'confirmar-autorizacao',
  'conferir-sessoes',
  'avisar-areas',
  'avisar-parceiros',
  'avisar-hal-ai',
  'treinar-contingencia',
  'contar-antes',
  // parada
  'encerrar-sessoes',
  'parar-acesso',
  // execução
  'retirar-executaveis',
  'parar-servicos-fornecedor',
  'revogar-contas-fornecedor',
  'backup',
  'instalar-motor',
  'habilitar-funcoes-externas',
  'restaurar',
  'integridade',
  'converter',
  'definir-charset',
  // verificação
  'verificar',
  'operacoes-chave',
  // reabertura
  'reabrir',
  'registrar-execucao',
  'retirar-restricao',
  // volta atrás
  'religar-contingencia',
  'restaurar-backup-anterior',
] as const;
export type EtapaRoteiroJanela = (typeof ETAPAS_ROTEIRO_JANELA)[number];

export const esquemaEtapaRoteiro = z
  .object({
    etapa: z.enum(ETAPAS_ROTEIRO_JANELA),
    ordem: z.number().int().positive(),
    fase: z.enum(FASES_ROTEIRO_JANELA),
    responsavel: z.enum(RESPONSAVEIS_JANELA),
    /** O comando técnico, com o hospital no lugar; nunca senha, endereço ou caminho de produção. */
    comando: z.string().max(200).nullable(),
    /** Minutos estimados pelo ensaio (com a margem); null quando o ensaio não mediu a etapa. */
    minutos: z.number().int().positive().nullable(),
    /** A etapa para a janela se falhar: vale a volta atrás (antes da reabertura). */
    critica: z.boolean(),
  })
  .strict();
export type EtapaRoteiro = z.infer<typeof esquemaEtapaRoteiro>;

/** Os tempos medidos nos ensaios da cópia que o roteiro usa (segundos; null quando não medidos). */
export interface TemposEnsaioJanela {
  readonly backupS: number | null;
  readonly restauracaoS: number | null;
  readonly integridadeS: number | null;
  readonly voltaAtrasS: number | null;
  readonly conversaoS: number | null;
  readonly equivalenciaS: number | null;
  readonly contagensS: number | null;
}

// ── Verificação depois da janela (docs/marcos/M58/<h>/janela.json) ──────────────────────────────────────

/** Onde a verificação rodou: na produção (TI, depois da janela) ou na cópia (ensaio do roteiro, pelo construtor). */
export const AMBIENTES_VERIFICACAO_JANELA = ['producao', 'ensaio'] as const;
export type AmbienteVerificacaoJanela = (typeof AMBIENTES_VERIFICACAO_JANELA)[number];

/** As checagens da prova pós-janela (ficha, seção 5: schema, contagens, saúde, operações-chave; mais a plataforma). */
export const CHECAGENS_JANELA = ['plataforma', 'schema', 'contagens', 'saude', 'operacoes'] as const;
export type ChecagemJanela = (typeof CHECAGENS_JANELA)[number];

export const SITUACOES_CHECAGEM_JANELA = ['aprovada', 'reprovada', 'nao-executada'] as const;
export type SituacaoChecagemJanela = (typeof SITUACOES_CHECAGEM_JANELA)[number];

/** Achados que reprovam uma checagem (códigos estáveis; o texto fica no i18n). */
export const ACHADOS_JANELA = [
  'motor-diferente-do-alvo',
  'charset-diferente-do-alvo',
  'charset-desencontrado',
  'sem-impressao-homologada',
  'impressao-diferente',
  'sem-contagem-antes',
  'contagens-diferentes',
  'tabelas-ausentes',
  'conexao-falhou',
  'latencia-alta',
  'codec-desencontrado',
  'operacoes-com-falha',
  'sem-operacoes',
  'nao-executada',
] as const;
export type AchadoJanela = (typeof ACHADOS_JANELA)[number];

const texto = z.string().regex(RE_TEXTO_SEM_DADO_PESSOAL, 'texto sem dado pessoal (até 600 caracteres)');
const nomeObjeto = z.string().regex(/^[A-Z][A-Z0-9_$]{0,62}$/);
const nomes = z.array(nomeObjeto).max(TETO_NOMES_ENSAIO);
/** Id de operação do catálogo (`modulo.operacao`). */
const operacao = z.string().regex(/^[a-z][a-zA-Z0-9]*\.[a-zA-Z][a-zA-Z0-9]*$/);
const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const n = z.number().int().nonnegative();
const instante = z.iso.datetime();

/** Latência máxima aceita na saúde das conexões depois da janela (ms; a mesma régua da saúde do M37). */
export const LATENCIA_MAXIMA_JANELA_MS = 2000;

export const esquemaVerificacaoJanela = z
  .object({
    passo: z.enum(PASSOS_DESLIGAMENTO),
    ambiente: z.enum(AMBIENTES_VERIFICACAO_JANELA),
    em: instante,
    /** Início e fim da janela (parada e reabertura), quando a TI os anota; no ensaio, os do roteiro ensaiado. */
    inicio: instante.nullable().default(null),
    fim: instante.nullable().default(null),
    /** Papel de quem rodou (nunca nome de pessoa). */
    papel: z.enum(RESPONSAVEIS_JANELA),
    plataforma: z
      .object({
        versaoMotor: z.string().max(40),
        charsetBanco: z.string().max(40),
        charsetParametro: z.enum(CHARSETS_LEGADO),
      })
      .strict()
      .nullable(),
    schema: z
      .object({
        /** Resumo (16 caracteres) da impressão homologada no ensaio do passo e da obtida depois da janela. */
        esperada: z.string().max(64).nullable(),
        obtida: z.string().max(64).nullable(),
        diferencas: n,
      })
      .strict()
      .nullable(),
    contagens: z
      .object({
        tabelas: n,
        iguais: n,
        /** Nomes das tabelas com contagem diferente ou ausentes depois (só nomes; teto). */
        diferentes: nomes,
        ausentes: nomes,
        /**
         * As diferenças que o próprio roteiro do passo faz (lista explícita por passo, nunca curinga; o domínio
         * reconfere cada uma pela faixa declarada): a tabela e quantas linhas a mais tem depois.
         */
        esperadas: z
          .array(z.object({ tabela: nomeObjeto, delta: z.number().int() }).strict())
          .max(TETO_NOMES_ENSAIO)
          .default([]),
        /** SHA-256 da lista "TABELA=linhas" ordenada, antes (no início da parada) e depois. */
        hashAntes: sha256.nullable(),
        hashDepois: sha256.nullable(),
      })
      .strict()
      .nullable(),
    saude: z
      .object({
        conectou: z.boolean(),
        latenciaMs: n.nullable(),
        /** O codec do adaptador (legado.charset) casa com o catálogo do banco (regra 6). */
        codecConfere: z.boolean(),
      })
      .strict()
      .nullable(),
    operacoes: z
      .object({
        /** As operações-chave executadas pelos chave-usuários em modo de verificação, por id do catálogo. */
        total: n,
        verdes: n,
        falhas: z.array(operacao).max(TETO_NOMES_ENSAIO),
      })
      .strict()
      .nullable(),
    observacao: texto.nullable().default(null),
  })
  .strict()
  .superRefine(({ contagens, operacoes, inicio, fim }, ctx) => {
    if (contagens && contagens.iguais > contagens.tabelas)
      ctx.addIssue({ code: 'custom', path: ['contagens', 'iguais'], message: 'iguais acima do total' });
    if (operacoes && operacoes.verdes > operacoes.total)
      ctx.addIssue({ code: 'custom', path: ['operacoes', 'verdes'], message: 'verdes acima do total' });
    if (inicio && fim && inicio > fim)
      ctx.addIssue({ code: 'custom', path: ['fim'], message: 'fim antes do início' });
  });
export type VerificacaoJanela = z.infer<typeof esquemaVerificacaoJanela>;

export const esquemaRelatorioJanela = z
  .object({
    formato: z.literal(1),
    estabelecimento: z.string().regex(/^[a-z][a-z0-9]{0,9}$/),
    /** As verificações, na ordem em que rodaram (a mais recente de cada passo e ambiente é a que vale). */
    verificacoes: z.array(esquemaVerificacaoJanela).max(60),
  })
  .strict();
export type RelatorioJanela = z.infer<typeof esquemaRelatorioJanela>;

export const caminhoRelatorioJanela = (estabelecimento: string): string =>
  `docs/marcos/M58/${estabelecimento}/janela.json`;

// ── Retirada da restrição de entrada (regra 6; ficha, seção 12) ─────────────────────────────────────────

/** O que impede ligar `entrada.utf8` no hospital (códigos estáveis; o texto fica no i18n). */
export const MOTIVOS_RETIRADA_RESTRICAO = [
  'utf8-nao-autorizado',
  'utf8-nao-executado',
  'verificacao-ausente',
  'verificacao-reprovada',
  'banco-nao-utf8',
  'parametro-nao-utf8',
  'registro-invalido',
] as const;
export type MotivoRetiradaRestricao = (typeof MOTIVOS_RETIRADA_RESTRICAO)[number];

/** Código da recusa (409) ao ligar `entrada.utf8` antes da conversão verificada (tela de funcionalidades). */
export const CODIGO_ENTRADA_UTF8_SEM_CONVERSAO = 'entrada-utf8-sem-conversao';

export const SITUACOES_RETIRADA = ['restrita', 'pode-retirar', 'retirada'] as const;
export type SituacaoRetirada = (typeof SITUACOES_RETIRADA)[number];

// ── Resposta da API: GET administracao/coexistencia/desligamento/janela ─────────────────────────────────

export const esquemaChecagemJanelaAvaliada = z.object({
  checagem: z.enum(CHECAGENS_JANELA),
  situacao: z.enum(SITUACOES_CHECAGEM_JANELA),
  achados: z.array(z.enum(ACHADOS_JANELA)),
});
export type ChecagemJanelaAvaliada = z.infer<typeof esquemaChecagemJanelaAvaliada>;

export const esquemaVerificacaoJanelaAvaliada = z.object({
  ambiente: z.enum(AMBIENTES_VERIFICACAO_JANELA),
  em: instante,
  inicio: instante.nullable(),
  fim: instante.nullable(),
  /** Duração da janela medida (fim − início), em minutos; null sem as duas pontas. */
  duracaoMinutos: n.nullable(),
  checagens: z.array(esquemaChecagemJanelaAvaliada),
  aprovada: z.boolean(),
  /** Os números para a tela (sem nomes de pessoa): tabelas, iguais, operações. */
  numeros: z.object({
    tabelas: n,
    tabelasIguais: n,
    operacoes: n,
    operacoesVerdes: n,
    latenciaMs: n.nullable(),
  }),
  versaoMotor: z.string().nullable(),
  charsetBanco: z.string().nullable(),
});
export type VerificacaoJanelaAvaliada = z.infer<typeof esquemaVerificacaoJanelaAvaliada>;

export const esquemaJanelaDoPasso = z.object({
  passo: z.enum(PASSOS_DESLIGAMENTO),
  autorizado: z.boolean(),
  executado: z.boolean(),
  /** O ensaio do passo aprovado no registro (sem ele o roteiro é só rascunho). */
  ensaioAprovado: z.boolean(),
  roteiro: z.array(esquemaEtapaRoteiro),
  /** A janela estimada (parada até a reabertura), em minutos, pelos tempos do ensaio; null sem eles. */
  janelaMinutos: n.nullable(),
  /** A volta atrás estimada, em minutos (regra 12); null sem o tempo do ensaio. */
  voltaAtrasMinutos: n.nullable(),
  /** A verificação na produção (a que conta) e a do ensaio do roteiro na cópia. */
  producao: esquemaVerificacaoJanelaAvaliada.nullable(),
  ensaio: esquemaVerificacaoJanelaAvaliada.nullable(),
});
export type JanelaDoPasso = z.infer<typeof esquemaJanelaDoPasso>;

export const esquemaPainelJanela = z.object({
  hospital: z.string(),
  em: instante,
  relatorio: z.string(),
  relatorioInvalido: z.string().nullable(),
  registroInvalido: z.string().nullable(),
  passos: z.array(esquemaJanelaDoPasso),
  retirada: z.object({
    chave: z.string(),
    situacao: z.enum(SITUACOES_RETIRADA),
    motivos: z.array(z.enum(MOTIVOS_RETIRADA_RESTRICAO)),
    charsetBanco: z.string(),
    charsetParametro: z.enum(CHARSETS_LEGADO),
  }),
});
export type PainelJanela = z.infer<typeof esquemaPainelJanela>;
