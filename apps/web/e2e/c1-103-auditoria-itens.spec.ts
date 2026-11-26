// E2E @C1-103 (ficha docs/fases/fichas/F3.7-faturamento.md, 06-FAT linha 21): a auditoria da conta item a item
// (/faturamento/contas/:id/auditoria-itens) pelo caminho da tela. Abre a auditoria da operadora com a empresa externa,
// dá o parecer no próprio item com o valor aceito calculado na hora pela regra do domínio (a glosa sem motivo e o item
// alterado sem justificativa seguram a gravação), mostra o valor auditado previsto antes de concluir, conclui num
// clique e a auditoria vai para as anteriores; o CNPJ da empresa externa é conferido na hora. As rotas de auditoria
// exigem o banco próprio e o E2E roda com a fonte sintética (sem núcleo): as respostas são simuladas pelo Playwright
// com massa SINTÉTICA. O efeito no banco (retrato antes e depois, parecer por item, quantidade e valor aceitos aplicados
// no item com memória, total refeito) está em apps/api/src/modulos/faturamento/auditoria-tramite-propria.int.spec.ts.
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const CONTA = 7403;
const AUDITORIA = 51;

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

type Pedido = { caminho: string; corpo: Record<string, unknown> };
type Parecer = {
  decisao: string;
  quantidadeAceita: number;
  valorAceito: number;
  valorGlosa: number;
  motivoGlosaId: number | null;
  justificativa: string | null;
};

const itens: {
  id: number;
  sequencia: number;
  codigo: string;
  descricao: string;
  quantidade: number;
  valorTotal: number;
  situacao: string;
  parecer: Parecer | null;
}[] = [];

async function simular(page: Page, pedidos: Pedido[]): Promise<void> {
  itens.splice(
    0,
    itens.length,
    {
      id: 801,
      sequencia: 1,
      codigo: '90000001',
      descricao: 'MATERIAL SINTETICO A',
      quantidade: 2,
      valorTotal: 100,
      situacao: 'lancado',
      parecer: null,
    },
    {
      id: 802,
      sequencia: 2,
      codigo: '90000002',
      descricao: 'PROCEDIMENTO SINTETICO B',
      quantidade: 1,
      valorTotal: 50,
      situacao: 'lancado',
      parecer: null,
    },
  );
  let auditoria: Record<string, unknown> | null = null;
  const historico: Record<string, unknown>[] = [
    {
      id: 40,
      modalidade: 'interna',
      situacao: 'concluida',
      resultado: 'sem_alteracao',
      empresa: null,
      auditor: 'AUDITOR SINTETICO',
      encerradaEm: '2026-01-10T10:00:00.000Z',
      valorOriginal: 150,
      valorAuditado: 150,
      glosaInterna: 0,
      observacao: null,
    },
  ];
  const corpo = (rota: Route): Record<string, unknown> =>
    (rota.request().postDataJSON() ?? {}) as Record<string, unknown>;
  const anotar = (rota: Route) => {
    const c = corpo(rota);
    pedidos.push({ caminho: new URL(rota.request().url()).pathname, corpo: c });
    return c;
  };

  await page.route(`**/api/faturamento/contas/${CONTA}/auditoria-itens`, (rota) =>
    json(rota, {
      contaId: CONTA,
      numero: 'C-7403',
      situacao: 'aberta',
      editavel: true,
      total: 150,
      auditoria,
      itens,
      motivosGlosa: [{ id: 7, codigo: 'G1', descricao: 'GLOSA SINTETICA' }],
      empresas: [{ id: 3, nome: 'AUDITORIA SINTETICA', cnpj: '11222333000181' }],
      historico,
    }),
  );
  await page.route(`**/api/faturamento/contas/${CONTA}/auditorias`, (rota) => {
    const c = anotar(rota);
    auditoria = {
      id: AUDITORIA,
      modalidade: c['modalidade'],
      empresa: 'AUDITORIA SINTETICA',
      auditor: 'AUDITOR SINTETICO',
      iniciadaEm: '2026-01-20T09:00:00.000Z',
      valorOriginal: 150,
      bloqueiaConta: Boolean(c['bloqueiaConta']),
    };
    return json(rota, { id: AUDITORIA }, 201);
  });
  await page.route(`**/api/faturamento/auditorias/${AUDITORIA}/pareceres`, (rota) => {
    const c = anotar(rota);
    const item = itens.find((i) => i.id === c['itemId'])!;
    const decisao = String(c['decisao']);
    const qa = decisao === 'mantido' ? item.quantidade : Number(c['quantidadeAceita']);
    const va = decisao === 'mantido' ? item.valorTotal : (item.valorTotal / item.quantidade) * qa;
    item.parecer = {
      decisao,
      quantidadeAceita: qa,
      valorAceito: va,
      valorGlosa: Math.max(0, item.valorTotal - va),
      motivoGlosaId: (c['motivoGlosaId'] as number | null) ?? null,
      justificativa: (c['justificativa'] as string | null) ?? null,
    };
    return json(rota, { id: 900 + item.id }, 201);
  });
  await page.route(`**/api/faturamento/auditorias/${AUDITORIA}/conclusao`, (rota) => {
    anotar(rota);
    historico.unshift({
      id: AUDITORIA,
      modalidade: 'operadora',
      situacao: 'concluida',
      resultado: 'com_glosa_interna',
      empresa: 'AUDITORIA SINTETICA',
      auditor: 'AUDITOR SINTETICO',
      encerradaEm: '2026-01-20T11:00:00.000Z',
      valorOriginal: 150,
      valorAuditado: 100,
      glosaInterna: 50,
      observacao: null,
    });
    auditoria = null;
    for (const i of itens) i.parecer = null;
    return json(rota, { valorAuditado: 100, resultado: 'com_glosa_interna' }, 201);
  });
}

