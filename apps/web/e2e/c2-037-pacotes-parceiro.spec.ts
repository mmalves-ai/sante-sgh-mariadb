// E2E @C2-037 (08-INTG L134): pacote de dados de parceiro montado contra o catálogo das visões exportáveis, com a
// conferência na hora. O administrador sintético abre Parceiros, escolhe a visão e o campo só entre os da lista branca
// (combos, sem texto livre), vê o sensível marcado pelo catálogo e a recusa do identificador sem tratamento num pacote
// pseudonimizado antes de gravar; com o campo pseudonimizado, o pacote fica conforme. O catálogo (GET
// /api/integracoes/pacotes/visoes) e a conferência (POST /api/integracoes/pacotes/conferencia) não dependem do banco
// do cliente; a gravação, a revisão, o agendador e o arquivo da entrega são provados nos contratos de efeito
// apps/api/src/modulos/integracao/comunicacao-pacotes-triagem-propria.int.spec.ts e
// apps/worker/src/pacotes-parceiro-entrega-propria.int.spec.ts (MariaDB). Fonte sintética; sem combo nativo; axe.
import { expect, test, type Page } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher, esperarSemSelectNativo, esperarValor } from './combos.js';

const SENHA = 'Sintetico#2026';

async function entrar(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

test.describe('Pacotes de dados de parceiros contra o catálogo @C2-037 @fase3', () => {
  test.setTimeout(120_000);
  test('visão e campo pela lista branca; sensível do catálogo; recusa na hora e pacote conforme; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.ADMIN');

    const catalogo = page.waitForResponse((r) => r.url().endsWith('/api/integracoes/pacotes/visoes'));
    await page.goto('/admin/integracoes/parceiros');
    await expect(page.getByTestId('tela-parceiros')).toBeVisible();
    expect((await catalogo).status()).toBe(200);

    const painel = page.getByTestId('pacotes-painel');
    const form = painel.getByTestId('pacote-novo');
    await expect(form).toBeVisible();
    await form.getByLabel('Parceiro (código)').fill('PARC-SINT-E2E');
    await form.getByLabel('Código').fill('E2E-C2037');
    await form.getByLabel('Nome').fill('Atendimentos do dia (sintético)');
    await form.getByLabel('Conteúdo').fill('Atendimentos com entrada no período, fonte sintética');

    // Visão e campo só pela lista branca: o prontuário identifica a pessoa.
    const visao = form.getByTestId('pacote-campo-visao-0');
    await escolher(visao, 'atendimento');
    await esperarValor(visao, 'atendimento');
    const campo = form.getByTestId('pacote-campo-nome-0');
    await escolher(campo, 'prontuario');
    await esperarValor(campo, 'prontuario');
    await expect(form.getByText('Identifica a pessoa')).toBeVisible();
    // O sensível vem do catálogo: a caixa fica travada.
    await expect(form.getByRole('checkbox', { name: 'Sensível' }).first()).toBeDisabled();
    await form
      .getByPlaceholder('Justificativa')
      .first()
      .fill('Ligação dos atendimentos do mesmo paciente no estudo');

    // Pacote pseudonimizado com o identificador original: a recusa aparece antes de gravar e o botão trava.
    const conferencia = page.waitForResponse((r) => r.url().endsWith('/api/integracoes/pacotes/conferencia'));
    expect((await conferencia).status()).toBe(200);
    await expect(form.getByTestId('pacote-recusa').first()).toBeVisible();
    await expect(form.getByRole('button', { name: 'Gravar pacote' })).toBeDisabled();

    // Com o campo pseudonimizado, o pacote fica conforme.
    await escolher(form.getByRole('combobox', { name: 'Tratamento' }).first(), 'pseudonimizado');
    await expect(form.getByTestId('pacote-conforme')).toBeVisible();
    await expect(form.getByTestId('pacote-recusa')).toHaveCount(0);
    await expect(form.getByRole('button', { name: 'Gravar pacote' })).toBeEnabled();
    await esperarSemSelectNativo(painel);

    await semViolacaoAxe(page, '/admin/integracoes/parceiros (pacote contra o catálogo)');
    expect(externas).toEqual([]);
  });
});
