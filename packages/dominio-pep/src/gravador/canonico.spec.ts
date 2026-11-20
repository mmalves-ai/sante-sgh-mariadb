// Prova do documento (ficha do M22, seção 6; regra 11): JCS (RFC 8785), SHA-256 e a cadeia de eventos.
import { describe, expect, it } from 'vitest';
import {
  cadeiaIntegra,
  conteudoCanonico,
  type EventoDocumento,
  hashDoConteudo,
  hashDoEvento,
  jcs,
  sha256Hex,
} from './canonico.js';

describe('JSON canônico (RFC 8785)', () => {
  it('chaves em ordem, sem espaços, números do ECMAScript; indefinido sai', () => {
    expect(jcs({ b: [1, 2.5, 'x'], a: { d: null, c: true }, z: undefined })).toBe(
      '{"a":{"c":true,"d":null},"b":[1,2.5,"x"]}',
    );
    expect(jcs(1e21)).toBe('1e+21');
    expect(jcs('ação "x"')).toBe('"ação \\"x\\""');
    expect(() => jcs(Number.NaN)).toThrow('não finito');
    expect(() => jcs(() => 1)).toThrow('fora do JSON');
  });
  it('vetores do RFC: ordenação por unidades UTF-16', () => {
    expect(jcs({ '€': 1, '\r': 2, '😀': 3, '1': 4 })).toBe('{"\\r":2,"1":4,"€":1,"😀":3}');
  });
  it('SHA-256 conhecido', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('conteúdo canônico do registro e cadeia de eventos', () => {
  const base = {
    estabelecimento: 'pc',
    registro: 10,
    modelo: 38,
    paciente: 5,
    atendimento: 7,
    dataHoraClinica: '2026-10-21T10:00',
    impressao: 'a'.repeat(64),
  };
  it('a ordem das respostas não muda o hash; o conteúdo muda', async () => {
    const r1 = {
      vinculo: 2,
      valor: { tipo: 'texto' as const, texto: 'x' },
      autopreenchido: false,
      confirmado: true,
    };
    const r2 = {
      vinculo: 1,
      valor: { tipo: 'numero' as const, valor: 3 },
      autopreenchido: true,
      confirmado: true,
    };
    const a = await hashDoConteudo({ ...base, respostas: [r1, r2] });
    expect(await hashDoConteudo({ ...base, respostas: [r2, r1] })).toBe(a);
    expect(await hashDoConteudo({ ...base, respostas: [r1] })).not.toBe(a);
    expect(conteudoCanonico({ ...base, respostas: [r1] })).not.toContain('confirmado');
  });
  it('cadeia: cada evento encadeia o anterior; mexer em um quebra a cadeia', async () => {
    const e1: EventoDocumento = {
      tipo: 'criado',
      registro: 10,
      hashDocumento: 'h',
      em: '2026-10-21T13:00:00.000Z',
      usuario: 'SINT',
    };
    const e2: EventoDocumento = { ...e1, tipo: 'suspenso', justificativa: 'erro de paciente' };
    const h1 = await hashDoEvento(e1, null);
    const h2 = await hashDoEvento(e2, h1);
    expect(
      await cadeiaIntegra([
        { evento: e1, hash: h1 },
        { evento: e2, hash: h2 },
      ]),
    ).toBe(true);
    expect(
      await cadeiaIntegra([
        { evento: e1, hash: h1 },
        { evento: { ...e2, usuario: 'OUTRO' }, hash: h2 },
      ]),
    ).toBe(false);
  });
});
