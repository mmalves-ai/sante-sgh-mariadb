import { describe, expect, it } from 'vitest';
import { avisosDoPedido, grupoDoAto, itensComKit, podeGravarPedido } from './pedido-exame.js';

const ex = (id: number, extra: Record<string, unknown> = {}) => ({
  id,
  codigo: `E${id}`,
  nome: `EXAME ${id}`,
  ato: 15,
  grupo: 'laboratorio' as const,
  sexo: null,
  idadeMinima: null,
  idadeMaxima: null,
  ativo: true,
  ...extra,
});

describe('pedido de exame (regra 11)', () => {
  const catalogo = new Map([
    [1, ex(1)],
    [2, ex(2, { sexo: 'F' })],
    [3, ex(3, { idadeMinima: 18 })],
    [4, ex(4, { ativo: false })],
    [5, ex(5, { idadeMaxima: 12 })],
  ]);
  const agora = new Date('2026-10-21T12:00:00');

  it('kit somado sem repetir', () => {
    expect(
      itensComKit([{ exame: 1, urgente: true }], { id: 9, nome: 'KIT', exames: [1, 2, 3] }).map(
        (x) => x.exame,
      ),
    ).toEqual([1, 2, 3]);
    expect(
      itensComKit(
        [
          { exame: 1, urgente: false },
          { exame: 1, urgente: true },
        ],
        null,
      ),
    ).toHaveLength(1);
  });

  it('duplicidade, sexo, idade e inativo', () => {
    const av = avisosDoPedido(
      [1, 2, 3, 4, 5].map((exame) => ({ exame, urgente: false })),
      catalogo,
      { sexo: 'M', idade: 15 },
      [
        { exame: 1, em: '2026-10-21T08:00:00', suspenso: false },
        { exame: 3, em: '2026-10-19T08:00:00', suspenso: false },
        { exame: 2, em: '2026-10-21T08:00:00', suspenso: true },
      ],
      agora,
    );
    expect(av.map((a) => `${a.exame}:${a.tipo}`)).toEqual([
      '1:duplicidade',
      '2:sexo',
      '3:idade',
      '4:inativo',
      '5:idade',
    ]);
    expect(podeGravarPedido(av, true)).toBe(false);
    const semBloqueio = av.filter((a) => !a.bloqueia);
    expect(podeGravarPedido(semBloqueio, false)).toBe(false);
    expect(podeGravarPedido(semBloqueio, true)).toBe(true);
    expect(podeGravarPedido([], false)).toBe(true);
    expect(
      avisosDoPedido([{ exame: 99, urgente: false }], catalogo, { sexo: null, idade: null }, [], agora)[0]
        ?.tipo,
    ).toBe('inativo');
    expect(
      avisosDoPedido([{ exame: 3, urgente: false }], catalogo, { sexo: null, idade: null }, [], agora),
    ).toEqual([]);
  });

  it('grupo pelo ato', () => {
    expect(grupoDoAto(15)).toBe('laboratorio');
    expect([16, 24, 25].map(grupoDoAto)).toEqual(['imagem', 'imagem', 'imagem']);
    expect(grupoDoAto(90)).toBe('outros');
  });
});
