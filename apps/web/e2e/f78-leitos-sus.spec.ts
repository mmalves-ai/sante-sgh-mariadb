// F78.04-2 (04-INT linha 79): leitos do sistema público, pelo caminho da tela. As rotas exigem o banco próprio, e o
// E2E roda com a fonte sintética (sem núcleo); por isso as respostas da API destas rotas são simuladas pelo Playwright
// com massa SINTÉTICA. O que se prova é a tela: a rota do menu abre a tela, a habilitação com portaria pela metade é
// recusada na hora (sem ir ao servidor), a inclusão completa vai com os campos certos e aparece na lista, e o leito
// entra no programa da habilitação escolhida. O efeito no banco (teto de leitos no período, vigência, histórico da
// capacidade, trilha) está no contrato de efeito (apps/api/src/modulos/adt/leitos-sus-propria.int.spec.ts).
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe } from './ajuda.js';

const SENHA = 'Sintetico#2026';

async function entrar(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

const json = (rota: Route, corpo: unknown, status = 200) =>
  rota.fulfill({ status, contentType: 'application/json', body: JSON.stringify(corpo) });

test.describe('F78.04-2 leitos do sistema público @F78.04-2', () => {
  test('habilitação validada na hora, incluída e leito no programa', async ({ page }) => {
    const pedidos: { metodo: string; caminho: string; corpo: Record<string, unknown> }[] = [];
    const habilitacoes: Record<string, unknown>[] = [];
    const leitos: Record<string, unknown>[] = [];
    await page.route('**/api/internacao/leitos-sus/**', (r) => {
      const req = r.request();
      const url = new URL(req.url());
      if (req.method() === 'GET') {
        if (url.pathname.endsWith('/habilitacoes')) return json(r, { itens: habilitacoes });
        if (/\/habilitacoes\/\d+\/leitos$/.test(url.pathname)) return json(r, { itens: leitos });
        return json(r, { competencia: url.searchParams.get('competencia'), itens: [] });
      }
      const corpo = req.postDataJSON() as Record<string, unknown>;
      pedidos.push({ metodo: req.method(), caminho: url.pathname, corpo });
      if (url.pathname.endsWith('/habilitacoes')) {
        habilitacoes.push({
          ...corpo,
          id: 501,
          descricao: null,
          ativo: true,
          leitosNoPrograma: 0,
          versao: 1,
        });
        return json(r, { id: 501 });
      }
      leitos.push({
        id: 601,
        leito: corpo['leito'],
        leitoCodigo: 'UTI-01',
        ...corpo,
        vigenciaFim: null,
        versao: 1,
      });
      habilitacoes[0]!['leitosNoPrograma'] = 1;
      return json(r, { id: 601 });
    });

    await entrar(page, 'SINT.ADMIN');
    await page.goto('/internacao/leitos-sus');
    await expect(page.getByTestId('tela-leitos-sus')).toBeVisible();

    await page.getByTestId('hab-codigo').fill('2601');
    await page.getByTestId('hab-nome').fill('UTI adulto sintetica');
    await page.getByTestId('hab-inicio').fill('2025-02-01');
    await page.getByTestId('hab-quantidade').fill('2');
    // Validação na hora: portaria sem a data trava o botão, sem ir ao servidor.
    await page.getByTestId('hab-portaria').fill('100/2025');
    await expect(page.getByTestId('hab-problemas')).toContainText(
      'A portaria precisa de número e data juntos.',
    );
    await expect(page.getByTestId('hab-incluir')).toBeDisabled();
    await page.getByTestId('hab-data-portaria').fill('2025-01-10');
    await expect(page.getByTestId('hab-problemas')).toHaveCount(0);
    await page.getByTestId('hab-incluir').click();
    await expect(page.getByTestId('leitos-sus-aviso')).toHaveText('Gravado.');
    expect(pedidos[0]).toMatchObject({
      metodo: 'POST',
      caminho: '/api/internacao/leitos-sus/habilitacoes',
      corpo: {
        codigo: '2601',
        nome: 'UTI adulto sintetica',
        numeroPortaria: '100/2025',
        dataPortaria: '2025-01-10',
        vigenciaInicio: '2025-02-01',
        vigenciaFim: null,
        quantidadeLeitosHabilitados: 2,
        tipoAtendimento: 'internacao',
      },
    });
    await expect(page.getByTestId('habilitacoes-sus')).toContainText('0 / 2');

    // O leito entra no programa da habilitação escolhida.
    await page.getByTestId('hab-ver-2601').click();
    await expect(page.getByTestId('leitos-programa')).toBeVisible();
    await expect(page.getByTestId('vinculo-incluir')).toBeDisabled();
    await page.getByTestId('vinculo-leito').fill('7');
    await page.getByTestId('vinculo-incluir').click();
    expect(pedidos[1]).toMatchObject({
      metodo: 'POST',
      caminho: '/api/internacao/leitos-sus/habilitacoes/501/leitos',
      corpo: { leito: 7 },
    });
    await expect(page.getByTestId('vinculo-UTI-01')).toBeVisible();
    await expect(page.getByTestId('habilitacoes-sus')).toContainText('1 / 2');
    await semViolacaoAxe(page, 'leitos do sistema público');
  });
});
