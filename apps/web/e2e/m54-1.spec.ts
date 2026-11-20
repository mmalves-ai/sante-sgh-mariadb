// E2E @M54.1 (ficha do M54, fatia F1: plano de contas e referencial, regras de contabilização versionadas, leitura
// incremental dos fatos; seções 5, 7, 8 regras 1 e 2, 10 e 11 na parte da F1): com a contabilidade desligada, a tela
// mostra o motivo e só os cadastros → o administrador registra a conferência e liga a chave `contabil` → o contador abre
// Controladoria › Contabilidade › Plano de contas e plano referencial pelo menu → a árvore, a busca e o detalhe da conta
// → a regra nova da receita da conta fechada (débito e crédito), simulada com os fatos do período e publicada com a
// senha → os fatos dos módulos com o resumo por origem e a conferência do reprocessamento (idêntico) → a aba Cadastros
// com o CRUD genérico embutido. Axe sem violação séria em cada estado. Sessão sintética, plano, fatos e regras
// SINTÉTICOS em memória (nada vai à cópia; nenhuma pessoa).
import { expect, type Page, test } from '@playwright/test';
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

async function chave(page: Page, recurso: string, motivo: string): Promise<void> {
  await page.getByTestId(`abrir-${recurso}`).click();
  const form = page.getByTestId('form-liberacao');
  await form.getByTestId('opcao-ligar').check();
  await form.getByLabel('Justificativa').fill(motivo);
  await form.getByTestId('liberacao-senha').fill(SENHA);
  await form.getByTestId('liberacao-aplicar').click();
  await expect(page.getByTestId('mensagem-liberacao')).toContainText('chave(s) alterada(s)', {
    timeout: 30_000,
  });
}
/** Registra a conferência e liga o recurso (se outro cenário já o ligou, segue). */
async function ligar(page: Page, recurso: string, evidencia: string): Promise<void> {
  await expect(page.getByTestId(`recurso-${recurso}`)).toBeVisible({ timeout: 30_000 });
  const cartao = await page.getByTestId(`recurso-${recurso}`).innerText();
  if (cartao.includes('Ligada')) return;
  if (cartao.includes('Sem pré-requisito externo')) return chave(page, recurso, evidencia);
  await page.getByTestId(`abrir-${recurso}`).click();
  const pre = page.getByTestId('form-prerequisito');
  await pre.getByLabel('Evidência (protocolo ou número; nunca o certificado ou a senha)').fill(evidencia);
  await pre.locator('#prereq-senha').fill(SENHA);
  await pre.getByRole('button', { name: 'Registrar pré-requisito' }).click();
  await expect(page.getByTestId('mensagem-liberacao')).toBeVisible({ timeout: 30_000 });
  await chave(page, recurso, evidencia);
}

