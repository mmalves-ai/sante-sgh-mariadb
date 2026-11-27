// E2E @F3.9-02 (01-ADM linha 59): escopo de tipo de agenda na ficha do usuário (conceder e retirar com a senha de
// novo) e a tela do vínculo da conta ao estabelecimento (abre da ficha com o login; o botão só libera com o
// formulário completo; a recusa do servidor aparece na tela; a senha não fica no campo). Sessão real sobre a fonte
// sintética de dev (SINT.GESTOR), que tem um estabelecimento só: nela, dar acesso a quem já tem e encerrar o único
// vínculo são recusados pela regra; a conta SINT.MULTIUNIDADE tem também o outro estabelecimento da rede
// (memória), para o caminho feliz. O efeito no banco está no contrato vinculo-estabelecimento-propria.int.spec.
// Nenhum dado real.
import { expect, test, type Page } from '@playwright/test';
import { semViolacaoAxe } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';

async function entrar(page: Page, login: string): Promise<void> {
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

test.describe('Escopo do usuário: tipo de agenda e vínculo ao estabelecimento @F3.9-02', () => {
  test('ficha: conceder e retirar tipo de agenda com a senha de novo @F3.9-02', async ({ page }) => {
    await entrar(page, 'SINT.GESTOR');
    await page.goto('/administracao/acesso/usuarios/SINT.MEDICO');
    await page.getByTestId('ficha-aba-escopos').click();
    const tipos = page.getByTestId('escopo-tipoAgenda');
    await page.getByTestId('adicionar-tipoAgenda').click();
    await escolher(page.getByTestId('escolher-tipoAgenda'), '2');
    await page.getByTestId('conceder-tipoAgenda').click();
    await page.getByTestId('ficha-senha').fill(SENHA);
    await page.getByTestId('reautenticar-confirmar').click();
    await expect(page.getByTestId('form-reautenticar')).toHaveCount(0);
    await expect(tipos.getByTestId('retirar-tipoAgenda-2')).toBeVisible();
    await page.getByTestId('retirar-tipoAgenda-2').click();
    await page.getByTestId('ficha-senha').fill(SENHA);
    await page.getByTestId('reautenticar-confirmar').click();
    await expect(page.getByTestId('retirar-tipoAgenda-2')).toHaveCount(0);
  });

  test('vínculo: abre da ficha com o login; validação na hora; recusas da regra na tela; axe @F3.9-02', async ({
    page,
  }) => {
    await entrar(page, 'SINT.GESTOR');
    await page.goto('/administracao/acesso/usuarios/SINT.MEDICO');
    await page.getByTestId('atalho-vinculo-conta').click();
    await expect(page).toHaveURL(/\/administracao\/acesso\/vinculo-conta\?login=SINT\.MEDICO/);
    const form = page.getByTestId('form-vinculo');
    await expect(form.getByLabel('Login da conta')).toHaveValue('SINT.MEDICO');
    await semViolacaoAxe(page, 'vínculo da conta');
    // Veio da ficha: a ação inicial é encerrar, com o aviso das sessões; sem a senha o botão não libera.
    await expect(page.getByTestId('vinculo-aviso-encerrar')).toBeVisible();
    await expect(page.getByTestId('vinculo-gravar')).toBeDisabled();
    await page.getByTestId('vinculo-senha').fill(SENHA);
    await expect(page.getByTestId('vinculo-gravar')).toBeEnabled();
    await page.getByTestId('vinculo-gravar').click();
    // Estabelecimento único da fonte sintética: o único vínculo da conta não se encerra aqui.
    await expect(form).toContainText('único estabelecimento da conta');
    await expect(page.getByTestId('vinculo-senha')).toHaveValue('');
    await expect(page.getByTestId('vinculo-feito')).toHaveCount(0);
    // Dar acesso: o grupo passa a ser exigido; quem já tem acesso é recusado.
    await escolher(page.getByTestId('vinculo-acao'), 'dar');
    await page.getByTestId('vinculo-senha').fill(SENHA);
    await expect(page.getByTestId('vinculo-gravar')).toBeDisabled();
    await escolher(page.getByTestId('vinculo-grupo'), { indice: 1 });
    await expect(page.getByTestId('vinculo-gravar')).toBeEnabled();
    await page.getByTestId('vinculo-gravar').click();
    await expect(form).toContainText('já tem acesso a este estabelecimento');
    // Login que não existe no cliente.
    await form.getByLabel('Login da conta').fill('SINT.NAO-EXISTE');
    await page.getByTestId('vinculo-senha').fill(SENHA);
    await page.getByTestId('vinculo-gravar').click();
    await expect(form).toContainText('Não há conta com este login');
    await page.getByTestId('vinculo-voltar').click();
    await expect(page).toHaveURL(/\/administracao\/acesso\/usuarios$/);
  });

  test('vínculo, caminho feliz: encerrar o acesso e dar de novo à conta que tem outro estabelecimento @C2-051', async ({
    page,
  }) => {
    // SINT.MULTIUNIDADE tem, na memória da fonte sintética, também um vínculo vigente no outro estabelecimento da
    // rede: o encerramento aqui passa pela regra do domínio; dar o acesso de novo exige o grupo.
    await entrar(page, 'SINT.GESTOR');
    await page.goto('/administracao/acesso/vinculo-conta?login=SINT.MULTIUNIDADE');
    const form = page.getByTestId('form-vinculo');
    await expect(form.getByLabel('Login da conta')).toHaveValue('SINT.MULTIUNIDADE');
    await page.getByTestId('vinculo-senha').fill(SENHA);
    await page.getByTestId('vinculo-gravar').click();
    await expect(page.getByTestId('vinculo-feito')).toContainText('SINT.MULTIUNIDADE');
    await expect(page.getByTestId('vinculo-senha')).toHaveValue('');
    await escolher(page.getByTestId('vinculo-acao'), 'dar');
    await form.getByLabel('Login da conta').fill('SINT.MULTIUNIDADE');
    await escolher(page.getByTestId('vinculo-grupo'), { indice: 1 });
    await page.getByTestId('vinculo-senha').fill(SENHA);
    await page.getByTestId('vinculo-gravar').click();
    await expect(page.getByTestId('vinculo-feito')).toContainText('SINT.MULTIUNIDADE');
    await expect(page.getByTestId('vinculo-feito').getByRole('link')).toBeVisible();
    await semViolacaoAxe(page, 'vínculo feito');
  });
});
