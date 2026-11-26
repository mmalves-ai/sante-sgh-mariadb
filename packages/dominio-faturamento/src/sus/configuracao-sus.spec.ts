// C1-051 (06-SUS linha 53): permissão por usuário e setor do faturamento SUS e parâmetros próprios de cada instrumento.
import type { CamposParametroSus } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import {
  decidirSetorSus,
  decidirSetoresProducaoSus,
  normalizarParametrosSus,
  type PermissaoSetorSusVigencia,
  recusaEncerrarPermissaoSetorSus,
  recusaIncluirPermissaoSetorSus,
  setoresPermitidosSus,
} from './configuracao-sus.js';
import { cnsSintetico } from './massa.spec-util.js';

const HOJE = '2026-11-25';
const p = (
  setor: number,
  tipo: PermissaoSetorSusVigencia['tipo'],
  ini = '2026-01-01',
  fim: string | null = null,
) => ({
  setor,
  tipo,
  vigenciaInicio: ini,
  vigenciaFim: fim,
});
const VAZIO: CamposParametroSus = {
  fontePadrao: null,
  orgaoOrigem: null,
  siglaOrigem: null,
  cnpjPrestador: null,
  orgaoDestino: null,
  indicadorDestino: null,
  uf: null,
  utiPorAcomodacao: null,
  diretorClinicoCns: null,
};

describe('permissão do faturamento SUS por usuário e setor', () => {
  const pedido = (
    setor: number | null,
    acao: 'digitacao' | 'faturamento' = 'digitacao',
    usuario: number | null = 7,
  ) => ({
    usuario,
    setor,
    acao,
    hoje: HOJE,
  });

  it('sem permissão de setor vigente vale só o cargo', () => {
    expect(decidirSetorSus([], pedido(10))).toBeNull();
    expect(decidirSetorSus([p(10, 'digitacao', '2025-01-01', '2025-12-31')], pedido(20))).toBeNull();
  });

  it('com permissão vigente, só os setores listados e o tipo que cobre a ação', () => {
    const ps = [p(10, 'digitacao'), p(11, 'digitacao_faturamento'), p(12, 'faturamento')];
    expect(decidirSetorSus(ps, pedido(10))).toBeNull();
    expect(decidirSetorSus(ps, pedido(11, 'faturamento'))).toBeNull();
    expect(decidirSetorSus(ps, pedido(10, 'faturamento'))).toBe('sus-setor-sem-permissao');
    expect(decidirSetorSus(ps, pedido(12, 'digitacao'))).toBe('sus-setor-sem-permissao');
    expect(decidirSetorSus(ps, pedido(99))).toBe('sus-setor-sem-permissao');
    expect(decidirSetorSus(ps, pedido(null))).toBe('sus-setor-nao-informado');
  });

  it('a vigência conta o primeiro e o último dia; a futura ainda não restringe', () => {
    expect(decidirSetorSus([p(10, 'digitacao', HOJE, HOJE)], pedido(10))).toBeNull();
    expect(decidirSetorSus([p(10, 'digitacao', HOJE, HOJE)], pedido(20))).toBe('sus-setor-sem-permissao');
    expect(decidirSetorSus([p(10, 'digitacao', '2026-12-01')], pedido(20))).toBeNull();
  });

  it('o administrador da plataforma (sem id no banco do cliente) passa sempre', () => {
    expect(decidirSetorSus([p(10, 'digitacao')], pedido(99, 'digitacao', null))).toBeNull();
  });

  it('inclusão: vigência coerente e sem período cruzado no mesmo setor', () => {
    expect(recusaIncluirPermissaoSetorSus(p(10, 'digitacao', '2026-02-01', '2026-01-31'), [])).toBe(
      'sus-permissao-vigencia-invalida',
    );
    const atual = [p(10, 'digitacao', '2026-01-01', null)];
    expect(recusaIncluirPermissaoSetorSus(p(10, 'faturamento', '2026-06-01'), atual)).toBe(
      'sus-permissao-sobreposta',
    );
    expect(recusaIncluirPermissaoSetorSus(p(11, 'faturamento', '2026-06-01'), atual)).toBeNull();
    const encerrada = [p(10, 'digitacao', '2026-01-01', '2026-05-31')];
    expect(recusaIncluirPermissaoSetorSus(p(10, 'faturamento', '2026-06-01'), encerrada)).toBeNull();
  });

  it('encerramento só encurta a vigência', () => {
    expect(recusaEncerrarPermissaoSetorSus(p(10, 'digitacao', '2026-01-01'), '2026-11-25')).toBeNull();
    expect(recusaEncerrarPermissaoSetorSus(p(10, 'digitacao', '2026-01-01'), '2025-12-31')).toBe(
      'sus-permissao-vigencia-invalida',
    );
    expect(
      recusaEncerrarPermissaoSetorSus(p(10, 'digitacao', '2026-01-01', '2026-06-30'), '2026-07-01'),
    ).toBe('sus-permissao-vigencia-invalida');
  });
});

