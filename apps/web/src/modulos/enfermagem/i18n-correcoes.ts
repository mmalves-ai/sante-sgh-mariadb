// Textos das correções da enfermagem (W0-03): cancelar a passagem, alterar e excluir o aparelho, estornar ou invalidar
// escore, classificação e índice de UTI. Chave `enfermagem.correcao`. Nenhum texto cita o sistema anterior nem nome de
// tabela (ADR 0023).
export const mensagensCorrecao = {
  motivo: 'Motivo',
  motivoAjuda: 'De 10 a 300 caracteres. O motivo fica no registro, com o seu nome e a hora.',
  tipo: 'Tipo da correção',
  tipos: {
    estorno: 'Estorno (lançado errado)',
    invalidacao: 'Invalidação (paciente errado ou relançado)',
  },
  confirmar: 'Confirmar',
  cancelar: 'Voltar',
  inativo: 'Inativo',
  estornadoPor: '{tipo} por {por} em {quando}: {motivo}',
  tipoCurto: { estorno: 'Estornado', invalidacao: 'Invalidado' },
  alerta: {
    encerrado: 'Alerta do NEWS2 encerrado',
    mantido: 'Alerta do NEWS2 mantido',
    'sem-alerta': 'Sem alerta do NEWS2',
  },
  plantao: {
    cancelar: 'Cancelar a passagem',
    titulo: 'Cancelar a passagem de plantão',
    texto:
      'Só quem passou cancela, e só antes do aceite. A passagem continua legível, com o motivo; a responsabilidade continua com você.',
    cancelada: 'Cancelada por {por} em {quando}: {motivo}',
  },
  aparelho: {
    alterar: 'Alterar',
    excluir: 'Excluir',
    tituloAlterar: 'Alterar o aparelho',
    tituloExcluir: 'Excluir o aparelho',
    textoExcluir:
      'Só o aparelho cadastrado por engano, sem nenhuma leitura feita nele, pode ser excluído. Com leituras, retire-o do modo beira do leito.',
    comLeituras: 'Não foi excluído',
    retirarEmVez: 'Retirar do modo beira do leito',
  },
  escore: {
    estornar: 'Estornar',
    titulo: 'Estornar ou invalidar o escore',
    texto:
      'O escore fica inativo, tachado e visível no histórico e na exportação, com o motivo. Se for um NEWS2 com gatilho, o alerta é reavaliado. Relance o valor certo depois.',
    exportar: 'Exportar o histórico (CSV)',
  },
  classif: {
    estornar: 'Estornar',
    titulo: 'Estornar ou invalidar a classificação',
    texto:
      'A classificação fica inativa e visível, sai da carga da unidade e pode ser relançada no mesmo turno.',
  },
  receita: {
    inativar: 'Suspender ou cancelar',
    titulo: 'Suspender ou cancelar a receita',
    texto:
      'A receita assinada não se edita: fica legível e inativa, com o motivo. Suspender interrompe o tratamento; cancelar é para a receita emitida errada (só quem assinou). Confirme com a sua senha.',
    tipos: {
      suspensao: 'Suspensão (interromper o tratamento)',
      cancelamento: 'Cancelamento (emitida errada)',
    },
    tipoCurto: { suspensao: 'Suspensa', cancelamento: 'Cancelada' },
    inativada: '{tipo} por {por} em {quando}: {motivo}',
    reemitir: 'Reemitir',
    reemitindo: 'Reemissão da receita nº {id}: a receita nova cita a substituída e é assinada de novo.',
    cancelarReemissao: 'Não reemitir',
    reemitidaEm: 'Reemitida na receita nº {id}',
    substitui: 'Substitui a receita nº {id}',
  },
  vacina: {
    corrigir: 'Estornar ou retificar',
    titulo: 'Estornar ou retificar a vacina',
    texto:
      'O registro da aplicação fica como está. A retificação guarda a versão corrigida e manda a substituição do registro à RNDS; o estorno deixa a vacina inativa e manda o cancelamento.',
    tipo: 'O que fazer',
    tipos: { retificacao: 'Retificar (dado digitado errado)', estorno: 'Estornar (registrada por engano)' },
    situacoes: { ativa: 'Ativa', retificada: 'Retificada', estornada: 'Estornada' },
    original:
      'Registro original: lote {lote}, validade {validade}, dose {dose}, via {via}, local {local}, {quando}',
    correcao: 'Versão {versao} · {tipo} por {por} em {quando}: {motivo} · envio: {envio}',
    tiposCurtos: { retificacao: 'Retificação', estorno: 'Estorno' },
    semMudanca: 'Altere pelo menos um campo para retificar.',
    aplicadaEm: 'Aplicada em',
  },
  indice: {
    estornar: 'Estornar',
    titulo: 'Estornar ou invalidar o índice',
    texto:
      'O índice fica inativo e visível, com o motivo, e sai do cálculo da SMR. Relance o valor certo depois.',
  },
  hemo: {
    alterar: 'Alterar',
    versoes: 'Versões',
    tituloAlterar: 'Alterar a requisição transfusional',
    textoAlterar:
      'Só antes do atendimento (requisitada ou com a amostra coletada). A versão anterior fica guardada e legível, com o motivo, o seu nome e a hora; o prazo é recalculado pela hora da requisição.',
    hemocomponente: 'Hemocomponente',
    volume: 'Volume (mL)',
    urgencia: 'Urgência',
    programadaPara: 'Programada para',
    tituloVersoes: 'Versões da requisição nº {id}',
    vigente: 'Versão {versao} (vigente)',
    versao: 'Versão {versao}',
    alteradaPor: 'Substituída por {por} em {quando}: {motivo}',
    semVersoes: 'A requisição não foi alterada: esta é a versão original.',
    fecharVersoes: 'Fechar as versões',
    adendo: 'Adendo',
    tituloAdendo: 'Adendo ao ato transfusional',
    textoAdendo:
      'Para sinais digitados errado num momento já medido. O registro original não muda: o adendo fica ao lado, com o motivo, o seu nome e a hora.',
    momento: 'Momento',
    sinaisRegistrados: 'Sinais registrados',
    adendoDe: 'Adendo de {por} em {quando}: {motivo}',
    original: 'Registro original',
    corrigir: 'Corrigir',
    tituloCorrigir: 'Corrigir a bolsa recebida',
    textoCorrigir:
      'Só antes do uso: sem transfusão com o número, fora da reserva e da baixa. A versão anterior fica guardada e legível, com o motivo.',
    numero: 'Número da etiqueta',
    abo: 'Grupo ABO',
    rh: 'Fator Rh',
    validade: 'Validade',
    versoesBolsa: 'Versões da bolsa',
    corrigidaPor:
      'Versão {versao}: {numero} · {tipagem} · {volume} mL · validade {validade} — substituída por {por} em {quando}: {motivo}',
  },
  ria: {
    titulo: 'Envios à RNDS recusados ou sem resposta',
    destinos: {
      simulador: 'Destino: o simulador local (nada sai para a RNDS neste ambiente)',
      homologacao: 'Destino: a homologação da RNDS',
      producao: 'Destino: a RNDS (produção)',
    },
    conectorLigado: 'envio ligado',
    conectorDesligado: 'envio desligado: os registros esperam na fila',
    semCredencial: 'sem a credencial do estabelecimento: nada é enviado',
    nenhuma: 'Nenhuma recusa: os envios foram aceitos ou ainda esperam a vez.',
    vacina: 'Vacina',
    versao: 'versão {v}',
    evento: 'Envio',
    eventos: { aplicada: 'Registro', substituida: 'Substituição', cancelada: 'Cancelamento' },
    situacao: 'Situação',
    situacoes: { pendente: 'Tentando de novo', morto: 'Parado: precisa de tratamento' },
    tentativas: 'Tentativas',
    motivo: 'Motivo',
    tratar: 'Tratar no monitor de integrações (reprocessar, corrigir ou descartar)',
  },
} as const;
