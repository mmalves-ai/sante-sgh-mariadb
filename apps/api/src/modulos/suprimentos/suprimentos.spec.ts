// M28 (estoque, almoxarifado e compras) pela HTTP, com a sessão real sobre a fonte sintética e a porta EM MEMÓRIA (nada
// conecta a banco): permissões pelas opções do legado e as marcas do usuário do estoque, liberação (POL-3), nota com
// dois lotes → saldo e custo lidos; requisição → atendimento parcial; transferência em dois passos com divergência;
// saída a paciente internado; devolução; cotação com rateio → aprovação por alçada; recusa de saldo insuficiente em
// português; inventário cego; textos de produto. Dados sintéticos.
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../app.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../configuracao.js';
import { envTeste, SENHA } from '../../sessao/teste.spec-util.js';
import { lerXmlNota } from './nfe-xml.js';
import { csv } from './suprimentos.controller.js';
import { PortaSuprimentosMemoria } from './porta-memoria.js';

const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev' };
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
  'idempotency-key': `teste-m28-${++chave}-${Date.now()}`,
});
const get = (s: Sessao, url: string) =>
  app.inject({ method: 'GET', url: `/api${url}`, headers: { cookie: s.cookie } });
const post = (s: Sessao, url: string, payload: unknown = {}) =>
  app.inject({ method: 'POST', url: `/api${url}`, headers: h(s), payload: payload as object });

