import { describe, expect, it } from 'vitest';
import {
  conferirTelaInicial,
  conferirVisaoTela,
  normalizarPreferenciaGeral,
  PREFERENCIA_GERAL_PADRAO,
  rotaPermitida,
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

  it('tela inicial: ativa, com endereço, do menu e permitida ao cargo', () => {
    const t = { ativa: true, rota: '/agenda', avulsa: false, permitida: true };
    expect(conferirTelaInicial(t)).toBeNull();
    expect(conferirTelaInicial(null)).toBe('tela-inexistente');
    expect(conferirTelaInicial({ ...t, ativa: false })).toBe('tela-inexistente');
    expect(conferirTelaInicial({ ...t, rota: null })).toBe('tela-inicial-sem-rota');
    expect(conferirTelaInicial({ ...t, rota: '/x', avulsa: true })).toBe('tela-inicial-sem-rota');
    expect(conferirTelaInicial({ ...t, permitida: false })).toBe('tela-sem-permissao');
  });

  it('rota permitida: só a entrada do menu com a rota e permissão que o cargo dá', () => {
    const menu = [
      { rota: '/agenda', permissao: 'agenda.ler' },
      { rota: '/faturamento', permissao: 'faturamento.ler' },
      { rota: '/sem-permissao', permissao: null },
    ];
    const cargo = new Set(['agenda.ler']);
    expect(rotaPermitida('/agenda', menu, cargo)).toBe(true);
    expect(rotaPermitida('/faturamento', menu, cargo)).toBe(false);
    expect(rotaPermitida('/sem-permissao', menu, cargo)).toBe(false);
    expect(rotaPermitida('/fora-do-menu', menu, cargo)).toBe(false);
    expect(rotaPermitida(null, menu, cargo)).toBe(false);
  });

  it('visão de tela: regravar sem padrão explícito mantém a marca; só padrão explícito a troca', () => {
    const v = { colunas: ['leito', 'paciente'] };
    const marca = (r: ReturnType<typeof conferirVisaoTela>) => ('visao' in r ? r.visao.padrao : r.recusa);
    expect(marca(conferirVisaoTela({ ...v, nome: 'Plantão' }, { padraoAtual: true }))).toBe(true);
    expect(marca(conferirVisaoTela({ ...v, nome: 'Plantão' }, { padraoAtual: false }))).toBe(false);
    expect(marca(conferirVisaoTela({ ...v, nome: 'Plantão', padrao: false }, { padraoAtual: true }))).toBe(
      false,
    );
    expect(marca(conferirVisaoTela({ ...v, padrao: true }, { padraoAtual: false }))).toBe(true);
    expect(marca(conferirVisaoTela(v, { primeiraDaTela: true }))).toBe(true);
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
