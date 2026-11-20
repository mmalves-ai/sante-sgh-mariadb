// Histórico funcional (só inclusão): cada mudança vira linha nova com o antes e o depois.
import { describe, expect, it } from 'vitest';
import { aplicarMudanca, type SituacaoFuncional } from './historico.js';

const atual: SituacaoFuncional = {
  cargo: 'Técnico de enfermagem',
  funcao: null,
  cargaSemanalHoras: 36,
  centroCusto: 12,
  unidade: null,
  setor: 'UTI adulto',
};
const limites = { admissao: '2024-03-01', ultimaVigencia: '2025-06-01' };

describe('mudança funcional', () => {
  it('cargo, função, jornada e lotação geram um evento cada', () => {
    const r = aplicarMudanca(
      atual,
      {
        vigencia: '2026-11-01',
        cargo: 'Enfermeiro',
        funcao: 'Supervisão',
        cargaSemanalHoras: 30,
        lotacao: { centroCusto: 14, unidade: 2, setor: null },
      },
      limites,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.eventos.map((e) => e.tipo)).toEqual(['cargo', 'funcao', 'jornada', 'lotacao']);
    expect(r.eventos[2]).toMatchObject({ antes: '36 h semanais', depois: '30 h semanais' });
    expect(r.eventos[3]).toMatchObject({
      antes: 'centro de custo 12 · UTI adulto',
      depois: 'centro de custo 14 · unidade 2',
    });
    expect(r.nova).toEqual({
      cargo: 'Enfermeiro',
      funcao: 'Supervisão',
      cargaSemanalHoras: 30,
      centroCusto: 14,
      unidade: 2,
      setor: null,
    });
  });

  it('valores iguais aos atuais não geram evento', () => {
    expect(
      aplicarMudanca(
        atual,
        {
          vigencia: '2026-11-01',
          cargo: atual.cargo,
          cargaSemanalHoras: 36,
          lotacao: { centroCusto: 12, unidade: null, setor: 'UTI adulto' },
        },
        limites,
      ),
    ).toMatchObject({ ok: false, recusa: 'sem-mudanca' });
    expect(aplicarMudanca(atual, { vigencia: '2026-11-01' }, limites)).toMatchObject({ ok: false });
  });

  it('a vigência não volta para antes da última mudança nem da admissão', () => {
    expect(aplicarMudanca(atual, { vigencia: '2025-05-31', cargo: 'Enfermeiro' }, limites)).toMatchObject({
      ok: false,
      recusa: 'vigencia-anterior',
    });
    expect(
      aplicarMudanca(
        atual,
        { vigencia: '2024-02-28', cargo: 'Enfermeiro' },
        { ...limites, ultimaVigencia: null },
      ),
    ).toMatchObject({ ok: false, recusa: 'vigencia-anterior' });
    expect(
      aplicarMudanca(
        atual,
        { vigencia: '2024-03-01', cargo: 'Enfermeiro' },
        { ...limites, ultimaVigencia: null },
      ).ok,
    ).toBe(true);
  });
});
