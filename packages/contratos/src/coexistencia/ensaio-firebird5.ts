// Ensaio do Firebird 5 na cópia (M58-F2; ficha do M58, seções 2, 5, 8 a 11; cap-10 §10.13; cap-09 §9.15 e §9.17).
// O banco inteiro sai da cópia em Firebird 3.0.14 por backup (gbak) e é restaurado num servidor Firebird 5 isolado,
// só da cópia de ensaio (infra/firebird/fase7/ensaio-firebird5/): ODS nova, gatilhos e procedures recompilados na
// restauração. Sobre a restaurada se medem as etapas abaixo; o relatório versionado
// (docs/marcos/M58/<h>/firebird5.json, e o .md gerado dele) é o que o coordenador aprova no registro dos passos
// (passos.firebird5.ensaio). O ensaio não muda o modelo de dados: nenhum gatilho, procedure ou generator apagado.
//
// Só estrutura, tempos e contagens: nenhum dado de linha, nenhum login, nenhuma senha. As contagens por tabela ficam
// fora do relatório (só o resumo SHA-256 da lista e os NOMES das tabelas que divergem).
import { z } from 'zod';
import { RE_TEXTO_SEM_DADO_PESSOAL } from '../homologacao/homologacao.js';
import { RESOLUCOES_FUNCAO_EXTERNA } from './desligamento.js';

// ── Etapas ──────────────────────────────────────────────────────────────────────────────────────────────

/** As etapas do ensaio, na ordem em que rodam (ficha, seções 2 e 10; regras 1, 4, 5, 8, 10 e 12). */
export const ETAPAS_ENSAIO_FIREBIRD5 = [
  /** gbak de backup no Firebird 3.0.14 (tempo: base da janela, regra 4). */
  'backup',
  /** gbak de restauração no Firebird 5 (ODS nova; tempo: base da janela). */
  'restauracao',
  /** Contagem de linhas por tabela antes e depois (prova pós-janela; mesma lista). */
  'contagens',
  /** Gatilhos e procedures válidos depois da recompilação (RDB$VALID_BLR). */
  'objetos',
  /** Funções externas habilitadas por configuração ou substituídas (regra 5). */
  'funcoes-externas',
  /** O adaptador conecta (cliente, autenticação, criptografia do canal; cap-09 §9.17). */
  'driver',
  /** A impressão digital dos metadados igual à homologada, ou o desvio explicado só pelo motor. */
  'schema',
  /** `assinatura:testar --operacao=todas` com 0 diferença contra as referências de Firebird 3 (regra 1). */
  'assinaturas',
  /** `k6 carga-somada` com os SLOs da Fase 4. */
  'carga',
  /** Contratos Pact e suítes da API de integração da Hal-AI contra a cópia de ensaio (regra 8). */
  'sante-api',
  /** Visões e contas de parceiros lidas na cópia de ensaio; banco externo falso dos gatilhos (regra 10). */
  'parceiros',
  /** O backup de Firebird 3 restaurado de volta em Firebird 3 e verificado (regra 12). */
  'volta-atras',
  /** O backup feito no Firebird 5 restaurado em ambiente isolado com verificação de integridade (SBIS-13, M59). */
  'restauracao-isolada',
] as const;
export type EtapaEnsaioFirebird5 = (typeof ETAPAS_ENSAIO_FIREBIRD5)[number];

export const SITUACOES_ETAPA_ENSAIO = ['nao-executada', 'aprovada', 'reprovada', 'bloqueada'] as const;
export type SituacaoEtapaEnsaio = (typeof SITUACOES_ETAPA_ENSAIO)[number];

