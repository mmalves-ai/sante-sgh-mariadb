import { describe, expect, it } from 'vitest';
import { montar } from '../testes/montar.js';
import SanteAlerta from './SanteAlerta.vue';
import SanteEstado from './SanteEstado.vue';

describe('SanteEstado e SanteAlerta (regra 3)', () => {
  it('estado clínico mostra ícone e texto, com as cores de token da paleta clínica', () => {
    const w = montar(SanteEstado, { props: { estado: 'leito-higienizacao' } });
    expect(w.text()).toBe('Em higienização');
    expect(w.find('svg[data-icone="limpeza"]').exists()).toBe(true);
    expect(w.attributes('style')).toContain('var(--sgh-clinica-leito-higienizacao-fundo)');
    w.unmount();
  });

  it('alerta sem texto falha (cor nunca é a única informação)', () => {
    expect(() => montar(SanteAlerta, { props: { texto: '  ' } })).toThrow(/exige texto/);
  });

  it('alerta clínico usa o token de alerta (não o vinho) e pode ser anunciado', () => {
    const w = montar(SanteAlerta, { props: { texto: 'ALERGIA: dipirona', anunciar: true } });
    expect(w.attributes('role')).toBe('alert');
    expect(w.attributes('data-variante')).toBe('alerta');
    expect(w.find('svg').exists()).toBe(true);
    w.unmount();
  });
});
