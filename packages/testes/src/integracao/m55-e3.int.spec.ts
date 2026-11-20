// Etapa 3 do M55 sobre a cópia (ficha, seções 4, 5, 10 e 11), sempre em transação desfeita e sob a trava:
//   - as consultas do contrato (a lista, o detalhe com o saldo pelos IDs ligados, o painel e os candidatos do
//     fornecedor), com os tempos: só contagens e tempos;
//   - o pedido com contrato vencido recusado antes de gravar (nada no pedido nem no vínculo);
//   - o pedido e o título com contrato vigente pelo EXECUTOR (suprimentos.criarPedido e financeiro.criarTituloPagar com
//     o campo `contrato`): o vínculo na MESMA transação, relido; o saldo recalculado;
//   - a falha do vínculo depois da gravação do pedido desfaz os dois (o SAVEPOINT da operação);
//   - o alerta diário de vencimento (a leitura do worker com o fim vigente e o aviso na central uma vez por faixa);
//   - o ROLLBACK conferido pelas contagens das tabelas SGH_ do teste iguais antes e depois.
// Saída só com contagens, códigos e tempos (dados sintéticos).
import {
  candidatosVinculo,
  contratoPorId,
  contratosParaAlerta,
  gravarAviso,
  detalharContrato,
  ErroOperacao,
  listarContratos,
  operacao,
  painelContratos,
} from '@sgh/legado';
import { esquemaFiltroContratosFornecedor, EVENTOS_AUDITAVEIS } from '@sgh/contratos';
import { alertaDeVencimento } from '@sgh/dominio-suprimentos';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { aditivoDePrazoSintetico, contratoSintetico } from '../massa/contrato-sintetico.js';
import {
  CENTRO_SETOR,
  itemComSaldo,
  LOCAL_CENTRAL,
  usuarioEstoque,
} from '../massa/reproducao-suprimentos.js';
import { loginLivre, usuarioSintetico } from '../massa/sintetica.js';
import {
  type Ambiente,
  contar,
  ctx,
  ctxOperacao,
  num,
  PODE_ESCREVER,
  prepararAmbiente,
} from './escrita.spec-util.js';

type Escritor = Parameters<Parameters<Ambiente['nucleo']['desfazendoNaCopia']>[1]>[0];

const codigoDe = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'gravou';
  } catch (x) {
    if (x instanceof ErroOperacao) return x.problema.codigo ?? x.problema.type;
    throw x;
  }
};

