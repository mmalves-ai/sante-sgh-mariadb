// M57 (etapa 3) pela HTTP, com a sessão real sobre a fonte sintética (nada conecta a banco): dois estabelecimentos
// SINTÉTICOS da rede com movimento diferente. A diretoria da Rede (só o perfil `diretoria-rede`) vê o consolidado com
// as parcelas e a conta, a série, a planilha e os painéis, e NÃO abre prontuário (regra 10); quem não tem o perfil não
// vê o BI; o registro dos serviços compartilhados grava no banco da sessão com a trilha; a média de taxas não aparece.
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../app.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../configuracao.js';
import { envTeste, SENHA } from '../../sessao/teste.spec-util.js';
import { FonteInternacaoMemoria } from '../internacao/fonte-memoria.js';
import { modulo as moduloInternacao } from '../internacao/modulo.js';
import { moduloRede } from '../rede/modulo.js';
import { PortaServicosRedeMemoria } from '../rede/servicos/porta-memoria.js';
import { moduloRelatorio } from './modulo.js';

const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev' };
const trilha = new RegistradorTrilhaMemoria();
const servicos = new PortaServicosRedeMemoria();
let app: NestFastifyApplication;

beforeAll(async () => {
  const comModulos = { ...env, API_MODULOS: 'relatorio,rede,internacao' };
  const fonte = new FonteInternacaoMemoria({ variantes: { bb: { semente: 2057, fator: 0.6 } } });
  app = await criarApp(lerConfiguracao(comModulos), null, comModulos, {
    trilha,
    registro: {
      relatorio: async () => ({ modulo: (ctx) => moduloRelatorio(ctx) }),
      rede: async () => ({ modulo: (ctx) => moduloRede(ctx, { servicos }) }),
      internacao: async () => ({ modulo: (ctx) => moduloInternacao(ctx, { fonte, vigia: null }) }),
    },
  });
  await app.init();
});
afterAll(async () => {
  await app.close();
});

interface Sessao {
  cookie: string;
  csrf: string;
}
async function entrar(login: string): Promise<Sessao> {
  const r = await app.inject({
    method: 'POST',
    url: '/api/sessao',
    payload: { estabelecimento: 'aa', login, senha: SENHA },
  });
  expect(r.statusCode).toBe(201);
  const set = r.headers['set-cookie'] as string[];
  const cookie = set.map((c) => c.split(';')[0]).join('; ');
  return { cookie, csrf: /sgh_csrf=([^;]+)/.exec(cookie)?.[1] ?? '' };
}
const get = (s: Sessao, url: string) => app.inject({ method: 'GET', url, headers: { cookie: s.cookie } });
const post = (s: Sessao, url: string, payload: unknown) =>
  app.inject({
    method: 'POST',
    url,
    payload: payload as Record<string, unknown>,
    headers: { cookie: s.cookie, 'x-csrf': s.csrf, 'idempotency-key': `t-${Math.random()}` },
  });

