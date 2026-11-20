// Entradas das telas e das operações da assinatura ICP-Brasil (M49; ficha, seções 5 e 7): o que a tela manda e o
// serviço valida (o mesmo Zod). A tela nunca manda chave privada, segredo do provedor, nível já calculado nem hash
// diferente do que mostrou: o hash vai junto só para provar que a prévia é o documento assinado (regra 4).
import { z } from 'zod';
import { textoCp1252 } from '../texto-cp1252.js';
import {
  DESTINOS_DOCUMENTO,
  FORMATO_CODIGO_VERIFICACAO,
  FORMATOS_ASSINATURA,
  MIDIAS_CERTIFICADO,
  NIVEIS_ASSINATURA,
  POLITICAS_ASSINATURA_ICP,
  TETO_LOTE_ASSINATURA,
  TIPOS_DOCUMENTO_POLITICA,
} from './vocabulario.js';

const id = z.number().int().positive();
const hash = z.string().regex(/^[0-9a-f]{64}$/, 'Hash SHA-256 em hexadecimal minúsculo.');
const justificativa = textoCp1252(400).pipe(z.string().min(10, 'Justifique com pelo menos 10 caracteres.'));
/** Código do provedor no cadastro do novo (ex.: o de cada PSC contratado; DP-22). */
const codigoProvedor = z.string().regex(/^[a-z][a-z0-9-]{1,29}$/);
/** Sigla do conselho (CRM, COREN, CRF...); null: qualquer conselho. */
const conselho = z
  .string()
  .regex(/^[A-Z]{2,10}$/)
  .nullable();

/**
 * Vincular o certificado ao usuário (`documento.vincularCertificado`): só a parte PÚBLICA, em DER base64 (até 16 KB).
 * O serviço lê série, validade e CPF e confere o CPF com o do usuário antes de gravar (regra 2).
 */
export const esquemaVincularCertificado = z
  .object({
    midia: z.enum(MIDIAS_CERTIFICADO),
    /** Provedor em nuvem; obrigatório quando a mídia é nuvem, ausente no A1/A3. */
    provedor: codigoProvedor.nullable().default(null),
    certificado: z
      .string()
      .regex(/^[A-Za-z0-9+/]+={0,2}$/, 'Certificado em DER base64.')
      .max(21_848),
  })
  .strict()
  .refine((x) => (x.midia === 'nuvem') === (x.provedor !== null), {
    path: ['provedor'],
    message: 'Informe o provedor só para certificado em nuvem.',
  });
export type VincularCertificado = z.infer<typeof esquemaVincularCertificado>;

/** Política por tipo de documento, conselho e destino (`documento.definirPoliticaAssinatura`; regra 6). */
export const esquemaDefinirPoliticaAssinatura = z
  .object({
    tipoDocumento: z.enum(TIPOS_DOCUMENTO_POLITICA),
    conselho,
    destino: z.enum(DESTINOS_DOCUMENTO),
    nivel: z.enum(NIVEIS_ASSINATURA),
    /** Obrigatória no nível ICP-Brasil; ausente nos demais. */
    politicaIcp: z.enum(POLITICAS_ASSINATURA_ICP).nullable().default(null),
    formato: z.enum(FORMATOS_ASSINATURA).default('pades'),
    justificativa,
  })
  .strict()
  .refine((x) => (x.nivel === 'icp-brasil') === (x.politicaIcp !== null), {
    path: ['politicaIcp'],
    message: 'A política AD-RB ou AD-RT vale só para a assinatura ICP-Brasil.',
  });
export type DefinirPoliticaAssinatura = z.infer<typeof esquemaDefinirPoliticaAssinatura>;

/**
 * Pedir a assinatura ICP de um ou vários documentos (`documento.assinar` / `documento.assinarLote`): os IDs do
 * documento do novo e o hash de cada um como a prévia mostrou. Em nuvem, a resposta é o endereço de autorização do
 * provedor (OAuth 2.0 com PKCE); no A1/A3, o desafio para o agente local.
 */
