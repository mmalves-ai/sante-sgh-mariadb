// C3-011 (02-CAD linha 29): conferência do cadastro SUS do estabelecimento com a base oficial do cadastro nacional,
// pelo caminho da tela. As rotas /api/sus/estabelecimento exigem o banco próprio, e o E2E roda com a fonte sintética
// (sem núcleo); por isso as respostas destas rotas são simuladas pelo Playwright com massa SINTÉTICA. O que se prova é
// a tela: a aba abre a lista das conferências, o botão Conferir manda a competência AAAAMM, a conferência nova aparece
// com as críticas por gravidade (erro antes do alerta), e Resolver leva a versão lida. O efeito no banco está no
// contrato de efeito (apps/api/src/modulos/sus/conferencia-cnes.int.spec.ts).
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

test.describe('C3-011 conferência com o cadastro nacional @C3-011', () => {
  test('conferir a competência, ver as críticas por gravidade e resolver uma', async ({ page }) => {
    const pedidos: { caminho: string; corpo: Record<string, unknown> }[] = [];
    const conferencias: Record<string, unknown>[] = [];
    await page.route('**/api/sus/estabelecimento**', (r) => {
      const req = r.request();
      const url = new URL(req.url());
      if (req.method() === 'GET') {
        if (url.pathname.endsWith('/cnes/conferencias')) return json(r, conferencias);
        if (url.pathname.endsWith('/opcoes'))
          return json(r, {
            tiposPrestador: [],
            instrumentos: [],
            naturezas: [],
            servicos: [],
            servicosSigtap: [],
            grupos: [],
            prestadores: [],
            setores: [],
            locais: [],
          });
        return json(r, { habilitacoes: [], servicos: [], regrasPrestador: [], regrasServico: [] });
      }
      const corpo = req.postDataJSON() as Record<string, unknown>;
      pedidos.push({ caminho: url.pathname, corpo });
      if (url.pathname.endsWith('/cnes/conferir')) {
        conferencias.unshift({
          id: 901,
          competencia: String(corpo['competencia']),
          numeroRemessa: 1,
          situacao: 'conferida',
          geradaEm: '2026-11-26T12:00:00.000Z',
          quantidadeCriticas: 2,
          criticas: [
            {
              id: 9101,
              sequencia: 1,
              categoria: 'servico',
              gravidade: 'alerta',
              mensagem: 'Serviço sintético q98/q01 cadastrado aqui e ausente na base oficial.',
              resolvida: false,
              versao: 1,
            },
            {
              id: 9102,
              sequencia: 2,
              categoria: 'habilitacao',
              gravidade: 'erro',
              mensagem: 'Habilitação sintética 9901 vigente aqui e ausente na base oficial.',
              resolvida: false,
              versao: 3,
            },
          ],
        });
        return json(r, { id: 901, resumo: { erro: 1, alerta: 1, informacao: 0 }, quantidadeCriticas: 2 });
      }
      if (url.pathname.endsWith('/cnes/criticas/9102/resolver')) {
        const c = (conferencias[0]!['criticas'] as Record<string, unknown>[]).find((x) => x['id'] === 9102)!;
        c['resolvida'] = true;
        c['versao'] = 4;
        return json(r, { id: 9102 });
      }
      return json(r, { tipo: 'nao-simulado' }, 500);
    });

    await entrar(page, 'SINT.FATURISTA.AIH');
    await page.goto('/faturamento/sus/cadastros/estabelecimento');
    await page.getByTestId('estab-sus-aba-conferencia').click();
    await expect(page.getByTestId('estab-sus-cnes-vazio')).toBeVisible();

    await page.getByTestId('estab-sus-cnes-competencia').fill('2026-10');
    await page.getByTestId('estab-sus-cnes-conferir').click();
    await expect(page.getByTestId('estab-sus-aviso')).toContainText('2 crítica');
    expect(pedidos.at(-1)).toEqual({
      caminho: '/api/sus/estabelecimento/cnes/conferir',
      corpo: { competencia: '202610' },
    });

    const remessa = page.getByTestId('estab-sus-cnes-remessa-901');
    await expect(remessa).toContainText('10/2026');
    await expect(remessa.getByTestId('estab-sus-cnes-resumo')).toContainText('Erros: 1');
    // Erro antes do alerta, qualquer que seja a ordem da gravação.
    await expect(remessa.locator('tbody tr').first()).toHaveAttribute(
      'data-testid',
      'estab-sus-cnes-critica-9102',
    );
    await semViolacaoAxe(page, 'conferência com o cadastro nacional');

    await page.getByTestId('estab-sus-cnes-critica-9102').getByTestId('estab-sus-cnes-resolver').click();
    await expect(page.getByTestId('estab-sus-cnes-critica-9102')).toContainText('Resolvida');
    expect(pedidos.at(-1)).toEqual({
      caminho: '/api/sus/estabelecimento/cnes/criticas/9102/resolver',
      corpo: { versao: 3 },
    });
    await expect(remessa.getByTestId('estab-sus-cnes-resumo')).toContainText('Erros: 0');
  });
});
