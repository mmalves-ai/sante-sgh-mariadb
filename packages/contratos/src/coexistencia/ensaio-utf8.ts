// Ensaio da conversão para UTF-8 na cópia já em Firebird 5 (M58-F3; ficha do M58, seções 2, 4, 5, 8 a 11; cap-10
// §10.2, §10.7 e §10.13; BRIEF §4.2). A base é a restaurada da F2 (Firebird 5, texto em NONE com bytes CP1252); o alvo
// é um banco novo no mesmo servidor de ensaio, com as colunas CHAR e VARCHAR em UTF8, preenchido por bombeamento: cada
// valor lido em bytes e transliterado pela tabela sem perda do codec (cp1252.ts), nunca pela do motor (que troca os 5
// bytes indefinidos do CP1252 por U+0000; sonda de 2026-10-27, ADR 0032). Os BLOBs ficam em bytes (passo 5 e
// D-BLOB-F3-58). Trocar o charset por ALTER só reetiqueta: os bytes CP1252 passam a ser lidos como UTF-8 inválido.
//
// Sobre os dois bancos se medem as etapas abaixo; o relatório versionado (docs/marcos/M58/<h>/utf8.json, e o .md gerado
// dele) é o que o coordenador aprova no registro dos passos (passos.utf8.ensaio). Só estrutura, tempos, contagens e
// resumos SHA-256: nenhum valor de linha (a equivalência compara o resumo de cada coluna decodificada, nunca o texto).
import { z } from 'zod';
import { RE_TEXTO_SEM_DADO_PESSOAL } from '../homologacao/homologacao.js';
import { MOTIVOS_ETAPA_BLOQUEADA, SITUACOES_ETAPA_ENSAIO, TETO_NOMES_ENSAIO } from './ensaio-firebird5.js';

// ── Etapas ──────────────────────────────────────────────────────────────────────────────────────────────

/** As etapas do ensaio, na ordem em que rodam (ficha, seções 4, 5, 9 e 10; regras 1, 6, 7, 8, 10 e 12). */
export const ETAPAS_ENSAIO_UTF8 = [
  /** A base: a restaurada da F2 em Firebird 5, íntegra, com a impressão homologada do ensaio da F2. */
  'base',
  /** Colunas de texto por classe de conversão (CP1252, UTF-8 catalogada, BLOB em bytes), só contagens. */
  'inventario',
  /** Índices com segmento de texto: a chave em UTF-8 (até 4 bytes por caractere) contra o limite da página. */
  'indices',
  /** Literais com acento em gatilhos e procedures: revistos um a um (onde está o byte alto e se a ida e volta fecha). */
  'literais',
  /** O bombeamento para o banco UTF-8: tempo, linhas, valores com byte indefinido ou texto misto, rejeitados. */
  'conversao',
  /** Contagem por tabela e resumo por coluna de texto decodificada, antes e depois (passo 3). */
  'equivalencia',
  /** Colunas que já guardam UTF-8 dentro de NONE (`PRCONTEVOL.EVOLUCAO_XML`): sem nova transliteração (passo 4). */
  'utf8-catalogadas',
  /** BLOB RTF e os demais BLOBs mantidos em bytes; o RTF continua com `\ansicpg1252` e abre (passo 5). */
  'rtf',
  /** Gatilhos e procedures válidos no banco convertido. */
  'objetos',
  /** O codec do adaptador em modo UTF-8: corpus CP1252 de ida e volta e o charset conferido na partida (regra 6). */
  'codec',
  /** A impressão digital do banco convertido; o desvio da homologada do ensaio da F2 explicado só pelo charset. */
  'schema',
  /** `assinatura:testar --operacao=todas` com o codec em UTF-8, comparado por classe de valor (convencoes.md §7). */
  'assinaturas',
  /** `k6 carga-somada` com os SLOs da Fase 4. */
  'carga',
  /** Contratos Pact e suítes da API de integração da Hal-AI contra o banco convertido (regra 8). */
  'sante-api',
  /** Visões e contas de parceiros lidas no banco convertido; banco externo falso dos gatilhos (regra 10). */
  'parceiros',
  /** A base em NONE (backup da F2) restaurada de volta e verificada (regra 12). */
  'volta-atras',
] as const;
export type EtapaEnsaioUtf8 = (typeof ETAPAS_ENSAIO_UTF8)[number];

