// M41 pela HTTP, com a sessão real sobre a fonte sintética e as portas EM MEMÓRIA (nada conecta a banco): o painel
// "Efeito no estoque dos documentos do novo" (documentos do dia por sistema, efeito dos gatilhos com o alerta do
// documento aberto, horários, requisições, uso por local, último mês fechado), a conferência numérica (retrato e
// comparação com 0 e com divergência), a regra 1 na tela de chaves (em todo ambiente: a dispensação recusada com as
// unidades sem a prescrição em uso; o aviso no painel de chaves) e o painel de migração da onda 3 (quatro setores na
// ordem, itens da onda, regra 1, registro do critério e o lote recusado fora de dev/ci).
import { resolve } from 'node:path';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../app.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../configuracao.js';
import { ErroProblema } from '../../problema.filter.js';
import { envTeste, SENHA } from '../../sessao/teste.spec-util.js';
import type { SessaoCadastro } from '../cadastro/comum.js';
import { ServicoMigracao } from '../coexistencia/aplicacao/servico.js';
import { PortaCoexistenciaMemoria } from '../coexistencia/porta-memoria.js';
import { criterioLigarSetor, fonteConfiguracaoMemoria } from '../config/public-api.js';
import { ServicoOnda3 } from './onda3.js';
import { PortaSuprimentosMemoria } from './porta-memoria.js';

const CATALOGO = resolve(import.meta.dirname, '../../../../../docs/operacoes/catalogo');
const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev', CATALOGO_OPERACOES: CATALOGO };
const trilha = new RegistradorTrilhaMemoria();
const suprimentos = new PortaSuprimentosMemoria({ estado: () => 'verde' });
let app: NestFastifyApplication;
let chave = 0;

beforeAll(async () => {
  app = await criarApp(lerConfiguracao(env), null, env, { trilha, suprimentos, vigia: null });
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
  'idempotency-key': `teste-m41-${++chave}-${Date.now()}`,
});
const get = (s: Sessao, url: string) =>
  app.inject({ method: 'GET', url: `/api${url}`, headers: { cookie: s.cookie } });
const post = (s: Sessao, url: string, payload: unknown = {}) =>
  app.inject({ method: 'POST', url: `/api${url}`, headers: h(s), payload: payload as object });
const put = (s: Sessao, url: string, payload: unknown) =>
  app.inject({ method: 'PUT', url: `/api${url}`, headers: h(s), payload: payload as object });

describe('painel de efeito no estoque dos documentos do novo (campo 7)', { timeout: 30_000 }, () => {
  it('documentos do dia por sistema, efeito com o alerta do documento aberto, horários, requisições e uso; sem citar o outro sistema', async () => {
    const s = await entrar('SINT.ALMOXARIFE');
    const req = await post(s, '/suprimentos/requisicoes', {
      destino: 2,
      local: 10,
      centroCusto: 101,
      localConsumo: 11,
      itens: [{ item: 5001, quantidade: 2 }],
    });
    expect(req.statusCode, req.body).toBe(200);
    const r = await get(s, '/suprimentos/onda3/painel');
    expect(r.statusCode, r.body).toBe(200);
    const p = r.json();
    const saidas10 = p.documentos.find(
      (d: { tipo: string; local: number }) => d.tipo === 'saida' && d.local === 10,
    );
    expect(saidas10).toMatchObject({ novo: 1, demais: 14, total: 15 });
    const aberto = p.efeitos.find((e: { chave: { doc: number } }) => e.chave.doc === req.json().ids.doc);
    expect(aberto).toMatchObject({
      operacao: 'suprimentos.requisitarMaterial',
      alertas: ['nao-consolidado'],
    });
    expect(p.comAlerta).toBeGreaterThanOrEqual(1);
    expect(p.horarios.map((x: { unidade: string }) => x.unidade)).toEqual(['2A', 'CTI']);
    expect(p.requisicoes.some((x: { local: number }) => x.local === 10)).toBe(true);
    expect(p.uso.length).toBeGreaterThan(0);
    expect(p.ultimoMesFechado).not.toBeNull();
    expect(JSON.stringify(p)).not.toMatch(/spdata|legado/i);
  });

  it('filtro por local; dia inválido 400; sem a permissão de saldo, 403', async () => {
    const s = await entrar('SINT.ALMOXARIFE');
    const r = await get(s, '/suprimentos/onda3/painel?local=15');
    expect(r.statusCode).toBe(200);
    expect(r.json().documentos.every((d: { local: number | null }) => d.local === 15)).toBe(true);
    expect((await get(s, '/suprimentos/onda3/painel?dia=15/06/2026')).statusCode).toBe(400);
    const outra = await entrar('SINT.AGENDA');
    expect((await get(outra, '/suprimentos/onda3/painel')).statusCode).toBe(403);
    expect((await get(outra, '/suprimentos/onda3/conferencia-numerica')).statusCode).toBe(403);
  });
});

