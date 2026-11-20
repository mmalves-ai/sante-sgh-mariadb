// M20: indicadores (denominador ESPEC > 0, regra 3; tempos só das marcas do novo; evasão, regra 8) e as fichas a
// imprimir (modelo e seleções), os impressos e a idade. Dados sintéticos.
import { describe, expect, it } from 'vitest';
import {
  copiasValidas,
  fichasAImprimir,
  idadeEmAnos,
  impressosDoAtendimento,
  type ModeloFicha,
  type SelecaoFicha,
} from './impressos.js';
import { calcularIndicadores, calcularIndicadoresAgregados, ehRequisicao, mediana } from './indicadores.js';

describe('indicadores do ambulatório e do PA', () => {
  it('requisição de laboratório à parte; medianas das marcas; evasão sobre os desfechos; parcelas impressas', () => {
    const pa = (x: Partial<Parameters<typeof calcularIndicadores>[1][number]>) => ({
      tipoAte: 11,
      especialidade: 20,
      laboratorio: false,
      carater: 3,
      desfecho: null,
      ...x,
    });
    const r = calcularIndicadores({ inicio: '2026-10-01', fim: '2026-10-31' }, [
      { tipoAte: 4, especialidade: 20, laboratorio: false, carater: 2, desfecho: 'alta' },
      { tipoAte: 4, especialidade: 21, laboratorio: false, carater: null, desfecho: null },
      { tipoAte: 23, especialidade: 0, laboratorio: true, carater: 2, desfecho: null },
      pa({
        chegada: '2026-10-22T08:00:00',
        atendimentoMedico: '2026-10-22T08:20:00',
        decisao: '2026-10-22T09:00:00',
        saida: '2026-10-22T09:30:00',
        desfecho: 'alta',
        observacaoHoras: 25,
      }),
      pa({ chegada: '2026-10-22T10:00:00', atendimentoMedico: '2026-10-22T10:40:00', desfecho: 'evasao' }),
      pa({ desfecho: 'administrativo', observacaoHoras: 3 }),
    ]);
    expect(r).toMatchObject({ atendimentos: 5, requisicoesLaboratorio: 1, semMarcas: 1 });
    expect(r.porTipo[0]).toMatchObject({ tipo: '11', total: 3 });
    expect(r.porCarater).toEqual([
      { carater: 'Eletivo', total: 1 },
      { carater: 'Urgência ou emergência', total: 3 },
      { carater: 'Não informado', total: 1 },
    ]);
    expect(r.pa).toMatchObject({
      atendimentos: 3,
      comMarcas: 2,
      portaMedicoMedianaMin: 30,
      portaDecisaoMedianaMin: 60,
      permanenciaMedianaMin: 90,
      evasoes: 1,
      comDesfecho: 3,
      taxaEvasao: 33.3,
      observacoes: 2,
      observacoesAcima24h: 1,
    });
    expect(r.desfechos.find((d) => d.desfecho === 'alta')?.total).toBe(2);
    expect(calcularIndicadores({ inicio: 'a', fim: 'b' }, []).pa.taxaEvasao).toBeNull();
    expect(mediana([])).toBeNull();
    expect(mediana([3, 1, 2])).toBe(2);
    expect(mediana([-1, Number.NaN, 4])).toBe(4);
    expect(ehRequisicao({ especialidade: 0, laboratorio: false })).toBe(true);
  });
});

describe('indicadores pelos agregados do banco', () => {
  it('contagens por grupo, marcas por atendimento e as parcelas', () => {
    const r = calcularIndicadoresAgregados(
      { inicio: '2026-10-01', fim: '2026-10-31' },
      {
        porTipo: [
          { tipoAte: 4, laboratorio: false, especialidadeZero: false, caracters: 2, total: 10 },
          { tipoAte: 11, laboratorio: false, especialidadeZero: false, caracters: 3, total: 4 },
          { tipoAte: 23, laboratorio: true, especialidadeZero: true, caracters: 2, total: 6 },
          { tipoAte: 4, laboratorio: false, especialidadeZero: false, caracters: 0, total: 1 },
        ],
        desfechos: [
          { desfecho: 'alta', tipoAte: 11, total: 3 },
          { desfecho: 'evasao', tipoAte: 11, total: 1 },
          { desfecho: 'alta', tipoAte: 4, total: 5 },
        ],
        marcasPa: [
          { cabecalho: '1', etapa: 'abertura', em: '2026-10-22T08:00:00' },
          { cabecalho: '1', etapa: 'chegada', em: '2026-10-22T07:50:00' },
          { cabecalho: '1', etapa: 'atendimentoMedico', em: '2026-10-22T08:20:00' },
          { cabecalho: '1', etapa: 'decisao', em: '2026-10-22T09:00:00' },
          { cabecalho: '1', etapa: 'saida', em: '2026-10-22T09:10:00' },
          { cabecalho: '2', etapa: 'abertura', em: '2026-10-22T10:00:00' },
          { cabecalho: '3', etapa: 'atendimentoMedico', em: '2026-10-22T10:00:00' },
        ],
        observacoes: [
          { cabecalho: '1', minutos: 30 },
          { cabecalho: '2', minutos: 1500 },
        ],
        paTotal: 4,
      },
    );
    expect(r).toMatchObject({ atendimentos: 15, requisicoesLaboratorio: 6, semMarcas: 2 });
    expect(r.pa).toMatchObject({
      atendimentos: 4,
      comMarcas: 2,
      portaMedicoMedianaMin: 30,
      portaDecisaoMedianaMin: 70,
      permanenciaMedianaMin: 80,
      evasoes: 1,
      comDesfecho: 4,
      taxaEvasao: 25,
      observacoes: 2,
      observacoesAcima24h: 1,
    });
    expect(r.porCarater.at(-1)).toEqual({ carater: 'Não informado', total: 1 });
    expect(r.desfechos.find((d) => d.desfecho === 'alta')?.total).toBe(8);
    expect(
      calcularIndicadoresAgregados(
        { inicio: 'a', fim: 'b' },
        { porTipo: [], desfechos: [], marcasPa: [], observacoes: [], paTotal: 0 },
      ).pa.taxaEvasao,
    ).toBeNull();
  });
});

