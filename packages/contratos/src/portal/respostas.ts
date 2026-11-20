// Respostas do portal do paciente, etapa 1 do M50: o que o servidor devolve ao portal e às telas internas. O portal
// nunca recebe ID interno do paciente, CPF, nome de outro paciente, conteúdo clínico não liberado nem segredo (o segredo do
// segundo fator sai uma vez, no cadastro, como endereço otpauth para o QR). Nomes de quem acessou o prontuário vão como o
// encarregado de dados decidir (D-ACESSO-50; proposta: nome e função do profissional, nunca a estação nem a tela).
import { z } from 'zod';
import {
  ENVIOS_TROCA_EMAIL,
  ETAPAS_COPIA_PORTAL,
  MEIOS_ENTREGA_COPIA_PORTAL,
  SOLICITANTES_COPIA_PORTAL,
  ESCOPOS_VINCULO,
  FINALIDADES_CONSENTIMENTO_PORTAL,
  METODOS_SEGUNDO_FATOR,
  MOTIVOS_CANCELAMENTO_PEDIDO_PORTAL,
  MOTIVOS_FIM_VINCULO,
  NATUREZAS_ACESSO_TITULAR,
  ORIGENS_ITEM_PORTAL,
  PROVAS_VINCULO,
  SITUACOES_CONTA_PORTAL,
  SITUACOES_PEDIDO_PORTAL,
  SITUACOES_VINCULO,
  TIPOS_PEDIDO_PORTAL,
  TIPOS_VINCULO_RESPONSAVEL,
} from './vocabulario.js';

const idTexto = z.string();
const instante = z.string();

