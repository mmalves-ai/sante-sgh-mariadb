// @vitest-environment jsdom
// W0-07 (M4, revisão): o aviso da OS num leito. O servidor manda só o código do aviso (AVISOS_OS_NO_LEITO) e a tela o
// traduz em crudNir.osLeito.avisos (nada de texto cru, nem promessa de bloqueio adiado); o botão de bloquear só aparece
// para quem pode bloquear o leito (leitos.bloqueio.criar), senão o POST /leitos/estados devolveria 403. Dados sintéticos.
import { AVISOS_OS_NO_LEITO, type OsNoLeito } from '@sgh/contratos';
import { criarI18n, instalarUi, resolverMarca } from '@sgh/ui';
import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import type { App } from 'vue';
import { definirSessaoDaTela } from '../../../casca/sessao/pode.js';
import { mensagensWeb } from '../../../i18n/pt-BR.js';
import OsNoLeitoAviso from './OsNoLeitoAviso.vue';

const ui = { install: (app: App) => instalarUi(app, resolverMarca(undefined).pacote) };
const montar = (leito: OsNoLeito) =>
  mount(OsNoLeitoAviso, {
    props: { leito },
    global: {
      plugins: [criarI18n(mensagensWeb as unknown as Record<string, unknown>), ui] as never,
    },
  });
const base: OsNoLeito = {
  leito: { bloco: '1', acomodacao: 'APT1', leito: '01' },
  chave: '1|APT1|01',
  propostaBloqueio: false,
  observacao: 'OS 2026-000123',
  bloqueioEncerrado: false,
  higienizacao: null,
  aviso: null,
};

afterEach(() => definirSessaoDaTela(null));

describe('OsNoLeitoAviso (W0-07, M4)', () => {
  it('cada código de aviso tem texto no i18n, sem "fica para quando ele vagar"', () => {
    for (const aviso of AVISOS_OS_NO_LEITO) {
      const w = montar({ ...base, aviso });
      const texto = w.get('[data-testid="os-leito-aviso"]').text();
      expect(texto, aviso).not.toContain('crudNir.');
      expect(texto, aviso).toContain('1 / APT1 / 01');
      expect(texto).not.toMatch(/fica para quando/);
      w.unmount();
    }
    const ocupado = montar({ ...base, aviso: 'leito-ocupado' });
    expect(ocupado.text()).toMatch(/bloqueie-o pelo mapa de leitos quando vagar/);
    expect(ocupado.text()).toContain('OS 2026-000123');
  });

  it('a proposta com o botão só para quem pode bloquear o leito', () => {
    definirSessaoDaTela({ permissoes: ['leitos.bloqueio.criar'] } as never);
    const com = montar({ ...base, propostaBloqueio: true });
    expect(com.find('[data-testid="os-leito-bloquear"]').exists()).toBe(true);
    com.unmount();
    definirSessaoDaTela({ permissoes: ['manutencao.os.abrir'] } as never);
    const sem = montar({ ...base, propostaBloqueio: true });
    expect(sem.find('[data-testid="os-leito-bloquear"]').exists()).toBe(false);
    expect(sem.find('[data-testid="os-leito-proposta"]').exists()).toBe(false);
  });
});
