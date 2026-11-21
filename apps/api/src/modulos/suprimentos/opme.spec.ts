// OPME pela HTTP (M46, etapa 3; ficha, seções 5, 7 e 8; regras 6 a 9 e 13): a sessão real sobre a fonte sintética, o
// centro cirúrgico e o OPME EM MEMÓRIA (nada conecta a banco; dados SINTÉTICOS), o relógio fixo em 2026-10-21 09:00. A
// cirurgia 704 (sala 3, paciente internado) dois dias úteis adiante; a 701 (sem internação) para a recusa do consumo.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { montarAppSuprimentos, type Sessao } from './suprimentos-http.spec-util.js';

const AG = 704;
const ITEM = 950001;
const O = '/api/suprimentos/opme';
let a: Awaited<ReturnType<typeof montarAppSuprimentos>>;
let bloco: Sessao;
let opme: Sessao;
let circ: Sessao;
let fat: Sessao;

beforeAll(async () => {
  a = await montarAppSuprimentos();
  [bloco, opme, circ, fat] = await Promise.all([
    a.entrar('SINT.BLOCO'),
    a.entrar('SINT.OPME'),
    a.entrar('SINT.CIRCULANTE'),
    a.entrar('SINT.FATURISTA.OPME'),
  ]);
});
afterAll(async () => {
  await a?.fechar();
});

const solicitar = (s: Sessao, x: Record<string, unknown> = {}) =>
  a.post(s, O, {
    agendamento: AG,
    item: ITEM,
    tuss: '70000014',
    quantidade: 2,
    fornecedor: 7001,
    justificativa: 'Fixação de fratura com placa e parafusos (sintético).',
    ...x,
  });
const solicitacoes = async () =>
  (await a.get(opme, `${O}?de=2026-10-21&ate=2026-10-31`)).json().solicitacoes as {
    id: number;
    versao: number;
    situacao: string;
    etapas: { etapa: string }[];
  }[];
const etapa = (s: Sessao, id: number, versaoVista: number, x: Record<string, unknown>) =>
  a.post(s, `${O}/${id}/etapas`, { solicitacao: id, versaoVista, em: '2026-10-21T08:30', ...x });
const consumir = (s: Sessao, x: Record<string, unknown> = {}, chave?: string) =>
  a.post(
    s,
    `${O}/cirurgias/${AG}/consumos`,
    {
      agendamento: AG,
      item: ITEM,
      quantidade: 1,
      local: 10,
      lote: 'L-77',
      fabricante: 'Fabricante Sintético',
      registroAnvisa: '80123450001',
      validade: '2028-01-31',
      ...x,
    },
    chave,
  );

describe('solicitação e etapas do OPME (regra 6)', () => {
  it('o cirurgião (bloco) pede o OPME ligado à agenda; o item fora da classe e o TUSS inválido recusam', async () => {
    const r = await solicitar(bloco);
    expect(r.statusCode).toBe(201);
    expect(r.json().mensagem).toBe('OPME solicitado.');
    expect((await solicitar(bloco, { item: 950090 })).json().codigo).toBe('item-nao-opme');
    expect((await solicitar(bloco, { tuss: '123' })).statusCode).toBe(400);
    expect((await solicitar(circ)).statusCode).toBe(403);
    const [s] = await solicitacoes();
    expect(s).toMatchObject({ situacao: 'solicitada', etapas: [{ etapa: 'solicitacao' }] });
    const t = a.trilha.eventos.filter((e) => e.evento === 'suprimentos.opme.solicitado');
    expect(t.length).toBeGreaterThanOrEqual(1);
  });

  it('a autorização da operadora (senha e guia) só por quem autoriza; a versão antiga recusa; a ordem das etapas', async () => {
    const [s] = await solicitacoes();
    expect(
      (await etapa(opme, s!.id, s!.versao, { etapa: 'pedido', pedido: { ano: 2026, doc: 9 } })).json().codigo,
    ).toBe('etapa-fora-de-ordem');
    expect((await etapa(opme, s!.id, s!.versao, { etapa: 'autorizacao', quantidade: 2 })).json().codigo).toBe(
      'sem-senha',
    );
    const ok = await etapa(opme, s!.id, s!.versao, {
      etapa: 'autorizacao',
      quantidade: 2,
      senha: 'SENHA-SINT',
      guia: '445566',
      validade: '2026-12-31',
    });
    expect(ok.statusCode).toBe(201);
    expect((await etapa(opme, s!.id, s!.versao, { etapa: 'cme' })).json().codigo).toBe('opme-mudou');
    const [s2] = await solicitacoes();
    expect(s2).toMatchObject({ situacao: 'autorizada' });
    // O fornecedor da consignação tem de existir no cadastro.
    expect(
      (await etapa(opme, s2!.id, s2!.versao, { etapa: 'consignacao', fornecedor: 7 })).json().codigo,
    ).toBe('fornecedor-inexistente');
    expect(
      (await etapa(opme, s2!.id, s2!.versao, { etapa: 'consignacao', fornecedor: 7001 })).statusCode,
    ).toBe(201);
    const [s3] = await solicitacoes();
    expect(
      (await etapa(opme, s3!.id, s3!.versao, { etapa: 'cme', em: '2026-10-21T10:00' })).json().codigo,
    ).toBe('horario-futuro');
    expect((await etapa(opme, s3!.id, s3!.versao, { etapa: 'cme' })).statusCode).toBe(201);
    expect((await solicitacoes())[0]).toMatchObject({ situacao: 'cme' });
  });
});

