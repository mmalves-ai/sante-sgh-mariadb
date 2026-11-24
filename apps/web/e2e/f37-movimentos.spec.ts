// F3.7 (06-FAT linhas 14, 15 e 16): equipe do item, cadastro e lançamento do kit e transferência de itens, pelo
// caminho da tela `/faturamento/contas/:id/movimentos`. Os movimentos exigem o banco próprio, e o E2E roda com a fonte
// sintética (sem núcleo): as respostas da API destas rotas são simuladas pelo Playwright com massa SINTÉTICA (estado
// mantido aqui, para a tela recarregar o que gravou). O que se prova é a tela: a validação da equipe na hora (o 1º
// auxiliar repetido trava o salvar), o valor previsto do ato pelo honorário, o pedido da equipe; o kit cadastrado na
// mesma tela (o fechado pede o item que o cobra) e lançado em seguida; os itens marcados transferidos com motivo e o
// histórico. Quem não edita regras de cobrança não vê o cadastro do kit. O efeito no banco está no contrato de efeito
// (apps/api/src/modulos/faturamento/conta-movimentos-propria.int.spec.ts).
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const CONTA = 7401;
const DESTINO = 7402;

async function entrar(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

const json = (rota: Route, corpo: unknown, status = 200) =>
  rota.fulfill({ status, contentType: 'application/json', body: JSON.stringify(corpo) });

type Estado = {
  kits: { id: number; codigo: string; descricao: string; modo: string }[];
  equipe: Record<string, unknown>[];
  transferencias: Record<string, unknown>[];
  transferidos: number[];
};

function movimentos(e: Estado) {
  const item = (id: number, sequencia: number, codigo: string, descricao: string, valor: number) => ({
    id,
    sequencia,
    codigo,
    descricao,
    quantidade: 1,
    valorTotal: valor,
    honorario: valor,
    situacao: e.transferidos.includes(id) ? 'transferido' : 'lancado',
    kitId: null,
    equipe: id === 801 ? e.equipe : [],
  });
  return {
    contaId: CONTA,
    numero: 'F374-SINT-1',
    situacao: 'aberta',
    editavel: true,
    fontePagadoraId: 61,
    fonte: 'Convênio Sintético A',
    itens: [
      item(801, 1, '83740001', 'Procedimento sintético', 1000),
      item(802, 2, '83740002', 'Curativo sintético', 80),
    ],
    funcoes: [
      {
        id: 1,
        codigo: 'CIR',
        descricao: 'Cirurgião',
        tipo: 'cirurgiao',
        ativo: true,
        percentual: null,
        grau: 0,
        ordemAuxiliar: null,
        ordemApresentacao: 1,
      },
      {
        id: 2,
        codigo: 'AUX1',
        descricao: '1º auxiliar',
        tipo: 'auxiliar',
        ativo: true,
        percentual: 30,
        grau: 1,
        ordemAuxiliar: 1,
        ordemApresentacao: 2,
      },
    ],
    graus: [],
    kits: e.kits,
    profissionais: [
      { id: 31, nome: 'Profissional Sintético Um' },
      { id: 32, nome: 'Profissional Sintético Dois' },
      { id: 33, nome: 'Profissional Sintético Três' },
    ],
    destinos: [
      {
        id: DESTINO,
        numero: 'F374-SINT-2',
        situacao: 'aberta',
        fonte: 'Convênio Sintético B',
        outroEstabelecimento: false,
        aberta: true,
      },
    ],
    transferencias: e.transferencias,
  };
}

async function simular(page: Page, e: Estado, enviados: Record<string, unknown>[]): Promise<void> {
  await page.route(`**/api/faturamento/contas/${CONTA}/movimentos`, (r) => json(r, movimentos(e)));
  await page.route('**/api/faturamento/profissionais-equipe**', (r) => json(r, []));
  await page.route('**/api/faturamento/itens-cobranca**', (r) =>
    json(r, [
      { id: 901, codigo: '83740004', descricao: 'Kit curativo sintético' },
      { id: 902, codigo: '83740005', descricao: 'Gaze sintética' },
    ]),
  );
  await page.route('**/api/faturamento/itens/801/equipe', (r) => {
    const corpo = r.request().postDataJSON() as { participantes: Record<string, unknown>[] };
    enviados.push({ equipe: corpo });
    e.equipe = corpo.participantes.map((p, k) => ({
      sequencia: k + 1,
      profissionalId: p['profissionalId'],
      nome: `Profissional ${String(p['profissionalId'])}`,
      funcaoId: p['funcaoId'],
      grauId: null,
      percentual: p['funcaoId'] === 1 ? 100 : 30,
      formaPagamento: 'via_hospital',
      valorAto: p['funcaoId'] === 1 ? 1000 : 300,
    }));
    return json(r, { itemId: 801, participantes: corpo.participantes.length });
  });
  await page.route('**/api/faturamento/kits', (r) => {
    const corpo = r.request().postDataJSON() as Record<string, unknown>;
    enviados.push({ kit: corpo });
    e.kits.push({
      id: 71,
      codigo: String(corpo['codigo']),
      descricao: String(corpo['descricao']),
      modo: String(corpo['modo']),
    });
    return json(r, { id: 71, componentes: 1 }, 201);
  });
  await page.route(`**/api/faturamento/contas/${CONTA}/kits`, (r) => {
    enviados.push({ lancarKit: r.request().postDataJSON() });
    return json(r, { lancados: 1, semPreco: 0 }, 201);
  });
  await page.route(`**/api/faturamento/contas/${CONTA}/transferencias`, (r) => {
    const corpo = r.request().postDataJSON() as { itens: number[]; motivo: string };
    enviados.push({ transferencia: corpo });
    e.transferidos.push(...corpo.itens);
    e.transferencias.push({
      id: 1,
      numero: 1,
      tipo: 'fonte_pagadora',
      saiu: true,
      outraConta: DESTINO,
      motivo: corpo.motivo,
      em: '2026-11-24T10:00:00.000',
      valorOrigem: 80,
      valorDestino: 95,
      situacao: 'efetivada',
      itens: corpo.itens.length,
    });
    return json(r, { id: 1, itens: corpo.itens.length, semPreco: 0 }, 201);
  });
}

test.describe('equipe, kit e transferência da conta @F3.7', () => {
  test.setTimeout(180_000);

  test('equipe validada na hora e gravada, kit cadastrado e lançado na mesma tela, itens transferidos; axe', async ({
    page,
  }) => {
    const e: Estado = { kits: [], equipe: [], transferencias: [], transferidos: [] };
    const enviados: Record<string, unknown>[] = [];
    await entrar(page, 'SINT.CONTAS');
    await simular(page, e, enviados);
    await page.goto(`/faturamento/contas/${CONTA}/movimentos`);
    await expect(page.getByTestId('tela-movimentos-conta')).toBeVisible();
    await semViolacaoAxe(page, '/faturamento/contas/:id/movimentos');

    // Linha 15: equipe do item. O 1º auxiliar repetido trava o salvar na hora; retirado, o valor do ato sai pelo
    // honorário (30% de 1.000) e o pedido leva a equipe.
    await page.getByTestId('mov-equipe-1').click();
    const form = page.getByTestId('mov-form-equipe');
    for (const [k, prof, funcao] of [
      [0, 'Profissional Sintético Um', 'Cirurgião'],
      [1, 'Profissional Sintético Dois', '1º auxiliar'],
      [2, 'Profissional Sintético Três', '1º auxiliar'],
    ] as const) {
      await page.getByTestId('mov-incluir').click();
      const p = form.getByTestId(`mov-participante-${k}`);
      await escolher(p.getByTestId(`mov-profissional-${k}`), { rotulo: prof });
      await escolher(p.locator('.sgh-selecao').nth(1), { rotulo: funcao });
    }
    await expect(page.getByTestId('mov-erro-2')).toContainText('1º auxiliar já está na equipe');
    await expect(page.getByTestId('mov-salvar-equipe')).toBeDisabled();
    await form.getByTestId('mov-participante-2').getByRole('button').last().click();
    await expect(page.getByTestId('mov-salvar-equipe')).toBeEnabled();
    await expect(form.getByTestId('mov-participante-1')).toContainText('300,00');
    await page.getByTestId('mov-salvar-equipe').click();
    await expect.poll(() => enviados.find((x) => 'equipe' in x)).toBeTruthy();
    expect(enviados.find((x) => 'equipe' in x)?.['equipe']).toEqual({
      participantes: [
        { profissionalId: 31, funcaoId: 1, grauId: null, percentual: null, formaPagamento: 'via_hospital' },
        { profissionalId: 32, funcaoId: 2, grauId: null, percentual: null, formaPagamento: 'via_hospital' },
      ],
    });
    await expect(page.getByTestId('mov-item-1')).toContainText('300,00');

    // Linha 16: sem kit para a fonte, o cadastro fica na própria tela. O fechado pede o item que cobra o kit.
    await expect(page.getByTestId('mov-form-kit')).toHaveCount(0);
    const cad = page.getByTestId('kit-cadastro');
    await cad.getByTestId('kit-codigo').fill('F374K');
    await cad.getByTestId('kit-descricao').fill('Kit curativo sintético');
    await escolher(cad.getByTestId('kit-modo'), { rotulo: 'só o item do kit' });
    await cad.getByTestId('kit-busca').fill('8374');
    await cad.getByTestId('kit-buscar').click();
    await cad.getByTestId('kit-incluir').click();
    await escolher(cad.getByTestId('kit-componente-item-0'), { rotulo: '83740005 · Gaze sintética' });
    await expect(cad.getByTestId('kit-erro-item')).toBeVisible();
    await expect(cad.getByTestId('kit-salvar')).toBeDisabled();
    await escolher(cad.getByTestId('kit-item'), { rotulo: '83740004 · Kit curativo sintético' });
    await expect(cad.getByTestId('kit-salvar')).toBeEnabled();
    await cad.getByTestId('kit-salvar').click();
    await expect.poll(() => enviados.find((x) => 'kit' in x)).toBeTruthy();
    expect(enviados.find((x) => 'kit' in x)?.['kit']).toMatchObject({
      codigo: 'F374K',
      modo: 'fechado',
      itemId: 901,
      fontePagadoraId: 61,
      componentes: [{ itemId: 902, quantidade: 1, inclusoNoPacote: true }],
    });
    await expect(page.getByTestId('mov-aviso')).toContainText('F374K');
    await escolher(page.getByTestId('mov-kit'), { rotulo: /F374K/ });
    await page.getByTestId('mov-lancar-kit').click();
    await expect.poll(() => enviados.find((x) => 'lancarKit' in x)).toBeTruthy();
    expect(enviados.find((x) => 'lancarKit' in x)?.['lancarKit']).toEqual({ kitId: 71, vezes: 1 });

    // Linha 14: itens marcados vão para a conta da outra fonte, com motivo; o histórico mostra a transferência.
    await expect(page.getByTestId('mov-transferir')).toBeDisabled();
    await page.getByTestId('mov-item-2').getByRole('checkbox').check();
    await escolher(page.getByTestId('mov-destino'), { rotulo: /F374-SINT-2/ });
    await page.getByTestId('mov-motivo').fill('Troca de convênio sintética');
    await page.getByTestId('mov-transferir').click();
    await expect.poll(() => enviados.find((x) => 'transferencia' in x)).toBeTruthy();
    expect(enviados.find((x) => 'transferencia' in x)?.['transferencia']).toEqual({
      contaDestinoId: DESTINO,
      itens: [802],
      motivo: 'Troca de convênio sintética',
    });
    await expect(page.getByTestId('mov-historico')).toContainText('Saiu para a conta 7402');
    await expect(page.getByTestId('mov-item-2')).toContainText('transferido');
    await semViolacaoAxe(page, '/faturamento/contas/:id/movimentos (depois)');
  });

  test('quem não edita regras de cobrança não vê o cadastro do kit', async ({ page }) => {
    const e: Estado = { kits: [], equipe: [], transferencias: [], transferidos: [] };
    await entrar(page, 'SINT.TISS');
    await simular(page, e, []);
    await page.goto(`/faturamento/contas/${CONTA}/movimentos`);
    await expect(page.getByTestId('tela-movimentos-conta')).toBeVisible();
    await expect(page.getByTestId('kit-cadastro')).toHaveCount(0);
  });
});