export const esquemaPedirAssinaturaIcp = z
  .object({
    documentos: z.array(id).min(1).max(TETO_LOTE_ASSINATURA),
    hashes: z.array(hash).min(1).max(TETO_LOTE_ASSINATURA),
    /** Certificado vinculado que vai assinar (`SGH_ACESSO_CERTIFICADO.ID`). */
    certificado: id,
  })
  .strict()
  .refine((x) => x.documentos.length === x.hashes.length, {
    path: ['hashes'],
    message: 'Um hash por documento.',
  })
  .refine((x) => new Set(x.documentos).size === x.documentos.length, {
    path: ['documentos'],
    message: 'Documento repetido no lote.',
  });
export type PedirAssinaturaIcp = z.infer<typeof esquemaPedirAssinaturaIcp>;

/** Volta do provedor (redirecionamento do OAuth): o `state` amarra ao pedido; o `code` vale uma vez. */
export const esquemaRetornoPsc = z
  .object({
    state: z.string().regex(/^[A-Za-z0-9_-]{32,128}$/),
    code: z.string().min(1).max(2048),
  })
  .strict();
export type RetornoPsc = z.infer<typeof esquemaRetornoPsc>;

/** Resposta do agente local (A1/A3): a assinatura de cada hash do desafio, em base64, e o certificado usado. */
export const esquemaRespostaAgenteLocal = z
  .object({
    desafio: z.string().regex(/^[A-Za-z0-9_-]{32,128}$/),
    assinaturas: z
      .array(
        z
          .object({
            hash,
            assinatura: z
              .string()
              .regex(/^[A-Za-z0-9+/]+={0,2}$/)
              .max(32_768),
          })
          .strict(),
      )
      .min(1)
      .max(TETO_LOTE_ASSINATURA),
    certificado: z
      .string()
      .regex(/^[A-Za-z0-9+/]+={0,2}$/)
      .max(21_848),
  })
  .strict();
export type RespostaAgenteLocal = z.infer<typeof esquemaRespostaAgenteLocal>;

/** ASCII imprimível sem espaço (client_id e endereço do provedor; a coluna do banco não aceita fora do CP1252). */
const ASCII_IMPRIMIVEL = /^[\x21-\x7E]+$/;

