import { describe, expect, it } from 'vitest';
import type { RetencaoServico } from './declaracoes.js';
import {
  conferirProcessoSuspensao,
  conferirRetornoReinf,
  conferirTransmissaoReinf,
  montarEventosReinf,
  planejarEnvioReinf,
  type ProcessoSuspensao,
  processoQueSuspende,
  xmlEventoReinf,
  xmlExclusaoReinf,
  type EventoReinfGravado,
} from './reinf-eventos.js';

const A = '11111111000191';
const B = '22222222000191';
const ret = (cnpj: string, x: Partial<RetencaoServico> = {}): RetencaoServico => ({
  cnpjPrestador: cnpj,
  documento: 1,
  dataEmissao: '2026-10-05',
  valorBruto: 1000,
  inss: 110,
  ir: 15,
  csll: 10,
  pis: 6.5,
  cofins: 30,
  ...x,
});
const proc = (x: Partial<ProcessoSuspensao> = {}): ProcessoSuspensao => ({
  id: 7,
  tipo: 'judicial',
  numero: '00012345620268260100',
  indicativo: '01',
  tributo: 'inss',
  beneficiario: A,
  vigenciaInicio: '2026-01-01',
  vigenciaFim: null,
  ...x,
});
const codigo = (r: { codigo: string } | null) => r?.codigo ?? null;