describe('o fornecedor, o pedido e a nota fiscal conferidos no cadastro (ficha, seção 6)', () => {
  it('o fornecedor inexistente recusa a solicitação; a busca de fornecedores dá o código e o nome', async () => {
    expect((await solicitar(bloco, { fornecedor: 99 })).json().codigo).toBe('fornecedor-inexistente');
    const f = (await a.get(bloco, `${O}/fornecedores?termo=alfa`)).json();
    expect(f.itens).toEqual([{ codigo: 7001, nome: 'DISTRIBUIDORA SINTÉTICA ALFA LTDA' }]);
  });
});

describe('consumo em sala, etiqueta e devolução (regras 6, 7 e 13)', () => {
  it('a circulante vê a cirurgia; consome com o rastreio; a etiqueta em três vias; o reenvio relê', async () => {
    const ctx = (await a.get(circ, `${O}/cirurgias/${AG}`)).json();
    expect(ctx.agendamento).toMatchObject({ id: AG, atendimento: 77004 });
    expect(ctx.podeExcecao).toBe(false);
    expect(ctx.gravacao.operacoes.consumir.pode).toBe(true);
    const [s] = ctx.solicitacoes as { id: number; versao: number }[];
    const k = a.novaChave();
    const r = await consumir(circ, { solicitacao: s!.id }, k);
    expect(r.statusCode).toBe(201);
    const c = r.json();
    expect(c.etiqueta.vias).toEqual(['prontuario', 'paciente', 'faturamento']);
    expect(c.etiqueta.zpl).toContain('VIA FATURAMENTO');
    expect(c.etiqueta.zpl).toContain('TUSS 70000014');
    expect(c.etiqueta.zpl).not.toContain('PACIENTE SINTETICO OPME');
    const de = await consumir(circ, { solicitacao: s!.id }, k);
    expect(de.json()).toMatchObject({ consumo: c.consumo, repetida: true });
    const e2 = (await a.get(circ, `${O}/consumos/${c.consumo}/etiqueta`)).json();
    expect(e2.sha256).toBe(c.etiqueta.sha256);
    expect(a.trilha.eventos.some((x) => x.evento === 'suprimentos.opme.consumido')).toBe(true);
    expect((await solicitacoes())[0]).toMatchObject({ situacao: 'consumida' });
  });

  it('sem autorização: a circulante não pode; o supervisor registra com a justificativa (OPME_SEM_AUTORIZACAO)', async () => {
    expect((await consumir(circ, { lote: 'L-88' })).json().codigo).toBe('sem-autorizacao');
    expect((await consumir(opme, { lote: 'L-88' })).json().codigo).toBe('sem-justificativa');
    const r = await consumir(opme, { lote: 'L-88', justificativa: 'Urgência: material extra na fixação.' });
    expect(r.statusCode).toBe(201);
    expect(a.trilha.eventos.some((x) => x.evento === 'suprimentos.opme.semAutorizacao')).toBe(true);
    expect((await consumir(circ, { lote: null, serie: null })).statusCode).toBe(400);
    expect((await consumir(circ, { registroAnvisa: '12' })).statusCode).toBe(400);
  });

  it('a cirurgia sem internação recusa o consumo; a devolução até o consumido, com o motivo', async () => {
    const semReg = await a.post(circ, `${O}/cirurgias/701/consumos`, {
      agendamento: 701,
      item: ITEM,
      quantidade: 1,
      local: 10,
      lote: 'L-1',
      fabricante: 'Fab',
      registroAnvisa: '80123450001',
    });
    expect(semReg.json().codigo).toBe('sem-internacao');
    const ctx = (await a.get(circ, `${O}/cirurgias/${AG}`)).json();
    const [c] = ctx.consumos as { id: number }[];
    const dev = (q: number, motivo = 'Tamanho errado: não usado na cirurgia.') =>
      a.post(circ, `${O}/cirurgias/${AG}/devolucoes`, {
        agendamento: AG,
        consumo: c!.id,
        quantidade: q,
        motivo,
      });
    expect((await dev(1)).statusCode).toBe(201);
    expect((await dev(1)).json().codigo).toBe('devolucao-maior');
    expect((await solicitacoes())[0]).toMatchObject({ situacao: 'devolvida' });
  });
});

