// Mapa e lote de trabalho da bancada pela API inteira (F3.5, 05-SADT linha 8), com a sessão real (login sintético,
// guardas, CSRF, idempotência e interceptores) sobre o MariaDB do cliente de teste f22_o2 (massa SINTÉTICA). As portas
// próprias recebem o contexto da sessão trocado pelo cliente, o estabelecimento e a conta da massa (o id da conta da
// sessão sintética não existe no banco do cliente). Prova pela HTTP: sem a permissão de digitar o resultado, 403 e
// nada gravado; o GET do mapa traz os exames em análise pedidos em dias anteriores (a fila começa em
// INICIO_DA_FILA_DA_BANCADA, não no dia) e não traz os pedidos depois do dia escolhido; a fila fora de lote da lista é a
// do mapa menos os retidos; o corpo inválido dá 400 sem lote; abrir grava o lote com urgentes primeiro até o limite e
// a trilha; o reenvio pela mesma chave de idempotência não abre outro lote; imprimir grava a hora; fechar devolve o
// pendente à fila e o segundo fechamento é recusado; soltar devolve o retido à fila. Nada é apagado pelas rotas.
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { type DynamicModule, type Provider } from '@nestjs/common';
import { NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../../app.js';
import { RegistradorTrilhaMemoria } from '../../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../../configuracao.js';
import { envTeste, SENHA } from '../../../sessao/teste.spec-util.js';
import { moduloConfiguracaoDeTeste, registroDeTeste } from '../../cadastro/teste.spec-util.js';
import { SERVICO_LOTE_TRABALHO } from '../lote-trabalho.controller.js';
import { SERVICO_MAPA_TRABALHO } from '../mapa-trabalho.controller.js';
import { moduloSadt } from '../modulo.js';
import { PortaSadtPropria } from '../porta-propria.js';
import {
  CLIENTE,
  contexto,
  limparMassaSadt,
  type MassaSadt,
  montarMassaSadt,
  SEM_BANCO,
} from './copia.spec-util.js';
import { ServicoLoteTrabalho } from './lote-trabalho-propria.js';
import { ServicoMapaTrabalho } from './mapa-trabalho-propria.js';

const COM_PERMISSAO = 'SINT.BIOMEDICO';
const SEM_PERMISSAO = 'SINT.AGENDA';

/** O objeto com o contexto de toda chamada trocado pelo da massa (a correlação e a chave de idempotência da requisição são mantidas). */
function naMassa<T extends object>(alvo: T, m: () => MassaSadt): T {
  return new Proxy(alvo, {
    get(a, k, r) {
      const v = Reflect.get(a, k, r) as unknown;
      if (typeof v !== 'function') return v;
      return (c: unknown, ...resto: unknown[]) => {
        // Do contexto da sessão ficam a correlação e a chave de idempotência da requisição; o resto vem da massa.
        const da = contexto(m());
        const trocado =
          c && typeof c === 'object'
            ? {
                ...c,
                cliente: da.cliente,
                estabelecimento: da.estabelecimento,
                usuario: da.usuario,
                hospital: da.hospital,
                rede: da.rede,
              }
            : c;
        return (v as (...x: unknown[]) => unknown).call(a, trocado, ...resto);
      };
    },
  });
}

interface Sessao {
  cookie: string;
  csrf: string;
}

describe.skipIf(SEM_BANCO)('mapa e lote de trabalho pela API sobre o MariaDB (f22_o2)', () => {
  let nucleo: NucleoProprio;
  let app: NestFastifyApplication;
  let m: MassaSadt | null = null;
  const bancadas: number[] = [];
  const modelos: number[] = [];
  let bA = 0;
  let itemU = 0;
  let itemR = 0;
  let itemT = 0;
  let seq = 0;
  const C = { cliente: CLIENTE, correlacao: 't-s35http' };
  const um = (sql: string, p: unknown[]) => nucleo.lerSomente(C, (l) => l.uma(sql, p));
  const contar = async (sql: string, p: unknown[]) => Number((await um(sql, p))?.['n']);
  const iso = (d: Date) => d.toISOString().slice(0, 10);

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await montarMassaSadt(nucleo, 'S5H');
    const mm = m;
    await nucleo.escrever(C, async (e) => {
      const agora = new Date();
      const b = await e.inserir(
        'INSERT INTO bancada_analitica (codigo, descricao, setor_diagnostico_id, criado_em) VALUES (?, ?, ?, ?)',
        [`H${mm.marca}`.slice(0, 30), `Bancada H ${mm.marca}`, mm.setorLab, agora],
      );
      const mo = await e.inserir(
        `INSERT INTO modelo_mapa_bancada (sigla, descricao, setor_diagnostico_id, bancada_analitica_id, limite_exames, criado_em)
         VALUES (?, 'Modelo de teste', ?, ?, 2, ?)`,
        [`H${mm.marca}`.slice(0, 40), mm.setorLab, b, agora],
      );
      await e.inserir(
        'INSERT INTO modelo_mapa_bancada_exame (modelo_mapa_bancada_id, sequencia, exame_id, criado_em) VALUES (?, 1, ?, ?)',
        [mo, mm.exameLab, agora],
      );
      bancadas.push(b);
      modelos.push(mo);
      bA = b;
      const extra = (s: number, urgente: boolean) =>
        e.inserir(
          `INSERT INTO exame_item (requisicao_exame_id, sequencia, exame_id, material_biologico_id, situacao, urgente,
             criado_em, versao)
           SELECT requisicao_exame_id, ?, exame_id, material_biologico_id, 'em_analise', ?, ?, 1 FROM exame_item WHERE id = ?`,
          [s, urgente, agora, mm.itemLab],
        );
      itemR = await extra(7, false);
      itemT = await extra(8, false);
      itemU = await extra(9, true);
      // Pedidos três dias antes: a fila da bancada não depende do dia do pedido.
      await e.executar("UPDATE requisicao_exame SET prioridade = 'rotina', solicitado_em = ? WHERE id = ?", [
        new Date(agora.getTime() - 3 * 86_400_000),
        mm.requisicao,
      ]);
      await e.executar("UPDATE exame_item SET situacao = 'em_analise', urgente = FALSE WHERE id = ?", [
        mm.itemLab,
      ]);
    });

    const env = { ...envTeste, AMBIENTE: 'dev', API_MODULOS: 'configuracao_teste,cadastro,sadt' };
    const massa = () => m!;
    const porta = naMassa(new PortaSadtPropria(nucleo), massa);
    const lote = naMassa(new ServicoLoteTrabalho(nucleo), massa);
    const mapa = naMassa(new ServicoMapaTrabalho(nucleo), massa);
    const trocar = (p: Provider): Provider => {
      const token = (p as { provide?: unknown }).provide;
      if (token === SERVICO_LOTE_TRABALHO) return { provide: token, useValue: lote };
      if (token === SERVICO_MAPA_TRABALHO) return { provide: token, useValue: mapa };
      return p;
    };
    app = await criarApp(lerConfiguracao(env), null, env, {
      trilha: new RegistradorTrilhaMemoria(),
      registro: registroDeTeste(
        {},
        {
          configuracao_teste: (ctx) => moduloConfiguracaoDeTeste(ctx),
          sadt: async (ctx): Promise<DynamicModule> => {
            const d = await moduloSadt(ctx, { porta, estabelecimentos: [] });
            return { ...d, providers: (d.providers ?? []).map(trocar) };
          },
        },
      ),
    });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  }, 90_000);

  afterAll(async () => {
    await app?.close();
    if (m && bancadas.length)
      await nucleo.escrever(C, async (e) => {
        await e.executar(
          `DELETE gi FROM grupo_trabalho_bancada_item gi JOIN grupo_trabalho_bancada g ON g.id = gi.grupo_trabalho_bancada_id
            WHERE g.bancada_analitica_id = ?`,
          [bA],
        );
        await e.executar('DELETE FROM grupo_trabalho_bancada WHERE bancada_analitica_id = ?', [bA]);
        await e.executar('DELETE FROM modelo_mapa_bancada_exame WHERE modelo_mapa_bancada_id = ?', [
          modelos[0],
        ]);
        await e.executar('DELETE FROM modelo_mapa_bancada WHERE id = ?', [modelos[0]]);
        await e.executar('DELETE FROM bancada_analitica WHERE id = ?', [bA]);
      });
    if (m) await limparMassaSadt(nucleo, m);
    await nucleo.encerrar();
  });

  const entrar = async (login: string): Promise<Sessao> => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/sessao',
      payload: { estabelecimento: 'aa', login, senha: SENHA },
    });
    expect(r.statusCode, r.body).toBe(201);
    const set = r.headers['set-cookie'] as string[];
    return {
      cookie: set.map((c) => c.split(';')[0]).join('; '),
      csrf:
        set
          .find((c) => c.startsWith('sgh_csrf='))
          ?.split(';')[0]
          ?.slice(9) ?? '',
    };
  };
  const get = (s: Sessao, url: string) =>
    app.inject({ method: 'GET', url: `/api${url}`, headers: { cookie: s.cookie } });
  const post = (s: Sessao, url: string, payload: unknown, chave?: string) =>
    app.inject({
      method: 'POST',
      url: `/api${url}`,
      headers: {
        cookie: s.cookie,
        'x-csrf': s.csrf,
        'idempotency-key': chave ?? `int-s35h-${String(++seq)}-${String(Date.now())}`,
      },
      payload: payload as object,
    });
  const lotesDaBancada = () =>
    contar('SELECT COUNT(*) AS n FROM grupo_trabalho_bancada WHERE bancada_analitica_id = ?', [bA]);

  it('mapa, fila, retenção, abrir, reenviar, imprimir, fechar e soltar pela HTTP', async () => {
    const sem = await entrar(SEM_PERMISSAO);
    const s = await entrar(COM_PERMISSAO);

    // Sem a permissão de digitar o resultado: 403 nas rotas do lote e da retenção, e nada gravado.
    expect((await get(sem, '/sadt/lotes-trabalho')).statusCode).toBe(403);
    expect((await post(sem, '/sadt/lotes-trabalho/abrir', { bancada: bA })).statusCode).toBe(403);
    expect(
      (await post(sem, '/sadt/mapa-trabalho/reter', { exame: itemT, motivo: 'Sem permissão' })).statusCode,
    ).toBe(403);
    expect(await lotesDaBancada()).toBe(0);

    // O mapa do dia (padrão: hoje) traz os quatro pedidos três dias antes: a fila começa no início da fila da
    // bancada, não no dia escolhido. O mapa de quatro dias antes (antes do pedido) não os traz.
    const exames = async (data?: string) => {
      const r = await get(s, `/sadt/mapa-trabalho?setor=laboratorio${data ? `&data=${data}` : ''}`);
      expect(r.statusCode, r.body).toBe(200);
      const b = (r.json() as { bancadas: { codigo: number; exames: { id: number }[] }[] }).bancadas.find(
        (x) => x.codigo === bA,
      );
      return (b?.exames ?? []).map((x) => x.id).sort((x, y) => x - y);
    };
    const quatro = [m!.itemLab, itemR, itemT, itemU].sort((x, y) => x - y);
    expect(await exames()).toEqual(quatro);
    expect(await exames(iso(new Date(Date.now() - 4 * 86_400_000)))).toEqual([]);
    const fila = async () => {
      const r = await get(s, '/sadt/lotes-trabalho');
      expect(r.statusCode, r.body).toBe(200);
      return (r.json() as { fila: { bancada: number; foraDeLote: number }[] }).fila.find(
        (f) => f.bancada === bA,
      )?.foraDeLote;
    };
    expect(await fila()).toBe(4);

    // A retenção pela rota: o retido sai do mapa e da fila; sem motivo, 400.
    expect((await post(s, '/sadt/mapa-trabalho/reter', { exame: itemT })).statusCode).toBe(400);
    const ret = await post(s, '/sadt/mapa-trabalho/reter', { exame: itemT, motivo: 'Aguardando reagente' });
    expect(ret.statusCode, ret.body).toBe(200);
    const tres = quatro.filter((x) => x !== itemT);
    expect(await exames()).toEqual(tres);
    expect(await fila()).toBe(3);

    // Corpo inválido: 400 e nenhum lote de exames a processar.
    for (const corpo of [{}, { bancada: 'x' }, { bancada: bA, outro: 1 }])
      expect((await post(s, '/sadt/lotes-trabalho/abrir', corpo)).statusCode).toBe(400);
    expect(await lotesDaBancada()).toBe(1); // só o da retenção

    // Abrir: urgente primeiro, até o limite 2, com a trilha; o reenvio pela mesma chave não abre outro lote.
    const chave = `int-s35h-abrir-${String(Date.now())}`;
    const a = await post(s, '/sadt/lotes-trabalho/abrir', { bancada: bA }, chave);
    expect(a.statusCode, a.body).toBe(200);
    const l1 = a.json() as { id: number; numero: string; itens: { exame: number; sequencia: number }[] };
    expect(l1.itens.map((i) => [i.exame, i.sequencia])).toEqual([
      [itemU, 1],
      [m!.itemLab, 2],
    ]);
    const g = await um(
      'SELECT situacao, analista_usuario_id, aberto_por_usuario_id, estabelecimento_id FROM grupo_trabalho_bancada WHERE id = ?',
      [l1.id],
    );
    expect(g).toMatchObject({ situacao: 'aberto' });
    expect(Number(g!['analista_usuario_id'])).toBe(m!.base.usuario);
    expect(Number(g!['estabelecimento_id'])).toBe(m!.base.est);
    const trilhas = () =>
      contar(
        "SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'grupo_trabalho_bancada' AND entidade_id = ?",
        [l1.id],
      );
    expect(await trilhas()).toBeGreaterThanOrEqual(1);
    const lotesAntes = await lotesDaBancada();
    const rep = await post(s, '/sadt/lotes-trabalho/abrir', { bancada: bA }, chave);
    expect(rep.statusCode, rep.body).toBeLessThan(300);
    expect((rep.json() as { id: number }).id).toBe(l1.id);
    expect(await lotesDaBancada()).toBe(lotesAntes);
    expect(await fila()).toBe(1);

    // A lista do dia traz o lote aberto com os seus exames.
    const lista = await get(s, '/sadt/lotes-trabalho');
    expect(
      (lista.json() as { lotes: { id: number; itens: unknown[] }[] }).lotes.find((x) => x.id === l1.id)
        ?.itens,
    ).toHaveLength(2);

    // Imprimir grava a hora da impressão com a trilha.
    const antes = await trilhas();
    const imp = await post(s, '/sadt/lotes-trabalho/imprimir', { lote: l1.id });
    expect(imp.statusCode, imp.body).toBe(200);
    expect((imp.json() as { impressoEm: string | null }).impressoEm).not.toBeNull();
    expect(
      (await um('SELECT impresso_em FROM grupo_trabalho_bancada WHERE id = ?', [l1.id]))?.['impresso_em'],
    ).not.toBeNull();
    expect(await trilhas()).toBeGreaterThan(antes);

    // Fechar: o digitado fica processado, o que segue em análise volta à fila; o segundo fechamento é recusado.
    await nucleo.escrever(C, (e) =>
      e.executar("UPDATE exame_item SET situacao = 'resultado_digitado' WHERE id = ?", [itemU]),
    );
    const f = await post(s, '/sadt/lotes-trabalho/fechar', { lote: l1.id });
    expect(f.statusCode, f.body).toBe(200);
    expect((f.json() as { situacao: string }).situacao).toBe('fechado');
    const f2 = await post(s, '/sadt/lotes-trabalho/fechar', { lote: l1.id });
    expect(f2.statusCode).toBe(409);
    expect(f2.body).toContain('lote-encerrado');
    expect(
      await contar(
        'SELECT COUNT(*) AS n FROM grupo_trabalho_bancada_item WHERE grupo_trabalho_bancada_id = ? AND excluido_em IS NULL',
        [l1.id],
      ),
    ).toBe(2);
    expect(await fila()).toBe(2);

    // Soltar devolve o retido ao trabalho no lote em que foi retido (pendente, sem apagar a linha): volta ao mapa e
    // não se duplica na fila fora de lote.
    const sol = await post(s, '/sadt/mapa-trabalho/soltar', { exame: itemT });
    expect(sol.statusCode, sol.body).toBe(200);
    const solto = sol.json() as { id: number; situacao: string; lote: string };
    expect(solto).toMatchObject({ situacao: 'pendente', lote: (ret.json() as { lote: string }).lote });
    expect(await exames()).toEqual(quatro.filter((x) => x !== itemU)); // o digitado saiu da análise
    expect(await fila()).toBe(2);
    expect(
      await um('SELECT situacao, excluido_em FROM grupo_trabalho_bancada_item WHERE id = ?', [solto.id]),
    ).toMatchObject({ situacao: 'pendente', excluido_em: null });
  }, 120_000);
});
