// Cotas e prazos de marcação (02-AGE linha 47): validação do cadastro, alcance da cota, janela, limite, decisão por
// ação ao esgotar, prazo de aviso e restrição da agenda na marcação. Massa SINTÉTICA.
import type { AgendaEstruturada } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import {
  type CotaMarcacao,
  cotaAlcanca,
  decidirCotas,
  decidirPrazo,
  janelaDaCota,
  limiteDaCota,
  type PrazoAviso,
  prazoQueVale,
  restricaoNaMarcacao,
  validarCota,
  validarPrazo,
} from './index.js';

const cota = (c: Partial<CotaMarcacao> = {}): CotaMarcacao => ({
  agenda: null,
  fontePagadora: 30,
  especialidade: null,
  tipoMarcacao: null,
  item: null,
  periodicidade: 'mes',
  vigenciaInicio: '2030-01-01',
  vigenciaFim: null,
  quantidadeMaxima: 2,
  percentualMaximo: null,
  acao: 'bloquear',
  ativo: true,
  ...c,
});
const alvo = {
  agenda: 1,
  fontePagadora: 30,
  especialidade: 7,
  tipoMarcacao: 3,
  item: null,
  data: '2030-03-12',
};
const prazo = (p: Partial<PrazoAviso> = {}): PrazoAviso => ({
  agenda: null,
  item: null,
  antecedenciaMinimaHoras: 24,
  antecedenciaMaximaDias: 60,
  textoAviso: 'Chegue 15 minutos antes.',
  vigenciaInicio: null,
  vigenciaFim: null,
  ativo: true,
  ...p,
});

describe('cadastro da cota', () => {
  it('aceita a cota completa', () => expect(validarCota(cota())).toBeNull());
  it('exige recorte, limite e vigência coerente', () => {
    expect(validarCota(cota({ fontePagadora: null }))?.codigo).toBe('cota-sem-recorte');
    expect(validarCota(cota({ quantidadeMaxima: null }))?.codigo).toBe('cota-sem-limite');
    expect(validarCota(cota({ quantidadeMaxima: -1 }))?.codigo).toBe('quantidade-invalida');
    expect(validarCota(cota({ percentualMaximo: 101 }))?.codigo).toBe('percentual-invalido');
    expect(validarCota(cota({ vigenciaFim: '2029-12-31' }))?.codigo).toBe('vigencia-invertida');
    expect(validarCota(cota({ acao: 'x' as never }))?.codigo).toBe('acao-invalida');
  });
});

describe('alcance, janela e limite', () => {
  it('alcança só a marcação do mesmo recorte, ativa e vigente', () => {
    expect(cotaAlcanca(cota(), alvo)).toBe(true);
    expect(cotaAlcanca(cota({ fontePagadora: 31 }), alvo)).toBe(false);
    expect(cotaAlcanca(cota({ especialidade: 7, agenda: 1 }), alvo)).toBe(true);
    expect(cotaAlcanca(cota({ especialidade: 8 }), alvo)).toBe(false);
    expect(cotaAlcanca(cota({ ativo: false }), alvo)).toBe(false);
    expect(cotaAlcanca(cota({ vigenciaInicio: '2030-04-01' }), alvo)).toBe(false);
    expect(cotaAlcanca(cota({ item: 5 }), alvo)).toBe(false);
  });
  it('conta no dia, na semana de segunda a domingo, no mês e na vigência', () => {
    expect(janelaDaCota(cota({ periodicidade: 'dia' }), '2030-03-12')).toEqual({
      inicio: '2030-03-12',
      fim: '2030-03-12',
    });
    // 2030-03-12 é terça-feira.
    expect(janelaDaCota(cota({ periodicidade: 'semana' }), '2030-03-12')).toEqual({
      inicio: '2030-03-11',
      fim: '2030-03-17',
    });
    expect(janelaDaCota(cota({ periodicidade: 'mes' }), '2030-02-10')).toEqual({
      inicio: '2030-02-01',
      fim: '2030-02-28',
    });
    expect(janelaDaCota(cota({ periodicidade: 'vigencia' }), '2030-02-10')).toEqual({
      inicio: '2030-01-01',
      fim: '9999-12-31',
    });
  });
  it('o limite é o menor entre a quantidade e o percentual das vagas', () => {
    expect(limiteDaCota({ quantidadeMaxima: 5, percentualMaximo: null }, 100)).toBe(5);
    expect(limiteDaCota({ quantidadeMaxima: null, percentualMaximo: 30 }, 10)).toBe(3);
    expect(limiteDaCota({ quantidadeMaxima: 2, percentualMaximo: 50 }, 10)).toBe(2);
    expect(limiteDaCota({ quantidadeMaxima: null, percentualMaximo: 25 }, 3)).toBe(0);
  });
});