describe('conciliação com a conta e rastreio reverso (regras 8 e 9)', () => {
  it('o faturista vê o consumo devolvido, o autorizado e o sem cobrança, com o indicador', async () => {
    // A porta em memória carimba o consumo com o relógio real (como o CRIADO_EM do banco), não com o relógio fixo
    // da sessão: o período da conciliação é o dia real do registro (antes, o teste só passava em outubro de 2026).
    const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
    const r = (await a.get(fat, `${O}/conciliacao?de=${hoje}&ate=${hoje}`)).json();
    expect(r.linhas.map((l: { situacao: string }) => l.situacao).sort()).toEqual([
      'devolvido',
      'sem-cobranca',
    ]);
    expect(r.indicador).toEqual({ numerador: 1, denominador: 1, percentual: 100 });
    expect((await a.get(circ, `${O}/conciliacao`)).statusCode).toBe(403);
    expect((await a.get(fat, `${O}/conciliacao?de=2026-10-31&ate=2026-10-01`)).statusCode).toBe(400);
  });

  it('o rastreio reverso pelo lote e pela série (auditado); o lote é obrigatório ou a série', async () => {
    const r = (await a.get(opme, `${O}/rastreio?item=${ITEM}&lote=L-77`)).json();
    expect(r.expostos).toHaveLength(1);
    expect(r.expostos[0]).toMatchObject({ atendimento: 77004, lote: 'L-77' });
    expect(a.trilha.eventos.some((x) => x.evento === 'suprimentos.opme.rastreioReverso')).toBe(true);
    expect((await a.get(opme, `${O}/rastreio?item=${ITEM}`)).statusCode).toBe(400);
    expect((await a.get(circ, `${O}/rastreio?item=${ITEM}&lote=L-77`)).statusCode).toBe(403);
    // As saídas do lote no estoque com o atendimento: a do consumo em sala e a de outro caminho do estoque.
    expect(
      r.saidasEstoque.map((x: { atendimento: number; origem: string }) => [x.atendimento, x.origem]),
    ).toEqual([
      [77004, 'consumo-em-sala'],
      [77999, 'estoque'],
    ]);
    expect(r.saidasDoLote).toBe(2);
  });

  it('o rastreio só pelo lote ou pelo registro Anvisa (sem o item), como chega o alerta de tecnovigilância', async () => {
    const l = (await a.get(opme, `${O}/rastreio?lote=L-77`)).json();
    expect(l).toMatchObject({ item: null, saidasDoLote: 0, saidasEstoque: [] });
    expect(l.expostos).toHaveLength(1);
    const v = (await a.get(opme, `${O}/rastreio?registroAnvisa=80123450001`)).json();
    expect(v.expostos.length).toBeGreaterThanOrEqual(1);
    expect((await a.get(opme, `${O}/rastreio`)).statusCode).toBe(400);
  });

  it('os itens de OPME do local e as cirurgias do dia', async () => {
    const i = (await a.get(opme, `${O}/itens?termo=placa&local=10`)).json();
    expect(i.itens.map((x: { item: number }) => x.item)).toEqual([ITEM]);
    const c = (await a.get(opme, `${O}/cirurgias?data=${await solicitacoesDia()}`)).json();
    expect(c.cirurgias.find((x: { agendamento: number }) => x.agendamento === AG)).toMatchObject({
      solicitacoes: 1,
      consumos: 2,
    });
  });
});

