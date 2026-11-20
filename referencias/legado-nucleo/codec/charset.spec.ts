import { describe, expect, it } from 'vitest';
import {
  charsetDoBanco,
  charsetTextoDe,
  conferirCharsetPartida,
  ErroCharset,
  lerCharsetTexto,
  limparCharsetsTexto,
  registrarCharsetTexto,
} from './charset.js';
import type { Leitor } from '../transacao.js';

const leitor = (cs: unknown, valor: unknown | Error): Leitor => ({
  hospital: 'pc',
  consultar: (sql: string) => {
    if (sql.includes('RDB$DATABASE')) return Promise.resolve([{ CS: cs }]) as never;
    if (valor instanceof Error) return Promise.reject(valor);
    return Promise.resolve(valor === undefined ? [] : [{ V: valor }]) as never;
  },
  lerBlob: () => Promise.resolve(Buffer.alloc(0)),
});

describe('charset do texto por estabelecimento (M58-F3, regra 6)', () => {
  it('NONE e WIN1252 pedem CP1252; UTF8 pede UTF8; o resto não é suportado', () => {
    expect(charsetDoBanco(' none ')).toBe('CP1252');
    expect(charsetDoBanco('WIN1252')).toBe('CP1252');
    expect(charsetDoBanco('UTF8')).toBe('UTF8');
    expect(charsetDoBanco('ISO8859_1')).toBeNull();
  });

  it('a partida recusa o desencontro e o charset desconhecido', () => {
    expect(conferirCharsetPartida('NONE', 'CP1252')).toBe('CP1252');
    expect(conferirCharsetPartida('UTF8', 'UTF8')).toBe('UTF8');
    expect(() => conferirCharsetPartida('UTF8', 'CP1252')).toThrow(ErroCharset);
    expect(() => conferirCharsetPartida('NONE', 'UTF8')).toThrow(/legado\.charset/);
    expect(() => conferirCharsetPartida('ISO8859_1', 'CP1252')).toThrow(/não suportado/);
  });

  it('registro por estabelecimento; sem registro, CP1252', () => {
    limparCharsetsTexto();
    expect(charsetTextoDe('pc')).toBe('CP1252');
    registrarCharsetTexto('pc', 'UTF8');
    expect(charsetTextoDe('pc')).toBe('UTF8');
    expect(charsetTextoDe('hs')).toBe('CP1252');
    expect(charsetTextoDe(null)).toBe('CP1252');
    limparCharsetsTexto();
  });

  it('lê o banco e o parâmetro; tabela SGH_ ausente vale o padrão; valor fora da lista é recusado', async () => {
    expect(await lerCharsetTexto(leitor('UTF8', 'UTF8'))).toEqual({
      charsetBanco: 'UTF8',
      parametro: 'UTF8',
    });
    expect(await lerCharsetTexto(leitor('NONE', '"CP1252"'))).toEqual({
      charsetBanco: 'NONE',
      parametro: 'CP1252',
    });
    expect(await lerCharsetTexto(leitor(null, undefined))).toEqual({
      charsetBanco: 'NONE',
      parametro: 'CP1252',
    });
    expect(await lerCharsetTexto(leitor('NONE', new Error('Table unknown')))).toEqual({
      charsetBanco: 'NONE',
      parametro: 'CP1252',
    });
    await expect(lerCharsetTexto(leitor('NONE', 'LATIN1'))).rejects.toThrow(ErroCharset);
  });
});
