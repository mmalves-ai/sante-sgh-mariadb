// Regra 6 do M53: lote de interface com contagem e soma conferíveis nos dois sentidos; divergência barra o lançamento
// dos títulos. Dados sintéticos (o CPF é montado no teste a partir de uma base fictícia; nenhum documento real).
import type { LoteExportacaoFolha, LoteRetornoFolha } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import {
  conferirExportacao,
  conferirRetorno,
  planoDeTitulos,
  podeLancarTitulos,
  totalizarExportacao,
  totalizarRetorno,
} from './lote.js';

const cpfFicticio = (n: number) => String(n).padStart(11, '9');

const colaborador = (vinculo: number) => ({
  vinculo,
  cpf: cpfFicticio(vinculo),
  matriculaExterna: null,
  tipoVinculo: 'clt' as const,
  admissao: '2025-02-01',
  desligamento: null,
  centroCusto: 12,
  setor: null,
  cbo: null,
  conselho: null,
});

function exportado(): LoteExportacaoFolha {
  const base = {
    colaboradores: [colaborador(1), colaborador(2)],
    afastamentos: [{ vinculo: 2, motivo: 1, inicio: '2026-09-10', fim: null }],
    eventosPonto: [
      { vinculo: 1, evento: 1, minutos: 9_600 },
      { vinculo: 2, evento: 1, minutos: 4_800 },
      { vinculo: 2, evento: 3, minutos: 480 },
    ],
    horasPonto: [{ vinculo: 1, tipoHora: 1, minutos: 9_600 }],
    plantoes: [
      {
        vinculo: 1,
        plantao: 5,
        modalidade: 'sobreaviso' as const,
        inicio: '2026-09-06T19:00:00Z',
        fim: '2026-09-07T07:00:00Z',
        minutos: 720,
        centroCusto: 12,
      },
    ],
  };
  return {
    leiaute: '1.0',
    lote: 10,
    empresa: 1,
    estabelecimento: 'pc',
    competencia: '2026-09',
    periodo: { inicio: '2026-09-01', fim: '2026-09-30' },
    geradoEm: '2026-10-02T10:00:00Z',
    ...base,
    totais: totalizarExportacao(base),
  };
}

function retorno(): LoteRetornoFolha {
  const base = {
    colaboradores: [
      {
        vinculo: 1,
        matriculaExterna: 'A1',
        rubricas: [
          { codigo: '001', natureza: 'provento' as const, valor: 500_000 },
          { codigo: '050', natureza: 'provento' as const, valor: 12_345 },
          { codigo: '901', natureza: 'desconto' as const, valor: 55_000 },
          { codigo: '999', natureza: 'informativa' as const, valor: 40_000 },
        ],
        liquido: 457_345,
      },
      {
        vinculo: 2,
        matriculaExterna: 'A2',
        rubricas: [
          { codigo: '001', natureza: 'provento' as const, valor: 300_000 },
          { codigo: '901', natureza: 'desconto' as const, valor: 30_000 },
        ],
        liquido: 270_000,
      },
    ],
    encargos: [
      { tipo: 'fgts' as const, valor: 64_000, vencimento: '2026-10-20', centroCusto: null },
      { tipo: 'inss' as const, valor: 85_000, vencimento: '2026-10-20', centroCusto: null },
      { tipo: 'inss' as const, valor: 15_000, vencimento: '2026-10-20', centroCusto: 12 },
      { tipo: 'irrf' as const, valor: 0, vencimento: '2026-10-20', centroCusto: null },
    ],
  };
  return {
    leiaute: '1.0',
    loteExportado: 10,
    empresa: 1,
    competencia: '2026-09',
    recebido: exportado().totais,
    ...base,
    vencimentoLiquido: '2026-10-05',
    totais: totalizarRetorno(base),
  };
}

describe('lote exportado', () => {
  it('totaliza contagens e somas (parcelas: 9.600 + 4.800 + 480 minutos de ponto; 720 de plantão)', () => {
    expect(exportado().totais).toEqual({
      colaboradores: 2,
      afastamentos: 1,
      eventosPonto: 3,
      minutosPonto: 9_600 + 4_800 + 480,
      plantoes: 1,
      minutosPlantao: 720,
    });
    expect(conferirExportacao(exportado())).toEqual([]);
  });

  it('acusa total declarado diferente do conteúdo', () => {
    const l = exportado();
    const d = conferirExportacao({ ...l, totais: { ...l.totais, minutosPonto: 1, plantoes: 0 } });
    expect(d.map((x) => [x.codigo, x.campo, x.declarado, x.calculado])).toEqual([
      ['total-exportado', 'minutosPonto', 1, 14_880],
      ['total-exportado', 'plantoes', 0, 1],
    ]);
  });

  it('acusa colaborador repetido e evento de vínculo fora do lote', () => {
    const l = exportado();
    const colaboradores = [...l.colaboradores, colaborador(1)];
    const eventosPonto = [...l.eventosPonto, { vinculo: 9, evento: 1, minutos: 1 }];
    const d = conferirExportacao({
      ...l,
      colaboradores,
      eventosPonto,
      totais: totalizarExportacao({ ...l, colaboradores, eventosPonto }),
    });
    expect(d.map((x) => [x.codigo, x.vinculo])).toEqual([
      ['vinculo-repetido', 1],
      ['vinculo-sem-colaborador', 9],
    ]);
  });

  it('a divergência não carrega CPF', () => {
    const l = exportado();
    const d = conferirExportacao({ ...l, colaboradores: [...l.colaboradores, colaborador(1)] });
    expect(JSON.stringify(d)).not.toContain(colaborador(1).cpf);
  });
});

