// E2E @W1-04 (parte 9b): os cadastros da recepção pelo CRUD genérico, sem faixa "só consulta": recepção com o texto da
// senha obrigatório na inclusão (incluir, alterar o texto, inativar, excluir a nunca usada com motivo e senha), painel
// de chamada (incluir com o leiaute padrão, alterar o local, inativar e excluir), painel de TV de setor (incluir sob o
// portal, alterar, inativar e excluir), motivo de exclusão
// (incluir, alterar; excluir o já usado é recusado com a contagem e inativa no lugar) e procedência (alterar); o aparelho de painel muda o nome sem reemitir o
// token (o começo do token continua o mesmo). Sessão real sobre a fonte sintética de dev (SINT.ADMIN e SINT.SENHAS) e
// o banco de domínios em MEMÓRIA (nada vai à cópia); nenhum dado real.
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

async function codigoDaLinha(page: Page, texto: string): Promise<string> {
  const linha = page.getByTestId('tabela-dominio').locator('tbody tr', { hasText: texto });
  await expect(linha).toHaveCount(1);
  return ((await linha.getAttribute('data-testid')) ?? '').replace(/^item-/, '');
}

async function gravacao(page: Page, motivo: string, senha: boolean): Promise<void> {
  const dialogo = page.getByTestId('form-gravacao');
  await expect(dialogo).toBeVisible();
  await dialogo.getByTestId('dialogo-motivo').fill(motivo);
  if (senha) await dialogo.getByTestId('dialogo-senha').fill(SENHA);
  await dialogo.getByTestId('dialogo-confirmar').click();
}

