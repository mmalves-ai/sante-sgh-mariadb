// Entradas do portal do paciente, etapa 1 do M50 (ficha, seções 5 e 7): o que a tela do portal e as telas internas
// mandam e o servidor valida (o mesmo Zod). O portal nunca manda o ID do paciente nem o do titular escolhido: o servidor
// tira os dois da sessão do portal (conta e vínculos vigentes). Senha e código do segundo fator nunca vão a log.
import { z } from 'zod';
import { textoCp1252 } from '../texto-cp1252.js';
import {
  MEIOS_ENTREGA_COPIA_PORTAL,
  SOLICITANTES_COPIA_PORTAL,
  FINALIDADES_CONSENTIMENTO_PORTAL,
  MOTIVOS_BLOQUEIO_CONTA,
  MOTIVOS_CANCELAMENTO_PEDIDO_PORTAL,
  MOTIVOS_ENCERRAMENTO_CONTA,
  MOTIVOS_REDEFINIR_SEGUNDO_FATOR,
  MOTIVOS_TROCA_EMAIL_BALCAO,
  ORIGENS_CONVITE_PORTAL,
  PROVAS_VINCULO,
  ESCOPOS_VINCULO,
  TIPOS_PEDIDO_PORTAL,
  TIPOS_VINCULO_RESPONSAVEL,
} from './vocabulario.js';

const id = z.number().int().positive();
const idGrande = z.string().regex(/^[1-9]\d{0,18}$/, 'Identificador inválido.');
const data = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, 'Data no formato AAAA-MM-DD.');
const codigoTotp = z.string().regex(/^\d{6}$/, 'O código tem 6 dígitos.');
/** Código do convite: 12 caracteres sem ambiguidade (sem 0/O e 1/I), em grupos de 4 com hífen opcional. */
const codigoConvite = z
  .string()
  .transform((s) => s.toUpperCase().replace(/[\s-]/g, ''))
  .pipe(z.string().regex(/^[2-9A-HJ-NP-Z]{12}$/, 'Código do convite inválido.'));
const email = z.string().trim().toLowerCase().max(100).pipe(z.email('E-mail inválido.'));
const senha = z.string().min(1).max(200);
const versaoTermo = z.string().trim().min(1).max(20);

// ── Telas internas (recepção, atendimento, privacidade) ────────────────────────────────────────────────────────────

/** Emitir o convite do portal para o paciente (o código sai impresso; nenhuma mensagem até a DP-44 a). */
export const esquemaConvidarContaPortal = z
  .object({
    idPaciente: id,
    origem: z.enum(ORIGENS_CONVITE_PORTAL),
  })
  .strict();
export type ConvidarContaPortal = z.infer<typeof esquemaConvidarContaPortal>;

/**
 * Responsável que não é paciente (D-RESP-50), no balcão: quem conferiu o documento original cria a conta de
 * responsável (nome e nascimento, nada vai ao cadastro) e o vínculo com o titular já liberado; o convite sai impresso.
 */
export const esquemaConvidarResponsavelBalcao = z
  .object({
    idTitular: id,
    nome: textoCp1252(70).pipe(z.string().min(3, 'Informe o nome do responsável.')),
    nascimento: data,
    tipo: z.enum(TIPOS_VINCULO_RESPONSAVEL),
    prova: z.enum(PROVAS_VINCULO),
    validade: data.nullable().default(null),
    escopos: z.array(z.enum(ESCOPOS_VINCULO)).max(ESCOPOS_VINCULO.length),
  })
  .strict();
export type ConvidarResponsavelBalcao = z.infer<typeof esquemaConvidarResponsavelBalcao>;

/** O arquivo da prova de vínculo (foto ou PDF, em base64; até 700 KB: a tela reduz a foto antes de enviar). */
export const TIPOS_ARQUIVO_PROVA = ['image/jpeg', 'image/png', 'application/pdf'] as const;
export const TAMANHO_MAXIMO_PROVA = 700_000;
export const esquemaArquivoProva = z
  .object({
    tipo: z.enum(TIPOS_ARQUIVO_PROVA),
    conteudo: z
      .string()
      .min(16)
      .max(Math.ceil((TAMANHO_MAXIMO_PROVA * 4) / 3) + 4)
      .regex(/^[A-Za-z0-9+/=]+$/),
  })
  .strict();
export type ArquivoProva = z.infer<typeof esquemaArquivoProva>;

export const esquemaBloquearContaPortal = z
  .object({
    conta: idGrande,
    motivo: z.enum(MOTIVOS_BLOQUEIO_CONTA),
    justificativa: textoCp1252(400).pipe(z.string().min(10, 'Justifique com pelo menos 10 caracteres.')),
  })
  .strict();
export type BloquearContaPortal = z.infer<typeof esquemaBloquearContaPortal>;

