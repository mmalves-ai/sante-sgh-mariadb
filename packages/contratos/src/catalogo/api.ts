// Contratos da API dos catálogos oficiais (ficha do M13, seções 4, 5 e 7): envio do arquivo (preparação,
// validação e comparação na área de preparação), aprovação com a senha de novo, rejeição, cancelamento,
// painel de cargas, consulta dos catálogos e a entrada da operação de gravação de cada catálogo (um lote).
import { z } from 'zod';
import { esquemaJustificativa } from '../preco/entradas.js';
import { textoCp1252 } from '../texto-cp1252.js';
import { CODIGOS_CATALOGO, COMPARACOES_LINHA, SITUACOES_CARGA_CATALOGO } from './definicoes.js';

/** Teto do arquivo por envio (bytes do texto): bases maiores entram em partes (por UF, por tabela). */
export const TETO_ARQUIVO_CATALOGO = 16_000_000;
/** Itens por lote de publicação (cada lote é uma transação curta do executor; medido no M13). */
export const ITENS_POR_LOTE_CATALOGO = 500;

/** Codificações que a tela reconhece no arquivo enviado (UTF-8 válido; senão Windows-1252, superconjunto do Latin-1). */
export const CHARSETS_ARQUIVO_CATALOGO = ['utf-8', 'windows-1252'] as const;
export type CharsetArquivoCatalogo = (typeof CHARSETS_ARQUIVO_CATALOGO)[number];

