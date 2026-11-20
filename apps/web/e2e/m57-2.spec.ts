// E2E @M57.2 (ficha do M57, seção 10, na parte da etapa 2): o gestor de cadastro atualiza a fila do MPI da Rede (o
// cadastro 1 daqui fica ligado ao 101 do outro estabelecimento) → o médico abre o prontuário do paciente e vê, logo
// abaixo do cabeçalho, o aviso "tem atendimentos em outro estabelecimento da rede" com só as contagens e as datas, sem o
// botão de abrir o registro de lá (a regra de compartilhamento do prontuário, DP-42, não está registrada: a API recusa) →
// o gestor desfaz o vínculo → o aviso some. A unificação de prontuários duplicados do mesmo estabelecimento: na fila de
// duplicidades, "Unificar" escolhe o prontuário que fica, pede a justificativa e a senha, e o par sai da fila; quem não
// tem a opção de unificação não unifica. axe sem violação séria. Sessão real sobre a fonte sintética de dev, portas em
// MEMÓRIA (dois estabelecimentos SINTÉTICOS; pacientes SINTÉTICOS).
import { expect, type Page, test } from '@playwright/test';
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

async function csrf(page: Page): Promise<string> {
  return (await page.context().cookies()).find((c) => c.name === 'sgh_csrf')?.value ?? '';
}

test.describe('@M57.2 aviso no outro estabelecimento, acesso cruzado e unificação', () => {
  test.describe.configure({ timeout: 240_000 });

  test('vincular → aviso no cabeçalho do paciente (sem acesso cruzado) → desfazer → o aviso some', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.GESTORCAD');
    await page.goto('/cadastros/pacientes/rede');
    await page.getByTestId('botao-atualizar-fila-rede').click();
    await expect(page.getByTestId('mensagem-fila-rede')).toHaveText(/vinculados automaticamente/);
    await escolher(page.getByRole('combobox', { name: 'Situação' }), 'vinculado');
    await expect(page.getByTestId('par-rede-pc:1|sx:101')).toBeVisible();

    // O médico abre o prontuário do paciente 1: o aviso com só as contagens e as datas do outro estabelecimento.
    await entrar(page, 'SINT.MEDICO');
    await page.goto('/pep/paciente/1');
    const aviso = page.getByTestId('aviso-rede-paciente');
    await expect(aviso).toBeVisible();
    await expect(aviso).toContainText('Este paciente tem atendimentos em outro estabelecimento da rede');
    await expect(page.getByTestId('aviso-rede-sx')).toContainText('3 atendimento(s), o último em 14/09/2026');
    await expect(page.getByTestId('aviso-rede-sx')).toContainText(
      '1 internação(ões), a última em 02/08/2026',
    );
    // Regra 6: sem a regra da DP-42, só o aviso (nenhum botão de abrir; a API recusa com o motivo).
    await expect(page.getByTestId('abrir-rede-sx')).toHaveCount(0);
    await expect(page.getByTestId('aviso-rede-so-aviso')).toBeVisible();
    await semViolacaoAxe(page, 'aviso no cabeçalho do paciente');
    const r = await page.request.post('/api/pep/rede/paciente/1/estabelecimentos/sx/linha-do-tempo', {
      headers: { 'x-csrf': await csrf(page) },
      data: { motivo: 'assistencia', justificativa: 'Paciente em atendimento aqui' },
    });
    expect(r.status()).toBe(403);
    expect((await r.json()).codigo).toBe('recurso-desligado');

    // O gestor desfaz o vínculo; o aviso some do cabeçalho.
    await entrar(page, 'SINT.GESTORCAD');
    await page.goto('/cadastros/pacientes/rede');
    await escolher(page.getByRole('combobox', { name: 'Situação' }), 'vinculado');
    await page.getByTestId('comparar-rede-pc:1|sx:101').click();
    await page.getByTestId('desfazer-pc:1|sx:101').click();
    await page.getByTestId('justificativa-desfazer').fill('Conferência do gestor: documentos a revisar');
    await page.getByTestId('botao-desfazer').click();
    await expect(page.getByTestId('mensagem-vinculos')).toHaveText('Vínculo desfeito.');

    await entrar(page, 'SINT.MEDICO');
    await page.goto('/pep/paciente/1');
    await expect(page.getByTestId('novo-registro')).toBeVisible();
    await expect(page.getByTestId('aviso-rede-paciente')).toHaveCount(0);
    expect(externas).toEqual([]);
  });

  test('unificação de prontuários duplicados no mesmo estabelecimento', async ({ page }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.SAME');
    await page.goto('/cadastros/pacientes/duplicidades');
    await page.getByTestId('botao-atualizar-fila').click();
    await expect(page.getByTestId('unificacao-motivo')).toContainText('Unificação liberada');
    const tabela = page.getByTestId('tabela-duplicidades');
    const linhas = tabela.locator('tbody tr');
    await expect(linhas.first()).toBeVisible();
    const antes = await linhas.count();
    const id = ((await linhas.first().getAttribute('data-testid')) ?? '').replace('par-', '');
    await page.getByTestId(`comparar-${id}`).click();
    await expect(page.getByTestId('comparacao')).toBeVisible();
    await page.getByTestId('botao-unificar').click();
    const form = page.getByTestId('form-unificar');
    await expect(form).toBeVisible();
    await page.getByTestId('fica-b').check();
    await expect(page.getByTestId('botao-confirmar-unificar')).toBeDisabled();
    await page.getByTestId('justificativa-unificar').fill('Mesmo CPF, mesma mãe e mesmo nascimento');
    await page.getByTestId('senha-unificar').fill(SENHA);
    await semViolacaoAxe(page, 'unificar prontuários');
    await page.getByTestId('botao-confirmar-unificar').click();
    await expect(page.getByTestId('mensagem-fila')).toContainText('Prontuários unificados');
    await expect(page.getByTestId(`par-${id}`)).toHaveCount(0);
    expect(await linhas.count()).toBeLessThan(antes);
    // Repetir pela API: o par já foi decidido.
    const de = await page.request.post(`/api/cadastros/pacientes/duplicidades/${id}/unificar`, {
      headers: { 'x-csrf': await csrf(page) },
      data: { fica: 'b', justificativa: 'Mesmo CPF, mesma mãe', senha: SENHA },
    });
    expect(de.status()).toBe(409);
    expect(externas).toEqual([]);

    // Quem não tem a opção de unificação: 403.
    await entrar(page, 'SINT.RECEPCAO');
    const r = await page.request.post(`/api/cadastros/pacientes/duplicidades/${id}/unificar`, {
      headers: { 'x-csrf': await csrf(page) },
      data: { fica: 'a', justificativa: 'Tentativa sem a permissão', senha: SENHA },
    });
    expect(r.status()).toBe(403);
  });
});
