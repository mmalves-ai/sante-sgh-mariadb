import { describe, expect, it } from 'vitest';
import { decodificarArquivo, lerArquivoOficial } from './arquivo.js';

describe('leitura do arquivo oficial (codificação)', () => {
  it('Latin-1/Windows-1252: os acentos ficam (nada de U+FFFD)', () => {
    // "0407040013CIRÚRGICO AÇÃO" em ISO-8859-1 (Ú = 0xDA, Ç = 0xC7, Ã = 0xC3).
    const latin1 = Uint8Array.from([
      ...Buffer.from('0407040013CIR', 'ascii'),
      0xda,
      ...Buffer.from('RGICO A', 'ascii'),
      0xc7,
      0xc3,
      ...Buffer.from('O', 'ascii'),
    ]);
    const r = decodificarArquivo(latin1);
    expect(r.charset).toBe('windows-1252');
    expect(r.texto).toBe('0407040013CIRÚRGICO AÇÃO');
    expect(r.texto).not.toContain('�');
  });
  it('UTF-8 (com e sem BOM) fica UTF-8', () => {
    const u = new TextEncoder().encode('CIRÚRGICO AÇÃO');
    expect(decodificarArquivo(u)).toEqual({ texto: 'CIRÚRGICO AÇÃO', charset: 'utf-8' });
    const comBom = Uint8Array.from([0xef, 0xbb, 0xbf, ...u]);
    expect(decodificarArquivo(comBom.buffer)).toEqual({ texto: 'CIRÚRGICO AÇÃO', charset: 'utf-8' });
  });
  it('lê o arquivo escolhido como bytes, com a codificação', async () => {
    const f = Object.assign(new Blob([Uint8Array.from([0x53, 0xc3, 0x4f])]), { name: 'tb_procedimento.txt' });
    expect(await lerArquivoOficial(f)).toEqual({
      nome: 'tb_procedimento.txt',
      conteudo: 'SÃO',
      charset: 'windows-1252',
    });
  });
});
