// Cadastros de prescrição do M24 (ficha, seção 7: "Cadastros > Cadastros clínicos e de prescrição") no CRUD
// genérico (M08): locais de assistência, perguntas enviadas à operadora e hemocomponentes prescritíveis. Os demais
// cadastros de prescrição (kits, receitas padrão, itens não padronizados, parâmetros do item) têm tela própria de
// consulta na prescrição (o item de estoque é buscado, não listado). Opções do legado (menu de origem, ver
// conector/mapa/permissoes.tsv): "Cadastro de template operadora" 5975 (Consultar 5976,
// Confirmar 5977) para as perguntas; o local de assistência não tem item próprio na árvore: área genérica
// "Tabelas" 3501 (inferida, POL-1b; conferir na validação com a TI, DP-3).
import type { DominioPublico } from './tipos.js';

const TABELAS = [3501];
const TRAVADO_HEMO =
  'linha única de código 0 (sentinela do cadastro, sem uso pela prescrição): a hemoterapia é prescrita pelo cadastro de procedimentos';

export const DOMINIOS_M24: readonly DominioPublico[] = [
  {
    modulo: 'pep',
    recurso: 'localAssistencia',
    rotulo: { singular: 'Local de assistência', plural: 'Locais de assistência' },
    subitem: 'prescricaoLocais',
    natureza: 'editavel',
    acoes: ['ler', 'criar', 'editar', 'inativar', 'exportar'],
    opcoesLegado: { ler: TABELAS, criar: TABELAS, editar: TABELAS, inativar: TABELAS, exportar: TABELAS },
    origemOpcoes: 'inferida',
    marco: 'M24',
  },
  {
    modulo: 'pep',
    recurso: 'perguntaOperadora',
    rotulo: { singular: 'Pergunta enviada à operadora', plural: 'Perguntas enviadas à operadora' },
    subitem: 'prescricaoPerguntas',
    natureza: 'editavel',
    acoes: ['ler', 'criar', 'editar', 'exportar'],
    opcoesLegado: { ler: [5975, 5976], criar: [5977], editar: [5977], exportar: [5976] },
    origemOpcoes: 'tbopcoes',
    marco: 'M24',
  },
  {
    modulo: 'pep',
    recurso: 'hemocomponentePrescritivel',
    rotulo: { singular: 'Hemocomponente prescritível', plural: 'Hemocomponentes prescritíveis' },
    subitem: 'prescricaoHemocomponentes',
    natureza: 'travado',
    motivoSomenteLeitura: TRAVADO_HEMO,
    acoes: ['ler', 'exportar'],
    opcoesLegado: { ler: TABELAS, exportar: TABELAS },
    origemOpcoes: 'inferida',
    marco: 'M24',
  },
];