export const esquemaDesbloquearContaPortal = z
  .object({
    conta: idGrande,
    justificativa: textoCp1252(400).pipe(z.string().min(10, 'Justifique com pelo menos 10 caracteres.')),
    /** Zera o segundo fator (aparelho perdido): o paciente cadastra outro na próxima entrada. */
    refazerSegundoFator: z.boolean().default(false),
  })
  .strict();
export type DesbloquearContaPortal = z.infer<typeof esquemaDesbloquearContaPortal>;

export const esquemaEncerrarContaPortal = z
  .object({
    conta: idGrande,
    motivo: z.enum(MOTIVOS_ENCERRAMENTO_CONTA),
    justificativa: textoCp1252(400).pipe(z.string().min(10, 'Justifique com pelo menos 10 caracteres.')),
  })
  .strict();
export type EncerrarContaPortal = z.infer<typeof esquemaEncerrarContaPortal>;

/** Decisão da conferência do vínculo (a prova é conferida no documento original; o arquivo fica no S3). */
export const esquemaDecidirVinculo = z.discriminatedUnion('decisao', [
  z
    .object({
      decisao: z.literal('aprovar'),
      vinculo: idGrande,
      /** Escopo concedido (procurador: o que a procuração permite). */
      escopos: z.array(z.enum(ESCOPOS_VINCULO)).max(ESCOPOS_VINCULO.length),
      /** Validade do documento (obrigatória para procurador). */
      validade: data.nullable().default(null),
    })
    .strict(),
  z
    .object({
      decisao: z.literal('recusar'),
      vinculo: idGrande,
      motivo: textoCp1252(400).pipe(z.string().min(10, 'Diga o motivo com pelo menos 10 caracteres.')),
    })
    .strict(),
]);
export type DecidirVinculo = z.infer<typeof esquemaDecidirVinculo>;

export const esquemaEncerrarVinculo = z
  .object({
    vinculo: idGrande,
    motivo: z.enum(['revogado-pelo-hospital', 'decisao-judicial', 'obito-do-titular']),
    justificativa: textoCp1252(400).pipe(z.string().min(10, 'Justifique com pelo menos 10 caracteres.')),
  })
  .strict();
export type EncerrarVinculo = z.infer<typeof esquemaEncerrarVinculo>;

// ── Portal (sessão do portal) ─────────────────────────────────────────────────────────────────────────────────────

/**
 * Primeiro passo da ativação: o código do convite e a data de nascimento do cadastro. Erro genérico (nunca diz qual dos
 * dois não confere) e limite de tentativas por convite e de taxa por origem.
 */
export const esquemaConferirConvite = z
  .object({
    codigo: codigoConvite,
    nascimento: data,
  })
  .strict();
export type ConferirConvite = z.infer<typeof esquemaConferirConvite>;

/** Segundo passo: e-mail de entrada, senha, aceite do termo de uso e da política de privacidade (versões). */
export const esquemaAtivarContaPortal = z
  .object({
    codigo: codigoConvite,
    nascimento: data,
    email,
    senha,
    confirmacao: senha,
    termoUso: versaoTermo,
    politicaPrivacidade: versaoTermo,
  })
  .strict()
  .refine((x) => x.senha === x.confirmacao, {
    message: 'A confirmação não confere com a senha.',
    path: ['confirmacao'],
  });
export type AtivarContaPortal = z.infer<typeof esquemaAtivarContaPortal>;

/** Terceiro passo: o primeiro código do aplicativo autenticador confirma o segundo fator; só então a conta fica ativa. */
export const esquemaConfirmarSegundoFator = z.object({ codigo: codigoTotp }).strict();
export type ConfirmarSegundoFator = z.infer<typeof esquemaConfirmarSegundoFator>;

export const esquemaEntrarContaPortal = z
  .object({
    email,
    senha,
    codigo: codigoTotp,
  })
  .strict();
export type EntrarContaPortal = z.infer<typeof esquemaEntrarContaPortal>;

export const esquemaTrocarSenhaPortal = z
  .object({
    atual: senha,
    nova: senha,
    confirmacao: senha,
    codigo: codigoTotp,
  })
  .strict()
  .refine((x) => x.nova === x.confirmacao, {
    message: 'A confirmação não confere com a senha nova.',
    path: ['confirmacao'],
  });
export type TrocarSenhaPortal = z.infer<typeof esquemaTrocarSenhaPortal>;

// ── W0-10: troca do e-mail de acesso e do autenticador ─────────────────────────────────────────────────────────────

/** A senha atual e o código do autenticador atual: a prova de quem pede a troca do e-mail ou do autenticador. */
export const esquemaConferirCredenciaisPortal = z.object({ senha, codigo: codigoTotp }).strict();
export type ConferirCredenciaisPortal = z.infer<typeof esquemaConferirCredenciaisPortal>;

