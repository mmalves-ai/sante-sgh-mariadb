// W0-08, parte 8 (M2): o alerta encontra os equipamentos do parque pela faixa de série (número final com o mesmo
// prefixo, senão o texto), fabricante e modelo sem acento nem caixa; o desativado fica fora; o sem série fica a
// conferir; uma OS por equipamento ainda sem OS; o critério não muda depois da primeira OS. Dados sintéticos.
import { describe, expect, it } from 'vitest';
import {
  afetadosDoAlerta,
  compararSeries,
  conferirAlteracaoAlerta,
  numeroMudou,
  conferirEncerramentoAlerta,
  descricaoDaAcaoDeCampo,
  enquadrarEquipamento,
  faixaInvertida,
  planejarAcaoDeCampo,
  serieNaFaixa,
  type AlertaParaConferir,
  type CriterioAlerta,
  type EquipamentoDoParque,
} from './tecnovigilancia.js';

const eq = (
  id: number,
  serie: string | null,
  extra: Partial<EquipamentoDoParque> = {},
): EquipamentoDoParque => ({
  id,
  codigo: `EQ-${String(id).padStart(3, '0')}`,
  nome: 'Bomba de infusão',
  fabricante: 'Infusão Médica Ltda',
  modelo: 'BI-200',
  numeroSerie: serie,
  centroCusto: 5,
  situacao: 'ativo',
  ...extra,
});
const criterio: CriterioAlerta = {
  fabricante: 'INFUSAO MEDICA LTDA ',
  modelo: 'bi-200',
  serieInicio: 'SN-900',
  serieFim: 'SN-1200',
};

describe('faixa de série', () => {
  it('compara pelo número final quando o prefixo é o mesmo (SN-950 < SN-1000)', () => {
    expect(compararSeries('SN-950', 'SN-1000')).toBe(-1);
    expect(compararSeries('sn-0950', 'SN-950')).toBe(0);
    expect(serieNaFaixa('SN-0950', 'SN-900', 'SN-1200')).toBe(true);
    expect(serieNaFaixa('SN-1200', 'SN-900', 'SN-1200')).toBe(true);
    expect(serieNaFaixa('SN-1201', 'SN-900', 'SN-1200')).toBe(false);
    expect(serieNaFaixa('SN-899', 'SN-900', 'SN-1200')).toBe(false);
  });
  it('prefixo diferente ou sem número: compara o texto', () => {
    expect(serieNaFaixa('AB-500', 'SN-900', 'SN-1200')).toBe(false);
    expect(serieNaFaixa('LOTEB', 'LOTEA', 'LOTEC')).toBe(true);
  });
  it('faixa invertida só quando dá para comparar', () => {
    expect(faixaInvertida('SN-1200', 'SN-900')).toBe(true);
    expect(faixaInvertida('SN-900', 'SN-1200')).toBe(false);
    expect(faixaInvertida(null, null)).toBe(false);
  });
});

describe('enquadramento no alerta', () => {
  it('fabricante e modelo sem acento nem caixa; série na faixa', () => {
    expect(enquadrarEquipamento(eq(1, 'SN-1000'), criterio)).toBe('afetado');
    expect(enquadrarEquipamento(eq(2, 'SN-1300'), criterio)).toBeNull();
    expect(enquadrarEquipamento(eq(3, 'SN-1000', { modelo: 'BI-300' }), criterio)).toBeNull();
    expect(enquadrarEquipamento(eq(4, 'SN-1000', { fabricante: 'Outra' }), criterio)).toBeNull();
  });
  it('desativado fica fora; sem série fica a conferir; sem faixa, todas as séries; sem modelo, todos', () => {
    expect(enquadrarEquipamento(eq(5, 'SN-1000', { situacao: 'desativado' }), criterio)).toBeNull();
    expect(enquadrarEquipamento(eq(6, null), criterio)).toBe('conferir');
    expect(enquadrarEquipamento(eq(7, 'XYZ'), { ...criterio, serieInicio: null, serieFim: null })).toBe(
      'afetado',
    );
    expect(enquadrarEquipamento(eq(8, 'SN-1000', { modelo: 'BI-300' }), { ...criterio, modelo: null })).toBe(
      'afetado',
    );
  });
  it('a lista: afetados antes dos a conferir; o que já tem OS segue na lista mesmo fora do critério', () => {
    const parque = [eq(3, null), eq(2, 'SN-1100'), eq(1, 'SN-1000'), eq(9, 'SN-5000')];
    const r = afetadosDoAlerta(parque, criterio, [
      { equipamento: 9, os: { id: 70, numero: '2026-000070', situacao: 'aberta' }, queixa: 12 },
    ]);
    expect(r.map((x) => [x.equipamento, x.enquadramento, x.os?.id ?? null, x.queixa])).toEqual([
      [1, 'afetado', null, null],
      [2, 'afetado', null, null],
      [9, 'afetado', 70, 12],
      [3, 'conferir', null, null],
    ]);
  });
});

