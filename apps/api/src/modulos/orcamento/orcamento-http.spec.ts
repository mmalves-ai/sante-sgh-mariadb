// M54.7 pela HTTP, com a sessão real sobre a fonte sintética e a porta EM MEMÓRIA (nada conecta a banco): cada rota do
// orçamento empresarial pela permissão da opção do outro sistema (Gestão de orçamento, 584 a 594). SINT.ORCAMENTO monta
// a versão; SINT.ORCAMENTO.APROVA aprova a que outra pessoa montou (segregação); SINT.ORCAMENTO.CONSULTA (só o
// Comparativo, 594) lê e não grava; quem não tem opção de orçamento não abre nada. A chave `orcamento` está ligada na
// sessão sintética; sem ela, a gravação é recusada (POL-3).
import { Module } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../app.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../configuracao.js';
import { ArmazemMemoria } from '../../sessao/armazem.js';
import { envTeste, SENHA } from '../../sessao/teste.spec-util.js';
import { CACHE_CONFIG, CacheConfig, FONTE_CONFIGURACAO } from '../config/public-api.js';
import {
  chavesIniciaisSinteticas,
  fonteConfiguracaoMemoria,
  parametrosIniciaisSinteticos,
  prerequisitosIniciaisSinteticos,
} from '../config/configuracao-fonte.js';
import { moduloConfiguracaoDeTeste, registroDeTeste } from '../cadastro/teste.spec-util.js';
import { modulo as moduloOrcamento } from './modulo.js';
import { CHAVE_LIBERACAO_ORCAMENTO } from './orcamento.controller.js';
import { PortaOrcamentoMemoria, realizadoSintetico } from './porta-memoria.js';

/** A configuração com a chave `orcamento` desligada (a segunda app do teste). */
@Module({})
class ConfiguracaoDesligada {}

const env: Record<string, string> = {
  ...envTeste,
  AMBIENTE: 'dev',
  API_MODULOS: 'configuracao_teste,cadastro,orcamento',
};
let app: NestFastifyApplication;
const trilha = new RegistradorTrilhaMemoria();

beforeAll(async () => {
  app = await criarApp(lerConfiguracao(env), null, env, {
    trilha,
    registro: registroDeTeste(
      {},
      {
        configuracao_teste: (ctx) => moduloConfiguracaoDeTeste(ctx),
        orcamento: (ctx) => moduloOrcamento(ctx, { porta: new PortaOrcamentoMemoria() }),
      },
    ),
  });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
}, 120_000);
afterAll(async () => {
  await app.close();
});

