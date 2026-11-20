// Regra 5 do M31: protocolo normalizado (sem CRLF e TAB, trim, até 12 bytes Latin1); o mesmo protocolo pode cobrir
// vários lotes; limpar volta a ''; protocolo congela o lote; numeração do contador com 12 dígitos (regra 2).
import { describe, expect, it } from 'vitest';
import {
  conferirRegistroProtocolo,
  loteCongelado,
  normalizarProtocolo,
  proximoNumero,
} from '@sgh/contratos/regras-faturamento';

describe('protocolo', () => {
  it('normaliza CRLF, TAB e espaços', () => {
    expect(normalizarProtocolo(' 12345\r\n\t6 ')).toEqual({ ok: true, protocolo: '123456', limpou: true });
    expect(normalizarProtocolo('ABC-1')).toEqual({ ok: true, protocolo: 'ABC-1', limpou: false });
  });
  it.each([
    ['', 'protocolo-vazio'],
    [null, 'protocolo-vazio'],
    ['\r\n', 'protocolo-vazio'],
    ['1234567890123', 'protocolo-longo'],
    ['12…3', 'protocolo-caractere'],
    ['12\u00013', 'protocolo-caractere'],
  ])('%j é recusado (%s)', (v, codigo) => {
    const r = normalizarProtocolo(v as string | null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.recusa.codigo).toBe(codigo);
  });
  it('acentos Latin1 passam (cabem em 1 byte)', () => {
    expect(normalizarProtocolo('AÇÃO1').ok).toBe(true);
  });
  it('registrar sobre outro protocolo, limpar o vazio e limpar outro: recusados', () => {
    expect(conferirRegistroProtocolo('', 'registrar', 'X')).toBeNull();
    expect(conferirRegistroProtocolo('A', 'registrar', 'X')?.codigo).toBe('protocolo-ja-registrado');
    expect(conferirRegistroProtocolo('', 'limpar', 'X')?.codigo).toBe('lote-sem-protocolo');
    expect(conferirRegistroProtocolo('A', 'limpar', 'B')?.codigo).toBe('protocolo-diferente');
    expect(conferirRegistroProtocolo('A ', 'limpar', 'A')).toBeNull();
  });
  it('protocolo congela o lote; vazio não', () => {
    expect(loteCongelado('123')).toBe(true);
    expect(loteCongelado('')).toBe(false);
    expect(loteCongelado('  ')).toBe(false);
    expect(loteCongelado(null)).toBe(false);
  });
  it('próximo número do contador: 12 dígitos', () => {
    expect(proximoNumero('000000000041')).toBe('000000000042');
    expect(proximoNumero('')).toBe('000000000001');
    expect(proximoNumero(null)).toBe('000000000001');
    expect(() => proximoNumero('999999999999')).toThrow(/esgotado/);
    expect(() => proximoNumero('12A')).toThrow(/formato/);
  });
});
