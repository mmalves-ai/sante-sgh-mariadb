// Textos das telas de gestão do financeiro (F3.8, 07-FIN linhas 98 e 99): reclassificação gerencial e permissões.
export const mensagensGestaoFinanceiro = {
  reclassificar: {
    titulo: 'Reclassificar lançamento',
    texto:
      'Corrija a natureza e o rateio por centro de custo de um título ou movimento já lançado. A classificação anterior fica no histórico, com o motivo.',
    alvo: 'Lançamento',
    alvos: {
      titulo_pagar: 'Título a pagar',
      titulo_receber: 'Título a receber',
      movimento_bancario: 'Movimento bancário',
    },
    numero: 'Número do título, documento ou histórico',
    buscar: 'Buscar',
    nenhum: 'Nenhum lançamento encontrado com esse número.',
    escolher: 'Escolha o lançamento',
    abrir: 'Abrir',
    atual: 'Classificação atual',
    nova: 'Nova classificação',
    natureza: 'Natureza',
    semNatureza: 'Sem natureza',
    valor: 'Valor',
    centro: 'Centro de custo',
    percentual: '%',
    incluirCentro: 'Incluir centro',
    remover: 'Remover',
    soma: 'Soma do rateio: {soma}%',
    somaErrada: 'O rateio precisa somar 100%.',
    repetido: 'Centro repetido no rateio.',
    motivo: 'Motivo',
    faltam: 'Faltam {n} letras no motivo.',
    confirmar: 'Reclassificar',
    historico: 'Reclassificações anteriores',
    substituidas: 'Linhas de rateio substituídas guardadas: {n}',
    semHistorico: 'Nenhuma reclassificação ainda.',
  },
  permissoes: {
    titulo: 'Permissões do financeiro',
    texto:
      'Escolha as contas bancárias que cada usuário consulta e movimenta, e os tipos que cada perfil pode usar em cada operação: o tipo de lançamento no movimento bancário e o tipo de credor no título a pagar e no adiantamento.',
    escopo: 'Contas bancárias por usuário',
    usuario: 'Usuário',
    livre:
      'Este usuário ainda vê todas as contas. Ao gravar a primeira conta, ele passa a ver só as contas marcadas aqui.',
    restrito: 'Este usuário vê só as contas marcadas.',
    conta: 'Conta',
    consultar: 'Consulta',
    movimentar: 'Movimenta',
    inicio: 'Desde',
    fim: 'Até',
    gravar: 'Gravar',
    movimentarExige: 'Quem movimenta precisa consultar.',
    vigenciaInvertida: 'O fim vem antes do início.',
    tipos: 'Tipos por perfil e operação',
    operacao: 'Operação',
    operacoes: {
      banco: 'Movimento bancário (tipo de lançamento)',
      contas_pagar: 'Título a pagar (tipo de credor)',
      adiantamento: 'Adiantamento (tipo de credor)',
      contas_receber: 'Título a receber (tipo de documento)',
    },
    tipoDaOperacao: {
      banco: 'Tipo de lançamento',
      contas_pagar: 'Tipo de credor',
      adiantamento: 'Tipo de credor',
      contas_receber: 'Tipo de documento',
    },
    perfil: 'Perfil de acesso',
    tiposLivre:
      'Perfil livre neste estabelecimento: usa todos os tipos que a permissão desta operação dá. Ao marcar o primeiro tipo (ou restringir), só os marcados passam.',
    tiposRestrito:
      'Perfil restrito neste estabelecimento: usa só os tipos marcados nesta operação. Sem nenhum marcado, não usa nenhum. Um outro perfil livre do usuário que dê a operação continua valendo.',
    restringir: 'Restringir o perfil',
    desfazerRestricao: 'Desfazer a restrição (voltar a todos os tipos)',
    liberado: 'Liberado',
  },
  /** A emissão do título a receber: o tipo de documento, só entre os liberados aos perfis do usuário. */
  emissaoReceber: {
    tipoDocumento: 'Tipo de documento',
    restrito: 'O seu perfil emite só os tipos de documento listados.',
    semTipo:
      'Nenhum tipo de documento a receber está liberado ao seu perfil: peça a liberação em Permissões do financeiro.',
  },
};
