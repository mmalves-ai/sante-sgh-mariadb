// Erro de validação com CÓDIGO e parâmetros (regra 15 do M07): a tela traduz pelo vue-i18n
// (`ui.validacao.<codigo>`) e nunca mostra a mensagem crua do contrato. A mensagem em português continua
// em `message` para o servidor e os testes; ela nunca leva dado além do que o próprio usuário digitou.

/** Códigos de validação conhecidos (cada um tem texto em `ui.validacao` no pacote de tradução). */
export const CODIGOS_VALIDACAO = [
  'data.formato',
  'data.inexistente',
  'data.fora-da-faixa',
  'hora.formato',
  'hora.fora-do-intervalo',
  'instante.formato',
  'booleano.valor',
  'cp1252.emoji',
  'cp1252.controle',
  'cp1252.caractere',
  'texto.tamanho',
] as const;
export type CodigoValidacao = (typeof CODIGOS_VALIDACAO)[number];

export type ParametrosValidacao = Readonly<Record<string, string | number | boolean>>;

export interface FalhaValidacao {
  readonly codigo: CodigoValidacao;
  readonly parametros: ParametrosValidacao;
}

export class ErroValidacao extends Error implements FalhaValidacao {
  override readonly name: string = 'ErroValidacao';
  readonly codigo: CodigoValidacao;
  readonly parametros: ParametrosValidacao;
  constructor(codigo: CodigoValidacao, parametros: ParametrosValidacao, mensagem: string) {
    super(mensagem);
    this.codigo = codigo;
    this.parametros = parametros;
  }
}

/** Extrai código e parâmetros de um erro lançado pelos contratos (ou null, se não for de validação). */
export function falhaDe(erro: unknown): FalhaValidacao | null {
  return erro instanceof ErroValidacao ? { codigo: erro.codigo, parametros: erro.parametros } : null;
}
