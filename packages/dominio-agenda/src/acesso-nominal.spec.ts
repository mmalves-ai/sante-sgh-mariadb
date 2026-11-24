import { describe, expect, it } from 'vitest';
import {
  acessoNominal,
  mudarLista,
  podeGravarNaAgenda,
  podeMarcarNaAgenda,
  podeVerAgenda,
} from './acesso-nominal.js';

const lista = [
  { usuario: 1, podeMarcar: true },
  { usuario: 2, podeMarcar: false },
];

describe('acesso nominal à agenda (02-AGE linha 40)', () => {
  it('agenda sem lista é livre: vale só o escopo do cargo', () => {
    expect(acessoNominal([], 9)).toBe('livre');
    expect(podeVerAgenda('livre') && podeMarcarNaAgenda('livre')).toBe(true);
  });
  it('na lista: marca ou só consulta; fora da lista: não vê; gestor vê sem marcar', () => {
    expect(acessoNominal(lista, 1)).toBe('marca');
    expect(acessoNominal(lista, 2)).toBe('consulta');
    expect(acessoNominal(lista, 3)).toBe('sem-acesso');
    expect(acessoNominal(lista, null)).toBe('sem-acesso');
    expect(acessoNominal(lista, 3, true)).toBe('gestor');
    expect(podeMarcarNaAgenda('consulta')).toBe(false);
    expect(podeMarcarNaAgenda('gestor')).toBe(false);
    expect(podeVerAgenda('gestor')).toBe(true);
    expect(podeVerAgenda('sem-acesso')).toBe(false);
  });
  it('o administrador da plataforma vê e marca em qualquer agenda, mesmo fora da lista ou só como consulta', () => {
    expect(acessoNominal(lista, 3, false, true)).toBe('administrador');
    expect(acessoNominal(lista, 2, true, true)).toBe('administrador');
    expect(acessoNominal([], 3, false, true)).toBe('livre');
    expect(podeVerAgenda('administrador') && podeMarcarNaAgenda('administrador')).toBe(true);
    expect(podeGravarNaAgenda('administrador', 'manutencao')).toBe(true);
  });
  it('gravação: marcação só de quem marca; manutenção também do gestor; quem só consulta não grava', () => {
    expect(podeGravarNaAgenda('livre', 'marcacao') && podeGravarNaAgenda('marca', 'marcacao')).toBe(true);
    expect(podeGravarNaAgenda('consulta', 'marcacao')).toBe(false);
    expect(podeGravarNaAgenda('gestor', 'marcacao')).toBe(false);
    expect(podeGravarNaAgenda('sem-acesso', 'marcacao')).toBe(false);
    expect(podeGravarNaAgenda('gestor', 'manutencao') && podeGravarNaAgenda('marca', 'manutencao')).toBe(
      true,
    );
    expect(podeGravarNaAgenda('consulta', 'manutencao')).toBe(false);
    expect(podeGravarNaAgenda('sem-acesso', 'manutencao')).toBe(false);
  });
  it('a lista nunca fica sem quem marca', () => {
    expect(mudarLista([], { acao: 'incluir', usuario: 5, podeMarcar: false })).toMatchObject({
      recusa: { codigo: 'lista-sem-quem-marca' },
    });
    expect(mudarLista(lista, { acao: 'remover', usuario: 1 })).toMatchObject({
      recusa: { codigo: 'lista-sem-quem-marca' },
    });
    expect(mudarLista(lista, { acao: 'alterar', usuario: 1, podeMarcar: false })).toMatchObject({
      recusa: { codigo: 'lista-sem-quem-marca' },
    });
    expect(mudarLista([lista[0]!], { acao: 'remover', usuario: 1 })).toEqual({ lista: [] });
  });
  it('recusa duplicado, ausente, sem mudança e liberar agenda já livre', () => {
    expect(mudarLista(lista, { acao: 'incluir', usuario: 2, podeMarcar: true })).toMatchObject({
      recusa: { codigo: 'usuario-ja-na-lista' },
    });
    expect(mudarLista(lista, { acao: 'remover', usuario: 7 })).toMatchObject({
      recusa: { codigo: 'usuario-fora-da-lista' },
    });
    expect(mudarLista(lista, { acao: 'alterar', usuario: 2, podeMarcar: false })).toMatchObject({
      recusa: { codigo: 'sem-mudanca' },
    });
    expect(mudarLista([], { acao: 'liberarTodos' })).toMatchObject({ recusa: { codigo: 'agenda-ja-livre' } });
    expect(mudarLista(lista, { acao: 'liberarTodos' })).toEqual({ lista: [] });
  });
  it('inclui, promove e retira mantendo quem marca', () => {
    expect(mudarLista(lista, { acao: 'incluir', usuario: 3, podeMarcar: false })).toEqual({
      lista: [...lista, { usuario: 3, podeMarcar: false }],
    });
    expect(mudarLista(lista, { acao: 'alterar', usuario: 2, podeMarcar: true })).toEqual({
      lista: [
        { usuario: 1, podeMarcar: true },
        { usuario: 2, podeMarcar: true },
      ],
    });
    expect(mudarLista(lista, { acao: 'remover', usuario: 2 })).toEqual({ lista: [lista[0]] });
  });
});
