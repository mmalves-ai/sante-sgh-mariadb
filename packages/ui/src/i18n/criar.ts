import { createI18n } from 'vue-i18n';
import { mensagensUi } from './pt-BR.js';

type Mensagens = Record<string, unknown>;

function juntar(a: Mensagens, b: Mensagens): Mensagens {
  const r: Mensagens = { ...a };
  for (const [k, v] of Object.entries(b)) {
    const atual = r[k];
    r[k] =
      atual && typeof atual === 'object' && v && typeof v === 'object'
        ? juntar(atual as Mensagens, v as Mensagens)
        : v;
  }
  return r;
}

/** vue-i18n em pt-BR com os textos do @sgh/ui e os da aplicação. */
export function criarI18n(mensagensDaAplicacao: Mensagens = {}) {
  return createI18n({
    legacy: false,
    locale: 'pt-BR',
    fallbackLocale: 'pt-BR',
    missingWarn: false,
    fallbackWarn: false,
    messages: {
      'pt-BR': juntar(mensagensUi as unknown as Mensagens, mensagensDaAplicacao),
    } as unknown as Record<string, Record<string, never>>,
  });
}
