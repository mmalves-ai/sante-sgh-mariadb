// E2E @W0-03 (mercado M2, critério 10): o Time de Resposta Rápida e a ficha da parada pela tela.
//   - o PEWS 5 (gatilho de resposta rápida) aparece como alerta aberto na unidade, com o aviso único;
//   - o botão do alerta aciona o time: o acionamento mostra a hora do alerta e a do acionamento, e o alerta some;
//   - a chegada e o desfecho (evoluiu para parada) pela tela;
//   - a ficha Utstein: o rascunho do autor (versão 1) e, continuada, a finalizada (versão 2, com a anterior listada);
//   - o acionamento à mão pede o motivo;
//   - os indicadores imprimem o numerador e o denominador.
// Revisão W0-03: a tela se abre pelo atalho da tela dos escores; com a ficha aberta, o acionamento mostra "Ver a ficha"
// (não abre outra); a finalizada abre em leitura com os campos Utstein (a causa provável) e a versão 1 riscada; o autor
// corrige a finalizada com a justificativa.
// axe sem violação séria. Sessão real sobre a fonte sintética e as portas em MEMÓRIA (dados SINTÉTICOS).
import { expect, type Page, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const P4 = { paciente: 25004, atendimento: 25104, reg: 25204, unidade: 'ENF1' };

async function entrar(page: Page, login: string): Promise<void> {
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

/** O PEWS 5 da enfermaria pela API da sessão (o mesmo que a tela dos escores grava). */
async function pews5(page: Page): Promise<number> {
  const csrf = (await page.context().cookies()).find((c) => c.name === 'sgh_csrf')?.value ?? '';
  const r = await page.request.post('/api/enfermagem/escores', {
    headers: { 'x-csrf': csrf, 'idempotency-key': `e2e-w003-trr-${Date.now()}` },
    data: { ...P4, escala: 'pews', itens: { comport: 1, cardio: 1, resp: 1, nebul: 2, vomito: 0 } },
  });
  expect(r.status()).toBe(201);
  const j = (await r.json()) as { id: number; gatilho: string };
  expect(j.gatilho).toBe('trr');
  return j.id;
}

test.describe('Time de Resposta Rápida @W0-03 @crud', () => {
  test.setTimeout(300_000);

  test('o alerta aciona o time; chegada e desfecho; a ficha Utstein do rascunho à finalizada; indicadores', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.ENF.PLANTAO');
    const escore = await pews5(page);
    // O caminho pela interface: o atalho da tela dos escores (a entrada de menu é do W4-01).
    await page.goto('/enfermagem/escores');
    await page.getByTestId('es-atalho-trr').click();
    await expect(page).toHaveURL(/\/enfermagem\/trr/);
    await expect(page.getByTestId('tela-trr')).toBeVisible();
    await escolher(page.getByTestId('enf-unidade'), 'ENF1');
    await expect(page.getByTestId('trr-alerta-aviso')).toBeVisible();
    await expect(page.getByTestId(`trr-alerta-${escore}`)).toContainText('PEWS 5');
    await semViolacaoAxe(page, '/enfermagem/trr (alerta)');
    await page.getByTestId(`trr-acionar-${escore}`).click();
    await expect(page.getByTestId('trr-mensagem')).toContainText('acionado');
    await expect(page.getByTestId(`trr-alerta-${escore}`)).toHaveCount(0);
    const linha = page.locator('[data-testid^="trr-acionamento-"][data-origem="escore"]').first();
    const id = (await linha.getAttribute('data-testid'))!.replace('trr-acionamento-', '');
    await expect(page.getByTestId(`trr-acionado-${id}`)).not.toContainText('—');

    // A chegada e o desfecho.
    await page.getByTestId(`trr-chegou-${id}`).click();
    await expect(page.getByTestId('trr-mensagem')).toContainText('Chegada');
    await page.getByTestId(`trr-desfecho-botao-${id}`).click();
    await escolher(page.getByTestId('trr-desfecho-escolher'), { rotulo: /parada/ });
    await page.getByTestId('trr-desfecho-confirmar').click();
    await expect(page.getByTestId(`trr-desfecho-${id}`)).toContainText('parada');

    // A ficha: o rascunho (versão 1), continuado e finalizado (versão 2).
    await page.getByTestId(`trr-ficha-${id}`).click();
    await expect(page.getByTestId('trr-dialogo-ficha')).toBeVisible();
    await escolher(page.getByTestId('trr-ficha-ritmo'), { rotulo: 'Fibrilação ventricular' });
    await semViolacaoAxe(page, '/enfermagem/trr (ficha)');
    await page.getByTestId('trr-ficha-rascunho').click();
    await expect(page.getByTestId('trr-mensagem')).toContainText('versão 1');
    // Com a ficha aberta, o acionamento não abre outra: mostra "Ver a ficha".
    await expect(page.getByTestId(`trr-ficha-${id}`)).toHaveCount(0);
    await expect(page.getByTestId(`trr-ver-ficha-acionamento-${id}`)).toBeVisible();
    const rascunho = page.locator('[data-testid^="trr-ficha-lida-"][data-situacao="rascunho"]').first();
    const fid = (await rascunho.getAttribute('data-testid'))!.replace('trr-ficha-lida-', '');
    await page.getByTestId(`trr-continuar-${fid}`).click();
    const rcp = await page.getByTestId('trr-ficha-rcp').inputValue();
    await page.getByTestId('trr-ficha-rce').fill(rcp);
    await escolher(page.getByTestId('trr-ficha-desfecho'), { rotulo: /sustentado/ });
    await page.getByTestId('trr-ficha-causa').fill('Hipóxia por obstrução da via aérea');
    await page.getByTestId('trr-ficha-finalizar').click();
    await expect(page.getByTestId('trr-mensagem')).toContainText('finalizada (versão 2)');
    const final = page.locator('[data-testid^="trr-ficha-lida-"][data-situacao="finalizada"]').first();
    await expect(final).toHaveAttribute('data-versao', '2');
    await expect(final).toContainText('v1');
    const fid2 = (await final.getAttribute('data-testid'))!.replace('trr-ficha-lida-', '');

    // A finalizada abre em leitura: os campos Utstein e a versão 1 riscada, legível.
    await page.getByTestId(`trr-ver-${fid2}`).click();
    const ver = page.getByTestId('trr-dialogo-ver');
    await expect(ver).toBeVisible();
    await expect(page.getByTestId('trr-ver-vigente')).toContainText('Hipóxia por obstrução da via aérea');
    await expect(page.getByTestId('trr-ver-vigente')).toContainText('Fibrilação ventricular');
    await expect(page.getByTestId('trr-ver-anterior-1')).toContainText('Fibrilação ventricular');
    await semViolacaoAxe(page, '/enfermagem/trr (ficha em leitura)');
    await page.getByTestId('trr-ver-fechar').click();

    // O autor corrige a finalizada, com a justificativa: versão 3, a 2 fica riscada.
    await page.getByTestId(`trr-corrigir-${fid2}`).click();
    await expect(page.getByTestId('trr-ficha-corrigir')).toBeDisabled();
    await page.getByTestId('trr-ficha-motivo').fill('Causa provável revista com o registro do monitor');
    await page.getByTestId('trr-ficha-causa').fill('Hipóxia');
    await page.getByTestId('trr-ficha-corrigir').click();
    await expect(page.getByTestId('trr-mensagem')).toContainText('versão 3');
    await expect(
      page.locator('[data-testid^="trr-ficha-lida-"][data-situacao="finalizada"]').first(),
    ).toHaveAttribute('data-versao', '3');

    // À mão, o motivo é obrigatório.
    await page.getByTestId('trr-acionar-mao').click();
    await page.getByTestId('trr-mao-motivo').fill('curto');
    await expect(page.getByTestId('trr-mao-confirmar')).toBeDisabled();
    await page.getByTestId('trr-mao-motivo').fill('Rebaixamento súbito do nível de consciência');
    await page.getByTestId('trr-mao-confirmar').click();
    await expect(
      page.locator('[data-testid^="trr-acionamento-"][data-origem="manual"]').first(),
    ).toBeVisible();

    // Os indicadores com o numerador e o denominador.
    await page.getByTestId('trr-ind-calcular').click();
    // Revisão W0-03: tudo pelas chaves de i18n (o texto montado no servidor não vai à tela).
    await expect(page.getByTestId('trr-ind-resultado')).toContainText('× 1.000');
    await expect(page.getByTestId('trr-ind-resultado')).toContainText('/');
    await expect(page.getByTestId('trr-ind-alerta')).toContainText('acionamento(s)');
    await expect(page.getByTestId('trr-ind-impressao')).toHaveCount(0);
    expect(externas).toEqual([]);
  });
});
