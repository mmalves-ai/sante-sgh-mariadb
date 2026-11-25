import { describe, expect, it } from 'vitest';
import { decidirFavorito, ordenarFavoritos, TETO_FAVORITOS_PRESCRITOR } from './favoritos.js';

const novo = { tipo: 'item_prescritivel' as const, alvo: 10, rotulo: null, ordem: null };

describe('favoritos do prescritor (03-PEP L107)', () => {
  it('inclui o primeiro favorito do alvo', () => {
    expect(decidirFavorito(novo, [])).toEqual({ acao: 'incluir' });
  });

  it('recusa o mesmo alvo já ativo e não confunde tipos diferentes com o mesmo id', () => {
    expect(
      decidirFavorito(novo, [{ id: 1, tipo: 'item_prescritivel', alvo: 10, ativo: true }]),
    ).toMatchObject({
      acao: 'recusar',
      codigo: 'favorito-duplicado',
    });
    expect(decidirFavorito(novo, [{ id: 1, tipo: 'kit_prescricao', alvo: 10, ativo: true }])).toEqual({
      acao: 'incluir',
    });
  });

  it('reativa o favorito desativado mais recente do mesmo alvo em vez de duplicar', () => {
    expect(
      decidirFavorito(novo, [
        { id: 3, tipo: 'item_prescritivel', alvo: 10, ativo: false },
        { id: 7, tipo: 'item_prescritivel', alvo: 10, ativo: false },
      ]),
    ).toEqual({ acao: 'reativar', id: 7 });
  });

  it('valida na hora: tipo, alvo, rótulo e o teto de ativos', () => {
    expect(decidirFavorito({ ...novo, tipo: 'exame' as never }, [])).toMatchObject({
      codigo: 'favorito-invalido',
    });
    expect(decidirFavorito({ ...novo, alvo: 0 }, [])).toMatchObject({ codigo: 'favorito-invalido' });
    expect(decidirFavorito({ ...novo, rotulo: '  ' }, [])).toMatchObject({ codigo: 'favorito-invalido' });
    const cheios = Array.from({ length: TETO_FAVORITOS_PRESCRITOR }, (_, i) => ({
      id: i + 1,
      tipo: 'protocolo_prescricao',
      alvo: 1000 + i,
      ativo: true,
    }));
    expect(decidirFavorito(novo, cheios)).toMatchObject({ acao: 'recusar', codigo: 'favorito-invalido' });
  });

  it('ordena pela ordem do prescritor e deixa os sem ordem no fim, pelo rótulo', () => {
    const r = ordenarFavoritos([
      { ordem: null, rotulo: 'Dipirona' },
      { ordem: 2, rotulo: 'Zeta' },
      { ordem: null, rotulo: 'Amoxicilina' },
      { ordem: 1, rotulo: 'Omega' },
    ]);
    expect(r.map((x) => x.rotulo)).toEqual(['Omega', 'Zeta', 'Amoxicilina', 'Dipirona']);
  });
});
