// E2E @M31 (ficha, seção 10): conta emitida → lote → XSD 04.03.00 → envio ao simulador → protocolo (congela o lote) →
// fechamento de competência → demonstrativo com glosa (digitação assistida) → conciliação → decisão de recorrer →
// recurso → desfecho parcial; painel de glosas; guias e webservices; axe sem violação séria em cada tela. Sessão real
// sobre a fonte sintética de dev e a porta do pós-fechamento em MEMÓRIA (contas, lotes e itens SINTÉTICOS; nada vai à
// cópia nem sai do estabelecimento).
import { expect, type Page, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';

async function entrar(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

test.describe('TISS, competência, demonstrativos, glosa e recurso @M31', () => {
  test.setTimeout(300_000);

  test('lote 04.03.00, envio ao simulador, protocolo, competência, demonstrativo, recurso e desfecho; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.TISS');

    // Montar o lote: contas emitidas e fechadas do convênio 91, SP/SADT.
    await page.goto('/faturamento/lotes');
    await expect(page.getByTestId('tela-tiss-lotes')).toBeVisible();
    await escolher(page.getByTestId('lot-convenio'), '91');
    await escolher(page.getByTestId('lot-tipo-guia'), '2');
    await page.getByTestId('lot-buscar').click();
    await expect(page.getByTestId('lot-prontas')).toBeVisible();
    await semViolacaoAxe(page, '/faturamento/lotes (contas prontas)');
    await page.getByTestId('lot-marcar-9101').check();
    await page.getByTestId('lot-montar').click();
    await expect(page.getByTestId('lot-mensagem')).toContainText('04.03.00');
    // A mensagem sai antes de a lista ser relida: espera o lote novo (o maior id) no topo antes de abrir (M42).
    await expect(page.locator('[data-testid^="lot-abrir-"]').first()).not.toHaveAttribute(
      'data-testid',
      'lot-abrir-8002',
    );
    const linha = page.locator('[data-testid^="lot-abrir-"]').first();
    await linha.click();

    // O lote: XML válido no XSD, envio ao simulador e o protocolo devolvido.
    await expect(page.getByTestId('tela-tiss-lote')).toBeVisible();
    await expect(page.getByTestId('lt-versao')).toContainText('04.03.00');
    await semViolacaoAxe(page, '/faturamento/lotes/:id');
    await page.getByTestId('lt-enviar').click();
    await expect(page.getByTestId('lt-mensagem')).toContainText('simulador');
    await page.getByTestId('lt-protocolar').click();
    await expect(page.getByTestId('tela-tiss-protocolo')).toBeVisible();
    await expect(page.getByTestId('pr-numero')).toHaveValue(/^SIM/);
    await page.getByTestId('pr-data').fill('2026-10-20');
    await semViolacaoAxe(page, '/faturamento/lotes/:id/protocolo');
    await page.getByTestId('pr-registrar').click();
    await expect(page.getByTestId('pr-mensagem')).toContainText('congelado');
    await page.goto(page.url().replace('/protocolo', ''));
    await expect(page.getByTestId('lt-congelado')).toBeVisible();
    await expect(page.getByTestId('lt-historico')).toContainText('RECEBIDO');

    // Prazos de envio.
    await page.goto('/faturamento/prazos');
    await expect(page.getByTestId('pz-lista')).toBeVisible();
    await semViolacaoAxe(page, '/faturamento/prazos');

    // Fechamento de competência do convênio 92.
    await page.goto('/faturamento/competencias');
    await escolher(page.getByTestId('cp-convenio'), '92');
    await page.getByTestId('cp-consultar').click();
    await expect(page.getByTestId('cp-situacao')).toContainText('Aberta');
    await page.getByTestId('cp-fechar').click();
    await expect(page.getByTestId('cp-mensagem')).toContainText('fechada');
    await semViolacaoAxe(page, '/faturamento/competencias');

    // Demonstrativo com glosa, por digitação assistida, sobre o lote 8002 (o item não conciliado da conta 9201).
    await page.goto('/faturamento/demonstrativos?lote=8002');
    await expect(page.getByTestId('tela-tiss-demonstrativos')).toBeVisible();
    await page.getByTestId('dm-numero').fill('DEM-E2E-1');
    const pago = page.locator('[data-testid^="dm-pago-"]').first();
    await pago.fill('50');
    await escolher(page.locator('[data-testid^="dm-motivo-"]').first(), '1705');
    await semViolacaoAxe(page, '/faturamento/demonstrativos');
    await page.getByTestId('dm-importar').click();
    await expect(page.getByTestId('dm-mensagem')).toContainText('1 item(ns) casado(s)');
    await page.getByTestId('dm-conciliar').click();
    await expect(page.getByTestId('dm-mensagem')).toContainText('baixado');

    // Glosa: decidir recorrer, recorrer e registrar o desfecho parcial do item que já estava em recurso.
    await page.goto('/faturamento/glosas?conta=9201');
    await expect(page.getByTestId('tela-tiss-glosas')).toBeVisible();
    await expect(page.getByTestId('gl-itens')).toBeVisible();
    await semViolacaoAxe(page, '/faturamento/glosas');
    await page.locator('[data-testid^="gl-decidir-"]').first().click();
    await page.getByTestId('gl-texto').fill('Procedimento realizado conforme a prescrição');
    await page.getByTestId('gl-evidencia').fill('Evolução médica do dia do atendimento');
    await page.getByTestId('gl-confirmar').click();
    await expect(page.getByTestId('gl-mensagem')).toContainText('recurso');
    // Recurso em lote: marca os itens decididos como "recorrer" e monta o recurso numa ação só.
    await page.getByTestId('gl-marcar-todos').check();
    await expect(page.getByTestId('gl-montar-recurso')).toBeEnabled();
    await page.getByTestId('gl-montar-recurso').click();
    await expect(page.getByTestId('gl-acao')).toContainText('lote por fonte pagadora');
    await page.getByTestId('gl-confirmar').click();
    await expect(page.getByTestId('gl-mensagem')).toContainText('Recurso registrado');
    await page.locator('[data-testid^="gl-desfecho-"]').first().click();
    await escolher(page.getByTestId('gl-tipo-desfecho'), 'parcial');
    await page.getByTestId('gl-valor').fill('30');
    await page.getByTestId('gl-demonstrativo').fill('DEM-R-E2E');
    await semViolacaoAxe(page, '/faturamento/glosas (desfecho)');
    await page.getByTestId('gl-confirmar').click();
    await expect(page.getByTestId('gl-mensagem')).toContainText('Desfecho');
    await expect(page.getByTestId('gl-itens')).toContainText('Parcial');
    // A evidência do prontuário: só pela leitura auditada ("Ver evidência"), nunca na grade.
    await expect(page.getByTestId('gl-itens')).not.toContainText('Evolução médica do dia do atendimento');
    await page.locator('[data-testid^="gl-evidencia-"]').first().click();
    await expect(page.getByTestId('gl-evidencia-texto')).toContainText(
      'Evolução médica do dia do atendimento',
    );
    await semViolacaoAxe(page, '/faturamento/glosas (evidência)');

    // Painel de glosas e ciclo de receita.
    await page.goto('/relatorios/glosas');
    await expect(page.getByTestId('tela-tiss-painel')).toBeVisible();
    await expect(page.getByTestId('pg-regua')).toContainText('competência');
    await expect(page.getByTestId('pg-liquida')).toBeVisible();
    await expect(page.getByTestId('pg-positiva')).toBeVisible();
    await semViolacaoAxe(page, '/relatorios/glosas');
    expect(externas).toEqual([]);
  });

  test('guias e webservices por operadora (referência ao cofre); axe', async ({ page }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.TISS');
    await page.goto('/faturamento/guias');
    await expect(page.getByTestId('gu-lista')).toBeVisible();
    await expect(page.getByTestId('gu-9101')).toBeVisible();
    await semViolacaoAxe(page, '/faturamento/guias');

    await page.goto('/integracao/tiss');
    await expect(page.getByTestId('tela-tiss-webservices')).toBeVisible();
    await expect(page.getByTestId('ws-versao')).toContainText('04.03.00');
    await escolher(page.getByTestId('ws-convenio'), '91');
    await page.getByTestId('ws-url').fill('https://operadora.exemplo/tiss');
    await page.getByTestId('ws-cofre').fill('cofre:operadoras/91/tiss');
    await page.getByTestId('ws-gravar').click();
    await expect(page.getByTestId('ws-mensagem')).toContainText('cofre');
    await expect(page.getByTestId('ws-endpoints')).toContainText('cofre:operadoras/91/tiss');
    await semViolacaoAxe(page, '/integracao/tiss');
    expect(externas).toEqual([]);
  });
});
