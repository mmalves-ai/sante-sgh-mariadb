import { describe, expect, it } from 'vitest';
import { comSigilo, podeVerConteudo, TEXTO_SIGILO } from './sigilo-categoria.js';

describe('sigilo da psicologia (regra 15)', () => {
  it('só a categoria vê o conteúdo; as demais veem que houve atendimento', () => {
    expect(podeVerConteudo('psicologia', 'psicologia')).toBe(true);
    expect(podeVerConteudo('psicologia', 'medico')).toBe(false);
    expect(podeVerConteudo('psicologia', null)).toBe(false);
    expect(podeVerConteudo('medico', 'enfermagem')).toBe(true);
    expect(podeVerConteudo(null, 'enfermagem')).toBe(true);
    const r = { categoria: 'psicologia' as const, texto: 'SESSAO SINTETICA', em: '2026-10-21' };
    const apagar = (x: typeof r) => ({ ...x, texto: TEXTO_SIGILO });
    expect(comSigilo(r, 'medico', apagar)).toEqual({ ...r, texto: TEXTO_SIGILO, sigilo: true });
    expect(comSigilo(r, 'psicologia', apagar)).toEqual({ ...r, sigilo: false });
  });
});