describe('decisão ao esgotar', () => {
  const uso = (c: Partial<CotaMarcacao>, usadas: number) => ({ cota: cota(c), usadas, vagas: 10 });
  it('passa enquanto há saldo', () => expect(decidirCotas([uso({}, 1)])).toEqual({ ok: true, alertas: [] }));
  it('bloqueia, manda à lista de espera ou exige autorização', () => {
    expect(decidirCotas([uso({}, 2)])).toMatchObject({ ok: false, codigo: 'cota-esgotada' });
    expect(decidirCotas([uso({ acao: 'lista_espera' }, 2)])).toMatchObject({
      ok: false,
      codigo: 'cota-esgotada-lista-espera',
    });
    expect(decidirCotas([uso({ acao: 'exigir_autorizacao' }, 2)])).toMatchObject({
      ok: false,
      codigo: 'cota-exige-autorizacao',
    });
  });
  it('alerta sem recusar; autorização e administrador passam com o alerta', () => {
    const a = decidirCotas([uso({ acao: 'alertar' }, 2)]);
    expect(a.ok && a.alertas.length).toBe(1);
    expect(decidirCotas([uso({ acao: 'exigir_autorizacao' }, 2)], { autorizado: true }).ok).toBe(true);
    expect(decidirCotas([uso({}, 9)], { administrador: true }).ok).toBe(true);
  });
  it('a ação mais forte vence quando duas cotas esgotam', () => {
    const d = decidirCotas([uso({ acao: 'alertar' }, 2), uso({ acao: 'lista_espera' }, 2), uso({}, 2)]);
    expect(d).toMatchObject({ ok: false, codigo: 'cota-esgotada' });
  });
});

describe('prazo de aviso', () => {
  const H = 3_600_000;
  it('valida o cadastro', () => {
    expect(validarPrazo(prazo())).toBeNull();
    expect(validarPrazo(prazo({ antecedenciaMinimaHoras: -1 }))?.codigo).toBe('antecedencia-minima-invalida');
    expect(validarPrazo(prazo({ antecedenciaMaximaDias: 0 }))?.codigo).toBe('antecedencia-maxima-invalida');
    expect(validarPrazo(prazo({ antecedenciaMinimaHoras: 72, antecedenciaMaximaDias: 2 }))?.codigo).toBe(
      'antecedencia-incoerente',
    );
    expect(
      validarPrazo(prazo({ antecedenciaMinimaHoras: 0, antecedenciaMaximaDias: null, textoAviso: ' ' }))
        ?.codigo,
    ).toBe('prazo-vazio');
    expect(validarPrazo(prazo({ vigenciaInicio: '2030-02-01', vigenciaFim: '2030-01-01' }))?.codigo).toBe(
      'vigencia-invertida',
    );
  });
  it('vale o mais específico', () => {
    const lista = [
      prazo({ id: 1 }),
      prazo({ id: 2, agenda: 1, antecedenciaMinimaHoras: 48 }),
      prazo({ id: 3, agenda: 2 }),
      prazo({ id: 4, agenda: 1, ativo: false }),
    ];
    expect(prazoQueVale(lista, { agenda: 1, item: null, data: '2030-03-12' })?.id).toBe(2);
    expect(prazoQueVale(lista, { agenda: 9, item: null, data: '2030-03-12' })?.id).toBe(1);
    expect(prazoQueVale([], { agenda: 9, item: null, data: '2030-03-12' })).toBeNull();
  });
  it('recusa antes da mínima e depois da máxima; encaixe não cobra a mínima', () => {
    const p = prazo();
    expect(decidirPrazo(p, { agora: 0, inicio: 10 * H, encaixe: false })).toMatchObject({
      ok: false,
      codigo: 'antecedencia-minima',
    });
    expect(decidirPrazo(p, { agora: 0, inicio: 10 * H, encaixe: true })).toEqual({
      ok: true,
      aviso: 'Chegue 15 minutos antes.',
    });
    expect(decidirPrazo(p, { agora: 0, inicio: 61 * 24 * H, encaixe: false })).toMatchObject({
      ok: false,
      codigo: 'antecedencia-maxima',
    });
    expect(decidirPrazo(p, { agora: 0, inicio: 30 * H, encaixe: false }).ok).toBe(true);
    expect(decidirPrazo(p, { agora: 0, inicio: H, encaixe: false, administrador: true }).ok).toBe(true);
    expect(decidirPrazo(null, { agora: 0, inicio: H, encaixe: false })).toEqual({ ok: true, aviso: null });
  });
});

