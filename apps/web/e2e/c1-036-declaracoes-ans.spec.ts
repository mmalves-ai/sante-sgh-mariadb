// E2E @C1-036 (F7, 08-SGO L110): declarações periódicas da operadora pelo caminho da tela /operadora/ans/declaracoes,
// aberta pelo link da tela dos envios à ANS. A equipe da operadora apura a taxa de saúde suplementar do trimestre (a
// conta de cada plano aparece impressa), importa a base de conferência devolvida pela ANS e encaminha uma divergência,
// e gera a DMED com o CPF do responsável validado na hora. As rotas /api/operadora/ans/declaracoes exigem o banco
// próprio e o E2E roda com a fonte sintética: as respostas são simuladas pelo Playwright com massa SINTÉTICA. O efeito
// no banco está em apps/api/src/modulos/operadora/ans-declaracoes-propria.int.spec.ts.
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe } from './ajuda.js';
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

const json = (rota: Route, corpo: unknown, status = 200) =>
  rota.fulfill({ status, contentType: 'application/json', body: JSON.stringify(corpo) });

test.describe('Declarações periódicas da operadora @C1-036 @fase7', () => {
  test.setTimeout(180_000);
  test('TPS com a conta impressa, conferência com divergência encaminhada e DMED com CPF validado; axe', async ({
    page,
  }) => {
    const pedidos: { caminho: string; corpo: Record<string, unknown> }[] = [];
    await page.route('**/api/operadora/ans/apoio', (r) =>
      json(r, {
        destino: 'simulador',
        leiaute: 'sintetico',
        operadoras: [{ id: 7, nome: 'OPERADORA SINTETICA', registroAns: '410361' }],
        obrigacoes: [],
        motivosSib: [],
        camposSib: [],
        valoresTps: [],
        situacao: { vale: true, motivo: null },
      }),
    );
    await page.route('**/api/operadora/ans/declaracoes/**', async (r) => {
      const u = new URL(r.request().url());
      const caminho = u.pathname.replace('/api/operadora/ans/declaracoes', '');
      if (r.request().method() === 'POST') {
        pedidos.push({ caminho, corpo: r.request().postDataJSON() as Record<string, unknown> });
        if (caminho === '/7/tps')
          return json(
            r,
            {
              id: 1,
              apuracao: {
                valorTotal: 2.7,
                vencimento: '2026-06-10',
                parcelas: [{ plano: 'PLANO SINTETICO', media: 2, valor: 2.7 }],
              },
            },
            201,
          );
        return json(
          r,
          { id: 2, versao: 2 },
          caminho.endsWith('passo') || caminho.endsWith('tratar') ? 200 : 201,
        );
      }
      if (caminho === '/7/conferencias')
        return json(r, [
          {
            id: 2,
            competencia: '2026-10',
            importadaEm: '2026-11-01T10:00:00Z',
            registros: 2,
            divergencias: 1,
            pendentes: 1,
            situacao: 'em_conferencia',
            observacao: null,
          },
        ]);
      if (caminho === '/conferencias/2/itens')
        return json(r, [
          {
            id: 9,
            versao: 1,
            sequencia: 1,
            beneficiario: 31,
            cco: '000000103611',
            tipo: 'campo_divergente',
            campo: 'nascimento',
            valorCadastro: '1980-05-10',
            valorAns: '1980-05-11',
            correcao: 'pendente',
            justificativa: null,
          },
        ]);
      return json(r, []);
    });

    await entrar(page, 'SINT.OPERADORA');
    await page.goto('/operadora/ans');
    await page.getByTestId('link-declaracoes-ans').click();
    await expect(page).toHaveURL(/\/operadora\/ans\/declaracoes/);
    await expect(page.getByTestId('tela-declaracoes-ans')).toBeVisible();

    // TPS: o botão só libera com o trimestre; a conta de cada plano aparece.
    await expect(page.getByTestId('tps-apurar')).toBeDisabled();
    await page.getByTestId('tps-ano').locator('input, textarea').first().fill('2026');
    await escolher(page.getByTestId('tps-trimestre'), '2º trimestre');
    await page.getByTestId('tps-apurar').click();
    await expect(page.getByTestId('tps-conta')).toContainText('PLANO SINTETICO');
    await expect(page.getByTestId('tps-conta')).toContainText('10/06/2026');
    expect(pedidos.find((p) => p.caminho === '/7/tps')?.corpo).toEqual({ ano: 2026, trimestre: 2 });

    // Conferência: importa o arquivo sintético e encaminha a divergência para corrigir o cadastro.
    await page.getByTestId('aba-conferencia').click();
    await page.getByTestId('conf-competencia').locator('input').fill('2026-10');
    await page.getByTestId('conf-arquivo').setInputFiles({
      name: 'conferencia-sintetica.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(
        'cco;nome;nascimento;cpf;cns;registro_plano;situacao\n000000103611;SINTETICA;11/05/1980;;;410361;ATIVO\n',
      ),
    });
    await page.getByTestId('conf-importar').click();
    await expect(page.getByTestId('div-1')).toContainText('Campo diferente');
    await escolher(page.getByTestId('div-tratamento-1'), 'Corrigir o cadastro');
    await page.getByTestId('div-aplicar-1').click();
    expect(pedidos.find((p) => p.caminho === '/divergencias/9/tratar')?.corpo).toMatchObject({
      versao: 1,
      para: 'corrigir_cadastro',
    });

    // DMED: o CPF inválido aparece na hora e segura o botão.
    await page.getByTestId('aba-dmed').click();
    await page.getByTestId('dmed-cpf').locator('input').fill('12345678900');
    await expect(page.getByTestId('dmed-cpf-invalido')).toBeVisible();
    await page.getByTestId('dmed-nome').locator('input').fill('Responsável Sintético');
    await expect(page.getByTestId('dmed-gerar')).toBeDisabled();
    await page.getByTestId('dmed-cpf').locator('input').fill('529.982.247-25');
    await page.getByTestId('dmed-gerar').click();
    expect(pedidos.find((p) => p.caminho === '/7/dmed')?.corpo).toMatchObject({
      responsavelCpf: '52998224725',
      retifica: null,
    });
    await semViolacaoAxe(page, '/operadora/ans');
  });
});
