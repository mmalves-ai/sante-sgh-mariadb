// E2E @M38 (ficha, seções 7, 8 e 10): a onda 0 das consultas ao vivo. A diretoria do grupo MASTER (o público da onda)
// consulta o painel de leitos ao vivo, o censo, os painéis e os indicadores; o médico busca pela paleta e abre o
// prontuário com o registro do legado (texto formatado do RTF); o usuário fora do escopo tem a consulta recusada com
// o aviso da onda; a TI vê a vigilância diária na tela de testes de assinatura. Sessão sintética de dev, portas em
// MEMÓRIA (nada vai à cópia); axe sem violação séria em cada tela.
import { expect, test, type Page } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';

const SENHA = 'Sintetico#2026';

async function entrar(page: Page, login: string): Promise<void> {
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

/** Liga ou desliga uma chave de recurso para pessoas (Funcionalidades por estabelecimento; reautenticação). */
async function chaveParaPessoa(page: Page, chave: string, login: string, ligar: boolean): Promise<void> {
  const csrf = (await page.context().cookies()).find((c) => c.name === 'sgh_csrf')?.value ?? '';
  const r = await page.request.post('/api/administracao/liberacao', {
    headers: { 'x-csrf': csrf, 'idempotency-key': `e2e-m38-${chave}-${ligar}-${Date.now()}` },
    data: {
      chave,
      tipo: 'recurso',
      escopo: 'pessoa',
      valores: [login],
      ligar,
      justificativa: 'Escopo sintético da onda 0 (E2E)',
      senha: SENHA,
    },
  });
  expect(r.status()).toBe(200);
}

test.describe('Onda 0: consultas ao vivo @M38', () => {
  test.setTimeout(180_000);

  test('diretoria (MASTER): painel de leitos ao vivo, censo, painéis e indicadores; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.MASTER');
    const telas = await page.request.get('/api/onda0/telas');
    expect(telas.status()).toBe(200);
    const leitos = (await telas.json()).telas.find((t: { id: string }) => t.id === 'leitos');
    expect(leitos.situacao).toBe('ligada');

    await page.goto('/internacao/leitos/painel');
    await expect(page.getByRole('heading', { level: 1, name: 'Painel de leitos ao vivo' })).toBeVisible();
    await expect(page.getByTestId('painel-totais')).toContainText('leitos ativos');
    await expect(page.getByTestId('painel-atualizado')).toContainText('Ao vivo');
    await semViolacaoAxe(page, '/internacao/leitos/painel');

    await page.goto('/internacao/censo');
    await expect(page.getByTestId('censo-total')).toBeVisible();
    await semViolacaoAxe(page, '/internacao/censo');

    await page.goto('/relatorios/indicadores');
    await expect(page.getByRole('heading', { level: 1, name: 'Indicadores hospitalares' })).toBeVisible();
    await expect(page.getByTestId('ind-taxaOcupacao')).toBeVisible();
    await semViolacaoAxe(page, '/relatorios/indicadores');

    await page.goto('/relatorios/paineis/assistencial');
    await expect(page.getByTestId('serie-taxaOcupacao')).toBeVisible();
    await semViolacaoAxe(page, '/relatorios/paineis/assistencial');
    expect(externas).toEqual([]);
  });

  test('médico: busca pela paleta e o prontuário ao vivo com o registro do legado (RTF); axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.MEDICO');
    await page.keyboard.press('Control+k');
    await expect(page.getByTestId('paleta')).toBeVisible();
    // O campo da paleta recebe o foco ao abrir: só então se digita (antes disso, a tecla iria à página).
    await expect(page.locator('#paleta-campo')).toBeFocused();
    await page.locator('#paleta-campo').fill('cinthya vianna');
    const abrir = page.getByRole('option', { name: /Abrir prontuário: cinthya vianna/ });
    await expect(abrir).toBeVisible();
    await abrir.click();
    await expect(page).toHaveURL(/\/pep\/prontuario\?q=cinthya/);
    await expect(page.getByTestId('prontuario-paciente-1003')).toBeVisible();
    await semViolacaoAxe(page, '/pep/prontuario (busca)');
    await page.getByTestId('prontuario-paciente-1003').getByRole('link').click();
    const dialogo = page.getByTestId('dialogo-motivo');
    await expect(dialogo).toBeVisible();
    await dialogo.getByRole('radio', { name: 'Assistência ao paciente' }).check();
    await page.getByTestId('confirmar-motivo').click();
    await expect(page.getByTestId('lista-registros')).toBeVisible();
    await semViolacaoAxe(page, '/pep/prontuario/1003');

    // O registro de 2021, feito no legado: o texto formatado vem do RTF gravado lá, como foi feito.
    await page.getByTestId('registro-900001').getByRole('link').click();
    await expect(page.getByTestId('tela-registro')).toBeVisible();
    await page.getByTestId('aba-texto').click();
    await expect(page.getByTestId('texto-formatado')).toContainText('Dor torácica há 2 dias');
    await semViolacaoAxe(page, 'registro do legado (texto formatado do RTF)');
    expect(externas).toEqual([]);
  });

  test('fora do escopo: a consulta é recusada com o aviso da onda; a TI vê a vigilância diária; axe', async ({
    browser,
  }) => {
    const ctxTi = await browser.newContext();
    const ti = await ctxTi.newPage();
    await entrar(ti, 'SINT.ADMIN');
    await chaveParaPessoa(ti, 'internacao.leitos.painel', 'SINT.LEITOS', false);
    try {
      const ctxLeitos = await browser.newContext();
      const leitos = await ctxLeitos.newPage();
      await entrar(leitos, 'SINT.LEITOS');
      const telas = await (await leitos.request.get('/api/onda0/telas')).json();
      expect(telas.telas.find((t: { id: string }) => t.id === 'leitos').situacao).toBe('fora-do-escopo');
      const api = await leitos.request.get('/api/internacao/leitos/painel');
      expect(api.status()).toBe(403);
      await leitos.goto('/internacao/leitos/painel');
      await expect(leitos.getByTestId('aviso-fora-do-escopo-onda0')).toContainText(
        'ainda não foi liberada para o seu perfil nesta etapa',
      );
      await semViolacaoAxe(leitos, '/internacao/leitos/painel (fora do escopo)');
      await ctxLeitos.close();
    } finally {
      await chaveParaPessoa(ti, 'internacao.leitos.painel', 'SINT.LEITOS', true);
    }

    // A vigilância diária de gravação em produção, na aba da tela de testes de assinatura.
    await ti.goto('/administracao/coexistencia/assinaturas');
    await ti.getByTestId('aba-vigia').click();
    await expect(ti).toHaveURL(/assinaturas\/vigia$/);
    await expect(ti.getByRole('heading', { level: 2, name: 'Vigilância diária em produção' })).toBeVisible();
    await expect(ti.getByTestId('vigia-resumo')).toContainText('2 dia(s) com execução; 1 com divergência');
    await expect(ti.getByTestId('tabela-vigia')).toContainText('TBCABTRILHA.FUSO_HORARIO_LOCAL');
    await expect(ti.getByTestId('vigia-alerta')).toBeVisible();
    await semViolacaoAxe(ti, '/administracao/coexistencia/assinaturas/vigia');
    await ctxTi.close();
  });
});
