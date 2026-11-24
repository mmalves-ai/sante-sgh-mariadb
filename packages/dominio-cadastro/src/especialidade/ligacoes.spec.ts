import { describe, expect, it } from 'vitest';
import { conflitosLotacao, errosLotacao } from '../profissional/lotacao.js';
import {
  camposFaltantes,
  errosCodigoNaFonte,
  errosInativacao,
  parecidos,
} from '../solicitante/manutencao.js';
import {
  errosPeriodoProcedimento,
  periodosSobrepostos,
  principaisADesmarcar,
  procedimentoPermitido,
} from './ligacoes.js';

describe('especialidade: procedimentos com vigência e ocupação principal', () => {
  const per = [
    { id: 1, procedimento: 10, inicio: '2026-01-01', fim: '2026-06-30' },
    { id: 2, procedimento: 11, inicio: '2026-01-01', fim: null },
  ];
  it('recusa vigência invertida e período que cruza o do mesmo procedimento', () => {
    expect(errosPeriodoProcedimento({ inicio: '2026-02-01', fim: '2026-01-01' })).toEqual([
      'vigencia-invertida',
    ]);
    expect(periodosSobrepostos(per, { procedimento: 10, inicio: '2026-06-01', fim: null })).toEqual([1]);
    expect(periodosSobrepostos(per, { procedimento: 10, inicio: '2026-07-01', fim: null })).toEqual([]);
  });
  it('vale no dia só dentro da vigência', () => {
    expect(procedimentoPermitido(per, 10, '2026-06-30')).toBe(true);
    expect(procedimentoPermitido(per, 10, '2026-07-01')).toBe(false);
    expect(procedimentoPermitido(per, 11, '2030-01-01')).toBe(true);
  });
  it('uma ocupação principal: a primeira entra principal; marcar outra desmarca a anterior', () => {
    expect(principaisADesmarcar([], { id: null, principal: false })).toEqual({
      desmarcar: [],
      principal: true,
    });
    expect(
      principaisADesmarcar(
        [
          { id: 1, principal: true },
          { id: 2, principal: false },
        ],
        { id: 2, principal: true },
      ),
    ).toEqual({ desmarcar: [1], principal: true });
  });
});