describe('conferência numérica de saldo e preço médio (campo 10)', { timeout: 30_000 }, () => {
  it('o retrato dos itens movidos pelo novo; o mesmo retrato informado dá 0 divergência; um valor diferente aparece', async () => {
    const s = await entrar('SINT.ALMOXARIFE');
    await post(s, '/suprimentos/requisicoes', {
      destino: 2,
      local: 10,
      centroCusto: 101,
      localConsumo: 11,
      itens: [{ item: 5002, quantidade: 1 }],
    });
    const r = await get(s, '/suprimentos/onda3/conferencia-numerica');
    expect(r.statusCode, r.body).toBe(200);
    const { dia, lidos } = r.json();
    expect(lidos.length).toBeGreaterThan(0);
    const igual = await post(s, '/suprimentos/onda3/conferencia-numerica', { dia, esperado: lidos });
    expect(igual.statusCode, igual.body).toBe(200);
    expect(igual.json()).toMatchObject({ divergencias: [], conferidos: lidos.length });
    const outro = [{ ...lidos[0], saldo: lidos[0].saldo + 1 }];
    const dif = await post(s, '/suprimentos/onda3/conferencia-numerica', { dia, esperado: outro });
    expect(dif.json().divergencias).toEqual([
      expect.objectContaining({ item: lidos[0].item, campo: 'saldo', diferenca: -1 }),
    ]);
    expect((await post(s, '/suprimentos/onda3/conferencia-numerica', { dia, esperado: [] })).statusCode).toBe(
      400,
    );
  });

  it('item informado que o novo não movimentou no dia é lido agora (sem divergência falsa de saldo 0)', async () => {
    const s = await entrar('SINT.ALMOXARIFE');
    const { dia, lidos } = (await get(s, '/suprimentos/onda3/conferencia-numerica')).json();
    // O local 20 não teve documento do novo no dia: o par é lido do mesmo jeito.
    const fora = { item: 5001, local: 20 };
    expect(
      lidos.some((x: { item: number; local: number }) => x.item === fora.item && x.local === fora.local),
    ).toBe(false);
    const lido = await new ServicoOnda3(suprimentos, null).conferir(sessaoSint('SINT.ALMOXARIFE'), {
      dia,
      esperado: [{ ...fora, saldo: 0, precoMedio: 0 }],
    });
    const real = lido.lidos.find((x) => x.item === fora.item && x.local === fora.local)!;
    expect(real).toBeDefined();
    const r = await post(s, '/suprimentos/onda3/conferencia-numerica', { dia, esperado: [real] });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toMatchObject({ divergencias: [], conferidos: 1 });
    expect(r.json().lidos).toEqual([real]);
  });

  it('escopo do local (D-ESCOPO-41): o retrato e a conferência só com os locais do usuário do estoque; fora, 403', async () => {
    const o = new ServicoOnda3(suprimentos, null);
    const almox = sessaoSint('SINT.ALMOXARIFE');
    const todos = await o.retratoNumerico(almox, {});
    const dia = todos.dia;
    expect(todos.lidos.some((x) => x.local === 10)).toBe(true);
    // Filtro de local da tela: só os pares do local.
    const de10 = await o.retratoNumerico(almox, { dia, local: '10' });
    expect(de10.lidos.length).toBeGreaterThan(0);
    expect(de10.lidos.every((x) => x.local === 10)).toBe(true);
    // O comprador só tem o local 10: o retrato filtra; o local 15 pedido é 403; conferir par do 15 é 403.
    const comprador = sessaoSint('SINT.COMPRADOR');
    const r = await o.retratoNumerico(comprador, { dia });
    expect(r.lidos.every((x) => x.local === null || x.local === 10)).toBe(true);
    await expect(o.retratoNumerico(comprador, { dia, local: '15' })).rejects.toSatisfy(status(403));
    await expect(
      o.conferir(comprador, { dia, esperado: [{ item: 5001, local: 15, saldo: 1, precoMedio: 1 }] }),
    ).rejects.toSatisfy(status(403));
    await expect(o.retratoNumerico(almox, { dia: '15/06/2026' })).rejects.toSatisfy(status(400));
  });
});