/**
 * Como cada coluna atravessa a conversão (ficha, seção 5, passos 3 a 5):
 * - `cp1252`: CHAR/VARCHAR em NONE com bytes CP1252 (o banco inteiro e as SGH_): transliterada pela tabela sem perda;
 * - `utf8-catalogada`: CHAR/VARCHAR que já guarda UTF-8 (colunas-utf8.ts): os bytes vão como estão, validados;
 * - `bytes`: BLOB (RTF, XML com declaração própria, texto livre): mantido em bytes, sem transliteração (D-BLOB-F3-58).
 */
export const CLASSES_CONVERSAO = ['cp1252', 'utf8-catalogada', 'bytes'] as const;
export type ClasseConversao = (typeof CLASSES_CONVERSAO)[number];

/** O método de conversão ensaiado (ADR 0032): só o bombeamento prova a ida e volta; o ALTER reetiqueta. */
export const METODOS_CONVERSAO_UTF8 = ['bombeamento'] as const;
export type MetodoConversaoUtf8 = (typeof METODOS_CONVERSAO_UTF8)[number];

/** Por que um literal de gatilho ou procedure pede revisão (só a categoria; nada do texto sai). */
export const MOTIVOS_LITERAL_UTF8 = [
  /** O fornecedor escreveu o literal em UTF-8 dentro do banco em NONE (a letra vista em CP1252 é a "quebrada"). */
  'utf8-no-literal',
  /** O literal está em UTF-8 duas vezes (o texto já quebrado foi gravado de novo como UTF-8). */
  'utf8-duplo',
  /** Um dos 5 bytes que o CP1252 não define (vai como o controle C1 de mesmo número, como nos dados). */
  'byte-indefinido',
  /** Byte alto fora de literal e de comentário (nome citado). */
  'byte-alto-no-codigo',
] as const;
export type MotivoLiteralUtf8 = (typeof MOTIVOS_LITERAL_UTF8)[number];

/** Tamanhos de página do Firebird 5 (bytes); a chave de índice cabe em até um quarto da página. */
export const TAMANHOS_PAGINA_FIREBIRD = [8192, 16384, 32768] as const;

/** Bytes por caractere no pior caso, em UTF8 (a chave de índice e o tamanho físico da coluna). */
export const BYTES_POR_CARACTERE_UTF8 = 4;

// ── Relatório versionado (docs/marcos/M58/<h>/utf8.json) ────────────────────────────────────────────────

const texto = z.string().regex(RE_TEXTO_SEM_DADO_PESSOAL, 'texto sem dado pessoal (até 600 caracteres)');
const nomeObjeto = z.string().regex(/^[A-Z][A-Z0-9_$]{0,62}$/);
const nomes = z.array(nomeObjeto).max(TETO_NOMES_ENSAIO);
/** `TABELA.COLUNA` (estrutura; nunca valor). */
const nomeColuna = z.string().regex(/^[A-Z][A-Z0-9_$]{0,62}\.[A-Z][A-Z0-9_$]{0,62}$/);
const colunas = z.array(nomeColuna).max(TETO_NOMES_ENSAIO);
const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const segundos = z.number().nonnegative();
const n = z.number().int().nonnegative();
const dia = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const base = {
  situacao: z.enum(SITUACOES_ETAPA_ENSAIO),
  bloqueio: z.enum(MOTIVOS_ETAPA_BLOQUEADA).nullable().default(null),
  observacao: texto.nullable().default(null),
};

