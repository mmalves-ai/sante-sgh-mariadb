// Regra 18 (NR32-02): acidente com material biológico dispara a avaliação da profilaxia, o acompanhamento sorológico e
// o alerta do prazo da CAT (dias úteis em parâmetro; óbito no mesmo dia).
import { describe, expect, it } from 'vitest';
import {
  conferirAcidente,
  conferirEmissaoCat,
  conferirEncerramento,
  diaUtil,
  feriadoNacional,
  marcosSorologia,
  pendenciasAcidente,
  prazoCat,
  profilaxiaSugerida,
  tipoCatInicial,
} from './cat.js';

describe('prazo da CAT', () => {
  it('primeiro dia útil seguinte (sexta → segunda; véspera de feriado pula o feriado)', () => {
    expect(prazoCat('2026-10-21T14:00', false)).toBe('2026-10-22'); // quarta → quinta
    expect(prazoCat('2026-10-23T22:30', false)).toBe('2026-10-26'); // sexta → segunda
    expect(prazoCat('2026-11-01T08:00', false)).toBe('2026-11-03'); // domingo; 02/11 é feriado
    expect(prazoCat('2026-04-02T10:00', false)).toBe('2026-04-06'); // quinta; Sexta-feira Santa 03/04
  });
  it('óbito: no mesmo dia; parâmetro de 2 dias úteis; parâmetro 0 = mesmo dia', () => {
    expect(prazoCat('2026-10-23T22:30', true)).toBe('2026-10-23');
    expect(prazoCat('2026-10-21T14:00', false, 2)).toBe('2026-10-23');
    expect(prazoCat('2026-10-21T14:00', false, 0)).toBe('2026-10-21');
  });
  it('feriados nacionais fixos e a Sexta-feira Santa', () => {
    expect(feriadoNacional('2026-11-20')).toBe(true);
    expect(feriadoNacional('2027-03-26')).toBe(true); // Páscoa de 2027 em 28/03
    expect(feriadoNacional('2026-10-26')).toBe(false);
    expect(diaUtil('2026-10-24')).toBe(false);
    expect(diaUtil('2026-10-26')).toBe(true);
  });
});

describe('profilaxia e sorologia', () => {
  const bio = {
    biologico: true,
    perfurocortante: true,
    exposicao: 'percutanea' as const,
    material: 'sangue' as const,
    fonteTeste: null,
  };
  it('percutânea com sangue: indicada; fonte não reagente, pele íntegra ou fluido sem sangue: não indicada', () => {
    expect(profilaxiaSugerida(bio)).toBe('indicada');
    expect(profilaxiaSugerida({ ...bio, fonteTeste: 'reagente' })).toBe('indicada');
    expect(profilaxiaSugerida({ ...bio, fonteTeste: 'nao-reagente' })).toBe('nao-indicada');
    expect(profilaxiaSugerida({ ...bio, exposicao: 'pele-integra' })).toBe('nao-indicada');
    expect(profilaxiaSugerida({ ...bio, material: 'fluido-sem-sangue' })).toBe('nao-indicada');
    expect(profilaxiaSugerida({ ...bio, biologico: false })).toBe('nao-indicada');
  });
  it('marcos de 0, 30, 90 e 180 dias; sem material biológico, nenhum', () => {
    expect(marcosSorologia('2026-10-21T14:00', true)).toEqual([
      { marco: 'd0', prevista: '2026-10-21' },
      { marco: 'd30', prevista: '2026-11-20' },
      { marco: 'd90', prevista: '2027-01-19' },
      { marco: 'd180', prevista: '2027-04-19' },
    ]);
    expect(marcosSorologia('2026-10-21T14:00', false)).toEqual([]);
  });
});

