// Registro dos módulos para os testes HTTP do config: o mesmo REGISTRO_MODULOS, com o módulo config montado com as
// opções do teste (fonte de configuração, domínios, onda 0, painéis de arquivo). Nada conecta a banco.
import { type CarregadorModulo, REGISTRO_MODULOS } from '../registro.js';
import { modulo, type OpcoesModuloConfig } from './modulo.js';

export function registroComConfig(
  opcoes: OpcoesModuloConfig = {},
  extras: Readonly<Record<string, CarregadorModulo>> = {},
): Readonly<Record<string, CarregadorModulo>> {
  return {
    ...REGISTRO_MODULOS,
    ...extras,
    config: async () => ({ modulo: (ctx) => modulo(ctx, opcoes) }),
  };
}
