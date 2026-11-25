// Textos da baixa do título a pagar com valor informado (F3.8, 07-FIN linha 63): parcial, desconto e acréscimos.
export const mensagensBaixaFinanceiro = {
  saldo: 'Saldo',
  ajuste:
    'Em branco, paga o saldo inteiro. Informe o valor pago para pagar só uma parte, e o desconto ou os acréscimos quando houver.',
  valorPago: 'Valor pago',
  desconto: 'Desconto',
  juros: 'Juros',
  multa: 'Multa',
  acrescimo: 'Outros acréscimos',
  camposDe: 'Valores da baixa de {titulo}',
  previaQuita: 'Sai da conta {desembolso}; a parcela fica quitada.',
  previaParcial: 'Sai da conta {desembolso}; liquida {liquida} e ficam {resta} em aberto.',
  avisos: {
    valorInvalido: 'Informe valores maiores que zero.',
    descontoTotal: 'O desconto cobre o valor inteiro: nada sairia da conta.',
    soEncargos: 'O valor pago não cobre os juros, a multa e o acréscimo: nada do título seria liquidado.',
    acimaDoSaldo: 'O valor liquidado passa do saldo da parcela.',
  },
};
