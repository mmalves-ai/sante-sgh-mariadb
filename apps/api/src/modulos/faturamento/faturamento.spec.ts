// M30 (conta do paciente, lançamentos e auditoria de contas) pela HTTP, com a sessão real sobre a fonte sintética e a
// porta EM MEMÓRIA (nada conecta a banco): permissões pelo perfil (403 sem elas), liberação (POL-3),
// situação derivada, explicação do preço, conferência em bloco, pendência bloqueante que impede o fechamento, fechamento
// com o pré-voo, reabertura recusada na apresentada, a fila tardia, o lançamento manual recusado pelo grupo fora da meta,
// o particular (orçamento, caixa, Pix simulado, recibo) e a urgência sem caução; textos de produto. Dados sintéticos.
// A app é a migrada (F2.2), com a configuração sintética e o módulo do faturamento registrados pelas opções do teste.
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../app.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../configuracao.js';
import { envTeste, SENHA } from '../../sessao/teste.spec-util.js';
import { moduloConfiguracaoDeTeste } from '../cadastro/teste.spec-util.js';
import { modulo } from './modulo.js';
import { PortaFaturamentoMemoria } from './porta-memoria.js';

const env: Record<string, string> = {
  ...envTeste,
  AMBIENTE: 'dev',
  API_MODULOS: 'configuracao_teste,faturamento',
};
const trilha = new RegistradorTrilhaMemoria();
const faturamento = new PortaFaturamentoMemoria({ estado: () => 'verde' });
let app: NestFastifyApplication;
let chave = 0;