const csrfDe = new Map<string, string>();
async function entrar(login: string): Promise<string> {
  const r = await app.inject({
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
const get = (cookie: string, url: string) => app.inject({ method: 'GET', url, headers: { cookie } });
const post = (cookie: string, url: string, payload: unknown) =>
  app.inject({
    method: 'POST',
    url,
    headers: { cookie, 'x-csrf': csrfDe.get(cookie) ?? '' },
    payload: payload as Record<string, unknown>,
  });

const P = '/api/financeiro/orcamento';
const doze = (v: number) => Array.from({ length: 12 }, () => v);

describe('orçamento empresarial: cada rota pela sua permissão', { timeout: 180_000 }, () => {
  it('leituras: quem monta, quem aprova e a consulta abrem; sem opção de orçamento, 403', async () => {
    for (const login of ['SINT.ORCAMENTO', 'SINT.ORCAMENTO.APROVA', 'SINT.ORCAMENTO.CONSULTA']) {
      const c = await entrar(login);
      for (const url of [`${P}/apoio`, `${P}/versoes`, `${P}/versoes?ano=2026`])
        expect((await get(c, url)).statusCode, `${login} ${url}`).toBe(200);
    }
    // Só a opção Orçamento (587): monta e aprova, então também lê (abre a tela e lista as versões).
    const so587 = await entrar('SINT.ORCAMENTO.SO587');
    for (const url of [`${P}/apoio`, `${P}/versoes`, `${P}/versoes?ano=2026`])
      expect((await get(so587, url)).statusCode, `SINT.ORCAMENTO.SO587 ${url}`).toBe(200);
    expect((await get(so587, `${P}/apoio`)).json().acoes).toEqual({ editar: true, aprovar: true });
    // Empresa que não existe no estabelecimento: recusada, nada criado.
    const outra = await post(await entrar('SINT.ORCAMENTO'), `${P}/versoes`, {
      ano: 2031,
      empresa: 2,
      descricao: 'Outra empresa',
    });
    expect(outra.statusCode).toBe(409);
    expect(outra.json().codigo).toBe('empresa-inexistente');
    expect((await get(so587, `${P}/versoes?ano=2031`)).json().versoes).toEqual([]);
    const sem = await entrar('SINT.CUSTOS');
    expect((await get(sem, `${P}/apoio`)).statusCode).toBe(403);
    expect((await get(sem, `${P}/versoes`)).statusCode).toBe(403);
    expect((await post(sem, `${P}/versoes`, { ano: 2026, descricao: 'Teste' })).statusCode).toBe(403);
  });

  it('o apoio: naturezas, centros, itens com a natureza do grupo, parâmetros e as ações de quem pode', async () => {
    const a = (await get(await entrar('SINT.ORCAMENTO'), `${P}/apoio`)).json();
    expect(a.naturezas.map((n: { codigo: string }) => n.codigo)).toEqual(['despesa', 'receita', 'consumo']);
    expect(a.centros.length).toBeGreaterThan(3);
    expect(a.itens.find((i: { grupo: number }) => i.grupo === 100).natureza).toBe('receita');
    expect(a.parametros).toMatchObject({ digitaCentro: true, regime: null });
    expect(a).toMatchObject({ chaveLigada: true, acoes: { editar: true, aprovar: true } });
    const consulta = (await get(await entrar('SINT.ORCAMENTO.CONSULTA'), `${P}/apoio`)).json();
    expect(consulta.acoes).toEqual({ editar: false, aprovar: false });
  });

  it('fluxo: criar, lançar, segregação na aprovação, aprovar por outra pessoa, comparativo com as parcelas', async () => {
    const autor = await entrar('SINT.ORCAMENTO');
    const aprovador = await entrar('SINT.ORCAMENTO.APROVA');
    const consulta = await entrar('SINT.ORCAMENTO.CONSULTA');
    // A consulta não cria.
    expect((await post(consulta, `${P}/versoes`, { ano: 2026, descricao: 'Não pode' })).statusCode).toBe(403);
    const r = await post(autor, `${P}/versoes`, { ano: 2026, descricao: 'Orçamento 2026' });
    expect(r.statusCode, r.body).toBe(201);
    const { id, numero } = r.json();
    expect(numero).toBe(1);
    let d = (await get(autor, `${P}/versoes/${id}`)).json();
    expect(d.orcamento).toMatchObject({ situacao: 'rascunho', linhas: 0, versao: 0 });
    expect(d.acoes).toMatchObject({ editar: true, aprovar: false });
    // Linha inválida: item de receita lançado como despesa; consumo sem centro.
    const ruim = await post(autor, `${P}/versoes/${id}/linhas`, {
      versao: 0,
      linhas: [
        { natureza: 'despesa', centro: 101, grupo: 100, subgrupo: 1, item: 1, meses: doze(1) },
        { natureza: 'consumo', centro: 0, grupo: 0, subgrupo: 0, item: 0, meses: doze(1) },
      ],
    });
    expect(ruim.statusCode).toBe(400);
    expect(ruim.json().bloqueios).toHaveLength(2);
    // Valor negativo e 11 meses: o esquema recusa.
    expect(
      (
        await post(autor, `${P}/versoes/${id}/linhas`, {
          versao: 0,
          linhas: [
            { natureza: 'despesa', centro: 101, grupo: 210, subgrupo: 1, item: 1, meses: doze(1).slice(1) },
          ],
        })
      ).statusCode,
    ).toBe(400);
    const linhas = [
      { natureza: 'despesa', centro: 0, grupo: 210, subgrupo: 1, item: 1, meses: doze(4_000_000) },
      { natureza: 'despesa', centro: 101, grupo: 230, subgrupo: 1, item: 1, meses: doze(150_000) },
      { natureza: 'receita', centro: 0, grupo: 100, subgrupo: 1, item: 1, meses: doze(2_600_000) },
      { natureza: 'consumo', centro: 101, grupo: 0, subgrupo: 0, item: 0, meses: doze(750_000) },
    ];
    const g = await post(autor, `${P}/versoes/${id}/linhas`, { versao: 0, linhas });
    expect(g.statusCode, g.body).toBe(200);
    expect(g.json()).toMatchObject({ versao: 1, mudou: true, incluidas: 4, totalAntes: 0 });
    expect(g.json().totalDepois).toBe(12 * (4_000_000 + 150_000 + 2_600_000 + 750_000));
    // A mesma gravação de novo não grava; a versão velha é recusada.
    expect((await post(autor, `${P}/versoes/${id}/linhas`, { versao: 1, linhas })).json()).toMatchObject({
      mudou: false,
      versao: 1,
    });
    const velha = await post(autor, `${P}/versoes/${id}/linhas`, { versao: 0, linhas });
    expect(velha.statusCode).toBe(409);
    expect(velha.json().codigo).toBe('desatualizado');
    // Quem montou não aprova (segregação de funções).
    d = (await get(autor, `${P}/versoes/${id}`)).json();
    expect(d.acoes.aprovar).toBe(false);
    expect(d.acoes.motivoSemAprovar).toContain('outra pessoa');
    const propria = await post(autor, `${P}/versoes/${id}/aprovacao`, { versao: 1 });
    expect(propria.statusCode).toBe(409);
    expect(propria.json().codigo).toBe('segregacao');
    // A consulta não aprova.
    expect((await post(consulta, `${P}/versoes/${id}/aprovacao`, { versao: 1 })).statusCode).toBe(403);
    const ok = await post(aprovador, `${P}/versoes/${id}/aprovacao`, { versao: 1, observacao: 'Conferido' });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json()).toEqual({ substituida: null });
    d = (await get(autor, `${P}/versoes/${id}`)).json();
    expect(d.orcamento).toMatchObject({ situacao: 'aprovado', aprovadoPor: 'SINT.ORCAMENTO.APROVA' });
    expect(d.acoes.editar).toBe(false);
    // Aprovada não recebe valor nem é descartada.
    expect((await post(autor, `${P}/versoes/${id}/linhas`, { versao: 2, linhas })).json().codigo).toBe(
      'nao-editavel',
    );
    expect(
      (
        await post(autor, `${P}/versoes/${id}/descarte`, { versao: 2, motivo: 'tentativa de descarte' })
      ).json().codigo,
    ).toBe('nao-editavel');

    // Comparativo até março, por linha: a consulta lê.
    const c = await get(consulta, `${P}/versoes/${id}/comparativo?mesAte=3`);
    expect(c.statusCode, c.body).toBe(200);
    const cmp = c.json();
    expect(cmp.mesAte).toBe(3);
    const sal = cmp.linhas.find((l: { grupo: number }) => l.grupo === 210);
    // Realizado sintético de 2026: 4.000.000 + mês × 10.000 → 12.060.000 em 3 meses; orçado 12.000.000.
    expect(sal).toMatchObject({
      orcadoCentavos: 12_000_000,
      realizadoCentavos: 12_060_000,
      desvioCentavos: 60_000,
    });
    expect(sal.desvioPercentual).toBe(0.5);
    expect(sal.favoravel).toBe(false);
    // O documento rateado 60/40 (300.001 por mês): 180.001 na UTI (maiores restos) e 120.000 no centro cirúrgico, este
    // não orçado.
    const mat = cmp.linhas.filter((l: { grupo: number }) => l.grupo === 230);
    expect(
      mat.map((l: { centro: number; realizadoCentavos: number; naoOrcado: boolean }) => [
        l.centro,
        l.realizadoCentavos,
        l.naoOrcado,
      ]),
    ).toEqual([
      [101, 3 * 180_001, false],
      [102, 3 * 120_000, true],
    ]);
    // Totais por natureza = soma das parcelas.
    for (const t of cmp.totais) {
      expect(t.orcadoCentavos).toBe(
        t.parcelasOrcado.reduce((s: number, p: { centavos: number }) => s + p.centavos, 0),
      );
      expect(t.realizadoCentavos).toBe(
        t.parcelasRealizado.reduce((s: number, p: { centavos: number }) => s + p.centavos, 0),
      );
    }
    expect(cmp.totais.map((t: { natureza: string }) => t.natureza)).toEqual([
      'receita',
      'despesa',
      'consumo',
    ]);
    expect(cmp.avisos.some((a: string) => a.includes('sem rateio'))).toBe(true);
    // Por centro e por item.
    const porCentro = (await get(consulta, `${P}/versoes/${id}/comparativo?visao=centro`)).json();
    expect(porCentro.linhas.every((l: { rotuloItem: string }) => l.rotuloItem === 'Todos os itens')).toBe(
      true,
    );
    const porItem = (await get(consulta, `${P}/versoes/${id}/comparativo?visao=item`)).json();
    expect(porItem.linhas.every((l: { centro: number }) => l.centro === 0)).toBe(true);
    expect((await get(consulta, `${P}/versoes/${id}/comparativo?mesAte=13`)).statusCode).toBe(400);
    // Recorte por centro (UTI, 101) e por item: as linhas, os totais e as parcelas são só os do recorte.
    const uti = (await get(consulta, `${P}/versoes/${id}/comparativo?mesAte=3&centro=101`)).json();
    expect(uti.centro).toBe(101);
    expect(uti.linhas.length).toBeGreaterThan(0);
    expect(uti.linhas.every((l: { centro: number }) => l.centro === 101)).toBe(true);
    const mat101 = uti.linhas.find((l: { grupo: number }) => l.grupo === 230);
    expect(mat101.realizadoCentavos).toBe(3 * 180_001);
    for (const t of uti.totais) {
      expect(t.orcadoCentavos).toBe(
        t.parcelasOrcado.reduce((s: number, p: { centavos: number }) => s + p.centavos, 0),
      );
      expect(t.realizadoCentavos).toBe(
        t.parcelasRealizado.reduce((s: number, p: { centavos: number }) => s + p.centavos, 0),
      );
    }
    const totalDespGeral = cmp.totais.find(
      (t: { natureza: string }) => t.natureza === 'despesa',
    ).realizadoCentavos;
    const totalDespUti = uti.totais.find(
      (t: { natureza: string }) => t.natureza === 'despesa',
    ).realizadoCentavos;
    expect(totalDespUti).toBeLessThan(totalDespGeral);
    expect(uti.avisos.some((a: string) => a.startsWith('Recorte aplicado'))).toBe(true);
    const chaveMat = `${mat101.grupo}.${mat101.subgrupo}.${mat101.item}`;
    const doItem = (await get(consulta, `${P}/versoes/${id}/comparativo?mesAte=3&item=${chaveMat}`)).json();
    expect(doItem.item).toBe(chaveMat);
    expect(
      doItem.linhas.map((l: { centro: number; realizadoCentavos: number }) => [
        l.centro,
        l.realizadoCentavos,
      ]),
    ).toEqual([
      [101, 3 * 180_001],
      [102, 3 * 120_000],
    ]);
    expect(doItem.totais.map((t: { natureza: string }) => t.natureza)).toEqual(['despesa']);
    expect((await get(consulta, `${P}/versoes/${id}/comparativo?item=230`)).statusCode).toBe(400);
    expect((await get(consulta, `${P}/versoes/${id}/comparativo?centro=-1`)).statusCode).toBe(400);
    // A trilha registrou as gravações (criação, linhas, aprovação), nenhuma da gravação que não mudou.
    const eventos = trilha.eventos
      .map((l) => l.evento)
      .filter((e) => /^financeiro\.orcamento\.(criado|linhasGravadas|aprovado|descartado)$/.test(e));
    expect(eventos).toEqual([
      'financeiro.orcamento.criado',
      'financeiro.orcamento.linhasGravadas',
      'financeiro.orcamento.aprovado',
    ]);
  });

  it('revisão: nova versão como cópia; aprovada substitui a vigente; descarte; versão a partir do realizado', async () => {
    const autor = await entrar('SINT.ORCAMENTO');
    const aprovador = await entrar('SINT.ORCAMENTO.APROVA');
    const lista = (await get(autor, `${P}/versoes?ano=2026`)).json().versoes;
    const vigente = lista.find((v: { situacao: string }) => v.situacao === 'aprovado');
    const copia = await post(autor, `${P}/versoes`, {
      ano: 2026,
      descricao: 'Revisão de junho',
      base: { tipo: 'versao', id: vigente.id },
    });
    expect(copia.statusCode, copia.body).toBe(201);
    expect(copia.json()).toMatchObject({ numero: 2, linhas: 4 });
    const nova = copia.json().id;
    expect((await post(aprovador, `${P}/versoes/${nova}/aprovacao`, { versao: 0 })).json()).toEqual({
      substituida: vigente.id,
    });
    const depois = (await get(autor, `${P}/versoes?ano=2026`)).json().versoes;
    expect(depois.map((v: { numero: number; situacao: string }) => [v.numero, v.situacao])).toEqual([
      [2, 'aprovado'],
      [1, 'substituido'],
    ]);
    // Descartar um rascunho (com o motivo).
    const rasc = (
      await post(autor, `${P}/versoes`, { ano: 2026, descricao: 'Rascunho para descartar' })
    ).json();
    expect(
      (await post(autor, `${P}/versoes/${rasc.id}/descarte`, { versao: 0, motivo: 'ok' })).statusCode,
    ).toBe(400);
    expect(
      (await post(autor, `${P}/versoes/${rasc.id}/descarte`, { versao: 0, motivo: 'feito por engano' }))
        .statusCode,
    ).toBe(200);
    // Versão de 2027 a partir do realizado de 2026 (até setembro) com +5,00%.
    const doReal = await post(autor, `${P}/versoes`, {
      ano: 2027,
      descricao: 'Base realizada',
      base: { tipo: 'realizado', ajusteCentesimos: 500 },
    });
    expect(doReal.statusCode, doReal.body).toBe(201);
    const det = (await get(autor, `${P}/versoes/${doReal.json().id}`)).json();
    expect(det.orcamento.base).toBe('realizado de 2026 +5,00%');
    const r2026 = realizadoSintetico(2026);
    const sal = det.linhas.find((l: { grupo: number }) => l.grupo === 210);
    const janeiro = r2026.agregado.find((a) => a.grupo === 210 && a.mes === 1)!.centavos;
    expect(sal.meses[0]).toBe(Math.round(janeiro * 1.05));
    expect(sal.meses[9]).toBe(0);
    // O ano sem realizado: aviso.
    const cmp = (await get(autor, `${P}/versoes/${doReal.json().id}/comparativo`)).json();
    expect(cmp.avisos[0]).toContain('Ainda não há realizado');
  });

  it('404 de versão inexistente e de rota inválida', async () => {
    const c = await entrar('SINT.ORCAMENTO');
    expect((await get(c, `${P}/versoes/999999`)).statusCode).toBe(404);
    expect((await get(c, `${P}/versoes/abc`)).statusCode).toBe(404);
    expect((await get(c, `${P}/versoes?ano=20x6`)).statusCode).toBe(400);
  });

  it('com a chave `orcamento` desligada (POL-3): apoio e versões em consulta; criar, gravar, aprovar e descartar recusados sem gravar', async () => {
    // Uma app à parte, com a chave fora da configuração e a porta em memória que conta as gravações.
    const gravacoes: string[] = [];
    class PortaContada extends PortaOrcamentoMemoria {
      override async criar(...a: Parameters<PortaOrcamentoMemoria['criar']>) {
        gravacoes.push('criar');
        return super.criar(...a);
      }
      override async gravarLinhas(...a: Parameters<PortaOrcamentoMemoria['gravarLinhas']>) {
        gravacoes.push('linhas');
        return super.gravarLinhas(...a);
      }
      override async aprovar(...a: Parameters<PortaOrcamentoMemoria['aprovar']>) {
        gravacoes.push('aprovar');
        return super.aprovar(...a);
      }
      override async descartar(...a: Parameters<PortaOrcamentoMemoria['descartar']>) {
        gravacoes.push('descartar');
        return super.descartar(...a);
      }
    }
    const trilhaB = new RegistradorTrilhaMemoria();
    const configuracao = fonteConfiguracaoMemoria(trilhaB, {
      chavesIniciais: () => chavesIniciaisSinteticas().filter((c) => c.chave !== CHAVE_LIBERACAO_ORCAMENTO),
      prerequisitosIniciais: prerequisitosIniciaisSinteticos,
      parametrosIniciais: parametrosIniciaisSinteticos,
    });
    const b = await criarApp(lerConfiguracao(env), null, env, {
      trilha: trilhaB,
      registro: registroDeTeste(
        {},
        {
          configuracao_teste: () => ({
            module: ConfiguracaoDesligada,
            global: true,
            providers: [
              { provide: FONTE_CONFIGURACAO, useValue: configuracao },
              { provide: CACHE_CONFIG, useValue: new CacheConfig(new ArmazemMemoria()) },
            ],
            exports: [FONTE_CONFIGURACAO, CACHE_CONFIG],
          }),
          orcamento: (ctx) => moduloOrcamento(ctx, { porta: new PortaContada() }),
        },
      ),
    });
    await b.init();
    await b.getHttpAdapter().getInstance().ready();
    try {
      const r = await b.inject({
        method: 'POST',
        url: '/api/sessao',
        payload: { estabelecimento: 'aa', login: 'SINT.ORCAMENTO', senha: SENHA },
      });
      expect(r.statusCode).toBe(201);
      const set = (r.headers['set-cookie'] as string[] | undefined) ?? [];
      const cookie = set.map((x) => x.split(';')[0]).join('; ');
      const csrf =
        set
          .find((x) => x.startsWith('sgh_csrf='))
          ?.split(';')[0]
          ?.slice(9) ?? '';
      const apoio = (await b.inject({ method: 'GET', url: `${P}/apoio`, headers: { cookie } })).json();
      expect(apoio).toMatchObject({ chaveLigada: false, acoes: { editar: false, aprovar: false } });
      expect(
        (await b.inject({ method: 'GET', url: `${P}/versoes?ano=2026`, headers: { cookie } })).statusCode,
      ).toBe(200);
      const gravar = (url: string, payload: Record<string, unknown>) =>
        b.inject({ method: 'POST', url, headers: { cookie, 'x-csrf': csrf }, payload });
      const recusas = [
        await gravar(`${P}/versoes`, { ano: 2026, descricao: 'Desligada' }),
        await gravar(`${P}/versoes/1/linhas`, { versao: 0, linhas: [] }),
        await gravar(`${P}/versoes/1/aprovacao`, { versao: 1 }),
        await gravar(`${P}/versoes/1/descarte`, { versao: 1, motivo: 'chave desligada' }),
      ];
      for (const x of recusas) {
        expect(x.statusCode, x.body).toBe(403);
        expect(x.json().codigo).toBe('recurso-desligado');
        expect(String(x.json().detail ?? '')).not.toBe('');
      }
      expect(gravacoes).toEqual([]);
      const GRAVACOES = [
        'financeiro.orcamento.criado',
        'financeiro.orcamento.linhasGravadas',
        'financeiro.orcamento.aprovado',
        'financeiro.orcamento.descartado',
      ];
      expect(
        trilhaB.eventos.filter((l) => GRAVACOES.includes(l.evento) && l.resultado === 'sucesso'),
      ).toEqual([]);
    } finally {
      await b.close();
    }
  });
});
