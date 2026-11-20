// E2E @M54.6 (ficha do M54, fatia F6: patrimônio; seções 7, 8 regras 11 a 13, 10 "cadastrar bem a partir de uma nota
// sintética → depreciar → inventário com QR" e "Documento: termo de baixa" e 11 na parte da F6): o responsável pelo
// patrimônio cadastra um bem da nota fiscal de entrada sintética (passos nota → dados → conferir; a plaqueta sai
// numerada) → abre a ficha (conferência contábil, etiqueta) → calcula a depreciação da competência anterior (prévia com
// as parcelas, confirmação, cotas gravadas) → pede a transferência do bem para outro setor → o gestor do setor que recebe
// aceita (regra 13: sem o aceite o bem não muda) → abre o inventário do setor e lê a plaqueta digitada (no Chromium sem
// câmera, a digitação é o caminho do leitor) e um código sem bem (divergência registrada, nada corrigido sozinho) →
// encerra → baixa o bem com o termo e a senha → o termo de baixa aparece na ficha. Axe sem violação séria em cada estado.
// Sessão, notas, domínios e bens SINTÉTICOS em memória (nada vai à cópia; nenhuma pessoa).
import { expect, type Locator, type Page, test } from '@playwright/test';
import { itemDoMenu, semViolacaoAxe, vigiarExternas } from './ajuda.js';
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

const campo = (l: Locator) =>
  l.locator('xpath=self::input | self::textarea | .//input | .//textarea').first();
async function confirmar(page: Page): Promise<void> {
  await page.getByTestId('confirmacao').getByRole('button', { name: 'Confirmar' }).click();
}

