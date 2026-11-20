// Telas de coexistência (M02): só em dev, com o núcleo do legado; Problem Details nos erros.
import { esquemaEstabelecimentos, esquemaVerificacaoSchema } from '@sgh/contratos';
import { calcularImpressao, marcarSchema, type CatalogoLegado, type SaudeEstabelecimento } from '@sgh/legado';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { criarApp } from '../../app.js';
import { lerConfiguracao } from '../../configuracao.js';
import type { FonteCoexistencia } from './fonte.js';

const vazio: CatalogoLegado = {
  charset: 'NONE',
  versaoMotor: '3.0.14',
  tabelas: [{ nome: 'TBX', pk: [], colunas: [] }],
  visoes: [],
  triggers: [],
  procedimentos: [],
  generators: [],
  indices: [],
  restricoes: [],
  dominios: [],
  excecoes: [],
  funcoes: [],
};
const impPc = calcularImpressao('pc', vazio);
const impHs = calcularImpressao('hs', { ...vazio, tabelas: [] });

function fonte(): FonteCoexistencia & { verificados: string[] } {
  const marcaPc = marcarSchema('pc', impPc, impPc);
  const saude: SaudeEstabelecimento[] = [
    {
      codigo: 'pc',
      nomeConfigurado: 'Estabelecimento PC (exemplo)',
      disponivel: true,
      motivo: null,
      conectado: true,
      nomeConfere: true,
      identificacao: {
        nomeHospital: 'HOSPITAL EXEMPLO',
        cnesHospital: 1,
        razaoSocial: null,
        cnesEmpresa: null,
        unidades: [],
        unidadesCortadas: false,
      },
      sysdbaDev: false,
      schema: marcaPc,
    },
    {
      codigo: 'hs',
      nomeConfigurado: 'Estabelecimento HS (exemplo)',
      disponivel: false,
      motivo: 'Não conectou ao banco do estabelecimento.',
      conectado: false,
      nomeConfere: null,
      identificacao: null,
      sysdbaDev: false,
      schema: null,
    },
  ];
  const verificados: string[] = [];
  return {
    rede: 'rede-teste',
    estabelecimentos: [{ codigo: 'pc' }, { codigo: 'hs' }],
    verificados,
    saude: () => saude,
    estadosDosPools: () => [
      { estabelecimento: 'pc', abertas: 1, livres: 1, emUso: 0, esperando: 0, sysdbaDev: false },
    ],
    ultimaImpressao: (c) => (c === 'pc' ? impPc : c === 'hs' ? impHs : undefined),
    async verificarSchema(c) {
      verificados.push(c);
      return marcaPc;
    },
  };
}

let app: NestFastifyApplication | null = null;
async function subir(ambiente: string, f: FonteCoexistencia | null) {
  // M06: as rotas exigem sessão e permissão; em dev/ci, a sessão sintética (rede padrão no loopback).
  app = await criarApp(lerConfiguracao({ AMBIENTE: ambiente }), f, {
    AMBIENTE: ambiente,
    REDE_PADRAO: 'rede-teste',
  });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}
afterEach(async () => {
  await app?.close();
  app = null;
});

describe('coexistência com o legado (dev)', () => {
  it('GET /api/config/estabelecimentos lista os estabelecimentos da rede', async () => {
    const a = await subir('dev', fonte());
    const r = await a.inject({ method: 'GET', url: '/api/config/estabelecimentos' });
    expect(r.statusCode).toBe(200);
    const corpo = esquemaEstabelecimentos.parse(r.json());
    expect(corpo.rede).toBe('rede-teste');
    expect(corpo.estabelecimentos.map((e) => [e.codigo, e.disponivel, e.estadoSchema])).toEqual([
      ['pc', true, 'homologado'],
      ['hs', false, null],
    ]);
    expect(corpo.estabelecimentos[0]?.pool).toEqual({ abertas: 1, livres: 1, emUso: 0 });
    expect(corpo.estabelecimentos[0]?.nomeNoBanco).toBe('HOSPITAL EXEMPLO');
  });

  it('GET /api/config/schema traz as marcas e a comparação entre bancos', async () => {
    const a = await subir('dev', fonte());
    const r = await a.inject({ method: 'GET', url: '/api/config/schema' });
    const corpo = esquemaVerificacaoSchema.parse(r.json());
    expect(corpo.marcas.map((m) => m.estado)).toEqual(['homologado']);
    expect(corpo.entreBancos).toEqual([
      { a: 'pc', b: 'hs', iguais: false, resumo: expect.stringContaining('tabelas: 1 ausente') },
    ]);
  });

  it('POST /api/config/schema/verificar roda a verificação de todos', async () => {
    const f = fonte();
    const a = await subir('dev', f);
    const r = await a.inject({ method: 'POST', url: '/api/config/schema/verificar' });
    expect(r.statusCode).toBe(200);
    expect(f.verificados).toEqual(['pc', 'hs']);
  });
});

describe('fora de dev ou sem núcleo', () => {
  it('sem sessão (fora de dev/ci não há a sintética): 401 em Problem Details', async () => {
    const a = await subir('homolog', fonte());
    const r = await a.inject({ method: 'GET', url: '/api/config/schema' });
    expect(r.statusCode).toBe(401);
    expect(r.headers['content-type']).toMatch(/application\/problem\+json/);
  });

  it('sem núcleo: 503', async () => {
    const a = await subir('dev', null);
    const r = await a.inject({ method: 'GET', url: '/api/config/estabelecimentos' });
    expect(r.statusCode).toBe(503);
  });

  it('erro do legado: Problem Details sem mensagem crua', async () => {
    const f = fonte();
    f.verificarSchema = async () => {
      throw new Error('exception 3\n-E_SINTETICA\n-texto com dado sintético');
    };
    const a = await subir('dev', f);
    const r = await a.inject({ method: 'POST', url: '/api/config/schema/verificar' });
    expect(r.statusCode).toBe(409);
    expect(r.body).not.toMatch(/E_SINTETICA|sintético/);
    await a.close();
    const erro = await subir('dev', {
      ...fonte(),
      saude: () => {
        throw new Error('Dynamic SQL Error');
      },
    });
    const r2 = await erro.inject({ method: 'GET', url: '/api/config/schema' });
    expect(r2.statusCode).toBe(500);
    expect(r2.json()).toMatchObject({ codigo: 'erro-interno' });
  });
});
