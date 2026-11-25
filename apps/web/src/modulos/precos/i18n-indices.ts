// Textos da seção "Valores dos índices e portes" da tela do contrato (F3.7, 06-FAT linha 5), na chave `indicesContrato`
// (escopo local do componente). Vocabulário de produto: nenhum nome do sistema de origem.
export const mensagensIndices = {
  titulo: 'Valores dos índices e portes',
  texto:
    'O honorário nos modelos por coeficiente e por porte sai do valor do índice ou do porte na data do atendimento × a quantidade. Cada mudança de valor é uma vigência nova: a anterior continua na linha do tempo, e nada se apaga.',
  tipo: 'O que registrar',
  tipos: {
    indice: 'Índice de cobrança (CH, UCO, filme)',
    porte: 'Porte de honorário',
    'porte-anestesico': 'Porte anestésico',
  },
  abrangencia: 'Vale para',
  doAcordo: 'O acordo inteiro (todas as tabelas)',
  daTabela: 'Tabela {codigo} — {descricao} ({regime})',
  regimes: { internacao: 'internação', ambulatorial: 'ambulatorial' },
  alvo: 'Índice ou porte',
  escolha: 'Escolha…',
  porteAnestesico: 'Porte anestésico {n}',
  linhaDoTempo: 'Linha do tempo',
  nenhuma: 'Nenhum valor registrado para esta escolha.',
  vigente: 'vigente',
  futura: 'a partir de',
  anterior: 'anterior',
  horarioEspecial: 'horário especial {valor}',
  campos: {
    vigenciaInicio: 'Início da vigência',
    valor: 'Valor',
    valorHorarioEspecial: 'Valor em horário especial (opcional)',
    motivoAlteracao: 'Motivo (opcional)',
  },
  obrigatorios: {
    alvo: 'Escolha o índice ou o porte.',
    tabela: 'O porte anestésico é sempre de uma tabela de honorários do acordo.',
  },
  registrar: 'Registrar vigência nova',
  registrada: 'Vigência registrada. A anterior continua na linha do tempo.',
  somenteConsulta: 'Somente consulta: a gravação pede a permissão de editar o contrato.',
};
