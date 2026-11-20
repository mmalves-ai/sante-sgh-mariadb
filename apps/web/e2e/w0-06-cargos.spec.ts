// E2E @W0-06 (programa CRUD completo; parte 4b: cargos e salários, M1 de mercado): liga o cadastro → o RH inclui um
// cargo com o CBO pela busca e o conselho exigido → altera os requisitos com motivo (o valor anterior no histórico) →
// inclui a faixa salarial e lança o novo valor a partir de amanhã (a versão anterior fica encerrada) → inclui vagas no
// quadro de um centro de custo → tenta excluir o cargo: 409 com a contagem e a oferta da inativação no próprio diálogo
// → inativa com motivo e reativa → um segundo cargo, nunca usado, é excluído com motivo → recolher.
// Axe sem violação séria na tela e nos diálogos. Sessão real sobre a fonte sintética; cargos em MEMÓRIA (nada vai à cópia).
import { expect, test, type Page } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
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

const p2 = (x: number) => String(x).padStart(2, '0');
const br = (d: Date) => `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()}`;

async function abrirLiberacao(page: Page): Promise<void> {
  await entrar(page, 'SINT.ADMIN');
  await page.goto('/administracao/liberacao');
  await expect(page.getByTestId('recurso-pessoas.colaborador')).toBeVisible({ timeout: 30_000 });
}
async function prerequisito(page: Page, recurso: string, evidencia: string): Promise<void> {
  await page.getByTestId(`abrir-${recurso}`).click();
  const pre = page.getByTestId('form-prerequisito');
  await pre.getByLabel('Evidência (protocolo ou número; nunca o certificado ou a senha)').fill(evidencia);
  await pre.locator('#prereq-senha').fill(SENHA);
  await pre.getByRole('button', { name: 'Registrar pré-requisito' }).click();
  await expect(page.getByTestId('mensagem-liberacao')).toBeVisible();
}
async function chave(page: Page, recurso: string, ligar: boolean, motivo: string): Promise<void> {
  await page.getByTestId(`abrir-${recurso}`).click();
  const form = page.getByTestId('form-liberacao');
  await form.getByTestId(ligar ? 'opcao-ligar' : 'opcao-desligar').check();
  await form.getByLabel('Justificativa').fill(motivo);
  await form.getByTestId('liberacao-senha').fill(SENHA);
  await form.getByTestId('liberacao-aplicar').click();
  await expect(page.getByTestId('mensagem-liberacao')).toContainText('chave(s) alterada(s)');
}

/** O diálogo do motivo: confirmar fica desabilitado com menos de 10 caracteres; a variante destrutiva pergunta. */
async function confirmarComMotivo(
  page: Page,
  testid: string,
  motivo: string,
  destrutivo = true,
): Promise<void> {
  const d = page.getByTestId(testid);
  await expect(d).toBeVisible();
  await d.getByLabel('Motivo').fill('curto');
  await expect(page.getByTestId(`${testid}-confirmar`)).toBeDisabled();
  await d.getByLabel('Motivo').fill(motivo);
  await semViolacaoAxe(page, `diálogo ${testid}`);
  await page.getByTestId(`${testid}-confirmar`).click();
  if (destrutivo) await page.getByTestId('confirmacao').getByRole('button', { name: 'Confirmar' }).click();
}

async function novoCargo(page: Page, nome: string, cbo: string, rotuloCbo: RegExp): Promise<void> {
  await page.getByTestId('novo-cargo').click();
  const f = page.getByTestId('form-cargo');
  await f.getByLabel('Nome do cargo').fill(nome);
  await f.getByLabel('Buscar a ocupação (código ou nome)').fill(cbo);
  await page.getByTestId('cargo-cbo-buscar').click();
  await escolher(f.getByTestId('cargo-cbo'), { rotulo: rotuloCbo });
}