export const esquemaNovaCargaCatalogo = z
  .object({
    catalogo: z.enum(CODIGOS_CATALOGO),
    arquivos: z
      .array(
        z
          .object({
            nome: textoCp1252(120).pipe(z.string().min(1)),
            conteudo: z.string().min(1).max(TETO_ARQUIVO_CATALOGO),
            /** Codificação detectada pela tela ao ler o arquivo (arquivos oficiais costumam vir em Windows-1252). */
            charset: z.enum(CHARSETS_ARQUIVO_CATALOGO).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(12),
    /** Competência (AAAAMM), edição ou versão TISS informada pela tela quando o arquivo não a traz. */
    edicao: z
      .string()
      .regex(/^[0-9A-Za-z.]{1,12}$/)
      .optional(),
  })
  .strict();
export type NovaCargaCatalogo = z.infer<typeof esquemaNovaCargaCatalogo>;

export const esquemaAprovarCargaCatalogo = z
  .object({
    justificativa: esquemaJustificativa,
    senha: z.string(),
    versao: z.number().int().min(1),
  })
  .strict();
export const esquemaMotivoCargaCatalogo = z
  .object({ motivo: esquemaJustificativa, versao: z.number().int().min(1) })
  .strict();

// ── Entrada da operação de gravação (um lote; ficha, seção 5) ─────────────────────────────────────────

const valor = z.union([z.string().max(4000), z.number(), z.null()]);
export const esquemaItemLoteCatalogo = z
  .object({
    entidade: z.string().regex(/^[a-z][A-Za-z0-9]{1,40}$/),
    acao: z.enum(['incluir', 'alterar']),
    /** Chave natural no vocabulário do novo (códigos como texto, com zeros à esquerda). */
    chave: z.record(z.string(), z.string().max(20)),
    /** Campos do arquivo (na inclusão, todos; na alteração, só os que mudaram). */
    valores: z.record(z.string(), valor),
    /** Na alteração: os valores atuais que a comparação leu (a receita relê e recusa se mudaram). */
    antes: z.record(z.string(), valor).optional(),
  })
  .strict();
export type ItemLoteCatalogo = z.infer<typeof esquemaItemLoteCatalogo>;

export const esquemaLoteCatalogo = z
  .object({
    carga: z.number().int().min(1),
    lote: z.number().int().min(1),
    lotes: z.number().int().min(1),
    /** Competência (AAAAMM), versão TISS (x.yy.zz) ou edição do arquivo. */
    edicao: z.string().max(12).nullable(),
    /** Hash do arquivo (reimportar o mesmo arquivo não grava nada). */
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    itens: z.array(esquemaItemLoteCatalogo).min(1).max(ITENS_POR_LOTE_CATALOGO),
  })
  .strict();
export type LoteCatalogo = z.infer<typeof esquemaLoteCatalogo>;

// ── Respostas ────────────────────────────────────────────────────────────────────────────────────────

export const esquemaTotaisCarga = z.object({
  linhas: z.number(),
  validas: z.number(),
  erros: z.number(),
  novos: z.number(),
  removidos: z.number(),
  alterados: z.number(),
  iguais: z.number(),
});

export const esquemaCargaCatalogo = z.object({
  id: z.number(),
  catalogo: z.string(),
  arquivo: z.string(),
  sha256: z.string(),
  bytes: z.number(),
  situacao: z.enum(SITUACOES_CARGA_CATALOGO),
  edicao: z.string().nullable(),
  responsavel: z.string(),
  aprovador: z.string().nullable(),
  criadaEm: z.string(),
  totais: esquemaTotaisCarga,
  lotes: z.object({ total: z.number(), publicados: z.number(), tamanho: z.number() }),
  motivo: z.string().nullable(),
  arquivoGuardado: z.boolean(),
});
export type CargaCatalogo = z.infer<typeof esquemaCargaCatalogo>;

export const esquemaLinhaCargaCatalogo = z.object({
  linha: z.number(),
  entidade: z.string(),
  chave: z.string(),
  resultado: z.enum(['valida', 'erro']),
  comparacao: z.enum(COMPARACOES_LINHA).nullable(),
  antes: z.record(z.string(), valor).nullable(),
  depois: z.record(z.string(), valor).nullable(),
  motivo: z.string().nullable(),
});
export type LinhaCargaCatalogo = z.infer<typeof esquemaLinhaCargaCatalogo>;

export const esquemaDetalheCargaCatalogo = z.object({
  carga: esquemaCargaCatalogo,
  versao: z.number(),
  linhas: z.array(esquemaLinhaCargaCatalogo),
  total: z.number(),
  pagina: z.number(),
  porPagina: z.number(),
  /** Pode publicar agora? (o responsável é este sistema, licença, situação, janela). */
  publicacao: z.object({ pode: z.boolean(), motivo: z.string().nullable() }),
});
export type DetalheCargaCatalogo = z.infer<typeof esquemaDetalheCargaCatalogo>;

export const esquemaPainelCatalogos = z.object({
  catalogos: z.array(
    z.object({
      codigo: z.enum(CODIGOS_CATALOGO),
      titulo: z.string(),
      rota: z.string(),
      /** 'novo': este sistema carrega; 'externo': a carga continua como hoje (o importador recusa publicar). */
      responsavel: z.enum(['novo', 'externo']),
      ultimaCarga: z
        .object({
          id: z.number(),
          situacao: z.enum(SITUACOES_CARGA_CATALOGO),
          quando: z.string(),
          edicao: z.string().nullable(),
        })
        .nullable(),
      /** A edição mais nova que o banco do estabelecimento já tem (competência, versão ou edição). */
      edicaoNoBanco: z.object({ descricao: z.string(), valor: z.string().nullable(), linhas: z.number() }),
      atraso: z.string().nullable(),
      erros: z.number(),
      licenca: z.object({ exigida: z.boolean(), vigente: z.boolean(), motivo: z.string().nullable() }),
    }),
  ),
  janela: z.object({ inicio: z.string(), fim: z.string(), agoraDentro: z.boolean() }),
});
export type PainelCatalogos = z.infer<typeof esquemaPainelCatalogos>;

export const esquemaConsultaCatalogo = z.object({
  entidade: z.string(),
  titulo: z.string(),
  colunas: z.array(z.object({ campo: z.string(), rotulo: z.string() })),
  itens: z.array(z.record(z.string(), valor)),
  total: z.number(),
  pagina: z.number(),
  porPagina: z.number(),
});
export type ConsultaCatalogo = z.infer<typeof esquemaConsultaCatalogo>;

export const esquemaHistoricoSigtap = z.object({
  procedimento: z.string(),
  nome: z.string().nullable(),
  competencias: z.array(
    z.object({
      competencia: z.string(),
      valorSh: z.number().nullable(),
      valorSa: z.number().nullable(),
      valorSp: z.number().nullable(),
      atributos: z.record(z.string(), valor),
    }),
  ),
  /** 06-SUS L50: a competência da tabela em uso e as competências carregadas (mais nova primeiro). */
  competenciaEmUso: z.string().nullable().optional(),
  competenciasCarregadas: z
    .array(
      z.object({
        codigo: z.string(),
        situacao: z.string(),
        vigente: z.boolean(),
        publicacao: z.string().nullable(),
        procedimentos: z.number().nullable(),
      }),
    )
    .optional(),
  /** Os pares com este procedimento como principal vigentes na competência em uso. */
  compatibilidades: z
    .array(
      z.object({
        secundario: z.string(),
        descricao: z.string().nullable(),
        tipo: z.enum(['compativel', 'incompativel', 'concomitante']),
        quantidadeMaxima: z.number().nullable(),
        vigenciaInicio: z.string(),
        vigenciaFim: z.string().nullable(),
      }),
    )
    .optional(),
});
export type HistoricoSigtap = z.infer<typeof esquemaHistoricoSigtap>;
