import { describe, expect, it } from 'vitest';
import {
  cnpjValido,
  conferirAcidente,
  conferirDiagnostico,
  decidirPermissaoUnidade,
  diagnosticosDaAdmissao,
  diariasCobertas,
  ehCausaExterna,
  proximaGuia,
} from './registros-internacao.js';

describe('quem opera a unidade', () => {
  const regra = { usuario: 7, podeAdmitir: true, podeTransferir: false, podeDarAlta: true };
  it('unidade sem regra fica aberta ao cargo', () => {
    expect(decidirPermissaoUnidade([], 9, 'admitir')).toEqual({ permitido: true });
  });
  it('com regra, só o usuário listado com a ação marcada', () => {
    expect(decidirPermissaoUnidade([regra], 7, 'admitir').permitido).toBe(true);
    expect(decidirPermissaoUnidade([regra], 7, 'darAlta').permitido).toBe(true);
    const t = decidirPermissaoUnidade([regra], 7, 'transferir');
    expect(t.permitido).toBe(false);
    expect(decidirPermissaoUnidade([regra], 8, 'admitir').permitido).toBe(false);
    expect(decidirPermissaoUnidade([regra], null, 'admitir').permitido).toBe(false);
  });
});

describe('diagnósticos da internação', () => {
  it('causa externa só no capítulo XX', () => {
    expect(ehCausaExterna('W19')).toBe(true);
    expect(ehCausaExterna('v89.2')).toBe(true);
    expect(ehCausaExterna('Y99')).toBe(false);
    expect(ehCausaExterna('I21.0')).toBe(false);
  });
  it('admissão grava entrada e secundário', () => {
    expect(diagnosticosDaAdmissao(10, 11)).toEqual([
      { cid: 10, tipo: 'entrada', sequencia: 1 },
      { cid: 11, tipo: 'secundario', sequencia: 2 },
    ]);
    expect(diagnosticosDaAdmissao(10, 10)).toHaveLength(1);
    expect(diagnosticosDaAdmissao(10, null)).toHaveLength(1);
  });
  it('confere tipo, causa externa, repetição e devolve a sequência', () => {
    const l = [{ cid: 10, tipo: 'entrada', sequencia: 1 }];
    expect(conferirDiagnostico(l, { cid: 11, codigo: 'J18', tipo: 'secundario' })).toEqual({
      ok: true,
      valor: { sequencia: 2 },
    });
    expect(conferirDiagnostico(l, { cid: 12, codigo: 'J18', tipo: 'causa_externa' })).toMatchObject({
      ok: false,
      campo: 'cid',
    });
    expect(conferirDiagnostico(l, { cid: 12, codigo: 'W19', tipo: 'secundario' })).toMatchObject({
      ok: false,
      campo: 'tipo',
    });
    expect(conferirDiagnostico(l, { cid: 10, codigo: 'I21', tipo: 'entrada' })).toMatchObject({ ok: false });
    expect(conferirDiagnostico(l, { cid: 13, codigo: 'I22', tipo: 'entrada' })).toMatchObject({
      ok: false,
      campo: 'tipo',
    });
  });
});

describe('acidente', () => {
  it('CNPJ pelos dígitos', () => {
    expect(cnpjValido('11.222.333/0001-81')).toBe(true);
    expect(cnpjValido('11222333000180')).toBe(false);
    expect(cnpjValido('00000000000000')).toBe(false);
  });
  const entrada = '2026-11-20T10:00:00';
  it('acidente de trabalho exige data e empregador', () => {
    expect(conferirAcidente({ tipo: 'trabalho' }, entrada)).toMatchObject({ ok: false, campo: 'ocorridoEm' });
    expect(conferirAcidente({ tipo: 'trabalho', ocorridoEm: '2026-11-20T08:00' }, entrada)).toMatchObject({
      ok: false,
      campo: 'empregadorNome',
    });
    expect(
      conferirAcidente(
        { tipo: 'trabalho', ocorridoEm: '2026-11-20T08:00', empregadorCnpj: '11222333000181' },
        entrada,
      ),
    ).toEqual({ ok: true, valor: null });
  });
  it('datas coerentes e comunicação só no trabalho', () => {
    expect(conferirAcidente({ tipo: 'queda', ocorridoEm: '2026-11-21T08:00' }, entrada)).toMatchObject({
      ok: false,
    });
    expect(conferirAcidente({ tipo: 'transito', numeroComunicacao: '1' }, entrada)).toMatchObject({
      ok: false,
    });
    expect(
      conferirAcidente(
        {
          tipo: 'trabalho',
          ocorridoEm: '2026-11-20T08:00',
          empregadorNome: 'X',
          comunicacaoEmitidaEm: '2026-11-19',
        },
        entrada,
      ),
    ).toMatchObject({ ok: false, campo: 'comunicacaoEmitidaEm' });
    expect(conferirAcidente({ tipo: 'queda' }, entrada)).toEqual({ ok: true, valor: null });
  });
});

describe('guias da internação', () => {
  const entrada = '2026-11-20T10:00:00';
  it('inicial começa na entrada; prorrogação no dia seguinte ao fim da anterior', () => {
    const g1 = proximaGuia([], { diarias: 3 }, entrada);
    expect(g1).toEqual({
      ok: true,
      valor: { sequencia: 1, tipo: 'inicial', inicio: '2026-11-20', fim: '2026-11-22', diarias: 3 },
    });
    const h = [g1.ok ? g1.valor : (null as never)];
    const g2 = proximaGuia(h, { diarias: 2 }, entrada);
    expect(g2).toEqual({
      ok: true,
      valor: { sequencia: 2, tipo: 'prorrogacao', inicio: '2026-11-23', fim: '2026-11-24', diarias: 2 },
    });
    expect(diariasCobertas([...h, g2.ok ? g2.valor : (null as never)])).toBe(5);
  });
  it('recusa diárias zero, prorrogação antes da anterior e buraco na cobertura', () => {
    expect(proximaGuia([], { diarias: 0 }, entrada)).toMatchObject({ ok: false });
    const h = [
      { sequencia: 1, tipo: 'inicial' as const, inicio: '2026-11-20', fim: '2026-11-22', diarias: 3 },
    ];
    expect(proximaGuia(h, { diarias: 2, inicio: '2026-11-19' }, entrada)).toMatchObject({
      ok: false,
      campo: 'inicio',
    });
    expect(proximaGuia(h, { diarias: 2, inicio: '2026-11-25' }, entrada)).toMatchObject({
      ok: false,
      campo: 'inicio',
    });
    expect(proximaGuia(h, { diarias: 2, inicio: '2026-11-22' }, entrada)).toMatchObject({ ok: true });
  });
});