test.describe('controladoria, fatia F1: plano de contas, regras versionadas e fatos dos módulos @M54.1', () => {
  test.setTimeout(300_000);

  test('desligada → ligar → plano → regra simulada e publicada → fatos e reprocessamento → cadastros; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);

    // Desligada: o motivo (POL-3) e só a aba dos cadastros genéricos.
    await entrar(page, 'SINT.CONTADOR');
    await (await itemDoMenu(page, 'Plano de contas e plano referencial')).click();
    await expect(page).toHaveURL(/\/contabil\/plano$/);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Plano de contas e plano referencial' }),
    ).toBeVisible();
    await expect(page.getByTestId('contabil-desligada')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('tabela-plano')).toHaveCount(0);
    await expect(page.getByTestId('aba-cadastros-contabil')).toBeVisible();
    await semViolacaoAxe(page, '/contabil/plano (desligada)');

    // O administrador registra a conferência e liga a contabilidade.
    await entrar(page, 'SINT.ADMIN');
    await page.goto('/administracao/liberacao');
    await ligar(page, 'contabil', 'Competência sintética conferida com o escritório (E2E M54.1)');

    // O plano: a árvore, a busca e o detalhe da conta analítica com o vínculo referencial.
    await entrar(page, 'SINT.CONTADOR');
    await (await itemDoMenu(page, 'Plano de contas e plano referencial')).click();
    await expect(page.getByTestId('tabela-plano')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('plano-busca').locator('input').fill('receber');
    await expect(page.getByTestId('conta-1.1.2.01.0001')).toBeVisible();
    await expect(page.getByTestId('conta-3.1.1.01.0001')).toHaveCount(0);
    await page.getByTestId('conta-detalhe-1.1.2.01.0001').click();
    await expect(page.getByTestId('conta-detalhe')).toContainText('Convênios a receber');
    await expect(page.getByTestId('conta-referencial')).toContainText('lucro real');
    await expect(page.getByTestId('conta-detalhe')).toContainText('1.01.02.01');
    await semViolacaoAxe(page, '/contabil/plano (detalhe da conta)');

    // A regra nova da receita da conta fechada: débito no a receber, crédito na receita; simulação e publicação.
    await page.getByTestId('plano-aba-regras').click();
    await escolher(page.getByTestId('regras-origem'), { rotulo: 'Convênio' });
    await escolher(page.getByTestId('regras-tipo-fato'), { rotulo: 'Receita da conta fechada' });
    await expect(page.getByTestId('regras-nenhuma')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('regras-nova').click();
    const editor = page.getByTestId('regra-editor');
    await editor.getByTestId('regra-nome').locator('input').fill('Receita de convênios (E2E)');
    // A vigência desde o início da competência dos fatos sintéticos (outubro de 2026).
    const inicio = editor.getByTestId('regra-inicio').locator('input').first();
    await inicio.fill('01/10/2026');
    await inicio.press('Tab');
    await escolher(editor.getByTestId('regra-partida-conta-0'), { rotulo: /Convênios a receber/ });
    await editor
      .getByTestId('regra-partida-0')
      .getByLabel(/Histórico/)
      .fill('Conta {documento}');
    await escolher(editor.getByTestId('regra-partida-conta-1'), { rotulo: /Receita de convênios/ });
    await editor
      .getByTestId('regra-partida-1')
      .getByLabel(/Histórico/)
      .fill('Receita {competencia}');
    await expect(editor.getByTestId('regra-problemas')).toHaveCount(0);
    await escolher(editor.getByTestId('regra-competencia'), { rotulo: '10/2026' });
    await editor.getByTestId('regra-simular').click();
    const simulacao = editor.getByTestId('regra-simulacao');
    await expect(simulacao).toBeVisible({ timeout: 30_000 });
    await expect(simulacao.getByTestId('simulacao-fatos')).toContainText('3 fatos');
    await expect(simulacao.getByTestId('simulacao-totais')).toContainText('R$ 2.525,50');
    await semViolacaoAxe(page, '/contabil/plano (regra simulada)');
    await editor
      .getByTestId('regra-justificativa')
      .locator('textarea')
      .fill('Primeira regra da receita (E2E).');
    await editor.getByTestId('regra-senha').fill(SENHA);
    await editor.getByTestId('regra-publicar').click();
    await expect(page.getByTestId('regras-aviso')).toContainText('publicada', { timeout: 30_000 });
    await expect(page.getByTestId('tabela-regras')).toContainText('Receita de convênios (E2E)');
    await semViolacaoAxe(page, '/contabil/plano (regra publicada)');

    // Os fatos dos módulos: o resumo por origem e a conferência do reprocessamento (as duas aplicações iguais).
    await (await itemDoMenu(page, 'Lançamentos automáticos dos módulos e razão')).click();
    await expect(page).toHaveURL(/\/contabil\/lancamentos$/);
    // M54.2: a tela abre na aba Lançamentos; os fatos ficam na aba própria.
    await page.getByTestId('lancamentos-aba-fatos').click();
    await expect(page.getByTestId('tabela-resumo-fatos')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('resumo-total')).toContainText('3');
    await expect(page.getByTestId('tabela-fatos')).toBeVisible();
    await semViolacaoAxe(page, '/contabil/lancamentos (fatos dos módulos)');
    await page.getByTestId('reprocessar-conferir').click();
    await expect(page.getByTestId('reprocessar-resultado')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('reprocessar-identico')).toBeVisible();
    await semViolacaoAxe(page, '/contabil/lancamentos (reprocessamento conferido)');

    // A aba Cadastros: o CRUD genérico das origens de lançamento embutido.
    await (await itemDoMenu(page, 'Plano de contas e plano referencial')).click();
    await page.getByTestId('plano-aba-cadastros').click();
    await escolher(page.getByTestId('contabil-cadastro'), { rotulo: 'Origens de lançamento contábil' });
    await expect(page.getByTestId('tela-dominio-contabil.origemLancamento')).toBeVisible({ timeout: 30_000 });
    await semViolacaoAxe(page, '/contabil/plano (cadastros)');

    expect(externas).toEqual([]);
  });
});
