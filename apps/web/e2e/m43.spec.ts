// E2E @M43 (ficha, campos 7 e 10): o fim da coexistência por hospital e a onda 5.
//   1. O gestor de acessos da onda 5 abre a aba "Fim da coexistência" (cinco itens do critério e quatro do conjunto ao
//      lado, com o valor, as parcelas, a fonte, a situação e a data; o que não se mediu sai "sem medida"), vai à
//      revisão, cadastra o aparelho da TV com token, confere no setor o login que ele substitui e só então bloqueia o
//      login de TV; os ativos sem grupo recebem grupo ou são bloqueados até a lista ficar vazia. axe em cada tela.
//   2. Painel e totem por token, sem login de pessoa: o totem emite a senha, o guichê chama e o painel mostra a chamada;
//      revogado o token, o painel e o totem saem de serviço (a sessão do aparelho acaba).
// Sessão real sobre a fonte sintética de dev e as portas EM MEMÓRIA (contas e aparelhos SINTÉTICOS; nada vai à cópia).
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

/** Cadastra o aparelho e devolve o endereço com o token (aparece uma vez). */
async function cadastrarAparelho(page: Page, tipo: 'totem' | 'painel', nome: string): Promise<string> {
  await page.getByTestId(`novo-${tipo}`).click();
  const dialogo = page.getByRole('dialog', { name: 'Cadastrar aparelho' });
  await dialogo.getByLabel('Nome do aparelho').fill(nome);
  if (tipo === 'totem') await dialogo.getByLabel('MC · MARCACAO DE CONSULTA').check();
  await page.getByTestId(`gravar-${tipo}`).click();
  const endereco = page.getByTestId('endereco-aparelho');
  await expect(endereco).toContainText('#token=');
  const texto = (await endereco.textContent())!.trim();
  await page.getByTestId('fechar-token').click();
  return new URL(texto).pathname + new URL(texto).hash;
}

/** A confirmação da revisão: a senha de novo e o botão de gravar. */
async function confirmarComSenha(page: Page): Promise<void> {
  await page.getByTestId('revisao-senha').fill(SENHA);
  await page.getByTestId('revisao-confirmar').click();
  await expect(page.getByTestId('revisao-aviso')).toContainText('Gravado');
}