/** Por que uma etapa ficou bloqueada (fora do alcance da obra: depende de alguém de fora). */
export const MOTIVOS_ETAPA_BLOQUEADA = [
  /** A biblioteca do fornecedor de uma função externa não está na cópia (vem da TI). */
  'biblioteca-do-fornecedor',
  /** A verificação do provedor depende da equipe da Hal-AI (DP-8). */
  'equipe-hal-ai',
  /** A lista de parceiros e contas técnicas depende da TI do hospital (DP-16). */
  'lista-da-ti',
  /** O parceiro precisa testar do lado dele. */
  'parceiro',
  /**
   * A correção depende de autorização do dono para mexer em objeto do banco (regra 4 da Fase 7): por exemplo, um
   * gatilho que só funciona no 3 (ADR 0031).
   */
  'autorizacao-do-dono',
] as const;
export type MotivoEtapaBloqueada = (typeof MOTIVOS_ETAPA_BLOQUEADA)[number];

/** A versão de ensaio do motor (imagem oficial; a TI pode homologar outra 5.0.x, que exige novo ensaio). */
export const VERSAO_ENSAIO_FIREBIRD5 = '5.0.3';
/** A versão de origem, congelada durante a coexistência. */
export const VERSAO_ORIGEM_FIREBIRD = '3.0.14';

/** Margem sobre a soma dos tempos medidos (backup, restauração e verificação) para a janela (regra 4). */
export const MARGEM_JANELA = 1.5;
/** A janela é arredondada para cima em blocos deste tamanho, em minutos. */
export const BLOCO_JANELA_MIN = 15;
/** Teto de nomes listados por etapa (tabelas que divergem, objetos inválidos): o resto vai só pelo número. */
export const TETO_NOMES_ENSAIO = 200;

// ── Relatório versionado (docs/marcos/M58/<h>/firebird5.json) ───────────────────────────────────────────

const texto = z.string().regex(RE_TEXTO_SEM_DADO_PESSOAL, 'texto sem dado pessoal (até 600 caracteres)');
const nomeObjeto = z.string().regex(/^[A-Z][A-Z0-9_$]{0,62}$/);
const nomes = z.array(nomeObjeto).max(TETO_NOMES_ENSAIO);
const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const segundos = z.number().nonnegative();
const n = z.number().int().nonnegative();
const dia = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** O que toda etapa registra: a situação, o motivo (bloqueada) e uma observação técnica curta. */
const base = {
  situacao: z.enum(SITUACOES_ETAPA_ENSAIO),
  bloqueio: z.enum(MOTIVOS_ETAPA_BLOQUEADA).nullable().default(null),
  observacao: texto.nullable().default(null),
};

export const esquemaFuncaoEnsaio = z
  .object({
    nome: nomeObjeto,
    /** A biblioteca declarada (RDB$MODULE_NAME). */
    modulo: z.string().regex(/^[a-z][a-z0-9_]{0,62}$/),
    /** A biblioteca está no servidor de ensaio (pasta UDF). */
    bibliotecaPresente: z.boolean(),
    /** A chamada de prova (argumentos neutros) devolveu valor; null quando não se pôde chamar. */
    chamadaOk: z.boolean().nullable(),
    /** Gatilhos e procedures que dependem da função (RDB$DEPENDENCIES). */
    dependentes: n,
    /** Os dependentes que continuaram válidos depois da restauração. */
    dependentesValidos: n,
    /** A resolução que o ensaio sustenta (a decisão vai ao ADR e ao registro dos passos). */
    resolucaoProposta: z.enum(RESOLUCOES_FUNCAO_EXTERNA),
  })
  .strict();
export type FuncaoEnsaio = z.infer<typeof esquemaFuncaoEnsaio>;

export const esquemaParceiroEnsaio = z
  .object({
    /** O prefixo das visões de integração de um parceiro ou `banco-externo` (gatilhos que acessam outro banco). */
    alvo: z.string().regex(/^(?:[A-Z][A-Z0-9_]{0,30}|banco-externo)$/),
    objetos: n,
    /** Objetos lidos (SELECT FIRST 1) ou gatilhos provados sem erro na cópia de ensaio. */
    lidosSemErro: n,
    /** O parceiro testou do lado dele e foi avisado da janela (DP-16; preenchido pela TI). */
    avisado: z.boolean().default(false),
  })
  .strict();
export type ParceiroEnsaio = z.infer<typeof esquemaParceiroEnsaio>;

