// Regra 4 do M53: dono de cada dado do colaborador na interface com a folha externa.
import { describe, expect, it } from 'vitest';
import {
  camposRecusadosNoRetorno,
  donoDoCampo,
  grupoDoCampo,
  GRUPOS_DADO_COLABORADOR,
  santePodeEditar,
} from './dono-do-dado.js';

describe('dono do dado (regra 4)', () => {
  it('com folha externa: contratual é dela, assistencial é do Sante SGH', () => {
    expect(donoDoCampo('salario', false)).toBe('folha-externa');
    expect(donoDoCampo('rubricas', false)).toBe('folha-externa');
    expect(donoDoCampo('encargos', false)).toBe('folha-externa');
    expect(donoDoCampo('conselho', false)).toBe('sante');
    expect(donoDoCampo('escala', false)).toBe('sante');
    expect(donoDoCampo('habilitacao', false)).toBe('sante');
    expect(santePodeEditar('salario', false)).toBe(false);
    expect(santePodeEditar('conselho', false)).toBe(true);
  });

  it('com a folha do Sante SGH ligada, o Sante SGH é dono de tudo', () => {
    for (const grupo of Object.values(GRUPOS_DADO_COLABORADOR))
      for (const campo of grupo) {
        expect(donoDoCampo(campo, true)).toBe('sante');
        expect(santePodeEditar(campo, true)).toBe(true);
      }
  });

  it('todo campo pertence a um grupo só', () => {
    const { contratual, assistencial } = GRUPOS_DADO_COLABORADOR;
    for (const c of contratual) expect(grupoDoCampo(c)).toBe('contratual');
    for (const c of assistencial) expect(grupoDoCampo(c)).toBe('assistencial');
    expect(contratual.filter((c) => (assistencial as readonly string[]).includes(c))).toEqual([]);
  });

  it('o retorno não pode trazer dado assistencial', () => {
    expect(camposRecusadosNoRetorno(['liquido', 'rubricas'], false)).toEqual([]);
    expect(camposRecusadosNoRetorno(['liquido', 'conselho', 'escala'], false)).toEqual([
      'conselho',
      'escala',
    ]);
    expect(camposRecusadosNoRetorno(['liquido'], true)).toEqual(['liquido']);
  });
});
