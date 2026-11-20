// W0-10 (programa CRUD completo, regra 4: nenhum dado órfão): o mapa de dependências das tabelas SGH_ dos portais
// (paciente, médico externo e prestador) e o portão "conta com operação não se exclui fisicamente".
//
// As contas dos três portais (SGH_POR_CONTA, SGH_SADT_PORTAL_ACESSO e SGH_OPE_PORTAL_ACESSO) nunca são apagadas: a
// conta termina por situação (encerrada, bloqueada, revogada), com motivo, e tudo o que foi feito por ela fica ligado
// a ela. As tabelas que este pacote criou (scripts 1140 a 1154) são registros SÓ DE INCLUSÃO (trilha de atos, versões,
// respostas, anexos, conciliações): nenhuma é alterada nem excluída. O teste (dependencias-portais.spec.ts) confere este
// mapa contra os scripts versionados (toda FK de entrada das contas e toda tabela/FK dos scripts 1140–1159 está aqui) e
// contra o código (nenhum DELETE das contas nem das tabelas só de inclusão; nenhuma FK com ON DELETE para as contas).

/** As tabelas de conta dos portais: nunca têm exclusão física (o fim é por situação, com motivo). */
export const CONTAS_DOS_PORTAIS = [
  'SGH_POR_CONTA',
  'SGH_SADT_PORTAL_ACESSO',
  'SGH_OPE_PORTAL_ACESSO',
] as const;
export type ContaDePortal = (typeof CONTAS_DOS_PORTAIS)[number];

export interface DependenteDaConta {
  readonly tabela: string;
  readonly coluna: string;
  /** 'fk': FK declarada no script; 'codigo': coluna sem FK (vínculo só por código). */
  readonly origem: 'fk' | 'codigo';
  /** Grupo de produto mostrado ao usuário (nunca o nome da tabela). */
  readonly grupo: string;
}

/** O que depende de cada conta de portal: toda linha destas é operação feita pela (ou para a) conta. */
export const DEPENDENTES_DAS_CONTAS: Readonly<Record<ContaDePortal, readonly DependenteDaConta[]>> = {
  SGH_POR_CONTA: [
    { tabela: 'SGH_POR_RESPONSAVEL', coluna: 'ID_POR_CONTA', origem: 'fk', grupo: 'Responsáveis no portal' },
    { tabela: 'SGH_POR_PRECHECKIN', coluna: 'ID_POR_CONTA', origem: 'fk', grupo: 'Pré-check-in' },
    { tabela: 'SGH_POR_PAGAMENTO', coluna: 'ID_POR_CONTA', origem: 'fk', grupo: 'Cobranças do portal' },
    { tabela: 'SGH_POR_PESQUISA', coluna: 'ID_POR_CONTA', origem: 'fk', grupo: 'Pesquisa de satisfação' },
    { tabela: 'SGH_POR_TROCA_EMAIL', coluna: 'ID_CONTA', origem: 'fk', grupo: 'Troca do e-mail' },
    { tabela: 'SGH_ATD_TELECONSULTA', coluna: 'ID_POR_CONTA', origem: 'codigo', grupo: 'Teleconsulta' },
    { tabela: 'SGH_CAD_CONSENTIMENTO', coluna: 'ID_POR_CONTA', origem: 'codigo', grupo: 'Consentimentos' },
    {
      tabela: 'SGH_AUD_PEDIDO_TITULAR',
      coluna: 'ID_POR_CONTA',
      origem: 'codigo',
      grupo: 'Pedidos do titular (LGPD)',
    },
  ],
  SGH_SADT_PORTAL_ACESSO: [
    {
      tabela: 'SGH_SADT_PORTAL_CONTA_ATO',
      coluna: 'ID_ACESSO',
      origem: 'fk',
      grupo: 'Atos da conta do médico',
    },
    {
      tabela: 'SGH_SADT_PORTAL_TROCA_EMAIL',
      coluna: 'ID_ACESSO',
      origem: 'fk',
      grupo: 'Troca do e-mail do médico',
    },
    {
      tabela: 'SGH_SADT_PORTAL_CRITICO',
      coluna: 'ID_ACESSO',
      origem: 'fk',
      grupo: 'Avisos de resultado crítico',
    },
  ],
  SGH_OPE_PORTAL_ACESSO: [
    { tabela: 'SGH_OPE_PROT_RESPOSTA', coluna: 'ID_ACESSO', origem: 'fk', grupo: 'Respostas no protocolo' },
    { tabela: 'SGH_OPE_AUT_ANEXO', coluna: 'ID_ACESSO', origem: 'fk', grupo: 'Arquivos do complemento' },
    {
      tabela: 'SGH_OPE_ELEG_CONSULTA',
      coluna: 'ID_ACESSO',
      origem: 'fk',
      grupo: 'Consultas de elegibilidade',
    },
    {
      tabela: 'SGH_OPE_CONTA_RECURSO_ITEM',
      coluna: 'ID_ACESSO',
      origem: 'fk',
      grupo: 'Recursos de glosa por item',
    },
  ],
};

export interface TabelaSoInclusao {
  readonly tabela: string;
  readonly script: string;
  /** As FKs declaradas da tabela (`COLUNA → TABELA`), na ordem do script. */
  readonly referencias: readonly string[];
  readonly porque: string;
}