// ── M24 (P-CAD-1): os demais cadastros de prescrição no CRUD genérico ─────────────────────────────────
// Lidos na cópia em 22/10/2026 (estrutura RDB$ e agregados; nada de pessoa). Opções do legado (menu de origem, ver
// conector/mapa/permissoes.tsv), só as ativas: Kits de medicamentos 4671 (Consultar 5947, Novo
// kit 5366, Confirmar 5367, Excluir 4674); Kits de soluções EV contínua 4667 (Consultar 5946, Confirmar 4670,
// Excluir 4669); Itens não padronizados 3347 (Consultar 5948, Incluir 3349, Confirmar 4675, Excluir 3350);
// Protocolos prescrição geral 3368 (Confirmar 5369, Excluir 3371); Fórmulas 2646 (Consultar 5954, Confirmar 5373,
// Excluir 2649); Receitas padrão 2732 (Consultar 5924); Esquema de horários de prescrição 6361 (Alterar 6362,
// Incluir 6363, Excluir 6364, Consultar 6365); Interação medicamentosa 6373, Grau de gravidade 4890 e
// Classificação de interação 4891; Itens 1643 (o cadastro do item de estoque, para os parâmetros do item). As
// frequências e os horários relativos não têm item próprio na árvore: área genérica "Tabelas" 3501 (inferida,
// POL-1b; conferir na validação com a TI, DP-3).
const KIT_MED = {
  ler: [4671, 5947],
  criar: [5366, 5367],
  editar: [5367],
  inativar: [4674],
  exportar: [5947],
};
const KIT_SOL = { ler: [4667, 5946], criar: [4670], editar: [4670], inativar: [4669], exportar: [5946] };
const NAO_PAD = {
  ler: [3347, 5948],
  criar: [3349, 4675],
  editar: [4675],
  inativar: [3350],
  exportar: [5948],
};
const PROTOCOLO = { ler: [3368], criar: [5369], editar: [5369], inativar: [3371], exportar: [3368] };
const FORMULA = { ler: [2646, 5954], criar: [5373], editar: [5373], inativar: [2649], exportar: [5954] };
const ESQUEMA = { ler: [6361, 6365], criar: [6363], editar: [6362], inativar: [6364], exportar: [6365] };
const INTERACAO = { ler: [6373, 4891], criar: [6373], editar: [6373], inativar: [6373], exportar: [6373] };
const GRAU = { ler: [4890], criar: [4890], editar: [4890], inativar: [4890], exportar: [4890] };
const ITENS = { ler: [1643], editar: [1643], exportar: [1643] };
const TABELAS_TODAS = { ler: TABELAS, criar: TABELAS, editar: TABELAS, exportar: TABELAS };

function so<T extends Record<string, readonly number[]>>(o: T, acoes: readonly string[]) {
  return Object.fromEntries(
    Object.entries(o).filter(([a]) => acoes.includes(a)),
  ) as unknown as DominioPublico['opcoesLegado'];
}

function m24(
  recurso: string,
  singular: string,
  plural: string,
  subitem: DominioPublico['subitem'],
  acoes: DominioPublico['acoes'],
  opcoes: Record<string, readonly number[]>,
  origem: DominioPublico['origemOpcoes'],
  extra: Partial<Pick<DominioPublico, 'natureza' | 'motivoSomenteLeitura' | 'semInclusao'>> = {},
): DominioPublico {
  return {
    modulo: 'pep',
    recurso,
    rotulo: { singular, plural },
    subitem,
    natureza: extra.natureza ?? 'editavel',
    acoes,
    opcoesLegado: so(opcoes, acoes),
    origemOpcoes: origem,
    ...(extra.motivoSomenteLeitura ? { motivoSomenteLeitura: extra.motivoSomenteLeitura } : {}),
    ...(extra.semInclusao ? { semInclusao: extra.semInclusao } : {}),
    marco: 'M24',
  };
}

const SO_LER = ['ler', 'exportar'] as const;
const EDITA = ['ler', 'editar', 'exportar'] as const;
const INCLUI = ['ler', 'criar', 'editar', 'exportar'] as const;
const INCLUI_SO = ['ler', 'criar', 'exportar'] as const;
const TUDO = ['ler', 'criar', 'editar', 'inativar', 'exportar'] as const;

