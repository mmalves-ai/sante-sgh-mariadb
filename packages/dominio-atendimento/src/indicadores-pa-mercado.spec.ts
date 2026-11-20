// W0-07 (M2): retorno ao PA em 72 horas e taxa de internação via PA, com numerador e denominador exportáveis.
import { describe, expect, it } from 'vitest';
import {
  calcularIndicadores,
  calcularIndicadoresAgregados,
  csvIndicadoresPa,
  linhasIndicadoresPa,
  retornoPa72h,
  totaisIndicadoresPaCatalogo,
} from './indicadores.js';

const P = { inicio: '2026-10-10', fim: '2026-10-12' };

describe('retorno ao PA em 72 horas', () => {
  it('conta a visita do período com outra do mesmo paciente nas 72 h anteriores (inclusive antes do início)', () => {
    const r = retornoPa72h(P, [
      { paciente: 'A', data: '2026-10-07', hora: '10:00' }, // referência (fora do período)
      { paciente: 'A', data: '2026-10-10', hora: '09:59' }, // 71h59 depois: retorno
      { paciente: 'B', data: '2026-10-06', hora: '10:00' }, // referência
      { paciente: 'B', data: '2026-10-10', hora: '10:01' }, // 96h01 depois: não
      { paciente: 'C', data: '2026-10-11', hora: '08:00' },
      { paciente: 'C', data: '2026-10-11', hora: '08:00' }, // mesma hora: não é retorno
      { paciente: 'D', data: '2026-10-12', hora: '23:00' },
      { paciente: 'D', data: '2026-10-13', hora: '01:00' }, // depois do fim: fora
    ]);
    expect(r).toEqual({ retornos: 1, atendimentos: 5, taxa: 20 });
  });

  it('exatamente 72 h conta; sem visitas a taxa é nula', () => {
    expect(
      retornoPa72h(P, [
        { paciente: 'A', data: '2026-10-08', hora: '12:00' },
        { paciente: 'A', data: '2026-10-11', hora: '12:00' },
      ]).retornos,
    ).toBe(1);
    expect(retornoPa72h(P, []).taxa).toBeNull();
  });
});

describe('indicadores do PA completos', () => {
  const agregados = {
    porTipo: [{ tipoAte: 11, laboratorio: false, especialidadeZero: false, caracters: 3, total: 4 }],
    desfechos: [
      { desfecho: 'internacao', tipoAte: 11, total: 1 },
      { desfecho: 'evasao', tipoAte: 11, total: 1 },
    ],
    marcasPa: [],
    observacoes: [],
    paTotal: 4,
    visitasPa: [
      { paciente: 'A', data: '2026-10-10', hora: '08:00' },
      { paciente: 'A', data: '2026-10-11', hora: '08:00' },
      { paciente: 'B', data: '2026-10-11', hora: '09:00' },
      { paciente: 'C', data: '2026-10-12', hora: '09:00' },
    ],
    internacoesPa: { viaDesfecho: 1, viaEncaminhamento: 2, total: 2 },
  };

  it('agregados: retorno 1/4 e internação 2/4 com as parcelas (desfecho e encaminhamento sem contar duas vezes)', () => {
    const r = calcularIndicadoresAgregados(P, agregados);
    expect(r.pa).toMatchObject({
      retorno72h: 1,
      retorno72hDenominador: 4,
      taxaRetorno72h: 25,
      internacoes: 2,
      internacoesViaDesfecho: 1,
      internacoesViaEncaminhamento: 2,
      taxaInternacao: 50,
      taxaEvasao: 50,
    });
  });

  it('sem as listas novas, os indicadores de mercado ficam zerados sobre o total do PA', () => {
    const antigo = {
      porTipo: agregados.porTipo,
      desfechos: agregados.desfechos,
      marcasPa: [],
      observacoes: [],
      paTotal: agregados.paTotal,
    };
    const r = calcularIndicadoresAgregados(P, antigo);
    expect(r.pa).toMatchObject({
      retorno72h: 0,
      retorno72hDenominador: 4,
      internacoes: 0,
      taxaInternacao: 0,
    });
  });

  it('por atendimento: mesmas regras', () => {
    const pa = (paciente: string, data: string, extra: object = {}) => ({
      tipoAte: 11,
      especialidade: 1,
      laboratorio: false,
      carater: 3,
      desfecho: null,
      paciente,
      data,
      hora: '10:00',
      ...extra,
    });
    const r = calcularIndicadores(P, [
      pa('A', '2026-10-10', { desfecho: 'internacao', encaminhadoInternacao: true }),
      pa('A', '2026-10-12'),
      pa('B', '2026-10-11', { encaminhadoInternacao: true }),
    ]);
    expect(r.pa).toMatchObject({
      retorno72h: 1,
      retorno72hDenominador: 3,
      internacoes: 2,
      internacoesViaDesfecho: 1,
    });
  });

  it('exporta numerador, denominador e taxa em CSV', () => {
    const r = calcularIndicadoresAgregados(P, agregados);
    const linhas = linhasIndicadoresPa(r);
    expect(linhas[0]).toEqual({
      indicador: 'Retorno ao PA em 72 horas',
      numerador: 1,
      denominador: 4,
      taxa: 25,
    });
    expect(linhas[1]).toEqual({
      indicador: 'Taxa de internação via PA',
      numerador: 2,
      denominador: 4,
      taxa: 50,
    });
    const csv = csvIndicadoresPa(r).split('\r\n');
    expect(csv[0]).toBe('Início;Fim;Indicador;Numerador;Denominador;Taxa (%)');
    expect(csv[1]).toBe('2026-10-10;2026-10-12;Retorno ao PA em 72 horas;1;4;25');
    expect(csv.at(-1)).toBe('');
  });

  it('catálogo: retornoPa72h e internacaoViaPa com as parcelas das linhas exportáveis', () => {
    const r = calcularIndicadoresAgregados(P, agregados);
    const t = totaisIndicadoresPaCatalogo(r);
    expect([...t.keys()]).toEqual(['retornoPa72h', 'internacaoViaPa']);
    expect(t.get('retornoPa72h')).toEqual({ numerador: 1, denominador: 4 });
    expect(t.get('internacaoViaPa')).toEqual({ numerador: 2, denominador: 4 });
    const [retorno, internacao] = linhasIndicadoresPa(r);
    expect(t.get('retornoPa72h')).toEqual({
      numerador: retorno!.numerador,
      denominador: retorno!.denominador,
    });
    expect(t.get('internacaoViaPa')).toEqual({
      numerador: internacao!.numerador,
      denominador: internacao!.denominador,
    });
  });
});
