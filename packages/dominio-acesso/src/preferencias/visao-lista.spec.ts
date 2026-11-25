// Visão de lista (01-ADM L84): o código da tela do menu, as colunas que a lista mostra e a troca de colunas.
import { describe, expect, it } from 'vitest';
import {
  alternarColuna,
  codigoTelaDoMenu,
  colunasDaVisao,
  conferirVisaoTela,
  moverColuna,
  visaoDeFabrica,
} from './preferencias-usuario.js';

const FABRICA = ['data', 'usuario', 'acao', 'alvo'];

describe('visão de lista por usuário (01-ADM L84)', () => {
  it('código da tela do menu: estável, válido e único mesmo com endereços que começam iguais', () => {
    expect(codigoTelaDoMenu('/administracao/usuarios')).toBe('administracao.usuarios');
    expect(codigoTelaDoMenu('/')).toBe('raiz');
    const a = codigoTelaDoMenu('/administracao/auditoria/acessos-prontuario');
    const b = codigoTelaDoMenu('/administracao/auditoria/acessos-prontuario-externo');
    expect(a).not.toBe(b);
    for (const c of [a, b]) {
      expect(c.length).toBeLessThanOrEqual(30);
      expect(c).toMatch(/^[A-Za-z0-9._-]+$/);
    }
    expect(codigoTelaDoMenu('/administracao/auditoria/acessos-prontuario')).toBe(a);
  });

  it('colunas da visão: só as que a tela ainda oferece, na ordem guardada; sem nenhuma, as de fábrica', () => {
    expect(colunasDaVisao(FABRICA, null)).toEqual(FABRICA);
    expect(colunasDaVisao(FABRICA, ['alvo', 'data'])).toEqual(['alvo', 'data']);
    expect(colunasDaVisao(FABRICA, ['alvo', 'coluna-antiga', 'alvo'])).toEqual(['alvo']);
    expect(colunasDaVisao(FABRICA, ['coluna-antiga'])).toEqual(FABRICA);
    expect(visaoDeFabrica(FABRICA, colunasDaVisao(FABRICA, []))).toBe(true);
    expect(visaoDeFabrica(FABRICA, ['usuario', 'data', 'acao', 'alvo'])).toBe(false);
  });

  it('esconder e mostrar: a coluna volta na posição de fábrica e a última visível não sai', () => {
    const sem = alternarColuna(FABRICA, FABRICA, 'usuario');
    expect(sem).toEqual(['data', 'acao', 'alvo']);
    expect(alternarColuna(FABRICA, sem, 'usuario')).toEqual(FABRICA);
    expect(alternarColuna(FABRICA, ['alvo', 'data'], 'acao')).toEqual(['acao', 'alvo', 'data']);
    expect(alternarColuna(FABRICA, ['data'], 'alvo')).toEqual(['data', 'alvo']);
    expect(alternarColuna(FABRICA, ['data'], 'data')).toEqual(['data']);
    expect(alternarColuna(FABRICA, ['data'], 'inexistente')).toEqual(['data']);
  });

  it('mover: uma posição por vez; na ponta fica onde está', () => {
    expect(moverColuna(FABRICA, 'usuario', -1)).toEqual(['usuario', 'data', 'acao', 'alvo']);
    expect(moverColuna(FABRICA, 'usuario', 1)).toEqual(['data', 'acao', 'usuario', 'alvo']);
    expect(moverColuna(FABRICA, 'data', -1)).toEqual(FABRICA);
    expect(moverColuna(FABRICA, 'alvo', 1)).toEqual(FABRICA);
    expect(moverColuna(FABRICA, 'inexistente', 1)).toEqual(FABRICA);
  });

  it('a gravação recusa coluna que a tela não oferece', () => {
    expect(conferirVisaoTela({ colunas: ['data', 'salario'] }, { colunasDaTela: FABRICA })).toEqual({
      recusa: 'coluna-desconhecida',
    });
    expect('visao' in conferirVisaoTela({ colunas: ['alvo', 'data'] }, { colunasDaTela: FABRICA })).toBe(
      true,
    );
  });
});
