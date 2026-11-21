// M54.5 pela HTTP, com a sessão real sobre a fonte sintética e a porta EM MEMÓRIA (nada conecta a banco): a apuração do
// custo do mês, a aprovação, o resultado e a exportação, cada rota pela permissão da opção do outro sistema. O analista
// (SINT.CUSTOS: Calcular itens de produção 319) apura e lê; o controller (SINT.CUSTOS.CONTROLLER: Manutenção 302,
// Utilitários 341, Comparativo faturamento 323) aprova, exporta e lê o resultado; quem só consulta o centro de custo
// (321) lê a apuração e não grava; sem opção de custos, nada. A chave `custos` está ligada na sessão sintética.
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../app.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../configuracao.js';
import { envTeste, SENHA } from '../../sessao/teste.spec-util.js';
import type { ContextoModulo } from '../registro.js';
import { moduloCustos, type OpcoesModuloCustos } from './modulo.js';
import {
  chavesIniciaisSinteticas,
  fonteConfiguracaoMemoria,
  parametrosIniciaisSinteticos,
  prerequisitosIniciaisSinteticos,
} from '../config/configuracao-fonte.js';
import { CHAVE_LIBERACAO_CUSTOS } from './custos.controller.js';
import { PortaCustosMemoria } from './porta-memoria.js';

const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev', API_MODULOS: 'custos' };
/** O módulo dos custos registrado com as opções do teste (o registro real é o do integrador da onda). */
const registro = (o: OpcoesModuloCustos = {}) => ({
  custos: async () => ({ modulo: (ctx: ContextoModulo) => moduloCustos(ctx, { pdf: null, ...o }) }),
});
let app: NestFastifyApplication;
const trilha = new RegistradorTrilhaMemoria();

beforeAll(async () => {
  app = await criarApp(lerConfiguracao(env), null, env, { trilha, registro: registro() });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
}, 120_000);
afterAll(async () => {
  await app.close();
});

const csrfDe = new Map<string, string>();
async function entrar(login: string, a: NestFastifyApplication = app): Promise<string> {
  const r = await a.inject({
    method: 'POST',
    url: '/api/sessao',
    payload: { estabelecimento: 'aa', login, senha: SENHA },
  });
  expect(r.statusCode).toBe(201);
  const set = (r.headers['set-cookie'] as string[] | undefined) ?? [];
  const cookie = set.map((c) => c.split(';')[0]).join('; ');
  csrfDe.set(
    cookie,
    set
      .find((c) => c.startsWith('sgh_csrf='))
      ?.split(';')[0]
      ?.slice(9) ?? '',
  );
  return cookie;
}
const get = (cookie: string, url: string, a: NestFastifyApplication = app) =>
  a.inject({ method: 'GET', url, headers: { cookie } });
const post = (cookie: string, url: string, payload: unknown, a: NestFastifyApplication = app) =>
  a.inject({
    method: 'POST',
    url,
    headers: { cookie, 'x-csrf': csrfDe.get(cookie) ?? '' },
    payload: payload as Record<string, unknown>,
  });

const P = '/api/custos';
const COMP = '2026-03';

/** A estrutura sintética completa: ADM → LAV → NUT → produtivos (UTI, CC, LAB), com as estatísticas do mês. */
async function prepararEstrutura(c: string, a: NestFastifyApplication = app): Promise<void> {
  const cls: [number, Record<string, unknown>][] = [
    [101, { classe: 'produtivo' }],
    [102, { classe: 'produtivo' }],
    [103, { classe: 'produtivo' }],
    [106, { classe: 'administrativo', ordemRateio: 1, criterio: 'requisicoes' }],
    [104, { classe: 'auxiliar', ordemRateio: 2, criterio: 'kgRoupa' }],
    [105, { classe: 'auxiliar', ordemRateio: 3, criterio: 'pacienteDia' }],
  ];
  for (const [id, corpo] of cls) {
    const r = await post(c, `${P}/centros/${id}`, { ...corpo, versao: null }, a);
    expect(r.statusCode, r.body).toBe(200);
  }
  expect((await post(c, `${P}/estatisticas/coleta`, { competencia: COMP }, a)).statusCode).toBe(201);
  for (const [centro, quantidade] of [
    [101, 300],
    [102, 100],
  ] as const) {
    const r = await post(
      c,
      `${P}/estatisticas/lancamentos`,
      { competencia: COMP, centro, codigo: 'kgRoupa', quantidade },
      a,
    );
    expect(r.statusCode, r.body).toBe(201);
  }
}

