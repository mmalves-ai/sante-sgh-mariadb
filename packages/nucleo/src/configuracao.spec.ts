import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ambienteEfetivo, caminhoArquivoAmbiente, raizDoProjeto } from './ambiente.js';
import { PADROES, lerConfiguracaoNucleo } from './configuracao.js';
import { ErroConfiguracao } from './erros.js';
import { opcoesDoPool } from './pool.js';

describe('configuração do núcleo', () => {
  it('usa os padrões de desenvolvimento e esconde a senha', () => {
    const c = lerConfiguracaoNucleo({ MARIADB_SENHA: 'SENHA-QUE-NAO-APARECE' });
    expect(c).toMatchObject({
      host: '127.0.0.1',
      porta: 3410,
      usuario: 'root',
      bancoPlataforma: 'plataforma',
    });
    expect(c.senha).toBe('SENHA-QUE-NAO-APARECE');
    expect(JSON.stringify(c)).not.toContain('SENHA-QUE-NAO-APARECE');
    expect(Object.keys(c)).not.toContain('senha');
    expect(c.tetoLinhas).toBe(PADROES.tetoLinhas);
  });

  it('lê as chaves e recusa valor fora da faixa citando só a chave', () => {
    const c = lerConfiguracaoNucleo({
      MARIADB_SENHA: '<senha-de-teste>',
      MARIADB_PORTA: '3999',
      SGH_MARIADB_POOL_TETO: '8',
    });
    expect(c.porta).toBe(3999);
    expect(c.tetoPorBanco).toBe(8);
    expect(() => lerConfiguracaoNucleo({ MARIADB_SENHA: 'x', SGH_TRAVA_ESPERA_S: '999' })).toThrow(
      /SGH_TRAVA_ESPERA_S/,
    );
    expect(() => lerConfiguracaoNucleo({})).toThrow(ErroConfiguracao);
    expect(() => lerConfiguracaoNucleo({ MARIADB_SENHA: 'x', SGH_BANCO_PLATAFORMA: 'a;b' })).toThrow(
      /SGH_BANCO_PLATAFORMA/,
    );
  });

  it('opções do pool: UTC, BIGINT como number, DECIMAL como texto, trava da sessão', () => {
    const o = opcoesDoPool(lerConfiguracaoNucleo({ MARIADB_SENHA: 'x' }), 'cliente_a');
    expect(o).toMatchObject({
      database: 'cliente_a',
      timezone: 'Z',
      bigIntAsNumber: true,
      decimalAsNumber: false,
    });
    expect(o.initSql).toContain('SET SESSION innodb_lock_wait_timeout = 5');
    expect(() => opcoesDoPool(lerConfiguracaoNucleo({ MARIADB_SENHA: 'x' }), 'x`y')).toThrow(
      ErroConfiguracao,
    );
  });
});

describe('arquivo de ambiente', () => {
  it('o processo vale sobre o arquivo; arquivo ausente não é erro', () => {
    const pasta = mkdtempSync(join(tmpdir(), 'nucleo-amb-'));
    try {
      const arq = join(pasta, '.env');
      writeFileSync(arq, 'A=do-arquivo\nB=do-arquivo\n');
      const { env, carregado } = ambienteEfetivo({ B: 'do-processo' }, arq);
      expect(carregado).toBe(true);
      expect(env['A']).toBe('do-arquivo');
      expect(env['B']).toBe('do-processo');
      expect(ambienteEfetivo({}, join(pasta, 'nao-existe')).carregado).toBe(false);
      expect(caminhoArquivoAmbiente({ SGH_ARQUIVO_AMBIENTE: 'x.env' }, pasta)).toBe(join(pasta, 'x.env'));
    } finally {
      rmSync(pasta, { recursive: true, force: true });
    }
  });

  it('acha a raiz do projeto pelo pnpm-workspace.yaml', () => {
    const raiz = raizDoProjeto(import.meta.dirname);
    expect(raiz).not.toBeNull();
    expect(caminhoArquivoAmbiente({}, import.meta.dirname)).toBe(join(raiz ?? '', '.env'));
  });
});