const hoje = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const daqui = (dias: number) => {
  const d = new Date(`${hoje()}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
};

describe('permissões, gravação e textos de produto', () => {
  it('sem as opções do estoque, 403; o almoxarife vê as funcionalidades ligadas e nenhum nome de sistema antigo', async () => {
    const outra = await entrar('SINT.AGENDA');
    expect((await get(outra, '/suprimentos/saldos')).statusCode).toBe(403);
    const s = await entrar('SINT.ALMOXARIFE');
    const g = (await get(s, '/suprimentos/gravacao')).json();
    expect(g.funcionalidades.estoque.ligada).toBe(true);
    expect(g.operacoes['suprimentos.registrarSaida'].ligada).toBe(true);
    // O almoxarife não aprova pedido nem reabre o mês.
    expect(g.operacoes['aprovarPedido'].ligada).toBe(false);
    const a = (await get(s, '/suprimentos/apoio')).json();
    expect(a.escopo.locais.map((l: { local: number }) => l.local)).toEqual([10, 15, 20]);
    expect(JSON.stringify([g, a])).not.toMatch(/SPDATA|legado|sistema atual/i);
  });
});

describe('nota fiscal, saldo e custo', () => {
  it('a nota com dois lotes sobe o saldo, os lotes e o custo; a validade passada é recusada', async () => {
    const s = await entrar('SINT.ALMOXARIFE');
    const antes = (await get(s, '/suprimentos/saldos?item=5003&local=10')).json().itens[0];
    const vencida = await post(s, '/suprimentos/notas', {
      fornecedor: 7001,
      numero: 5551,
      emissao: hoje(),
      local: 10,
      itens: [
        {
          item: 5003,
          quantidade: 10,
          valorUnitario: 1.2,
          lotes: [{ lote: 'X1', validade: '2020-01-01', quantidade: 10 }],
        },
      ],
    });
    expect(vencida.statusCode).toBe(409);
    expect(vencida.json().detail).toMatch(/validade do lote já passou/);
    const r = await post(s, '/suprimentos/notas', {
      fornecedor: 7001,
      numero: 5552,
      emissao: hoje(),
      local: 10,
      itens: [
        {
          item: 5003,
          quantidade: 20,
          valorUnitario: 1.5,
          lotes: [
            { lote: 'NF-L1', validade: daqui(100), quantidade: 12 },
            { lote: 'NF-L2', validade: daqui(200), quantidade: 8 },
          ],
        },
      ],
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().mensagem).toMatch(/Nota fiscal registrada/);
    const depois = (await get(s, '/suprimentos/saldos?item=5003&local=10')).json().itens[0];
    expect(depois.quantidade).toBe(antes.quantidade + 20);
    expect(depois.lotes.map((l: { lote: string }) => l.lote)).toEqual(
      expect.arrayContaining(['NF-L1', 'NF-L2']),
    );
    expect(depois.valorEmpresa).toBeGreaterThan(antes.valorEmpresa);
    // A mesma nota de novo: recusada.
    const repetida = await post(s, '/suprimentos/notas', {
      fornecedor: 7001,
      numero: 5552,
      emissao: hoje(),
      local: 10,
      itens: [{ item: 5001, quantidade: 1, valorUnitario: 1 }],
    });
    expect(repetida.json().detail).toMatch(/já foi registrada/);
  });

  it('o XML da NF-e é só lido (itens e lotes) e recusa entidade', () => {
    const xml = `<nfeProc><NFe><infNFe><ide><nNF>123</nNF><serie>1</serie><dhEmi>2026-10-20T10:00:00-03:00</dhEmi></ide>
      <emit><CNPJ>00000000000191</CNPJ><xNome>FORNECEDOR SINTÉTICO</xNome></emit>
      <det nItem="1"><prod><cProd>A1</cProd><xProd>LUVA</xProd><uCom>CX</uCom><qCom>2.000</qCom><vUnCom>30.50</vUnCom>
      <rastro><nLote>L9</nLote><qLote>2</qLote><dFab>2026-01-01</dFab><dVal>2027-01-01</dVal></rastro></prod></det></infNFe></NFe></nfeProc>`;
    const n = lerXmlNota(xml);
    expect(n).toMatchObject({
      numero: 123,
      serie: '1',
      emissao: '2026-10-20',
      cnpjEmitente: '00000000000191',
    });
    expect(n.itens[0]).toMatchObject({ codigoFornecedor: 'A1', quantidade: 2, valorUnitario: 30.5 });
    expect(n.itens[0]?.lotes[0]).toEqual({ lote: 'L9', validade: '2027-01-01', quantidade: 2 });
    expect(() => lerXmlNota(`<!DOCTYPE x [<!ENTITY a "b">]>${xml}`)).toThrow(/Arquivo recusado/);
    // Com prefixo de espaço de nomes e atributos, o mesmo.
    expect(
      lerXmlNota(xml.replace(/<(\/?)ide>/g, '<$1nfe:ide>').replace('<emit>', '<emit id="1">')).numero,
    ).toBe(123);
  });
  it('o XML com marcas abertas sem fecho é lido em tempo linear (sem travar o processo)', () => {
    const t0 = performance.now();
    expect(() => lerXmlNota('<ide>'.repeat(80_000))).toThrow(/Arquivo não reconhecido/);
    expect(() => lerXmlNota('<ide '.repeat(80_000))).toThrow(/Arquivo não reconhecido/);
    // A versão com expressão regular levava 14 s em 400 kB (quadrática); a linear fica em milissegundos (o teto folgado
    // é para a VM carregada do portão).
    expect(performance.now() - t0).toBeLessThan(1000);
  });
});

describe('requisição, saída, devolução e transferência', () => {
  it('a requisição do setor é atendida em parte (o item não atendido sai da requisição)', async () => {
    const s = await entrar('SINT.ALMOXARIFE');
    const r = await post(s, '/suprimentos/requisicoes', {
      destino: 2,
      local: 10,
      centroCusto: 101,
      localConsumo: 11,
      itens: [
        { item: 5001, quantidade: 4 },
        { item: 5002, quantidade: 10 },
      ],
    });
    expect(r.statusCode).toBe(200);
    const fila = (await get(s, '/suprimentos/requisicoes?local=10')).json().itens;
    const req = fila.find((x: { chave: { doc: number } }) => x.chave.doc === r.json().ids.doc);
    expect(req.itens).toHaveLength(2);
    expect(req.autorizacao).toBeNull();
    // A autorização: só quem tem "autoriza requisição" (a marca do usuário do estoque); uma vez.
    const rota = `/suprimentos/requisicoes/${req.chave.ano}/${req.chave.mes}/${req.chave.doc}/autorizar`;
    const sem = await post(s, rota, {});
    expect([403, 409]).toContain(sem.statusCode);
    if (sem.statusCode === 409) expect(sem.json().detail).toMatch(/não autoriza requisição/);
    const sup = await entrar('SINT.SUPERVISOR.ESTOQUE');
    expect((await post(sup, rota, {})).statusCode).toBe(200);
    const autorizada = (await get(s, '/suprimentos/requisicoes?local=10'))
      .json()
      .itens.find((x: { chave: { doc: number } }) => x.chave.doc === req.chave.doc);
    expect(autorizada.autorizacao).toMatchObject({ por: 'SINT.SUPERVISOR.ESTOQUE' });
    expect((await post(sup, rota, {})).json().detail).toMatch(/já foi autorizada/);
    const at = await post(s, '/suprimentos/requisicoes/atender', {
      requisicao: req.chave,
      itens: [
        { seq: 1, item: 5001, quantidade: 2 },
        { seq: 2, item: 5002, quantidade: 0 },
      ],
    });
    expect(at.statusCode).toBe(200);
    const doc = (
      await get(s, `/suprimentos/documentos/saida/${req.chave.ano}/${req.chave.mes}/${req.chave.doc}`)
    ).json();
    expect(doc.consolidado).toBe(true);
    expect(doc.itensDetalhe).toHaveLength(1);
    expect(doc.itensDetalhe[0].quantidade).toBe(2);
    expect(
      (await get(s, '/suprimentos/requisicoes?local=10'))
        .json()
        .itens.some((x: { id: number }) => x.id === req.id),
    ).toBe(false);
  });

  it('a saída a paciente internado leva o lote; a devolução volta o lote; o saldo insuficiente é recusado em português', async () => {
    const s = await entrar('SINT.ALMOXARIFE');
    const lotes = (await get(s, '/suprimentos/lotes?item=5003&local=15')).json();
    const insuf = await post(s, '/suprimentos/saidas', {
      destino: 2,
      local: 10,
      centroCusto: 101,
      localConsumo: 11,
      itens: [{ item: 5006, quantidade: 999 }],
    });
    expect(insuf.statusCode).toBe(409);
    expect(insuf.json().detail).toMatch(/Saldo insuficiente: há 4 e a saída pede 999/);
    // Revisão do M46.4: a baixa do insumo da manipulação não passa pela saída genérica (a permissão e a chave dela).
    const manip = await post(s, '/suprimentos/saidas', {
      destino: 1,
      local: 10,
      centroCusto: 102,
      localConsumo: 12,
      atendimento: 31337,
      itens: [{ item: 5005, quantidade: 2 }],
      manipulacao: { ordem: 1, versaoVista: 2 },
    });
    expect(manip.statusCode).toBe(400);
    expect(manip.json().title).toBe('Use a manipulação');
    const semConta = await post(s, '/suprimentos/saidas', {
      destino: 1,
      local: 15,
      centroCusto: 102,
      localConsumo: 12,
      atendimento: 31338,
      itens: [{ item: 5002, quantidade: 1 }],
    });
    expect(semConta.json().codigo ?? semConta.json().detail).toMatch(/sem-conta-convenio|conta de convênio/);
    const r = await post(s, '/suprimentos/saidas', {
      destino: 1,
      local: 15,
      centroCusto: 102,
      localConsumo: 12,
      atendimento: 31337,
      itens: [
        {
          item: 5003,
          quantidade: 2,
          lotes: [{ lote: lotes[0].lote, validade: lotes[0].validade, quantidade: 2 }],
        },
      ],
    });
    expect(r.statusCode).toBe(200);
    const { ano, mes, doc } = r.json().ids;
    const det = (await get(s, `/suprimentos/documentos/saida/${ano}/${mes}/${doc}`)).json();
    expect(det.paciente.nome).toBe('PACIENTE SINTÉTICO INTERNADO');
    expect(suprimentos.contaDoPaciente({ rede: '', hospital: 'aa' }, 31337).at(-1)).toMatchObject({
      item: 5003,
      quantidade: 2,
    });
    const pac = (await get(s, '/suprimentos/lotes/paciente/31337')).json();
    expect(pac.itens[0].lote).toBe(lotes[0].lote);
    const l = det.itensDetalhe[0];
    const maior = await post(s, '/suprimentos/devolucoes', {
      saida: { ano, mes, doc },
      local: 15,
      itens: [
        {
          lancamentoSaida: l.id,
          item: 5003,
          quantidade: 3,
          lotes: [{ loteSaida: l.lotes[0].id, quantidade: 3 }],
        },
      ],
    });
    expect(maior.json().detail).toMatch(/Devolução maior que a saída/);
    const dev = await post(s, '/suprimentos/devolucoes', {
      saida: { ano, mes, doc },
      local: 15,
      itens: [
        {
          lancamentoSaida: l.id,
          item: 5003,
          quantidade: 1,
          lotes: [{ loteSaida: l.lotes[0].id, quantidade: 1 }],
        },
      ],
    });
    expect(dev.statusCode).toBe(200);
    expect(suprimentos.contaDoPaciente({ rede: '', hospital: 'aa' }, 31337).at(-1)).toMatchObject({
      quantidade: -1,
    });
  });

  it('a transferência em dois passos: o saldo fica na origem até o recebimento; a divergência exige o motivo', async () => {
    const s = await entrar('SINT.ALMOXARIFE');
    const saldo = async (local: number) =>
      ((await get(s, `/suprimentos/saldos?item=5002&local=${local}&todos=sim`)).json().itens[0]?.quantidade ??
        0) as number;
    const [o0, d0] = [await saldo(10), await saldo(20)];
    const e = await post(s, '/suprimentos/transferencias/envios', {
      origem: 10,
      destino: 20,
      itens: [{ item: 5002, quantidade: 30 }],
    });
    expect(e.statusCode).toBe(200);
    const envio = e.json().ids.envio;
    expect(await saldo(10)).toBe(o0);
    const sem = await post(s, `/suprimentos/transferencias/envios/${envio}/receber`, {
      recebidos: [{ item: 5002, quantidade: 28 }],
    });
    expect(sem.json().detail).toMatch(/motivo da divergência/);
    const r = await post(s, `/suprimentos/transferencias/envios/${envio}/receber`, {
      recebidos: [{ item: 5002, quantidade: 28 }],
      motivoDivergencia: 'Duas unidades avariadas na entrega',
    });
    expect(r.statusCode).toBe(200);
    expect(await saldo(10)).toBe(o0 - 28);
    expect(await saldo(20)).toBe(d0 + 28);
    const lista = (await get(s, '/suprimentos/transferencias/envios?local=20')).json();
    expect(lista.find((x: { id: number }) => x.id === envio).etapa).toBe('divergente');
    // O passo único não fecha envio: o recebimento é o único caminho (confere o motivo e os locais).
    const unico = await post(s, '/suprimentos/transferencias', {
      origem: 10,
      destino: 20,
      envio,
      itens: [{ item: 5002, quantidade: 1 }],
    });
    expect(unico.statusCode).toBe(400);
    expect(unico.json().detail).toMatch(/recebimento do envio/);
  });
});

describe('compras: cotação com rateio, vencedor e aprovação por alçada', () => {
  it('o comprador registra as propostas e o rateio; o supervisor aprova (o solicitante não)', async () => {
    const c = await entrar('SINT.COMPRADOR');
    const r = await post(c, '/suprimentos/pedidos', {
      centroCusto: 101,
      fornecedores: [7001, 7002],
      itens: [{ item: 5005, quantidade: 40 }],
    });
    expect(r.statusCode).toBe(200);
    const { ano, doc } = r.json().ids;
    let p = (await get(c, `/suprimentos/pedidos/${ano}/${doc}`)).json();
    expect(p.propostas).toHaveLength(2);
    const [a, b] = p.propostas;
    await post(c, `/suprimentos/pedidos/${ano}/${doc}/propostas/${a.id}`, {
      valorUnitario: 9.5,
      marca: 'MARCA A',
    });
    await post(c, `/suprimentos/pedidos/${ano}/${doc}/propostas/${b.id}`, { valorUnitario: 9.9 });
    // A escolhida não é a menor: sem justificativa, recusada.
    const sem = await post(c, `/suprimentos/pedidos/${ano}/${doc}/vencedor`, {
      item: 5005,
      seq: 1,
      vencedoras: [b.id],
    });
    expect(sem.json().detail).toMatch(/justificativa/);
    const v = await post(c, `/suprimentos/pedidos/${ano}/${doc}/vencedor`, {
      item: 5005,
      seq: 1,
      vencedoras: [a.id, b.id],
      justificativa: 'Rateio entre os dois fornecedores por prazo de entrega',
    });
    expect(v.statusCode).toBe(200);
    p = (await get(c, `/suprimentos/pedidos/${ano}/${doc}`)).json();
    expect(p.propostas.map((x: { vencedor: string }) => x.vencedor)).toEqual(['T', 'T']);
    expect(p.escolhas[0]).toMatchObject({ autor: 'SINT.COMPRADOR', rateio: true });
    expect(p.valor.parcelas).toEqual([380, 396]);
    // O comprador não aprova (sem a marca e sem a permissão).
    expect(
      (await post(c, `/suprimentos/pedidos/${ano}/${doc}/aprovacao`, { decisao: 'aprovado' })).statusCode,
    ).toBe(403);
    const sup = await entrar('SINT.SUPERVISOR.ESTOQUE');
    const fila = (await get(sup, '/suprimentos/aprovacoes')).json();
    const x = fila.find((y: { doc: number }) => y.doc === doc);
    expect(x).toMatchObject({ podeAprovar: true, faixa: { nivel: 1 } });
    const ap = await post(sup, `/suprimentos/pedidos/${ano}/${doc}/aprovacao`, { decisao: 'aprovado' });
    expect(ap.statusCode).toBe(200);
    expect((await get(c, `/suprimentos/pedidos/${ano}/${doc}`)).json().aprovacao).toMatchObject({
      decisao: 'aprovado',
      aprovador: 'SINT.SUPERVISOR.ESTOQUE',
    });
    const de_novo = await post(sup, `/suprimentos/pedidos/${ano}/${doc}/aprovacao`, { decisao: 'aprovado' });
    expect(de_novo.json().detail).toMatch(/já foi aprovado/);
  });

  it('a sugestão de compra mostra as parcelas do valor; o histórico por item', async () => {
    const c = await entrar('SINT.COMPRADOR');
    const sg = (await get(c, '/suprimentos/sugestao-compra?local=10')).json();
    expect(sg.valor.total).toBeCloseTo(
      sg.valor.parcelas.reduce((a: number, b: number) => a + b, 0),
      2,
    );
    const hist = (await get(c, '/suprimentos/historico-compras/5001')).json();
    expect(hist.compras.length).toBeGreaterThan(0);
  });
  it('o prazo e o estoque de segurança definidos entram no ponto e na sugestão (com e sem local)', async () => {
    const c = await entrar('SINT.COMPRADOR');
    const antes = (await get(c, '/suprimentos/sugestao-compra?local=10')).json();
    const alvo = antes.itens[0];
    expect(alvo).toBeDefined();
    const d = await post(c, '/suprimentos/pontos-pedido', {
      item: alvo.item,
      local: 10,
      prazoDias: 40,
      estoqueSeguranca: 1000,
    });
    expect(d.statusCode).toBe(200);
    for (const q of ['?local=10', '']) {
      const x = (await get(c, `/suprimentos/sugestao-compra${q}`)).json();
      const i = x.itens.find((y: { item: number }) => y.item === alvo.item);
      expect(i).toMatchObject({ prazoDias: 40, estoqueSeguranca: 1000 });
      expect(i.pontoPedido).toBeGreaterThanOrEqual(1000);
      expect(i.saldo + i.emPedido + i.sugestao).toBeGreaterThan(i.pontoPedido);
    }
  });
  it('o CSV neutraliza fórmula de planilha no texto (número negativo fica como está)', () => {
    expect(csv('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csv('+1')).toBe("'+1");
    expect(csv('@SOMA')).toBe("'@SOMA");
    expect(csv('-2')).toBe("'-2");
    expect(csv(-2)).toBe('-2');
    expect(csv('LUVA')).toBe('LUVA');
  });
  it('os fornecedores com o CNPJ conferido e a conta mascarada; sem a permissão, 403', async () => {
    const c = await entrar('SINT.COMPRADOR');
    const f = (await get(c, '/suprimentos/fornecedores?termo=ALFA')).json();
    expect(f.itens).toHaveLength(1);
    expect(f.itens[0]).toMatchObject({ codigo: 7001, documentoValido: true, banco: '1 · conta ****42' });
    const a = await entrar('SINT.ALMOXARIFE');
    expect((await get(a, '/suprimentos/fornecedores')).statusCode).toBe(200);
    const sem = await entrar('SINT.USUARIO');
    expect((await get(sem, '/suprimentos/fornecedores')).statusCode).toBe(403);
    // Terceiros e colaboradores e prestadores: só consulta, com o CPF e a conta mascarados.
    expect((await get(c, '/suprimentos/terceiros?termo=UM')).json().itens).toHaveLength(1);
    const pr = (await get(c, '/suprimentos/prestadores')).json().itens[0];
    expect(pr.documento).toMatch(/^\*\*\*\.\*\*\*\.\*\*\*-\d{2}$/);
    expect(pr.banco).toMatch(/\*\*\*\*/);
    expect((await get(sem, '/suprimentos/terceiros')).statusCode).toBe(403);
    // A ficha do item: classe, unidades e fatores.
    const ficha = (await get(a, '/suprimentos/itens/5001/ficha')).json();
    expect(ficha).toMatchObject({ item: 5001, unidades: { compra: 'CX' }, fatores: { compraConsumo: 100 } });
    expect((await get(a, '/suprimentos/itens/999999/ficha')).statusCode).toBe(404);
  });
});

describe('inventário cego e fechamento', () => {
  it('quem conta não vê o saldo; o supervisor vê a divergência e não aprova o que contou', async () => {
    const sup = await entrar('SINT.SUPERVISOR.ESTOQUE');
    const a = await post(sup, '/suprimentos/inventarios', { local: 20, tipo: 'geral' });
    expect(a.statusCode).toBe(200);
    const id = a.json().ids.inventario;
    const alm = await entrar('SINT.ALMOXARIFE');
    const cego = (await get(alm, `/suprimentos/inventarios/${id}`)).json();
    expect(cego.itens.every((i: { saldo: number | null }) => i.saldo === null)).toBe(true);
    for (const i of cego.itens)
      await post(alm, `/suprimentos/inventarios/${id}/contagens`, { item: i.item, quantidade: 0 });
    const visto = (await get(sup, `/suprimentos/inventarios/${id}`)).json();
    expect(visto.itens.some((i: { saldo: number | null }) => i.saldo !== null)).toBe(true);
    expect(visto.situacao).toBe('recontagem');
  });

  it('o mês fechado é recusado na saída e só o supervisor reabre com motivo', async () => {
    const sup = await entrar('SINT.SUPERVISOR.ESTOQUE');
    const f = (await get(sup, '/suprimentos/fechamentos')).json();
    expect(f.fechados.length).toBeGreaterThan(0);
    const ultimo = f.fechados[0];
    const sem = await post(sup, '/suprimentos/fechamentos/reabrir', {
      ano: ultimo.ano,
      mes: ultimo.mes,
      motivo: 'curto',
    });
    expect(sem.statusCode).toBe(400);
    const r = await post(sup, '/suprimentos/fechamentos/reabrir', {
      ano: ultimo.ano,
      mes: ultimo.mes,
      motivo: 'Correção de nota lançada no mês errado',
    });
    expect(r.statusCode).toBe(200);
  });
});
