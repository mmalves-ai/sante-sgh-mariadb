// E2E @C2-026 (F7, 02-CAD linha 24): a regra própria do plano da fonte pagadora na recepção. Quem edita o contrato abre
// a tela, escolhe a fonte sintética, vê a validação do domínio na hora (teto sem período e
// pendência sem motivo travam, sem pedido ao servidor), grava uma regra com início futuro (não muda as aberturas de
// hoje), vê a linha na tabela e encerra a vigência dela no mesmo dia (nada se apaga: a linha continua). A prévia da
// crítica da abertura responde sem gravar. Fonte sintética; axe na tela.
import { expect, test, type Page } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';

async function entrar(page: Page, login: string): Promise<void> {
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

/** Uma data futura diferente a cada execução (a regra nova encerra a anterior da mesma chave na véspera). */
function dataFutura(): string {
  const d = new Date(Date.UTC(2091, 0, 1) + Math.floor(Math.random() * 3_000) * 86_400_000);
  return d.toISOString().slice(0, 10);
}

test.describe('Regra do plano da fonte pagadora na recepção @C2-026 @fase7', () => {
  test('validação na hora, regra gravada e encerrada, prévia sem gravar; axe', async ({ page }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.FATURAMENTO');
    await page.goto('/recepcao/atendimento/regras-plano');
    const tela = page.getByTestId('tela-regras-plano');
    await expect(tela.getByRole('heading', { level: 1, name: 'Regras do plano na recepção' })).toBeVisible();
    await expect(tela).not.toContainText(/SPDATA|legado|sistema atual/i);

    let gravacoes = 0;
    page.on('request', (r) => {
      if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/atendimento/regras-plano') gravacoes++;
    });

    await escolher(page.getByTestId('rp-fonte'), { rotulo: /alfa/i });
    await expect(page.getByTestId('rp-form')).toBeVisible();

    // Teto sem período e pendência sem motivo: os erros aparecem no campo e o pedido não sai.
    await page.getByTestId('rp-campo-tetoAtendimentos').fill('4');
    await expect(page.getByTestId('rp-erro-tetoAtendimentos')).toContainText('teto e o período juntos');
    await escolher(page.getByTestId('rp-pendencia'), { rotulo: 'Alerta' });
    await expect(page.getByTestId('rp-erro-pendenciaMotivo')).toContainText('motivo da pendência');
    await page.getByTestId('rp-gravar').click({ force: true });
    expect(gravacoes).toBe(0);

    // Corrige: período do teto, motivo, carteira exigida com prefixo, início futuro.
    await page.getByTestId('rp-campo-tetoPeriodoDias').fill('30');
    await page.getByTestId('rp-campo-pendenciaMotivo').fill('Contrato em revisão de cobertura');
    await page.getByTestId('rp-exigeCarteira').click();
    await page.getByTestId('rp-campo-prefixoCarteira').fill('ALF');
    const inicio = dataFutura();
    await page.getByTestId('rp-campo-vigenciaInicio').fill(inicio);
    await expect(page.getByTestId('rp-erro-tetoAtendimentos')).toHaveCount(0);
    await expect(page.getByTestId('rp-erro-pendenciaMotivo')).toHaveCount(0);
    await expect(page.getByTestId('rp-erro-prefixoCarteira')).toHaveCount(0);
    await semViolacaoAxe(page, 'regras do plano na recepção');

    await page.getByTestId('rp-gravar').click();
    await expect(page.getByTestId('rp-mensagem')).toContainText('Regra do plano gravada');
    expect(gravacoes).toBe(1);
    const br = inicio.split('-').reverse().join('/');
    const linha = page.getByTestId('rp-tabela').locator('tr', { hasText: br }).first();
    await expect(linha).toContainText('4 em 30 dias');
    await expect(linha).toContainText('Contrato em revisão de cobertura');

    // Encerra a vigência no próprio início: a linha continua na tabela, com o fim.
    await linha.getByRole('button', { name: 'Encerrar' }).click();
    await page.getByTestId('rp-encerrar-data').fill(inicio);
    await page.getByTestId('rp-encerrar-confirmar').click();
    await expect(page.getByTestId('rp-mensagem')).toContainText('Vigência da regra encerrada');
    expect(gravacoes).toBe(2);
    await expect(page.getByTestId('rp-tabela').locator('tr', { hasText: `${br} a ${br}` })).toHaveCount(1);

    // A prévia da crítica responde sem gravar nada.
    await page.getByTestId('rp-previa-carteira').fill('X1');
    await page.getByTestId('rp-previa-conferir').click();
    await expect(page.getByTestId('rp-previa-resultado')).toBeVisible();
    expect(gravacoes).toBe(2);
    expect(externas).toEqual([]);
  });
});