export const esquemaIndiceEstourado = z
  .object({
    nome: nomeObjeto,
    tabela: nomeObjeto,
    /** O tamanho da chave em UTF-8, no pior caso (bytes). */
    chaveBytes: n,
    /** A menor página que comporta a chave; null quando nenhuma comporta (o índice tem de mudar: achado). */
    paginaMinima: z.union([z.literal(8192), z.literal(16384), z.literal(32768)]).nullable(),
  })
  .strict();
export type IndiceEstourado = z.infer<typeof esquemaIndiceEstourado>;

export const esquemaRelatorioEnsaioUtf8 = z
  .object({
    formato: z.literal(1),
    estabelecimento: z.string().regex(/^[a-z][a-z0-9]{0,9}$/),
    em: dia,
    /** O banco de partida (a restaurada da F2) e o convertido: versão do motor e charset declarado. */
    origem: z.object({ versaoMotor: z.string(), charset: z.string().regex(/^[A-Z0-9_]{1,20}$/) }).strict(),
    alvo: z.object({ versaoMotor: z.string(), charset: z.string().regex(/^[A-Z0-9_]{1,20}$/) }).strict(),
    etapas: z
      .object({
        base: z
          .object({
            ...base,
            /** A impressão homologada do ensaio da F2 (a base desta conversão). */
            impressao: sha256.nullable(),
            integridadeOk: z.boolean().nullable(),
          })
          .strict(),
        inventario: z
          .object({
            ...base,
            tabelas: n,
            /** Colunas por classe de conversão. */
            cp1252: n,
            utf8Catalogada: n,
            bytes: n,
            /** As catalogadas como UTF-8 encontradas no banco (nomes). */
            catalogadas: colunas,
            /** Catalogada que o banco não tem (a lista do codec ficou velha: achado). */
            catalogadasAusentes: colunas.default([]),
          })
          .strict(),
        indices: z
          .object({
            ...base,
            /** O tamanho de página da base e o limite de chave dela (bytes). */
            tamanhoPagina: n,
            limiteChave: n,
            comTexto: n,
            /** Os que não cabem na página atual depois da conversão. */
            estouram: z.array(esquemaIndiceEstourado).max(TETO_NOMES_ENSAIO),
            /** A página do banco convertido (todos os índices têm de caber nela). */
            paginaAlvo: n.nullable(),
          })
          .strict(),
        literais: z
          .object({
            ...base,
            /** Fontes com byte acima de 127 (gatilhos e procedures do outro sistema). */
            gatilhos: n,
            procedures: n,
            /** O byte alto só em comentário (sem efeito no que o objeto faz). */
            soComentario: n,
            /** Com o byte alto dentro de literal entre aspas (o texto gravado pelo objeto muda de bytes, não de letra). */
            emLiteral: n,
            /** Os que pedem revisão: byte indefinido do CP1252 ou sequência UTF-8 dentro do literal (nomes). */
            aRever: nomes,
            /** Os revistos que continuam iguais em letra depois da conversão (ida e volta da fonte). */
            idaEVoltaOk: n,
            /**
             * A revisão um a um dos que pedem revisão: o motivo e se cada literal do convertido tem a mesma letra que o
             * da base lido em CP1252 (a mesma transliteração das linhas). Revisto com a mesma letra sai dos achados.
             */
            revistos: z
              .array(
                z
                  .object({
                    nome: nomeObjeto,
                    motivos: z.array(z.enum(MOTIVOS_LITERAL_UTF8)).max(MOTIVOS_LITERAL_UTF8.length),
                    mesmaLetra: z.boolean(),
                  })
                  .strict(),
              )
              .max(TETO_NOMES_ENSAIO)
              .default([]),
          })
          .strict(),
        conversao: z
          .object({
            ...base,
            metodo: z.enum(METODOS_CONVERSAO_UTF8),
            segundos: segundos.nullable(),
            tabelas: n,
            linhas: n,
            /** Valores com um dos 5 bytes indefinidos (vão como os controles C1 de mesmo número, sem perda). */
            valoresByteIndefinido: n,
            /** Valores com texto misto (UTF-8 de integração em coluna CP1252): transliterados como estão, marcados. */
            valoresMistos: n,
            /** Linhas que o banco convertido recusou (nomes das tabelas; todo nome aqui reprova). */
            tabelasRejeitadas: nomes,
          })
          .strict(),
        equivalencia: z
          .object({
            ...base,
            segundos: segundos.nullable(),
            tabelas: n,
            /** Tabelas com a mesma contagem antes e depois. */
            tabelasIguais: n,
            colunas: n,
            colunasIguais: n,
            /** Colunas cujo resumo decodificado mudou (todo nome aqui reprova). */
            diferentes: colunas,
            /** Tabelas cuja contagem mudou, ou que existem de um lado só. */
            tabelasDiferentes: nomes,
            /** Tabelas que não se puderam percorrer (sem chave para paginar e acima do teto): achado. */
            naoVerificadas: nomes,
            /** SHA-256 da lista "TABELA.COLUNA=resumo" ordenada, antes e depois (iguais ⇒ mesmo texto). */
            hashAntes: sha256.nullable(),
            hashDepois: sha256.nullable(),
          })
          .strict(),
        'utf8-catalogadas': z
          .object({
            ...base,
            colunas: n,
            /** Valores lidos como UTF-8 válido nas duas pontas, com o mesmo resumo. */
            idaEVoltaOk: n,
            /** Valores que não são UTF-8 válido na base (vão como CP1252, marcados como mistos). */
            valoresInvalidos: n,
          })
          .strict(),
        rtf: z
          .object({
            ...base,
            /** Colunas BLOB comparadas por bytes. */
            colunas: n,
            bytesIguais: n,
            /** Documentos RTF que abrem (cabeçalho, `\ansicpg1252` ou sem declaração) depois, de uma amostra. */
            amostra: n,
            abrem: n,
          })
          .strict(),
        objetos: z
          .object({
            ...base,
            gatilhos: n,
            procedures: n,
            invalidos: nomes,
            invalidosNaOrigem: nomes,
            /**
             * Funções externas que contam ou cortam por byte (ib_udf: SUBSTR, STRLEN…), com os objetos que dependem
             * delas: em UTF-8 a letra acentuada tem mais de um byte e o corte pode partir a letra (achado).
             */
            funcoesPorByte: z
              .array(z.object({ funcao: nomeObjeto, dependentes: n }).strict())
              .max(TETO_NOMES_ENSAIO)
              .default([]),
          })
          .strict(),
        codec: z
          .object({
            ...base,
            /** Os 256 bytes do corpus CP1252 de ida e volta pelo codec em modo UTF-8. */
            corpusBytes: n,
            idaEVoltaOk: z.boolean().nullable(),
            /** A partida do adaptador conferiu `legado.charset` = UTF8 contra o banco convertido. */
            charsetConfere: z.boolean().nullable(),
          })
          .strict(),
        schema: z
          .object({
            ...base,
            impressaoBase: sha256.nullable(),
            impressaoEnsaio: sha256.nullable(),
            diferencas: z.array(
              z
                .object({
                  categoria: z.string().regex(/^[a-z]{1,30}$/),
                  ausentes: n,
                  novos: n,
                  alterados: n,
                  nomes,
                  /** Alterados só pela troca do charset (colunas de texto, domínios, fontes com acento). */
                  doCharset: n.default(0),
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
            /** Cenários com classe de valor diferente da referência (texto comparado por classe, nunca por valor). */
            diferencas: n,
            /** Os que falham do mesmo jeito na base em NONE: não são da conversão. */
            iguaisABase: n.default(0),
            relatorio: texto.nullable(),
            operacoesComDiferenca: z
              .array(z.string().regex(/^[a-z]+\.[A-Za-z0-9]{1,80}$/))
              .max(TETO_NOMES_ENSAIO)
              .default([]),
            /**
             * As funções externas que o diagnóstico (ASSINATURA_DEPURAR) achou por trás de todas as diferenças: o corte
             * por byte parte a letra (UTF-8 malformado). A correção muda objeto do banco (autorização do dono).
             */
            funcoesACorrigir: nomes.default([]),
          })
          .strict(),
        carga: z.object({ ...base, slosAtendidos: z.boolean().nullable() }).strict(),
        'sante-api': z
          .object({ ...base, contratosQuebrados: n.nullable(), referencia: texto.nullable() })
          .strict(),
        parceiros: z
          .object({
            ...base,
            alvos: z.array(
              z
                .object({
                  alvo: z.string().regex(/^(?:[A-Z][A-Z0-9_]{0,30}|banco-externo)$/),
                  objetos: n,
                  lidosSemErro: n,
                  avisado: z.boolean().default(false),
                })
                .strict(),
            ),
          })
          .strict(),
        'volta-atras': z
          .object({ ...base, segundos: segundos.nullable(), integridadeOk: z.boolean().nullable() })
          .strict(),
      })
      .strict(),
  })
  .strict()
  .superRefine((r, ctx) => {
    for (const e of ETAPAS_ENSAIO_UTF8) {
      const x = r.etapas[e];
      if ((x.situacao === 'bloqueada') !== (x.bloqueio !== null))
        ctx.addIssue({
          code: 'custom',
          path: ['etapas', e, 'bloqueio'],
          message: 'etapa bloqueada exige o motivo, e só ela',
        });
    }
  });
export type RelatorioEnsaioUtf8 = z.infer<typeof esquemaRelatorioEnsaioUtf8>;
export type EtapasRelatorioUtf8 = RelatorioEnsaioUtf8['etapas'];

export const caminhoRelatorioEnsaioUtf8 = (estabelecimento: string): string =>
  `docs/marcos/M58/${estabelecimento}/utf8.json`;

// ── Resumo para o painel (GET administracao/coexistencia/desligamento/ensaios/utf8) ──────────────────────

export const esquemaEtapaEnsaioUtf8Avaliada = z.object({
  etapa: z.enum(ETAPAS_ENSAIO_UTF8),
  situacao: z.enum(SITUACOES_ETAPA_ENSAIO),
  bloqueio: z.enum(MOTIVOS_ETAPA_BLOQUEADA).nullable(),
  achados: z.array(z.string()),
});
export type EtapaEnsaioUtf8Avaliada = z.infer<typeof esquemaEtapaEnsaioUtf8Avaliada>;

export const esquemaResumoEnsaioUtf8 = z.object({
  hospital: z.string(),
  em: z.iso.datetime(),
  relatorio: z.string(),
  relatorioInvalido: z.string().nullable(),
  ensaiadoEm: dia.nullable(),
  /** "5.0.3 (NONE)" e "5.0.3 (UTF8)". */
  origem: z.string().nullable(),
  alvo: z.string().nullable(),
  etapas: z.array(esquemaEtapaEnsaioUtf8Avaliada),
  aprovavel: z.boolean(),
  /** A janela estimada da conversão (bombeamento e verificação × margem), em minutos; null sem os tempos. */
  janelaMinutos: z.number().int().positive().nullable(),
  /** Índices que pedem página maior e a página do banco convertido. */
  indicesEstourados: z.array(esquemaIndiceEstourado),
  paginaAlvo: z.number().int().positive().nullable(),
  /** O ensaio da F2 aprovado no registro (a conversão parte da base em Firebird 5). */
  firebird5Aprovado: z.boolean(),
  registro: z.object({ data: dia, resultado: z.enum(['aprovado', 'reprovado']) }).nullable(),
});
export type ResumoEnsaioUtf8 = z.infer<typeof esquemaResumoEnsaioUtf8>;