test.describe('auditoria da conta item a item @C1-103', () => {
  test('abrir da operadora, parecer validado na hora, valor previsto e conclusão num clique; CNPJ conferido; axe', async ({
    page,
  }) => {
    const pedidos: Pedido[] = [];
    await simular(page, pedidos);
    await entrar(page, 'SINT.CONTAS');
    await page.goto(`/faturamento/contas/${CONTA}/auditoria-itens`);
    const tela = page.getByTestId('auditoria-itens');
    await expect(tela.getByRole('heading', { name: 'Auditoria da conta C-7403' })).toBeVisible();
    await expect(tela).toContainText('Nenhuma auditoria em andamento nesta conta.');
    await semViolacaoAxe(page, 'auditoria: abertura');

    // Abrir: a empresa externa só aparece fora da auditoria interna.
    await expect(page.getByTestId('aud-empresa')).toHaveCount(0);
    await escolher(page.getByTestId('aud-modalidade'), 'operadora');
    await escolher(page.getByTestId('aud-empresa'), { rotulo: 'AUDITORIA SINTETICA' });
    await page.getByTestId('aud-abrir-botao').click();
    await expect(page.getByTestId('aud-andamento')).toContainText('por AUDITORIA SINTETICA');
    expect(pedidos.at(-1)).toEqual({
      caminho: `/api/faturamento/contas/${CONTA}/auditorias`,
      corpo: { modalidade: 'operadora', empresaExternaId: 3, bloqueiaConta: false },
    });

    // Glosa interna no item 1: sem motivo não grava; a quantidade aceita refaz o valor na hora.
    await page.getByTestId('aud-parecer-1').click();
    const form = page.getByTestId('aud-form-parecer');
    await page.getByTestId('aud-decisao-glosado').check();
    await expect(form.getByRole('alert')).toContainText('Escolha o motivo da glosa.');
    await expect(page.getByTestId('aud-salvar-parecer')).toBeDisabled();
    await page.getByTestId('aud-qtd').fill('1');
    await escolher(page.getByTestId('aud-motivo'), { rotulo: /GLOSA SINTETICA/ });
    await page.getByTestId('aud-justificativa').fill('Quantidade sem prescrição sintética');
    await expect(page.getByTestId('aud-calculado')).toContainText(/1 · R\$\s50,00 · Glosa R\$\s50,00/);
    await expect(form.getByRole('alert')).toHaveCount(0);
    await semViolacaoAxe(page, 'auditoria: parecer');
    await page.getByTestId('aud-salvar-parecer').click();
    await expect(page.getByTestId('aud-form-parecer')).toHaveCount(0);
    await expect(page.getByTestId('aud-item-1')).toContainText('Glosa interna');
    expect(pedidos.at(-1)?.caminho).toBe(`/api/faturamento/auditorias/${AUDITORIA}/pareceres`);
    expect(pedidos.at(-1)?.corpo).toMatchObject({
      itemId: 801,
      decisao: 'glosado',
      quantidadeAceita: 1,
      motivoGlosaId: 7,
      justificativa: 'Quantidade sem prescrição sintética',
    });

    // Item 2: alterado sem justificativa não grava; mantido grava sem campos.
    await page.getByTestId('aud-parecer-2').click();
    await page.getByTestId('aud-decisao-alterado').check();
    await page.getByTestId('aud-qtd').fill('0.5');
    await expect(page.getByTestId('aud-form-parecer').getByRole('alert')).toContainText(
      'Diga por que o item foi alterado.',
    );
    await expect(page.getByTestId('aud-salvar-parecer')).toBeDisabled();
    await page.getByTestId('aud-decisao-mantido').check();
    await expect(page.getByTestId('aud-qtd')).toHaveCount(0);
    await page.getByTestId('aud-salvar-parecer').click();
    await expect(page.getByTestId('aud-item-2')).toContainText('Mantido');

    // Previsto antes de concluir: 150 − 50 = 100, glosa interna 50.
    await expect(page.getByTestId('aud-previsto')).toContainText(
      /Valor auditado previsto: R\$\s100,00 \(glosa interna R\$\s50,00\)/,
    );
    await page.getByTestId('aud-concluir').click();
    // O pedido só entra em 'pedidos' quando o fetch chega ao page.route: espera o efeito antes de conferir.
    await expect
      .poll(() => pedidos.at(-1)?.caminho)
      .toBe(`/api/faturamento/auditorias/${AUDITORIA}/conclusao`);
    await expect(page.getByTestId('aud-abrir')).toBeVisible();
    await expect(tela).toContainText('com_glosa_interna');
    await expect(tela).toContainText(/R\$\s150,00 → R\$\s100,00/);

    // Empresa externa: CNPJ conferido na hora.
    await tela.getByText('Empresas de auditoria externa').click();
    const empresa = page.getByTestId('aud-form-empresa');
    await empresa.getByLabel('CNPJ').fill('11.222.333/0001-00');
    await expect(empresa.getByRole('alert')).toContainText('CNPJ inválido.');
    await expect(empresa.getByRole('button', { name: 'Cadastrar empresa' })).toBeDisabled();
    await empresa.getByLabel('CNPJ').fill('11.222.333/0001-81');
    await expect(empresa.getByRole('alert')).toHaveCount(0);
    await expect(empresa.getByRole('button', { name: 'Cadastrar empresa' })).toBeEnabled();
    await semViolacaoAxe(page, 'auditoria: concluída');
  });
});
