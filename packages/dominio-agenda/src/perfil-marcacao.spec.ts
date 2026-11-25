import { describe, expect, it } from 'vitest';
import {
  decidirPerfilMarcacao,
  dimensaoRecusada,
  type PerfilDoUsuario,
  perfilAlcancaUnidade,
  perfilTrataUnidade,
  validarPerfil,
  validarRecortes,
  validarVigencia,
} from './perfil-marcacao.js';

const HOJE = '2030-03-12';
const perfil = (p: Partial<PerfilDoUsuario> = {}): PerfilDoUsuario => ({
  id: 1,
  codigo: 'CENTRAL',
  estabelecimento: 10,
  ativo: true,
  permiteEncaixe: false,
  recortes: [],
  vigenciaInicio: null,
  vigenciaFim: null,
  ...p,
});
const alvo = {
  estabelecimento: 10,
  agenda: 5,
  fontePagadora: 7,
  setor: 3,
  profissional: 8,
  especialidades: [20, 21],
  encaixe: false,
};

describe('perfil de marcação (02-AGE linha 46)', () => {
  it('sem perfil vigente na unidade: fica no escopo atual, sem bloqueio', () => {
    expect(decidirPerfilMarcacao([], alvo, HOJE)).toEqual({ ok: true, motivo: 'sem-perfil' });
    expect(decidirPerfilMarcacao([perfil({ ativo: false, recortes: [] })], alvo, HOJE).ok).toBe(true);
    const vencido = perfil({
      vigenciaFim: '2030-03-11',
      recortes: [{ dimensao: 'fonte_pagadora', alvo: 99, permitido: true }],
    });
    expect(decidirPerfilMarcacao([vencido], alvo, HOJE)).toMatchObject({ motivo: 'sem-perfil' });
    const futuro = perfil({
      vigenciaInicio: '2030-03-13',
      recortes: [{ dimensao: 'fonte_pagadora', alvo: 99, permitido: true }],
    });
    expect(decidirPerfilMarcacao([futuro], alvo, HOJE)).toMatchObject({ motivo: 'sem-perfil' });
    const outraUnidade = perfil({
      estabelecimento: 11,
      recortes: [{ dimensao: 'fonte_pagadora', alvo: 99, permitido: true }],
    });
    expect(decidirPerfilMarcacao([outraUnidade], alvo, HOJE)).toMatchObject({ motivo: 'sem-perfil' });
  });

  it('recorte permitido por convênio: aceita dentro e recusa fora', () => {
    const p = perfil({ recortes: [{ dimensao: 'fonte_pagadora', alvo: 7, permitido: true }] });
    expect(decidirPerfilMarcacao([p], alvo, HOJE)).toEqual({ ok: true, motivo: 'perfil', perfil: 'CENTRAL' });
    const r = decidirPerfilMarcacao([p], { ...alvo, fontePagadora: 9 }, HOJE);
    expect(r).toMatchObject({ ok: false, codigo: 'fora-do-perfil-marcacao' });
    expect(!r.ok && r.mensagem).toContain('este convênio');
  });

  it('especialidade: basta uma da agenda; a exceção acerta qualquer uma; agenda sem especialidade fica fora', () => {
    const p = perfil({ recortes: [{ dimensao: 'especialidade', alvo: 21, permitido: true }] });
    expect(dimensaoRecusada(p, alvo)).toBeNull();
    expect(dimensaoRecusada(p, { ...alvo, especialidades: [] })).toBe('especialidade');
    const ex = perfil({ recortes: [{ dimensao: 'especialidade', alvo: 20, permitido: false }] });
    expect(dimensaoRecusada(ex, alvo)).toBe('especialidade');
    expect(dimensaoRecusada(ex, { ...alvo, especialidades: [22] })).toBeNull();
  });

  it('setor, agenda e profissional: falha fechada sem valor; dimensões combinam por E', () => {
    const p = perfil({
      recortes: [
        { dimensao: 'setor', alvo: 3, permitido: true },
        { dimensao: 'agenda', alvo: 5, permitido: true },
        { dimensao: 'agenda', alvo: 6, permitido: true },
      ],
    });
    expect(dimensaoRecusada(p, alvo)).toBeNull();
    expect(dimensaoRecusada(p, { ...alvo, setor: null })).toBe('setor');
    expect(dimensaoRecusada(p, { ...alvo, agenda: 9 })).toBe('agenda');
    const prof = perfil({ recortes: [{ dimensao: 'profissional', alvo: 8, permitido: true }] });
    expect(dimensaoRecusada(prof, { ...alvo, profissional: null })).toBe('profissional');
  });

  it('unidade: o perfil vale na dona; recortes de unidade trocam ou excluem', () => {
    expect(perfilAlcancaUnidade(perfil(), 10)).toBe(true);
    expect(perfilAlcancaUnidade(perfil(), 11)).toBe(false);
    const rede = perfil({
      recortes: [
        { dimensao: 'estabelecimento', alvo: 11, permitido: true },
        { dimensao: 'estabelecimento', alvo: 12, permitido: true },
      ],
    });
    expect([10, 11, 12].map((u) => perfilAlcancaUnidade(rede, u))).toEqual([false, true, true]);
    const menos = perfil({ recortes: [{ dimensao: 'estabelecimento', alvo: 10, permitido: false }] });
    expect(perfilAlcancaUnidade(menos, 10)).toBe(false);
  });

  it('exceção de unidade recusa a marcação na unidade (não vira "sem perfil")', () => {
    const menos = perfil({ recortes: [{ dimensao: 'estabelecimento', alvo: 10, permitido: false }] });
    expect(perfilTrataUnidade(menos, 10)).toBe(true);
    expect(decidirPerfilMarcacao([menos], alvo, HOJE)).toMatchObject({
      ok: false,
      codigo: 'fora-do-perfil-marcacao',
    });
    expect(decidirPerfilMarcacao([menos], alvo, HOJE)).toMatchObject({
      mensagem: expect.stringContaining('unidade'),
    });
    // perfil de outra unidade, sem exceção para a 10: não conta, segue o escopo atual
    expect(decidirPerfilMarcacao([perfil({ estabelecimento: 11 })], alvo, HOJE)).toEqual({
      ok: true,
      motivo: 'sem-perfil',
    });
    // outro perfil vigente que aceita a unidade ainda libera (basta um aceitar)
    expect(
      decidirPerfilMarcacao(
        [
          menos,
          perfil({ codigo: 'B', recortes: [{ dimensao: 'estabelecimento', alvo: 10, permitido: true }] }),
        ],
        alvo,
        HOJE,
      ),
    ).toMatchObject({ ok: true, perfil: 'B' });
  });

  it('vários perfis: basta um aceitar; encaixe só por perfil que o permita', () => {
    const a = perfil({ codigo: 'A', recortes: [{ dimensao: 'fonte_pagadora', alvo: 1, permitido: true }] });
    const b = perfil({ codigo: 'B', recortes: [{ dimensao: 'fonte_pagadora', alvo: 7, permitido: true }] });
    expect(decidirPerfilMarcacao([a, b], alvo, HOJE)).toMatchObject({ ok: true, perfil: 'B' });
    expect(decidirPerfilMarcacao([a, b], { ...alvo, encaixe: true }, HOJE)).toMatchObject({
      ok: false,
      codigo: 'perfil-sem-encaixe',
    });
    const c = perfil({ codigo: 'C', permiteEncaixe: true });
    expect(decidirPerfilMarcacao([b, c], { ...alvo, encaixe: true }, HOJE)).toMatchObject({
      ok: true,
      perfil: 'C',
    });
  });

  it('administrador da plataforma pode tudo', () => {
    const p = perfil({ recortes: [{ dimensao: 'fonte_pagadora', alvo: 1, permitido: true }] });
    expect(decidirPerfilMarcacao([p], alvo, HOJE, true)).toEqual({ ok: true, motivo: 'administrador' });
  });

  it('validações do cadastro', () => {
    expect(validarPerfil({ codigo: 'CENTRAL-1', descricao: 'Central de marcação' })).toBeNull();
    expect(validarPerfil({ codigo: 'com espaço', descricao: 'Central' })).toMatchObject({ campo: 'codigo' });
    expect(validarPerfil({ codigo: 'X', descricao: 'ab' })).toMatchObject({ campo: 'descricao' });
    expect(validarRecortes([{ dimensao: 'setor', alvo: 1, permitido: true }])).toBeNull();
    expect(
      validarRecortes([
        { dimensao: 'setor', alvo: 1, permitido: true },
        { dimensao: 'setor', alvo: 1, permitido: false },
      ]),
    ).toMatchObject({ codigo: 'recorte-repetido' });
    expect(validarRecortes([{ dimensao: 'setor', alvo: 0, permitido: true }])).toMatchObject({
      codigo: 'recorte-sem-alvo',
    });
    expect(validarVigencia('2030-01-02', '2030-01-01')).toMatchObject({ codigo: 'vigencia-invertida' });
    expect(validarVigencia(null, '2030-01-01')).toBeNull();
  });
});