beforeAll(async () => {
  app = await criarApp(lerConfiguracao(env), null, env, {
    trilha,
    registro: {
      configuracao_teste: async () => ({ modulo: (ctx) => moduloConfiguracaoDeTeste(ctx) }),
      faturamento: async () => ({ modulo: (ctx) => modulo(ctx, { porta: faturamento }) }),
    },
  });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
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
  return {
    cookie: set.map((c) => c.split(';')[0]).join('; '),
    csrf:
      set
        .find((c) => c.startsWith('sgh_csrf='))
        ?.split(';')[0]
        ?.slice(9) ?? '',
  };
}
const h = (s: Sessao) => ({
  cookie: s.cookie,
  'x-csrf': s.csrf,
  'idempotency-key': `teste-m30-${++chave}-${Date.now()}`,
});
const get = (s: Sessao, url: string) =>
  app.inject({ method: 'GET', url: `/api${url}`, headers: { cookie: s.cookie } });
const post = (s: Sessao, url: string, payload: unknown = {}) =>
  app.inject({ method: 'POST', url: `/api${url}`, headers: h(s), payload: payload as object });

const SISTEMA_ANTIGO = /SPDATA|legado|sistema antigo/i;

describe('conta do paciente pela HTTP (memória)', () => {
  it('sem as opções do faturamento, 403; o supervisor vê as funcionalidades ligadas', async () => {
    const outra = await entrar('SINT.AGENDA');
    expect((await get(outra, '/faturamento/contas')).statusCode).toBe(403);
    const s = await entrar('SINT.CONTAS');
    const g = (await get(s, '/faturamento/gravacao')).json();
    expect(g.funcionalidades.contas.ligada).toBe(true);
    expect(g.operacoes['faturamento.fecharConta'].ligada).toBe(true);
    expect(g.operacoes['faturamento.reabrirConta'].ligada).toBe(true);
    const caixa = await entrar('SINT.CAIXA');
    expect((await get(caixa, '/faturamento/contas')).statusCode).toBe(403);
  });

  it('lista por situação derivada, conta, itens com origem, explicação do preço e itens SUS', async () => {
    const s = await entrar('SINT.CONTAS');
    const l = (await get(s, '/faturamento/contas')).json();
    expect(l.regua).toBe('competencia');
    expect(l.contas.map((c: { id: number }) => c.id)).toEqual(
      expect.arrayContaining([9001, 9002, 9003, 9004]),
    );
    const emitidas = (await get(s, '/faturamento/contas?situacao=emitida')).json();
    expect(emitidas.contas.map((c: { id: number }) => c.id)).toContain(9001);
    const c = (await get(s, '/faturamento/contas/9001')).json();
    expect(c.situacao).toBe('emitida');
    expect(c.beneficiario.cpfMascarado).toMatch(/^\*\*\*/);
    expect(c.preVooFechamento).toBeNull();
    const it = (await get(s, '/faturamento/contas/9001/itens')).json();
    expect(it.total).toBe(5);
    expect(it.itens.find((i: { veio: string }) => i.veio === 'E').origemRotulo).toBe('Saída do estoque');
    const mat = it.itens.find((i: { tipo: number }) => i.tipo === 4);
    const x = (await get(s, `/faturamento/itens/${mat.id}/explicacao`)).json();
    expect(x.confere).toBe(true);
    expect(x.passos.map((p: { etapa: string }) => p.etapa)).toEqual([
      'contrato',
      'item',
      'faturabilidade',
      'base',
      'modificadores',
      'pacote',
      'arredondamento',
      'comparacao',
    ]);
    expect((await get(s, '/faturamento/contas/9001/sigtap')).json()).toHaveLength(3);
    expect(JSON.stringify(c)).not.toMatch(SISTEMA_ANTIGO);
  });

  it('conferência em bloco, pendência bloqueante, fechamento, reabertura recusada na apresentada e a fila tardia', async () => {
    const s = await entrar('SINT.CONTAS');
    const it = (await get(s, '/faturamento/contas/9001/itens')).json();
    const r = await post(s, '/faturamento/contas/9001/conferencia', {
      itens: it.itens.map((i: { id: number; versao: string }) => ({ id: i.id, versao: i.versao })),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().mensagem).toBe('5 itens conferidos.');
    const p = await post(s, '/faturamento/contas/9001/pendencias', {
      tipo: 1,
      descricao: 'Falta a assinatura do médico',
      bloqueante: true,
    });
    expect(p.statusCode).toBe(200);
    let c = (await get(s, '/faturamento/contas/9001')).json();
    expect(c.preVooFechamento.codigo).toBe('com-pendencia-bloqueante');
    const recusa = await post(s, '/faturamento/contas/9001/fechar', { versao: c.versao });
    expect(recusa.statusCode).toBe(409);
    expect(recusa.json().detail).toContain('pendência');
    expect(
      (
        await post(s, `/faturamento/pendencias/${p.json().ids.id}/resolver`, {
          resolucao: 'assinatura colhida',
        })
      ).statusCode,
    ).toBe(200);
    // Versão antiga: a conta mudou desde a leitura (a conferência recarimbou os itens, não a conta: a versão vale).
    c = (await get(s, '/faturamento/contas/9001')).json();
    const f = await post(s, '/faturamento/contas/9001/fechar', { versao: c.versao });
    expect(f.statusCode).toBe(200);
    expect(f.json().mensagem).toBe('Conta fechada.');
    expect((await post(s, '/faturamento/contas/9001/fechar', { versao: c.versao })).statusCode).toBe(409);
    const a = (await get(s, '/faturamento/contas/9003')).json();
    const ra = await post(s, '/faturamento/contas/9003/reabrir', {
      versao: a.versao,
      motivo: 'tentativa de reabrir a apresentada',
    });
    expect(ra.statusCode).toBe(409);
    expect(ra.json().detail).toContain('apresentada');
    const painel = (await get(s, '/faturamento/lancamentos/painel')).json();
    expect(painel.tardios.map((t: { registro: number }) => t.registro)).toContain(7001);
    const d = await post(s, '/faturamento/lancamentos/tardios/7001/decisao', {
      decisao: 'complementar',
      motivo: 'conta complementar a gerar',
    });
    expect(d.statusCode).toBe(200);
    expect(
      (
        await post(s, '/faturamento/lancamentos/tardios/7001/decisao', {
          decisao: 'descartar',
          motivo: 'repetida agora',
        })
      ).statusCode,
    ).toBe(409);
  });

  it('lançamento manual: grupo fora da meta recusado com a mensagem; preço manual exige a permissão', async () => {
    const s = await entrar('SINT.CONTAS');
    const hoje = (await get(s, '/faturamento/apoio')).json().hoje as string;
    const r = await post(s, '/faturamento/contas/9002/itens', {
      tipo: 3,
      codigo: 40302199,
      quantidade: 1,
      data: hoje,
      hora: '10:00',
      local: 1,
      ato: 15,
    });
    expect(r.statusCode).toBe(409);
    expect(r.json().detail).toContain('ainda não foi liberado');
    const sim = (
      await get(s, `/faturamento/simulador?convenio=91&tipo=3&codigo=40801012&quantidade=2&data=${hoje}`)
    ).json();
    expect(sim.preco).toMatchObject({ modelo: 'valor', unitario: 162.75, valor: 325.5 });
  });

  it('particular: orçamento, caixa, Pix simulado e recibo; urgência sem caução', async () => {
    const s = await entrar('SINT.CAIXA');
    const u = await post(s, '/faturamento/particular/orcamentos', {
      prontuario: 0,
      nome: 'PACIENTE SINTETICO PARTICULAR',
      itens: [{ descricao: 'Consulta sintética', quantidade: 1, unitario: 200 }],
      urgencia: true,
      exigeGarantiaAntes: true,
    });
    expect(u.statusCode).toBe(409);
    expect(u.json().detail).toContain('12.653');
    const o = await post(s, '/faturamento/particular/orcamentos', {
      prontuario: 0,
      nome: 'PACIENTE SINTETICO PARTICULAR',
      itens: [{ descricao: 'Consulta sintética', quantidade: 1, unitario: 200 }],
    });
    expect(o.statusCode).toBe(200);
    const cx = await post(s, '/faturamento/particular/caixas', { saldoInicial: 50 });
    expect(cx.statusCode).toBe(200);
    const rec = await post(s, '/faturamento/particular/recebimentos', {
      caixa: cx.json().ids.id,
      orcamento: o.json().ids.id,
      pagamentos: [{ forma: 'pix', valor: 200 }],
    });
    expect(rec.statusCode).toBe(200);
    expect(rec.json().avisos[0]).toContain('simulado');
    const r = await post(s, '/faturamento/particular/recibos', {
      pagamento: rec.json().ids.pagamento,
      pagador: 'PAGADOR SINTETICO',
      referente: 'Consulta sintética',
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().mensagem).toMatch(/^Recibo nº \d+ emitido\.$/);
    const orc = (await get(s, '/faturamento/particular/orcamentos')).json();
    expect(orc[0].situacao).toBe('pago');
    const f = await post(s, `/faturamento/particular/caixas/${cx.json().ids.id}/fechar`, { contado: 50 });
    expect(f.json().mensagem).toBe('Caixa fechado sem diferença.');
  });

  it('fila de trabalho do faturista: contas por situação e prazo', async () => {
    const s = await entrar('SINT.CONTAS');
    const w = (await get(s, '/faturamento/worklist')).json();
    expect(w.porSituacao.length).toBeGreaterThan(0);
    expect(w.porPrazo.length).toBeGreaterThan(0);
  });
});

describe('correções do M30 (memória)', () => {
  it('lista: situação sem filtro no banco recusada, idade desde a alta, convênio do escopo e o combo de convênios', async () => {
    const s = await entrar('SINT.CONTAS');
    const r = await get(s, '/faturamento/contas?situacao=protocolada');
    expect(r.statusCode).toBe(400);
    expect(r.json().codigo).toBe('situacao-nao-filtravel');
    const apoio = (await get(s, '/faturamento/apoio')).json();
    expect(apoio.situacoes).not.toContain('em-recurso');
    expect(apoio.convenios.map((c: { codigo: number }) => c.codigo)).toEqual(
      expect.arrayContaining([10, 91]),
    );
    // A alta das contas sintéticas é hoje: "há pelo menos 0 dias" traz; "há pelo menos 1 dia" não.
    expect((await get(s, '/faturamento/contas?altaDias=0')).json().total).toBeGreaterThan(0);
    expect((await get(s, '/faturamento/contas?altaDias=1')).json().total).toBe(0);
    const so91 = (await get(s, '/faturamento/contas?convenio=91')).json();
    expect(so91.contas.every((c: { convenio: number }) => c.convenio === 91)).toBe(true);
    expect(so91.contas.length).toBe(so91.total);
    const c10 = await entrar('SINT.CONTAS.C10');
    const a10 = (await get(c10, '/faturamento/apoio')).json();
    expect(a10.convenios.map((c: { codigo: number }) => c.codigo)).toEqual([10]);
    const l10 = (await get(c10, '/faturamento/contas?convenio=91')).json();
    expect(l10.total).toBe(0);
  });

  it('regra 13: resolver pendência de conta fora do escopo é 403 e não grava', async () => {
    const s = await entrar('SINT.CONTAS');
    const p = await post(s, '/faturamento/contas/9002/pendencias', {
      tipo: 2,
      descricao: 'Falta o laudo sintético',
      bloqueante: false,
    });
    expect(p.statusCode).toBe(200);
    const id = p.json().ids.id as number;
    const c10 = await entrar('SINT.CONTAS.C10');
    const r = await post(c10, `/faturamento/pendencias/${id}/resolver`, { resolucao: 'fora do meu escopo' });
    expect(r.statusCode).toBe(403);
    expect(JSON.stringify(r.json())).not.toContain('9002');
    const aud = (await get(s, '/faturamento/contas/9002/auditoria')).json();
    const x = aud.irregularidades.find((i: { id: number }) => i.id === id);
    expect(x).toMatchObject({
      aberta: true,
      nome: 'FALTA LAUDO (SINTETICA)',
      descricao: 'Falta o laudo sintético',
    });
    expect(
      (await post(c10, '/faturamento/pendencias/999999/resolver', { resolucao: 'inexistente' })).statusCode,
    ).toBe(404);
  });

  it('auditoria: as irregularidades são as da conta, não o catálogo de tipos', async () => {
    const s = await entrar('SINT.CONTAS');
    const aud = (await get(s, '/faturamento/contas/9004/auditoria')).json();
    expect(aud.irregularidades).toEqual([]);
  });

  it('fila tardia: uma ficha já decidida não reabre a conta (a conta fechada continua fechada)', async () => {
    const s = await entrar('SINT.CONTAS');
    const d = await post(s, '/faturamento/lancamentos/tardios/7002/decisao', {
      decisao: 'descartar',
      motivo: 'lançamento repetido',
    });
    expect(d.statusCode).toBe(200);
    const antes = (await get(s, '/faturamento/contas/9004')).json();
    const r = await post(s, '/faturamento/lancamentos/tardios/7002/decisao', {
      decisao: 'reabrir',
      motivo: 'segundo clique',
    });
    expect(r.statusCode).toBe(409);
    expect(r.json().codigo).toBe('ja-decidido');
    const depois = (await get(s, '/faturamento/contas/9004')).json();
    expect(depois.fechada).toBe('S');
    expect(depois.versao).toBe(antes.versao);
  });

  it('regra 12: o aprovador do preço manual é outro usuário real com a alçada', async () => {
    const s = await entrar('SINT.CONTAS');
    const hoje = (await get(s, '/faturamento/apoio')).json().hoje as string;
    const lancar = (aprovador: string) =>
      post(s, '/faturamento/contas/9002/itens', {
        tipo: 3,
        codigo: 40302199,
        quantidade: 1,
        data: hoje,
        hora: '10:00',
        local: 1,
        ato: 15,
        precoManual: { unitario: 999, justificativa: 'acordo com a operadora', aprovador },
      });
    const auto = await lancar('sint.contas');
    expect(auto.statusCode).toBe(409);
    expect(auto.json().codigo).toBe('autoaprovacao');
    const ninguem = await lancar('SINT.NINGUEM');
    expect(ninguem.json().codigo).toBe('aprovador-sem-alcada');
    const semAlcada = await lancar('SINT.CAIXA');
    expect(semAlcada.json().codigo).toBe('aprovador-sem-alcada');
    // Aprovador válido: segue até a próxima regra (o grupo ainda fora da meta da reprodução).
    const ok = await lancar('SINT.CONTAS.C10');
    expect(ok.json().codigo).toBe('grupo-nao-liberado');
  });

  it('particular: recebimento contra conta de convênio recusado; fora do escopo, 403', async () => {
    const caixa = await entrar('SINT.CAIXA');
    const cx = await post(caixa, '/faturamento/particular/caixas', { saldoInicial: 0 });
    expect(cx.statusCode).toBe(200);
    const r = await post(caixa, '/faturamento/particular/recebimentos', {
      caixa: cx.json().ids.id,
      conta: 9001,
      pagamentos: [{ forma: 'dinheiro', valor: 10 }],
    });
    expect(r.statusCode).toBe(409);
    expect(r.json().codigo).toBe('conta-nao-particular');
    const c10 = await entrar('SINT.CONTAS.C10');
    const f = await post(c10, '/faturamento/particular/recebimentos', {
      caixa: cx.json().ids.id,
      conta: 9002,
      pagamentos: [{ forma: 'dinheiro', valor: 10 }],
    });
    expect(f.statusCode).toBe(403);
    expect(
      (await post(caixa, `/faturamento/particular/caixas/${cx.json().ids.id}/fechar`, { contado: 0 }))
        .statusCode,
    ).toBe(200);
  });

  it('pagamentos: filtro por forma e situação no servidor', async () => {
    const caixa = await entrar('SINT.CAIXA');
    const pix = (await get(caixa, '/faturamento/particular/pagamentos?forma=pix')).json();
    expect(pix.length).toBeGreaterThan(0);
    expect(pix.every((p: { forma: string }) => p.forma === 'pix')).toBe(true);
    expect((await get(caixa, '/faturamento/particular/pagamentos?situacao=estornado')).json()).toEqual([]);
    expect((await get(caixa, '/faturamento/particular/pagamentos?pagina=50')).json()).toEqual([]);
  });

  it('textos: os avisos da fila tardia não mandam fazer fora', async () => {
    const s = await entrar('SINT.CONTAS');
    const painel = (await get(s, '/faturamento/lancamentos/painel')).json();
    expect(JSON.stringify(painel)).not.toMatch(/sistema atual|outro sistema|sistema em uso/i);
  });
});
