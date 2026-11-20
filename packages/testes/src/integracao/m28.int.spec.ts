// Estoque e almoxarifado sobre a cópia (ficha do M28, seção 10, e regras 2, 4, 5, 7 e 13), sempre em transação desfeita
// e sob a trava da cópia:
//   - consolidação na ordem: a saída a setor nasce F e termina T, com o número dado pelo banco; o novo não envia valor e
//     o gatilho valoriza (regra 5); o saldo do item na empresa baixa (prova pós-escrita);
//   - saída a paciente internado sem conta aberta: "sem conta" (regra 7); fora do escopo do usuário: recusada (13);
//   - concorrência: duas saídas do mesmo saldo ao mesmo tempo; a segunda recebe a recusa em português (saldo mudado,
//     registro em edição ou saldo insuficiente), nada dela gravado;
//   - LOCK TIMEOUT: outro terminal segura o item (WITH LOCK) e a saída devolve "registro em edição", nada gravado; o
//     mesmo com o cabeçalho de uma requisição aberta travado por outra conexão enquanto a saída a atende;
//   - devolução depois de outra devolução da mesma saída (a tela com o disponível antigo): relê e recusa o excesso;
//   - a exceção do gatilho de saldo (E_GEITENS_SEM_ESTOQUE, consolidar o item de uma requisição sem estoque) chega em
//     português pela tradução do núcleo, com o código saldo-insuficiente;
//   - CP1252: a observação acentuada da saída grava e relê igual; o emoji é recusado;
//   - transferência em dois passos: o envio e o cancelamento conferem o escopo de local relido na transação;
//   - ponto de pedido: o prazo e o estoque de segurança gravados voltam pela leitura da porta, na chave das duas portas.
// O retrato antes e depois (cabeçalhos, linhas da competência, saldo e valor dos itens, SGH_ e a trilha dos operadores
// sintéticos) prova que o ROLLBACK desfez tudo.
// Massa: itens, locais e internações da cópia (só IDs); o operador e o usuário do estoque sintéticos. Saída só com
// contagens e códigos (nenhum nome).
import { chavePonto } from '@sgh/contratos/regras-suprimentos';
import {
  cancelarTransferenciaSgh,
  definirPontoPedidoSgh,
  enviarTransferenciaSgh,
  ErroOperacao,
  operacao,
  pontosPedidoDefinidos,
  problemaDoLegado,
} from '@sgh/legado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CENTRO_SETOR,
  internacaoComConta,
  internacaoSemConta,
  itemComSaldo,
  LOCAL_CENTRAL,
  LOCAL_SATELITE,
  localConsumo,
  usuarioEstoque,
} from '../massa/reproducao-suprimentos.js';
import {
  consolidarSemEstoque,
  estoqueDoItem,
  observacaoDaSaida,
  requisicaoAberta,
  retratoEstoque,
  saidaGravada,
  travarCabecalho,
  travarItem,
  usuarioEstoqueSemEscopo,
} from '../massa/estoque-outro-sistema.js';
import { loginLivre, usuarioSintetico } from '../massa/sintetica.js';
import {
  type Ambiente,
  ctx,
  ctxOperacao,
  num,
  PODE_ESCREVER,
  prepararAmbiente,
} from './escrita.spec-util.js';

type Escritor = Parameters<Parameters<Ambiente['nucleo']['desfazendoNaCopia']>[1]>[0];

async function codigo(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'gravou';
  } catch (e) {
    return e instanceof ErroOperacao ? (e.problema.codigo ?? 'sem-codigo') : `outro: ${(e as Error).name}`;
  }
}

