// Contratualização SUS pela HTTP (M55, fatia F5; ficha, seções 4, 7 e 8; regra 11): a sessão real sobre a fonte
// sintética e a contratualização EM MEMÓRIA (nada conecta a banco; dados SINTÉTICOS: os domínios com os códigos do
// sistema anterior, 4 procedimentos SIGTAP e a produção das contas SUS de 12 competências), o relógio fixo em
// 2026-07-10 (competência 202607); a chave `contratualizacao` desligada pelo administrador num app à parte.
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../app.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../configuracao.js';
import { envTeste, SENHA } from '../../sessao/teste.spec-util.js';
import {
  chavesIniciaisSinteticas,
  fonteConfiguracaoMemoria,
  parametrosIniciaisSinteticos,
  prerequisitosIniciaisSinteticos,
} from '../config/configuracao-fonte.js';
import { dominiosComRotulo } from './contratualizacao.controller.js';
import { moduloContratualizacao } from './modulo.js';
import { PortaContratualizacaoMemoria } from './porta-memoria.js';

const R = '/api/faturamento/sus/contratualizacao';
interface Sessao {
  cookie: string;
  csrf: string;
}

async function montar(o: { desligada?: boolean } = {}) {
  const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev', API_MODULOS: 'contratualizacao' };
  const trilha = new RegistradorTrilhaMemoria();
  const porta = new PortaContratualizacaoMemoria(() => ({ hoje: '2026-07-10', competencia: '202607' }));
  const configuracao = o.desligada
    ? fonteConfiguracaoMemoria(trilha, {
        chavesIniciais: () => chavesIniciaisSinteticas().filter((c) => c.chave !== 'contratualizacao'),
        prerequisitosIniciais: prerequisitosIniciaisSinteticos,
        parametrosIniciais: parametrosIniciaisSinteticos,
      })
    : undefined;
  const app: NestFastifyApplication = await criarApp(lerConfiguracao(env), null, env, {
    trilha,
    registro: {
      contratualizacao: async () => ({
        modulo: (ctx) => moduloContratualizacao(ctx, { porta, ...(configuracao ? { configuracao } : {}) }),
      }),
    },
  });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  let seq = 0;
  const novaChave = () => `teste-m555-${++seq}-${Date.now()}`;
  return {
    app,
    trilha,
    novaChave,
    async entrar(login: string): Promise<Sessao> {
      const r = await app.inject({
        method: 'POST',
        url: '/api/sessao',
        payload: { estabelecimento: 'aa', login, senha: SENHA },
      });
      expect(r.statusCode).toBe(201);
      const set = r.headers['set-cookie'] as string[];
      return {
        cookie: set.map((c) => c.split(';')[0]).join('; '),
        csrf:
          set
            .find((c) => c.startsWith('sgh_csrf='))
            ?.split(';')[0]
            ?.slice(9) ?? '',
      };
    },
    get: (s: Sessao, url: string) =>
      app.inject({ method: 'GET', url: `${R}${url}`, headers: { cookie: s.cookie } }),
    /** Com a chave no corpo e no cabeçalho (o encerramento não leva chave no corpo). */
    enviar(
      s: Sessao,
      metodo: 'POST' | 'PUT',
      url: string,
      payload: Record<string, unknown>,
      o2: { chave?: string; semChaveNoCorpo?: boolean } = {},
    ) {
      const k = o2.chave ?? novaChave();
      return app.inject({
        method: metodo,
        url: `${R}${url}`,
        headers: { cookie: s.cookie, 'x-csrf': s.csrf, 'idempotency-key': k },
        payload: o2.semChaveNoCorpo ? payload : { ...payload, chave: k },
      });
    },
    fechar: () => app.close(),
  };
}
type App = Awaited<ReturnType<typeof montar>>;

