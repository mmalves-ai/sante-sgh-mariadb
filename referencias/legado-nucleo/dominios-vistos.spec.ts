// Regra 5 do M03: valor nunca visto numa coluna é recusado por padrão (cap-10 §10.4, Atenção;
// convencoes.md §5). O codec recusa valor fora da lista exportada pelo perfil (dominios-vistos.json).
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { ErroCodec } from './codec.js';
import { carregarDominiosVistos, DominiosVistos, type ArquivoDominiosVistos } from './dominios-vistos.js';

const pasta = mkdtempSync(join(tmpdir(), 'sgh-dominios-'));
afterAll(() => rmSync(pasta, { recursive: true, force: true }));

const exemplo: ArquivoDominiosVistos = {
  formato: 1,
  grupo: 'agenda',
  origem: { pc: 'janela 2025-10-01:2026-09-30' },
  colunas: {
    'TABELA_X.LIVRE': { valores: ['S', 'N'] },
    'TABELA_X.TIPO': { valores: ['0', '10', '20'], aConfirmar: true },
  },
};

describe('domínios vistos no codec', () => {
  it('aceita valor visto e recusa valor nunca visto', () => {
    const d = new DominiosVistos([exemplo]);
    expect(d.conferir('TABELA_X', 'LIVRE', 'S')).toBe('S');
    expect(d.conferir('tabela_x', 'livre', 'N  ')).toBe('N'); // CHAR com preenchimento
    expect(() => d.conferir('TABELA_X', 'LIVRE', 'T')).toThrow(ErroCodec);
    expect(d.conferir('TABELA_X', 'TIPO', 10)).toBe('10');
    expect(() => d.conferir('TABELA_X', 'TIPO', 30)).toThrow(/nunca visto/);
    expect(d.aConfirmar('TABELA_X', 'TIPO')).toBe(true);
    expect(d.aConfirmar('TABELA_X', 'LIVRE')).toBe(false);
  });

  it('coluna sem domínio exportado é recusada (falha fechada)', () => {
    const d = new DominiosVistos([exemplo]);
    expect(d.vistos('TABELA_X', 'OUTRA')).toBeNull();
    expect(() => d.conferir('TABELA_X', 'OUTRA', 'S')).toThrow(/sem domínio visto/);
  });

  it('junta arquivos de grupos e estabelecimentos; formato desconhecido é recusado', () => {
    const outro: ArquivoDominiosVistos = {
      ...exemplo,
      origem: { hs: 'janela' },
      colunas: { 'TABELA_X.LIVRE': { valores: ['X'] } },
    };
    const d = new DominiosVistos([exemplo, outro]);
    expect([...(d.vistos('TABELA_X', 'LIVRE') ?? [])].sort()).toEqual(['N', 'S', 'X']);
    expect(d.colunas).toEqual(['TABELA_X.LIVRE', 'TABELA_X.TIPO']);
    expect(() => new DominiosVistos([{ ...exemplo, formato: 2 as never }])).toThrow(ErroCodec);
  });

  it('carrega dominios-vistos.json de cada grupo', () => {
    mkdirSync(join(pasta, 'agenda', 'assinaturas'), { recursive: true });
    mkdirSync(join(pasta, 'vazio'), { recursive: true });
    writeFileSync(join(pasta, 'agenda', 'assinaturas', 'dominios-vistos.json'), JSON.stringify(exemplo));
    writeFileSync(join(pasta, 'solto.txt'), '');
    const d = carregarDominiosVistos(pasta);
    expect(() => d.conferir('TABELA_X', 'LIVRE', 'Z')).toThrow(ErroCodec);
  });

  it('a lista exportada pelo perfil do legado recusa valor fora dela', () => {
    // Arquivos reais do repositório (gerados por pnpm assinatura:perfil na cópia; só valores de domínio).
    const d = carregarDominiosVistos(resolve(import.meta.dirname, '..'));
    const colunas = d.colunas;
    expect(colunas.length).toBeGreaterThan(0);
    for (const k of colunas) {
      const [t = '', c = ''] = k.split('.');
      const vistos = [...(d.vistos(t, c) ?? [])];
      if (vistos[0] !== undefined) expect(d.conferir(t, c, vistos[0])).toBe(vistos[0]);
      expect(() => d.conferir(t, c, '¤valor-nunca-visto')).toThrow(ErroCodec);
    }
  });
});