/** Provedor de certificado em nuvem (tela de provedores): o segredo NUNCA vem aqui (vai ao cofre por rota própria). */
export const esquemaProvedorPsc = z
  .object({
    codigo: codigoProvedor,
    nome: textoCp1252(60).pipe(z.string().min(2)),
    /** URI-base do PSC com a versão da API (DOC-ICP-17.01, item 6.4: termina em /v0). */
    uriBase: z
      .string()
      .url()
      .max(200)
      .regex(ASCII_IMPRIMIVEL, 'Endereço só com caracteres ASCII.')
      .refine((u) => /^https:\/\//.test(u) && /\/v0\/?$/.test(u), 'Endereço https terminado em /v0.'),
    /** client_id do OAuth: ASCII imprimível (RFC 6749, apêndice A.1), sem espaço. */
    clientId: z.string().min(1).max(200).regex(ASCII_IMPRIMIVEL, 'Identificador só com caracteres ASCII.'),
    /** Autoridades certificadoras aceitas por este provedor (regra 1: pelo menos duas por mídia no conjunto). */
    autoridades: z
      .array(textoCp1252(80).pipe(z.string().min(2)))
      .min(1)
      .max(20),
    ativo: z.boolean(),
  })
  .strict();
export type ProvedorPsc = z.infer<typeof esquemaProvedorPsc>;

/** Troca do segredo do provedor: escrita só para o cofre; a resposta diz "definido", nunca o valor. */
export const esquemaSegredoProvedor = z
  .object({ segredo: z.string().min(8).max(4096), justificativa })
  .strict();
export type SegredoProvedor = z.infer<typeof esquemaSegredoProvedor>;

/** Reprocessar à mão uma assinatura pendente (o automático é do agendador; regra 5). */
export const esquemaReprocessarAssinatura = z.object({ assinatura: id }).strict();
export type ReprocessarAssinatura = z.infer<typeof esquemaReprocessarAssinatura>;

/** Código do verificador público (rota sem login). */
export const esquemaCodigoVerificacao = z
  .object({ codigo: z.string().regex(FORMATO_CODIGO_VERIFICACAO) })
  .strict();
export type CodigoVerificacao = z.infer<typeof esquemaCodigoVerificacao>;

/** Vincular o certificado em nuvem: o provedor; o certificado vem do próprio provedor depois da autorização. */
export const esquemaVincularNuvem = z.object({ provedor: codigoProvedor }).strict();
export type VincularNuvem = z.infer<typeof esquemaVincularNuvem>;

/** Assinatura de conferência do certificado vinculado (tela "Meu certificado"): prova o caminho inteiro, sem documento. */
export const esquemaTestarAssinatura = z.object({ certificado: id }).strict();
export type TestarAssinatura = z.infer<typeof esquemaTestarAssinatura>;

/** Tirar a regra cadastrada (volta a valer o piso legal): uma linha nova, inativa, com a justificativa. */
export const esquemaRemoverPoliticaAssinatura = z
  .object({
    tipoDocumento: z.enum(TIPOS_DOCUMENTO_POLITICA),
    conselho,
    destino: z.enum(DESTINOS_DOCUMENTO),
    justificativa,
  })
  .strict();
export type RemoverPoliticaAssinatura = z.infer<typeof esquemaRemoverPoliticaAssinatura>;

/** Salvar o provedor (inclusão com `versao` null; alteração com a versão lida, controle otimista). */
export const esquemaSalvarProvedorPsc = z
  .object({
    provedor: esquemaProvedorPsc,
    versao: z.number().int().positive().nullable(),
    justificativa,
  })
  .strict();
export type SalvarProvedorPsc = z.infer<typeof esquemaSalvarProvedorPsc>;

// ── M49, etapa 2: documentos emitidos ───────────────────────────────────────────────────────────────────────

/**
 * Preparar o lote (`documento.assinarLote`): gera a prévia exata (PDF/A com o selo) de cada documento escolhido, com o
 * certificado que vai assinar; a resposta traz o hash de cada prévia, que o pedido de assinatura devolve (regra 4).
 */
export const esquemaPrepararLoteIcp = z
  .object({
    documentos: z.array(id).min(1).max(TETO_LOTE_ASSINATURA),
    certificado: id,
  })
  .strict()
  .refine((x) => new Set(x.documentos).size === x.documentos.length, {
    path: ['documentos'],
    message: 'Documento repetido no lote.',
  });
export type PrepararLoteIcp = z.infer<typeof esquemaPrepararLoteIcp>;

/** Marcar avisos de assinatura pendente como lidos (o autor os dele; a direção técnica os do estabelecimento). */
export const esquemaMarcarAvisosAssinatura = z.object({ avisos: z.array(id).min(1).max(200) }).strict();
export type MarcarAvisosAssinatura = z.infer<typeof esquemaMarcarAvisosAssinatura>;

/** Pedir a numeração SNCR de uma receita (`documento.obterNumeracaoSncr`; chave `receita.sncr`, desligada). */
export const esquemaSolicitarSncr = z.object({ documento: id }).strict();
export type SolicitarSncr = z.infer<typeof esquemaSolicitarSncr>;

/**
 * M49 (etapa 3, opcional na ficha): pedir o desafio da entrada com certificado ICP-Brasil A1/A3 (o agente local assina
 * o hash do desafio; a chave nunca sai do computador). Sem senha: a prova é a assinatura com o certificado vinculado.
 */
export const esquemaDesafioLoginCertificado = z
  .object({
    estabelecimento: z.string().regex(/^[a-z0-9]{1,10}$/),
    login: z.string().trim().min(1).max(31),
  })
  .strict();
export type DesafioLoginCertificadoEntrada = z.infer<typeof esquemaDesafioLoginCertificado>;
