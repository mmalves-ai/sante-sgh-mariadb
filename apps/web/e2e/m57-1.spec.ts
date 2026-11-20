// E2E @M57.1 (ficha do M57, seção 10, na parte da etapa 1): o gestor de cadastro abre o MPI da Rede pelo menu, a fila
// começa vazia, "Atualizar a fila" roda um ciclo de pareamento (1 vínculo automático, 3 pares na fila por faixa, o CPF
// repetido no mesmo estabelecimento fica fora da fila da Rede) → filtro por faixa → comparação lado a lado com o que
// diverge → "É a mesma pessoa" (gravado nos dois estabelecimentos) → "É outra pessoa" com a justificativa → o par
// vinculado aparece em "Vinculado", achado pela busca por paciente (prontuário) → o vínculo e "Desfazer" (justificativa
// e devolver à fila) → o par volta à fila e "Atualizar a fila" não o religa →
// o relatório de divergência sem divergência. Quem não tem a opção de unificação não vê a tela nem lê a API; quem só
// unifica não desfaz. axe sem violação séria. Sessão real sobre a fonte sintética de dev e a porta do MPI em MEMÓRIA
// (dois estabelecimentos SINTÉTICOS: o configurado e o de REDE_SINTETICA_SEGUNDO; pacientes SINTÉTICOS).
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