function sessaoSint(login: string): SessaoCadastro {
  return {
    req: { headers: {}, ip: '127.0.0.1' } as unknown as SessaoCadastro['req'],
    hospital: 'aa',
    rede: 'r',
    login,
    porta: { rede: 'r', hospital: 'aa' },
    pode: () => true,
  };
}

describe(
  'regra 1: a farmácia só depois da prescrição em uso nas unidades atendidas',
  { timeout: 30_000 },
  () => {
    const ligar = async (s: Sessao, chaveLib: string, tipo: 'recurso' | 'operacao', ligarSim = true) =>
      post(s, '/administracao/liberacao', {
        chave: chaveLib,
        tipo,
        escopo: 'pessoa',
        valores: ['SINT.FARMACEUTICO'],
        ligar: ligarSim,
        justificativa: 'Ligar sintético pela tela de chaves (teste do M41)',
        senha: SENHA,
      });

    it('ligar a dispensação ou a entrega (recurso e operação) em dev: 409 com a unidade que falta; desligar segue', async () => {
      const s = await entrar('SINT.ADMIN');
      for (const [k, t] of [
        ['suprimentos.dispensacao', 'recurso'],
        ['suprimentos.entrega', 'recurso'],
        ['suprimentos.dispensarHorario', 'operacao'],
        ['suprimentos.confirmarEntrega', 'operacao'],
      ] as const) {
        const r = await ligar(s, k, t);
        expect(r.statusCode, r.body).toBe(409);
        expect(r.json()).toMatchObject({ codigo: 'farmacia-sem-prescricao' });
        expect(r.json().detail).toContain('2A');
        expect(r.json().detail).not.toContain('CTI,');
      }
      expect((await ligar(s, 'suprimentos.dispensacao', 'recurso', false)).statusCode).toBe(200);
      // A chave do almoxarifado não passa pela regra 1.
      expect((await ligar(s, 'suprimentos.requisitarMaterial', 'operacao')).json().codigo).not.toBe(
        'farmacia-sem-prescricao',
      );
    });

    it('o painel de chaves avisa antes: a operação da dispensação não pode ligar e diz por quê', async () => {
      const s = await entrar('SINT.ADMIN');
      const p = (await get(s, '/administracao/liberacao')).json();
      const f = p.funcionalidades.find(
        (x: { chave: string; tipo: string }) =>
          x.chave === 'suprimentos.dispensarHorario' && x.tipo === 'operacao',
      );
      expect(f).toMatchObject({ podeLigar: false });
      expect(f.motivoBloqueio).toMatch(/prescrição eletrônica ainda não está ligada na\(s\) unidade\(s\) 2A/);
    });

    it('sem o avaliador do estoque, não liga (falha fechada); com as duas unidades em uso, pode', async () => {
      const porta = new PortaSuprimentosMemoria({ estado: () => 'verde' });
      // A chave da prescrição ligada no estabelecimento (como na sessão sintética).
      const fonte = {
        chaves: async () => [
          { chave: 'pep.prescricao.cpoe', tipo: 'recurso', escopo: 'hospital', valor: '*', ligada: true },
        ],
      } as unknown as ConstructorParameters<typeof ServicoOnda3>[1];
      const o = new ServicoOnda3(porta, fonte);
      const c = { rede: 'r', hospital: 'aa' };
      expect(await o.motivoLigar(c, 'suprimentos.registrarSaida')).toBeNull();
      expect(await o.motivoLigar(c, 'suprimentos.dispensacao')).toMatch(/2A/);
      porta.onda3Regra1 = async () => ({
        atendidas: [{ local: 10, unidade: 'CTI', dispensacoes: 3 }],
        prescricoes: [{ unidade: 'CTI', n: 2 }],
      });
      expect(await o.motivoLigar(c, 'suprimentos.dispensacao')).toBeNull();
      // Recolher a prescrição no estabelecimento recolhe a prova: a dispensação volta a não ligar.
      const recolhida = new ServicoOnda3(porta, {
        chaves: async () => [
          { chave: 'pep.prescricao.cpoe', tipo: 'recurso', escopo: 'hospital', valor: '*', ligada: false },
        ],
      } as unknown as ConstructorParameters<typeof ServicoOnda3>[1]);
      expect(await recolhida.motivoLigar(c, 'suprimentos.dispensacao')).toMatch(/CTI/);
      porta.onda3Regra1 = async () => {
        throw new Error('cópia fora');
      };
      expect(await o.motivoLigar(c, 'suprimentos.dispensacao')).toMatch(/Não foi possível conferir/);
    });
  },
);

