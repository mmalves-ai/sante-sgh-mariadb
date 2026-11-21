// M35: a aba "Prontidão por setor" e a carga somada da tela de conexões leem o relatório gerado pelo
// `pnpm prontidao:relatorio` (só leitura; nenhum acesso ao banco). Arquivo ausente ou fora do esquema: null.
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { esquemaRelatorioProntidao } from '@sgh/contratos';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { criarApp } from '../../app.js';
import { lerConfiguracao } from '../../configuracao.js';
import { registroComConfig } from './modulo-teste.spec-util.js';
import { caminhoProntidao, fonteArquivoProntidao } from './prontidao.js';

const raiz = resolve(import.meta.dirname, '../../../../..');
const tmp = mkdtempSync(join(tmpdir(), 'sgh-api-prontidao-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
const ENV_DEV = { AMBIENTE: 'dev', REDE_PADRAO: 'rede-teste', API_MODULOS: 'config' };

let app: NestFastifyApplication | null = null;
afterEach(async () => {
  await app?.close();
  app = null;
});

const carga = {
  cenario: 'carga-somada',
  executadoEm: '2026-10-23T00:00:00.000Z',
  usuarios: 400,
  resultado: 'verde',
  indicativo: true,
  jornadas: [{ jornada: 'login', p95Ms: 12, metaMs: 2000, atendida: true }],
  outroSistema: [],
  mon: { transacaoMaisLongaMs: 80, acimaDoLimite: 0, escritas: 0 },
  arquivo: 'docs/marcos/M35/carga-carga-somada.json',
};
const relatorio = {
  formato: 1,
  geradoEm: '2026-10-23T00:00:00.000Z',
  estados: { verde: 1 },
  liberadas: 0,
  hospitais: [],
  carga,
};

describe('fonte do relatório de prontidão', () => {
  it('caminho padrão no repositório; SGH_PRONTIDAO muda; ausente ou inválido dá null', () => {
    expect(caminhoProntidao('/r', {})).toBe('/r/docs/prontidao/prontidao.json');
    expect(caminhoProntidao('/r', { SGH_PRONTIDAO: 'x.json' })).toBe('/r/x.json');
    expect(fonteArquivoProntidao(join(tmp, 'nao-existe.json')).relatorio()).toBeNull();
    const ruim = join(tmp, 'ruim.json');
    writeFileSync(ruim, '{"formato":2}');
    expect(fonteArquivoProntidao(ruim).relatorio()).toBeNull();
  });

  // O relatório versionado era gerado na cópia do sistema de origem (convivência, ADR 0003): não existe neste repositório.
  // Quando gerado aqui, passa no esquema; sem ele, a fonte devolve null.
  it('o relatório do repositório: ausente, null; gerado, passa no esquema', () => {
    const caminho = caminhoProntidao(raiz, {});
    const r = fonteArquivoProntidao(caminho).relatorio();
    if (!existsSync(caminho)) {
      expect(r).toBeNull();
      return;
    }
    expect(esquemaRelatorioProntidao.parse(r).formato).toBe(1);
  });
});

describe('GET /api/config/prontidao e /api/config/carga', () => {
  it('devolve o relatório e a carga somada (sessão sintética de dev com as permissões)', async () => {
    const arquivo = join(tmp, 'prontidao.json');
    writeFileSync(arquivo, JSON.stringify(relatorio));
    app = await criarApp(lerConfiguracao({ AMBIENTE: 'dev' }), null, ENV_DEV, {
      registro: registroComConfig({ prontidao: fonteArquivoProntidao(arquivo) }),
    });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    const r = await app.inject({ method: 'GET', url: '/api/config/prontidao' });
    expect(r.statusCode).toBe(200);
    expect(r.json().relatorio.carga.cenario).toBe('carga-somada');
    const c = await app.inject({ method: 'GET', url: '/api/config/carga' });
    expect(c.statusCode).toBe(200);
    expect(c.json()).toEqual({ carga });
  });

  it('sem relatório gerado: relatorio e carga nulos', async () => {
    app = await criarApp(lerConfiguracao({ AMBIENTE: 'dev' }), null, ENV_DEV, {
      registro: registroComConfig({ prontidao: fonteArquivoProntidao(join(tmp, 'ausente.json')) }),
    });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    expect((await app.inject({ method: 'GET', url: '/api/config/prontidao' })).json()).toEqual({
      relatorio: null,
    });
    expect((await app.inject({ method: 'GET', url: '/api/config/carga' })).json()).toEqual({ carga: null });
  });
});
