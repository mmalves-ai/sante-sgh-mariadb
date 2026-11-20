// E2E @M54.4 (ficha do M54, etapa F4: estrutura de custos e coleta das estatísticas): o analista de custos abre
// Controladoria > Custos hospitalares > Centros de custo e critérios de rateio pelo menu → a aba Estrutura mostra a
// contagem por classe com o total, as pendências e a sugestão de classe → classifica a lavanderia como auxiliar (ordem
// e critério do rateio) e a UTI como produtiva → a sequência do rateio mostra o passo → a aba Estatísticas coleta o
// paciente-dia de 03/2026 (estimado: o censo do mês não fechou inteiro), com o total e as parcelas → lança à mão o
// quilo de roupa da lavanderia (o manual prevalece) → a aba Cadastros traz o CRUD genérico das tabelas do custeio →
// quem só consulta vê a estrutura e as estatísticas sem classificar, coletar nem lançar. Axe sem violação séria em cada
// estado. Sessão real sobre a fonte sintética de dev; a estrutura de custos em MEMÓRIA (centros e fontes SINTÉTICOS;
// nada vai à cópia); nenhum dado de pessoa.
import { expect, type Page, test } from '@playwright/test';
import { itemDoMenu, semViolacaoAxe, vigiarExternas } from './ajuda.js';
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

async function classificar(
  page: Page,
  codigo: number,
  classe: 'produtivo' | 'auxiliar' | 'administrativo',
  rateio?: { ordem: string; criterio: string },
): Promise<void> {
  await page.getByTestId(`custos-classificar-${codigo}`).click();
  const form = page.getByTestId('custos-classificar');
  await expect(form).toBeVisible();
  await escolher(form.getByTestId('custos-classe'), classe);
  if (rateio) {
    await form.getByTestId('custos-ordem').fill(rateio.ordem);
    await escolher(form.getByTestId('custos-criterio'), rateio.criterio);
  }
  await form
    .getByTestId('custos-observacao')
    .locator('input, textarea')
    .first()
    .fill('Classificação do E2E M54.4');
  await form.getByTestId('custos-gravar-classificacao').click();
  await expect(page.getByTestId('custos-gravado')).toContainText(String(codigo), { timeout: 30_000 });
}

