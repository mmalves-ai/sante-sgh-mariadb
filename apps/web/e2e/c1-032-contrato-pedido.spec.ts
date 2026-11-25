// E2E @C1-032 (05-SUP linha 27): os contratos com fornecedores pelas rotas reais do módulo (o ContratoController
// registrado no modulo.ts) e o pedido de compra que nasce ligado ao contrato. Roda na sessão sintética de dev/ci (logins
// SINT.*, sem o núcleo): o modulo.ts liga a porta de suprimentos em memória aos contratos em memória, e o pedido com
// contrato grava o vínculo lá pelas mesmas regras da porta própria (conferirVinculoContrato), ou é recusado. O gestor de
// contratos abre a tela pelo menu, cadastra o contrato do fornecedor (vigência, valor, reajuste, gestor e fiscal); na
// tela dos pedidos, com um só fornecedor convidado, escolhe o contrato dele no combo, inclui o item e cria o pedido: o
// pedido nasce ligado e aparece entre os vínculos do contrato. Com dois fornecedores convidados, o combo do contrato
// some (o pedido ligado é de um fornecedor só). O efeito no MariaDB (pedido_compra e o histórico do contrato) está em
// apps/api/src/modulos/suprimentos/contrato-pedido-compra.int.spec.ts. Massa SINTÉTICA; nenhum dado de pessoa.
import { expect, type Page, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const FORNECEDOR = '7001';
const ITEM = '5001';

async function entrar(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

function dia(deslocamento: number): string {
  const d = new Date();
  d.setDate(d.getDate() + deslocamento);
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

async function escolherUsuario(page: Page, campo: string, login: string): Promise<void> {
  await page.getByTestId(`${campo}-termo`).fill(login);
  await page.getByTestId(`${campo}-buscar`).click();
  await escolher(page.getByTestId(campo), login);
}

test.describe('@C1-032 Pedido de compra ligado ao contrato do fornecedor', () => {
  test.describe.configure({ mode: 'serial', timeout: 240_000 });

  test('contrato pelo menu, pedido criado com o contrato no combo e o vínculo no contrato; axe', async ({
    page,
  }) => {
    vigiarExternas(page);
    const numero = `CT-C1032-${Date.now().toString(36).slice(-5).toUpperCase()}`;
    await entrar(page, 'SINT.CONTRATOS');

    // 1. A tela dos contratos pelo menu (rotas reais do módulo).
    const menu = page.getByRole('navigation', { name: 'Menu principal' });
    await menu.getByRole('button', { name: /^Suprimentos/ }).click();
    const compras = menu.getByRole('button', { name: /^Compras/ });
    if ((await compras.getAttribute('aria-expanded')) !== 'true') await compras.click();
    await menu.getByRole('link', { name: 'Contratos com fornecedores' }).click();
    await expect(page.getByTestId('tela-contratos')).toBeVisible();
    await expect(page.getByTestId('ctr-painel')).toBeVisible();

    // 2. O cadastro do contrato do fornecedor, vigente.
    await page.getByTestId('ctr-novo').click();
    await expect(page.getByTestId('contrato-formulario')).toBeVisible();
    await page.getByTestId('ctr-numero').fill(numero);
    await page.getByTestId('ctr-fornecedor-termo').fill(FORNECEDOR);
    await page.getByTestId('ctr-fornecedor-buscar').click();
    await escolher(page.getByTestId('ctr-fornecedor'), FORNECEDOR);
    await page.getByTestId('ctr-objeto').fill('Fornecimento sintético de material de consumo (teste C1-032)');
    await page.getByTestId('ctr-inicio').fill(dia(-30));
    await page.getByTestId('ctr-fim').fill(dia(335));
    await page.getByTestId('ctr-valor').fill('50.000,00');
    await escolher(page.getByTestId('ctr-indice'), 'ipca');
    await page.getByTestId('ctr-database').fill(dia(-30));
    await escolherUsuario(page, 'ctr-gestor', 'SINT.CONTRATOS');
    await escolherUsuario(page, 'ctr-fiscal', 'SINT.GERCOMPRAS');
    await page.getByTestId('ctr-gravar').click();
    await expect(page.getByTestId('ctr-det-painel').getByRole('heading').first()).toContainText(numero);
    await expect(page.getByTestId('ctr-det-saldo-valor')).toContainText('50.000,00');

    // 3. O pedido com dois fornecedores convidados não oferece contrato (o pedido ligado é de um fornecedor só).
    await page.goto('/suprimentos/pedidos');
    await expect(page.getByTestId('tela-suprimentos-pedidos')).toBeVisible();
    await page.getByTestId('ped-fornecedores').fill(`${FORNECEDOR}, 7002`);
    await expect(page.getByTestId('ped-contrato')).toHaveCount(0);

    // 4. Com um só fornecedor, o combo traz o contrato dele: escolhe, inclui o item e cria o pedido ligado.
    await page.getByTestId('ped-fornecedores').fill(FORNECEDOR);
    await escolher(page.getByTestId('ped-contrato'), { rotulo: new RegExp(numero) });
    await escolher(page.getByTestId('ped-centro'), { rotulo: /\S/ });
    await page.getByTestId('ped-busca-termo').fill(ITEM);
    await page.getByTestId('ped-busca-buscar').click();
    await page.getByTestId(`ped-busca-opcao-${ITEM}`).click();
    await page.getByTestId(`ped-qtde-${ITEM}`).fill('4');
    await semViolacaoAxe(page, 'pedido com contrato');
    const resposta = page.waitForResponse(
      (r) => r.url().endsWith('/api/suprimentos/pedidos') && r.request().method() === 'POST',
    );
    await page.getByTestId('ped-criar').click();
    const r = await resposta;
    expect(r.status()).toBeLessThan(300);
    const corpo = r.request().postDataJSON() as { contrato?: { contrato: number } };
    expect(corpo.contrato?.contrato).toBeGreaterThan(0);
    await expect(page.getByTestId('ped-mensagem')).toBeVisible();

    // 5. O contrato mostra o pedido entre os vínculos (o vínculo nasceu com o pedido, sem passo a mais).
    await page.goto('/suprimentos/contratos');
    await page.getByTestId('ctr-f-termo').fill(numero);
    await page.getByTestId('ctr-f-aplicar').click();
    await page.getByRole('button', { name: `Abrir o contrato ${numero}` }).click();
    const det = page.getByTestId('ctr-det-painel');
    await expect(det).toBeVisible();
    await page.getByTestId('ctr-det-aba-vinculos').click();
    await expect(det.locator('[data-testid^="ctr-det-vinculo-"]')).toHaveCount(1);
    await semViolacaoAxe(page, 'contrato com o pedido ligado');
  });
});
