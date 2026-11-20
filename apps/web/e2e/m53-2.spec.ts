// E2E @M53.2 (ficha do M53, fatia F1 rubricas e incidências; seções 4, 5, 7, 8 regra 7 e 10 na parte da F1): o DP
// abre Gestão de pessoas › Folha de pagamento pelo menu e segue para as rubricas → as rubricas em vigor na competência atual, com a que saiu de
// vigência fora da lista e de volta com "Incluir as fora de vigência" → a conferência aponta a divergência entre a
// incidência e o código do eSocial, e "Só as com divergência" filtra → o detalhe mostra a natureza, os códigos do eSocial
// com o rótulo e as 20 incidências → a aba Tabelas legais mostra a vigência da competência (faixas que conferem) e, numa
// competência de 2025, a vigência anterior com o buraco de faixa apontado e os dias de afastamento da vigência
// anterior (regra 7: a vigência é a da data de competência) → "Alterar no cadastro" e "Abrir o cadastro da tabela legal" abrem o cadastro genérico embutido.
// Axe sem violação séria em cada estado. Sessão sintética, rubricas e tabelas legais SINTÉTICAS em memória (nada vai à
// cópia; nenhuma pessoa).
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

test.describe('folha de pagamento, fatia F1: rubricas, incidências e tabelas legais @M53.2', () => {
  test.setTimeout(240_000);

  test('menu → rubricas da competência → fora de vigência → conferência → detalhe → tabelas legais por vigência → cadastro embutido; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.DP.FOLHA');

    // Pelo menu: Gestão de pessoas › Folha de pagamento abre a folha da competência, que leva às rubricas.
    await (await itemDoMenu(page, 'Folha de pagamento')).click();
    await expect(page).toHaveURL(/\/pessoas\/folha$/);
    await page.getByTestId('folha-abrir-rubricas').click();
    await expect(page).toHaveURL(/\/pessoas\/folha\/rubricas/);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Rubricas, incidências e tabelas legais' }),
    ).toBeVisible();
    const aba = page.getByTestId('aba-rubricas');
    await expect(aba.getByTestId('tabela-rubricas')).toBeVisible({ timeout: 30_000 });
    // D-VIG-532 (exceção registrada): a rubrica vale se valer em algum dia da competência.
    await expect(page.getByTestId('rubricas-referencia')).toContainText('algum dia da competência');

    // Em vigor: 5 rubricas; a gratificação que terminou em 2024 fica fora até pedir as fora de vigência.
    await expect(page.getByTestId('rubricas-contagem')).toContainText(
      '5 rubricas em vigor; 1 fora de vigência',
    );
    await expect(page.getByTestId('rubrica-6')).toHaveCount(0);
    await semViolacaoAxe(page, '/pessoas/folha/rubricas (rubricas em vigor)');
    await page.getByTestId('rubricas-mostrar').getByText('Incluir as fora de vigência').click();
    await expect(page.getByTestId('rubricas-contagem')).toContainText('6 rubricas (com as fora de vigência)');
    await expect(page.getByTestId('rubrica-6')).toContainText('Gratificação natalina antiga');
    await page.getByTestId('rubricas-mostrar').getByText('Incluir as fora de vigência').click();
    await expect(page.getByTestId('rubrica-6')).toHaveCount(0);

    // Conferência: as horas extras não incidem em FGTS, mas o código do eSocial diz que são base.
    await expect(page.getByTestId('rubricas-conferencia')).toContainText(
      'Rubrica 3 (Horas extras 50%): o código do eSocial diz que é base de FGTS, mas a rubrica não incide.',
    );
    await page.getByTestId('rubricas-mostrar').getByText('Só as com divergência').click();
    await expect(page.getByTestId('rubrica-3')).toBeVisible();
    await expect(page.getByTestId('rubrica-1')).toHaveCount(0);
    await semViolacaoAxe(page, '/pessoas/folha/rubricas (só divergentes)');
    await page.getByTestId('rubricas-mostrar').getByText('Só as com divergência').click();

    // Busca por descrição e o detalhe da rubrica.
    await page.getByTestId('rubricas-busca').locator('input').fill('salário');
    await expect(page.getByTestId('rubrica-1')).toBeVisible();
    await expect(page.getByTestId('rubrica-2')).toHaveCount(0);
    await page.getByTestId('rubrica-detalhe-1').click();
    const detalhe = page.getByTestId('rubrica-detalhe');
    await expect(detalhe).toContainText('Rubrica 1 — Salário base');
    await expect(detalhe.getByTestId('rubrica-natureza')).toContainText('Salário, vencimento, soldo');
    await expect(detalhe.getByTestId('rubrica-esocial')).toContainText('Base de cálculo - mensal');
    await expect(detalhe.getByTestId('rubrica-incidencias').locator('dt')).toHaveCount(20);
    await expect(detalhe.getByTestId('rubrica-incidencias')).toContainText('Descanso semanal remunerado');
    await semViolacaoAxe(page, '/pessoas/folha/rubricas (detalhe da rubrica)');

    // O botão do detalhe abre o cadastro genérico das rubricas embutido, já filtrado na rubrica do detalhe.
    await detalhe.getByTestId('rubrica-alterar').click();
    await expect(page.getByTestId('aba-cadastros-folha')).toBeVisible();
    await expect(page.getByTestId('tela-dominio-pessoas.rubrica')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('busca-dominio')).toHaveValue('Salário base');
    // Com a gravação liberada para o perfil, a alteração da rubrica 1 abre direto; fecha-se para seguir.
    const dialogo = page.getByRole('dialog');
    if (
      await dialogo.waitFor({ timeout: 5_000 }).then(
        () => true,
        () => false,
      )
    ) {
      await expect(dialogo).toContainText('1');
      await page.keyboard.press('Escape');
      await expect(dialogo).toHaveCount(0);
    }
    await semViolacaoAxe(page, '/pessoas/folha/rubricas (cadastro das rubricas)');
    // Os cadastros da folha que já eram do M14 (as 12 migrar-crud da ficha) também estão na aba.
    await escolher(page.getByTestId('rubricas-cadastro'), { rotulo: 'Condições do funcionário' });
    await expect(page.getByTestId('tela-dominio-pessoas.condicaoFuncionario')).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId('tabela-dominio')).toBeVisible({ timeout: 30_000 });

    // Tabelas legais: a vigência de 2026 na competência atual, com as faixas conferindo e a redução do imposto.
    await page.getByTestId('rubricas-aba-tabelas').click();
    const tabelas = page.getByTestId('aba-tabelas-legais');
    await expect(tabelas.getByTestId('tabelas-vigente')).toContainText(
      'Tabela legal em vigor desde 01/01/2026',
      {
        timeout: 30_000,
      },
    );
    await expect(tabelas.getByTestId('tabelas-conferencia')).toContainText('As faixas conferem.');
    await expect(tabelas.getByTestId('tabela-irrf').locator('tbody tr')).toHaveCount(4);
    await expect(tabelas.getByTestId('tabelas-reducao')).toContainText('Isenção até');
    await expect(tabelas.getByTestId('tabela-inss')).toBeVisible();
    await expect(tabelas.getByTestId('tabela-salario-familia')).toBeVisible();
    await expect(tabelas.getByTestId('tabelas-gerais')).toContainText('Salário mínimo');
    await expect(tabelas.getByTestId('tabelas-afastamento')).toContainText('15 dias na competência');
    await semViolacaoAxe(page, '/pessoas/folha/rubricas (tabelas legais de 2026)');

    // Regra 7: numa competência de 2025, a vigência anterior (com o buraco de faixa do INSS apontado).
    await escolher(page.getByTestId('rubricas-competencia'), { rotulo: '06/2025' });
    await expect(tabelas.getByTestId('tabelas-vigente')).toContainText(
      'Tabela legal em vigor desde 01/01/2025',
      {
        timeout: 30_000,
      },
    );
    await expect(tabelas.getByTestId('tabelas-divergencia').first()).toContainText(
      'há um intervalo sem faixa',
    );
    await expect(tabelas.getByTestId('tabela-irrf').locator('tbody tr')).toHaveCount(3);
    await expect(tabelas.getByTestId('tabelas-afastamento')).toContainText('30 dias na competência');
    await expect(tabelas.getByTestId('tabelas-reducao')).toHaveCount(0);
    await expect(tabelas).toContainText('A vigência não tem redução.');
    await semViolacaoAxe(page, '/pessoas/folha/rubricas (tabelas legais de 2025)');

    // "Abrir o cadastro da tabela legal" abre o cadastro genérico embutido dela.
    await tabelas.getByTestId('tabelas-abrir-cadastro').click();
    await expect(page.getByTestId('tela-dominio-pessoas.tabelaLegalFolha')).toBeVisible({ timeout: 30_000 });
    await semViolacaoAxe(page, '/pessoas/folha/rubricas (cadastro da tabela legal)');

    expect(externas).toEqual([]);
  });

  test('D-ABRIR-532: quem só tem a tabela de cálculo abre o item do menu e chega às tabelas legais', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.FOLHA.TABELAS');
    await (await itemDoMenu(page, 'Folha de pagamento')).click();
    await expect(page).toHaveURL(/\/pessoas\/folha\/rubricas/, { timeout: 30_000 });
    await expect(page.getByTestId('rubricas-aba-rubricas')).toHaveCount(0);
    await expect(page.getByTestId('aba-tabelas-legais').getByTestId('tabelas-vigente')).toContainText(
      'Tabela legal em vigor desde',
      { timeout: 30_000 },
    );
    await semViolacaoAxe(page, '/pessoas/folha/rubricas (só a tabela legal)');
    expect(externas).toEqual([]);
  });
});
