// E2E @C1-106 (F3, 01-REL L113): cargas do data mart na administração, pela tela /relatorios/datamart/cargas aberta
// pelo menu Administração > Integrações > Cargas do data mart. O administrador vê a última carga em destaque, a lista
// (agendada e manual, com quem pediu), abre as etapas por dimensão e fato e pede a carga manual com um clique; com
// outra carga aberta, a recusa aparece na hora. As rotas /api/relatorios/datamart/cargas exigem o banco próprio e o E2E
// roda com a fonte sintética: as respostas são simuladas pelo Playwright com massa SINTÉTICA (só contagens). O efeito
// no banco está em apps/api/src/modulos/relatorio/datamart-cargas-propria.int.spec.ts e, do lado do worker, em
// apps/worker/src/datamart-carga-propria.int.spec.ts.
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

const fechada = {
  id: 11,
  disparo: 'agendado',
  tipoCarga: 'completa',
  situacao: 'concluida',
  ocorridoEm: '2026-11-25T05:00:00.000Z',
  concluidoEm: '2026-11-25T05:00:03.000Z',
  duracaoMs: 3000,
  linhasLidas: 42,
  linhasGravadas: 42,
  linhasRejeitadas: 0,
  mensagemErro: null,
  pedidoPor: null,
  etapas: 2,
};

test.describe('Cargas do data mart na administração @C1-106 @fase3', () => {
  test.setTimeout(120_000);
  test('lista, etapas, pedido manual e recusa com carga aberta; axe', async ({ page }) => {
    let itens: unknown[] = [fechada];
    let pedidos = 0;
    await page.route('**/api/relatorios/datamart/cargas**', async (r) => {
      const u = new URL(r.request().url());
      if (r.request().method() === 'POST') {
        pedidos += 1;
        if (pedidos > 1)
          return json(
            r,
            {
              type: 'x',
              title: 'Carga em andamento',
              status: 409,
              codigo: 'carga-em-andamento',
              detail: 'aberta',
            },
            409,
          );
        itens = [
          {
            ...fechada,
            id: 12,
            disparo: 'manual',
            situacao: 'aguardando',
            ocorridoEm: '2026-11-25T14:00:00.000Z',
            concluidoEm: null,
            duracaoMs: null,
            linhasLidas: null,
            linhasGravadas: null,
            linhasRejeitadas: null,
            pedidoPor: 'ADMINISTRADOR SINTETICO',
            etapas: 0,
          },
          fechada,
        ];
        return json(r, { id: 12, situacao: 'aguardando' });
      }
      if (u.pathname.endsWith('/cargas/11'))
        return json(r, {
          ...fechada,
          itens: [
            {
              sequencia: 1,
              tipoObjeto: 'fato',
              objeto: 'fato_internacao',
              linhas: 40,
              duracaoMs: 2500,
              situacao: 'concluida',
            },
            {
              sequencia: 2,
              tipoObjeto: 'dimensao',
              objeto: 'carga',
              linhas: 2,
              duracaoMs: 500,
              situacao: 'concluida',
            },
          ],
        });
      return json(r, { itens });
    });

    await entrar(page, 'SINT.ADMIN');
    await page.goto('/relatorios/datamart/cargas');
    await expect(page.getByTestId('tela-cargas-datamart')).toBeVisible();
    await expect(page.getByTestId('datamart-ultima')).toContainText('Concluída');
    await page.getByTestId('carga-11-etapas').click();
    await expect(page.getByTestId('tabela-etapas-datamart')).toContainText('fato_internacao');
    await semViolacaoAxe(page, 'cargas do data mart');

    await page.getByTestId('datamart-pedir').click();
    await expect(page.getByTestId('datamart-aviso')).toContainText('Carga pedida');
    await expect(page.getByTestId('carga-12-situacao')).toHaveText('Aguardando início');
    // Com a carga aberta, o botão fica desligado; o servidor recusa o segundo pedido (409) se chegar.
    await expect(page.getByTestId('datamart-pedir')).toBeDisabled();
    expect(pedidos).toBe(1);
  });
});