describe('apuração do custo do mês: cada rota pela sua permissão', { timeout: 180_000 }, () => {
  it('leituras: analista, controller e consulta abrem a apuração; o resultado só com a opção do resultado; sem custos, 403', async () => {
    for (const login of ['SINT.CUSTOS', 'SINT.CUSTOS.CONSULTA', 'SINT.CUSTOS.CONTROLLER']) {
      const c = await entrar(login);
      for (const url of [`${P}/apuracao/apoio`, `${P}/apuracao?competencia=${COMP}`])
        expect((await get(c, url)).statusCode, `${login} ${url}`).toBe(200);
    }
    const ctl = await entrar('SINT.CUSTOS.CONTROLLER');
    expect((await get(ctl, `${P}/resultado?competencia=${COMP}`)).statusCode).toBe(200);
    expect((await get(ctl, `${P}/resultado/contas?competencia=${COMP}`)).statusCode).toBe(200);
    const an = await entrar('SINT.CUSTOS');
    expect((await get(an, `${P}/resultado?competencia=${COMP}`)).statusCode).toBe(403);
    const sem = await entrar('SINT.ESOCIAL.CONSULTA');
    expect((await get(sem, `${P}/apuracao?competencia=${COMP}`)).statusCode).toBe(403);
    expect((await post(sem, `${P}/apuracao`, { competencia: COMP })).statusCode).toBe(403);
    const cons = await entrar('SINT.CUSTOS.CONSULTA');
    expect((await post(cons, `${P}/apuracao`, { competencia: COMP })).statusCode).toBe(403);
    expect(
      (await post(cons, `${P}/apuracao/exportacao`, { competencia: COMP, destino: 'apurasus' })).statusCode,
    ).toBe(403);
  });

  it('o apoio: grupos, destinos dos grupos de exportação e as ações de quem pode', async () => {
    const a = (await get(await entrar('SINT.CUSTOS.CONTROLLER'), `${P}/apuracao/apoio`)).json();
    expect(a).toMatchObject({
      liberacao: { ligada: true },
      acoes: { apurar: true, aprovar: true, exportar: true, resultado: true },
      limiteLinhaSaidaPadrao: 10_000_000,
    });
    expect(a.destinos.map((d: { valor: string; ativo: boolean }) => [d.valor, d.ativo])).toEqual([
      ['proprio', true],
      ['apurasus', true],
      ['federassantas', true],
    ]);
    const b = (await get(await entrar('SINT.CUSTOS'), `${P}/apuracao/apoio`)).json();
    expect(b.acoes).toEqual({ apurar: true, aprovar: false, exportar: false, resultado: false });
  });

  it('entrada inválida 400; competência futura 400; estrutura com pendência 422 sem gravar', async () => {
    const c = await entrar('SINT.CUSTOS');
    expect((await get(c, `${P}/apuracao?competencia=2026-13`)).statusCode).toBe(400);
    expect((await post(c, `${P}/apuracao`, { competencia: COMP, extra: 1 })).statusCode).toBe(400);
    expect((await post(c, `${P}/apuracao`, { competencia: '2099-01' })).statusCode).toBe(400);
    const r = await post(c, `${P}/apuracao`, { competencia: COMP });
    expect(r.statusCode).toBe(422);
    expect(r.json()).toMatchObject({ codigo: 'estrutura-pendente' });
    const painel = (await get(c, `${P}/apuracao?competencia=${COMP}`)).json();
    expect(painel).toMatchObject({ apuracao: null, historico: [] });
    expect(painel.bloqueios.length).toBeGreaterThan(0);
  });

  it('apurar → aprovar → reapurar com justificativa → exportar; resultado e contas; a trilha registra', async () => {
    const an = await entrar('SINT.CUSTOS');
    const ctl = await entrar('SINT.CUSTOS.CONTROLLER');
    await prepararEstrutura(an);

    const r = await post(an, `${P}/apuracao`, { competencia: COMP });
    expect(r.statusCode, r.body).toBe(201);
    const a = r.json();
    expect(a).toMatchObject({
      situacao: 'apurada',
      versao: 0,
      completude: { parcial: true, rotulo: 'parcial (sem pessoal)' },
    });
    expect(a.impressao).toMatch(/^[0-9a-f]{64}$/);
    expect(a.linhas.map((l: { centro: number }) => l.centro)).toEqual([106, 104, 105, 101, 102, 103]);
    // Conservação: o custo direto lido (com as despesas sem centro) chegou inteiro aos produtivos e às contas.
    expect(a.totais.diretoTotal).toBe(10_620_000);
    expect(a.totais.custoFinalProdutivos).toBe(10_620_000);
    expect(a.totais.custoNasContas).toBe(10_620_000);
    // As devoluções do mês saíram dos materiais (R$ 1.500,00); a da saída atípica fica fora, como ela.
    expect(a.totais.devolucoes).toEqual({
      linhas: 12,
      centavos: 150_000,
      linhasAtipicas: 1,
      centavosAtipicas: 1_000_000_000,
    });
    expect(a.totais.atipicas).toEqual({ linhas: 2, centavos: 12_000_000_000 });
    const prod = a.linhas.filter((l: { classe: string }) => l.classe === 'produtivo');
    for (const l of prod)
      expect(l.custoFinal).toBe(
        l.diretoTotal + l.recebidos.reduce((s: number, p: { centavos: number }) => s + p.centavos, 0),
      );
    expect(prod.find((l: { centro: number }) => l.centro === 101).producao.codigo).toBe('pacienteDia');
    expect(prod.find((l: { centro: number }) => l.centro === 102).producao.codigo).toBe('horasSala');
    expect(a.pendencias.map((p: { tipo: string }) => p.tipo)).toEqual(
      expect.arrayContaining(['despesas-sem-centro', 'linhas-atipicas', 'parcial']),
    );
    expect(trilha.eventos.some((l) => l.evento === 'custos.apuracao.apurada')).toBe(true);

    // Aprovar: o analista não aprova; versão velha 409; inexistente 404.
    expect((await post(an, `${P}/apuracao/${a.id}/aprovacao`, { versao: 0 })).statusCode).toBe(403);
    const velha = await post(ctl, `${P}/apuracao/${a.id}/aprovacao`, { versao: 5 });
    expect(velha.statusCode).toBe(409);
    expect(velha.json()).toMatchObject({ codigo: 'desatualizado' });
    expect((await post(ctl, `${P}/apuracao/99999/aprovacao`, { versao: 0 })).statusCode).toBe(404);
    const ok = await post(ctl, `${P}/apuracao/${a.id}/aprovacao`, { versao: 0 });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json()).toMatchObject({ situacao: 'aprovada', aprovadaPor: 'SINT.CUSTOS.CONTROLLER' });

    // Exportar a aprovada: ApuraSUS com os centros sem código avisados; só gerado (envio só em produção).
    const x = await post(ctl, `${P}/apuracao/exportacao`, { competencia: COMP, destino: 'apurasus' });
    expect(x.statusCode, x.body).toBe(200);
    const arq = x.json();
    expect(arq).toMatchObject({ destino: 'apurasus', linhas: 6, envio: 'somente-producao' });
    expect(arq.nomeArquivo).toBe('custos-apurasus-aa-2026-03-parcial.csv');
    expect(arq.semCodigo).toEqual([106, 104, 105, 103]);
    expect(arq.conteudo.split('\r\n')[0]).toMatch(/^COMPETENCIA;COD_CENTRO_APURASUS;/);
    expect(arq.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(trilha.eventos.some((l) => l.evento === 'custos.exportacao.gerada')).toBe(true);

    // Refazer a aprovada: o analista não pode; o controller só com justificativa; a impressão é a mesma (mesmos dados).
    expect((await post(an, `${P}/apuracao`, { competencia: COMP })).statusCode).toBe(403);
    const semJ = await post(ctl, `${P}/apuracao`, { competencia: COMP });
    expect(semJ.statusCode).toBe(422);
    expect(semJ.json()).toMatchObject({ codigo: 'justificativa-obrigatoria' });
    const nova = await post(ctl, `${P}/apuracao`, {
      competencia: COMP,
      justificativa: 'Estatística de roupa conferida.',
    });
    expect(nova.statusCode, nova.body).toBe(201);
    expect(nova.json().impressao).toBe(a.impressao);
    const painel = (await get(an, `${P}/apuracao?competencia=${COMP}`)).json();
    expect(painel.historico.map((h: { situacao: string }) => h.situacao)).toEqual(['apurada', 'substituida']);
    expect(painel.apuracao.justificativa).toBe('Estatística de roupa conferida.');
    // Relatório de custos: PDF/A pelo conversor do ambiente (o HTML, quando não há conversor); o conteúdo do HTML é
    // conferido em relatorio-custos.spec.ts.
    const rel = await get(an, `${P}/apuracao/relatorio?competencia=${COMP}`);
    expect(rel.statusCode, rel.body.slice(0, 300)).toBe(200);
    if (String(rel.headers['content-type']).startsWith('application/pdf')) {
      expect(rel.rawPayload.subarray(0, 5).toString('latin1')).toBe('%PDF-');
      expect(rel.headers['content-disposition']).toBe(`attachment; filename="relatorio-custos-${COMP}.pdf"`);
    } else {
      expect(rel.body).toContain('Relatório de custos do mês');
    }
    const naoAprov = await post(ctl, `${P}/apuracao/exportacao`, {
      competencia: COMP,
      destino: 'federassantas',
    });
    expect(naoAprov.statusCode).toBe(422);
    expect(naoAprov.json()).toMatchObject({ codigo: 'apuracao-nao-aprovada' });

    // Resultado: por convênio (nomes do cadastro), por unidade e os indicadores (Σ numeradores ÷ Σ denominadores).
    const conv = (await get(ctl, `${P}/resultado?competencia=${COMP}&agrupamento=convenio`)).json();
    expect(conv.apuracao).toMatchObject({ situacao: 'apurada', parcial: true });
    expect(conv.grupos.map((g: { rotulo: string }) => g.rotulo)).toEqual([
      'OPERADORA SINTETICA A',
      'CONVENIO PUBLICO SINTETICO',
      'OPERADORA SINTETICA B',
    ]);
    expect(conv.total.custo).toBe(10_620_000);
    expect(conv.total.contas).toBe(5);
    expect(conv.total.receitaLiquida).toBe(
      conv.grupos.reduce((s: number, g: { receitaLiquida: number }) => s + g.receitaLiquida, 0),
    );
    const uni = (await get(ctl, `${P}/resultado?competencia=${COMP}&agrupamento=centro`)).json();
    expect(uni.grupos.map((g: { chave: string }) => g.chave).sort()).toEqual(['101', '102', '103']);
    const pd = uni.indicadores.find((i: { codigo: string }) => i.codigo === 'custoPacienteDia');
    expect(pd.denominador).toBe(30_100);
    expect(pd.valor).toBe(Math.round((pd.numerador * 100) / pd.denominador));
    for (const ag of ['procedimento', 'tipoConta', 'paciente'])
      expect(
        (await get(ctl, `${P}/resultado?competencia=${COMP}&agrupamento=${ag}`)).json().total.custo,
      ).toBe(10_620_000);

    // Custo por paciente (D-PACIENTE-545): a soma das contas do prontuário na competência; só o número, nunca o nome.
    const pac = (await get(ctl, `${P}/resultado?competencia=${COMP}&agrupamento=paciente`)).json();
    expect(pac.agrupamento).toBe('paciente');
    expect(pac.total.contas).toBe(5);
    const doPaciente = pac.grupos.find((g: { chave: string }) => g.chave === '800001');
    expect(doPaciente).toMatchObject({ rotulo: 'Prontuário 800001', contas: 2 });
    expect(
      pac.grupos.every((g: { rotulo: string }) => /^Prontuário \d+$|^Sem prontuário$/.test(g.rotulo)),
    ).toBe(true);

    // Contas: as de menor margem primeiro; filtro por convênio, número, prontuário e só as negativas; o paciente só pelo
    // prontuário.
    const contas = (await get(ctl, `${P}/resultado/contas?competencia=${COMP}`)).json();
    expect(contas).toMatchObject({ total: 5, pagina: 1, tamanho: 50 });
    const margens = contas.contas.map((x: { margem: number }) => x.margem);
    expect(margens).toEqual([...margens].sort((p: number, q: number) => p - q));
    expect(Object.keys(contas.contas[0]).sort()).toEqual(
      [
        'conta',
        'convenio',
        'custo',
        'glosa',
        'margem',
        'margemPercentualCent',
        'numero',
        'parcelas',
        'procedimento',
        'prontuario',
        'receitaBruta',
        'receitaLiquida',
        'recurso',
        'tipoConta',
      ].sort(),
    );
    const c30 = (await get(ctl, `${P}/resultado/contas?competencia=${COMP}&convenio=30`)).json();
    expect(c30.contas.every((x: { convenio: number }) => x.convenio === 30)).toBe(true);
    const neg = (await get(ctl, `${P}/resultado/contas?competencia=${COMP}&negativas=sim`)).json();
    expect(neg.contas.every((x: { margem: number }) => x.margem < 0)).toBe(true);
    const doPront = (await get(ctl, `${P}/resultado/contas?competencia=${COMP}&prontuario=800001`)).json();
    expect(doPront.total).toBe(2);
    expect(doPront.contas.every((x: { prontuario: number }) => x.prontuario === 800001)).toBe(true);
    expect(doPront.contas.reduce((t: number, x: { custo: number }) => t + x.custo, 0)).toBe(doPaciente.custo);
    const umaConta = contas.contas[0] as { numero: number };
    const porNumero = (
      await get(ctl, `${P}/resultado/contas?competencia=${COMP}&numero=${umaConta.numero}`)
    ).json();
    expect(porNumero.contas.map((x: { numero: number }) => x.numero)).toEqual([umaConta.numero]);
    expect((await get(ctl, `${P}/resultado/contas?competencia=${COMP}&prontuario=abc`)).statusCode).toBe(400);
    expect((await get(ctl, `${P}/resultado/contas?competencia=${COMP}&numero=0`)).statusCode).toBe(400);
    expect((await get(ctl, `${P}/resultado/contas?competencia=${COMP}&pagina=0`)).statusCode).toBe(400);
  });

  it('competência sem apuração: resultado vazio e contas vazias', async () => {
    const ctl = await entrar('SINT.CUSTOS.CONTROLLER');
    const r = (await get(ctl, `${P}/resultado?competencia=2026-01`)).json();
    expect(r).toMatchObject({ apuracao: null, grupos: [], indicadores: [], total: { custo: 0 } });
    expect((await get(ctl, `${P}/resultado/contas?competencia=2026-01`)).json()).toMatchObject({
      total: 0,
      contas: [],
    });
    const x = await post(ctl, `${P}/apuracao/exportacao`, { competencia: '2026-01', destino: 'proprio' });
    expect(x.statusCode).toBe(422);
    expect((await get(ctl, `${P}/apuracao/relatorio?competencia=2026-01`)).statusCode).toBe(404);
    expect((await get(ctl, `${P}/apuracao/relatorio?competencia=2026-13`)).statusCode).toBe(400);
  });

  it('com a chave `custos` desligada (como no pc, POL-3): apurar, aprovar e exportar recusados sem gravar', async () => {
    const gravacoes: string[] = [];
    class PortaContada extends PortaCustosMemoria {
      override async gravarApuracao(...a: Parameters<PortaCustosMemoria['gravarApuracao']>) {
        gravacoes.push('apurar');
        return super.gravarApuracao(...a);
      }
      override async aprovarApuracao(...a: Parameters<PortaCustosMemoria['aprovarApuracao']>) {
        gravacoes.push('aprovar');
        return super.aprovarApuracao(...a);
      }
    }
    const trilhaB = new RegistradorTrilhaMemoria();
    const configuracao = fonteConfiguracaoMemoria(trilhaB, {
      chavesIniciais: () => chavesIniciaisSinteticas().filter((c) => c.chave !== CHAVE_LIBERACAO_CUSTOS),
      prerequisitosIniciais: prerequisitosIniciaisSinteticos,
      parametrosIniciais: parametrosIniciaisSinteticos,
    });
    const b = await criarApp(lerConfiguracao(env), null, env, {
      trilha: trilhaB,
      registro: registro({ configuracao, porta: new PortaContada() }),
    });
    await b.init();
    await b.getHttpAdapter().getInstance().ready();
    try {
      const c = await entrar('SINT.CUSTOS.CONTROLLER', b);
      const apoio = (await get(c, `${P}/apuracao/apoio`, b)).json();
      expect(apoio.liberacao).toMatchObject({ ligada: false });
      expect(apoio.acoes).toEqual({ apurar: false, aprovar: false, exportar: false, resultado: true });
      const recusas = [
        await post(c, `${P}/apuracao`, { competencia: COMP }, b),
        await post(c, `${P}/apuracao/1/aprovacao`, { versao: 0 }, b),
        await post(c, `${P}/apuracao/exportacao`, { competencia: COMP, destino: 'apurasus' }, b),
      ];
      for (const x of recusas) {
        expect(x.statusCode, x.body).toBe(403);
        expect(x.json().codigo).toBe('recurso-desligado');
      }
      expect(gravacoes).toEqual([]);
      expect((await get(c, `${P}/apuracao?competencia=${COMP}`, b)).statusCode).toBe(200);
    } finally {
      await b.close();
    }
  });
});