describe('lotação do profissional', () => {
  const base = {
    estabelecimento: 1,
    unidade: 5,
    ocupacao: 7,
    cargaAmbulatorial: 20,
    cargaHospitalar: 0,
    cargaOutros: 0,
    vigenciaInicio: '2026-01-01',
    vigenciaFim: null,
  };
  it('carga semanal: zero, acima da semana e horas inválidas; vigência invertida', () => {
    expect(errosLotacao(base)).toEqual([]);
    expect(errosLotacao({ ...base, cargaAmbulatorial: 0 })).toEqual(['carga-zerada']);
    expect(errosLotacao({ ...base, cargaHospitalar: 150 })).toEqual(['carga-acima-da-semana']);
    expect(errosLotacao({ ...base, cargaOutros: 1.5 })).toEqual(['carga-invalida']);
    expect(errosLotacao({ ...base, vigenciaFim: '2025-12-31' })).toEqual(['vigencia-invertida']);
  });
  it('mesma ocupação na mesma unidade com vigência cruzada; soma das cargas no período', () => {
    const ex = [
      {
        id: 1,
        estabelecimento: 1,
        unidade: 5,
        ocupacao: 7,
        inicio: '2025-01-01',
        fim: null,
        cargaSemanal: 40,
      },
      {
        id: 2,
        estabelecimento: 2,
        unidade: null,
        ocupacao: 7,
        inicio: '2025-01-01',
        fim: null,
        cargaSemanal: 120,
      },
      {
        id: 3,
        estabelecimento: 1,
        unidade: 5,
        ocupacao: 7,
        inicio: '2024-01-01',
        fim: '2024-12-31',
        cargaSemanal: 40,
      },
    ];
    const r = conflitosLotacao(ex, base);
    expect(r.sobrepostas).toEqual([1]);
    expect(r.cargaNoPeriodo).toBe(180);
    expect(r.excedeSemana).toBe(true);
    expect(conflitosLotacao(ex.slice(2), base)).toEqual({
      sobrepostas: [],
      cargaNoPeriodo: 20,
      excedeSemana: false,
      cargaAlta: false,
    });
  });
  it('carga máxima simultânea: lotações sequenciais não se somam; aviso acima de 60 horas sem bloquear', () => {
    const lot = (id: number, inicio: string, fim: string | null, cargaSemanal: number) => ({
      id,
      estabelecimento: 2,
      unidade: null,
      ocupacao: 9,
      inicio,
      fim,
      cargaSemanal,
    });
    const nova = { ...base, cargaAmbulatorial: 40, vigenciaInicio: '2026-01-01', vigenciaFim: null };
    // 100 h de jan a mar e 100 h a partir de abr: nunca valem juntas; o máximo simultâneo é 140 h.
    const seq = [lot(1, '2026-01-01', '2026-03-31', 100), lot(2, '2026-04-01', null, 100)];
    expect(conflitosLotacao(seq, nova)).toEqual({
      sobrepostas: [],
      cargaNoPeriodo: 140,
      excedeSemana: false,
      cargaAlta: true,
    });
    // Uma terceira que começa em maio dentro do período da nova sobe o máximo nesse ponto.
    expect(conflitosLotacao([...seq, lot(3, '2026-05-01', null, 30)], nova)).toMatchObject({
      cargaNoPeriodo: 170,
      excedeSemana: true,
    });
    // A que começa depois do fim da nova não conta.
    expect(
      conflitosLotacao([...seq, lot(3, '2026-05-01', null, 30)], { ...nova, vigenciaFim: '2026-04-30' }),
    ).toMatchObject({ cargaNoPeriodo: 140, excedeSemana: false });
    expect(conflitosLotacao([], { ...nova, cargaAmbulatorial: 60 }).cargaAlta).toBe(false);
    expect(conflitosLotacao([], { ...nova, cargaAmbulatorial: 61 }).cargaAlta).toBe(true);
  });
});

describe('solicitante externo: parecidos, campos da guia, código na fonte e inativação', () => {
  const lista = [
    { id: 1, nome: 'Ana Beatriz Sintetica', conselho: 'CRM', uf: 'MG', numero: 70001, cbo: '225125' },
    { id: 2, nome: 'Dra. Ana Beatriz Sintetica', conselho: 'CRM', uf: 'MG', numero: 99999, cbo: null },
    { id: 3, nome: 'Ana Outra', conselho: 'CRM', uf: 'MG', numero: 70011, cbo: null },
    { id: 4, nome: 'Carlos Sintetico', conselho: 'CRM', uf: 'SP', numero: 70001, cbo: null },
  ];
  it('ordena mesmo registro, mesmo nome e número a um dígito', () => {
    const alvo = { nome: 'ANA BEATRIZ SINTÉTICA', conselho: 'crm', uf: 'mg', numero: 70001, cbo: '225125' };
    expect(parecidos(lista, alvo)).toEqual([
      { id: 1, motivo: 'mesmo-registro' },
      { id: 2, motivo: 'mesmo-nome' },
      { id: 3, motivo: 'numero-proximo' },
    ]);
    expect(parecidos(lista, { ...alvo, id: 1 }).map((p) => p.id)).toEqual([2, 3]);
  });
  it('campos que faltam para a guia', () => {
    expect(camposFaltantes(lista[0]!)).toEqual([]);
    expect(camposFaltantes({ id: 9, conselho: 'CRM', uf: 'X', numero: null, cbo: null })).toEqual([
      'uf',
      'numero',
      'cbo',
    ]);
  });
  it('código na fonte e motivo da inativação', () => {
    expect(errosCodigoNaFonte(' ')).toEqual(['codigo-vazio']);
    expect(errosCodigoNaFonte('12 34')).toEqual(['codigo-invalido']);
    expect(errosCodigoNaFonte('AB-123')).toEqual([]);
    expect(errosInativacao({ motivo: 'curto', data: '2026-01-01', inscricao: '2026-02-01' })).toEqual([
      'motivo-curto',
      'inativacao-antes-da-inscricao',
    ]);
  });
});