describe.skipIf(!PODE_ESCREVER)('M28: estoque na cópia (transação desfeita)', () => {
  let a: Ambiente;
  beforeAll(async () => {
    a = await prepararAmbiente();
  });
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  const retrato = (itens: readonly number[]) => a.nucleo.lerSomente(ctx(a), (l) => retratoEstoque(l, itens));
  /** O item da massa (o primeiro com o saldo pedido no local central; o mesmo dentro e fora da transação). */
  const itemDaMassa = (minimo: number) =>
    a.nucleo.desfazendoNaCopia(ctx(a), (e) => itemComSaldo(e, { local: LOCAL_CENTRAL, minimo }));

  /** O operador sintético e o seu usuário do estoque (todos os tipos nos locais da reprodução). */
  async function preparo(e: Escritor, o: { centros?: number[]; semEscopo?: boolean } = {}) {
    const login = (await loginLivre(e, Date.now() % 1_000_000_000)).toUpperCase();
    await a.executor.executar(
      operacao('acesso.criarUsuarioIntegracao'),
      a.cod,
      usuarioSintetico('usuario-tecnico', login),
      ctxOperacao(a, 'SGH.TESTE'),
      { escritor: e },
    );
    if (!o.semEscopo) await usuarioEstoque(e, login, o.centros ? { centros: o.centros } : {});
    else await usuarioEstoqueSemEscopo(e, login);
    const exec = (op: string, x: unknown) =>
      a.executor.executar(operacao(op), a.cod, x, ctxOperacao(a, login), { escritor: e });
    return { login, exec };
  }
  const saidaSetor = async (e: Escritor, item: number, quantidade: number) => ({
    destino: 2,
    origem: 'E',
    local: LOCAL_CENTRAL,
    centroCusto: CENTRO_SETOR,
    localConsumo: await localConsumo(e, CENTRO_SETOR),
    itens: [{ item, quantidade, lotes: [] }],
  });

  it('consolidação na ordem: F → T com o número do banco; o gatilho valoriza e baixa o estoque (regras 1, 2 e 5)', async () => {
    const it = await itemDaMassa(2);
    const antes = await retrato([it.item]);
    const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      const p = await preparo(e);
      const g0 = await estoqueDoItem(e, it.item);
      const x = await p.exec('suprimentos.registrarSaida', await saidaSetor(e, it.item, 1));
      const s = await saidaGravada(e, num(x.resultado['id']));
      const g1 = await estoqueDoItem(e, it.item);
      return {
        cabecalho: s.consolidado,
        numerado: s.chave.doc > 0,
        itens: s.itens.map((i) => i.consolidado),
        valorizado: s.itens.every((i) => i.vlrmed > 0),
        baixou: Math.round((g0 - g1) * 1000) / 1000,
      };
    });
    console.log(`[${a.cod}] consolidação: ${JSON.stringify(r)}`);
    expect(r).toEqual({ cabecalho: 'T', numerado: true, itens: ['T'], valorizado: true, baixou: 1 });
    expect(await retrato([it.item])).toEqual(antes);
  }, 600_000);

  it('saída a internado sem conta aberta e fora do escopo do usuário: recusadas em português (regras 7 e 13)', async () => {
    const it = await itemDaMassa(1);
    const antes = await retrato([it.item]);
    const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      const p = await preparo(e);
      const base = await saidaSetor(e, it.item, 1);
      const semConta = await codigo(
        p.exec('suprimentos.registrarSaida', {
          ...base,
          destino: 1,
          atendimento: await internacaoSemConta(e),
        }),
      );
      // Com conta, o mesmo item sai (a conta da internação é a do período).
      const comConta = await codigo(
        p.exec('suprimentos.registrarSaida', {
          ...base,
          destino: 1,
          atendimento: await internacaoComConta(e),
        }),
      );
      const fora = await preparo(e, { semEscopo: true });
      const escopo = await codigo(fora.exec('suprimentos.registrarSaida', base));
      return { semConta, comConta, escopo };
    });
    console.log(`[${a.cod}] conta e escopo: ${JSON.stringify(r)}`);
    expect(r.semConta).toBe('sem-conta-convenio');
    expect(r.comConta).toBe('gravou');
    expect(r.escopo).toMatch(/fora-do-escopo/);
    expect(await retrato([it.item])).toEqual(antes);
  }, 600_000);

  /** Outro terminal segura a linha do item (WITH LOCK) enquanto `fn` grava; devolve o código da gravação. */
  async function comItemTravado(item: number, fn: (e: Escritor) => Promise<unknown>): Promise<string> {
    let soltar: () => void = () => undefined;
    let pronto: () => void = () => undefined;
    const travada = new Promise<void>((r) => (pronto = r));
    const segurando = a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      await travarItem(e, item);
      pronto();
      await new Promise<void>((r) => (soltar = r));
    });
    await travada;
    try {
      return await codigo(a.nucleo.desfazendoNaCopia(ctx(a), fn));
    } finally {
      soltar();
      await segurando;
    }
  }

  it('LOCK TIMEOUT: outro terminal segura o item e a saída devolve "registro em edição", nada gravado', async () => {
    const it = await itemDaMassa(1);
    const antes = await retrato([it.item]);
    const c = await comItemTravado(it.item, async (e) => {
      const p = await preparo(e);
      await p.exec('suprimentos.registrarSaida', await saidaSetor(e, it.item, 1));
    });
    console.log(`[${a.cod}] item travado: ${c}`);
    expect(c).toBe('registro-em-edicao');
    expect(await retrato([it.item])).toEqual(antes);
  }, 600_000);

  it('concorrência: duas saídas do mesmo saldo; a segunda recebe a recusa em português e nada dela fica', async () => {
    const it = await itemDaMassa(1);
    const antes = await retrato([it.item]);
    let soltar: () => void = () => undefined;
    let pronto: () => void = () => undefined;
    const primeiraFeita = new Promise<void>((r) => (pronto = r));
    // A primeira leva todo o saldo do item no local e segura a transação aberta (sem confirmar).
    const primeira = a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      const p = await preparo(e);
      const r = await codigo(p.exec('suprimentos.registrarSaida', await saidaSetor(e, it.item, it.saldo)));
      pronto();
      await new Promise<void>((x) => (soltar = x));
      return r;
    });
    await primeiraFeita;
    let segunda: string;
    try {
      segunda = await codigo(
        a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
          const p = await preparo(e);
          await p.exec('suprimentos.registrarSaida', await saidaSetor(e, it.item, it.saldo));
        }),
      );
    } finally {
      soltar();
    }
    const r1 = await primeira;
    console.log(`[${a.cod}] concorrência: primeira=${r1} segunda=${segunda}`);
    expect(r1).toBe('gravou');
    // O executor relê o saldo travado: a segunda vê o saldo mudado (versão) ou a trava, ou o saldo que já não há.
    expect(['registro-em-edicao', 'conflito-versao', 'saldo-insuficiente']).toContain(segunda);
    expect(await retrato([it.item])).toEqual(antes);
  }, 600_000);

  it('devolução sobre outra devolução da mesma saída (a tela com o disponível antigo): relê e recusa o excesso', async () => {
    const it = await itemDaMassa(3);
    const antes = await retrato([it.item]);
    const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      const p = await preparo(e);
      const s = await p.exec('suprimentos.registrarSaida', await saidaSetor(e, it.item, 3));
      const g = await saidaGravada(e, num(s.resultado['id']));
      const chave = g.chave;
      const lancamento = g.itens[0]?.id ?? 0;
      // Por fora (outro terminal, depois da leitura da tela): uma devolução de 2 já registrada.
      const parcial = await codigo(
        p.exec('suprimentos.registrarDevolucao', {
          saida: chave,
          local: LOCAL_CENTRAL,
          itens: [{ lancamentoSaida: lancamento, item: it.item, quantidade: 2, lotes: [] }],
        }),
      );
      // A tela ainda mostra 3 disponíveis; a devolução de 3 relê o que ficou (1) e recusa.
      const excesso = await codigo(
        p.exec('suprimentos.registrarDevolucao', {
          saida: chave,
          local: LOCAL_CENTRAL,
          itens: [{ lancamentoSaida: lancamento, item: it.item, quantidade: 3, lotes: [] }],
        }),
      );
      return { parcial, excesso };
    });
    console.log(`[${a.cod}] por fora: ${JSON.stringify(r)}`);
    expect(r).toEqual({ parcial: 'gravou', excesso: 'quantidade-maior-que-a-saida' });
    expect(await retrato([it.item])).toEqual(antes);
  }, 600_000);

  it('LOCK TIMEOUT no cabeçalho: outra conexão segura a requisição aberta; o atendimento devolve "registro em edição"', async (t) => {
    const req = await a.nucleo.lerSomente(ctx(a), (l) =>
      requisicaoAberta(l, [LOCAL_CENTRAL, LOCAL_SATELITE, 80]),
    );
    if (!req || req.itens.length === 0) {
      console.log(`[${a.cod}] cabeçalho travado: nenhuma requisição aberta nos locais do escopo (pulado)`);
      t.skip();
      return;
    }
    const itens = req.itens.map((i) => i.item);
    const antes = await retrato(itens);
    let soltar: () => void = () => undefined;
    let pronto: () => void = () => undefined;
    const travada = new Promise<void>((r) => (pronto = r));
    const segurando = a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      await travarCabecalho(e, req);
      pronto();
      await new Promise<void>((r) => (soltar = r));
    });
    await travada;
    let c: string;
    try {
      c = await codigo(
        a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
          const p = await preparo(e);
          await p.exec('suprimentos.registrarSaida', {
            destino: 2,
            origem: 'E',
            local: req.local,
            centroCusto: req.cdc,
            localConsumo: await localConsumo(e, req.cdc),
            requisicao: { ano: req.ano, mes: req.mes, doc: req.doc },
            itens: req.itens.map((i) => ({ item: i.item, quantidade: 1, seq: i.seq, lotes: [] })),
          });
        }),
      );
    } finally {
      soltar();
      await segurando;
    }
    console.log(`[${a.cod}] cabeçalho travado: ${c}`);
    expect(c).toBe('registro-em-edicao');
    expect(await retrato(itens)).toEqual(antes);
  }, 600_000);

  it('a exceção do gatilho de saldo (consolidar o item de uma requisição sem estoque) chega como saldo-insuficiente (regra 4)', async () => {
    const it = await itemDaMassa(1);
    const antes = await retrato([it.item]);
    const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      const p = await preparo(e);
      // A requisição nasce com CONSOL='F' (cabeçalho e itens): o "outro sistema" zera o estoque e consolida o item.
      const x = await p.exec('suprimentos.requisitarMaterial', {
        destino: 2,
        local: LOCAL_CENTRAL,
        centroCusto: CENTRO_SETOR,
        localConsumo: await localConsumo(e, CENTRO_SETOR),
        itens: [{ item: it.item, quantidade: 1 }],
      });
      const g = await saidaGravada(e, num(x.resultado['id']));
      try {
        await consolidarSemEstoque(e, g.chave, it.item);
        return { codigo: 'gravou', detail: '', antes: g.itens.map((i) => i.consolidado) };
      } catch (y) {
        const t = problemaDoLegado(y).problema;
        return { codigo: t.codigo, detail: t.detail, antes: g.itens.map((i) => i.consolidado) };
      }
    });
    console.log(`[${a.cod}] gatilho: ${r.codigo}`);
    expect(r.antes).toEqual(['F']);
    expect(r.codigo).toBe('saldo-insuficiente');
    expect(r.detail).not.toMatch(/exception|TRG_|E_GE/i);
    expect(await retrato([it.item])).toEqual(antes);
  }, 600_000);

  it('CP1252: a observação acentuada da saída grava e relê igual; o emoji é recusado', async () => {
    const it = await itemDaMassa(1);
    const antes = await retrato([it.item]);
    const texto = 'Ação Médica ç é ã õ º';
    const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      const p = await preparo(e);
      const base = await saidaSetor(e, it.item, 1);
      const x = await p.exec('suprimentos.registrarSaida', { ...base, observacao: texto });
      const relida = await observacaoDaSaida(e, num(x.resultado['id']));
      const emoji = await codigo(
        p.exec('suprimentos.registrarSaida', { ...base, observacao: 'Entrega \u{1F600}' }),
      );
      return { relida: relida.trim(), emoji };
    });
    console.log(`[${a.cod}] cp1252: igual=${r.relida === texto} emoji=${r.emoji}`);
    expect(r.relida).toBe(texto);
    expect(r.emoji).not.toBe('gravou');
    expect(await retrato([it.item])).toEqual(antes);
  }, 600_000);

  it('transferência em dois passos: o envio e o cancelamento conferem o escopo de local relido na transação (regra 13)', async () => {
    const it = await itemDaMassa(1);
    const antes = await retrato([it.item]);
    const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      const dono = await preparo(e);
      const fora = await preparo(e, { semEscopo: true });
      const envio = {
        hospital: a.cod,
        origem: LOCAL_CENTRAL,
        destino: LOCAL_SATELITE,
        observacao: null,
        itens: [{ item: it.item, quantidade: 1, lotes: [] }],
      };
      const semEscopo = await codigo(enviarTransferenciaSgh(e, { ...envio, usuario: fora.login }));
      const id = await enviarTransferenciaSgh(e, { ...envio, usuario: dono.login });
      const cancelarFora = await codigo(
        cancelarTransferenciaSgh(e, { hospital: a.cod, id, motivo: 'teste de escopo', usuario: fora.login }),
      );
      const cancelarDono = await codigo(
        cancelarTransferenciaSgh(e, { hospital: a.cod, id, motivo: 'teste de escopo', usuario: dono.login }),
      );
      return { semEscopo, cancelarFora, cancelarDono };
    });
    console.log(`[${a.cod}] envio e escopo: ${JSON.stringify(r)}`);
    expect(r).toEqual({
      semEscopo: 'local-fora-do-escopo',
      cancelarFora: 'local-fora-do-escopo',
      cancelarDono: 'gravou',
    });
    expect(await retrato([it.item])).toEqual(antes);
  }, 600_000);

  it('ponto de pedido: o prazo e o estoque de segurança gravados voltam pela leitura da porta (a mesma chave)', async () => {
    const it = await itemDaMassa(1);
    const antes = await retrato([it.item]);
    const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      const p = await preparo(e);
      await definirPontoPedidoSgh(e, {
        hospital: a.cod,
        item: it.item,
        local: LOCAL_CENTRAL,
        prazoDias: 37,
        estoqueSeguranca: 12.5,
        usuario: p.login,
      });
      const doLocal = await pontosPedidoDefinidos(e, a.cod, LOCAL_CENTRAL);
      const todos = await pontosPedidoDefinidos(e, a.cod);
      return {
        doLocal: doLocal.get(chavePonto(it.item, LOCAL_CENTRAL)),
        todos: todos.get(chavePonto(it.item, LOCAL_CENTRAL)),
      };
    });
    expect(r.doLocal).toEqual({ prazoDias: 37, estoqueSeguranca: 12.5 });
    expect(r.todos).toEqual({ prazoDias: 37, estoqueSeguranca: 12.5 });
    expect(await retrato([it.item])).toEqual(antes);
  }, 600_000);
});