export const DOMINIOS_M24_CADASTROS: readonly DominioPublico[] = [
  // Frequências, horários relativos e fórmulas de dose.
  m24(
    'frequenciaPrescricao',
    'Frequência',
    'Frequências',
    'prescricaoFrequencias',
    EDITA,
    TABELAS_TODAS,
    'inferida',
    {
      semInclusao:
        'As frequências são fixas: cada uma tem o cálculo dos horários previstos. Altere o nome e a ordem de exibição.',
    },
  ),
  m24(
    'horarioRelativo',
    'Horário relativo',
    'Horários relativos',
    'prescricaoFrequencias',
    INCLUI,
    TABELAS_TODAS,
    'inferida',
  ),
  m24(
    'formulaDose',
    'Fórmula de dose',
    'Fórmulas de dose',
    'prescricaoFrequencias',
    TUDO,
    FORMULA,
    'tbopcoes',
  ),
  // Kits de medicamentos e de soluções (mestre e itens).
  m24(
    'kitMedicamento',
    'Kit de medicamento',
    'Kits de medicamentos',
    'prescricaoKits',
    TUDO,
    KIT_MED,
    'tbopcoes',
  ),
  m24(
    'itemKitMedicamento',
    'Material do kit de medicamento',
    'Materiais dos kits de medicamentos',
    'prescricaoKits',
    INCLUI,
    KIT_MED,
    'tbopcoes',
  ),
  m24('kitSolucao', 'Kit de solução', 'Kits de soluções', 'prescricaoKits', TUDO, KIT_SOL, 'tbopcoes'),
  m24(
    'itemKitSolucao',
    'Componente do kit de solução',
    'Componentes dos kits de soluções',
    'prescricaoKits',
    INCLUI,
    KIT_SOL,
    'tbopcoes',
  ),
  // Itens não padronizados (mestre, vias e princípios ativos).
  m24(
    'itemNaoPadronizado',
    'Item não padronizado',
    'Itens não padronizados',
    'prescricaoNaoPadronizados',
    TUDO,
    NAO_PAD,
    'tbopcoes',
  ),
  m24(
    'viaItemNaoPadronizado',
    'Via do item não padronizado',
    'Vias dos itens não padronizados',
    'prescricaoNaoPadronizados',
    INCLUI_SO,
    NAO_PAD,
    'tbopcoes',
  ),
  m24(
    'principioItemNaoPadronizado',
    'Princípio ativo do item não padronizado',
    'Princípios ativos dos itens não padronizados',
    'prescricaoNaoPadronizados',
    INCLUI_SO,
    NAO_PAD,
    'tbopcoes',
  ),
  // Parâmetros clínicos e fiscais do item (a linha nasce com o item de estoque).
  m24(
    'parametroClinicoItem',
    'Parâmetro clínico do item',
    'Parâmetros clínicos dos itens',
    'prescricaoParametrosItem',
    EDITA,
    ITENS,
    'tbopcoes',
    {
      semInclusao:
        'A linha nasce com o item de estoque: aqui se alteram os parâmetros de prescrição do item.',
    },
  ),
  m24(
    'parametroFiscalItem',
    'Parâmetro fiscal do item',
    'Parâmetros fiscais dos itens',
    'prescricaoParametrosItem',
    EDITA,
    ITENS,
    'tbopcoes',
    {
      semInclusao: 'A linha nasce com o item de estoque: aqui se alteram os dados fiscais do item.',
    },
  ),
  // Protocolos de prescrição (cabeçalho e especialidades).
  m24(
    'protocoloPrescricao',
    'Protocolo de prescrição',
    'Protocolos de prescrição',
    'prescricaoProtocolos',
    TUDO,
    PROTOCOLO,
    'tbopcoes',
  ),
  m24(
    'especialidadeProtocolo',
    'Especialidade do protocolo',
    'Especialidades dos protocolos',
    'prescricaoProtocolos',
    INCLUI_SO,
    PROTOCOLO,
    'tbopcoes',
  ),
  // Receitas padrão: só consulta (vigência com fuso e horário universal, autor e texto longo).
  m24(
    'receitaPadrao',
    'Receita padrão',
    'Receitas padrão',
    'prescricaoReceitas',
    SO_LER,
    { ler: [2732, 5924], exportar: [5924] },
    'tbopcoes',
    {
      natureza: 'travado',
      motivoSomenteLeitura:
        'A receita padrão tem vigência com fuso e horário universal, autor e texto longo, gravados pela tela de receitas: a edição por aqui fica desligada até a prova dessa gravação.',
    },
  ),
  // Domínios das interações medicamentosas.
  m24(
    'classificacaoInteracao',
    'Classificação de interação',
    'Classificações de interação',
    'prescricaoInteracoes',
    TUDO,
    INTERACAO,
    'tbopcoes',
  ),
  m24(
    'grauGravidadeInteracao',
    'Grau de gravidade da interação',
    'Graus de gravidade da interação',
    'prescricaoInteracoes',
    TUDO,
    GRAU,
    'tbopcoes',
  ),
  m24(
    'probabilidadeInteracao',
    'Probabilidade de ocorrência da interação',
    'Probabilidades de ocorrência da interação',
    'prescricaoInteracoes',
    TUDO,
    INTERACAO,
    'tbopcoes',
  ),
  m24(
    'tipoInteracao',
    'Tipo de interação',
    'Tipos de interação',
    'prescricaoInteracoes',
    SO_LER,
    INTERACAO,
    'tbopcoes',
    {
      natureza: 'sistema',
      motivoSomenteLeitura: 'Tabela do sistema: o banco recusa incluir, alterar ou excluir.',
    },
  ),
  m24(
    'validacaoInteracao',
    'Validação da interação',
    'Validações da interação',
    'prescricaoInteracoes',
    SO_LER,
    INTERACAO,
    'tbopcoes',
    {
      natureza: 'travado',
      motivoSomenteLeitura: 'Códigos lidos pela regra de validação das interações: só consulta.',
    },
  ),
  m24(
    'referenciaPrincipioAtivo',
    'Referência do princípio ativo',
    'Referências do princípio ativo',
    'prescricaoInteracoes',
    SO_LER,
    INTERACAO,
    'tbopcoes',
    {
      natureza: 'sistema',
      motivoSomenteLeitura: 'Tabela do sistema: o banco recusa incluir, alterar ou excluir.',
    },
  ),
  // Horários-padrão por unidade e bloco, vigência, autopreenchimento e situação da ordem.
  m24(
    'regraVigenciaPrescricao',
    'Regra de vigência da prescrição',
    'Regras de vigência da prescrição',
    'prescricaoHorarios',
    EDITA,
    ESQUEMA,
    'tbopcoes',
    {
      semInclusao:
        'As regras de vigência são fixas (internação e externo); aqui se alteram o horário e as opções.',
    },
  ),
  m24(
    'numeroDosesGrade',
    'Grade por número de doses',
    'Grades por número de doses',
    'prescricaoHorarios',
    SO_LER,
    ESQUEMA,
    'tbopcoes',
    {
      natureza: 'travado',
      motivoSomenteLeitura:
        'As grades por número de doses são lidas pelo cálculo dos horários previstos: altere os horários de cada dose.',
    },
  ),
  m24(
    'horarioDoseGrade',
    'Horário da dose',
    'Horários das doses',
    'prescricaoHorarios',
    EDITA,
    ESQUEMA,
    'tbopcoes',
    {
      semInclusao: 'Cada grade tem um horário por dose: aqui se altera o horário de cada uma.',
    },
  ),
  m24(
    'blocoVigenciaPrescricao',
    'Regra de vigência do bloco',
    'Regras de vigência dos blocos',
    'prescricaoHorarios',
    INCLUI,
    ESQUEMA,
    'tbopcoes',
  ),
  m24(
    'unidadeVigenciaPrescricao',
    'Regra de vigência da unidade',
    'Regras de vigência das unidades',
    'prescricaoHorarios',
    INCLUI,
    ESQUEMA,
    'tbopcoes',
  ),
  m24(
    'campoAutopreenchido',
    'Campo de autopreenchimento',
    'Campos de autopreenchimento',
    'prescricaoHorarios',
    SO_LER,
    ESQUEMA,
    'tbopcoes',
    {
      natureza: 'sistema',
      motivoSomenteLeitura: 'Tabela do sistema: o banco recusa incluir, alterar ou excluir.',
    },
  ),
  m24(
    'situacaoOrdemProcesso',
    'Situação da ordem no processo',
    'Situações da ordem no processo',
    'prescricaoHorarios',
    EDITA,
    ESQUEMA,
    'tbopcoes',
    {
      semInclusao: 'As situações da ordem são fixas: aqui se alteram as exigências de senha e de motivo.',
    },
  ),
];
