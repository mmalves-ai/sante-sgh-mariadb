// Consignados e manipulação pela HTTP (M46, etapa 4; ficha, seções 5, 7 e 8; regras 10, 11 e 13): a sessão real sobre a
// fonte sintética, o centro cirúrgico, o OPME, o consignado, o estoque e a manipulação EM MEMÓRIA (nada conecta a banco;
// dados SINTÉTICOS), o relógio fixo em 2026-10-21 09:00. O consumo consignado nasce do fluxo do OPME (a cirurgia 704,
// o item 950003 consignado do fornecedor 7001).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type AppBloco, montarAppBloco, type Sessao } from '../cirurgia/bloco-seguro.spec-util.js';

const C = '/api/suprimentos/consignados';
const M = '/api/farmacia/manipulacao';
const O = '/api/suprimentos/opme';
const AG = 704;
const ITEM = 950003;
const FORN = 7001;
let a: AppBloco;
let bloco: Sessao;
let opme: Sessao;
let circ: Sessao;
let consig: Sessao;
let farm: Sessao;
let farm2: Sessao;
let aux: Sessao;

beforeAll(async () => {
  a = await montarAppBloco();
  [bloco, opme, circ, consig, farm, farm2, aux] = await Promise.all([
    a.entrar('SINT.BLOCO'),
    a.entrar('SINT.OPME'),
    a.entrar('SINT.CIRCULANTE'),
    a.entrar('SINT.CONSIGNADO'),
    a.entrar('SINT.MANIPULACAO'),
    a.entrar('SINT.MANIPULACAO2'),
    a.entrar('SINT.AUXMANIP'),
  ]);
});
afterAll(async () => {
  await a?.fechar();
});

const painel = async (s: Sessao = consig) => (await a.get(s, C)).json();
const remessa = (x: Record<string, unknown> = {}, chave?: string) =>
  a.post(
    consig,
    `${C}/remessas`,
    {
      fornecedor: FORN,
      item: ITEM,
      quantidade: 3,
      nfNumero: '123456',
      nfSerie: '1',
      nfEmissao: '2026-10-20',
      lote: 'L-C1',
      validade: '2028-12-31',
      ...x,
    },
    chave,
  );
const repor = (x: Record<string, unknown>, chave?: string) =>
  a.post(consig, `${C}/reposicoes`, { fornecedor: FORN, item: ITEM, ...x }, chave);