test.describe('Onda 5 e fim da coexistência por hospital @M43 @fase4', () => {
  test.setTimeout(180_000);

  test('aba Fim da coexistência, revisão dos sem grupo e logins de painel com o aparelho conferido; axe', async ({
    page,
    browser,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.ONDA5');
    await page.goto('/administracao/coexistencia/migracao');
    await page.getByTestId('aba-migracao-fim').click();
    const tela = page.getByTestId('tela-migracao-fim');
    await expect(tela).toBeVisible();
    await expect(page.locator('[data-testid="fim-cap15"] [data-testid^="fim-item-"]')).toHaveCount(5);
    await expect(page.locator('[data-testid="fim-cap14"] [data-testid^="fim-item-"]')).toHaveCount(4);
    // Regra 3 (falha fechada): sem retrato nem coleta, os dias ficam sem medida, nunca cumpridos.
    const semSessao = page.getByTestId('fim-item-sem-sessao-14-dias');
    await expect(semSessao.getByTestId('situacao')).toHaveText('sem medida');
    // A competência sintética, inteira por este sistema, com a data em que ficou verde e as parcelas impressas.
    const comp = page.getByTestId('fim-item-competencia-pelo-novo');
    await expect(comp.getByTestId('situacao')).toHaveText('cumprido');
    await expect(comp.getByTestId('verde-desde')).toHaveText('08/01/2027');
    await expect(comp.getByTestId('parcelas')).toContainText('lotes enviados por este sistema: 3');
    await expect(page.getByTestId('fim-veredito')).toContainText('Ainda não');
    await expect(page.getByTestId('fim-pendencias')).toContainText('Duas semanas seguidas sem sessão');
    await expect(page.getByTestId('fim-ensaios')).toContainText('não registrado');
    await expect(page.getByTestId('fim-por-estado')).toBeVisible();
    await expect(page.locator('body')).not.toContainText(/SPDATA|legado|sistema atual/i);
    await semViolacaoAxe(page, '/administracao/coexistencia/migracao/fim');

    // Revisão (rotas do M10): os sem grupo e os logins de TV.
    await page.getByTestId('ir-revisao').click();
    await expect(page.getByTestId('tela-revisao-onda5')).toBeVisible();
    await expect(page.getByTestId('sem-grupo-SINT.SEMGRUPO1')).toBeVisible();
    await expect(page.getByTestId('sem-grupo-SINT.SEMGRUPO2')).toBeVisible();
    const tv1 = page.getByTestId('painel-SINT.PAINELTV1');
    await expect(tv1.getByTestId('situacao')).toContainText('em uso pela TV');
    // A TV ainda usa o login: não há bloqueio a oferecer.
    await expect(page.getByTestId('bloquear-SINT.PAINELTV1')).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText(/SPDATA|legado|sistema atual/i);
    await semViolacaoAxe(page, '/administracao/acesso/usuarios/revisao');

    // A TI (outra sessão: a da recepção, com os aparelhos) cadastra o aparelho da TV com token; a TV abre a tela sem
    // login de pessoa; e confere no setor o login de TV que o aparelho substitui.
    await expect(page.getByTestId('ir-dispositivos')).toHaveAttribute('href', '/recepcao/senhas/paineis');
    const ti = await browser.newContext();
    const pTi = await ti.newPage();
    await entrar(pTi, 'SINT.SENHAS');
    await pTi.goto('/recepcao/senhas/paineis');
    await expect(pTi.getByTestId('tela-paineis-chamada')).toBeVisible();
    const endereco = await cadastrarAparelho(pTi, 'painel', 'TV da espera da onda 5');
    const tv = await ti.newPage();
    await tv.goto(endereco);
    await expect(tv.getByTestId('painel-atual')).toBeVisible();
    await expect(tv.getByTestId('painel-fora')).toHaveCount(0);
    const linha = pTi.locator('[data-testid^="dispositivo-"]', { hasText: 'TV da espera da onda 5' });
    await linha.getByRole('button', { name: 'Conferido no setor' }).click();
    await escolher(pTi.getByTestId('login-substituido'), 'SINT.PAINELTV1');
    await pTi.getByTestId('confirmar-conferir').click();
    await expect(linha).toContainText('Substitui o login SINT.PAINELTV1');
    await semViolacaoAxe(pTi, '/recepcao/senhas/paineis (conferido)');

    // Agora o login de TV pode ser bloqueado (regra 4).
    await page.goto('/administracao/acesso/usuarios/revisao');
    await expect(tv1.getByTestId('situacao')).toContainText('pode bloquear');
    await expect(page.getByTestId('paineis-resolvidos')).toContainText('esperando o bloqueio');
    await page.getByTestId('bloquear-SINT.PAINELTV1').click();
    await expect(page.getByTestId('revisao-pergunta')).toContainText('não é apagado');
    await confirmarComSenha(page);
    await expect(tv1.getByTestId('situacao')).toContainText('bloqueado, com o aparelho no token');
    await expect(page.getByTestId('paineis-resolvidos')).toContainText('Nenhum login de painel esperando');
    // A TV continua no ar: o aparelho não depende do login bloqueado.
    await tv.reload();
    await expect(tv.getByTestId('painel-atual')).toBeVisible();

    // Regra 5: um recebe grupo de trabalho, o outro é bloqueado; a lista fica vazia.
    await escolher(page.getByTestId('destino-SINT.SEMGRUPO1'), 'ATENDIMENTO');
    await page.getByTestId('atribuir-SINT.SEMGRUPO1').click();
    await expect(page.getByTestId('revisao-pergunta')).toContainText('ATENDIMENTO');
    await confirmarComSenha(page);
    await page.getByTestId('bloquear-SINT.SEMGRUPO2').click();
    await confirmarComSenha(page);
    await expect(page.getByTestId('revisao-vazia')).toBeVisible();
    await semViolacaoAxe(page, '/administracao/acesso/usuarios/revisao (lista vazia)');
    expect(externas).toEqual([]);
    await ti.close();
  });

  test('painel e totem por token sem login de pessoa: senha emitida, chamada no painel; revogado, fora de serviço; axe', async ({
    page,
    context,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.SENHAS');
    await page.goto('/recepcao/senhas/geradores');
    await expect(page.getByTestId('tela-geradores')).toBeVisible();
    const totemEndereco = await cadastrarAparelho(page, 'totem', 'Totem da onda 5');
    await page.goto('/recepcao/senhas/paineis');
    const painelEndereco = await cadastrarAparelho(page, 'painel', 'TV da onda 5');

    // O totem emite a senha pelo token do aparelho (nenhum login de pessoa no aparelho).
    const totem = await context.newPage();
    await totem.goto(totemEndereco);
    await expect(totem.getByTestId('totem')).toContainText('Toque no serviço');
    await totem.getByTestId('totem-servico-24').click();
    await expect(totem.getByTestId('totem-senha')).toHaveText(/^MC \d{3}$/);
    await semViolacaoAxe(totem, '/totem (onda 5)');

    // O guichê chama e o painel mostra a chamada.
    const tv = await context.newPage();
    await tv.goto(painelEndereco);
    await expect(tv.getByTestId('painel-atual')).toBeVisible();
    await page.goto('/recepcao/guiche');
    await page.getByTestId('guiche-numero').fill('4');
    await page.getByTestId('guiche-abrir').click();
    await expect(page.getByTestId('guiche-situacao')).toContainText('Guichê 4 aberto');
    await page.getByTestId('chamar-proxima').click();
    await expect(tv.getByTestId('painel-senha')).toHaveText(/^[A-Z]{2} \d{3}$/, { timeout: 10_000 });
    await semViolacaoAxe(tv, '/painel (onda 5)');

    // Revogado o token, a sessão do aparelho acaba: o painel e o totem saem de serviço.
    await page.goto('/recepcao/senhas/paineis');
    const linhaTv = page.locator('[data-testid^="dispositivo-"]', { hasText: 'TV da onda 5' });
    await linhaTv.getByRole('button', { name: 'Revogar' }).click();
    await page.getByTestId('confirmacao').getByRole('button', { name: 'Confirmar' }).click();
    await expect(linhaTv).toContainText('Revogado em');
    await expect(tv.getByTestId('painel-fora')).toBeVisible({ timeout: 45_000 });
    await page.goto('/recepcao/senhas/geradores');
    const linhaTotem = page.locator('[data-testid^="dispositivo-"]', { hasText: 'Totem da onda 5' });
    await linhaTotem.getByRole('button', { name: 'Revogar' }).click();
    await page.getByTestId('confirmacao').getByRole('button', { name: 'Confirmar' }).click();
    await expect(linhaTotem).toContainText('Revogado em');
    await totem.reload();
    await expect(totem.getByTestId('totem-fora')).toContainText('fora de serviço');
    await semViolacaoAxe(totem, '/totem revogado');
    expect(externas).toEqual([]);
  });

  test('o gestor de acessos só com as permissões de usuários chega à revisão pela tela de usuários; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.GESTOR');
    await page.goto('/administracao/acesso/usuarios');
    await page.getByTestId('ir-revisao-usuarios').click();
    await expect(page).toHaveURL(/\/administracao\/acesso\/usuarios\/revisao$/);
    await expect(page.getByTestId('tela-revisao-onda5')).toBeVisible();
    await expect(page.getByTestId('revisao-sem-grupo')).toBeVisible();
    await expect(page.getByTestId('revisao-paineis')).toBeVisible();
    await expect(page.locator('body')).not.toContainText(/SPDATA|legado|sistema atual/i);
    await semViolacaoAxe(page, '/administracao/acesso/usuarios/revisao');
    expect(externas).toEqual([]);
  });
});