async function solicitacoesDia(): Promise<string> {
  const [s] = (await a.get(opme, `${O}?de=2026-10-21&ate=2026-10-31`)).json().solicitacoes as {
    dataHora: string;
  }[];
  return s!.dataHora.slice(0, 10);
}

describe('correções da revisão: documentos conferidos, devolução ao local da saída e chave de outra cirurgia', () => {
  it('o pedido que não está nas compras e a nota que não está nas entradas recusam; os existentes passam', async () => {
    const r = await solicitar(bloco, {
      quantidade: 1,
      justificativa: 'Segunda placa (sintético), para o pedido.',
    });
    expect(r.statusCode).toBe(201);
    const id = r.json().id as number;
    const atual = async () => (await solicitacoes()).find((x) => x.id === id)!;
    let s = await atual();
    expect(
      (
        await etapa(opme, id, s.versao, {
          etapa: 'autorizacao',
          quantidade: 1,
          senha: 'SENHA-SINT2',
          guia: '445567',
          validade: '2026-12-31',
        })
      ).statusCode,
    ).toBe(201);
    s = await atual();
    expect(
      (await etapa(opme, id, s.versao, { etapa: 'pedido', pedido: { ano: 2026, doc: 8 } })).json().codigo,
    ).toBe('pedido-inexistente');
    expect(
      (await etapa(opme, id, s.versao, { etapa: 'pedido', pedido: { ano: 2026, doc: 9 } })).statusCode,
    ).toBe(201);
    s = await atual();
    expect(
      (await etapa(opme, id, s.versao, { etapa: 'nf', nf: { ano: 2026, mes: 10, doc: 54 } })).json().codigo,
    ).toBe('nf-inexistente');
    expect(
      (await etapa(opme, id, s.versao, { etapa: 'nf', nf: { ano: 2026, mes: 10, doc: 55 } })).statusCode,
    ).toBe(201);
    s = await atual();
    expect(s.etapas.map((e) => e.etapa)).toEqual(['solicitacao', 'autorizacao', 'pedido', 'nf']);
  });

  it('a devolução de um consumo feito de outro local (não o primeiro da lista) volta àquele local', async () => {
    const k = a.novaChave();
    const r = await consumir(
      opme,
      {
        local: 15,
        lote: 'L-15',
        justificativa: 'Urgência: material do segundo local (sintético).',
      },
      k,
    );
    expect(r.statusCode).toBe(201);
    const id = r.json().consumo as number;
    const d = await a.post(circ, `${O}/cirurgias/${AG}/devolucoes`, {
      agendamento: AG,
      consumo: id,
      quantidade: 1,
      motivo: 'Não usado: aberto por engano (sintético).',
    });
    expect(d.statusCode).toBe(201);
  });

  it('a chave de um consumo de outra cirurgia não devolve aquele consumo (nem mistura a etiqueta)', async () => {
    const k = a.novaChave();
    expect(
      (await consumir(opme, { lote: 'L-99', justificativa: 'Urgência: chave reaproveitada (sintético).' }, k))
        .statusCode,
    ).toBe(201);
    const outra = await a.post(
      circ,
      `${O}/cirurgias/701/consumos`,
      {
        agendamento: 701,
        item: ITEM,
        quantidade: 1,
        local: 10,
        lote: 'L-99',
        fabricante: 'Fab',
        registroAnvisa: '80123450001',
      },
      k,
    );
    expect(outra.json().codigo).toBe('chave-reutilizada');
  });
});

describe('liberação (POL-3)', () => {
  it('com a chave suprimentos.opme desligada, a solicitação fica em consulta', async () => {
    const d = await montarAppSuprimentos({ semChaves: ['suprimentos.opme'] });
    try {
      const s = await d.entrar('SINT.BLOCO');
      const r = await d.post(s, O, {
        agendamento: AG,
        item: ITEM,
        tuss: '70000014',
        quantidade: 1,
        justificativa: 'Fixação de fratura (sintético).',
      });
      expect(r.statusCode).toBe(403);
      expect(r.json().codigo).toBe('recurso-desligado');
    } finally {
      await d.fechar();
    }
  });
});