describe('BI consolidado da Rede (HTTP)', () => {
  let rede: Sessao;
  let diretoria: Sessao;
  beforeAll(async () => {
    rede = await entrar('SINT.DIRETORIA.REDE');
    diretoria = await entrar('SINT.DIRETORIA');
  });

  it('regra 10: a diretoria da Rede tem o BI e nenhuma permissão do prontuário; o prontuário nunca abre', async () => {
    const s = (await get(rede, '/api/sessao')).json() as { permissoes: string[] };
    expect(s.permissoes).toEqual(
      expect.arrayContaining(['relatorio.biRede.acessar', 'rede.servico.registrar']),
    );
    expect(s.permissoes.filter((p) => p.startsWith('pep.'))).toEqual([]);
    expect(s.permissoes).not.toContain('cadastro.paciente.ler');
    for (const url of ['/api/pep/paciente/1/cabecalho', '/api/pep/paciente/1/linha-do-tempo'])
      // 403 com o módulo do prontuário montado; nesta app (só relatorio, rede e internacao), a rota nem existe (404).
      expect([403, 404]).toContain((await get(rede, url)).statusCode);
  });

  it('o consolidado: os dois estabelecimentos, a soma dos numeradores sobre a dos denominadores e a conta', async () => {
    const r = await get(rede, '/api/relatorios/bi/rede?de=2025-01&ate=2025-06');
    expect(r.statusCode).toBe(200);
    const b = r.json();
    expect(b.periodo).toEqual({ de: '2025-01', ate: '2025-06' });
    expect(
      b.estabelecimentos.map((e: { codigo: string; situacao: string }) => [e.codigo, e.situacao]),
    ).toEqual([
      ['aa', 'incluido'],
      ['bb', 'incluido'],
    ]);
    expect(b.pseudonimo).toBe('por-estabelecimento');
    expect(b.notas.join(' ')).toMatch(/nunca a média das taxas/);
    const m = b.indicadores.find(
      (i: { ficha: { codigo: string } }) => i.ficha.codigo === 'taxaMortalidadeGeral',
    );
    expect(m.recusa).toBeNull();
    const u = m.ultimo;
    expect(u.periodo).toBe('2025-06');
    expect(u.parcelas.map((p: { estabelecimento: string }) => p.estabelecimento)).toEqual(['aa', 'bb']);
    const somaN = u.parcelas.reduce((a: number, p: { numerador: number }) => a + p.numerador, 0);
    const somaD = u.parcelas.reduce((a: number, p: { denominador: number }) => a + p.denominador, 0);
    expect(u.numerador).toBe(somaN);
    expect(u.denominador).toBe(somaD);
    expect(u.valor).toBe(Math.round((somaN / somaD) * 100 * 100) / 100);
    expect(u.conta).toMatch(/^\(\d+ \+ \d+\) ÷ \(\d+ \+ \d+\) × 100 = /);
    // Os dois estabelecimentos têm movimento diferente (a parcela de cada um não é igual).
    expect(u.parcelas[0].denominador).not.toBe(u.parcelas[1].denominador);
    // Nada de pessoa no consolidado.
    expect(JSON.stringify(b)).not.toMatch(/PACIENTE SINT|"nascimento"|"cpf"|"prontuario"|"paciente"/);
  });

  it('a série, a planilha com as parcelas e os painéis operacional e financeiro', async () => {
    const s = (
      await get(rede, '/api/relatorios/bi/rede/indicadores/admissoes?de=2025-01&ate=2025-03')
    ).json();
    expect(s.valores).toHaveLength(3);
    for (const v of s.valores) expect(v.numerador).toBe(v.parcelas[0].numerador + v.parcelas[1].numerador);
    const csv = await get(
      rede,
      '/api/relatorios/bi/rede/indicadores/admissoes/exportar?de=2025-01&ate=2025-03',
    );
    expect(csv.statusCode).toBe(200);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.body.split('\r\n')[0]).toMatch(/numerador Estabelecimento A/);
    expect(csv.body).toMatch(/"\d+ \+ \d+ = \d+"/);
    const op = (await get(rede, '/api/relatorios/bi/rede/paineis/operacional?de=2025-01&ate=2025-02')).json();
    const cir = op.series.find((x: { codigo: string }) => x.codigo === 'cirurgias');
    expect(cir.valores[0].valor).toBe(cir.parcelas[0].valores[0].valor + cir.parcelas[1].valores[0].valor);
    const fin = (await get(rede, '/api/relatorios/bi/rede/paineis/financeiro?de=2025-01&ate=2025-06')).json();
    const glosa = fin.series.find((x: { codigo: string }) => x.codigo === 'glosa-baixados');
    expect(glosa.recusa).toBeNull();
    const v = glosa.valores.at(-1);
    expect(v.numerador).toBeCloseTo(
      glosa.parcelas[0].valores.at(-1).numerador + glosa.parcelas[1].valores.at(-1).numerador,
      1,
    );
    expect((await get(rede, '/api/relatorios/bi/rede/paineis/assistencial')).statusCode).toBe(404);
    expect((await get(rede, '/api/relatorios/bi/rede/indicadores/naoExiste')).statusCode).toBe(404);
    expect((await get(rede, '/api/relatorios/bi/rede?de=2025-13')).statusCode).toBe(400);
    expect((await get(rede, '/api/relatorios/bi/rede?de=2025-06&ate=2025-01')).statusCode).toBe(400);
  });

  it('quem não tem o perfil da diretoria da Rede não vê o BI nem o registro', async () => {
    expect((await get(diretoria, '/api/relatorios/bi/rede')).statusCode).toBe(403);
    expect((await get(diretoria, '/api/rede/servicos')).statusCode).toBe(403);
  });

  it('serviços compartilhados: registrar no banco da sessão (com a trilha), listar, alterar, recusar fora da rede', async () => {
    const antes = trilha.eventos.length;
    const r = await post(rede, '/api/rede/servicos', {
      area: 'compras',
      titulo: 'Compra conjunta de material SINTETICO',
      descricao: 'Oportunidade sintética de teste',
      estabelecimentos: ['aa', 'bb'],
    });
    expect(r.statusCode).toBe(201);
    const x = r.json();
    expect(x).toMatchObject({
      estabelecimento: 'aa',
      situacao: 'registrada',
      registradoPor: 'SINT.DIRETORIA.REDE',
    });
    expect(trilha.eventos.slice(antes).map((e) => e.evento)).toContain('rede.servico.registrado');
    const l = (await get(rede, '/api/rede/servicos')).json();
    expect(l.total).toBe(1);
    expect(l.estabelecimentos.map((e: { codigo: string }) => e.codigo)).toEqual(['aa', 'bb']);
    const a = await post(rede, `/api/rede/servicos/aa/${x.id}`, { situacao: 'em_estudo' });
    expect(a.statusCode).toBe(200);
    expect(a.json()).toMatchObject({ mudou: true, registro: { situacao: 'em_estudo' } });
    expect(trilha.eventos.at(-1)?.evento).toBe('rede.servico.alterado');
    const repetido = await post(rede, `/api/rede/servicos/aa/${x.id}`, { situacao: 'em_estudo' });
    expect(repetido.json().mudou).toBe(false);
    expect((await post(rede, '/api/rede/servicos/aa/999', { situacao: 'adotada' })).statusCode).toBe(404);
    const fora = await post(rede, '/api/rede/servicos', {
      area: 'laudos',
      titulo: 'Laudo compartilhado SINTETICO',
      estabelecimentos: ['aa', 'zz'],
    });
    expect(fora.statusCode).toBe(400);
    expect((await post(rede, '/api/rede/servicos', { area: 'x', titulo: 'ab' })).statusCode).toBe(400);
    expect((await post(rede, '/api/rede/servicos/zz/1', { situacao: 'adotada' })).statusCode).toBe(403);
    expect(
      (
        await post(diretoria, '/api/rede/servicos', {
          area: 'outro',
          titulo: 'Nada SINTETICO',
          estabelecimentos: ['aa'],
        })
      ).statusCode,
    ).toBe(403);
  });

  it('banco de um estabelecimento fora do ar: a lista sai sem ele e diz quem ficou de fora', async () => {
    servicos.fora.add('bb');
    try {
      const l = (await get(rede, '/api/rede/servicos')).json();
      expect(l.foraDoAr).toEqual(['bb']);
    } finally {
      servicos.fora.delete('bb');
    }
  });
});
