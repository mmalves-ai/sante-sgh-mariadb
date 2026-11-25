// E2E @F3.2-01 (02-REC linha 30: abrir o atendimento com cabeçalho único e corrigir o que foi aberto). Sessão real
// sobre a fonte sintética de dev e a porta do atendimento em MEMÓRIA (fichas, contas e procedimentos SINTÉTICOS; nada
// vai à cópia). Prova, na tela: a consulta aberta pela recepção; o procedimento extra lançado; a correção do extra
// conferida na hora (o botão só libera com a justificativa E com algo mudado) e gravada; o estorno com a justificativa
// e a senha, com a tabela vazia depois; a correção da ficha (observação) com a justificativa obrigatória; e o painel
// de indicadores do período com o volume, o pronto atendimento e a evasão. axe sem violação séria em cada tela.
import { expect, type Page, test } from '@playwright/test';
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

/** Abre uma consulta do paciente 1001 (JOSÉ DA SILVA) na recepção e devolve o número do atendimento. */
async function abrirConsulta(page: Page): Promise<number> {
  await page.goto('/recepcao/atendimento/novo');
  await expect(page.getByTestId('tela-abrir-atendimento')).toBeVisible();
  await page.getByTestId('abrir-atd-termo').fill('JOSE DA SILVA');
  await page.getByTestId('abrir-atd-buscar').click();
  await page.getByTestId('abrir-atd-paciente-1001').click();
  const ficha = page.getByRole('region', { name: 'Dados do atendimento' });
  await escolher(ficha.getByLabel('Tipo', { exact: true }), 'consulta');
  await escolher(ficha.getByLabel('Convênio', { exact: true }), '306');
  await escolher(ficha.getByLabel('Especialidade', { exact: true }), '15');
  await escolher(ficha.getByLabel('Profissional', { exact: true }), '7101');
  await escolher(ficha.getByLabel('Unidade', { exact: true }), '1');
  await escolher(ficha.getByLabel('Centro de custo', { exact: true }), '300600');
  await page.getByTestId('abrir-atd-procedimento').fill('10101012');
  await page.getByTestId('abrir-atd-cid').fill('febre');
  await page.getByTestId('abrir-atd-cid-buscar').click();
  await page.getByTestId('abrir-atd-cid-1').click();
  await page.getByTestId('botao-abrir-atendimento').click();
  await expect(page.getByTestId('tela-impressos')).toBeVisible();
  const reg = Number(/\/recepcao\/atendimento\/(\d+)\//.exec(page.url())?.[1]);
  expect(reg).toBeGreaterThan(0);
  return reg;
}

test.describe('Atendimento: abrir, corrigir e estornar o extra, corrigir a ficha e os indicadores @F3.2-01', () => {
  test.setTimeout(180_000);

  test('extra lançado, corrigido (conferência na hora) e estornado com a senha; ficha corrigida; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.ATENDIMENTO');
    const reg = await abrirConsulta(page);

    // Procedimentos do atendimento: a situação da conta à vista e o extra lançado na mesma tela.
    await page.goto(`/recepcao/atendimento/${reg}/procedimentos`);
    await expect(page.getByTestId('tela-procedimentos')).toBeVisible();
    await expect(page.getByTestId('situacao-conta')).toBeVisible();
    await page.getByTestId('extras-termo').fill('HEMOGRAMA');
    await page.getByTestId('extras-buscar').click();
    await page.getByTestId('extras-proc-40301630').click();
    await page.getByLabel('Quantidade', { exact: true }).fill('2');
    await page.getByTestId('botao-lancar-extra').click();
    await expect(page.getByTestId('extra-lancado')).toBeVisible();
    await expect(page.getByTestId('tabela-extras')).toContainText('HEMOGRAMA');
    await semViolacaoAxe(page, '/recepcao/atendimento/:reg/procedimentos');

    // Corrigir: só a justificativa não libera (nada mudou); com a quantidade nova, libera e grava.
    await page.getByTestId('extra-corrigir-1').click();
    const extra = page.getByTestId('dialogo-extra');
    await expect(extra).toBeVisible();
    await extra.locator('#extra-justificativa').fill('Foram colhidas três amostras (teste E2E)');
    await expect(extra.getByTestId('botao-confirmar-extra')).toBeDisabled();
    await extra.getByTestId('extra-nova-quantidade').fill('3');
    await expect(extra.getByTestId('botao-confirmar-extra')).toBeEnabled();
    await semViolacaoAxe(page, 'diálogo da correção do extra');
    await extra.getByTestId('botao-confirmar-extra').click();
    await expect(extra).toHaveCount(0);
    await expect(page.getByTestId('tabela-extras').locator('tbody tr').first()).toContainText('3');

    // Estornar: pede a justificativa e a senha; sem a senha o botão não libera; depois, a tabela some.
    await page.getByTestId('extra-estornar-1').click();
    await expect(extra.getByTestId('extra-senha')).toBeVisible();
    await extra.locator('#extra-justificativa').fill('Lançado no atendimento errado (teste E2E)');
    await expect(extra.getByTestId('botao-confirmar-extra')).toBeDisabled();
    await extra.getByTestId('extra-senha').fill(SENHA);
    await semViolacaoAxe(page, 'diálogo do estorno do extra');
    await extra.getByTestId('botao-confirmar-extra').click();
    await expect(page.getByTestId('tabela-extras')).toHaveCount(0);

    // Corrigir a ficha: a observação muda um campo; a gravação exige a justificativa; a tela relê o que ficou.
    await page.goto(`/recepcao/atendimento/${reg}/corrigir`);
    await expect(page.getByTestId('tela-corrigir-ficha')).toBeVisible();
    await expect(page.getByTestId('corrigir-mudancas')).toContainText('Nenhum campo mudou');
    await expect(page.getByTestId('botao-revisar-correcao')).toBeDisabled();
    await page.getByLabel(/Observação/).fill('Paciente veio com acompanhante (teste E2E)');
    await expect(page.getByTestId('corrigir-mudancas')).toContainText('1');
    await semViolacaoAxe(page, '/recepcao/atendimento/:reg/corrigir');
    await page.getByTestId('botao-revisar-correcao').click();
    const dialogo = page.getByTestId('dialogo-correcao');
    await expect(dialogo).toBeVisible();
    await expect(dialogo.getByTestId('botao-gravar-correcao')).toBeDisabled();
    await dialogo.getByLabel(/Justificativa/).fill('Observação esquecida na abertura (teste E2E)');
    await dialogo.getByTestId('botao-gravar-correcao').click();
    await expect(page.getByTestId('ficha-corrigida')).toBeVisible();
    await page.goto(`/recepcao/atendimento/${reg}/corrigir`);
    await expect(page.getByLabel(/Observação/)).toHaveValue('Paciente veio com acompanhante (teste E2E)');
    expect(externas).toEqual([]);
  });

  test('o painel de indicadores do período mostra o volume, o pronto atendimento e a evasão; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.ATENDIMENTO');
    await abrirConsulta(page);
    await page.goto('/recepcao/atendimento/indicadores');
    await expect(page.getByTestId('tela-indicadores-atendimento')).toBeVisible();
    await expect(page.getByTestId('ind-atd-periodo')).toBeVisible();
    await expect(page.getByTestId('ind-atd-volume')).toBeVisible();
    await expect(page.getByTestId('ind-atd-pa')).toContainText('atendimento(s)');
    await expect(page.getByTestId('ind-atd-evasao')).toContainText('Evasão');
    await expect(page.getByTestId('ind-atd-desfechos')).toBeVisible();
    await semViolacaoAxe(page, '/recepcao/atendimento/indicadores');
    expect(externas).toEqual([]);
  });
});
