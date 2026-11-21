// Vocabulário do portal do paciente, etapa 1 do M50 (ficha, seções 5 a 8; cap-07 §7.6; cap-13 §13.3.6; LGPD art. 14 e
// 18; SBIS-24): conta própria com segundo fator (identidade separada dos usuários internos, nunca a tabela de usuários), responsável
// legal com prova de vínculo, consentimentos por finalidade, pedidos do titular e o relatório de quem acessou o próprio
// prontuário. A conta liga ao paciente pelo ID do cadastro e pelo prontuário (sobrevive à unificação). Nenhum texto daqui
// cita outro sistema (ADR 0023).
import { CANAIS_PEDIDO, SITUACOES_PEDIDO_TITULAR, TIPOS_PEDIDO_TITULAR } from '../administracao/auditoria.js';
import { FINALIDADES_CONSENTIMENTO } from '../cadastro/telas.js';

/** Chave de liberação do portal do paciente (SGH_CFG_LIBERACAO; ficha, seção 12). */
export const CHAVE_PORTAL_CONTA = 'portal.conta';

// ── Conta ──────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Situação da conta (SGH_POR_CONTA.SITUACAO): `convidada` (convite emitido, ainda sem senha nem segundo fator),
 * `ativa`, `bloqueada` (tentativas esgotadas ou decisão do hospital; volta a ativa) e `encerrada` (fim; nunca volta).
 */
export const SITUACOES_CONTA_PORTAL = ['convidada', 'ativa', 'bloqueada', 'encerrada'] as const;
export type SituacaoContaPortal = (typeof SITUACOES_CONTA_PORTAL)[number];

/** Quem emitiu o convite (a conta nunca nasce sem o hospital conferir a pessoa uma vez). */
export const ORIGENS_CONVITE_PORTAL = ['recepcao', 'atendimento', 'privacidade'] as const;
export type OrigemConvitePortal = (typeof ORIGENS_CONVITE_PORTAL)[number];

export const MOTIVOS_BLOQUEIO_CONTA = [
  'tentativas',
  'suspeita-de-fraude',
  'pedido-do-titular',
  'decisao-do-hospital',
] as const;
export type MotivoBloqueioConta = (typeof MOTIVOS_BLOQUEIO_CONTA)[number];

export const MOTIVOS_ENCERRAMENTO_CONTA = [
  'pedido-do-titular',
  'obito',
  'unificacao',
  'decisao-do-hospital',
] as const;
export type MotivoEncerramentoConta = (typeof MOTIVOS_ENCERRAMENTO_CONTA)[number];

/** W0-10: por que o atendente troca o e-mail de acesso no balcão (a troca só vale com a confirmação no e-mail novo). */
export const MOTIVOS_TROCA_EMAIL_BALCAO = ['email-perdido', 'email-errado', 'pedido-do-titular'] as const;
export type MotivoTrocaEmailBalcao = (typeof MOTIVOS_TROCA_EMAIL_BALCAO)[number];

/** W0-10: por que o atendente redefine o segundo fator (o acesso é refeito por convite novo, impresso). */
export const MOTIVOS_REDEFINIR_SEGUNDO_FATOR = [
  'aparelho-perdido',
  'aparelho-trocado',
  'suspeita-de-fraude',
  'pedido-do-titular',
] as const;
export type MotivoRedefinirSegundoFator = (typeof MOTIVOS_REDEFINIR_SEGUNDO_FATOR)[number];

/** W0-10: por onde saiu o link da confirmação do e-mail novo (no dev, só o simulador; em produção, a Hal-AI). */
export const ENVIOS_TROCA_EMAIL = ['simulador', 'halai'] as const;
export type EnvioTrocaEmail = (typeof ENVIOS_TROCA_EMAIL)[number];

/**
 * Segundo fator: só o aplicativo autenticador (TOTP, RFC 6238). Código por SMS, e-mail ou WhatsApp seria mensagem ao
 * paciente, que só sai pela Hal-AI e só depois da DP-44 (a); até lá, não há segundo fator por mensagem.
 */
export const METODOS_SEGUNDO_FATOR = ['totp'] as const;
export type MetodoSegundoFator = (typeof METODOS_SEGUNDO_FATOR)[number];

/** Idade da conta própria (abaixo dela, o acesso é só pelo responsável legal; D-MENOR-50). */
export const IDADE_CONTA_PROPRIA = 18;

// ── Responsável legal ──────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Vínculo do responsável com o titular: pai ou mãe (poder familiar), tutor, guardião (guarda judicial), curador (maior
 * curatelado; Lei 13.146/2015, art. 84) e procurador (maior capaz, procuração com validade).
 */
