// Textos do programa CRUD completo no NIR, no mapa de leitos e na observação do PA (W0-07): corrigir, alterar,
// retirar, encerrar, remover, limpar, excluir e transferir, sempre com o motivo. Sem nome de sistema antigo nem de
// tabela.
export const mensagensCrudNir = {
  motivo: 'Motivo (obrigatório)',
  motivoCurto: 'Escreva o motivo com ao menos {n} caracteres.',
  justificativa: 'Justificativa (obrigatória)',
  motivoAlteracao:
    'Motivo da alteração (obrigatório ao trocar um valor já definido; o anterior fica no histórico)',
  senha: 'Sua senha',
  senhaTexto: 'Operação crítica: confirme com a sua senha.',
  voltar: 'Voltar',
  corrigir: 'Corrigir',
  alterar: 'Alterar',
  excluir: 'Excluir',
  cancelarComMotivo: 'Cancelar',
  encerrar: 'Encerrar',
  transferir: 'Transferir de leito',
  corrigirTitulo: 'Corrigir a solicitação de leito',
  corrigirTexto:
    'Corrija o perfil, os recursos pedidos e a observação. A versão anterior fica guardada com o motivo.',
  leitoPedido: 'Leito pedido',
  precaucao: 'Precaução',
  semPrecaucao: 'Sem precaução',
  recursosLegenda: 'Recursos pedidos',
  recursosPedidos: 'Recursos: {recursos}',
  observacao: 'Observação',
  observacaoNir: 'Observação do NIR: {texto}',
  recursos: {
    ventilacao: 'Ventilação mecânica',
    monitor: 'Monitorização contínua',
    oxigenio: 'Oxigênio',
    hemodialise: 'Hemodiálise',
    bomba: 'Bomba de infusão',
    obeso: 'Leito para obeso',
    berco: 'Berço ou incubadora',
    acompanhante: 'Acompanhante',
  },
  excluirTitulo: 'Cancelar a solicitação de leito',
  excluirTexto:
    'A solicitação não é apagada: fica cancelada, com o motivo, quem e quando, no histórico. Com o leito reservado, a reserva é cancelada junto e o leito volta a livre.',
  alterarReservaTitulo: 'Alterar a reserva',
  alterarReservaTexto:
    'Escolha outro leito compatível com o perfil e/ou uma nova validade. A reserva que já virou internação não se altera.',
  mesmoLeito: 'Manter o mesmo leito',
  novoLeito: 'Novo leito',
  novaValidade: 'Nova validade (minutos a partir de agora)',
  excluirReservaTitulo: 'Cancelar a reserva de leito',
  excluirReservaTexto:
    'A reserva não é apagada: fica cancelada, com o motivo, quem e quando. O leito volta a livre e a solicitação volta à análise.',
  retirarDpa: 'Retirar a alta prevista',
  retirarDpaTitulo: 'Retirar a alta prevista',
  retirarDpaTexto:
    'A internação fica sem alta prevista; as versões anteriores continuam no histórico com quem e por quê.',
  dpaRetirada: 'Alta prevista retirada',
  alterarBarreiraTitulo: 'Alterar a barreira de alta',
  encerrarBarreiraTitulo: 'Encerrar a barreira de alta',
  encerrarBarreiraTexto:
    'A barreira encerrada continua no histórico da internação (e ligada à avaliação do serviço social, quando veio de lá).',
  resultado: 'Resultado',
  resolvida: 'Resolvida',
  cancelada: 'Cancelada',
  removerLimite: 'Voltar ao padrão',
  removerLimiteTitulo: 'Remover o limite próprio de {chave}',
  removerLimiteTexto:
    'Sem o limite próprio, vale o padrão do estabelecimento. O valor anterior fica guardado.',
  alterarEstado: 'Alterar {estado}',
  alterarEstadoTitulo: 'Alterar {estado} sem encerrar',
  alterarEstadoTexto:
    'Altere o motivo, a precaução, a previsão de fim ou a observação. O valor anterior fica guardado.',
  estados: { bloqueio: 'o bloqueio', precaucao: 'a precaução', extra: 'o leito extra' },
  motivoBloqueio: 'Motivo do bloqueio',
  previsao: 'Previsão de fim',
  limparAtributos: 'Limpar atributos',
  limparAtributosTitulo: 'Limpar os atributos do leito',
  limparAtributosTexto:
    'Sexo, faixa de idade, criticidade, andar e ramal próprios do leito saem e vale o padrão. O valor anterior fica guardado.',
  transferirTitulo: 'Transferir {paciente} de leito',
  transferirTexto:
    'Numa operação só: o paciente sai do leito atual e entra no escolhido. Se algo falhar, ele continua no leito de origem. A contagem das 24 horas continua a da entrada.',
  leitoDestino: 'Leito ou poltrona de destino',
  // Mercado M4: a OS da manutenção num leito.
  osLeito: {
    proposta:
      'O local da ordem de serviço é o leito {leito}, que está livre. Bloqueie o leito por manutenção enquanto durar o serviço.',
    bloquear: 'Bloquear o leito por manutenção',
    bloqueado: 'Leito {leito} bloqueado por manutenção até o encerramento da ordem de serviço.',
    encerrado: 'Bloqueio do leito {leito} encerrado com a ordem de serviço.',
    higienizacao: 'Higienização solicitada (nº {numero}).',
    // O servidor manda só o código (AVISOS_OS_NO_LEITO); não há bloqueio adiado.
    avisos: {
      'leito-bloqueado': 'O leito {leito} já está bloqueado.',
      'leito-ocupado':
        'O leito {leito} está ocupado: bloqueie-o pelo mapa de leitos quando vagar, citando a ordem de serviço ({observacao}).',
      'sem-permissao-bloqueio':
        'O local da ordem de serviço é o leito {leito}: peça à hotelaria ou ao NIR que o bloqueie por manutenção, citando a ordem de serviço ({observacao}).',
      'sem-bloqueio-da-os':
        'O leito {leito} não tem bloqueio aberto por esta ordem de serviço: nada a encerrar.',
      'sem-tipo-limpeza':
        'Sem tipo de limpeza cadastrado: solicite a higienização do leito {leito} pela tela.',
      'higienizacao-nao-solicitada':
        'O bloqueio foi encerrado, mas a higienização do leito {leito} não foi solicitada: solicite pela tela.',
      cancelada:
        'O bloqueio do leito {leito} foi encerrado com o cancelamento da ordem de serviço. Se a manutenção chegou a mexer no leito, solicite a higienização pela tela.',
    },
  },
};
