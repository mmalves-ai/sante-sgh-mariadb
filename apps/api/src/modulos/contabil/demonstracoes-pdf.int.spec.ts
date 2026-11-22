// As demonstrações em PDF/A (ficha do M54, seção 10, "Documento: balancete, DRE (...) em PDF/A"): o balancete, o
// diário, a DRE e o balanço de um exercício sintético pela rota da exportação (sessão real sobre a fonte sintética e a
// porta em memória), convertidos pelo Gotenberg do projeto e conferidos no veraPDF (PDF/A-2b, 0 regra com falha), por
// imagem Docker sem rede. Sem o Gotenberg, o teste é pulado (a HTTP prova o 503 com o motivo). Dados SINTÉTICOS.
import { rmSync } from 'node:fs';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../app.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../configuracao.js';
import { envTeste, SENHA } from '../../sessao/teste.spec-util.js';
import { gotenbergDisponivel } from '../documento/infra/gotenberg.js';
import { pastaTemporaria, verapdf } from '../documento/integracao.spec-util.js';
import { type ContextoModulo, REGISTRO_MODULOS } from '../registro.js';
import { moduloContabil } from './modulo.js';
import type { PortaContabil } from './porta.js';
import { PortaContabilMemoria } from './porta-memoria.js';

/** O módulo da contabilidade registrado com a porta do teste (o registro real é o do integrador da onda). */
const registroContabil = (p: PortaContabil) => ({
  ...REGISTRO_MODULOS,
  contabil: async () => ({ modulo: (ctx: ContextoModulo) => moduloContabil(ctx, { porta: p }) }),
});

const GOTENBERG = process.env['GOTENBERG_URL']?.trim() || 'http://127.0.0.1:3318';
const disponivel = await gotenbergDisponivel(GOTENBERG);
const env: Record<string, string> = {
  ...envTeste,
  API_MODULOS: 'config,contabil',
  AMBIENTE: 'dev',
  GOTENBERG_URL: GOTENBERG,
};

describe.skipIf(!disponivel)('demonstrações contábeis em PDF/A (veraPDF)', () => {
  let app: NestFastifyApplication;
  const pasta = pastaTemporaria('demonstracoes-');
  const porta = new PortaContabilMemoria();
  porta.hojeFixo = '2026-11-10';
  beforeAll(async () => {
    app = await criarApp(lerConfiguracao(env), null, env, {
      trilha: new RegistradorTrilhaMemoria(),
      registro: registroContabil(porta),
    });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });
  afterAll(async () => {
    await app?.close();
    rmSync(pasta, { recursive: true, force: true });
  });

  let n = 0;
  async function entrar(login: string) {
    const r = await app.inject({
      method: 'POST',
      url: '/api/sessao',
      payload: { estabelecimento: 'aa', login, senha: SENHA },
    });
    const set = r.headers['set-cookie'] as string[];
    const cookie = set.map((c) => c.split(';')[0]).join('; ');
    const csrf =
      set
        .find((c) => c.startsWith('sgh_csrf='))
        ?.split(';')[0]
        ?.slice(9) ?? '';
    const h = () => ({ cookie, 'x-csrf': csrf, 'idempotency-key': `pdf-m54-3-${++n}-${Date.now()}` });
    return {
      get: (url: string) => app.inject({ method: 'GET', url, headers: { cookie } }),
      post: (url: string, payload: object) => app.inject({ method: 'POST', url, headers: h(), payload }),
      put: (url: string, payload: object) => app.inject({ method: 'PUT', url, headers: h(), payload }),
    };
  }

  it('balancete, diário, DRE e balanço saem em PDF/A-2b sem falha no veraPDF', async () => {
    const admin = await entrar('SINT.ADMIN');
    const pre = await admin.put('/api/administracao/liberacao/prerequisitos', {
      recurso: 'contabil',
      tipo: 'aprovacao',
      situacao: 'cumprido',
      validade: '2099-12-31',
      evidencia: 'competência sintética conferida',
      senha: SENHA,
    });
    expect(pre.statusCode, pre.body).toBe(200);
    const lig = await admin.post('/api/administracao/liberacao', {
      chave: 'contabil',
      tipo: 'recurso',
      escopo: 'hospital',
      valores: ['*'],
      ligar: true,
      justificativa: 'ligação sintética de teste da contabilidade',
      senha: SENHA,
    });
    expect(lig.statusCode, lig.body).toBe(200);
    const c = await entrar('SINT.CONTADOR');
    const l = await c.post('/api/contabil/lancamentos/manual', {
      empresa: 1,
      data: '2025-03-10',
      historico: 'Lançamento sintético',
      idempotencia: '6f1c2d3e-4a5b-4c6d-8e7f-00112233a0f1',
      partidas: [
        { lado: 'D', conta: '1.1.2.01.0001', valorCentavos: 100_000, centroCusto: null },
        { lado: 'C', conta: '3.1.1.01.0001', valorCentavos: 100_000, centroCusto: 12 },
      ],
    });
    expect(l.statusCode, l.body).toBe(200);

    const arquivos: Record<string, Uint8Array> = {};
    for (const [nome, q] of [
      ['balancete.pdf', 'tipo=balancete&de=2025-01&ate=2025-12'],
      ['diario.pdf', 'tipo=diario&de=2025-01-01&ate=2025-12-31'],
      ['dre.pdf', 'tipo=dre&de=2025-01&ate=2025-12'],
      ['balanco.pdf', 'tipo=balanco&competencia=2025-12'],
    ] as const) {
      const r = await c.get(`/api/contabil/demonstracoes/exportar?empresa=1&formato=pdf&${q}`);
      expect(r.statusCode, r.body).toBe(200);
      expect(r.headers['content-type']).toContain('application/pdf');
      const pdf = new Uint8Array(r.rawPayload);
      expect(Buffer.from(pdf.subarray(0, 5)).toString('latin1')).toBe('%PDF-');
      arquivos[nome] = pdf;
    }
    const v = verapdf(pasta, arquivos);
    console.log(
      `[veraPDF] ${v.map((x) => `${x.arquivo}: ${x.conforme ? 'PASS' : 'FAIL'} (${x.regrasFalhas})`).join('; ')}`,
    );
    expect(v).toHaveLength(4);
    for (const x of v) expect(x).toMatchObject({ conforme: true, regrasFalhas: 0 });
  }, 240_000);
});