export const TIPOS_VINCULO_RESPONSAVEL = ['pai-mae', 'tutor', 'guardiao', 'curador', 'procurador'] as const;
export type TipoVinculoResponsavel = (typeof TIPOS_VINCULO_RESPONSAVEL)[number];

/** Vínculos que só valem enquanto o titular é menor (acabam sozinhos na maioridade). */
export const VINCULOS_DE_MENOR: readonly TipoVinculoResponsavel[] = ['pai-mae', 'tutor', 'guardiao'];

/** Vínculos que exigem validade (o documento vence). */
export const VINCULOS_COM_VALIDADE: readonly TipoVinculoResponsavel[] = ['procurador'];

export const PROVAS_VINCULO = [
  'certidao-nascimento',
  'documento-com-filiacao',
  'termo-guarda',
  'termo-tutela',
  'termo-curatela',
  'procuracao',
] as const;
export type ProvaVinculo = (typeof PROVAS_VINCULO)[number];

/** Provas aceitas por tipo de vínculo (a recepção ou a privacidade confere o documento original). */
export const PROVAS_ACEITAS: Readonly<Record<TipoVinculoResponsavel, readonly ProvaVinculo[]>> = {
  'pai-mae': ['certidao-nascimento', 'documento-com-filiacao'],
  tutor: ['termo-tutela'],
  guardiao: ['termo-guarda'],
  curador: ['termo-curatela'],
  procurador: ['procuracao'],
};

/** SGH_POR_RESPONSAVEL.SITUACAO. */
export const SITUACOES_VINCULO = ['pendente', 'ativo', 'recusado', 'encerrado'] as const;
export type SituacaoVinculo = (typeof SITUACOES_VINCULO)[number];

export const MOTIVOS_FIM_VINCULO = [
  'maioridade',
  'validade',
  'revogado-pelo-titular',
  'revogado-pelo-hospital',
  'obito-do-titular',
  'decisao-judicial',
] as const;
export type MotivoFimVinculo = (typeof MOTIVOS_FIM_VINCULO)[number];

/** O que o responsável pode fazer em nome do titular (agendamentos entram na etapa 2). */
export const ESCOPOS_VINCULO = ['documentos', 'consentimentos', 'pedidos', 'agendamentos'] as const;
export type EscopoVinculo = (typeof ESCOPOS_VINCULO)[number];

/** Escopo padrão de cada vínculo (procurador: só o que a procuração disser, começando sem nada). */
export const ESCOPO_PADRAO_VINCULO: Readonly<Record<TipoVinculoResponsavel, readonly EscopoVinculo[]>> = {
  'pai-mae': ['documentos', 'consentimentos', 'pedidos', 'agendamentos'],
  tutor: ['documentos', 'consentimentos', 'pedidos', 'agendamentos'],
  guardiao: ['documentos', 'consentimentos', 'pedidos', 'agendamentos'],
  curador: ['documentos', 'consentimentos', 'pedidos', 'agendamentos'],
  procurador: [],
};

// ── Consentimentos e pedidos do titular ────────────────────────────────────────────────────────────────────────────

/**
 * Finalidades que o paciente muda pelo portal. `atendimento` não está aqui: o tratamento para o próprio atendimento tem
 * base legal na tutela da saúde (LGPD art. 11, II, f) e não depende de consentimento; o portal só mostra.
 */
export const FINALIDADES_CONSENTIMENTO_PORTAL = FINALIDADES_CONSENTIMENTO.filter(
  (f): f is Exclude<(typeof FINALIDADES_CONSENTIMENTO)[number], 'atendimento'> => f !== 'atendimento',
);
export type FinalidadeConsentimentoPortal = (typeof FINALIDADES_CONSENTIMENTO_PORTAL)[number];

/**
 * Signatário do consentimento no domínio do cadastro (tipo de representante, lido ao vivo pela descrição: na cópia do pc, 1
 * "Paciente" e 2 "Representante Legal").
 */
export const SIGNATARIOS_PORTAL = ['paciente', 'representante-legal'] as const;
export type SignatarioPortal = (typeof SIGNATARIOS_PORTAL)[number];

/** Canal gravado em SGH_AUD_PEDIDO_TITULAR.CANAL (VARCHAR(20), sem restrição: não precisa de DDL). */
export const CANAL_PEDIDO_PORTAL = 'portal';
export const CANAIS_PEDIDO_COM_PORTAL = [...CANAIS_PEDIDO, CANAL_PEDIDO_PORTAL] as const;
export type CanalPedidoComPortal = (typeof CANAIS_PEDIDO_COM_PORTAL)[number];