describe('parâmetros próprios de cada instrumento SUS', () => {
  it('BPA: normaliza CNPJ e sigla e confere o dígito do CNPJ', () => {
    const r = normalizarParametrosSus('bpa', {
      ...VAZIO,
      orgaoOrigem: ' Hospital fictício ',
      siglaOrigem: 'hfic',
      cnpjPrestador: '11.222.333/0001-81',
      orgaoDestino: 'Secretaria municipal',
      indicadorDestino: 'M',
    });
    expect(r.erros).toEqual([]);
    expect(r.campos).toMatchObject({
      orgaoOrigem: 'Hospital fictício',
      siglaOrigem: 'HFIC',
      cnpjPrestador: '11222333000181',
    });
    expect(normalizarParametrosSus('bpa', { ...VAZIO, cnpjPrestador: '11222333000180' }).erros).toEqual([
      { campo: 'cnpjPrestador', regra: 'cnpj-invalido' },
    ]);
  });

  it('APAC: UF oficial; AIH: CNS do diretor clínico e UTI por acomodação no formato acomodação:tipo:procedimento', () => {
    expect(normalizarParametrosSus('apac', { ...VAZIO, uf: 'rs' }).campos.uf).toBe('RS');
    expect(normalizarParametrosSus('apac', { ...VAZIO, uf: 'XX' }).erros).toEqual([
      { campo: 'uf', regra: 'uf-invalida' },
    ]);
    const cns = cnsSintetico(1);
    const ok = normalizarParametrosSus('aih', {
      ...VAZIO,
      diretorClinicoCns: cns,
      utiPorAcomodacao: '3:26:0802010083; 4:27:0802010091',
    });
    expect(ok.erros).toEqual([]);
    const ruim = normalizarParametrosSus('aih', {
      ...VAZIO,
      diretorClinicoCns: '123456789012345',
      utiPorAcomodacao: '3=26',
    });
    expect(ruim.erros.map((e) => e.regra).sort()).toEqual(['cns-invalido', 'formato-invalido']);
  });

  it('campo de outro instrumento é recusado; vazio vira nulo (vale o parâmetro geral)', () => {
    expect(normalizarParametrosSus('ciha', { ...VAZIO, fontePadrao: 'gratuidade', uf: 'SP' }).erros).toEqual([
      { campo: 'uf', regra: 'fora-do-instrumento' },
    ]);
    expect(normalizarParametrosSus('apac', { ...VAZIO, uf: '  ' }).campos.uf).toBeNull();
  });
});

describe('setores do faturamento SUS: listagens e competência inteira', () => {
  const ps = [
    p(10, 'digitacao'),
    p(11, 'digitacao_faturamento'),
    p(12, 'faturamento'),
    p(13, 'faturamento', '2025-01-01', '2025-12-31'),
  ];
  it('lista os setores vigentes que cobrem a ação; sem restrição devolve null', () => {
    expect(setoresPermitidosSus(ps, { usuario: 7, acao: 'digitacao', hoje: HOJE })).toEqual([10, 11]);
    expect(setoresPermitidosSus(ps, { usuario: 7, acao: 'faturamento', hoje: HOJE })).toEqual([11, 12]);
    expect(setoresPermitidosSus(ps, { usuario: null, acao: 'digitacao', hoje: HOJE })).toBeNull();
    expect(setoresPermitidosSus([], { usuario: 7, acao: 'digitacao', hoje: HOJE })).toBeNull();
    expect(
      setoresPermitidosSus([p(10, 'digitacao')], { usuario: 7, acao: 'faturamento', hoje: HOJE }),
    ).toEqual([]);
  });
  it('a competência inteira exige a ação em todos os setores com produção', () => {
    const d = (setores: (number | null)[], usuario: number | null = 7) =>
      decidirSetoresProducaoSus(ps, { usuario, setores, acao: 'faturamento', hoje: HOJE });
    expect(d([11, 12])).toBeNull();
    expect(d([])).toBeNull();
    expect(d([11, 10])).toBe('sus-setor-sem-permissao');
    expect(d([13])).toBe('sus-setor-sem-permissao');
    expect(d([11, null])).toBe('sus-setor-nao-informado');
    expect(d([10, 99, null], null)).toBeNull();
    expect(
      decidirSetoresProducaoSus([], { usuario: 7, setores: [1, 2], acao: 'faturamento', hoje: HOJE }),
    ).toBeNull();
  });
});
