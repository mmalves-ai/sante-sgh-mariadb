import { describe, expect, it } from 'vitest';
import {
  conferirTelaInicial,
  conferirVisaoTela,
  normalizarPreferenciaGeral,
  PREFERENCIA_GERAL_PADRAO,
  textoAmpliado,
  visaoInicial,
  ZOOM_TEXTO_AMPLIADO,
} from './preferencias-usuario.js';

describe('preferências do usuário (01-ADM L84)', () => {
  it('geral: junta ao atual, confere cada campo e o texto ampliado vira zoom', () => {
    const r = normalizarPreferenciaGeral(PREFERENCIA_GERAL_PADRAO, { tema: 'escuro', textoAmpliado: true });
    expect(r).toEqual({
      preferencia: { ...PREFERENCIA_GERAL_PADRAO, tema: 'escuro', zoomPercentual: ZOOM_TEXTO_AMPLIADO },
    });
    if (!('preferencia' in r)) throw new Error('recusou');
    expect(textoAmpliado(r.preferencia.zoomPercentual)).toBe(true);
    const volta = normalizarPreferenciaGeral(r.preferencia, { textoAmpliado: false, densidade: 'compacta' });
    expect(volta).toEqual({
      preferencia: { ...PREFERENCIA_GERAL_PADRAO, tema: 'escuro', densidade: 'compacta' },
    });
    expect(normalizarPreferenciaGeral(PREFERENCIA_GERAL_PADRAO, { zoomPercentual: 100 })).toEqual({
      preferencia: PREFERENCIA_GERAL_PADRAO,
    });
  });

  it('geral: recusa valor fora do conjunto ou da faixa', () => {
    const p = PREFERENCIA_GERAL_PADRAO;
    expect(normalizarPreferenciaGeral(p, { tema: 'azul' })).toEqual({ recusa: 'tema-invalido' });
    expect(normalizarPreferenciaGeral(p, { densidade: 'apertada' })).toEqual({
      recusa: 'densidade-invalida',
    });
    expect(normalizarPreferenciaGeral(p, { zoomPercentual: 40 })).toEqual({ recusa: 'zoom-fora-da-faixa' });
    expect(normalizarPreferenciaGeral(p, { zoomPercentual: 301 })).toEqual({ recusa: 'zoom-fora-da-faixa' });
    expect(normalizarPreferenciaGeral(p, { tipoAtendimentoPadrao: 'x' })).toEqual({
      recusa: 'tipo-atendimento-invalido',
    });
    expect(normalizarPreferenciaGeral(p, { tipoAtendimentoPadrao: 'internacao' })).toEqual({
      preferencia: { ...p, tipoAtendimentoPadrao: 'internacao' },
    });
  });

  it('tela inicial: ativa, com endereço e do menu', () => {
    expect(conferirTelaInicial({ ativa: true, rota: '/agenda', avulsa: false })).toBeNull();
    expect(conferirTelaInicial(null)).toBe('tela-inexistente');
    expect(conferirTelaInicial({ ativa: false, rota: '/agenda', avulsa: false })).toBe('tela-inexistente');
    expect(conferirTelaInicial({ ativa: true, rota: null, avulsa: false })).toBe('tela-inicial-sem-rota');
    expect(conferirTelaInicial({ ativa: true, rota: '/x', avulsa: true })).toBe('tela-inicial-sem-rota');
  });

  it('visão de tela: colunas sem repetição, ordenação só por coluna visível, faixa de itens', () => {
    const ok = conferirVisaoTela(
      {
        colunas: [' leito', 'paciente'],
        ordenacao: [{ coluna: 'leito', direcao: 'desc' }],
        itensPorPagina: 50,
      },
      { colunasDaTela: ['leito', 'paciente', 'idade'], primeiraDaTela: true },
    );
    expect(ok).toEqual({
      visao: {
        nome: 'padrao',
        colunas: ['leito', 'paciente'],
        ordenacao: [{ coluna: 'leito', direcao: 'desc' }],
        itensPorPagina: 50,
        padrao: true,
      },
    });
    expect(conferirVisaoTela({ colunas: [] })).toEqual({ recusa: 'visao-sem-colunas' });
    expect(conferirVisaoTela({ colunas: ['a', 'a'] })).toEqual({ recusa: 'coluna-repetida' });
    expect(conferirVisaoTela({ colunas: ['z'] }, { colunasDaTela: ['a'] })).toEqual({
      recusa: 'coluna-desconhecida',
    });
    expect(conferirVisaoTela({ colunas: ['a'], ordenacao: [{ coluna: 'b', direcao: 'asc' }] })).toEqual({
      recusa: 'ordenacao-fora-das-colunas',
    });
    expect(
      conferirVisaoTela({
        colunas: ['a'],
        ordenacao: [
          { coluna: 'a', direcao: 'asc' },
          { coluna: 'a', direcao: 'desc' },
        ],
      }),
    ).toEqual({ recusa: 'ordenacao-repetida' });
    expect(conferirVisaoTela({ colunas: ['a'], itensPorPagina: 4 })).toEqual({
      recusa: 'itens-por-pagina-fora-da-faixa',
    });
    expect(conferirVisaoTela({ colunas: ['a'], nome: '  ' })).toEqual({ recusa: 'nome-visao-invalido' });
    expect(conferirVisaoTela({ colunas: ['a'], nome: 'Plantão' })).toMatchObject({
      visao: { nome: 'Plantão', padrao: false },
    });
  });

  it('visão inicial: a marcada; sem marcada, a de nome padrao; sem ela, nenhuma', () => {
    expect(
      visaoInicial([
        { nome: 'padrao', padrao: false },
        { nome: 'Noite', padrao: true },
      ])?.nome,
    ).toBe('Noite');
    expect(
      visaoInicial([
        { nome: 'Noite', padrao: false },
        { nome: 'padrao', padrao: false },
      ])?.nome,
    ).toBe('padrao');
    expect(visaoInicial([{ nome: 'Noite', padrao: false }])).toBeNull();
  });
});
