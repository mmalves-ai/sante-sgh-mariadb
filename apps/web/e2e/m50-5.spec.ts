// E2E @M50.5 (ficha do M50, seções 7, 10 e 11; etapa 5, portaria e visitantes): o supervisor bloqueia a visita a um
// paciente (pedido da família); o porteiro busca o paciente (o paciente com sigilo de presença não aparece; o bloqueado
// aparece com a mensagem genérica e sem o leito), cadastra o visitante com a foto, confere a visita permitida e
// registra a entrada; o crachá sai com o código e a validade; a visita aparece em curso e a saída é registrada. axe sem
// violação séria nas regras, na busca e no crachá. O controle de infecção, só com os relatórios, emite os contatos na
// tela própria (correção da revisão). Sessão real sobre a fonte sintética e a porta em MEMÓRIA (dados
// SINTÉTICOS).
import { expect, type Page, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
// PNG de 1×1, só para a foto do cadastro mínimo (a tela a reduz a JPEG).
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

async function entrar(page: Page, login: string): Promise<void> {
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

test.describe('Portaria e visitantes @M50 @M50.5 @fase5', () => {
  test.setTimeout(240_000);

  test('bloqueio por paciente → busca sem sigilo e sem leito do bloqueado → visitante com foto → entrada com crachá → saída; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    // O supervisor bloqueia a visita ao paciente da INT-1 (pedido da família).
    await entrar(page, 'SINT.PORTARIA.SUP');
    await page.goto('/portaria/regras');
    await expect(page.getByTestId('tela-portaria-regras')).toBeVisible();
    await escolher(page.getByTestId('rg-bloq-unidade'), 'INT-1');
    await escolher(page.getByTestId('rg-bloq-paciente'), '50505');
    await escolher(page.getByTestId('rg-bloq-motivo'), 'pedido');
    await page.getByTestId('rg-bloq-justificativa').fill('Pedido SINTETICO da familia por escrito');
    await page.getByTestId('rg-bloquear').click();
    await expect(page.getByTestId('rg-mensagem')).toContainText('Bloqueio de visita registrado');
    await expect(page.getByTestId('rg-bloqueios')).toContainText('Pedido do paciente ou da família');
    await semViolacaoAxe(page, '/portaria/regras');

    // O porteiro.
    await page.context().clearCookies();
    await entrar(page, 'SINT.PORTARIA');
    await page.goto('/portaria');
    await expect(page.getByTestId('tela-portaria')).toBeVisible();
    await page.getByTestId('pt-busca').fill('sintetico portaria');
    await page.getByTestId('pt-buscar').click();
    const tabela = page.getByTestId('pt-pacientes');
    await expect(tabela).toBeVisible();
    await expect(tabela).not.toContainText('SIGILO');
    const bloqueado = page.getByTestId('pt-paciente-50505');
    await expect(bloqueado).toContainText('Não liberada');
    await expect(bloqueado).toContainText('procurar a recepção ou a enfermagem');
    await expect(bloqueado).not.toContainText('101-C');
    await expect(bloqueado).not.toContainText('família');
    await expect(page.getByTestId('pt-paciente-50501')).toContainText('201-A');
    await semViolacaoAxe(page, '/portaria (busca)');
    await page.getByTestId('pt-escolher-50501').click();
    await expect(page.getByTestId('pt-paciente-escolhido')).toContainText('PACIENTE SINTETICO PORTARIA UM');

    // O cadastro mínimo do visitante, com a foto.
    const documento = `E2E${Date.now().toString(36).toUpperCase()}`.slice(0, 20);
    await page.getByTestId('pt-novo-visitante').click();
    await page.getByTestId('pt-nome').fill('Visitante Sintetico E2E');
    await escolher(page.getByTestId('pt-tipo-documento'), 'outro');
    await page.getByTestId('pt-documento').fill(documento);
    await page.getByTestId('pt-nascimento').fill('1980-05-01');
    await page
      .getByTestId('pt-foto-arquivo')
      .setInputFiles({ name: 'foto.png', mimeType: 'image/png', buffer: PNG });
    await expect(page.getByTestId('pt-foto-previa')).toBeVisible();
    await page.getByTestId('pt-gravar-visitante').click();
    await expect(page.getByTestId('pt-mensagem')).toContainText('Visitante cadastrado');
    await expect(page.getByTestId('pt-visitante-escolhido')).toContainText('Visitante Sintetico E2E');

    // A visita permitida e a entrada com o crachá.
    await expect(page.getByTestId('pt-avaliacao')).toContainText('Visita permitida agora');
    await page.getByTestId('pt-registrar').click();
    const cracha = page.getByTestId('pt-cracha');
    await expect(cracha).toBeVisible();
    await expect(page.getByTestId('pt-cracha-codigo')).toHaveText(/^[0-9A-Z]{12}$/);
    await expect(page.getByTestId('pt-cracha-validade')).toContainText('Válido até');
    await expect(cracha).toContainText('INTERNACAO SINTETICA 2 · 201-A');
    await semViolacaoAxe(page, '/portaria (crachá)');
    const codigo = (await page.getByTestId('pt-cracha-codigo').textContent())?.trim() ?? '';
    await page.keyboard.press('Escape');
    await expect(cracha).toBeHidden();

    // A visita em curso e a saída.
    const abertas = page.getByTestId('pt-abertas');
    await expect(abertas).toContainText(codigo);
    await expect(abertas).toContainText('Visitante Sintetico E2E');
    const linha = abertas.locator('tr', { hasText: codigo });
    await linha.getByRole('button', { name: 'Registrar a saída' }).click();
    await expect(page.getByTestId('pt-mensagem')).toContainText('Saída registrada');
    await expect(page.getByTestId('tela-portaria')).not.toContainText(codigo);
    expect(externas).toEqual([]);
  });

  test('o controle de infecção (só os relatórios) emite o relatório de contatos na tela própria, sem as regras; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.SCIH');
    await page.goto('/portaria/contatos');
    await expect(page.getByTestId('tela-portaria-contatos')).toBeVisible();
    await escolher(page.getByTestId('rg-contato-unidade'), 'INT-2');
    await page.getByTestId('rg-contato-de').fill('2026-10-01');
    await page.getByTestId('rg-contato-ate').fill('2026-10-25');
    await page.getByTestId('rg-contato-emitir').click();
    await expect(
      page.getByText('Nenhuma visita no período.').or(page.getByTestId('rg-contatos')),
    ).toBeVisible();
    await semViolacaoAxe(page, '/portaria/contatos');
    expect(externas).toEqual([]);
  });
});