describe('restrição da agenda na marcação', () => {
  const base: AgendaEstruturada = {
    agendaId: 1,
    nome: 'AGENDA SINTETICA',
    codigoOrigem: null,
    estabelecimentoId: 1,
    estabelecimentoNome: 'HOSPITAL SINTETICO',
    profissionalId: null,
    profissionalNome: null,
    vigenciaInicio: null,
    vigenciaFim: null,
    padrao: {
      sexoAtendido: 'todos',
      idadeMinimaAnos: null,
      idadeMaximaAnos: null,
      aceitaRetorno: true,
      diasRetorno: null,
      permiteEncaixe: true,
      preparo: null,
    },
    convenios: [],
    conveniosAceitos: [],
    coberturas: [],
    restricoes: [],
    preparos: [],
    precosParticulares: [],
    textos: [],
  };
  const restricao = (situacaoRevisao: 'confirmada' | 'estimada') => ({
    id: situacaoRevisao === 'confirmada' ? 1 : 2,
    versao: 1,
    fontePagadoraId: 30,
    fontePagadoraNome: null,
    planoId: null,
    planoNome: null,
    itemAgendavelId: null,
    sexoAtendido: 'feminino' as const,
    idadeMinimaAnos: null,
    idadeMaximaAnos: null,
    aceitaRetorno: null,
    diasRetorno: null,
    permiteEncaixe: null,
    vigenciaInicio: '2030-01-01',
    vigenciaFim: null,
    situacaoRevisao,
    textoOrigemId: null,
  });
  const pergunta = { data: '2030-03-12', sexo: 'masculino' as const, fontePagadoraId: 30, idadeAnos: 40 };
  it('a regra confirmada do convênio recusa', () => {
    const d = restricaoNaMarcacao({ ...base, restricoes: [restricao('confirmada')] }, pergunta);
    expect(d).toMatchObject({ ok: false, codigo: 'restricao-agenda' });
  });
  it('a estimada só alerta; outro convênio passa', () => {
    const d = restricaoNaMarcacao({ ...base, restricoes: [restricao('estimada')] }, pergunta);
    expect(d.ok && d.alertas.length).toBe(1);
    expect(
      restricaoNaMarcacao(
        { ...base, restricoes: [restricao('confirmada')] },
        { ...pergunta, fontePagadoraId: 31 },
      ),
    ).toEqual({ ok: true, alertas: [] });
  });
  it('o padrão da agenda (idade) vale para todos', () => {
    const d = restricaoNaMarcacao({ ...base, padrao: { ...base.padrao, idadeMinimaAnos: 60 } }, pergunta);
    expect(d).toMatchObject({ ok: false, codigo: 'restricao-agenda' });
  });
});