export const esquemaRelatorioEnsaioFirebird5 = z
  .object({
    formato: z.literal(1),
    estabelecimento: z.string().regex(/^[a-z][a-z0-9]{0,9}$/),
    /** Dia do ensaio (a cópia de origem é o retrato de dev do hospital). */
    em: dia,
    origem: z.object({ versaoMotor: z.string(), ods: z.string() }).strict(),
    alvo: z.object({ versaoMotor: z.string(), ods: z.string() }).strict(),
    etapas: z
      .object({
        backup: z.object({ ...base, segundos: segundos.nullable(), bytes: n.nullable() }).strict(),
        restauracao: z
          .object({
            ...base,
            segundos: segundos.nullable(),
            /** A verificação de integridade da restaurada (gfix -v -full) e o tempo dela. */
            integridadeOk: z.boolean().nullable(),
            verificacaoSegundos: segundos.nullable(),
          })
          .strict(),
        contagens: z
          .object({
            ...base,
            segundos: segundos.nullable(),
            tabelas: n,
            iguais: n,
            /** Tabelas cuja contagem mudou (só nomes). */
            diferentes: nomes,
            /** Tabelas que existem só de um lado (só nomes). */
            ausentes: nomes,
            /** SHA-256 da lista "TABELA=linhas" ordenada, antes e depois (iguais ⇒ mesmas contagens). */
            hashAntes: sha256.nullable(),
            hashDepois: sha256.nullable(),
            /**
             * A cópia de dev andou depois do backup (o registro dos scripts SGH_ da restaurada contido no da origem,
             * com menos): as tabelas SGH_ de `posterioresSgh` são o movimento posterior do Sante e não reprovam.
             */
            copiaMoveu: z.boolean().default(false),
            scriptsOrigem: n.default(0),
            scriptsAlvo: n.default(0),
            posterioresSgh: nomes.default([]),
            /** O mesmo resumo só das tabelas que não são SGH_ (as do banco de origem). */
            hashLegadoAntes: sha256.nullable().default(null),
            hashLegadoDepois: sha256.nullable().default(null),
          })
          .strict(),
        objetos: z
          .object({
            ...base,
            gatilhos: n,
            procedures: n,
            /** Gatilhos e procedures inválidos depois da recompilação (nomes; todo nome aqui reprova). */
            invalidos: nomes,
            /** Os mesmos inválidos já na origem (não são da troca do motor; vão ao relatório como estão). */
            invalidosNaOrigem: nomes,
          })
          .strict(),
        'funcoes-externas': z
          .object({
            ...base,
            /** `UdfAccess` do servidor de ensaio (o Firebird 4 em diante vem com `None`). */
            udfAccess: z.string().regex(/^[A-Za-z ,/]{1,60}$/),
            funcoes: z.array(esquemaFuncaoEnsaio),
          })
          .strict(),
        driver: z
          .object({
            ...base,
            conectou: z.boolean(),
            /** O método de autenticação da sessão (MON$AUTH_METHOD: Srp, Srp256, Legacy_Auth). */
            autenticacao: z
              .string()
              .regex(/^[A-Za-z0-9_]{0,30}$/)
              .nullable(),
            /** O canal cifrado (WireCrypt), quando o servidor informa. */
            canalCifrado: z.boolean().nullable(),
          })
          .strict(),
        schema: z
          .object({
            ...base,
            impressaoHomologada: sha256.nullable(),
            impressaoEnsaio: sha256.nullable(),
            /** Categorias com diferença, com o número de ausentes, novos e alterados. */
            diferencas: z.array(
              z
                .object({
                  categoria: z.string().regex(/^[a-z]{1,30}$/),
                  ausentes: n,
                  novos: n,
                  alterados: n,
                  /** Os nomes dos alterados (para o relatório; os de função são conferidos contra a resolução). */
                  nomes,
                  /** Diferenças em objetos do catálogo do motor (RDB$, MON$, SEC$): a troca de versão as explica. */
                  doMotor: n.default(0),
                })
                .strict(),
            ),
          })
          .strict(),
        assinaturas: z
          .object({
            ...base,
            operacoes: n,
            cenarios: n,
            /** Cenários com diferença no 5 que passam na cópia em 3 com o mesmo código (as do motor). */
            diferencas: n,
            relatorio: texto.nullable(),
            /** Cenários que falham do mesmo jeito na cópia em 3 com o mesmo código: não são do motor. */
            iguaisAo3: n.default(0),
            /** As operações com diferença do motor (só nomes). */
            operacoesComDiferenca: z
              .array(z.string().regex(/^[a-z]+\.[A-Za-z0-9]{1,80}$/))
              .max(TETO_NOMES_ENSAIO)
              .default([]),
            /** Gatilhos do banco que explicam as diferenças do motor (diagnóstico do ensaio; correção na ADR 0031). */
            gatilhosACorrigir: nomes.default([]),
          })
          .strict(),
        carga: z.object({ ...base, slosAtendidos: z.boolean().nullable() }).strict(),
        'sante-api': z
          .object({ ...base, contratosQuebrados: n.nullable(), referencia: texto.nullable() })
          .strict(),
        parceiros: z.object({ ...base, alvos: z.array(esquemaParceiroEnsaio) }).strict(),
        'volta-atras': z.object({ ...base, segundos: segundos.nullable() }).strict(),
        'restauracao-isolada': z.object({ ...base, integridadeOk: z.boolean().nullable() }).strict(),
      })
      .strict(),
  })
  .strict()
  .superRefine((r, ctx) => {
    for (const e of ETAPAS_ENSAIO_FIREBIRD5) {
      const x = r.etapas[e];
      if ((x.situacao === 'bloqueada') !== (x.bloqueio !== null))
        ctx.addIssue({
          code: 'custom',
          path: ['etapas', e, 'bloqueio'],
          message: 'etapa bloqueada exige o motivo, e só ela',
        });
    }
  });