test.describe('@M57.1 MPI da Rede: fila, vincular, outra pessoa, desfazer e divergência', () => {
  test.describe.configure({ timeout: 240_000 });
  test('sem a opção de unificação: nem a tela nem a API', async ({ page }) => {
    await entrar(page, 'SINT.RECEPCAO');
    const r = await page.request.get('/api/rede/mpi/fila');
    expect(r.status()).toBe(403);
    await page.goto('/cadastros/pacientes/rede');
    await expect(page.getByTestId('tela-mpi-rede')).toHaveCount(0);
  });

  test('gestor de cadastro: ciclo, decisões, desfazer e divergência', async ({ page }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.GESTORCAD');
    // Pelo menu: Cadastros > Pacientes > MPI da Rede.
    await page.goto('/cadastros/pacientes/rede');
    const tela = page.getByTestId('tela-mpi-rede');
    await expect(tela.getByRole('heading', { level: 1 })).toHaveText(/MPI da Rede/);
    await expect(page.getByTestId('fila-rede-vazia')).toBeVisible();
    await semViolacaoAxe(page, 'fila vazia');

    await page.getByTestId('botao-atualizar-fila-rede').click();
    await expect(page.getByTestId('mensagem-fila-rede')).toHaveText(
      /1 vinculados automaticamente, 3 na fila/,
    );
    const tabela = page.getByTestId('tabela-fila-rede');
    await expect(tabela.locator('tbody tr')).toHaveCount(3);
    await expect(page.getByTestId('por-faixa')).toHaveText('Alta: 1 · Média: 1 · Baixa: 1');
    // CPF primeiro e pontuação maior: o par de sexo diferente (alta) no topo.
    await expect(tabela.locator('tbody tr').first()).toHaveAttribute('data-testid', 'par-rede-pc:4|sx:104');
    // Regra 5: o CPF repetido no mesmo estabelecimento não entra na fila da Rede.
    await expect(tabela).not.toContainText('EDUARDO SINTETICO QUINTO');
    // Documentos sempre mascarados na lista.
    await expect(tabela).not.toContainText(/\d{3}\.\d{3}\.\d{3}-\d{2}/);
    await semViolacaoAxe(page, 'fila com pares');

    // Filtro por faixa (SanteSelecao).
    await escolher(page.getByRole('combobox', { name: 'Pontuação' }), 'alta');
    await expect(tabela.locator('tbody tr')).toHaveCount(1);

    // Comparação lado a lado e "É a mesma pessoa".
    await page.getByTestId('comparar-rede-pc:4|sx:104').click();
    const comparacao = page.getByTestId('comparacao-rede');
    await expect(comparacao).toBeVisible();
    await expect(page.getByTestId('divergencias-par')).toContainText('Sexos diferentes');
    await expect(page.getByTestId('criterios-par')).toContainText('CPF igual');
    await expect(comparacao).toContainText('M*** S*** Q***');
    await semViolacaoAxe(page, 'comparação lado a lado');
    await page.getByTestId('botao-mesma-pessoa').click();
    await page.getByTestId('botao-confirmar-mesma').click();
    await expect(page.getByTestId('mensagem-fila-rede')).toHaveText('Cadastros vinculados.');
    await expect(page.getByTestId('fila-rede-vazia')).toBeVisible();

    // "É outra pessoa": a justificativa é obrigatória.
    await escolher(page.getByRole('combobox', { name: 'Pontuação' }), '');
    await expect(tabela.locator('tbody tr')).toHaveCount(2);
    await page.getByTestId('comparar-rede-pc:2|sx:102').click();
    await expect(page.getByTestId('botao-outra-pessoa-rede')).toBeDisabled();
    await page.getByTestId('justificativa-rede').fill('Nascimentos diferentes conferidos com o paciente');
    await page.getByTestId('botao-outra-pessoa-rede').click();
    await expect(page.getByTestId('mensagem-fila-rede')).toHaveText('Par marcado como outra pessoa.');
    await expect(tabela.locator('tbody tr')).toHaveCount(1);

    // Os vinculados: o automático e o da decisão; desfazer devolve o par à fila.
    await escolher(page.getByRole('combobox', { name: 'Situação' }), 'vinculado');
    await expect(tabela.locator('tbody tr')).toHaveCount(2);
    await expect(page.getByTestId('par-rede-pc:1|sx:101')).toContainText('Automático');
    // Busca por paciente: o prontuário do cadastro deste estabelecimento (só números).
    const campoBusca = page.getByRole('textbox', { name: 'Prontuário do paciente neste estabelecimento' });
    await campoBusca.fill('abc');
    await page.getByTestId('botao-buscar-rede').click();
    await expect(page.getByTestId('busca-rede-invalida')).toBeVisible();
    await campoBusca.fill('50004');
    await page.getByTestId('botao-buscar-rede').click();
    await expect(page.getByTestId('busca-rede-ativa')).toContainText('50004');
    await expect(tabela.locator('tbody tr')).toHaveCount(1);
    await expect(page.getByTestId('par-rede-pc:4|sx:104')).toBeVisible();
    await semViolacaoAxe(page, 'busca por paciente');
    await page.getByTestId('comparar-rede-pc:4|sx:104').click();
    const vinculos = page.getByTestId('vinculos-cadastro-rede');
    await expect(vinculos).toBeVisible();
    await page.getByTestId('desfazer-pc:4|sx:104').click();
    await expect(page.getByTestId('botao-desfazer')).toBeDisabled();
    await page
      .getByTestId('justificativa-desfazer')
      .fill('Revisão do gestor: conferir os documentos de novo');
    await expect(page.getByTestId('reabrir')).toBeChecked();
    await semViolacaoAxe(page, 'desfazer vínculo');
    await page.getByTestId('botao-desfazer').click();
    await expect(page.getByTestId('mensagem-vinculos')).toHaveText('Vínculo desfeito.');
    await expect(vinculos).toContainText('Desfeito por SINT.GESTORCAD');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('fila-rede-vazia')).toBeVisible();
    await escolher(page.getByRole('combobox', { name: 'Situação' }), 'aberto');
    await expect(page.getByTestId('par-rede-pc:4|sx:104')).toBeVisible();
    // Reaberto por uma pessoa: o ciclo seguinte não o tira da fila.
    await page.getByTestId('botao-atualizar-fila-rede').click();
    await expect(page.getByTestId('mensagem-fila-rede')).toHaveText(/0 vinculados automaticamente/);
    await expect(page.getByTestId('par-rede-pc:4|sx:104')).toContainText('Na fila');
    await page.getByTestId('botao-limpar-busca-rede').click();
    await expect(page.getByTestId('busca-rede-ativa')).toHaveCount(0);

    // O relatório de divergência: os dois índices conferem.
    await page.getByTestId('aba-divergencia').click();
    await expect(page.getByTestId('sem-divergencia')).toBeVisible();
    await semViolacaoAxe(page, 'divergência');
    expect(externas).toEqual([]);
  });

  test('quem só unifica vincula, mas não desfaz', async ({ page }) => {
    await entrar(page, 'SINT.SAME');
    await page.goto('/cadastros/pacientes/rede');
    const tabela = page.getByTestId('tabela-fila-rede');
    await escolher(page.getByRole('combobox', { name: 'Situação' }), 'vinculado');
    await expect(page.getByTestId('par-rede-pc:1|sx:101')).toBeVisible();
    await page.getByTestId('comparar-rede-pc:1|sx:101').click();
    await expect(page.getByTestId('vinculo-pc:1|sx:101')).toBeVisible();
    await expect(page.getByTestId('desfazer-pc:1|sx:101')).toHaveCount(0);
    const r = await page.request.post('/api/rede/mpi/vinculos/pc%3A1%7Csx%3A101/desfazer', {
      headers: { 'x-csrf': (await page.context().cookies()).find((c) => c.name === 'sgh_csrf')?.value ?? '' },
      data: { justificativa: 'Tentativa sem a permissão de desfazer', reabrir: false },
    });
    expect(r.status()).toBe(403);
    await expect(tabela.locator('tbody tr')).toHaveCount(1);
  });
});
