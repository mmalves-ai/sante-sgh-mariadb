// E2E @M57.3 (ficha do M57, seção 10, na parte da etapa 3): a diretoria da Rede abre o BI consolidado pelo menu, vê os
// dois estabelecimentos da rede no consolidado, o pseudônimo por estabelecimento, cada indicador com a parte de cada
// estabelecimento e a conta (Σ numeradores ÷ Σ denominadores), a série com a planilha, os painéis operacional e
// financeiro, e NÃO consegue abrir prontuário (nem a tela, nem a API: regra 10); registra uma oportunidade de serviço
// compartilhado e muda a situação dela. Quem não tem o perfil da diretoria da Rede não vê o BI. axe sem violação séria.
// Sessão real sobre a fonte sintética de dev, o movimento SINTÉTICO de dois estabelecimentos (o configurado e o de
// REDE_SINTETICA_SEGUNDO) e o registro em MEMÓRIA; nenhum dado de pessoa.
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

test.describe('@M57.3 BI consolidado da Rede e serviços compartilhados', () => {
  test.describe.configure({ timeout: 240_000 });

  test('sem o perfil da diretoria da Rede: nem a tela nem a API', async ({ page }) => {
    await entrar(page, 'SINT.DIRETORIA');
    expect((await page.request.get('/api/relatorios/bi/rede')).status()).toBe(403);
    expect((await page.request.get('/api/rede/servicos')).status()).toBe(403);
    await page.goto('/relatorios/bi/rede');
    await expect(page.getByTestId('tela-bi-rede')).toHaveCount(0);
  });

  test('diretoria da Rede: consolidado, série, painéis, sem prontuário e o registro de serviços', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.DIRETORIA.REDE');
    // Pelo menu: Relatórios e BI > BI consolidado da Rede.
    const menu = page.getByRole('navigation', { name: 'Menu principal' });
    await menu.getByRole('button', { name: /^Relatórios e BI/ }).click();
    await menu.getByRole('link', { name: 'BI consolidado da Rede' }).click();
    await expect(page).toHaveURL(/\/relatorios\/bi\/rede$/);
    const tela = page.getByTestId('tela-bi-rede');
    await expect(tela.getByRole('heading', { level: 1 })).toHaveText('BI consolidado da Rede');
    await expect(page.getByTestId('bi-rede-tabela')).toBeVisible();

    // Todos os estabelecimentos da rede no consolidado: os configurados (ESTABELECIMENTOS, no E2E 'pc,hs' quando falta)
    // e o sintético da rede (REDE_SINTETICA_SEGUNDO), cada um incluído e com a sua coluna; o pseudônimo por
    // estabelecimento (a DP-42 não liberou o comum).
    const ests = page.getByTestId('bi-rede-estabelecimentos');
    await expect(page.getByTestId('bi-rede-est-sx')).toContainText('Incluído');
    const n = await ests.locator('li').count();
    expect(n).toBeGreaterThanOrEqual(2);
    for (let i = 0; i < n; i++) await expect(ests.locator('li').nth(i)).toContainText('Incluído');
    await expect(page.getByTestId('bi-rede-tabela').locator('thead th')).toHaveCount(n + 3);
    // As parcelas da conta: uma por estabelecimento ("a + b + … ").
    const parcelas = Array.from({ length: n }, () => '\\d+').join(' \\+ ');
    await expect(page.getByTestId('bi-rede-pseudonimo')).toContainText('por estabelecimento');

    // Período fixo (o sintético é determinístico pela semente) e os 13 indicadores com a conta.
    await page.locator('#bi-rede-de').fill('2025-01');
    await page.locator('#bi-rede-ate').fill('2025-06');
    await page.getByTestId('bi-rede-aplicar').click();
    await expect(page.getByTestId('bi-rede-periodo')).toContainText('2025');
    const linhas = page.getByTestId('bi-rede-tabela').locator('tbody tr');
    await expect(linhas).toHaveCount(13);
    // Contagem: a soma das partes; taxa: (a + b) ÷ (c + d) × 100.
    await expect(page.getByTestId('bi-rede-ind-admissoes')).toContainText(new RegExp(`${parcelas} = \\d+`));
    await expect(page.getByTestId('bi-rede-ind-taxaMortalidadeGeral')).toContainText(
      new RegExp(`\\(${parcelas}\\) ÷ \\(${parcelas}\\) × 100 = `),
    );
    await expect(page.getByTestId('bi-rede-ind-mediaPacientesDia')).toContainText(
      new RegExp(`\\(${parcelas}\\) ÷ 30 = `),
    );
    // Nada de pessoa no BI.
    await expect(tela).not.toContainText('PACIENTE SINT');
    await semViolacaoAxe(page, 'BI consolidado da Rede');

    // A série de um indicador, com a parte de cada estabelecimento e a planilha.
    await page.getByTestId('bi-rede-abrir-taxaMortalidadeGeral').click();
    const serie = page.getByTestId('bi-rede-serie');
    await expect(serie.getByRole('heading', { level: 2 })).toContainText('Taxa de mortalidade geral');
    await expect(page.getByTestId('bi-rede-serie-tabela').locator('tbody tr')).toHaveCount(6);
    await expect(page.getByTestId('bi-rede-exportar')).toHaveAttribute(
      'href',
      '/api/relatorios/bi/rede/indicadores/taxaMortalidadeGeral/exportar?de=2025-01&ate=2025-06',
    );
    const planilha = await page.request.get(
      '/api/relatorios/bi/rede/indicadores/taxaMortalidadeGeral/exportar?de=2025-01&ate=2025-06',
    );
    expect(planilha.status()).toBe(200);
    expect(await planilha.text()).toMatch(/numerador Estabelecimento sintético da rede/);
    await semViolacaoAxe(page, 'série da Rede');

    // Os painéis da Rede.
    await page.getByTestId('aba-bi-rede-operacional').click();
    await expect(page.getByTestId('bi-rede-painel-cirurgias')).toBeVisible();
    await semViolacaoAxe(page, 'painel operacional da Rede');
    await page.getByTestId('aba-bi-rede-financeiro').click();
    await expect(page.getByTestId('bi-rede-painel-glosa-baixados')).toBeVisible();

    // Regra 10: a diretoria da Rede não abre prontuário (nem a API, nem a tela).
    for (const url of ['/api/pep/paciente/1/cabecalho', '/api/pep/paciente/1/linha-do-tempo'])
      expect((await page.request.get(url)).status()).toBe(403);
    await page.goto('/pep/prontuario');
    await expect(page.getByTestId('tela-prontuario-busca')).toHaveCount(0);

    // Serviços compartilhados: registrar, mudar a situação, editar e buscar.
    await page.goto('/relatorios/bi/rede');
    await page.getByTestId('link-servicos-rede').click();
    await expect(page).toHaveURL(/\/relatorios\/bi\/rede\/servicos$/);
    await expect(page.getByTestId('servicos-rede-vazio')).toBeVisible();
    await semViolacaoAxe(page, 'serviços compartilhados vazio');
    await page.getByTestId('botao-registrar-servico-rede').click();
    const form = page.getByTestId('form-servico-rede');
    await escolher(form.getByRole('combobox', { name: 'Área' }), 'laudos');
    await form.getByRole('textbox', { name: 'Título' }).fill('Laudos de imagem compartilhados (sintético)');
    await form.getByRole('textbox', { name: 'Descrição (opcional)' }).fill('Estudo sintético de teste');
    await expect(page.getByTestId('envolvido-sx')).toBeChecked();
    await semViolacaoAxe(page, 'registrar oportunidade');
    await page.getByTestId('gravar-servico-rede').click();
    await expect(page.getByTestId('mensagem-servicos-rede')).toHaveText('Oportunidade registrada.');
    const tabela = page.getByTestId('tabela-servicos-rede');
    await expect(tabela.locator('tbody tr')).toHaveCount(1);
    await expect(tabela).toContainText('Laudos de imagem compartilhados (sintético)');
    await expect(tabela).toContainText('Registrada');
    const linha = tabela.locator('tbody tr').first();
    await escolher(linha.getByRole('combobox'), 'em_estudo');
    await linha.getByRole('button', { name: 'Salvar' }).click();
    await expect(page.getByTestId('mensagem-servicos-rede')).toHaveText('Situação salva.');
    await expect(tabela).toContainText('Em estudo');
    // Editar: o detalhe (quem registrou e onde) e a edição do título, da descrição e dos envolvidos.
    await linha.getByRole('button', { name: /^Editar / }).click();
    const edicao = page.getByTestId('form-servico-rede');
    await expect(page.getByTestId('detalhe-servico-rede')).toContainText('Registrada por');
    await expect(edicao.getByRole('textbox', { name: 'Título' })).toHaveValue(
      'Laudos de imagem compartilhados (sintético)',
    );
    await edicao.getByRole('textbox', { name: 'Título' }).fill('Laudos de imagem em conjunto (sintético)');
    await edicao.getByRole('textbox', { name: 'Descrição (opcional)' }).fill('Estudo sintético revisto');
    await page.getByTestId('envolvido-sx').uncheck();
    await semViolacaoAxe(page, 'editar oportunidade');
    await page.getByTestId('gravar-servico-rede').click();
    await expect(page.getByTestId('mensagem-servicos-rede')).toHaveText('Oportunidade salva.');
    await expect(tabela).toContainText('Laudos de imagem em conjunto (sintético)');
    await expect(tabela).toContainText('Estudo sintético revisto');
    await expect(tabela).toContainText('Em estudo');
    // Salvar sem mudar nada não grava.
    await linha.getByRole('button', { name: /^Editar / }).click();
    await page.getByTestId('gravar-servico-rede').click();
    await expect(page.getByTestId('mensagem-servicos-rede')).toHaveText('Nada mudou.');
    // Busca no título ou na descrição.
    const busca = page.getByTestId('busca-servicos-rede');
    await busca.getByRole('textbox', { name: 'Buscar no título ou na descrição' }).fill('REVISTO');
    await busca.getByRole('button', { name: 'Buscar' }).click();
    await expect(tabela.locator('tbody tr')).toHaveCount(1);
    await busca.getByRole('textbox', { name: 'Buscar no título ou na descrição' }).fill('inexistente');
    await busca.getByRole('button', { name: 'Buscar' }).click();
    await expect(page.getByTestId('servicos-rede-vazio')).toBeVisible();
    await busca.getByRole('textbox', { name: 'Buscar no título ou na descrição' }).fill('');
    await busca.getByRole('button', { name: 'Buscar' }).click();
    await expect(tabela.locator('tbody tr')).toHaveCount(1);
    // Filtro por situação (SanteSelecao).
    await escolher(page.getByRole('combobox', { name: 'Situação' }).first(), 'adotada');
    await expect(page.getByTestId('servicos-rede-vazio')).toBeVisible();
    await semViolacaoAxe(page, 'serviços compartilhados');
    expect(externas).toEqual([]);
  });
});
