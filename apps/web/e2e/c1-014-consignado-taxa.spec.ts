// E2E @C1-014 (05-SUP linha 24): a aba "Taxa por faixa" da tela dos consignados. O almoxarife dos consignados vê que
// não há tabela vigente, monta a tabela geral nova só com o "até" e o percentual de cada faixa (a faixa seguinte começa
// sozinha onde a anterior termina), vê na hora o que falta (percentual vazio, início no passado) sem ir ao servidor,
// grava (um POST com a Idempotency-Key e as faixas contíguas a partir de zero), vê a tabela vigente e o histórico, e
// calcula a taxa de um material com as parcelas impressas (percentual, taxa bruta, teto, total). A taxa grava só no
// banco próprio: aqui as rotas /api/suprimentos/consignados/taxas são simuladas com estado (massa SINTÉTICA); o efeito
// no banco está em apps/api/src/modulos/suprimentos/consignado-taxa.int.spec.ts. O resto da tela (saldo, remessa,
// reposição, faturamento e devolução) responde pelo módulo do suprimentos registrado no modulo.ts.
import { expect, type Page, test } from '@playwright/test';
import { semViolacaoAxe } from './ajuda.js';

const SENHA = 'Sintetico#2026';
const hojeSp = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());

async function entrar(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

interface Faixa {
  id: number;
  fornecedor: number | null;
  valorInicial: number;
  valorFinal: number | null;
  percentual: number;
  teto: number | null;
  inicio: string;
  fim: string | null;
}

test.describe('Taxa do consignado por faixa de valor @C1-014 @fase7', () => {
  test.setTimeout(180_000);

  test('tabela geral nova com validação na hora, gravação única, vigente, histórico e cálculo; axe', async ({
    page,
  }) => {
    const hoje = hojeSp();
    const faixas: Faixa[] = [];
    const posts: { chave: string | undefined; corpo: Record<string, unknown> }[] = [];
    await page.route(/\/api\/suprimentos\/consignados\/taxas(\?.*)?$/, async (rota) => {
      const r = rota.request();
      if (r.method() === 'POST') {
        const corpo = r.postDataJSON() as {
          fornecedor: number | null;
          inicio: string;
          faixas: Omit<Faixa, 'id' | 'fornecedor' | 'inicio' | 'fim'>[];
        };
        posts.push({ chave: r.headers()['idempotency-key'], corpo });
        const ids = corpo.faixas.map((f, i) => {
          faixas.push({
            ...f,
            id: 100 + faixas.length + i,
            fornecedor: corpo.fornecedor,
            inicio: corpo.inicio,
            fim: null,
          });
          return 100 + i;
        });
        return rota.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ ids }) });
      }
      return rota.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          hoje,
          fornecedor: null,
          vigentes: faixas,
          origem: faixas.length ? 'geral' : 'sem-tabela',
          historico: faixas,
        }),
      });
    });

    await entrar(page, 'SINT.CONSIGNADO');
    await page.goto('/suprimentos/consignados');
    await expect(page.getByTestId('tela-consignados')).toBeVisible();
    await page.getByTestId('consig-aba-taxas').click();
    const painel = page.getByTestId('consig-taxa');
    await expect(painel.getByTestId('consig-taxa-origem')).toContainText('Nenhuma tabela vigente');
    await expect(painel.getByText('Nenhuma tabela gravada.')).toBeVisible();

    // Validação na hora: sem percentual, o botão fica desabilitado e a mensagem aparece, sem ir ao servidor.
    await expect(painel.getByTestId('consig-taxa-inicio')).toHaveValue(hoje);
    await painel.getByTestId('consig-taxa-ate-0').fill('1000');
    await expect(painel.getByTestId('consig-taxa-recusas')).toContainText('percentual da faixa 1');
    await expect(painel.getByTestId('consig-taxa-gravar')).toBeDisabled();
    await painel.getByTestId('consig-taxa-pct-0').fill('30');

    // A segunda faixa começa sozinha em R$ 1.000,00; fica sem fim e com teto.
    await painel.getByTestId('consig-taxa-adicionar').click();
    await expect(painel.getByTestId('consig-taxa-linha-1')).toContainText('1.000,00');
    await painel.getByTestId('consig-taxa-pct-1').fill('10');
    await painel.getByTestId('consig-taxa-teto-1').fill('500');
    await expect(painel.getByTestId('consig-taxa-recusas')).toHaveCount(0);

    // Início no passado: recusado na hora.
    await painel.getByTestId('consig-taxa-inicio').fill('2020-01-01');
    await expect(painel.getByTestId('consig-taxa-recusas')).toContainText('começa hoje ou depois');
    await painel.getByTestId('consig-taxa-inicio').fill(hoje);
    await semViolacaoAxe(page, '/suprimentos/consignados (taxa por faixa)');

    await painel.getByTestId('consig-taxa-gravar').click();
    await expect(painel.getByTestId('consig-taxa-mensagem')).toContainText('2 faixa(s)');
    expect(posts).toHaveLength(1);
    expect(posts[0]!.chave).toMatch(/^m46\.e4\.taxa\./);
    expect(posts[0]!.corpo).toEqual({
      fornecedor: null,
      inicio: hoje,
      faixas: [
        { valorInicial: 0, valorFinal: 1000, percentual: 30, teto: null },
        { valorInicial: 1000, valorFinal: null, percentual: 10, teto: 500 },
      ],
    });

    // A vigente e o histórico; o cálculo com as parcelas, inclusive o teto.
    await expect(painel.getByTestId('consig-taxa-origem')).toContainText('Tabela geral');
    await expect(painel.getByTestId('consig-taxa-vigente').locator('tbody tr')).toHaveCount(2);
    await expect(painel.getByTestId('consig-taxa-historico').locator('tbody tr')).toHaveCount(2);
    await painel.getByTestId('consig-taxa-valor').fill('999');
    await expect(painel.getByTestId('consig-taxa-calculo')).toContainText('30%');
    await expect(painel.getByTestId('consig-taxa-calculo')).toContainText('1.298,70');
    await painel.getByTestId('consig-taxa-valor').fill('20000');
    await expect(painel.getByTestId('consig-taxa-calculo')).toContainText('2.000,00');
    await expect(painel.getByTestId('consig-taxa-calculo')).toContainText('20.500,00');
    await semViolacaoAxe(page, '/suprimentos/consignados (taxa gravada)');
  });
});