test.describe('controladoria, fatia F6: patrimônio @M54.6', () => {
  test.setTimeout(300_000);

  test('nota → bem → ficha → depreciar → transferir com aceite → inventário → baixa com o termo; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);

    // 1. O bem nasce da nota fiscal de entrada (regra 11): competência 03/2026, nota 000123, a cadeira de rodas.
    await entrar(page, 'SINT.PATRIMONIO');
    await (await itemDoMenu(page, 'Cadastro de bens, plaquetas e responsáveis')).click();
    await expect(page).toHaveURL(/\/patrimonio\/bens$/);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByTestId('tela-bens')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('bens-vazio').or(page.getByTestId('tabela-bens'))).toBeVisible({
      timeout: 30_000,
    });
    await semViolacaoAxe(page, '/patrimonio/bens (lista)');

    await page.getByTestId('bens-aba-cadastrar').click();
    const form = page.getByTestId('form-cadastro-bem');
    await expect(form.getByTestId('cadastro-passo-documento')).toBeVisible();
    await escolher(form.getByTestId('cadastro-competencia'), { rotulo: '03/2026' });
    await expect(form.getByTestId('nota-9001')).toBeVisible({ timeout: 30_000 });
    await form.getByTestId('nota-escolher-9001').click();
    await expect(form.getByTestId('tabela-itens-nota')).toBeVisible({ timeout: 30_000 });
    await form.getByTestId('item-escolher-90012').click();
    await expect(form.getByTestId('cadastro-item-escolhido')).toContainText('CADEIRA DE RODAS SINTETICA');
    await semViolacaoAxe(page, '/patrimonio/bens (cadastro: nota e item)');
    await form.getByTestId('cadastro-ir-dados').click();
    await expect(form.getByTestId('cadastro-passo-dados')).toBeVisible();
    await expect(campo(form.getByTestId('cadastro-descricao'))).toHaveValue('CADEIRA DE RODAS SINTETICA');
    await escolher(form.getByTestId('cadastro-grupo'), { rotulo: 'Móveis e utensílios' });
    await escolher(form.getByTestId('cadastro-origem'), { rotulo: 'Próprio' });
    await escolher(form.getByTestId('cadastro-centro'), { rotulo: /UTI ADULTO SINTETICA/ });
    await campo(form.getByTestId('cadastro-marca')).fill('MARCA SINTETICA');
    await semViolacaoAxe(page, '/patrimonio/bens (cadastro: dados)');
    await form.getByTestId('cadastro-ir-conferir').click();
    await expect(form.getByTestId('cadastro-resumo')).toContainText('1.300,00');
    await expect(form.getByTestId('cadastro-problemas')).toHaveCount(0);
    await semViolacaoAxe(page, '/patrimonio/bens (cadastro: conferir)');
    await form.getByTestId('cadastro-gravar').click();
    const gravado = form.getByTestId('cadastro-gravado');
    await expect(gravado).toContainText('1 bens cadastrados', { timeout: 30_000 });
    const plaqueta = /:\s*([A-Za-z0-9-]+)\.\s*$/.exec((await gravado.innerText()).trim())?.[1] ?? '';
    expect(plaqueta).not.toBe('');

    // 2. A ficha: a conferência contábil (valor − acumulada) e a etiqueta com o QR.
    await form.locator('[data-testid^="cadastro-abrir-"]').first().click();
    const ficha = page.getByTestId('ficha-bem');
    await expect(ficha).toBeVisible({ timeout: 30_000 });
    await expect(ficha.getByTestId('ficha-situacao')).toHaveText('Em uso');
    await expect(ficha.getByTestId('ficha-conferencia')).toContainText('1.300,00');
    await expect(ficha.getByTestId('ficha-documento')).toContainText('000123');
    await expect(ficha.getByTestId('ficha-termo-baixa')).toHaveCount(0);
    await semViolacaoAxe(page, '/patrimonio/bens (ficha do bem)');

    // 3. A depreciação da competência anterior (regra 12): prévia com as parcelas, confirmação, cotas gravadas.
    await (await itemDoMenu(page, 'Depreciação')).click();
    await expect(page).toHaveURL(/\/patrimonio\/depreciacao$/);
    await expect(page.getByTestId('tela-depreciacao')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('deprec-total')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('[data-testid^="cota-"]').first()).toBeVisible();
    await expect(page.getByTestId('deprec-impedimentos')).toHaveCount(0);
    await semViolacaoAxe(page, '/patrimonio/depreciacao (prévia)');
    await page.getByTestId('deprec-calcular').click();
    await confirmar(page);
    await expect(page.getByTestId('deprec-mensagem')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('deprec-calcular')).toHaveCount(0);
    await expect(page.getByTestId('deprec-cotas')).toBeVisible();
    await semViolacaoAxe(page, '/patrimonio/depreciacao (cotas gravadas)');

    // 4. A transferência para outro setor fica pendente até o aceite de quem recebe (regra 13).
    await (await itemDoMenu(page, 'Transferência, baixa e inventário de bens')).click();
    await expect(page).toHaveURL(/\/patrimonio\/movimentos$/);
    await expect(page.getByTestId('tela-movimentos')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('mov-aba-registrar').click();
    const reg = page.getByTestId('mov-registrar');
    await campo(reg.getByTestId('mov-codigo')).fill(plaqueta);
    await reg.getByTestId('mov-buscar').click();
    await expect(reg.getByTestId('mov-bem')).toContainText(plaqueta, { timeout: 30_000 });
    await reg.getByLabel('Transferência entre setores').check();
    await escolher(reg.getByTestId('mov-destino'), { rotulo: /CENTRO CIRURGICO SINTETICO/ });
    await campo(reg.getByTestId('mov-motivo')).fill('Remanejamento para o centro cirúrgico (E2E M54.6).');
    await semViolacaoAxe(page, '/patrimonio/movimentos (registrar a transferência)');
    await reg.getByTestId('mov-gravar').click();
    await expect(page.getByTestId('mov-mensagem')).toBeVisible({ timeout: 30_000 });

    // O gestor do setor que recebe vê o pedido e aceita.
    await entrar(page, 'SINT.PATRIMONIO.SETOR');
    await (await itemDoMenu(page, 'Transferência, baixa e inventário de bens')).click();
    await expect(page.getByTestId('mov-pendentes')).toBeVisible({ timeout: 30_000 });
    const pedido = page.locator('[data-testid^="pendente-"]').filter({ hasText: plaqueta }).first();
    await expect(pedido).toBeVisible({ timeout: 30_000 });
    await expect(pedido.locator('[data-testid^="pendente-cancelar-"]')).toHaveCount(0);
    await semViolacaoAxe(page, '/patrimonio/movimentos (pendente para o gestor do setor)');
    await pedido.locator('[data-testid^="pendente-aceitar-"]').click();
    await expect(page.getByTestId('mov-mensagem')).toContainText('Transferência aceita', { timeout: 30_000 });

    // 5. O inventário do setor pelo celular: a plaqueta digitada (sem câmera no Chromium) e um código sem bem.
    await entrar(page, 'SINT.PATRIMONIO');
    await page.goto('/patrimonio/movimentos');
    await page.getByTestId('mov-ir-inventario').click();
    await expect(page).toHaveURL(/\/patrimonio\/inventario$/);
    const abrir = page.getByTestId('inv-abrir');
    await expect(abrir).toBeVisible({ timeout: 30_000 });
    await campo(abrir.getByTestId('inv-nome')).fill('Inventário do centro cirúrgico (E2E M54.6)');
    await escolher(abrir.getByTestId('inv-escopo'), { rotulo: /CENTRO CIRURGICO SINTETICO/ });
    await semViolacaoAxe(page, '/patrimonio/inventario (abrir)');
    await abrir.getByTestId('inv-abrir-gravar').click();
    const detalhe = page.getByTestId('inv-detalhe');
    await expect(detalhe.getByTestId('inv-leitor')).toBeVisible({ timeout: 30_000 });
    await campo(detalhe.getByTestId('inv-codigo')).fill(plaqueta);
    await detalhe.getByTestId('inv-ler').click();
    await expect(detalhe.getByTestId('inv-ultima')).toContainText('Encontrado no lugar', { timeout: 30_000 });
    await campo(detalhe.getByTestId('inv-codigo')).fill('ZZ999999');
    await detalhe.getByTestId('inv-ler').click();
    await expect(detalhe.getByTestId('inv-ultima')).toContainText('Código sem bem cadastrado', {
      timeout: 30_000,
    });
    await expect(detalhe.getByTestId('inv-resumo')).toBeVisible();
    await semViolacaoAxe(page, '/patrimonio/inventario (contagem e resumo)');
    await detalhe.getByTestId('inv-encerrar').click();
    await confirmar(page);
    await expect(page.getByTestId('inv-mensagem')).toBeVisible({ timeout: 30_000 });
    await expect(detalhe.getByTestId('inv-leitor')).toHaveCount(0);
    await semViolacaoAxe(page, '/patrimonio/inventario (encerrado)');

    // 6. A baixa com o termo e a senha; o termo de baixa (PDF/A) fica na ficha do bem baixado.
    await (await itemDoMenu(page, 'Cadastro de bens, plaquetas e responsáveis')).click();
    await expect(page.getByTestId('tela-bens')).toBeVisible({ timeout: 30_000 });
    await campo(page.getByTestId('bens-codigo-campo')).fill(plaqueta);
    await page.getByTestId('bens-codigo-abrir').click();
    await expect(ficha).toBeVisible({ timeout: 30_000 });
    await expect(ficha.getByTestId('ficha-dados')).toContainText('CENTRO CIRURGICO SINTETICO');
    await ficha.getByTestId('ficha-baixar').click();
    const baixa = ficha.getByTestId('ficha-form-baixa');
    await campo(baixa.getByTestId('baixa-termo')).fill('LAUDO-E2E-546');
    await campo(baixa.getByTestId('baixa-motivo')).fill('Sem conserto (E2E M54.6).');
    await baixa.getByTestId('baixa-senha').fill(SENHA);
    await semViolacaoAxe(page, '/patrimonio/bens (baixa com o termo)');
    await baixa.getByTestId('baixa-confirmar').click();
    await confirmar(page);
    await expect(ficha.getByTestId('ficha-situacao')).toHaveText('Baixado', { timeout: 30_000 });
    const termo = ficha.getByTestId('ficha-termo-baixa');
    await expect(termo).toBeVisible();
    await expect(termo).toHaveAttribute('href', /\/api\/patrimonio\/bens\/\d+\/termo-baixa$/);
    // O documento sai do servidor (PDF/A pelo Gotenberg; sem o conversor no ar, 503 com o motivo).
    const doc = await page.request.get((await termo.getAttribute('href')) ?? '');
    expect([200, 503]).toContain(doc.status());
    if (doc.status() === 200) expect(doc.headers()['content-type']).toContain('application/pdf');
    await semViolacaoAxe(page, '/patrimonio/bens (bem baixado com o termo)');

    expect(externas).toEqual([]);
  });
});