describe('fichas a imprimir', () => {
  const m = (x: Partial<ModeloFicha>): ModeloFicha => ({
    grafica: true,
    modelo: 1,
    nome: 'Ficha ambulatorial',
    copias: 1,
    ordem: 1,
    clinicas: 'CMNOPQ',
    retorno: 'N',
    noAtendimento: true,
    idadeInicial: 0,
    idadeFinal: 0,
    ...x,
  });
  const at = {
    convenio: 306,
    especialidade: 20,
    unidade: 1,
    grupos: [10],
    clinica: 'M',
    retorno: false,
    idade: 40,
  };
  it('modelo, impressora, clínica, retorno, idade e as seleções por dimensão; na ordem, com as cópias', () => {
    const modelos = [
      m({}),
      m({ modelo: 2, ordem: 3, nome: 'Guia', copias: 2 }),
      m({ modelo: 3, ordem: 2, nome: 'Só retorno', retorno: 'S' }),
      m({ modelo: 4, nome: 'Matricial', grafica: false }),
      m({ modelo: 5, nome: 'Pediatria', idadeFinal: 12 }),
      m({ modelo: 6, nome: 'Outra clínica', clinicas: 'C' }),
      m({ modelo: 7, nome: 'Sem cópia', copias: 0 }),
      m({ modelo: 8, nome: 'Fora do atendimento', noAtendimento: false }),
      m({ modelo: 9, nome: 'Por convênio' }),
      m({ modelo: 10, nome: 'Por grupo', ordem: 4 }),
      m({ modelo: 11, nome: 'Adulto', idadeInicial: 18, clinicas: '' }),
    ];
    const sel: SelecaoFicha[] = [
      { grafica: true, modelo: 9, dimensao: 'convenio', item: 320, imprime: true },
      { grafica: true, modelo: 9, dimensao: 'convenio', item: 306, imprime: false },
      { grafica: true, modelo: 10, dimensao: 'grupo', item: 10, imprime: true },
      { grafica: true, modelo: 1, dimensao: 'unidade', item: 1, imprime: true },
      { grafica: true, modelo: 1, dimensao: 'especialidade', item: 20, imprime: true },
    ];
    expect(fichasAImprimir(modelos, sel, at, true).map((f) => f.modelo)).toEqual([1, 11, 2, 10]);
    expect(fichasAImprimir(modelos, sel, { ...at, retorno: true }, true).map((f) => f.modelo)).toEqual([
      1, 11, 3, 2, 10,
    ]);
    expect(fichasAImprimir(modelos, sel, { ...at, idade: null }, true).map((f) => f.modelo)).toEqual([
      1, 2, 10,
    ]);
    expect(fichasAImprimir(modelos, sel, { ...at, idade: 8 }, true).map((f) => f.modelo)).toEqual([
      1, 5, 2, 10,
    ]);
    expect(fichasAImprimir(modelos, sel, at, false).map((f) => f.modelo)).toEqual([4]);
    expect(fichasAImprimir(modelos, sel, { ...at, convenio: 320 }, true).map((f) => f.modelo)).toContain(9);
  });

  it('idade em anos completos; impressos e o que falta; cópias', () => {
    expect(idadeEmAnos('1980-10-23', '2026-10-22')).toBe(45);
    expect(idadeEmAnos('1980-10-22', '2026-10-22')).toBe(46);
    expect(idadeEmAnos('1980-11-01', '2026-10-22')).toBe(45);
    expect(idadeEmAnos('1899-12-30', '2026-10-22')).toBeNull();
    expect(idadeEmAnos(null, '2026-10-22')).toBeNull();
    expect(idadeEmAnos('2027-01-01', '2026-10-22')).toBeNull();
    const ok = impressosDoAtendimento({
      nome: 'PACIENTE SINTETICO',
      nascimento: '1980-01-02',
      prontuario: 9001,
    });
    expect(ok.every((i) => i.pode)).toBe(true);
    const semNasc = impressosDoAtendimento({
      nome: 'PACIENTE SINTETICO',
      nascimento: '1899-12-30',
      prontuario: 9001,
    });
    expect(semNasc.find((i) => i.impresso === 'pulseira')?.motivo).toMatch(/nascimento/);
    expect(semNasc.find((i) => i.impresso === 'ficha')?.pode).toBe(true);
    expect(impressosDoAtendimento({ nome: ' ', nascimento: null, prontuario: 0 }).every((i) => !i.pode)).toBe(
      true,
    );
    expect(copiasValidas('etiqueta', 20)).toBe(true);
    expect(copiasValidas('pulseira', 6)).toBe(false);
    expect(copiasValidas('ficha', 0)).toBe(false);
    expect(copiasValidas('ficha', 1.5)).toBe(false);
  });
});