/** Convite emitido (tela interna): o código aparece uma vez para imprimir e entregar ao paciente. */
export const esquemaConviteEmitido = z.object({
  conta: idTexto,
  codigo: z.string().regex(/^[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/),
  validoAte: instante,
  destino: z.enum(['legado', 'memoria']),
});
export type ConviteEmitido = z.infer<typeof esquemaConviteEmitido>;

/** Situação da conta do paciente vista pela recepção (sem e-mail completo, sem segredo). */
export const esquemaContaPortalResumo = z.object({
  conta: idTexto,
  situacao: z.enum(SITUACOES_CONTA_PORTAL),
  emailMascarado: z.string().nullable(),
  segundoFator: z.boolean(),
  criadaEm: instante,
  ativadaEm: instante.nullable(),
  ultimoAcessoEm: instante.nullable(),
  bloqueadaAte: instante.nullable(),
  motivo: z.string().nullable(),
  responsaveis: z.number().int().min(0),
});
export type ContaPortalResumo = z.infer<typeof esquemaContaPortalResumo>;

/** W0-10: a troca do e-mail pedida (o link saiu ao e-mail novo; a conta segue com o e-mail antigo até confirmar). */
export const esquemaTrocaEmailPedida = z.object({
  envio: z.enum(ENVIOS_TROCA_EMAIL),
  emailMascarado: z.string().nullable(),
  validoAte: instante,
  origem: z.enum(['portal', 'balcao']),
});
export type TrocaEmailPedida = z.infer<typeof esquemaTrocaEmailPedida>;

/** Resultado do passo de ativação: o endereço otpauth para o QR do aplicativo autenticador (uma vez). */
export const esquemaAtivacaoIniciada = z.object({
  metodo: z.enum(METODOS_SEGUNDO_FATOR),
  otpauth: z.string().startsWith('otpauth://totp/'),
});
export type AtivacaoIniciada = z.infer<typeof esquemaAtivacaoIniciada>;

/** Pessoa que a sessão pode ver: o próprio titular e os representados com vínculo vigente. */
export const esquemaTitularDaSessao = z.object({
  /** null: o próprio titular da conta. */
  vinculo: idTexto.nullable(),
  primeiroNome: z.string(),
  idade: z.number().int().min(0).nullable(),
  escopos: z.array(z.enum(ESCOPOS_VINCULO)),
});
export type TitularDaSessao = z.infer<typeof esquemaTitularDaSessao>;

export const esquemaSessaoContaPortal = z.object({
  hospital: z.string(),
  primeiroNome: z.string(),
  /** De quem a sessão está vendo os dados agora. */
  ativo: esquemaTitularDaSessao,
  titulares: z.array(esquemaTitularDaSessao),
  expiraEm: instante,
  /** A conta é só de responsável (o titular é menor ou curatelado): não tem dados próprios para ver. */
  soResponsavel: z.boolean(),
});
export type SessaoContaPortal = z.infer<typeof esquemaSessaoContaPortal>;

export const esquemaVinculoResumo = z.object({
  vinculo: idTexto,
  tipo: z.enum(TIPOS_VINCULO_RESPONSAVEL),
  prova: z.enum(PROVAS_VINCULO),
  situacao: z.enum(SITUACOES_VINCULO),
  escopos: z.array(z.enum(ESCOPOS_VINCULO)),
  pedidoEm: instante,
  decididoEm: instante.nullable(),
  validade: z.string().nullable(),
  /** Quando o vínculo acaba sozinho (maioridade do titular ou validade do documento). */
  terminaEm: z.string().nullable(),
  motivoFim: z.enum(MOTIVOS_FIM_VINCULO).nullable(),
  /** Do ponto de vista de quem lê: o responsável vê o representado; o titular vê o responsável. */
  primeiroNomeOutro: z.string(),
});
export type VinculoResumo = z.infer<typeof esquemaVinculoResumo>;

/** Fila da conferência de vínculos (tela interna): sem arquivo inline; a prova abre por endereço assinado. */
export const esquemaVinculoParaConferir = esquemaVinculoResumo.extend({
  prontuarioTitular: z.number().int(),
  idadeTitular: z.number().int().min(0).nullable(),
  responsavelConta: idTexto,
  /** Primeiro nome do responsável (o titular aparece em `primeiroNomeOutro`). */
  primeiroNomeResponsavel: z.string(),
  diasNaFila: z.number().int().min(0),
  canal: z.enum(['portal', 'balcao']),
  temArquivo: z.boolean(),
  /** O CPF do guardião no cadastro confere com o do cadastro do responsável (null: o responsável não é paciente). */
  guardiao: z.enum(['confere', 'nao-confere']).nullable(),
  /** O cadastro registra o titular como incapaz ou relativamente incapaz (ajuda a conferir o curador). */
  curatelado: z.boolean(),
  motivoRecusa: z.string().nullable(),
});
export type VinculoParaConferir = z.infer<typeof esquemaVinculoParaConferir>;

/** Uma página da fila da conferência (por ordem de chegada); `proximo` é o cursor da página seguinte (null: acabou). */
export const esquemaFilaVinculos = z.object({
  itens: z.array(esquemaVinculoParaConferir),
  proximo: idTexto.nullable(),
});
export type FilaVinculos = z.infer<typeof esquemaFilaVinculos>;

export const esquemaConsentimentoPortalItem = z.object({
  consentimento: z.number().int(),
  finalidade: z.enum(['atendimento', ...FINALIDADES_CONSENTIMENTO_PORTAL]),
  versao: z.string(),
  consentiu: z.boolean(),
  registradoEm: instante,
  /** Quem assinou: o próprio titular ou o representante legal. */
  signatario: z.enum(['paciente', 'representante-legal']),
  revogadoEm: instante.nullable(),
  /** `atendimento` não se muda pelo portal (base legal da tutela da saúde). */
  editavel: z.boolean(),
});
export type ConsentimentoPortalItem = z.infer<typeof esquemaConsentimentoPortalItem>;

export const esquemaPedidoTitularPortalItem = z.object({
  protocolo: z.string(),
  tipo: z.enum(TIPOS_PEDIDO_PORTAL),
  situacao: z.enum(SITUACOES_PEDIDO_PORTAL),
  abertoEm: instante,
  prazo: instante,
  atrasado: z.boolean(),
  respondidoEm: instante.nullable(),
  /** A resposta da área de privacidade (texto livre; o fundamento legal vem traduzido). */
  resposta: z.string().nullable(),
  fundamento: z.string().nullable(),
  /** W0-10: o motivo do cancelamento pelo titular (situação 'cancelado'). */
  motivoCancelamento: z.enum(MOTIVOS_CANCELAMENTO_PEDIDO_PORTAL).nullable(),
  /** W0-10: o titular ainda pode cancelar (não respondido nem cancelado). */
  cancelavel: z.boolean(),
  /** W0-10 (M3): pedido de portabilidade atendido: o pacote FHIR/IPS do titular está disponível para baixar. */
  pacoteIps: z.boolean(),
});
export type PedidoTitularPortalItem = z.infer<typeof esquemaPedidoTitularPortalItem>;

/** W0-10 (M2): a cópia do prontuário vista pelo portal (a etapa e o prazo; o PDF quando entregue pelo portal). */
export const esquemaCopiaPortalItem = z.object({
  protocolo: z.string(),
  situacao: z.enum(SITUACOES_PEDIDO_PORTAL),
  etapa: z.enum(ETAPAS_COPIA_PORTAL),
  solicitante: z.enum(SOLICITANTES_COPIA_PORTAL),
  abertoEm: instante,
  prazo: instante,
  atrasado: z.boolean(),
  entregueEm: instante.nullable(),
  meio: z.enum(MEIOS_ENTREGA_COPIA_PORTAL).nullable(),
  /** Entregue pelo portal: o titular baixa o PDF (o download vai à trilha). */
  baixavel: z.boolean(),
});
export type CopiaPortalItem = z.infer<typeof esquemaCopiaPortalItem>;

/** W0-10 (M2), balcão: a linha da fila da cópia. */
export const esquemaCopiaNaFila = z.object({
  protocolo: z.string(),
  situacao: z.enum(SITUACOES_PEDIDO_PORTAL),
  canal: z.string(),
  paciente: z.number().int(),
  prontuario: z.number().int().nullable(),
  abertoEm: instante,
  prazo: instante,
  atrasado: z.boolean(),
  solicitante: z.enum(SOLICITANTES_COPIA_PORTAL),
  vinculo: idTexto.nullable(),
  etapa: z.enum(ETAPAS_COPIA_PORTAL),
  geracoes: z.number().int().min(0),
});
export type CopiaNaFilaItem = z.infer<typeof esquemaCopiaNaFila>;

/** W0-10 (M2), balcão: os atos de uma cópia (sem a prova nem o recebedor, que ficam no balcão que os registrou). */
export const esquemaAtoCopiaItem = z.object({
  ato: z.enum(['solicitacao', 'legitimidade', 'geracao', 'entrega']),
  em: instante,
  usuario: z.string(),
  hash: z.string().nullable(),
  paginas: z.number().int().nullable(),
  meio: z.enum(MEIOS_ENTREGA_COPIA_PORTAL).nullable(),
});
export type AtoCopiaItem = z.infer<typeof esquemaAtoCopiaItem>;

export const esquemaItemDocumentoPortal = z.object({
  origem: z.enum(ORIGENS_ITEM_PORTAL),
  item: idTexto,
  /** Rótulo de produto (exame, receita, atestado...). */
  titulo: z.string(),
  data: instante,
  profissional: z.string().nullable(),
  assinatura: z.enum(['icp-brasil', 'eletronica-avancada', 'eletronica-simples']).nullable(),
  visto: z.boolean(),
  /** Código do verificador público (M49 etapa 3), quando houver. */
  verificacao: z.string().nullable(),
});
export type ItemDocumentoPortal = z.infer<typeof esquemaItemDocumentoPortal>;

/** Documento aberto no portal (o PDF assinado sai por outra rota; aqui o que a tela mostra). */
export const esquemaDocumentoPortalAberto = z.object({
  item: esquemaItemDocumentoPortal,
  /** Há PDF assinado para baixar (a assinatura ICP concluída). */
  temPdf: z.boolean(),
});
export type DocumentoPortalAberto = z.infer<typeof esquemaDocumentoPortalAberto>;

export const esquemaListaDocumentosPortal = z.object({
  itens: z.array(esquemaItemDocumentoPortal),
  haMais: z.boolean(),
  /** Assinatura dos documentos ainda não ligada: só resultados aparecem (M49). */
  semDocumentosAssinados: z.boolean(),
});
export type ListaDocumentosPortal = z.infer<typeof esquemaListaDocumentosPortal>;

export const esquemaAcessoTitularItem = z.object({
  dia: z.string(),
  natureza: z.enum(NATUREZAS_ACESSO_TITULAR),
  /** Nome e função de quem acessou (D-ACESSO-50); "Você" ou "Seu responsável" nos acessos pelo portal. */
  quem: z.string(),
  funcao: z.string().nullable(),
  vezes: z.number().int().min(1),
  primeiraEm: instante,
  ultimaEm: instante,
});
export type AcessoTitularItem = z.infer<typeof esquemaAcessoTitularItem>;

export const esquemaRelatorioAcessosTitular = z.object({
  itens: z.array(esquemaAcessoTitularItem),
  de: z.string(),
  ate: z.string(),
  haMais: z.boolean(),
});
export type RelatorioAcessosTitular = z.infer<typeof esquemaRelatorioAcessosTitular>;

/** W0-10 (M1): a manifestação à ouvidoria feita pelo portal, com o protocolo, a situação e a resposta. */
export const esquemaManifestacaoPortalItem = z.object({
  protocolo: z.string(),
  tipo: z.enum(['elogio', 'reclamacao', 'sugestao', 'solicitacao', 'informacao', 'denuncia']),
  area: z.string(),
  relato: z.string(),
  recebidaEm: z.string(),
  prazoEm: z.string(),
  situacao: z.enum(['aberta', 'encaminhada', 'respondida', 'cancelada']),
  /** A resposta da ouvidoria (só depois de respondida). */
  resposta: z.string().nullable(),
  respondidaEm: z.string().nullable(),
});
export type ManifestacaoPortalItem = z.infer<typeof esquemaManifestacaoPortalItem>;