test.describe('controladoria, etapa F4: estrutura de custos e estatísticas @M54.4', () => {
  test.setTimeout(300_000);
  test.use({ actionTimeout: 30_000 });

  test('menu → contagem e pendências → classificar → sequência → coletar 03/2026 → lançar à mão → cadastros → consulta; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);

    // O analista de custos chega pela árvore do menu.
    await entrar(page, 'SINT.CUSTOS');
    await (await itemDoMenu(page, 'Centros de custo e critérios de rateio')).click();
    await expect(page).toHaveURL(/\/custos\/centros/);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Centros de custo e critérios de rateio' }),
    ).toBeVisible();

    // Estrutura: a contagem com o total (6 ativos sintéticos; o desativado fica fora), pendências e sugestão.
    const estrutura = page.getByTestId('custos-estrutura');
    await expect(estrutura).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('custos-contagem')).toContainText('= 6 centro(s) ativo(s)');
    await expect(page.getByTestId('custos-pendencias')).toBeVisible();
    await expect(page.getByTestId('custos-centro-300100')).toContainText('UTI ADULTO SINTETICA');
    await expect(page.getByTestId('custos-centro-100999')).toContainText('inativo');
    await semViolacaoAxe(page, '/custos/centros (estrutura)');

    // Classificar: a lavanderia reparte pelo quilo de roupa; a UTI é produtiva (só recebe).
    await classificar(page, 200130, 'auxiliar', { ordem: '1', criterio: 'kgRoupa' });
    await expect(page.getByTestId('custos-centro-200130')).toContainText(/Auxiliar/i);
    await classificar(page, 300100, 'produtivo');
    await expect(page.getByTestId('custos-centro-300100')).toContainText(/Produtivo/i);
    await expect(page.getByTestId('custos-centro-300100')).toContainText('não rateia (recebe)');
    await expect(page.getByTestId('custos-sequencia')).toContainText('1º');
    await expect(page.getByTestId('custos-sequencia')).toContainText('LAVANDERIA SINTETICA');
    await semViolacaoAxe(page, '/custos/centros (estrutura classificada)');

    // Estatísticas: coleta do paciente-dia de 03/2026, estimado pelas internações (censo de 10 dias).
    await page.getByTestId('custos-aba-estatisticas').click();
    await expect(page.getByTestId('custos-estatisticas')).toBeVisible();
    await escolher(page.getByTestId('custos-competencia'), '2026-03');
    await escolher(page.getByTestId('custos-estatistica'), 'pacienteDia');
    await expect(page.getByTestId('custos-definicao')).toBeVisible();
    await page.getByTestId('custos-coletar').click();
    await expect(page.getByTestId('custos-coletada')).toContainText('Coleta concluída', { timeout: 60_000 });
    await expect(page.getByTestId('custos-ultima-coleta')).toContainText('Última coleta');
    await expect(page.getByTestId('custos-fontes')).toBeVisible();
    await expect(page.getByTestId('custos-valor-300100')).toContainText('estimada');
    await expect(page.getByTestId('custos-total')).toContainText('Total de Paciente-dia');
    await expect(page.getByTestId('custos-total')).toContainText('=');
    await semViolacaoAxe(page, '/custos/centros (estatísticas coletadas)');

    // Lançar à mão o quilo de roupa da lavanderia: o manual prevalece sobre o coletado.
    await escolher(page.getByTestId('custos-estatistica'), 'kgRoupa');
    await page.getByTestId('custos-lancar').click();
    const lanc = page.getByTestId('custos-form-lancamento');
    await expect(lanc).toBeVisible();
    await escolher(lanc.getByTestId('custos-lanc-centro'), { rotulo: '200130 LAVANDERIA SINTETICA' });
    await lanc.getByTestId('custos-lanc-quantidade').fill('1250,5');
    await lanc
      .getByTestId('custos-lanc-observacao')
      .locator('input, textarea')
      .first()
      .fill('Pesagem da lavanderia (E2E M54.4)');
    await semViolacaoAxe(page, '/custos/centros (lançamento à mão)');
    await lanc.getByTestId('custos-lanc-gravar').click();
    await expect(page.getByTestId('custos-lancado')).toContainText('gravado', { timeout: 30_000 });
    await expect(page.getByTestId('custos-valor-200130')).toContainText('Lançada à mão');
    await expect(page.getByTestId('custos-total')).toContainText('Total de Roupa processada');

    // Cadastros do custeio pelo CRUD genérico embutido.
    await page.getByTestId('custos-aba-cadastros').click();
    await expect(page.getByTestId('custos-cadastros')).toBeVisible();
    await expect(page.getByTestId('grupo-dominios-custosCadastros')).toBeVisible({ timeout: 30_000 });
    await semViolacaoAxe(page, '/custos/centros (cadastros do custeio)');

    // Quem só consulta o centro de custo: vê, sem classificar, coletar nem lançar.
    await entrar(page, 'SINT.CUSTOS.CONSULTA');
    await page.goto('/custos/centros');
    await expect(page.getByTestId('custos-aviso-gravacao')).toContainText('Seu perfil consulta', {
      timeout: 30_000,
    });
    await expect(page.getByTestId('custos-centro-200130')).toContainText(/Auxiliar/i);
    await expect(page.locator('[data-testid^="custos-classificar-"]')).toHaveCount(0);
    await page.getByTestId('custos-aba-estatisticas').click();
    await expect(page.getByTestId('custos-estatisticas')).toBeVisible();
    await expect(page.getByTestId('custos-coletar')).toHaveCount(0);
    await expect(page.getByTestId('custos-lancar')).toHaveCount(0);
    await semViolacaoAxe(page, '/custos/centros (somente consulta)');

    expect(externas).toEqual([]);
  });
});
