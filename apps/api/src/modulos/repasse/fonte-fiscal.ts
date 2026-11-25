// A fonte do dado fiscal e da conta do profissional para o RPA (F3.1, 02-CAD linha 16): a leitura `destinoDoRepasse`
// do complemento do cadastro no banco do cliente, no dia e no estabelecimento da sessão. Só leitura; sem o banco do
// cliente (porta em memória), não há fonte e o RPA usa a regra geral.
import type { ContextoPorta } from '../cadastro/porta.js';
import type { NucleoCadastro } from '../cadastro/porta-propria.js';
import { ProfissionalComplementoProprio } from '../cadastro/profissional-complemento-proprio.js';
import type { FonteFiscalRepasse } from './servico.js';

export const FONTE_FISCAL_REPASSE = Symbol('FONTE_FISCAL_REPASSE');

export function fonteFiscalDoComplemento(complemento: ProfissionalComplementoProprio): FonteFiscalRepasse {
  return async (c, profissional, dia) => {
    const d = await complemento.destinoDoRepasse(
      c as ContextoPorta,
      profissional,
      dia,
      c.estabelecimento ?? null,
    );
    return { dadoFiscal: d.dadoFiscal, conta: d.conta };
  };
}

export function fonteFiscalRepasse(nucleo: NucleoCadastro, cliente: string): FonteFiscalRepasse {
  return fonteFiscalDoComplemento(new ProfissionalComplementoProprio(nucleo, cliente));
}