describe('consignados (regra 10)', () => {
  it('a leitura pela permissão; a remessa do fornecedor, o reenvio relido e as recusas do cadastro', async () => {
    expect((await a.get(circ, C)).statusCode).toBe(403);
    const p = await painel();
    expect(p.indicador).toMatchObject({ consumos: 0, semFaturamento: 0 });
    expect(p.gravacao.operacoes.registrar.pode).toBe(true);
    const k = a.novaChave();
    const r = await remessa({}, k);
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ repetido: false, aviso: null });
    expect((await remessa({}, k)).json()).toMatchObject({ repetido: true, grupo: r.json().grupo });
    expect((await remessa({ fornecedor: 99 })).json().codigo).toBe('fornecedor-inexistente');
    expect((await remessa({ item: 959999 })).json().codigo).toBe('item-inexistente');
    expect((await remessa({ item: 950090 })).json().codigo).toBe('item-nao-consignavel');
    expect((await remessa({ lote: null })).statusCode).toBe(400);
    expect((await remessa({ validade: '2026-10-01' })).json().codigo).toBe('validade-no-passado');
    // A remessa de um item de OPME que não é de referência consignada passa com o aviso da regra da saída.
    const av = await remessa({ item: 950001, quantidade: 1 });
    expect(av.statusCode).toBe(201);
    expect(av.json().aviso).toMatch(/precisa de saldo/);
    expect((await a.post(circ, `${C}/remessas`, {})).statusCode).toBe(403);
    expect(a.trilha.eventos.some((x) => x.evento === 'suprimentos.consignado.remessa')).toBe(true);
  });

  it('o consumo em sala do OPME consignado entra no saldo e no indicador (numerador e denominador)', async () => {
    // O fluxo da etapa 3: a solicitação com o fornecedor, a autorização, a consignação e o consumo em sala.
    expect(
      (
        await a.post(bloco, O, {
          agendamento: AG,
          item: ITEM,
          tuss: '70000014',
          quantidade: 1,
          fornecedor: FORN,
          justificativa: 'Prótese consignada para a artroplastia (sintético).',
        })
      ).statusCode,
    ).toBe(201);
    const sol = async () =>
      (
        (await a.get(opme, `${O}?de=2026-10-21&ate=2026-10-31`)).json().solicitacoes as {
          id: number;
          versao: number;
          item: number;
        }[]
      ).find((s) => s.item === ITEM)!;
    const s1 = await sol();
    const etapa = (s: { id: number; versao: number }, x: Record<string, unknown>) =>
      a.post(opme, `${O}/${s.id}/etapas`, {
        solicitacao: s.id,
        versaoVista: s.versao,
        em: '2026-10-21T08:30',
        ...x,
      });
    expect(
      (
        await etapa(s1, {
          etapa: 'autorizacao',
          quantidade: 1,
          senha: 'SENHA-SINT',
          guia: '778899',
          validade: '2026-12-31',
        })
      ).statusCode,
    ).toBe(201);
    expect((await etapa(await sol(), { etapa: 'consignacao', fornecedor: FORN })).statusCode).toBe(201);
    const s3 = await sol();
    const c = await a.post(circ, `${O}/cirurgias/${AG}/consumos`, {
      agendamento: AG,
      solicitacao: s3.id,
      item: ITEM,
      quantidade: 1,
      local: 10,
      lote: 'L-C1',
      fabricante: 'Fabricante Sintético',
      registroAnvisa: '80123450002',
      validade: '2028-12-31',
    });
    expect(c.statusCode).toBe(201);
    const p = await painel();
    const linha = p.saldos.find(
      (x: { item: number; fornecedor: number }) => x.item === ITEM && x.fornecedor === FORN,
    );
    expect(linha).toMatchObject({
      remessas: 3,
      reposicoes: 0,
      consumidos: 1,
      devolvidos: 0,
      saldo: 2,
      aRepor: 1,
      aFaturar: 1,
    });
    expect(p.indicador).toMatchObject({ consumos: 1, semReposicao: 1, semFaturamento: 1 });
    expect(p.consumos[0]).toMatchObject({
      fornecedor: FORN,
      item: ITEM,
      quantidade: 1,
      reposicao: null,
      faturamento: null,
    });
  });

  it('a reposição e o faturamento ligam o consumo uma vez cada; a nota da entrada conferida; a devolução até o saldo', async () => {
    const [consumo] = (await painel()).consumos as { consumo: number }[];
    const k = a.novaChave();
    expect((await repor({ tipo: 'reposicao', consumos: [consumo!.consumo] }, k)).statusCode).toBe(201);
    expect((await repor({ tipo: 'reposicao', consumos: [consumo!.consumo] }, k)).json().repetido).toBe(true);
    expect((await repor({ tipo: 'reposicao', consumos: [consumo!.consumo] })).json().codigo).toBe(
      'consumo-ja-reposto',
    );
    expect(
      (await repor({ tipo: 'reposicao', consumos: [consumo!.consumo], fornecedor: 7002 })).json().codigo,
    ).toBe('consumo-de-outro-fornecedor');
    // Revisão do M46.4: as notas da entrada do fornecedor com o item, para a escolha da nota (sem digitar o documento).
    const notas = (await a.get(consig, `${C}/notas?fornecedor=${FORN}&item=${ITEM}`)).json();
    expect(
      notas.itens.map((n: { ano: number; mes: number; doc: number }) => `${n.ano}/${n.mes}/${n.doc}`),
    ).toEqual(['2026/10/55']);
    expect((await a.get(consig, `${C}/notas?fornecedor=7002&item=${ITEM}`)).json().itens).toEqual([]);
    expect((await a.get(consig, `${C}/notas?item=${ITEM}`)).statusCode).toBe(400);
    expect(
      (
        await repor({
          tipo: 'faturamento',
          consumos: [consumo!.consumo],
          nfEntrada: { ano: 2026, mes: 10, doc: 99 },
        })
      ).json().codigo,
    ).toBe('nf-inexistente');
    expect(
      (
        await repor({
          tipo: 'faturamento',
          consumos: [consumo!.consumo],
          nfEntrada: { ano: 2026, mes: 10, doc: 55 },
        })
      ).statusCode,
    ).toBe(201);
    let p = await painel();
    expect(
      p.saldos.find((x: { item: number; fornecedor: number }) => x.item === ITEM && x.fornecedor === FORN),
    ).toMatchObject({
      reposicoes: 1,
      saldo: 3,
      aRepor: 0,
      aFaturar: 0,
    });
    expect(p.indicador).toMatchObject({ consumos: 1, semReposicao: 0, semFaturamento: 0 });
    expect(p.consumos[0].faturamento.nf).toEqual({ ano: 2026, mes: 10, doc: 55 });
    expect(
      (await repor({ tipo: 'devolucao', quantidade: 5, motivo: 'Material não usado no mês' })).json().codigo,
    ).toBe('acima-do-saldo');
    expect(
      (await repor({ tipo: 'devolucao', quantidade: 1, motivo: 'Material não usado no mês' })).statusCode,
    ).toBe(201);
    p = await painel();
    expect(
      p.saldos.find((x: { item: number; fornecedor: number }) => x.item === ITEM && x.fornecedor === FORN)
        .saldo,
    ).toBe(2);
    expect(p.movimentos.map((m: { tipo: string }) => m.tipo)).toEqual(
      expect.arrayContaining(['remessa', 'reposicao', 'faturamento', 'devolucao']),
    );
    for (const ev of ['reposicao', 'faturamento', 'devolucao'])
      expect(a.trilha.eventos.some((x) => x.evento === `suprimentos.consignado.${ev}`)).toBe(true);
  });
});