/** O paciente pede a troca do e-mail: só vale depois do link confirmado no e-mail NOVO. */
export const esquemaPedirTrocaEmailPortal = z.object({ email, senha, codigo: codigoTotp }).strict();
export type PedirTrocaEmailPortal = z.infer<typeof esquemaPedirTrocaEmailPortal>;

/** O token do link enviado ao e-mail novo (256 bits em base64url). */
export const esquemaConfirmarTrocaEmailPortal = z
  .object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'Link de confirmação inválido.') })
  .strict();
export type ConfirmarTrocaEmailPortal = z.infer<typeof esquemaConfirmarTrocaEmailPortal>;

/** O atendente registra o e-mail novo no balcão (com o documento conferido); a troca também espera a confirmação. */
export const esquemaTrocarEmailContaPortal = z
  .object({
    conta: idGrande,
    email,
    motivo: z.enum(MOTIVOS_TROCA_EMAIL_BALCAO),
    justificativa: textoCp1252(400).pipe(z.string().min(10, 'Justifique com pelo menos 10 caracteres.')),
  })
  .strict();
export type TrocarEmailContaPortal = z.infer<typeof esquemaTrocarEmailContaPortal>;

/** O atendente redefine o segundo fator: a conta volta a convidada e sai um convite novo, impresso. */
export const esquemaRedefinirSegundoFatorPortal = z
  .object({
    conta: idGrande,
    motivo: z.enum(MOTIVOS_REDEFINIR_SEGUNDO_FATOR),
    justificativa: textoCp1252(400).pipe(z.string().min(10, 'Justifique com pelo menos 10 caracteres.')),
  })
  .strict();
export type RedefinirSegundoFatorPortal = z.infer<typeof esquemaRedefinirSegundoFatorPortal>;

/** De quem a sessão está vendo os dados: o próprio titular (null) ou um representado com vínculo vigente. */
export const esquemaEscolherTitular = z.object({ vinculo: idGrande.nullable() }).strict();
export type EscolherTitular = z.infer<typeof esquemaEscolherTitular>;

/**
 * Pedido de vínculo feito pelo responsável no portal: o representado pelo prontuário e a data de nascimento (o mesmo
 * erro genérico do convite), o tipo de vínculo e a prova (o arquivo sobe à parte; aqui só a chave do envio).
 */
export const esquemaPedirVinculo = z
  .object({
    prontuario: z.number().int().positive().max(2_147_483_647),
    nascimento: data,
    tipo: z.enum(TIPOS_VINCULO_RESPONSAVEL),
    prova: z.enum(PROVAS_VINCULO),
    /** Chave do arquivo da prova no S3 (enviado antes, pelo endereço assinado do servidor). */
    arquivo: z.string().regex(/^[a-z0-9][a-z0-9/_-]{8,200}$/, 'Arquivo inválido.'),
    validade: data.nullable().default(null),
  })
  .strict();
export type PedirVinculo = z.infer<typeof esquemaPedirVinculo>;

/** O titular (maior) revoga o acesso de um responsável (procurador, por exemplo). */
export const esquemaRevogarVinculoPeloTitular = z.object({ vinculo: idGrande }).strict();
export type RevogarVinculoPeloTitular = z.infer<typeof esquemaRevogarVinculoPeloTitular>;

/** Consentimento pelo portal: só as finalidades que dependem de consentimento; a versão do termo é a vigente. */
export const esquemaConsentimentoPortal = z.discriminatedUnion('acao', [
  z
    .object({
      acao: z.literal('consentir'),
      finalidade: z.enum(FINALIDADES_CONSENTIMENTO_PORTAL),
      versao: versaoTermo,
    })
    .strict(),
  z
    .object({
      acao: z.literal('nao-consentir'),
      finalidade: z.enum(FINALIDADES_CONSENTIMENTO_PORTAL),
      versao: versaoTermo,
    })
    .strict(),
  z.object({ acao: z.literal('revogar'), consentimento: id }).strict(),
]);
export type ConsentimentoPortalEntrada = z.infer<typeof esquemaConsentimentoPortal>;

/** Pedido do titular pelo portal (LGPD art. 18): o tipo e a descrição livre (só a privacidade lê). */
export const esquemaPedidoTitularPortal = z
  .object({
    tipo: z.enum(TIPOS_PEDIDO_PORTAL),
    descricao: textoCp1252(1000).nullable().default(null),
  })
  .strict();
export type PedidoTitularPortalEntrada = z.infer<typeof esquemaPedidoTitularPortal>;

/** W0-10: o titular cancela o pedido ainda não respondido, com o motivo (a observação é opcional). */
export const esquemaCancelarPedidoPortal = z
  .object({
    motivo: z.enum(MOTIVOS_CANCELAMENTO_PEDIDO_PORTAL),
    observacao: textoCp1252(500).nullable().default(null),
  })
  .strict();