describe('EFD-REINF por evento', () => {
  it('um evento por estabelecimento e beneficiário, com o suspenso pelo processo', () => {
    const ev = montarEventosReinf('R-2000', '2026-10', '33333333000191', [ret(A), ret(A), ret(B)], [proc()]);
    expect(ev).toHaveLength(2);
    expect(ev[0]).toMatchObject({
      beneficiario: A,
      documentos: 2,
      valorBruto: 2000,
      valorRetido: 0,
      valorSuspenso: 220,
    });
    expect(ev[1]).toMatchObject({ beneficiario: B, valorRetido: 110, valorSuspenso: 0 });
    expect(xmlEventoReinf(ev[0]!, null)).toContain('<nrProcRet>00012345620268260100</nrProcRet>');
    const r4 = montarEventosReinf('R-4000', '2026-10', '33333333000191', [ret(A)], [proc({ tributo: 'ir' })]);
    expect(r4[0]).toMatchObject({ evento: 'R-4020', valorSuspenso: 15, valorRetido: 46.5 });
  });
  it('o processo do beneficiário vence o geral e só vale na vigência', () => {
    const geral = proc({ id: 1, beneficiario: null });
    const dele = proc({ id: 2 });
    expect(processoQueSuspende([geral, dele], 'inss', A, '2026-10')?.id).toBe(2);
    expect(processoQueSuspende([geral, dele], 'inss', B, '2026-10')?.id).toBe(1);
    expect(processoQueSuspende([proc({ vigenciaFim: '2026-09-30' })], 'inss', A, '2026-10')).toBeNull();
  });
  it('confere o processo', () => {
    expect(conferirProcessoSuspensao(proc())).toBeNull();
    expect(codigo(conferirProcessoSuspensao(proc({ numero: '123' })))).toBe('numero-processo');
    expect(codigo(conferirProcessoSuspensao(proc({ indicativo: 'x' })))).toBe('indicativo-invalido');
    expect(codigo(conferirProcessoSuspensao(proc({ vigenciaFim: '2025-01-01' })))).toBe('vigencia-invalida');
  });
  it('aceito que mudou vira retificador com o recibo; igual não reenvia; enviado espera o retorno', () => {
    const [e] = montarEventosReinf('R-2000', '2026-10', '3', [ret(A)], []);
    const g = (situacao: 'aceito' | 'enviado' | 'rejeitado', hash: string) => ({
      id: 1,
      evento: 'R-2010',
      beneficiario: A,
      situacao,
      recibo: '1.2.000123',
      hash,
    });
    expect(planejarEnvioReinf([{ evento: e!, hash: 'h1' }], [g('aceito', 'h1')]).iguais).toBe(1);
    const r = planejarEnvioReinf([{ evento: e!, hash: 'h2' }], [g('aceito', 'h1')]);
    expect(r.novos[0]?.retifica?.recibo).toBe('1.2.000123');
    expect(xmlEventoReinf(e!, '1.2.000123')).toContain(
      '<indRetif>2</indRetif><nrRecibo>1.2.000123</nrRecibo>',
    );
    expect(planejarEnvioReinf([{ evento: e!, hash: 'h2' }], [g('enviado', 'h1')]).aguardando).toEqual([A]);
    expect(
      planejarEnvioReinf([{ evento: e!, hash: 'h2' }], [g('rejeitado', 'h1')]).novos[0]?.substitui?.id,
    ).toBe(1);
  });
  it('transmissão e retorno', () => {
    expect(conferirTransmissaoReinf('gerado')).toBeNull();
    expect(conferirTransmissaoReinf('validado')).toBeNull();
    expect(codigo(conferirTransmissaoReinf('aceito'))).toBe('evento-nao-transmissivel');
    expect(
      conferirRetornoReinf('enviado', { aceito: true, recibo: '1.2.000123', ocorrencias: null }),
    ).toBeNull();
    expect(codigo(conferirRetornoReinf('enviado', { aceito: true, recibo: null, ocorrencias: null }))).toBe(
      'recibo-obrigatorio',
    );
    expect(codigo(conferirRetornoReinf('enviado', { aceito: false, recibo: null, ocorrencias: ' ' }))).toBe(
      'ocorrencias-obrigatorias',
    );
    expect(codigo(conferirRetornoReinf('gerado', { aceito: false, recibo: null, ocorrencias: 'x' }))).toBe(
      'evento-sem-envio',
    );
  });

  const C = '12345678909';
  const gv = (x: Partial<EventoReinfGravado>): EventoReinfGravado => ({
    id: 1,
    evento: 'R-2010',
    beneficiario: A,
    situacao: 'aceito',
    recibo: '1.2.000123',
    hash: 'h1',
    retificadoId: null,
    ...x,
  });
  it('R-4000: CPF vai pelo R-4010 (cpfBenef) e CNPJ pelo R-4020 (cnpjBenef)', () => {
    const ev = montarEventosReinf('R-4000', '2026-10', '3', [ret(A), ret(C)], []);
    expect(ev.map((e) => [e.beneficiario, e.evento])).toEqual([
      [A, 'R-4020'],
      [C, 'R-4010'],
    ]);
    expect(xmlEventoReinf(ev[1]!, null)).toContain(`<evtRetPF>`);
    expect(xmlEventoReinf(ev[1]!, null)).toContain(`<cpfBenef>${C}</cpfBenef>`);
    expect(xmlEventoReinf(ev[0]!, null)).toContain(`<cnpjBenef>${A}</cnpjBenef>`);
  });
  it('o cancelado sai da cadeia e o validado ainda não enviado é trocado', () => {
    const [e] = montarEventosReinf('R-2000', '2026-10', '3', [ret(A)], []);
    const p = [{ evento: e!, hash: 'h2' }];
    const r = planejarEnvioReinf(p, [gv({}), gv({ id: 2, situacao: 'cancelado', recibo: null, hash: 'h9' })]);
    expect(r.novos[0]?.retifica?.id).toBe(1);
    const v = planejarEnvioReinf(p, [gv({ situacao: 'validado', recibo: null })]);
    expect(v.novos[0]).toMatchObject({ retifica: null, substitui: { id: 1 } });
    expect(planejarEnvioReinf([{ evento: e!, hash: 'h1' }], [gv({ situacao: 'validado' })]).iguais).toBe(1);
  });
  it('retificador rejeitado: o novo retificador leva o recibo do original aceito', () => {
    const [e] = montarEventosReinf('R-2000', '2026-10', '3', [ret(A)], []);
    const grav = [gv({}), gv({ id: 2, situacao: 'rejeitado', recibo: null, hash: 'h2', retificadoId: 1 })];
    const r = planejarEnvioReinf([{ evento: e!, hash: 'h3' }], grav);
    expect(r.novos[0]?.substitui?.id).toBe(2);
    expect(r.novos[0]?.retifica?.recibo).toBe('1.2.000123');
    // Mesmo sem a ligação gravada, o último aceito do beneficiário é o original.
    const sem = planejarEnvioReinf(
      [{ evento: e!, hash: 'h3' }],
      [grav[0]!, { ...grav[1]!, retificadoId: null }],
    );
    expect(sem.novos[0]?.retifica?.id).toBe(1);
    expect(xmlEventoReinf(e!, r.novos[0]!.retifica!.recibo)).toContain('<indRetif>2</indRetif>');
  });
  it('rejeitado igual não conta como em dia: aparece como rejeitado sem correção', () => {
    const [e] = montarEventosReinf('R-2000', '2026-10', '3', [ret(A)], []);
    const r = planejarEnvioReinf([{ evento: e!, hash: 'h1' }], [gv({ situacao: 'rejeitado', recibo: null })]);
    expect(r.iguais).toBe(0);
    expect(r.novos).toHaveLength(0);
    expect(r.rejeitadosSemCorrecao.map((g) => g.id)).toEqual([1]);
  });
  it('aceito cujo beneficiário saiu da competência vai à exclusão (R-9000) com o recibo', () => {
    const r = planejarEnvioReinf(
      [],
      [gv({}), gv({ id: 2, hash: 'h2', recibo: '1.2.000200', retificadoId: 1 })],
    );
    expect(r.exclusoes.map((g) => g.recibo)).toEqual(['1.2.000200']);
    expect(xmlExclusaoReinf('R-2010', '2026-10', '1.2.000200')).toContain(
      '<tpEvento>R-2010</tpEvento><nrRecEvt>1.2.000200</nrRecEvt>',
    );
    const exc = (situacao: EventoReinfGravado['situacao']) =>
      gv({ id: 3, evento: 'R-9000', situacao, recibo: null, retificadoId: 1 });
    expect(planejarEnvioReinf([], [gv({}), exc('aceito')]).exclusoes).toHaveLength(0);
    expect(planejarEnvioReinf([], [gv({}), exc('enviado')]).aguardando).toEqual([A]);
    expect(planejarEnvioReinf([], [gv({}), exc('rejeitado')]).exclusoes).toHaveLength(1);
    // Depois da exclusão aceita, o beneficiário que volta entra como inclusão, sem recibo.
    const [e] = montarEventosReinf('R-2000', '2026-10', '3', [ret(A)], []);
    const volta = planejarEnvioReinf([{ evento: e!, hash: 'h5' }], [gv({}), exc('aceito')]);
    expect(volta.novos[0]).toMatchObject({ retifica: null, substitui: null });
  });
});
