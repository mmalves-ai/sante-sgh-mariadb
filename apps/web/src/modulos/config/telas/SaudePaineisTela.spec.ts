// @vitest-environment jsdom
// Atalhos dos painéis de saúde (M09): a tela aponta para os painéis certos do Grafana e as duas rotas exigem
// sistema.saude.ler (sem a permissão, "sem permissão").
import { criarI18n } from '@sgh/ui';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { createMemoryHistory } from 'vue-router';
import { mensagensWeb } from '../../../i18n/pt-BR.js';
import { criarRoteador } from '../../../roteador.js';
import SaudePaineisTela from './SaudePaineisTela.vue';

const i18n = () => criarI18n(mensagensWeb as unknown as Record<string, unknown>);

const sessao = (permissoes: string[]) => async () => ({
  usuario: { id: 's', nome: 'S' },
  rede: null,
  estabelecimentos: [],
  estabelecimentoAtivo: null,
  permissoes,
  sintetica: true,
  bloqueioInatividadeSegundos: 0,
});

describe('painéis de saúde (M09)', () => {
  it('banco: só o painel "Banco e coexistência"; sistema: "Técnico" e "Jornadas"', () => {
    const banco = mount(SaudePaineisTela, { props: { painel: 'banco' }, global: { plugins: [i18n()] } });
    const links = banco.findAll('a').map((a) => a.attributes('href'));
    expect(links).toEqual(['http://127.0.0.1:3330/d/sgh-banco']);
    expect(banco.find('h1').text()).toMatch(/banco/i);
    const sistema = mount(SaudePaineisTela, { props: { painel: 'sistema' }, global: { plugins: [i18n()] } });
    expect(sistema.findAll('a').map((a) => a.attributes('href'))).toEqual([
      'http://127.0.0.1:3330/d/sgh-tecnico',
      'http://127.0.0.1:3330/d/sgh-jornadas',
    ]);
    for (const a of sistema.findAll('a')) expect(a.attributes('rel')).toContain('noopener');
  });

  it.each(['/administracao/saude', '/administracao/coexistencia/saude'])(
    '%s exige sistema.saude.ler',
    async (caminho) => {
      const sem = criarRoteador(sessao(['acesso.inicio.ler']), {
        historico: createMemoryHistory(),
        desenvolvimento: true,
      });
      await sem.push(caminho);
      expect(sem.currentRoute.value.name).toBe('sem-permissao');
      const com = criarRoteador(sessao(['acesso.inicio.ler', 'sistema.saude.ler']), {
        historico: createMemoryHistory(),
        desenvolvimento: true,
      });
      await com.push(caminho);
      expect(String(com.currentRoute.value.name)).toMatch(/^config\.saude-/);
    },
  );
});
