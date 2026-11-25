// F3.1 (02-CAD linha 17): procedimentos permitidos por especialidade, pelo caminho da tela.
// As ligações exigem o banco próprio, e o E2E roda com a fonte sintética (sem núcleo). Por isso as respostas da API
// destas rotas são simuladas pelo Playwright com massa SINTÉTICA; o que se prova é a tela: a especialidade escolhida
// pela busca do nome (o id da busca vai às consultas e à gravação, nunca o código digitado), o corpo do pedido de
// inclusão e o procedimento aparecendo na especialidade escolhida. O efeito no banco (vigência, sobreposição recusada,
// encerrar sem apagar, uma ocupação principal) está no contrato de efeito
// (apps/api/src/modulos/cadastro/cadastro-ligacoes.int.spec.ts).
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const ESPECIALIDADE = 501;

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

test.describe('F3.1 ligações da especialidade @F3.1', () => {
  test('inclui um procedimento permitido e ele aparece na especialidade escolhida', async ({ page }) => {
    const pedidos: { caminho: string; corpo: Record<string, unknown> }[] = [];
    const lidas: string[] = [];
    const procedimentos: unknown[] = [];
    await page.route('**/api/cadastros/ligacoes/opcoes**', (r) =>
      json(r, {
        estabelecimentos: [],
        unidades: [],
        tiposVinculo: [],
        ocupacoes: [{ id: 71, codigo: '225125', descricao: 'MEDICO SINTETICO' }],
        procedimentos: [{ id: 81, codigo: '10101012', descricao: 'CONSULTA SINTETICA' }],
        especialidades: [{ id: ESPECIALIDADE, codigo: '99', descricao: 'CARDIOLOGIA SINTETICA' }],
      }),
    );
    await page.route('**/api/cadastros/especialidades/*/ligacoes', (r) => {
      lidas.push(new URL(r.request().url()).pathname);
      return json(r, { hoje: '2026-11-24', procedimentos, ocupacoes: [] });
    });
    await page.route('**/api/cadastros/especialidades/*/procedimentos-permitidos', (r) => {
      const corpo = r.request().postDataJSON() as Record<string, unknown>;
      pedidos.push({ caminho: new URL(r.request().url()).pathname, corpo });
      procedimentos.push({
        id: 901,
        versao: 1,
        procedimento: corpo['procedimento'],
        codigo: '10101012',
        descricao: 'CONSULTA SINTETICA',
        vigenciaInicio: corpo['vigenciaInicio'],
        vigenciaFim: corpo['vigenciaFim'],
        vigente: true,
      });
      return json(r, { id: 901 });
    });

    await entrar(page, 'SINT.ADMIN');
    await page.goto('/cadastros/especialidades');
    await page.getByTestId('busca-especialidade').fill('CARDIO');
    await page.getByTestId(`especialidade-${ESPECIALIDADE}`).click();
    await expect(page.getByTestId('especialidade-escolhida')).toContainText('CARDIOLOGIA SINTETICA');
    await expect(page.getByTestId('ligacoes-especialidade')).toBeVisible();

    await page.getByTestId('lig-esp-termo').fill('CONSULTA');
    await escolher(page.getByTestId('lig-esp-proc'), { rotulo: /10101012 CONSULTA SINTETICA/ });
    await page.getByTestId('lig-esp-gravar-proc').click();

    await expect(page.getByTestId('tabela-procedimentos-permitidos')).toContainText('CONSULTA SINTETICA');
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0]!.caminho).toBe(
      `/api/cadastros/especialidades/${ESPECIALIDADE}/procedimentos-permitidos`,
    );
    expect(pedidos[0]!.corpo).toMatchObject({ procedimento: 81, vigenciaFim: null });
    expect(String(pedidos[0]!.corpo['vigenciaInicio'])).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(new Set(lidas)).toEqual(new Set([`/api/cadastros/especialidades/${ESPECIALIDADE}/ligacoes`]));
    await expect(page.getByTestId('ligacoes-erro')).toHaveCount(0);
    await semViolacaoAxe(page, 'ligações da especialidade');
  });
});