const CONTRATO = {
  numero: 'SINT-SUS-001/2026',
  esfera: 3,
  gestor: 'Secretaria Municipal de Saúde (sintética)',
  objeto: 'Prestação de serviços hospitalares e ambulatoriais ao SUS',
  inicio: '2026-01-01',
  fim: '2026-12-31',
  cnes: '0000001',
  habilitacao: 'Habilitação sintética em cardiologia',
  redeAssistencia: 2,
  valorPreMensalCentavos: 1_000_000,
  valorPosMensalCentavos: 400_000,
  parteQualitativaPct: 40,
  incentivos: [{ nome: 'Incentivo sintético', valorMensalCentavos: 50_000, inicio: '2026-01-01' }],
};
const QUANTI = {
  tipo: 'quantitativa',
  descricao: 'Consultas especializadas',
  periodicidade: 10,
  inicio: '202601',
  pontos: 10,
  nivelSigtap: 'subgrupo',
  codigoSigtap: '0301',
  modalidade: 'ambulatorial',
  complexidade: 3,
  valorMeta: 150,
};
const QUALI = {
  tipo: 'qualitativa',
  descricao: 'Comissão de óbitos atuante',
  periodicidade: 10,
  inicio: '202601',
  pontos: 10,
  indicador: 4,
  formato: 2,
  sentido: 'maior',
  afericao: 1,
  valorMeta: 1,
};

let a: App;
let analista: Sessao;
let consulta: Sessao;
let sem: Sessao;

beforeAll(async () => {
  a = await montar();
  [analista, consulta, sem] = await Promise.all([
    a.entrar('SINT.CONTRATUALIZACAO'),
    a.entrar('SINT.CONTRATUALIZACAO.CONSULTA'),
    a.entrar('SINT.ESOCIAL.CONSULTA'),
  ]);
});
afterAll(async () => {
  await a?.fechar();
});