describe('retorno da folha externa', () => {
  it('confere nos dois sentidos e libera o lançamento', () => {
    const d = conferirRetorno(retorno(), exportado());
    expect(d).toEqual([]);
    expect(podeLancarTitulos(d)).toBe(true);
  });

  it('totaliza: proventos 500.000 + 12.345 + 300.000; descontos 55.000 + 30.000; informativa fora', () => {
    expect(retorno().totais).toEqual({
      colaboradores: 2,
      proventos: 500_000 + 12_345 + 300_000,
      descontos: 55_000 + 30_000,
      liquido: 457_345 + 270_000,
      encargos: 64_000 + 85_000 + 15_000 + 0,
    });
  });

  it('eco diferente do exportado barra o lançamento', () => {
    const r = retorno();
    const d = conferirRetorno({ ...r, recebido: { ...r.recebido, colaboradores: 1 } }, exportado());
    expect(d.map((x) => [x.codigo, x.campo, x.declarado, x.calculado])).toEqual([
      ['eco-diferente', 'colaboradores', 1, 2],
    ]);
    expect(podeLancarTitulos(d)).toBe(false);
  });

  it('lote, empresa e competência têm de ser os do exportado', () => {
    const d = conferirRetorno(
      { ...retorno(), loteExportado: 11, empresa: 2, competencia: '2026-08' },
      exportado(),
    );
    expect(d.map((x) => [x.codigo, x.declarado, x.calculado])).toEqual([
      ['lote-diferente', 11, 10],
      ['empresa-diferente', 2, 1],
      ['competencia-diferente', 202_608, 202_609],
    ]);
  });

  it('total declarado do retorno diferente do conteúdo', () => {
    const r = retorno();
    const d = conferirRetorno({ ...r, totais: { ...r.totais, encargos: 1 } }, exportado());
    expect(d.map((x) => [x.codigo, x.campo, x.declarado, x.calculado])).toEqual([
      ['total-retorno', 'encargos', 1, 164_000],
    ]);
  });

  it('líquido do colaborador diferente de proventos − descontos', () => {
    const r = retorno();
    const colaboradores = r.colaboradores.map((c) => (c.vinculo === 2 ? { ...c, liquido: 269_999 } : c));
    const d = conferirRetorno(
      { ...r, colaboradores, totais: totalizarRetorno({ ...r, colaboradores }) },
      exportado(),
    );
    expect(d.map((x) => [x.codigo, x.vinculo, x.declarado, x.calculado])).toEqual([
      ['liquido-colaborador', 2, 269_999, 270_000],
    ]);
  });

  it('vínculo que não foi exportado e vínculo repetido', () => {
    const r = retorno();
    const extra = { ...r.colaboradores[1]!, vinculo: 7 };
    const colaboradores = [...r.colaboradores, extra, r.colaboradores[0]!];
    const d = conferirRetorno(
      { ...r, colaboradores, totais: totalizarRetorno({ ...r, colaboradores }) },
      exportado(),
    );
    expect(d.map((x) => [x.codigo, x.vinculo])).toEqual([
      ['vinculo-nao-exportado', 7],
      ['vinculo-repetido', 1],
    ]);
  });
});

describe('plano de títulos (prova pós-escrita: soma dos títulos = líquido + encargos)', () => {
  it('um título do líquido e um por tipo de encargo e vencimento; parcela zero não vira título', () => {
    const p = planoDeTitulos(retorno());
    expect(p.parcelas).toEqual([
      { origem: 'folha', tipo: 'liquido', valor: 727_345, vencimento: '2026-10-05' },
      { origem: 'encargo', tipo: 'inss', valor: 100_000, vencimento: '2026-10-20' },
      { origem: 'encargo', tipo: 'fgts', valor: 64_000, vencimento: '2026-10-20' },
    ]);
    expect(p.total).toBe(727_345 + 100_000 + 64_000);
    expect(p.total).toBe(retorno().totais.liquido + retorno().totais.encargos);
    expect(p.conta).toBe('líquido R$ 7.273,45 + INSS R$ 1.000,00 + FGTS R$ 640,00 = R$ 8.913,45');
  });

  it('encargos do mesmo tipo com vencimentos diferentes viram títulos diferentes, em ordem', () => {
    const r = retorno();
    const p = planoDeTitulos({
      ...r,
      encargos: [
        { tipo: 'sindical', valor: 1_005, vencimento: '2026-11-30', centroCusto: null },
        { tipo: 'outro', valor: 7, vencimento: '2026-10-01', centroCusto: null },
        { tipo: 'sindical', valor: 2_000, vencimento: '2026-10-30', centroCusto: null },
      ],
    });
    expect(p.parcelas.map((x) => [x.tipo, x.vencimento, x.valor])).toEqual([
      ['liquido', '2026-10-05', 727_345],
      ['sindical', '2026-10-30', 2_000],
      ['sindical', '2026-11-30', 1_005],
      ['outro', '2026-10-01', 7],
    ]);
    expect(p.conta).toContain('SINDICAL R$ 10,05');
    expect(p.conta).toContain('OUTRO R$ 0,07');
  });

  it('retorno sem valor: nenhum título', () => {
    const p = planoDeTitulos({
      ...retorno(),
      colaboradores: [],
      encargos: [],
      totais: { colaboradores: 0, proventos: 0, descontos: 0, liquido: 0, encargos: 0 },
    });
    expect(p).toEqual({ parcelas: [], total: 0, conta: 'nenhum título = R$ 0,00' });
  });
});