test.describe('Recepção: cadastros, painéis, domínios e aparelhos @W1-04', () => {
  test.setTimeout(150_000);

  test('recepção com o texto da senha: incluir, alterar, inativar e excluir; axe', async ({ page }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.SENHAS');
    await page.goto('/cadastros/dominios/recepcao/recepcao');
    await expect(page.getByTestId('tabela-dominio')).toBeVisible();
    await expect(page.getByText(/só consulta/i)).toHaveCount(0);
    await page.getByTestId('botao-incluir').click();
    const form = page.getByTestId('form-dominio');
    await form.getByLabel('Nome da recepção ou setor').fill('RECEPCAO SINTETICA E2E');
    const texto = form.getByTestId('texto-longo-textoSenha');
    await expect(texto).toHaveAttribute('required', '');
    await semViolacaoAxe(page, 'inclusão da recepção');
    // Sem o texto da senha a inclusão não sai (campo obrigatório).
    await form.getByTestId('botao-salvar').click();
    await expect(form).toBeVisible();
    await texto.fill('SANTE\nSENHA {SENHA}\nAGUARDE A CHAMADA');
    await form.getByTestId('botao-salvar').click();
    await expect(page.getByTestId('mensagem-dominio')).toContainText('Incluído com o código');
    const codigo = await codigoDaLinha(page, 'RECEPCAO SINTETICA E2E');
    // Alterar: o texto vem carregado e não é mais obrigatório na alteração (só vai se mudar).
    await page.getByTestId(`alterar-${codigo}`).click();
    await expect(texto).toHaveValue(/AGUARDE A CHAMADA/);
    await expect(texto).not.toHaveAttribute('required', '');
    await texto.fill('SANTE\nSENHA {SENHA}\nAGUARDE NO SAGUAO');
    await form.getByTestId('botao-salvar').click();
    await expect(page.getByTestId('mensagem-dominio')).toContainText('Alterado');
    await page.getByTestId(`textos-${codigo}`).click();
    await expect(page.getByTestId('texto-textoSenha')).toHaveValue(/AGUARDE NO SAGUAO/);
    await page.getByRole('button', { name: 'Fechar' }).first().click();
    // Inativar (vale só no novo) e reativar; depois excluir a nunca usada com motivo e senha.
    await page.getByTestId(`inativar-${codigo}`).click();
    await gravacao(page, 'Setor fechado na reforma (teste E2E)', false);
    await expect(page.getByTestId('mensagem-dominio')).toContainText('Inativado');
    await page.getByTestId('mostrar-inativos').check();
    await page.getByTestId(`excluir-${codigo}`).click();
    await gravacao(page, 'Cadastrada por engano (teste E2E)', true);
    await expect(page.getByTestId('mensagem-dominio')).toContainText(`Item ${codigo} excluído.`);
    await expect(page.getByTestId(`item-${codigo}`)).toHaveCount(0);
    expect(externas).toEqual([]);
  });

  test('painel de chamada (incluir, alterar, inativar e excluir) e painel de TV (alterar, inativar e excluir); axe', async ({
    page,
  }) => {
    await entrar(page, 'SINT.SENHAS');
    await page.goto('/cadastros/dominios/recepcao/painel');
    await expect(page.getByTestId('tabela-dominio')).toBeVisible();
    const antes = await page.getByTestId('tabela-dominio').locator('tbody tr').count();
    await page.getByTestId('botao-incluir').click();
    const form = page.getByTestId('form-dominio');
    // O tipo é travado (atendimento) e o leiaute nasce do padrão capturado: só o local entra na inclusão.
    await expect(form.getByTestId('texto-longo-leiaute')).toHaveCount(0);
    await expect(form.getByTestId('campo-tipo')).toHaveCount(0);
    await escolher(form.getByTestId('campo-local'), { indice: 1 });
    await form.getByTestId('botao-salvar').click();
    await expect(page.getByTestId('mensagem-dominio')).toContainText('Incluído com o código');
    await expect(page.getByTestId('tabela-dominio').locator('tbody tr')).toHaveCount(antes + 1);
    const codigo = (await page.getByTestId('mensagem-dominio').innerText()).match(/código (\d+)/)![1]!;
    // Alterar (acabamento): o local muda; o tipo segue travado (fora do formulário, mesmo tipo da linha depois de
    // salvar) e o leiaute não entra no formulário. Colunas da lista: código, tipo, local.
    const celulaTipo = page.getByTestId(`item-${codigo}`).locator('td').nth(1);
    const tipoAntes = (await celulaTipo.innerText()).trim();
    expect(tipoAntes).not.toBe('');
    await page.getByTestId(`alterar-${codigo}`).click();
    await expect(form.getByTestId('texto-longo-leiaute')).toHaveCount(0);
    await expect(form.getByTestId('campo-tipo')).toHaveCount(0);
    const localAntes = (await page.getByTestId(`item-${codigo}`).innerText()).trim();
    await escolher(form.getByTestId('campo-local'), { indice: 2 });
    await form.getByTestId('botao-salvar').click();
    await expect(page.getByTestId('mensagem-dominio')).toContainText('Alterado');
    await expect(page.getByTestId(`item-${codigo}`)).not.toHaveText(localAntes);
    await expect(celulaTipo).toHaveText(tipoAntes);
    // Inativar (só no novo: o painel do cadastro anterior não tem situação) e excluir o nunca usado.
    await page.getByTestId(`inativar-${codigo}`).click();
    await gravacao(page, 'Painel desligado na reforma (teste E2E)', false);
    await expect(page.getByTestId('mensagem-dominio')).toContainText('Inativado');
    await page.getByTestId('mostrar-inativos').check();
    await page.getByTestId(`excluir-${codigo}`).click();
    await gravacao(page, 'Painel incluído por engano (teste E2E)', true);
    await expect(page.getByTestId('mensagem-dominio')).toContainText(`Item ${codigo} excluído.`);
    await expect(page.getByTestId('tabela-dominio').locator('tbody tr')).toHaveCount(antes);

    await page.goto('/cadastros/dominios/relatorio/painel');
    await expect(page.getByTestId('tabela-dominio')).toBeVisible();
    await semViolacaoAxe(page, '/cadastros/dominios/relatorio/painel');
    const primeira = page.getByTestId('tabela-dominio').locator('tbody tr').first();
    const chave = ((await primeira.getAttribute('data-testid')) ?? '').replace(/^item-/, '');
    await page.getByTestId(`alterar-${chave}`).click();
    await form.getByLabel('Nome do painel').fill('PAINEL TV SINTETICO E2E');
    await form.getByTestId('botao-salvar').click();
    await expect(page.getByTestId('mensagem-dominio')).toContainText('Alterado');
    await expect(page.getByTestId(`item-${chave}`)).toContainText('PAINEL TV SINTETICO E2E');
    // Inativar o painel de TV (só no novo) antes de retirá-lo.
    await page.getByTestId(`inativar-${chave}`).click();
    await gravacao(page, 'Painel de TV desligado (teste E2E)', false);
    await expect(page.getByTestId('mensagem-dominio')).toContainText('Inativado');
    await page.getByTestId('mostrar-inativos').check();
    await page.getByTestId(`excluir-${chave}`).click();
    await gravacao(page, 'Painel de TV retirado (teste E2E)', true);
    await expect(page.getByTestId('mensagem-dominio')).toContainText('excluído');
    await expect(page.getByTestId(`item-${chave}`)).toHaveCount(0);
  });

  test('painel de TV de setor: incluir sob a configuração do portal (leiaute do padrão) e excluir; axe', async ({
    page,
  }) => {
    await entrar(page, 'SINT.SENHAS');
    await page.goto('/cadastros/dominios/relatorio/painel');
    await expect(page.getByTestId('tabela-dominio')).toBeVisible();
    await expect(page.getByText(/só consulta/i)).toHaveCount(0);
    const antes = await page.getByTestId('tabela-dominio').locator('tbody tr').count();
    await page.getByTestId('botao-incluir').click();
    const form = page.getByTestId('form-dominio');
    // O leiaute nasce do painel vazio capturado, com o código do portal: não entra no formulário.
    await expect(form.getByTestId('texto-longo-leiaute')).toHaveCount(0);
    await escolher(form.getByTestId('campo-configuracao'), '4');
    await form.getByLabel('Ordem').fill('7');
    await form.getByLabel('Nome do painel').fill('PAINEL TV NOVO E2E');
    await semViolacaoAxe(page, 'inclusão do painel de TV');
    await form.getByTestId('botao-salvar').click();
    await expect(page.getByTestId('mensagem-dominio')).toContainText('Incluído com o código');
    await expect(page.getByTestId('tabela-dominio').locator('tbody tr')).toHaveCount(antes + 1);
    const linha = page.getByTestId('tabela-dominio').locator('tbody tr', { hasText: 'PAINEL TV NOVO E2E' });
    await expect(linha).toHaveCount(1);
    const chave = ((await linha.getAttribute('data-testid')) ?? '').replace(/^item-/, '');
    await page.getByTestId(`excluir-${chave}`).click();
    await gravacao(page, 'Painel de TV incluído por engano (teste E2E)', true);
    await expect(page.getByTestId('mensagem-dominio')).toContainText('excluído');
    await expect(page.getByTestId('tabela-dominio').locator('tbody tr')).toHaveCount(antes);
  });

  test('motivo de exclusão (incluir, alterar, recusa da exclusão com contagem e inativar) e procedência (alterar)', async ({
    page,
  }) => {
    await entrar(page, 'SINT.ADMIN');
    await page.goto('/cadastros/dominios/recepcao/motivoExclusao');
    await expect(page.getByTestId('tabela-dominio')).toBeVisible();
    await page.getByTestId('botao-incluir').click();
    const form = page.getByTestId('form-dominio');
    await form.getByLabel('Código').fill('901');
    await form.getByLabel('Descrição').fill('MOTIVO SINTETICO E2E');
    await form.getByTestId('botao-salvar').click();
    await expect(page.getByTestId('mensagem-dominio')).toContainText('Incluído com o código');
    await page.getByTestId('alterar-901').click();
    await form.getByLabel('Descrição').fill('MOTIVO SINTETICO E2E ALTERADO');
    await form.getByTestId('botao-salvar').click();
    await expect(page.getByTestId('item-901')).toContainText('ALTERADO');
    // Motivo já usado (no banco em memória, as referências por código respondem uso): a exclusão é recusada com a
    // contagem de cada dependente e a oferta de inativar no lugar.
    await page.getByTestId('excluir-901').click();
    await gravacao(page, 'Motivo incluído por engano (teste E2E)', true);
    const recusa = page.getByTestId('dominio-dependentes');
    await expect(recusa).toBeVisible();
    await expect(recusa).toContainText('atendimentos excluídos com este motivo');
    await expect(page.getByTestId('item-901')).toHaveCount(1);
    await recusa.getByTestId('inativar-em-vez').click();
    await gravacao(page, 'Inativado no lugar da exclusão (teste E2E)', false);
    await expect(page.getByTestId('mensagem-dominio')).toContainText('Inativado');
    await expect(page.getByTestId('item-901')).toHaveCount(0);

    await page.goto('/cadastros/dominios/recepcao/procedencia');
    await expect(page.getByTestId('tabela-dominio')).toBeVisible();
    const primeira = page.getByTestId('tabela-dominio').locator('tbody tr').first();
    const cod = ((await primeira.getAttribute('data-testid')) ?? '').replace(/^item-/, '');
    await page.getByTestId(`alterar-${cod}`).click();
    await form.getByLabel('Descrição').fill('PROCEDENCIA SINTETICA E2E');
    await form.getByTestId('botao-salvar').click();
    await expect(page.getByTestId('mensagem-dominio')).toContainText('Alterado');
    await expect(page.getByTestId(`item-${cod}`)).toContainText('PROCEDENCIA SINTETICA E2E');
  });

  test('aparelho de painel: alterar o nome não reemite o token; axe', async ({ page }) => {
    await entrar(page, 'SINT.SENHAS');
    await page.goto('/recepcao/senhas/paineis');
    await expect(page.getByTestId('tela-paineis-chamada')).toBeVisible();
    await page.getByTestId('novo-painel').click();
    const dialogo = page.getByRole('dialog', { name: 'Cadastrar aparelho' });
    await dialogo.getByLabel('Nome do aparelho').fill('TV SINTETICA E2E');
    await page.getByTestId('gravar-painel').click();
    const endereco = page.getByTestId('endereco-aparelho');
    await expect(endereco).toContainText('#token=');
    const token = new URL((await endereco.textContent())!.trim()).hash.replace('#token=', '');
    await page.getByTestId('fechar-token').click();
    const item = page.getByTestId('dispositivos-painel').locator('li', { hasText: 'TV SINTETICA E2E' });
    await expect(item).toContainText(`Token começa com ${token.slice(0, 8)}`);
    const id = ((await item.getAttribute('data-testid')) ?? '').replace(/^dispositivo-/, '');
    await page.getByTestId(`alterar-${id}`).click();
    const alterar = page.getByRole('dialog', { name: 'Alterar o aparelho' });
    await expect(alterar).toContainText('O token do aparelho continua o mesmo');
    await expect(alterar.getByLabel('Nome do aparelho')).toHaveValue('TV SINTETICA E2E');
    await semViolacaoAxe(page, 'alteração do aparelho');
    await alterar.getByLabel('Nome do aparelho').fill('TV SINTETICA E2E SALA 2');
    await page.getByTestId('gravar-painel').click();
    await expect(page.getByTestId('dispositivos-painel')).toContainText(
      'Aparelho alterado; o token continua o mesmo.',
    );
    await expect(page.getByTestId('endereco-aparelho')).toHaveCount(0);
    const alterado = page.getByTestId(`dispositivo-${id}`);
    await expect(alterado).toContainText('TV SINTETICA E2E SALA 2');
    await expect(alterado).toContainText(`Token começa com ${token.slice(0, 8)}`);
  });
});