const alerta: AlertaParaConferir = { ...criterio, situacao: 'aberto', versao: 2, acoes: 0 };

describe('alteração, encerramento e ação de campo', () => {
  it('pela versão; o encerrado não muda; faixa invertida recusada', () => {
    expect(conferirAlteracaoAlerta(alerta, 1, criterio)).toEqual({ ok: false, motivo: 'desatualizado' });
    expect(conferirAlteracaoAlerta({ ...alerta, situacao: 'encerrado' }, 2, criterio)).toEqual({
      ok: false,
      motivo: 'alerta-encerrado',
    });
    expect(conferirAlteracaoAlerta(alerta, 2, { ...criterio, serieInicio: 'SN-2000' })).toEqual({
      ok: false,
      motivo: 'faixa-invertida',
    });
    expect(conferirAlteracaoAlerta(alerta, 2, { ...criterio, serieFim: 'SN-1500' })).toEqual({ ok: true });
  });
  it('depois da primeira OS o critério não muda (o texto sim)', () => {
    const comAcao = { ...alerta, acoes: 1 };
    expect(conferirAlteracaoAlerta(comAcao, 2, { ...criterio, serieFim: 'SN-1500' })).toEqual({
      ok: false,
      motivo: 'alerta-com-acao',
    });
    expect(conferirAlteracaoAlerta(comAcao, 2, { ...criterio, modelo: 'BI-200' })).toEqual({ ok: true });
  });
  it('revisão W0-08: com OS gerada o número não muda (a queixa o cita); sem OS, muda; espaços das pontas não contam', () => {
    const comNumero = { ...alerta, numero: 'A-123' };
    expect(conferirAlteracaoAlerta({ ...comNumero, acoes: 1 }, 2, { ...criterio, numero: 'A-1234' })).toEqual(
      {
        ok: false,
        motivo: 'numero-com-vinculo',
      },
    );
    expect(conferirAlteracaoAlerta({ ...comNumero, acoes: 1 }, 2, { ...criterio, numero: 'a-123' })).toEqual({
      ok: false,
      motivo: 'numero-com-vinculo',
    });
    expect(
      conferirAlteracaoAlerta({ ...comNumero, acoes: 1 }, 2, { ...criterio, numero: ' A-123 ' }),
    ).toEqual({
      ok: true,
    });
    expect(conferirAlteracaoAlerta(comNumero, 2, { ...criterio, numero: 'A-1234' })).toEqual({ ok: true });
    expect(numeroMudou('A-1', undefined)).toBe(false);
  });
  it('encerrar pela versão', () => {
    expect(conferirEncerramentoAlerta(alerta, 2)).toEqual({ ok: true });
    expect(conferirEncerramentoAlerta(alerta, 3)).toEqual({ ok: false, motivo: 'desatualizado' });
  });
  it('uma OS por afetado ainda sem OS; o a conferir só quando pedido; nenhum: sem-afetados', () => {
    const lista = afetadosDoAlerta([eq(1, 'SN-1000'), eq(2, 'SN-1100'), eq(3, null)], criterio, [
      { equipamento: 2, os: { id: 70, numero: '2026-000070', situacao: 'aberta' }, queixa: null },
    ]);
    const todos = planejarAcaoDeCampo(alerta, 2, lista, []);
    expect(todos.ok && todos.equipamentos.map((x) => x.equipamento)).toEqual([1]);
    const pedido = planejarAcaoDeCampo(alerta, 2, lista, [3, 2, 99]);
    expect(pedido.ok && pedido.equipamentos.map((x) => x.equipamento)).toEqual([3]);
    expect(planejarAcaoDeCampo(alerta, 2, lista, [2])).toEqual({ ok: false, motivo: 'sem-afetados' });
    expect(planejarAcaoDeCampo({ ...alerta, situacao: 'encerrado' }, 2, lista, [])).toEqual({
      ok: false,
      motivo: 'alerta-encerrado',
    });
  });
  it('a descrição da OS vem do alerta, com a série', () => {
    const d = descricaoDaAcaoDeCampo(
      {
        numero: '1234/2026',
        tipo: 'recall',
        titulo: 'Falha no sensor de oclusão',
        acao: 'Trocar a placa do sensor.',
      },
      { numeroSerie: 'SN-1000' },
    );
    expect(d).toBe(
      'Ação de campo — Recall 1234/2026: Falha no sensor de oclusão. Série SN-1000. Trocar a placa do sensor.',
    );
    expect(
      descricaoDaAcaoDeCampo(
        { numero: 'A', tipo: 'alerta', titulo: 'T', acao: 'x'.repeat(3000) },
        { numeroSerie: null },
      ),
    ).toHaveLength(2000);
  });
});