describe(
  'painel de migração da onda 3 (regras 1 a 8 do M40 com as condições da onda)',
  { timeout: 30_000 },
  () => {
    const M = '/administracao/coexistencia/migracao';
    it('quatro setores na ordem, itens da onda, P1 e P2, a regra 1 por local, fora da onda e os códigos a confirmar', async () => {
      const s = await entrar('SINT.ADMIN');
      const r = await get(s, `${M}/onda3`);
      expect(r.statusCode, r.body).toBe(200);
      const p = r.json();
      expect(p.ordem).toEqual([
        ['almoxarifado-compras'],
        ['farmacia-central'],
        ['farmacias-satelites'],
        ['farmacia-clinica'],
      ]);
      const central = p.setores.find((x: { setor: string }) => x.setor === 'farmacia-central');
      expect(central.exigePrescricao).toBe(true);
      expect(central.itens.map((i: { item: string }) => i.item)).toEqual(
        expect.arrayContaining(['prescricao-na-unidade', 'inventario-recente', 'conferencia-numerica']),
      );
      expect(central.antesFaltam).toEqual(['almoxarifado-compras']);
      expect(
        central.operacoes.find((o: { nome: string }) => o.nome === 'suprimentos.devolverDose'),
      ).toMatchObject({
        prioridade: 'P2',
      });
      expect(central.recursosSoNoNovo.map((x: { chave: string }) => x.chave)).toContain(
        'suprimentos.controlados',
      );
      expect(p.regra1).toMatchObject({ lido: true, unidadesComPrescricao: ['CTI'] });
      expect(p.regra1.locais).toEqual([{ local: 10, unidades: ['2A', 'CTI'], faltam: ['2A'] }]);
      expect(p.foraDaOnda.map((x: { chave: string }) => x.chave)).toEqual([
        'suprimentos.ambulatorial',
        'suprimentos.livroControlados',
      ]);
      expect(p.codigosAConfirmar.map((x: { coluna: string }) => x.coluna)).toEqual(['ORIGEM', 'TCE']);
      expect(JSON.stringify(p)).not.toMatch(/spdata/i);
    });

    it('registrar: item do setor grava com a trilha; item de outro setor 400; "não se aplica" na prescrição 400; 404 fora da onda', async () => {
      const s = await entrar('SINT.ADMIN');
      const J = 'Registro sintético do comitê de coexistência';
      const um = (x: Record<string, unknown>) => ({ itens: [x], justificativa: J });
      const ok = await put(
        s,
        `${M}/onda3/criterio/farmacia-central`,
        um({ item: 'inventario-recente', situacao: 'cumprido', evidencia: 'ata 41/2026', em: '2026-12-01' }),
      );
      expect(ok.statusCode, ok.body).toBe(200);
      const lido = (await get(s, `${M}/onda3`)).json();
      const it = lido.setores
        .find((x: { setor: string }) => x.setor === 'farmacia-central')
        .itens.find((i: { item: string }) => i.item === 'inventario-recente');
      expect(it).toMatchObject({ ok: true, situacao: 'cumprido' });
      expect(
        (
          await put(
            s,
            `${M}/onda3/criterio/almoxarifado-compras`,
            um({ item: 'prescricao-na-unidade', situacao: 'cumprido', evidencia: 'ata 1', em: '2026-12-01' }),
          )
        ).statusCode,
      ).toBe(400);
      expect(
        (
          await put(
            s,
            `${M}/onda3/criterio/farmacia-central`,
            um({
              item: 'prescricao-na-unidade',
              situacao: 'nao-se-aplica',
              evidencia: 'ata 1',
              em: '2026-12-01',
            }),
          )
        ).statusCode,
      ).toBe(400);
      expect(
        (
          await put(
            s,
            `${M}/onda3/criterio/enfermagem`,
            um({ item: 'inventario-recente', situacao: 'cumprido', evidencia: 'ata 1', em: '2026-12-01' }),
          )
        ).statusCode,
      ).toBe(404);
    });

    it('fora de dev/ci, o lote do almoxarifado com o critério incompleto é recusado com o código da onda 3', async () => {
      const sessao: SessaoCadastro = {
        req: { headers: {}, ip: '127.0.0.1' } as unknown as SessaoCadastro['req'],
        hospital: 'pc',
        rede: 'r',
        login: 'SINT.ADMIN',
        porta: { rede: 'r', hospital: 'pc' },
        pode: () => true,
      };
      const criterio = criterioLigarSetor();
      const servico = new ServicoMigracao({
        porta: new PortaCoexistenciaMemoria(
          new RegistradorTrilhaMemoria(),
          fonteConfiguracaoMemoria(new RegistradorTrilhaMemoria()),
        ),
        trilha: new RegistradorTrilhaMemoria(),
        administracao: null,
        fonteConfig: null,
        cache: null,
        caminhoCatalogo: CATALOGO,
        ambiente: 'homologacao',
        grafana: null,
        metodoMascaramento: null,
        primeiro: { codigo: 'pc', nome: 'ProntoCardio' },
        criterio,
      });
      const e = await servico
        .aplicarLote(sessao, {
          setor: 'almoxarifado-compras',
          alvo: { tipo: 'setor', valores: [] },
          justificativa: 'Lote sintético do almoxarifado (teste)',
        })
        .then(
          () => null,
          (x: unknown) => x as ErroProblema,
        );
      expect(e?.getStatus()).toBe(409);
      expect(e?.extras).toMatchObject({ codigo: 'criterio-onda3-incompleto' });
      expect(e?.detalhe).toContain('inventário recente dos locais de estoque não registrado');
      // A tela de chaves: a chave de um setor da onda 3 diz o setor e o que falta.
      expect(
        await servico.motivoLigarChaveOnda2(
          { rede: 'r', hospital: 'pc' },
          'recurso',
          'suprimentos.avaliacao',
        ),
      ).toMatch(/^Farmácia clínica \(avaliação da prescrição\): Critério de liberação incompleto/);
      // O lote da farmácia central em dev: sem o avaliador do estoque, a regra 1 falha fechada.
      const dev = new ServicoMigracao({
        ...(servico as unknown as { d: object }).d,
        ambiente: 'dev',
      } as never);
      const f = await dev
        .aplicarLote(sessao, {
          setor: 'farmacia-central',
          alvo: { tipo: 'setor', valores: [] },
          justificativa: 'Lote sintético da farmácia (teste)',
        })
        .then(
          () => null,
          (x: unknown) => x as ErroProblema,
        );
      expect(f?.extras).toMatchObject({ codigo: 'farmacia-sem-prescricao' });
    });
  },
);

function status(n: number) {
  return (e: unknown) => e instanceof ErroProblema && e.getStatus() === n;
}