describe('manipulação (regra 11)', () => {
  const abrir = (x: Record<string, unknown> = {}, s: Sessao = farm, chave?: string) =>
    a.post(
      s,
      M,
      {
        itemPrescrito: 9_464_001,
        capela: 1,
        grupo: 1,
        insumo: 5005,
        local: 10,
        loteInsumo: 'CEF-10',
        validadeInsumo: '',
        quantidade: 2,
        dose: '1 g em 100 mL',
        validadeSobra: null,
        ...x,
      },
      chave,
    );
  let validadeLote = '';

  it('a fila só com os itens validados; as capelas; o insumo com o saldo e os lotes do local', async () => {
    const p = (await a.get(farm, M)).json();
    expect(p.itens.map((i: { itemPrescrito: number }) => i.itemPrescrito)).toEqual([9_464_001, 9_464_002]);
    expect(p.itens[0]).toMatchObject({ leito: 'UTI-03', iniciais: 'S.I.' });
    expect(p.capelas.map((c: { funcionando: boolean }) => c.funcionando)).toEqual([true, false]);
    expect(p.regraSobra.horasMaximas).toBe(24);
    expect(a.trilha.eventos.some((x) => x.evento === 'suprimentos.manipulacao.lida')).toBe(true);
    const s = (await a.get(farm, `${M}/insumos/5005?local=10`)).json().saldo;
    expect(s.rastreavel).toBe(true);
    validadeLote = s.lotes.find((l: { lote: string }) => l.lote === 'CEF-10').validade;
    expect((await a.get(circ, M)).statusCode).toBe(403);
  });

  it('a abertura: só do item validado, a capela em funcionamento e o grupo dela, o lote do local, a sobra pela regra', async () => {
    const v = { validadeInsumo: validadeLote };
    expect((await abrir({ ...v, itemPrescrito: 9_464_003 })).json().codigo).toBe('item-nao-validado');
    expect((await abrir({ ...v, capela: 2, grupo: null })).json().codigo).toBe('capela-parada');
    expect((await abrir({ ...v, grupo: 9 })).json().codigo).toBe('grupo-de-outra-capela');
    expect((await abrir({ ...v, loteInsumo: 'NAO-EXISTE' })).json().codigo).toBe('lote-fora-do-local');
    expect((await abrir({ ...v, quantidade: 500 })).json().codigo).toBe('acima-do-saldo');
    expect((await abrir({ ...v, validadeSobra: '2026-10-22T09:01' })).json().codigo).toBe(
      'sobra-acima-da-regra',
    );
    expect((await abrir({ ...v, validadeSobra: '2026-10-21T08:00' })).json().codigo).toBe('sobra-no-passado');
    const k = a.novaChave();
    const r = await abrir({ ...v, validadeSobra: '2026-10-21T21:00' }, farm, k);
    expect(r.statusCode).toBe(201);
    expect((await abrir({ ...v, validadeSobra: '2026-10-21T21:00' }, farm, k)).json().id).toBe(r.json().id);
    expect((await abrir(v)).json().codigo).toBe('ordem-em-curso');
    expect(a.trilha.eventos.some((x) => x.evento === 'suprimentos.manipulacao.aberta')).toBe(true);
  });

  it('a dupla conferência por outro farmacêutico; a versão antiga recusa; a baixa do insumo depois da conferência', async () => {
    const ordem = () =>
      a.get(farm, M) as Promise<{ json(): { ordens: { id: number; versao: number; situacao: string }[] } }>;
    const [o] = (await ordem()).json().ordens;
    const conferir = (s: Sessao, x: Record<string, unknown>) =>
      a.post(s, `${M}/${o!.id}/conferencias`, {
        ordem: o!.id,
        versaoVista: o!.versao,
        resultado: 'aprovada',
        ...x,
      });
    const baixar = (x: Record<string, unknown> = {}) =>
      a.post(farm, `${M}/${o!.id}/baixa`, {
        ordem: o!.id,
        versaoVista: o!.versao + 1,
        centroCusto: 102,
        ...x,
      });
    expect((await baixar({ versaoVista: o!.versao })).json().codigo).toBe('ordem-nao-conferida');
    expect((await conferir(farm, {})).json().codigo).toBe('mesma-pessoa');
    // Revisão do M46.4: a dupla conferência é do farmacêutico (a opção sozinha não basta).
    const semFarm = await conferir(aux, {});
    expect(semFarm.statusCode).toBe(403);
    expect(semFarm.json().codigo).toBe('categoria-nao-autorizada');
    expect((await a.get(aux, M)).json().gravacao.operacoes.conferir.pode).toBe(false);
    expect((await a.get(farm2, M)).json().gravacao.operacoes.conferir.pode).toBe(true);
    expect((await conferir(farm2, { resultado: 'reprovada' })).statusCode).toBe(400);
    expect((await conferir(farm2, {})).statusCode).toBe(201);
    expect(
      (await conferir(farm2, { resultado: 'reprovada', observacao: 'Volume diferente da prescrição' })).json()
        .codigo,
    ).toBe('manipulacao-mudou');
    expect(a.trilha.eventos.some((x) => x.evento === 'suprimentos.manipulacao.conferida')).toBe(true);
    expect((await baixar({ centroCusto: 9905 })).json().codigo).toBe('centro-custo-invalido');
    const b = await baixar();
    expect(b.statusCode).toBe(201);
    const [o2] = (await ordem()).json().ordens;
    expect(o2).toMatchObject({ id: o!.id, situacao: 'baixada' });
    expect((await baixar()).json().codigo).toBe('ordem-ja-baixada');
    // O item volta a aceitar uma ordem nova depois da baixa.
    expect((await a.get(farm, M)).json().itens[0].ordem).toBeNull();
  });
});