describe('conferência do acidente', () => {
  const e = {
    ocorridoEm: '2026-10-21T14:00',
    biologico: true,
    perfurocortante: true,
    exposicao: 'percutanea' as const,
    material: 'sangue' as const,
    fonteTeste: null,
    obito: false,
    profilaxia: 'iniciada' as const,
    profilaxiaEm: '2026-10-21T15:00',
  };
  const agora = '2026-10-26T10:00';
  it('passa; futuro e antes da admissão recusados', () => {
    expect(conferirAcidente(e, agora, '2025-01-10')).toBeNull();
    expect(conferirAcidente({ ...e, ocorridoEm: '2026-10-26T11:00' }, agora, '2025-01-10')?.codigo).toBe(
      'acidente-futuro',
    );
    expect(conferirAcidente(e, agora, '2026-10-22')?.codigo).toBe('acidente-antes-admissao');
  });
  it('biológico sem exposição, profilaxia sem biológico, iniciada sem hora, hora fora da janela', () => {
    expect(conferirAcidente({ ...e, exposicao: null }, agora, '2025-01-10')?.codigo).toBe(
      'biologico-incompleto',
    );
    expect(conferirAcidente({ ...e, biologico: false }, agora, '2025-01-10')?.codigo).toBe(
      'profilaxia-sem-biologico',
    );
    expect(conferirAcidente({ ...e, profilaxiaEm: null }, agora, '2025-01-10')?.codigo).toBe(
      'profilaxia-sem-hora',
    );
    expect(conferirAcidente({ ...e, profilaxiaEm: '2026-10-21T13:00' }, agora, '2025-01-10')?.codigo).toBe(
      'profilaxia-fora-da-janela',
    );
  });
});

describe('pendências e encerramento', () => {
  const a = {
    estado: 'aberto' as const,
    catNumero: null,
    catPrazo: '2026-10-22',
    profilaxia: 'indicada' as const,
    sorologias: [
      { prevista: '2026-10-21', resultado: null },
      { prevista: '2026-11-20', resultado: null },
    ],
  };
  it('CAT a emitir no prazo, atrasada depois; profilaxia a iniciar; sorologia atrasada depois de 7 dias', () => {
    expect(pendenciasAcidente(a, '2026-10-22')).toEqual(['cat-prazo', 'profilaxia-indicada']);
    expect(pendenciasAcidente(a, '2026-10-29')).toEqual([
      'cat-atrasada',
      'profilaxia-indicada',
      'sorologia-atrasada',
    ]);
    expect(pendenciasAcidente({ ...a, estado: 'encerrado', catNumero: '1' }, '2026-12-01')).toEqual([]);
  });
  it('encerrar pede a CAT e as sorologias registradas', () => {
    expect(conferirEncerramento(a)?.codigo).toBe('sem-cat');
    expect(conferirEncerramento({ ...a, catNumero: '123' })?.codigo).toBe('sorologia-pendente');
    const ok = {
      ...a,
      catNumero: '123',
      sorologias: a.sorologias.map((s) => ({ ...s, resultado: 'sem-alteracao' })),
    };
    expect(conferirEncerramento(ok)).toBeNull();
    expect(conferirEncerramento({ ...ok, estado: 'encerrado' })?.codigo).toBe('ja-encerrado');
  });
});

describe('emissão da CAT (D-CAT-525: a inicial nunca é substituída)', () => {
  const tipos = [
    { codigo: 5, rotulo: 'Comunicação de Óbito' },
    { codigo: 7, rotulo: 'INICIAL' },
    { codigo: 9, rotulo: 'Reabertura' },
  ];
  it('o tipo inicial vem do domínio lido, pelo rótulo', () => {
    expect(tipoCatInicial(tipos)).toBe(7);
    expect(tipoCatInicial([{ codigo: 1, rotulo: 'Reabertura' }])).toBeNull();
  });
  it('inicial uma vez; reabertura e óbito recusados sem a inicial e, com ela, para não sobrescrevê-la', () => {
    expect(conferirEmissaoCat(7, tipos, null)).toEqual({ inicial: true });
    expect(conferirEmissaoCat(4, tipos, null)).toMatchObject({ codigo: 'tipo-cat' });
    expect(conferirEmissaoCat(7, tipos, 'CAT-1')).toMatchObject({ codigo: 'cat-ja-emitida' });
    expect(conferirEmissaoCat(9, tipos, null)).toMatchObject({ codigo: 'sem-cat-inicial' });
    expect(conferirEmissaoCat(5, tipos, null)).toMatchObject({ codigo: 'sem-cat-inicial' });
    expect(conferirEmissaoCat(9, tipos, 'CAT-1')).toMatchObject({ codigo: 'cat-reabertura-pendente' });
    expect(conferirEmissaoCat(5, tipos, 'CAT-1')).toMatchObject({ codigo: 'cat-reabertura-pendente' });
    expect(conferirEmissaoCat(1, [{ codigo: 1, rotulo: 'Reabertura' }], null)).toMatchObject({
      codigo: 'tipo-cat-inicial',
    });
  });
});
