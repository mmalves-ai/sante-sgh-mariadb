import { describe, expect, it } from 'vitest';
import { CODIGOS_VALIDACAO } from '@sgh/contratos';
import { mensagensUi } from './i18n/pt-BR.js';
import { createApp } from 'vue';
import { criarI18n } from './i18n/criar.js';
import { instalarUi } from './instalar.js';
import { pacoteDeMarca } from './marca/index.js';
import { ID_FOLHA_TOKENS, injetarTokens } from './tema/injetar.js';
import { criarPresetMarca } from './tema/preset.js';

describe('instalação do @sgh/ui', () => {
  it('instala o OpenVue com o tema da marca e injeta a folha de tokens uma só vez', () => {
    const app = createApp({ render: () => null });
    instalarUi(app, pacoteDeMarca('rede-sante'));
    injetarTokens(document, pacoteDeMarca('rede-sante'));
    expect(document.querySelectorAll(`#${ID_FOLHA_TOKENS}`)).toHaveLength(1);
    expect(document.getElementById(ID_FOLHA_TOKENS)?.textContent).toContain('--sgh-primaria: #83102c;');
    expect(app.config.globalProperties.$primevue).toBeDefined();
  });

  it('preset do OpenVue criado a partir das cores da marca', () => {
    const preset = criarPresetMarca(pacoteDeMarca('rede-sante')) as {
      semantic: { primary: Record<string, string> };
    };
    expect(preset.semantic.primary['500']).toBe('#83102c');
  });

  it('i18n junta os textos do ui com os da aplicação (a aplicação pode sobrescrever)', () => {
    const i18n = criarI18n({ app: { ola: 'Olá' }, ui: { fechar: 'Fechar janela' } });
    expect(i18n.global.t('app.ola')).toBe('Olá');
    expect(i18n.global.t('ui.fechar')).toBe('Fechar janela');
    expect(i18n.global.t('ui.provisorio')).toBe('provisório');
  });
});

describe('toda falha de validação dos contratos tem texto no vue-i18n', () => {
  it.each(CODIGOS_VALIDACAO)('ui.validacao.%s existe', (codigo) => {
    const [grupo, nome] = codigo.split('.') as [string, string];
    const validacao = (mensagensUi.ui as unknown as { validacao: Record<string, Record<string, string>> })
      .validacao;
    expect(typeof validacao[grupo]?.[nome]).toBe('string');
  });
});