export type RelatorioEnsaioFirebird5 = z.infer<typeof esquemaRelatorioEnsaioFirebird5>;
export type EtapasRelatorioFirebird5 = RelatorioEnsaioFirebird5['etapas'];

export const caminhoRelatorioEnsaioFirebird5 = (estabelecimento: string): string =>
  `docs/marcos/M58/${estabelecimento}/firebird5.json`;

// ── Resumo para o painel (GET administracao/coexistencia/desligamento/ensaios/firebird5) ─────────────────

export const esquemaEtapaEnsaioAvaliada = z.object({
  etapa: z.enum(ETAPAS_ENSAIO_FIREBIRD5),
  situacao: z.enum(SITUACOES_ETAPA_ENSAIO),
  bloqueio: z.enum(MOTIVOS_ETAPA_BLOQUEADA).nullable(),
  /** Os achados que reprovam ou faltam na etapa (códigos curtos; a tela traduz). */
  achados: z.array(z.string()),
});
export type EtapaEnsaioAvaliada = z.infer<typeof esquemaEtapaEnsaioAvaliada>;

export const esquemaResumoEnsaioFirebird5 = z.object({
  hospital: z.string(),
  em: z.iso.datetime(),
  /** O caminho do relatório versionado e o motivo, se ausente ou fora do esquema (falha fechada). */
  relatorio: z.string(),
  relatorioInvalido: z.string().nullable(),
  ensaiadoEm: dia.nullable(),
  origem: z.string().nullable(),
  alvo: z.string().nullable(),
  etapas: z.array(esquemaEtapaEnsaioAvaliada),
  /** Todas as etapas aprovadas: o coordenador pode registrar o ensaio como aprovado. */
  aprovavel: z.boolean(),
  /** A janela estimada (regra 4), em minutos; null sem os tempos de backup e restauração. */
  janelaMinutos: z.number().int().positive().nullable(),
  /** As funções externas e a resolução que o ensaio sustenta. */
  funcoes: z.array(esquemaFuncaoEnsaio),
  /** O que o registro dos passos diz do ensaio (data e resultado), se registrado. */
  registro: z.object({ data: dia, resultado: z.enum(['aprovado', 'reprovado']) }).nullable(),
});
export type ResumoEnsaioFirebird5 = z.infer<typeof esquemaResumoEnsaioFirebird5>;
