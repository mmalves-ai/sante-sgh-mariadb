// E2E @C2-093 (07-FIN linha 124; ADR 0003): os módulos publicam o fato contábil na transação do documento e a
// contabilidade gera o lançamento automático pela regra publicada. O contador abre Controladoria › Contabilidade ›
// Plano de contas e plano referencial pelo menu → a regra do repasse (origem Repasse médico, tipos Repasse ao
// profissional e Desconto no repasse) está no catálogo → Lançamentos automáticos dos módulos e razão → na aba dos
// fatos, o resumo por origem traz as fontes publicadas pelos módulos (contas dos pacientes, depreciação, impairment,
// folha e repasse) com o rótulo de produto e nunca o nome da tabela → a conferência do reprocessamento (idêntico) e a
// gravação com a senha → a aba Lançamentos com a tabela. Axe sem violação séria em cada estado. Sessão, fatos e regras
// SINTÉTICOS (nenhuma pessoa).
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

test.describe('contabilidade: lançamento automático dos fatos publicados pelos módulos @C2-093', () => {
  test.setTimeout(240_000);

  test('regra do repasse no catálogo → fontes publicadas no resumo → reprocessamento gravado → lançamentos; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.CONTADOR');

    // O catálogo das regras já traz a origem do repasse médico e os dois tipos de fato do repasse.
    await (await itemDoMenu(page, 'Plano de contas e plano referencial')).click();
    await expect(page).toHaveURL(/\/contabil\/plano$/);
    await page.getByTestId('plano-aba-regras').click();
    await escolher(page.getByTestId('regras-origem'), { rotulo: 'Repasse médico' });
    await escolher(page.getByTestId('regras-tipo-fato'), { rotulo: 'Repasse ao profissional' });
    await expect(page.getByTestId('regras-nenhuma').or(page.getByTestId('tabela-regras'))).toBeVisible({
      timeout: 30_000,
    });
    await escolher(page.getByTestId('regras-tipo-fato'), { rotulo: 'Desconto no repasse do profissional' });
    await semViolacaoAxe(page, '/contabil/plano (regras do repasse)');

    // Os fatos dos módulos: as fontes publicadas na transação do documento aparecem pelo rótulo de produto.
    await (await itemDoMenu(page, 'Lançamentos automáticos dos módulos e razão')).click();
    await expect(page).toHaveURL(/\/contabil\/lancamentos$/);
    await page.getByTestId('lancamentos-aba-fatos').click();
    const resumo = page.getByTestId('tabela-resumo-fatos');
    await expect(resumo).toBeVisible({ timeout: 30_000 });
    for (const rotulo of [
      'Contas dos pacientes (receita)',
      'Folha de pagamento (custo de pessoal)',
      'Depreciação dos bens patrimoniais',
      'Perda por impairment dos bens patrimoniais',
      'Repasse aos profissionais',
    ])
      await expect(resumo).toContainText(rotulo);
    for (const tabela of ['lancamento_repasse', 'cota_depreciacao', 'ajuste_valor_bem', 'conta_hospitalar'])
      await expect(resumo).not.toContainText(tabela);
    await semViolacaoAxe(page, '/contabil/lancamentos (fatos publicados pelos módulos)');

    // O reprocessamento: conferido (as duas aplicações iguais) e gravado com a senha.
    await page.getByTestId('reprocessar-conferir').click();
    await expect(page.getByTestId('reprocessar-resultado')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('reprocessar-identico')).toBeVisible();
    await page.getByTestId('reprocessar-senha').fill(SENHA);
    await page.getByTestId('reprocessar-gravar').click();
    await expect(page.getByTestId('reprocessar-resultado')).toBeVisible({ timeout: 30_000 });
    await semViolacaoAxe(page, '/contabil/lancamentos (reprocessamento gravado)');

    // O lançamento automático na aba Lançamentos.
    await page.getByTestId('lancamentos-aba-lancamentos').click();
    await expect(page.getByTestId('tabela-lancamentos')).toBeVisible({ timeout: 30_000 });
    await semViolacaoAxe(page, '/contabil/lancamentos (lançamentos automáticos)');

    expect(externas).toEqual([]);
  });
});