describe('contratualização SUS pela HTTP', () => {
  it('o painel: domínios com rótulos do produto, faixas, fonte e gravação; só com a permissão de leitura', async () => {
    const r = await a.get(consulta, '');
    expect(r.statusCode).toBe(200);
    const b = r.json();
    expect(b.competencia).toBe('202607');
    expect(b.fonte).toBe('contas-sus');
    expect(b.parametros).toMatchObject({ faixasValidas: true, conveniosSus: [1] });
    expect(b.parametros.faixas).toHaveLength(4);
    expect(b.dominios.CMTPAFERICAO[0]).toEqual({
      codigo: 1,
      rotulo: 'Sistema de gestão do hospital',
      sigla: null,
    });
    expect(JSON.stringify(b.dominios)).not.toMatch(/sp\s*data/i);
    expect(b.gravacao.ligada).toBe(true);
    expect(b.gravacao.operacoes.editar.pode).toBe(false);
    expect((await a.get(analista, '')).json().gravacao.operacoes.editar.pode).toBe(true);
    expect((await a.get(sem, '')).statusCode).toBe(403);
  });

  it('as listas saem com o rótulo do produto na chave que a tela lê; sem vocabulário, o nome gravado', () => {
    const d = dominiosComRotulo({
      tipo_afericao: [{ codigo: 1, nome: 'Nome gravado qualquer', sigla: null }],
      incentivo: [{ codigo: 7, nome: 'Incentivo de teste', sigla: null }],
    } as never);
    expect(d['CMTPAFERICAO']?.[0]?.rotulo).toBe('Sistema de gestão do hospital');
    expect(d['CMINCENTIVO']?.[0]).toEqual({ codigo: 7, rotulo: 'Incentivo de teste', sigla: null });
  });

  it('contrato → metas → painel com a produção das contas SUS → apuração → painel com o repasse, com as parcelas', async () => {
    const chave = a.novaChave();
    const c = await a.enviar(analista, 'POST', '/contratos', CONTRATO, { chave });
    expect(c.statusCode).toBe(201);
    const idC = c.json().id as number;
    const rep = await a.enviar(analista, 'POST', '/contratos', CONTRATO, { chave });
    expect(rep.json()).toMatchObject({ id: idC, repetida: true });
    expect((await a.enviar(analista, 'POST', '/contratos', CONTRATO)).json().codigo).toBe('numero-duplicado');
    expect((await a.enviar(consulta, 'POST', '/contratos', { ...CONTRATO, numero: 'X-1' })).statusCode).toBe(
      403,
    );

    const m1 = await a.enviar(analista, 'POST', `/contratos/${idC}/metas`, QUANTI);
    expect(m1.statusCode).toBe(201);
    const m2 = await a.enviar(analista, 'POST', `/contratos/${idC}/metas`, QUALI);
    expect(m2.statusCode).toBe(201);
    const ruim = await a.enviar(analista, 'POST', `/contratos/${idC}/metas`, {
      ...QUANTI,
      codigoSigtap: '0909',
    });
    expect([ruim.statusCode, ruim.json().codigo]).toEqual([409, 'sigtap-inexistente']);
    const sub = await a.enviar(analista, 'POST', `/contratos/${idC}/metas`, { ...QUANTI, periodicidade: 8 });
    expect(sub.json().codigo).toBe('periodicidade-submensal');

    const det = (await a.get(consulta, `/contratos/${idC}`)).json();
    expect(det.metas.map((m: { tipo: string }) => m.tipo)).toEqual(['qualitativa', 'quantitativa']);
    expect(det.requisitos).toEqual([]);

    const p1 = (await a.get(consulta, `/contratos/${idC}/painel?competencia=202606`)).json();
    const q1 = p1.resultados.find((r: { tipo: string }) => r.tipo === 'quantitativa');
    // Abril a junho: 100 + 90 + 110 (0301010072) + 40 × 3 (0301060029) = 420 de 450.
    expect(q1).toMatchObject({
      metaPeriodo: 450,
      realizado: 420,
      cumprimentoPct: 93.33,
      escore: 3,
      apurada: false,
    });
    expect(q1.conta[0]).toBe('meta do período = 150 por competência × 3 = 450');
    expect(p1.repasse.totalEstimadoCentavos).toBeNull();

    const idQuali = m2.json().id as number;
    const idQuanti = m1.json().id as number;
    const cedo = await a.enviar(analista, 'POST', `/metas/${idQuali}/apuracoes`, {
      competencia: '202609',
      realizado: 1,
    });
    expect(cedo.json().codigo).toBe('competencia-futura');
    const aq = await a.enviar(analista, 'POST', `/metas/${idQuali}/apuracoes`, {
      competencia: '202606',
      realizado: 1,
    });
    expect(aq.statusCode).toBe(201);
    expect(aq.json().apuracao).toMatchObject({ cumprimentoPct: 100, escore: 4, origem: 'informado' });
    const an = await a.enviar(analista, 'POST', `/metas/${idQuanti}/apuracoes`, { competencia: '202606' });
    expect(an.json().apuracao).toMatchObject({ realizado: 420, escore: 3, origem: 'contas-sus' });
    const dup = await a.enviar(analista, 'POST', `/metas/${idQuanti}/apuracoes`, { competencia: '202606' });
    expect(dup.json().codigo).toBe('apuracao-repetida');
    const corr = await a.enviar(analista, 'POST', `/metas/${idQuanti}/apuracoes`, {
      competencia: '202606',
      versaoVista: 1,
      observacao: 'Reapurada',
    });
    expect(corr.json()).toMatchObject({ versao: 2, mensagem: 'Apuração do período corrigida.' });

    const p2 = (await a.get(consulta, `/contratos/${idC}/painel?competencia=202605`)).json();
    expect(p2.resultados.every((r: { apurada: boolean }) => r.apurada)).toBe(true);
    // O painel devolve a versão da apuração registrada: é a versaoVista que a tela envia para corrigi-la.
    const rq = p2.resultados.find((r: { meta: number }) => r.meta === idQuanti);
    expect(rq.apuracaoRegistrada).toMatchObject({ versao: 2, observacao: 'Reapurada' });
    // Quantitativa: 10 × 93,33% = 9,33 de 10 → faixa ≥ 85%: 90% de R$ 6.000,00; qualitativa: 10 de 10 → 100% de R$ 4.000.
    expect(p2.repasse.partes.map((x: { repasseCentavos: number }) => x.repasseCentavos)).toEqual([
      540_000, 400_000,
    ]);
    expect(p2.repasse.totalEstimadoCentavos).toBe(990_000);
    expect(p2.repasse.conta).toContain(
      'total estimado = R$ 5.400,00 + R$ 4.000,00 + R$ 500,00 = R$ 9.900,00',
    );
    expect((await a.get(consulta, `/contratos/${idC}/painel?competencia=2026`)).statusCode).toBe(400);
  });

  it('alteração e encerramento pela versão; contrato encerrado não recebe meta nem apuração', async () => {
    const c = await a.enviar(analista, 'POST', '/contratos', { ...CONTRATO, numero: 'SINT-SUS-002/2026' });
    const id = c.json().id as number;
    const velho = await a.enviar(analista, 'PUT', `/contratos/${id}`, {
      ...CONTRATO,
      numero: 'SINT-SUS-002/2026',
      versaoVista: 7,
    });
    expect(velho.json().codigo).toBe('versao-desatualizada');
    const m = await a.enviar(analista, 'POST', `/contratos/${id}/metas`, QUANTI);
    const encurta = await a.enviar(analista, 'PUT', `/contratos/${id}`, {
      ...CONTRATO,
      numero: 'SINT-SUS-002/2026',
      inicio: '2026-03-01',
      incentivos: [],
      versaoVista: 1,
    });
    expect(encurta.json().codigo).toBe('meta-fora-da-vigencia');
    const ok = await a.enviar(analista, 'PUT', `/contratos/${id}`, {
      ...CONTRATO,
      numero: 'SINT-SUS-002/2026',
      habilitacao: null,
      versaoVista: 1,
    });
    expect(ok.json()).toMatchObject({ versao: 2 });
    const semHab = await a.enviar(analista, 'POST', `/metas/${m.json().id}/apuracoes`, {
      competencia: '202603',
    });
    expect(semHab.json().codigo).toBe('habilitacao-ausente');
    expect(
      (await a.get(consulta, `/contratos/${id}`)).json().requisitos.map((r: { codigo: string }) => r.codigo),
    ).toEqual(['habilitacao-ausente']);
    const fim = await a.enviar(
      analista,
      'POST',
      `/contratos/${id}/encerramento`,
      { versaoVista: 2, motivo: 'Fim do contrato sintético' },
      { semChaveNoCorpo: true },
    );
    expect(fim.json()).toMatchObject({ versao: 3 });
    expect((await a.enviar(analista, 'POST', `/contratos/${id}/metas`, QUALI)).json().codigo).toBe(
      'contrato-encerrado',
    );
    const outra = await a.enviar(analista, 'PUT', `/metas/${m.json().id}`, { ...QUALI, versaoVista: 1 });
    expect(outra.json()).toMatchObject({ codigo: 'campos-de-outro-tipo', campos: ['tipo'] });
    expect((await a.get(consulta, '/contratos/999999')).statusCode).toBe(404);
  });

  it('a busca SIGTAP e as entradas inválidas', async () => {
    const r = await a.get(consulta, '/sigtap?termo=0301');
    expect(r.json().itens.map((x: { codigo: string }) => x.codigo)).toEqual(['0301010072', '0301060029']);
    expect((await a.get(consulta, '/sigtap?termo=x')).statusCode).toBe(400);
    const semChave = await a.app.inject({
      method: 'POST',
      url: `${R}/contratos`,
      headers: { cookie: analista.cookie, 'x-csrf': analista.csrf },
      payload: { ...CONTRATO, numero: 'SINT-X', chave: 'chave-sem-cabecalho' },
    });
    expect(semChave.statusCode).toBe(400);
  });
});

describe('contratualização SUS desligada', () => {
  let b: App;
  let s: Sessao;
  beforeAll(async () => {
    b = await montar({ desligada: true });
    s = await b.entrar('SINT.CONTRATUALIZACAO');
  });
  afterAll(async () => {
    await b?.fechar();
  });
  it('lê, mas não grava; a tela recebe o motivo', async () => {
    const p = (await b.get(s, '')).json();
    expect(p.gravacao.ligada).toBe(false);
    expect(p.gravacao.motivo).toBeTruthy();
    const r = await b.enviar(s, 'POST', '/contratos', CONTRATO);
    expect([r.statusCode, r.json().codigo]).toEqual([403, 'recurso-desligado']);
  });
});
