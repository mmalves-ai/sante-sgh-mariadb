// W0-09: textos do ciclo de vida dos registros da implantação (voltar a pendente, estornar a conclusão, retirar a
// versão da trilha). Toda ação pede o motivo; a anterior fica na história.
export const mensagensCicloCoex = {
  acoes: 'Ações',
  motivo: 'Motivo (fica na história)',
  senha: 'Sua senha (confirmação da operação)',
  desistir: 'Desistir',
  motivoCurto: 'Informe o motivo (ao menos 5 caracteres).',
  senhaObrigatoria: 'Digite a sua senha para confirmar.',
  erroGenerico: 'Não foi possível concluir. Tente de novo.',
  vinculos: '{n} registro(s) dependem deste.',
  voltarPendente: 'Voltar a pendente',
  voltarPendenteTitulo: 'Voltar a pendente: {item}',
  voltarPendenteTexto:
    'O item volta a pendente e o setor deixa de contar com ele. A situação anterior fica na história com o motivo.',
  voltarDesligamentoTexto:
    'O item da checklist volta a pendente. A situação anterior fica na história com o motivo; confirme com a sua senha.',
  versoes: 'Versões ({n})',
  versao: 'Versão {versao}: {situacao}, {n} conclusão(ões)',
  situacoesVersao: { vigente: 'vigente', desatualizada: 'desatualizada', retirada: 'retirada' },
  retirar: 'Retirar a versão',
  retirarTitulo: 'Retirar a versão {versao} da trilha {trilha}',
  retirarTexto:
    'Sem turmas nem conclusões, a versão é excluída (com a cópia guardada). Com elas, a exclusão é recusada e você pode inativar: a versão fica visível com a história e não recebe conclusão nova.',
  inativar: 'Inativar a versão',
  excluida: 'Versão {versao} excluída.',
  inativada: 'Versão {versao} inativada: segue visível com a história.',
  conclusoes: 'Conclusões registradas',
  login: 'Login',
  resultado: 'Resultado',
  estornar: 'Estornar',
  estornarTitulo: 'Estornar a conclusão de {login}',
  estornarTexto:
    'A conclusão sai da contagem do treinamento. O registro e o estorno ficam na história com o motivo.',
  estornada: 'Conclusão estornada.',
  recusas: {
    'item-calculado': 'Este item é calculado pelo sistema: não se registra nem se volta.',
    'item-ja-pendente': 'O item já está pendente.',
    'conclusao-ja-estornada': 'Esta conclusão já foi estornada.',
    'a-si-mesmo': 'Ninguém estorna a própria conclusão.',
    'trilha-ja-retirada': 'Esta versão da trilha já foi retirada.',
    'registro-por-versionado':
      'Neste estabelecimento o registro muda só pelo registro versionado (exceção registrada). Para gravar pela tela, ajuste o parâmetro "coexistencia.registro.modo".',
    'registro-ja-no-arquivo': 'Já vale o registro versionado: não há versão gravada pela tela para retirar.',
    senha: 'Senha incorreta.',
    semPermissao: 'Você não tem permissão para esta operação.',
  },
};

// W0-09 (D-RETRO-REGISTRO-F6): o registro do fim e da retrocompatibilidade gravado pela tela.
export const mensagensRegistroCoex = {
  titulo: {
    fim: 'Registro do fim da coexistência',
    retrocompatibilidade: 'Registro da retrocompatibilidade',
  },
  carregando: 'Carregando o registro…',
  modos: {
    tela: 'Neste estabelecimento o registro é gravado por esta tela, com motivo e senha; cada versão fica no histórico.',
    excecao:
      'Neste estabelecimento o registro muda só pelo registro versionado (exceção registrada no parâmetro "coexistencia.registro.modo"). Esta tela mostra o histórico.',
  },
  fonteTela: 'Vale a versão {versao}, gravada por esta tela.',
  fonteArquivo: 'Vale o registro versionado.',
  gravar: 'Gravar nova versão',
  gravarTexto:
    'Informe o registro inteiro (JSON, no mesmo formato do registro versionado). O servidor confere o formato e o estabelecimento; a versão anterior fica no histórico com o motivo.',
  conteudo: 'Registro (JSON)',
  jsonInvalido: 'O registro precisa ser um objeto JSON válido.',
  voltarArquivo: 'Voltar a valer o registro versionado',
  voltarTexto:
    'A versão gravada pela tela deixa de valer e volta a valer o registro versionado. A versão gravada fica no histórico.',
  gravado: 'Nova versão do registro gravada.',
  voltou: 'Voltou a valer o registro versionado.',
  historico: 'Histórico de versões',
  semHistorico: 'Nenhuma versão gravada pela tela.',
  versao: 'Versão',
  quando: 'Quando',
  quem: 'Quem',
  motivo: 'Motivo',
  retorno: 'volta ao registro versionado',
};