/** Tipos de pedido que o titular abre pelo portal (todos os da LGPD art. 18). */
export const TIPOS_PEDIDO_PORTAL = TIPOS_PEDIDO_TITULAR;
export type TipoPedidoPortal = (typeof TIPOS_PEDIDO_PORTAL)[number];
export const SITUACOES_PEDIDO_PORTAL = SITUACOES_PEDIDO_TITULAR;
/** W0-10: motivos do cancelamento do pedido pelo titular (iguais aos do domínio e ao CHECK do script 1141). */
export const MOTIVOS_CANCELAMENTO_PEDIDO_PORTAL = [
  'desistencia',
  'aberto-por-engano',
  'em-duplicidade',
  'resolvido-de-outra-forma',
] as const;
export type MotivoCancelamentoPedidoPortal = (typeof MOTIVOS_CANCELAMENTO_PEDIDO_PORTAL)[number];

/**
 * W0-10 (M2): a cópia do prontuário sobre o pedido de acesso (iguais aos do domínio, @sgh/dominio-acesso, e aos CHECK
 * do script 1144). O herdeiro (familiar do falecido) só pede no balcão.
 */
export const SOLICITANTES_COPIA_PORTAL = ['titular', 'representante', 'herdeiro'] as const;
export type SolicitanteCopiaPortal = (typeof SOLICITANTES_COPIA_PORTAL)[number];
export const ETAPAS_COPIA_PORTAL = [
  'aguardando-conferencia',
  'legitimidade-conferida',
  'gerada',
  'entregue',
] as const;
export type EtapaCopiaPortal = (typeof ETAPAS_COPIA_PORTAL)[number];
export const MEIOS_ENTREGA_COPIA_PORTAL = ['portal', 'balcao', 'correio'] as const;
export type MeioEntregaCopiaPortal = (typeof MEIOS_ENTREGA_COPIA_PORTAL)[number];

// ── Documentos e resultados ────────────────────────────────────────────────────────────────────────────────────────

/**
 * Tipos de documento do prontuário (SGH_PEP_DOCUMENTO.TIPO) que podem aparecer no portal, assinados (regra 1; D-DOC-50).
 * Nunca: registro clínico (evolução), alergia, anexo, exame externo, relatório de transferência, declaração de óbito e
 * requerimento; prescrição e evolução não são documento do paciente.
 */
export const TIPOS_DOCUMENTO_PORTAL = [
  'receita',
  'receita-controlada',
  'receita-antimicrobiano',
  'atestado',
  'declaracao',
  'sumario-alta',
  'pedido-exame',
  'tcle',
] as const;
export type TipoDocumentoPortal = (typeof TIPOS_DOCUMENTO_PORTAL)[number];

/** Níveis de assinatura (SGH_PEP_DOCUMENTO.NIVEL_ASSINATURA), do mais fraco ao mais forte. */
export const NIVEIS_ASSINATURA_DOCUMENTO = [
  'eletronica-simples',
  'eletronica-avancada',
  'icp-brasil',
] as const;
export type NivelAssinaturaDocumento = (typeof NIVEIS_ASSINATURA_DOCUMENTO)[number];

/** Itens da tela "Resultados, receitas e documentos". */
export const ORIGENS_ITEM_PORTAL = ['resultado', 'documento'] as const;
export type OrigemItemPortal = (typeof ORIGENS_ITEM_PORTAL)[number];

// ── Relatório de acessos ao próprio prontuário (SBIS-24; LGPD art. 18, II e VII) ───────────────────────────────────

/** Como o acesso aparece ao titular (sem tela interna, sem termo de busca, sem estação). */
export const NATUREZAS_ACESSO_TITULAR = [
  'consulta-ao-prontuario',
  'lista-de-pacientes',
  'busca',
  'acesso-de-emergencia',
  'portal',
] as const;
export type NaturezaAcessoTitular = (typeof NATUREZAS_ACESSO_TITULAR)[number];

/** Evento da trilha → natureza mostrada ao titular (eventos fora deste mapa não aparecem). */
export const NATUREZA_DO_EVENTO: Readonly<Record<string, NaturezaAcessoTitular>> = {
  'pep.prontuario.lido': 'consulta-ao-prontuario',
  'pep.registro.lido': 'consulta-ao-prontuario',
  'pep.motivo.informado': 'consulta-ao-prontuario',
  'pep.prontuario.listado': 'lista-de-pacientes',
  'pep.prontuario.buscado': 'busca',
  'acesso.emergencia.aberta': 'acesso-de-emergencia',
  'portal.documento.visto': 'portal',
  'sadt.portal.visualizado': 'portal',
};

/** Janela máxima do relatório de acessos numa consulta (dias). */
export const JANELA_RELATORIO_ACESSOS_DIAS = 366;