test.describe('W0-06 (parte 4b): cargos, tabela salarial e quadro de vagas com motivo, versão, inativação e recusa @W0-06', () => {
  test.setTimeout(300_000);

  test('ligar → cargo com CBO → alterar → faixa e versão → vaga → exclusão recusada e inativação → nunca usado excluído → recolher; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    const amanha = new Date(Date.now() + 86_400_000);
    const sufixo = Date.now().toString(36).slice(-5).toUpperCase();
    const nome = `Enfermeiro assistencial W006 ${sufixo}`;
    const engano = `Cargo por engano W006 ${sufixo}`;

    await abrirLiberacao(page);
    await prerequisito(page, 'pessoas.colaborador', 'Conferência sintética do RH (E2E W0-06 cargos)');
    await chave(page, 'pessoas.colaborador', true, 'Cargos sintéticos do E2E W0-06');

    // O RH inclui o cargo: o CBO vem da busca no cadastro oficial; o conselho, do combo com busca.
    await entrar(page, 'SINT.RH');
    await page.goto('/pessoas/cargos');
    await expect(page.getByTestId('tela-cargos')).toBeVisible({ timeout: 30_000 });
    await semViolacaoAxe(page, '/pessoas/cargos');
    await novoCargo(page, nome, 'Enfermeiro', /223505/);
    const f = page.getByTestId('form-cargo');
    await escolher(f.getByTestId('cargo-conselho'), { rotulo: /COREN/ });
    await f.getByLabel('Requisitos (formação, experiência)').fill('Graduação em enfermagem');
    await page.getByTestId('gravar-cargo').click();
    await expect(page.getByTestId('cargos-resultado')).toBeVisible();
    await expect(page.getByTestId('tabela-cargos')).toContainText(nome);
    await expect(page.getByTestId('cargo-aba-faixas')).toBeVisible();

    // Alteração com motivo: o valor anterior fica no histórico.
    await f.getByLabel('Requisitos (formação, experiência)').fill('Graduação em enfermagem e COREN ativo');
    await page.getByTestId('gravar-cargo').click();
    await confirmarComMotivo(
      page,
      'dialogo-alterar-cargo',
      'Requisito do conselho exigido pela CCIH (E2E)',
      false,
    );
    await page.getByTestId('cargo-aba-historico').click();
    const h = page.getByTestId('cargo-historico');
    await expect(h).toContainText('Cargo alterado');
    await expect(h).toContainText('Requisito do conselho exigido pela CCIH');
    await expect(h).toContainText('Graduação em enfermagem → Graduação em enfermagem e COREN ativo');

    // Tabela salarial: faixa e nível; o novo valor a partir de amanhã encerra a versão anterior.
    await page.getByTestId('cargo-aba-faixas').click();
    const ff = page.getByTestId('form-faixa');
    await ff.getByLabel('Faixa', { exact: true }).fill('I');
    await ff.getByLabel('Nível', { exact: true }).fill('A');
    await ff.getByLabel('Valor (R$)').fill('5.000,00');
    await page.getByTestId('incluir-faixa').click();
    await expect(page.getByTestId('tabela-faixas')).toContainText('R$ 5.000,00');
    await semViolacaoAxe(page, '/pessoas/cargos (tabela salarial)');
    await page.locator('[data-testid^="versao-faixa-"]').first().click();
    const dv = page.getByTestId('dialogo-versao-faixa');
    await dv.getByLabel('Valor (R$)').fill('5.300,00');
    await dv.getByLabel('A partir de').fill(br(amanha));
    await dv.getByLabel('A partir de').press('Tab');
    await confirmarComMotivo(page, 'dialogo-versao-faixa', 'Reajuste do piso da enfermagem (E2E)', false);
    const tf = page.getByTestId('tabela-faixas');
    await expect(tf).toContainText('R$ 5.300,00');
    await expect(tf).toContainText('Encerrada');
    await expect(tf).toContainText('Reajuste do piso da enfermagem');

    // Quadro de vagas aprovado por centro de custo.
    await page.getByTestId('cargo-aba-vagas').click();
    const fv = page.getByTestId('form-vaga');
    await escolher(fv.getByTestId('vaga-centro'), { indice: 0 });
    await fv.getByLabel('Vagas aprovadas').fill('3');
    await page.getByTestId('incluir-vaga').click();
    await expect(page.getByTestId('tabela-vagas')).toContainText('3');
    await semViolacaoAxe(page, '/pessoas/cargos (quadro de vagas)');

    // O cargo referenciado (faixas e vaga) não se exclui: 409 com a contagem e a inativação oferecida no diálogo.
    await page.getByTestId('cargo-aba-cargo').click();
    await page.getByTestId('excluir-cargo').click();
    await confirmarComMotivo(page, 'dialogo-excluir-cargos', 'Tentativa de excluir o cargo em uso (E2E)');
    await expect(page.getByTestId('dialogo-excluir-cargos-bloqueios')).toBeVisible();
    await expect(page.getByTestId('dialogo-excluir-cargos')).toContainText('inative');
    await semViolacaoAxe(page, '/pessoas/cargos (exclusão recusada)');
    await page.getByTestId('inativar-em-vez').click();
    await confirmarComMotivo(page, 'dialogo-situacao-cargos', 'Cargo extinto no novo plano de cargos (E2E)');
    await expect(page.getByTestId('cargo-situacao')).toContainText(
      'Inativo: Cargo extinto no novo plano de cargos',
    );
    await expect(page.getByTestId('tabela-cargos')).toContainText('Inativo');
    await page.getByTestId('situacao-cargo').click();
    await confirmarComMotivo(
      page,
      'dialogo-situacao-cargos',
      'Cargo mantido após a revisão do plano (E2E)',
      false,
    );
    await expect(page.getByTestId('cargo-situacao')).toContainText('Última alteração por');
    await page.getByTestId('cargo-aba-historico').click();
    await expect(page.getByTestId('cargo-historico')).toContainText('Cargo inativado');
    await expect(page.getByTestId('cargo-historico')).toContainText('Cargo reativado');

    // O cargo nunca usado (lançado por engano) se exclui com motivo e some da lista.
    await novoCargo(page, engano, '411010', /411010/);
    await page.getByTestId('gravar-cargo').click();
    await expect(page.getByTestId('tabela-cargos')).toContainText(engano);
    await expect(page.getByTestId('excluir-cargo')).toBeVisible();
    await page.getByTestId('excluir-cargo').click();
    await confirmarComMotivo(page, 'dialogo-excluir-cargos', 'Cargo duplicado incluído por engano (E2E)');
    await expect(page.getByTestId('ficha-cargo')).toHaveCount(0);
    await expect(page.getByTestId('tabela-cargos')).not.toContainText(engano);
    await expect(page.getByTestId('tabela-cargos')).toContainText(nome);

    // Recolher.
    await abrirLiberacao(page);
    await chave(page, 'pessoas.colaborador', false, 'Recolher o E2E W0-06 cargos');
    expect(externas).toEqual([]);
  });
});
