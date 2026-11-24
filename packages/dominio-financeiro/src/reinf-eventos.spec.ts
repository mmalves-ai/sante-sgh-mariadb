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
});