export type CancelarPedidoPortal = z.infer<typeof esquemaCancelarPedidoPortal>;

/** W0-10 (M2): a cópia do prontuário pedida pelo portal (titular ou representante da sessão); a observação é opcional. */
export const esquemaPedirCopiaPortal = z
  .object({ observacao: textoCp1252(500).nullable().default(null) })
  .strict();
export type PedirCopiaPortal = z.infer<typeof esquemaPedirCopiaPortal>;

const protocoloPedido = z.string().regex(/^\d{4}-\d{6}$/, 'Protocolo inválido.');

/** W0-10 (M2), balcão: a fila da cópia (só as pendentes por padrão; ou as de um paciente). */
export const esquemaFiltroFilaCopias = z
  .object({ pendentes: z.boolean().default(true), paciente: id.optional() })
  .strict();
export type FiltroFilaCopias = z.infer<typeof esquemaFiltroFilaCopias>;

/** W0-10 (M2), balcão: abrir o pedido de cópia de quem veio pessoalmente (titular, representante ou familiar). */
export const esquemaPedirCopiaBalcao = z
  .object({
    paciente: id,
    solicitante: z.enum(SOLICITANTES_COPIA_PORTAL),
    vinculo: idGrande.nullable().default(null),
    prova: textoCp1252(200).nullable().default(null),
    observacao: textoCp1252(500).nullable().default(null),
  })
  .strict();
export type PedirCopiaBalcao = z.infer<typeof esquemaPedirCopiaBalcao>;

/** W0-10 (M2), balcão: a conferência da legitimidade de quem pede (com reautenticação). */
export const esquemaConferirLegitimidadeCopia = z
  .object({
    protocolo: protocoloPedido,
    solicitante: z.enum(SOLICITANTES_COPIA_PORTAL),
    vinculo: idGrande.nullable().default(null),
    prova: textoCp1252(200).nullable().default(null),
    senha: senha.optional(),
  })
  .strict();
export type ConferirLegitimidadeCopia = z.infer<typeof esquemaConferirLegitimidadeCopia>;

/** W0-10 (M2), balcão: gerar o PDF da cópia (cada geração vai à trilha com o hash). */
export const esquemaGerarCopia = z.object({ protocolo: protocoloPedido }).strict();
export type GerarCopia = z.infer<typeof esquemaGerarCopia>;

/** W0-10 (M2), balcão: a entrega (pelo portal, no balcão ou pelo correio, com quem recebeu), com reautenticação. */
export const esquemaEntregarCopia = z
  .object({
    protocolo: protocoloPedido,
    meio: z.enum(MEIOS_ENTREGA_COPIA_PORTAL),
    recebedor: textoCp1252(120).nullable().default(null),
    senha: senha.optional(),
  })
  .strict();
export type EntregarCopia = z.infer<typeof esquemaEntregarCopia>;

/** Relatório de acessos ao próprio prontuário: período em dias civis (janela máxima conferida no servidor). */
export const esquemaFiltroAcessosTitular = z
  .object({
    de: data,
    ate: data,
    pagina: z.number().int().min(1).max(1000).default(1),
  })
  .strict()
  .refine((x) => x.de <= x.ate, { message: 'O início vem antes do fim.', path: ['de'] });
export type FiltroAcessosTitular = z.infer<typeof esquemaFiltroAcessosTitular>;

/** Abrir um item da lista de documentos (grava a visualização: PORTAL_DOCUMENTO_VISTO). */
export const esquemaAbrirItemPortal = z
  .object({
    origem: z.enum(['resultado', 'documento']),
    item: idGrande,
    baixar: z.boolean().default(false),
  })
  .strict();
export type AbrirItemPortal = z.infer<typeof esquemaAbrirItemPortal>;

/**
 * W0-10 (M1): a manifestação à ouvidoria pelo portal (elogio, reclamação, sugestão, solicitação ou pedido de
 * informação). O servidor grava na ouvidoria interna (canal "portal", identificada com o paciente da sessão), com o
 * protocolo e o prazo da ouvidoria; a área é opcional (a ouvidoria a ajusta ao encaminhar).
 */
export const TIPOS_MANIFESTACAO_PORTAL = [
  'elogio',
  'reclamacao',
  'sugestao',
  'solicitacao',
  'informacao',
] as const;
export const esquemaManifestacaoPortal = z
  .object({
    tipo: z.enum(TIPOS_MANIFESTACAO_PORTAL),
    area: textoCp1252(80).nullable().default(null),
    relato: textoCp1252(4000).refine((s) => s.trim().length >= 10, {
      message: 'Conte com pelo menos 10 caracteres.',
    }),
  })
  .strict();
export type ManifestacaoPortalEntrada = z.infer<typeof esquemaManifestacaoPortal>;
