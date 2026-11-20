// E2E @W0-03 (mercado M3, critério 12): o relógio de protocolos gerenciados no internado pela tela.
//   - a diretoria clínica publica as definições (pré-condição, pela API como no M44);
//   - a enfermeira abre o relógio pelo atalho da tela dos escores, escolhe a UTI e inclui o paciente no protocolo de
//     TEV por suspeita (critério conferido; a hora do reconhecimento é o tempo zero);
//   - registra a meta feita no prazo (Cumprida) e encerra: com meta sem registro, o servidor pede o motivo;
//   - a inclusão por engano é inativada pelo autor com o motivo e a senha e fica visível, tachada;
//   - os indicadores por origem imprimem o numerador e o denominador.
// axe sem violação séria. Sessão real sobre a fonte sintética e as portas em MEMÓRIA (dados SINTÉTICOS).
import { PROTOCOLOS_GERENCIADOS_SINTETICOS } from '@sgh/dominio-recepcao';
import { type APIRequestContext, type Browser, expect, type Page, test } from '@playwright/test';
import { ORIGEM, semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
// Paciente sintético da UTI (os protocolos do internado são só deste spec).
const P1 = 25101;

async function entrar(page: Page, login: string): Promise<void> {
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

let sequencia = 0;
async function publicar(browser: Browser): Promise<void> {
  const ctx = await browser.newContext({ baseURL: ORIGEM, timezoneId: 'America/Sao_Paulo' });
  const dir = await ctx.newPage();
  await entrar(dir, 'SINT.DIRETOR.CLINICO');
  const csrf = (await ctx.cookies()).find((c) => c.name === 'sgh_csrf')?.value ?? '';
  for (const tipo of ['tev', 'avc']) {
    const r = await (dir.request as APIRequestContext).post('/api/pa/protocolos-gerenciados/definicoes', {
      headers: { 'x-csrf': csrf, 'idempotency-key': `e2e-w003-m3-${Date.now()}-${++sequencia}` },
      data: {
        autor: 'SINT.ENFERMEIRO.PA',
        conteudo: PROTOCOLOS_GERENCIADOS_SINTETICOS.find((p) => p.tipo === tipo),
        notas: 'Definição sintética do E2E do internado',
        senha: SENHA,
      },
    });
    expect(r.status(), await r.text()).toBe(201);
  }
  await ctx.close();
}

async function incluirPorSuspeita(page: Page, tipo: string, criterio: string): Promise<void> {
  await page.getByTestId('pi-incluir').click();
  await expect(page.getByTestId('pi-dialogo-incluir')).toBeVisible();
  await escolher(page.getByTestId('pi-paciente'), String(P1));
  await escolher(page.getByTestId('pi-tipo'), tipo);
  await expect(page.getByTestId('pi-incluir-confirmar')).toBeDisabled();
  await page.getByTestId(`pi-criterio-${criterio}`).check();
  await page.getByTestId('pi-incluir-confirmar').click();
  await expect(page.getByTestId('pi-mensagem')).toContainText('o relógio começou');
}

test.describe('Protocolos gerenciados no internado @W0-03 @crud', () => {
  test.setTimeout(300_000);

  test('incluir por suspeita, registrar a meta, encerrar, inativar a inclusão por engano e os indicadores', async ({
    page,
    browser,
  }) => {
    const externas = vigiarExternas(page);
    await publicar(browser);
    await entrar(page, 'SINT.ENF.PLANTAO');
    // O caminho pela interface: o atalho da tela dos escores (a entrada de menu é do W4-01).
    await page.goto('/enfermagem/escores');
    await page.getByTestId('es-atalho-protocolos').click();
    await expect(page).toHaveURL(/\/enfermagem\/protocolos/);
    await expect(page.getByTestId('tela-protocolos-internado')).toBeVisible();
    await escolher(page.getByTestId('enf-unidade'), 'UTI');
    await expect(page.getByTestId('pi-sugestoes')).toBeVisible();
    await semViolacaoAxe(page, '/enfermagem/protocolos (relógio)');

    // A inclusão por suspeita no TEV: o cartão aparece com as metas e o prazo.
    await incluirPorSuspeita(page, 'tev', 'risco-alto');
    const cartao = page.getByTestId('pi-ativos').locator('[data-testid^="pi-protocolo-"]').first();
    await expect(cartao).toContainText('TEV');
    await expect(cartao).toContainText('Tempo zero');
    await expect(cartao.locator('[data-testid$="-avaliacao-medica"]').first()).toContainText('No prazo');

    // A meta feita no prazo.
    await cartao.locator('[data-testid^="pi-registrar-"][data-testid$="-avaliacao-medica"]').click();
    await expect(page.getByTestId('pi-dialogo-meta')).toBeVisible();
    await semViolacaoAxe(page, '/enfermagem/protocolos (meta)');
    await page.getByTestId('pi-meta-confirmar').click();
    await expect(page.getByTestId('pi-mensagem')).toContainText('cumprida no prazo');
    await expect(cartao.locator('[data-testid$="-avaliacao-medica"]').first()).toContainText('Cumprida');

    // O encerramento com a profilaxia sem registro: o servidor pede o motivo.
    await cartao.locator('[data-testid^="pi-encerrar-"]').click();
    await expect(page.getByTestId('pi-dialogo-encerrar')).toBeVisible();
    await page.getByTestId('pi-encerrar-confirmar').click();
    await expect(page.getByTestId('pi-dialogo-encerrar')).toContainText('meta sem registro');
    await page.getByTestId('pi-encerrar-motivo').fill('Profilaxia avaliada pelo médico: contraindicada');
    await page.getByTestId('pi-encerrar-confirmar').click();
    await expect(page.getByTestId('pi-mensagem')).toContainText('relógio parou');
    await expect(page.getByTestId('pi-encerrados')).toContainText('Protocolo concluído');

    // A inclusão por engano (AVC no paciente errado): o autor inativa com o motivo e a senha; fica tachada.
    await incluirPorSuspeita(page, 'avc', 'deficit-focal');
    await page.getByTestId('pi-ativos').locator('[data-testid^="pi-inativar-"]').first().click();
    await expect(page.getByTestId('pi-dialogo-inativar')).toBeVisible();
    await page.getByTestId('pi-dialogo-inativar-motivo').fill('Incluído no paciente errado (leito ao lado)');
    await page.getByTestId('pi-dialogo-inativar-senha').fill(SENHA);
    await semViolacaoAxe(page, '/enfermagem/protocolos (inativar)');
    await page.getByTestId('pi-dialogo-inativar-confirmar').click();
    await expect(page.getByTestId('pi-mensagem')).toContainText('Inclusão inativada');
    await expect(page.getByTestId('pi-inativacao').first()).toContainText('paciente errado');

    // Os indicadores por origem: a UTI com o TEV (o AVC inativado não conta), numerador e denominador impressos.
    const uti = page.getByTestId('pi-ind-uti-todos');
    await expect(uti).toContainText('1 de 1');
    await expect(uti).toContainText('0 de 1');
    expect(externas).toEqual([]);
  });

  test('a técnica de enfermagem vê o relógio, mas não inclui', async ({ page }) => {
    await entrar(page, 'SINT.TECNICO.ENF');
    await page.goto('/enfermagem/protocolos');
    await escolher(page.getByTestId('enf-unidade'), 'UTI');
    await expect(page.getByTestId('pi-sugestoes')).toBeVisible();
    await expect(page.getByTestId('pi-incluir')).toHaveCount(0);
    await expect(page.getByTestId('pi-sem-acao')).toBeVisible();
  });
});
