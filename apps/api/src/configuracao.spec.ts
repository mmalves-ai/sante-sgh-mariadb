// F2-L: configuração da API sobre o ambiente do núcleo (porta, cliente de dev, arquivo de ambiente e recusa de
// partida sem neutralização). Valores sintéticos; nenhum arquivo real de ambiente é lido.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  aplicarArquivoAmbiente,
  lerConfiguracao,
  PORTA_API_PADRAO,
  recusaDePartida,
} from './configuracao.js';

const pasta = mkdtempSync(join(tmpdir(), 'sgh-cfg-'));
afterAll(() => rmSync(pasta, { recursive: true, force: true }));

describe('configuração da API', () => {
  it('porta padrão 3310 e API_PORTA lida', () => {
    expect(lerConfiguracao({}).portaApi).toBe(PORTA_API_PADRAO);
    expect(PORTA_API_PADRAO).toBe(3310);
    expect(lerConfiguracao({ API_PORTA: '3999' }).portaApi).toBe(3999);
    expect(() => lerConfiguracao({ API_PORTA: 'x' })).toThrow('API_PORTA');
  });

  it('CLIENTE_PADRAO no formato do núcleo', () => {
    expect(lerConfiguracao({ CLIENTE_PADRAO: 'teste_login' }).clientePadrao).toBe('teste_login');
    expect(lerConfiguracao({}).clientePadrao).toBeNull();
    expect(() => lerConfiguracao({ CLIENTE_PADRAO: 'Cliente-1' })).toThrow('CLIENTE_PADRAO');
  });

  it('o arquivo de ambiente só preenche o que falta no processo', () => {
    const arq = join(pasta, '.env');
    writeFileSync(arq, 'API_PORTA=3311\nMARCA=outra\n');
    const proc: Record<string, string | undefined> = { API_PORTA: '3310' };
    expect(aplicarArquivoAmbiente(proc, arq)).toBe(true);
    expect(proc).toEqual({ API_PORTA: '3310', MARCA: 'outra' });
    expect(aplicarArquivoAmbiente({}, join(pasta, 'nao-existe'))).toBe(false);
  });

  it('recusa a partida fora de produção sem neutralização, citando só a chave', () => {
    expect(recusaDePartida({ AMBIENTE: 'dev' })).toBeNull();
    const r = recusaDePartida({ AMBIENTE: 'dev', SMTP_HOST: 'smtp.exemplo-externo.com' });
    expect(r).toContain('SMTP_HOST');
    expect(r).not.toContain('exemplo-externo');
    expect(recusaDePartida({ AMBIENTE: 'producao', SMTP_HOST: 'smtp.exemplo-externo.com' })).toBeNull();
  });
});
