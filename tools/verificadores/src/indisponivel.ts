// Operação de ferramenta que ainda não tem leitura no modelo próprio: recusa explícita, com o pedido registrado
// (docs/obra/fatias/f22/saida/05-10.json), nunca resultado vazio silencioso.
export class ErroIndisponivel extends Error {
  readonly operacao: string;
  readonly falta: string;

  constructor(operacao: string, falta: string) {
    super(`${operacao}: indisponível no modelo próprio. Falta: ${falta} (pedido registrado na F2.2, lote 05-10).`);
    this.name = 'ErroIndisponivel';
    this.operacao = operacao;
    this.falta = falta;
  }
}
