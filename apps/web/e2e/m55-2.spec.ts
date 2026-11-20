// E2E @M55.2 (ficha do M55, seção 10, na parte da etapa 2): a rouparia abre o painel pelo menu (Hotelaria e apoio >
// Rouparia e lavanderia), registra a coleta pesada no setor, o envio à lavanderia terceirizada com as peças, o retorno
// conferido com o envio (a prévia da diferença de peso e das peças faltando, e a ocorrência para o fornecedor), a
// entrega de roupa limpa e o cancelamento no prazo; consulta os movimentos do período, cadastra uma peça no enxoval,
// grava a cota do setor e vê a reposição; a estatística de kg por setor e dia (regra 4) com a conta; e a coleta pelo
// celular. Quem só consulta lê sem registrar (nem a tela, nem a API). axe sem violação séria em cada tela.
// Sessão real sobre a fonte sintética de dev e a porta da rouparia em MEMÓRIA (setores, lavanderia e enxoval
// SINTÉTICOS); nenhum dado de pessoa.
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

test.describe('@M55.2 Rouparia e lavanderia', () => {
  test.describe.configure({ mode: 'serial', timeout: 480_000 });

  test('quem só consulta: lê o painel, sem registrar (nem a tela, nem a API)', async ({ page }) => {
    await entrar(page, 'SINT.ROUPARIA.CONSULTA');
    expect((await page.request.get('/api/hotelaria/rouparia')).status()).toBe(200);
    const recusa = await page.request.post('/api/hotelaria/rouparia/movimentos', {
      data: {
        tipo: 'coleta',
        data: '2026-01-01',
        centroCusto: 9101,
        pesoKg: 1,
        itens: [],
        chave: 'e2e-consulta-1',
      },
    });
    expect(recusa.status()).toBe(403);
    await page.goto('/hotelaria/rouparia');
    await expect(page.getByTestId('tela-rouparia')).toBeVisible();
    await expect(page.getByTestId('rouparia-form')).toHaveCount(0);
    await page.goto('/m/rouparia');
    await expect(page.getByTestId('tela-rouparia-celular')).toHaveCount(0);
  });

  test('coleta → envio → retorno com ocorrência → entrega; cancelamento; enxoval, cotas e indicadores', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.ROUPARIA');
    const menu = page.getByRole('navigation', { name: 'Menu principal' });
    await menu.getByRole('button', { name: /^Hotelaria e apoio/ }).click();
    await menu.getByRole('link', { name: 'Rouparia e lavanderia' }).click();
    await expect(page).toHaveURL(/\/hotelaria\/rouparia$/);
    const tela = page.getByTestId('tela-rouparia');
    await expect(tela.getByRole('heading', { level: 1 })).toHaveText('Rouparia e lavanderia');
    await expect(page.getByTestId('nav-rouparia')).toBeVisible();
    await expect(tela).toContainText('Nenhum envio aguardando o retorno.');
    await semViolacaoAxe(page, 'painel da rouparia');

    const form = page.getByTestId('rouparia-form');
    const mensagem = page.getByTestId('rouparia-mensagem');

    // 1. Coleta pesada no setor (as peças são opcionais na coleta).
    await escolher(page.getByTestId('rouparia-setor'), '9101');
    await page.getByTestId('rouparia-peso').fill('12,5');
    await page.getByTestId('rouparia-gravar').click();
    await expect(mensagem).toHaveText('Movimento registrado.');
    await expect(page.getByTestId('rouparia-hoje').locator('tr[data-tipo="coleta"]')).toHaveCount(1);

    // 2. Envio à lavanderia terceirizada, com o fornecedor pela busca e as peças contadas.
    await escolher(page.getByTestId('rouparia-tipo'), 'envio');
    await expect(page.getByTestId('rouparia-setor')).toHaveCount(0);
    await escolher(page.getByTestId('rouparia-lavanderia'), 'terceirizada');
    await form.getByRole('textbox', { name: 'Buscar fornecedor por nome ou código' }).fill('Sint');
    await page.getByTestId('rouparia-pesquisar-fornecedor').click();
    await escolher(page.getByTestId('rouparia-fornecedor'), '7101');
    await page.getByTestId('rouparia-peso').fill('12');
    await escolher(page.getByTestId('rouparia-peca-0'), '1');
    await page.getByTestId('rouparia-qtd-0').fill('10');
    await page.getByTestId('rouparia-adicionar-peca').click();
    await escolher(page.getByTestId('rouparia-peca-1'), '2');
    await page.getByTestId('rouparia-qtd-1').fill('5');
    await semViolacaoAxe(page, 'registrar o envio');
    await page.getByTestId('rouparia-gravar').click();
    await expect(mensagem).toHaveText('Movimento registrado.');
    const abertos = page.getByTestId('rouparia-abertos');
    await expect(abertos.locator('tbody tr')).toHaveCount(1);
    await expect(abertos).toContainText('Lavanderia terceirizada');
    await expect(abertos).toContainText('12 kg');
    await expect(abertos).toContainText('No prazo');

    // 3. Retorno conferido com o envio: 11 kg e uma fronha a menos → prévia com a ocorrência para o fornecedor.
    await abertos.locator('[data-testid^="envio-retornar-"]').first().click();
    await expect(page.getByTestId('rouparia-remessa')).toBeVisible();
    await page.getByTestId('rouparia-peso').fill('11');
    await escolher(page.getByTestId('rouparia-peca-0'), '1');
    await page.getByTestId('rouparia-qtd-0').fill('10');
    await page.getByTestId('rouparia-adicionar-peca').click();
    await escolher(page.getByTestId('rouparia-peca-1'), '2');
    await page.getByTestId('rouparia-qtd-1').fill('4');
    const previa = page.getByTestId('rouparia-previa');
    await expect(previa).toHaveAttribute('data-ocorrencia', 'true');
    await expect(previa).toContainText('Enviado 12 kg − retornado 11 kg = diferença 1 kg');
    await expect(previa).toContainText('Fronha: enviadas 5, voltaram 4, faltam 1');
    await expect(previa).toContainText('Vai gerar ocorrência para o fornecedor.');
    await semViolacaoAxe(page, 'conferência do retorno');
    await page.getByTestId('rouparia-gravar').click();
    await expect(mensagem).toContainText('Retorno registrado com ocorrência para o fornecedor');
    await expect(tela).toContainText('Nenhum envio aguardando o retorno.');
    const hoje = page.getByTestId('rouparia-hoje');
    await expect(hoje.locator('tr[data-tipo="envio"]')).toHaveAttribute('data-situacao', 'retornado');
    await expect(hoje.locator('tr[data-tipo="retorno"]')).toContainText('Ocorrência');

    // O detalhe do retorno: a diferença para o envio e a ocorrência.
    await hoje.locator('tr[data-tipo="retorno"]').getByRole('button', { name: 'Detalhe' }).click();
    const detalhe = page.getByTestId('rouparia-detalhe');
    await expect(page.getByTestId('rouparia-detalhe-ocorrencia')).toHaveText(
      'Com ocorrência para o fornecedor',
    );
    await expect(detalhe).toContainText('Diferença para o envio: 1 kg');
    await semViolacaoAxe(page, 'detalhe do retorno');
    await detalhe.getByRole('button', { name: 'Fechar' }).click();

    // 4. Entrega de roupa limpa ao setor (as peças são obrigatórias).
    await escolher(page.getByTestId('rouparia-tipo'), 'entrega');
    await escolher(page.getByTestId('rouparia-setor'), '9101');
    await escolher(page.getByTestId('rouparia-peca-0'), '1');
    await page.getByTestId('rouparia-qtd-0').fill('8');
    await page.getByTestId('rouparia-gravar').click();
    await expect(mensagem).toHaveText('Movimento registrado.');
    const entrega = hoje.locator('tr[data-tipo="entrega"]');
    await expect(entrega).toHaveCount(1);

    // 5. Cancelamento no prazo, com o motivo e a confirmação.
    await entrega.getByRole('button', { name: 'Detalhe' }).click();
    await detalhe
      .getByRole('textbox', { name: 'Motivo do cancelamento' })
      .fill('Entrega lançada em duplicidade (teste)');
    await page.getByTestId('rouparia-cancelar').click();
    const confirmacao = page.getByRole('dialog');
    await expect(confirmacao).toContainText('Ele deixa de contar na estatística');
    await confirmacao.getByRole('button', { name: 'Confirmar' }).click();
    // O detalhe fecha e o painel avisa; a entrega fica cancelada na lista de hoje.
    await expect(tela.getByText('Movimento cancelado.')).toBeVisible();
    await expect(detalhe).toHaveCount(0);
    await expect(entrega).toHaveAttribute('data-situacao', 'cancelado');

    // Movimentos do período (a barra da tela).
    const nav = page.getByTestId('nav-rouparia');
    await nav.getByRole('link', { name: 'Movimentos' }).click();
    await expect(page).toHaveURL(/\/hotelaria\/rouparia\/movimentos$/);
    const movs = page.getByTestId('rouparia-mov-tabela');
    await expect(movs.locator('tbody tr')).toHaveCount(4);
    await expect(movs.locator('tr[data-situacao="cancelado"]')).toHaveCount(1);
    await semViolacaoAxe(page, 'movimentos da rouparia');

    // Enxoval: uma peça nova.
    await nav.getByRole('link', { name: 'Enxoval e kits' }).click();
    await expect(page.getByTestId('tela-rouparia-enxoval')).toBeVisible();
    const enxoval = page.getByTestId('enxoval-form');
    await enxoval.getByRole('textbox', { name: 'Nome' }).fill('Avental sintético');
    await escolher(page.getByTestId('enxoval-categoria'), { indice: 0 });
    await page.getByTestId('enxoval-peso').fill('300');
    await semViolacaoAxe(page, 'enxoval e kits');
    await page.getByTestId('enxoval-gravar').click();
    await expect(page.getByTestId('enxoval-mensagem')).toHaveText('Peça cadastrada no enxoval.');
    await expect(page.getByTestId('enxoval-tabela')).toContainText('Avental sintético');

    // Cotas do setor e a reposição sugerida (estimado = inventário + entregas − coletadas − perdas).
    await nav.getByRole('link', { name: 'Cotas por setor' }).click();
    await expect(page.getByTestId('tela-rouparia-cotas')).toBeVisible();
    await escolher(page.getByTestId('cotas-setor'), '9101');
    await page.getByTestId('cota-valor-1').fill('20');
    await page.getByTestId('cotas-gravar').click();
    await expect(page.getByTestId('cotas-mensagem')).toHaveText('Cotas do setor gravadas.');
    const cota = page.getByTestId('cota-1');
    await expect(cota).toHaveAttribute('data-reposicao', '20');
    await semViolacaoAxe(page, 'cotas por setor');

    // Regra 4: a estatística de kg por setor e dia, com a conta (só a coleta pesada conta).
    await nav.getByRole('link', { name: 'Estatística e indicadores' }).click();
    await expect(page.getByTestId('tela-rouparia-indicadores')).toBeVisible();
    await expect(page.getByTestId('ind-setor-9101')).toContainText('12,5 kg');
    await expect(page.getByTestId('ind-conta')).not.toBeEmpty();
    await expect(page.getByTestId('ind-ocorrencias')).toContainText('1 de 1 retornos no período');
    await semViolacaoAxe(page, 'estatística e indicadores');

    // A versão para celular: só coleta e entrega.
    await page.goto('/m/rouparia');
    await expect(page.getByTestId('tela-rouparia-celular')).toBeVisible();
    await escolher(page.getByTestId('app-rouparia-setor'), '9102');
    await page.getByTestId('app-rouparia-peso').fill('3,2');
    await semViolacaoAxe(page, 'rouparia no celular');
    await page.getByTestId('app-rouparia-gravar').click();
    await expect(page.getByTestId('app-rouparia-mensagem')).toHaveText('Movimento registrado.');
    await page.goto('/hotelaria/rouparia/indicadores');
    await expect(page.getByTestId('ind-setor-9102')).toContainText('3,2 kg');
    expect(externas).toEqual([]);
  });
});