describe.skipIf(!PODE_ESCREVER)('M55 etapa 3 na cópia (transação desfeita)', () => {
  let a: Ambiente;
  beforeAll(async () => {
    a = await prepararAmbiente();
  });
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  const retrato = () =>
    a.nucleo.lerSomente(ctx(a), async (l) => ({
      contrato: await contar(l, 'SELECT COUNT(*) N FROM SGH_SUP_CONTRATO'),
      evento: await contar(l, 'SELECT COUNT(*) N FROM SGH_SUP_CONTRATO_EVENTO'),
      vinculo: await contar(l, 'SELECT COUNT(*) N FROM SGH_SUP_CONTRATO_VINCULO'),
      gecadped: await contar(l, 'SELECT MAX(ID) N FROM GECADPED'),
      mfconpag: await contar(l, 'SELECT MAX(ID) N FROM MFCONPAG'),
    }));

  async function operador(e: Escritor): Promise<string> {
    const login = (await loginLivre(e, Date.now() % 1_000_000_000)).toUpperCase();
    await a.executor.executar(
      operacao('acesso.criarUsuarioIntegracao'),
      a.cod,
      usuarioSintetico('usuario-tecnico', login),
      ctxOperacao(a, 'SGH.TESTE'),
      { escritor: e },
    );
    await usuarioEstoque(e, login);
    return login;
  }

  async function fornecedorDePedido(e: Escritor): Promise<number> {
    const [f] = await e.consultar(
      `SELECT FIRST 1 c.FORN FROM GECADPED c WHERE c.ANO = 2026 AND c.OQUE = 'P' AND c.FORN > 0
        AND EXISTS (SELECT 1 FROM TBFORNEC t WHERE t.COD = c.FORN) GROUP BY c.FORN ORDER BY COUNT(*) DESC`,
      [],
      { teto: 1 },
    );
    return num(f?.['FORN']);
  }

  const pedido = async (e: Escritor, fornecedor: number, contrato: number) => {
    const x = await itemComSaldo(e, { local: LOCAL_CENTRAL, minimo: 1 });
    return {
      centroCusto: CENTRO_SETOR,
      tipoCompra: 'P',
      fornecedores: [fornecedor],
      itens: [{ item: x.item, quantidade: 3 }],
      contrato: { contrato },
    };
  };

  it('as consultas do contrato: lista, detalhe com o saldo, painel e candidatos (só contagens e tempos)', async () => {
    const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e: Escritor) => {
      const f = await fornecedorDePedido(e);
      const id = await contratoSintetico(e, { hospital: a.cod, fornecedor: f, usuario: 'SGH.TESTE' });
      const t: Record<string, number> = {};
      const medir = async <T>(nome: string, fn: () => Promise<T>) => {
        const i = performance.now();
        const v = await fn();
        t[nome] = Math.round(performance.now() - i);
        return v;
      };
      const lista = await medir('lista', () =>
        listarContratos(e, a.cod, esquemaFiltroContratosFornecedor.parse({})),
      );
      const det = await medir('detalhe', () => detalharContrato(e, a.cod, id));
      const painel = await medir('painel', () => painelContratos(e, a.cod));
      const c = (await contratoPorId(e, a.cod, id))!;
      const cand = await medir('candidatos', () => candidatosVinculo(e, a.cod, c));
      return {
        t,
        lista: lista.itens.length,
        faixa: det?.faixa,
        saldo: det?.saldo,
        ativos: painel.ativos,
        candidatos: cand.length,
      };
    });
    console.log(JSON.stringify(r));
    expect(r.lista).toBeGreaterThanOrEqual(1);
    expect(r.faixa).toBe('vigente');
    expect(r.saldo).toBe(9_999_999);
    expect(r.ativos).toBeGreaterThanOrEqual(1);
    expect(r.t['detalhe']).toBeLessThan(500);
  });

  it('o pedido com contrato vencido é recusado antes de gravar (nada no pedido nem no vínculo)', async () => {
    const antes = await retrato();
    const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e: Escritor) => {
      const login = await operador(e);
      const f = await fornecedorDePedido(e);
      const id = await contratoSintetico(e, {
        hospital: a.cod,
        fornecedor: f,
        usuario: 'SGH.TESTE',
        vencido: true,
      });
      const [g0] = await e.consultar('SELECT MAX(ID) N FROM GECADPED', [], { teto: 1 });
      const codigo = await codigoDe(
        a.executor.executar(
          operacao('suprimentos.criarPedido'),
          a.cod,
          await pedido(e, f, id),
          ctxOperacao(a, login),
          {
            escritor: e,
          },
        ),
      );
      const [g1] = await e.consultar('SELECT MAX(ID) N FROM GECADPED', [], { teto: 1 });
      const [v] = await e.consultar(
        'SELECT COUNT(*) N FROM SGH_SUP_CONTRATO_VINCULO WHERE ID_CONTRATO = ?',
        [id],
        { teto: 1 },
      );
      return { codigo, pedidos: num(g1?.['N']) - num(g0?.['N']), vinculos: num(v?.['N']) };
    });
    expect(r).toEqual({ codigo: 'contrato-vencido', pedidos: 0, vinculos: 0 });
    expect(await retrato()).toEqual(antes);
  });

  it('o pedido e o título com contrato vigente pelo executor: o vínculo na mesma transação e o saldo', async () => {
    const antes = await retrato();
    const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e: Escritor) => {
      const login = await operador(e);
      const f = await fornecedorDePedido(e);
      const id = await contratoSintetico(e, {
        hospital: a.cod,
        fornecedor: f,
        usuario: 'SGH.TESTE',
        valor: 50_000,
      });
      const p = (await a.executor.executar(
        operacao('suprimentos.criarPedido'),
        a.cod,
        await pedido(e, f, id),
        ctxOperacao(a, login),
        { escritor: e },
      )) as { resultado: Record<string, unknown> };
      const [v] = await e.consultar(
        "SELECT COUNT(*) N FROM SGH_SUP_CONTRATO_VINCULO WHERE ID_CONTRATO = ? AND TIPO = 'pedido' AND ID_LEGADO = ?",
        [id, num(p.resultado['id'])],
        { teto: 1 },
      );
      // O título do mesmo fornecedor: a classificação recente e um documento livre.
      const [c] = await e.consultar(
        `SELECT FIRST 1 g.GRUPO, g.SUBGRUPO, g.ITEM FROM MFLANGSI g WHERE g.TP_LAN = 0 AND g.DATA >= '2026-01-01'
          AND EXISTS (SELECT 1 FROM TBITEDES t WHERE t.GRUPO = g.GRUPO AND t.SUBGRUPO = g.SUBGRUPO AND t.ITEM = g.ITEM)
          ORDER BY g.DATA DESC`,
        [],
        { teto: 1 },
      );
      const [h] = await e.consultar('SELECT CAST(CURRENT_DATE AS VARCHAR(10)) H FROM RDB$DATABASE', [], {
        teto: 1,
      });
      const hoje = String(h?.['H']);
      const doc = 1_955_000_000 + (Date.now() % 9_999_999);
      const titulo = (await a.executor.executar(
        operacao('financeiro.criarTituloPagar'),
        a.cod,
        {
          acao: 'incluir',
          tipo: 'F',
          credor: f,
          documento: doc,
          serie: '1',
          emissao: hoje,
          valorDocumento: 2_000,
          referente: 'SINTETICO M55',
          parcelas: [
            { parcela: 1, vencimento: hoje, valor: 1_000 },
            { parcela: 2, vencimento: hoje, valor: 1_000 },
          ],
          classificacao: { grupo: num(c?.['GRUPO']), subgrupo: num(c?.['SUBGRUPO']), item: num(c?.['ITEM']) },
          contrato: { contrato: id },
        },
        ctxOperacao(a, login),
        { escritor: e },
      )) as { resultado: Record<string, unknown> };
      const [vt] = await e.consultar(
        "SELECT COUNT(*) N FROM SGH_SUP_CONTRATO_VINCULO WHERE ID_CONTRATO = ? AND TIPO = 'titulo'",
        [id],
        { teto: 1 },
      );
      const det = await detalharContrato(e, a.cod, id);
      return {
        pedido: num(v?.['N']),
        parcelas: num(titulo.resultado['parcelas']),
        titulos: num(vt?.['N']),
        saldo: det?.saldoDetalhe.titulosAvulsos,
        vinculos: det?.vinculos.length,
      };
    });
    expect(r).toEqual({ pedido: 1, parcelas: 2, titulos: 2, saldo: 2_000, vinculos: 3 });
    expect(await retrato()).toEqual(antes);
  });

  it('a falha do vínculo depois de gravar o pedido desfaz os dois (o SAVEPOINT da operação)', async () => {
    const antes = await retrato();
    const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e: Escritor) => {
      const login = await operador(e);
      const f = await fornecedorDePedido(e);
      const id = await contratoSintetico(e, { hospital: a.cod, fornecedor: f, usuario: 'SGH.TESTE' });
      const entrada = await pedido(e, f, id);
      const [g0] = await e.consultar('SELECT MAX(ID) N FROM GECADPED', [], { teto: 1 });
      // A linha do vínculo falha no banco (simulada no escritor): a operação inteira volta ao SAVEPOINT.
      const falhando: Escritor = {
        ...e,
        consultar: (s, p, o) => e.consultar(s, p, o),
        lerBlob: (b) => e.lerBlob(b),
        executarRetornando: (s, p) => e.executarRetornando(s, p),
        executar: (s, p) =>
          /INSERT INTO SGH_SUP_CONTRATO_VINCULO/.test(s)
            ? Promise.reject(new Error('falha simulada do vínculo'))
            : e.executar(s, p),
      };
      let falhou = false;
      try {
        await a.executor.executar(
          operacao('suprimentos.criarPedido'),
          a.cod,
          entrada,
          ctxOperacao(a, login),
          {
            escritor: falhando,
          },
        );
      } catch {
        falhou = true;
      }
      const [g1] = await e.consultar('SELECT MAX(ID) N FROM GECADPED', [], { teto: 1 });
      const [v] = await e.consultar(
        'SELECT COUNT(*) N FROM SGH_SUP_CONTRATO_VINCULO WHERE ID_CONTRATO = ?',
        [id],
        { teto: 1 },
      );
      return { falhou, pedidos: num(g1?.['N']) - num(g0?.['N']), vinculos: num(v?.['N']) };
    });
    expect(r).toEqual({ falhou: true, pedidos: 0, vinculos: 0 });
    expect(await retrato()).toEqual(antes);
  });

  it('a faixa, a ordem e a página da lista pelo fim vigente no banco (mais de 200 contratos); o alerta só até 90 dias', async () => {
    const antes = await retrato();
    const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e: Escritor) => {
      const f = await fornecedorDePedido(e);
      const base = { hospital: a.cod, fornecedor: f, usuario: 'SGH.TESTE' };
      // 201 vencidos há 10 dias: pelo fim original, enchem a primeira página antes do alvo.
      for (let i = 0; i < 201; i++) await contratoSintetico(e, { ...base, dias: -10 });
      // O alvo: o fim original vencido há 5 dias, o aditivo de prazo leva o fim vigente para daqui a 20 dias.
      const alvo = await contratoSintetico(e, { ...base, dias: -5 });
      await aditivoDePrazoSintetico(e, { hospital: a.cod, contrato: alvo, dias: 20, usuario: 'SGH.TESTE' });
      const longe = await contratoSintetico(e, { ...base, dias: 365 });
      const filtro = (x: Record<string, unknown>) =>
        esquemaFiltroContratosFornecedor.parse({ fornecedor: f, ...x });
      const i = performance.now();
      const v30 = await listarContratos(e, a.cod, filtro({ faixa: 'vence-30' }));
      const ms = Math.round(performance.now() - i);
      const venc1 = await listarContratos(e, a.cod, filtro({ faixa: 'vencido' }));
      const venc2 = await listarContratos(e, a.cod, filtro({ faixa: 'vencido', pagina: 2 }));
      const todos2 = await listarContratos(e, a.cod, filtro({ pagina: 2 }));
      const alerta = await contratosParaAlerta(e, a.cod);
      const fins = todos2.itens.map((c) => c.fim);
      return {
        ms,
        v30: v30.itens.map((c) => c.id),
        v30Cortada: v30.cortada,
        venc1: venc1.itens.length,
        venc1Cortada: venc1.cortada,
        venc1SoVencidos: venc1.itens.every((c) => c.faixa === 'vencido'),
        venc2: venc2.itens.length,
        todos2: todos2.itens.map((c) => c.id),
        todos2Ordem: fins.every((x, k) => k === 0 || fins[k - 1]! <= x),
        alertaAlvo: alerta.contratos.some((c) => c.id === alvo),
        alertaLonge: alerta.contratos.some((c) => c.id === longe),
        alvo,
        longe,
      };
    });
    console.log(JSON.stringify({ ms: r.ms, venc1: r.venc1, venc2: r.venc2 }));
    expect(r.v30).toEqual([r.alvo]);
    expect(r.v30Cortada).toBe(false);
    expect(r).toMatchObject({ venc1: 200, venc1Cortada: true, venc1SoVencidos: true, venc2: 1 });
    // Na página 2 sem filtro: o último vencido, o alvo (fim vigente em 20 dias) e o de 365 dias, nessa ordem.
    expect(r.todos2.slice(-2)).toEqual([r.alvo, r.longe]);
    expect(r.todos2Ordem).toBe(true);
    expect(r).toMatchObject({ alertaAlvo: true, alertaLonge: false });
    expect(await retrato()).toEqual(antes);
  });

  it('o alerta de vencimento: a leitura do worker com o fim vigente e o aviso na central uma vez por faixa', async () => {
    const antes = await retrato();
    const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e: Escritor) => {
      const f = await fornecedorDePedido(e);
      const id = await contratoSintetico(e, {
        hospital: a.cod,
        fornecedor: f,
        usuario: 'SGH.TESTE',
        vencido: true,
      });
      const i = performance.now();
      const lido = await contratosParaAlerta(e, a.cod);
      const ms = Math.round(performance.now() - i);
      const c = lido.contratos.find((x) => x.id === id)!;
      const faixa = alertaDeVencimento({ ...c, hoje: lido.hoje, faixaJaAvisada: null });
      const aviso = {
        rede: a.nucleo.rede,
        hospital: a.cod,
        login: c.gestor,
        tipo: 'contrato-vencimento',
        gravidade: 'atencao' as const,
        modulo: 'suprimentos',
        evento: EVENTOS_AUDITAVEIS.contratoAlertaVencimento.codigo,
        titulo: `Contrato ${c.numero} vencido`,
        link: '/suprimentos/contratos',
        objetoTabela: 'SGH_SUP_CONTRATO',
        objetoChave: `${id}:${c.fim}:${faixa}`,
      };
      const primeiro = await gravarAviso(e, aviso);
      const segundo = await gravarAviso(e, aviso);
      return {
        ms,
        ativos: lido.contratos.length,
        faixa,
        fimAntesDeHoje: c.fim < lido.hoje,
        primeiro: primeiro !== null,
        segundo,
      };
    });
    console.log(JSON.stringify({ ms: r.ms, ativos: r.ativos, faixa: r.faixa }));
    expect(r).toMatchObject({ faixa: 'vencido', fimAntesDeHoje: true, primeiro: true, segundo: null });
    expect(r.ms).toBeLessThan(500);
    expect(await retrato()).toEqual(antes);
  });
});
