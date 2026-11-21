import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { chavesDoRepositorio } from './repositorio.ts';
import {
  CAMPOS_ESTABELECIMENTO,
  conferirCatalogo,
  ehChaveDeEstabelecimento,
  GRUPOS,
  VARIAVEIS,
  varrerChaves,
} from './variaveis.ts';

const raiz = resolve(import.meta.dirname, '../../..');

describe('M60.2: catálogo das variáveis do arquivo de ambiente do servidor', () => {
  it('varre as formas de leitura do ambiente no código', () => {
    const t = `const a = env['A_UM']; const b = process.env.B_DOIS; x = process.env["C_TRES"];
      lerInteiroAmbiente(process.env, 'D_QUATRO', 1, 0, 9); const t = { x: ['FB_POOL_TETO', 1, 64] };
      linha['NAO_E_ENV']; meuenv['TAMBEM_NAO'];`;
    expect([...varrerChaves(t)].sort()).toEqual(['A_UM', 'B_DOIS', 'C_TRES', 'D_QUATRO', 'FB_POOL_TETO']);
  });

  it('acha a leitura indireta env[CONSTANTE] pela constante do mesmo arquivo (achado do ensaio)', () => {
    const t = `export const PARAMETRO_X = 'E_CINCO'; const v = env[PARAMETRO_X]; const w = env[SEM_DECLARACAO];`;
    expect([...varrerChaves(t)]).toEqual(['E_CINCO']);
  });

  it('toda chave lida pelo código de produção tem entrada (ou o motivo de não ir ao servidor), e nada obsoleto', () => {
    const r = conferirCatalogo(chavesDoRepositorio(raiz));
    expect(r.semEntrada).toEqual([]);
    expect(r.obsoletas).toEqual([]);
  });

  it('chaves únicas, grupo conhecido, segredo sempre com marcador no modelo', () => {
    const chaves = VARIAVEIS.map((v) => v.chave);
    expect(new Set(chaves).size).toBe(chaves.length);
    const grupos = new Set(GRUPOS.map((g) => g.grupo));
    for (const v of VARIAVEIS) {
      expect(grupos.has(v.grupo), v.chave).toBe(true);
      expect(v.descricao.length, v.chave).toBeGreaterThan(5);
      if (v.segredo && v.uso === 'obrigatoria') expect(v.exemplo, v.chave).toBe('<gerar>');
    }
  });

  it('a série por estabelecimento reconhece FB_<COD>_<CAMPO> e as três contas', () => {
    expect(ehChaveDeEstabelecimento('FB_PC_HOST')).toBe(true);
    expect(ehChaveDeEstabelecimento('FB_PC_SCRIPTS_SENHA')).toBe(true);
    expect(ehChaveDeEstabelecimento('FB_POOL_TETO')).toBe(false);
    const campos = CAMPOS_ESTABELECIMENTO.map((c) => c.campo);
    for (const c of ['USUARIO', 'SCRIPTS_USUARIO', 'LEITURA_USUARIO']) expect(campos).toContain(c);
  });
});
