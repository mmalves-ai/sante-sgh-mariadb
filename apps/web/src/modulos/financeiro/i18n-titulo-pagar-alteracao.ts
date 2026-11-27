// Textos da alteração do título a pagar não pago e da devolução ao fornecedor (F3.8, 07-FIN linha 63, C1-008).
export const mensagensAlteracaoTitulo = {
  titulo: 'Alterar o título',
  texto:
    'Só o título sem pagamento, fora de borderô e sem nota abatida pode ser alterado. Mudar o documento, a emissão, o valor ou as parcelas cancela as aprovações e reabre a alçada; o referente e a observação não mexem na aprovação.',
  abrir: 'Alterar o título',
  fechar: 'Fechar a alteração',
  documento: 'Documento',
  serie: 'Série',
  emissao: 'Emissão',
  valorDocumento: 'Valor do documento',
  referente: 'Referente',
  observacao: 'Observação',
  parcelas: 'Parcelas',
  parcelaN: 'Parcela {n}',
  vencimento: 'Vencimento da parcela {n}',
  valor: 'Valor da parcela {n}',
  maisParcela: 'Mais uma parcela',
  menosParcela: 'Menos uma parcela',
  soma: 'As parcelas somam {soma}.',
  justificativa: 'Justificativa (obrigatória quando o título já tem aprovação)',
  gravar: 'Gravar a alteração',
  avisos: {
    'sem-parcela': 'O título precisa de ao menos uma parcela.',
    'parcela-incompleta': 'Informe o vencimento e um valor maior que zero em cada parcela.',
    'soma-diferente': 'As parcelas somam {soma} e o documento vale {valor}: ajuste antes de gravar.',
    justificativa: 'O título já tem aprovação: escreva a justificativa da alteração.',
    nadaMudou: 'Nada foi mudado.',
  },
};

export const mensagensDevolucaoFornecedor = {
  titulo: 'Devolver ao fornecedor',
  texto:
    'Registra a nota da devolução sobre a parcela em aberto e abate o valor dela. Quando o fornecedor manda a nota, ela é de crédito; quando o hospital emite, é de débito.',
  parcela: 'Parcela em aberto',
  origem: 'Quem emite a nota',
  origens: {
    fornecedor: 'Fornecedor (nota de crédito recebida)',
    hospital: 'Hospital (nota de débito emitida)',
  },
  motivo: 'Motivo',
  dataEmissao: 'Data da nota',
  numeroDocumento: 'Número da nota',
  valor: 'Valor devolvido',
  observacao: 'Observação',
  gravar: 'Registrar a devolução',
  semParcela: 'Nenhuma parcela em aberto para devolver.',
  acimaSaldo: 'O valor devolvido passa do saldo da parcela ({saldo}).',
};