/** As tabelas SGH_ criadas pelo W0-10: só inclusão (nunca UPDATE de conteúdo nem DELETE), cada uma com o motivo. */
export const TABELAS_SO_INCLUSAO_W0_10: readonly TabelaSoInclusao[] = [
  {
    tabela: 'SGH_POR_TROCA_EMAIL',
    script: '1140',
    referencias: ['ID_CONTA → SGH_POR_CONTA'],
    porque: 'pedido de troca do e-mail com o link de confirmação: trilha da segurança da conta',
  },
  {
    tabela: 'SGH_POR_CONCILIACAO',
    script: '1143',
    referencias: ['ID_POR_PAGAMENTO → SGH_POR_PAGAMENTO'],
    porque: 'conciliação e estorno das cobranças: registro financeiro, corrige-se por lançamento novo',
  },
  {
    tabela: 'SGH_AUD_COPIA_ATO',
    script: '1144',
    referencias: ['ID_PEDIDO → SGH_AUD_PEDIDO_TITULAR', 'ID_POR_RESPONSAVEL → SGH_POR_RESPONSAVEL'],
    porque:
      'atos da cópia do prontuário (solicitação, legitimidade, geração com hash, entrega): prova da LGPD',
  },
  {
    tabela: 'SGH_SADT_PORTAL_CONTA_ATO',
    script: '1145',
    referencias: ['ID_ACESSO → SGH_SADT_PORTAL_ACESSO'],
    porque: 'bloqueio, desbloqueio, encerramento e trocas da conta do médico: trilha com motivo',
  },
  {
    tabela: 'SGH_SADT_PORTAL_TROCA_EMAIL',
    script: '1146',
    referencias: ['ID_ACESSO → SGH_SADT_PORTAL_ACESSO'],
    porque: 'pedido de troca do e-mail do médico com o link de confirmação',
  },
  {
    tabela: 'SGH_CC_PEDIDO_VERSAO',
    script: '1147',
    referencias: ['ID_ESTADO → SGH_CC_AGENDA_ESTADO'],
    porque: 'versões do pedido de cirurgia alterado pelo médico: a anterior fica visível',
  },
  {
    tabela: 'SGH_SADT_PORTAL_CRITICO',
    script: '1148',
    referencias: ['ID_AVISO → SGH_SADT_AVISO_CRITICO', 'ID_ACESSO → SGH_SADT_PORTAL_ACESSO'],
    porque: 'notificação do resultado crítico ao médico: prova do aviso',
  },
  {
    tabela: 'SGH_OPE_PROT_RESPOSTA',
    script: '1149',
    referencias: [
      'ID_PROTOCOLO → SGH_OPE_PROTOCOLO',
      'ID_INTERACAO → SGH_OPE_PROTOCOLO_EVT',
      'ID_EVENTO → SGH_OPE_PROTOCOLO_EVT',
      'ID_PRESTADOR → SGH_OPE_PRESTADOR',
      'ID_ACESSO → SGH_OPE_PORTAL_ACESSO',
    ],
    porque: 'resposta do prestador no protocolo de atendimento (RN ANS 395), com o anexo imutável',
  },
  {
    tabela: 'SGH_OPE_AUT_ANEXO',
    script: '1150',
    referencias: [
      'ID_AUTORIZACAO → SGH_OPE_AUTORIZACAO',
      'ID_EVENTO → SGH_OPE_AUTORIZACAO_EVT',
      'ID_PRESTADOR → SGH_OPE_PRESTADOR',
      'ID_ACESSO → SGH_OPE_PORTAL_ACESSO',
    ],
    porque: 'arquivos da resposta ao complemento da autorização: imutáveis, com o hash',
  },
  {
    tabela: 'SGH_OPE_AUT_RESPONSAVEL',
    script: '1151',
    referencias: [
      'ID_AUTORIZACAO → SGH_OPE_AUTORIZACAO',
      'ID_AUDITOR → SGH_OPE_AUDITOR',
      'ID_AUDITOR_ANTERIOR → SGH_OPE_AUDITOR',
    ],
    porque:
      'auditor responsável pela análise e a redistribuição antes de encerrar a designação (nenhum pedido sem responsável)',
  },
  {
    tabela: 'SGH_OPE_AUDITOR_HIST',
    script: '1152',
    referencias: ['ID_AUDITOR → SGH_OPE_AUDITOR'],
    porque: 'versão anterior dos dados da designação do auditor, com o motivo da alteração',
  },
  {
    tabela: 'SGH_OPE_ELEG_CONSULTA',
    script: '1153',
    referencias: [
      'ID_OPERADORA → SGH_OPE_OPERADORA',
      'ID_PRESTADOR → SGH_OPE_PRESTADOR',
      'ID_ACESSO → SGH_OPE_PORTAL_ACESSO',
      'ID_BENEFICIARIO → SGH_OPE_BENEFICIARIO',
    ],
    porque: 'registro da consulta de elegibilidade feita pelo prestador no portal (prova da conferência)',
  },
  {
    tabela: 'SGH_OPE_CONTA_RECURSO_ITEM',
    script: '1154',
    referencias: [
      'ID_CONTA → SGH_OPE_CONTA',
      'ID_GUIA → SGH_OPE_CONTA_GUIA',
      'ID_ITEM → SGH_OPE_CONTA_ITEM',
      'ID_RECURSO → SGH_OPE_CONTA_RECURSO_ITEM',
      'ID_ACESSO → SGH_OPE_PORTAL_ACESSO',
    ],
    porque:
      'recurso de glosa por item do prestador e a decisão da operadora por item (fato novo ligado ao recurso)',
  },
];
