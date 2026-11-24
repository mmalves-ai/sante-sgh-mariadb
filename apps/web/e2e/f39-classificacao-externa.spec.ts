// F3.9 (08-INTG L140): classificação de risco externa, pelo caminho da tela. O E2E roda com a fonte sintética (sem
// núcleo), então as respostas destas rotas são simuladas com massa SINTÉTICA; o que se prova é a tela: as recebidas do
// atendimento digitado, o botão de aplicar só na vigente, o pedido de aplicação na rota certa e a lista relida depois.
// O efeito no banco (interna gerada, recebida aplicada e ligada, reclassificação sem apagar) está no contrato de efeito
// apps/api/src/modulos/integracao/comunicacao-pacotes-triagem-propria.int.spec.ts.
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

const recebida = (id: number, situacao: string, minutos: number) => ({
  id,
  sistema: 'TRIAGEM-SINT',
  identificadorExterno: `T-${id}`,
  codigoPrioridade: 'AMARELO',
  descricaoPrioridade: 'Urgente',
  cor: 'amarelo',
  tempoAlvoMinutos: 60,
  perfil: null,
  classificadoEm: new Date(Date.UTC(2026, 10, 24, 10, minutos)).toISOString(),
  recebidoEm: new Date(Date.UTC(2026, 10, 24, 10, minutos + 1)).toISOString(),
  prazoAtendimento: new Date(Date.UTC(2026, 10, 24, 11, minutos)).toISOString(),
  situacao,
  motivoRejeicao: situacao === 'rejeitada' ? 'O atendimento não é de pronto atendimento.' : null,
});

test.describe('F3.9 classificação de risco externa @F3.9', () => {
  test('aplica a recebida vigente ao atendimento com um clique e relê a lista', async ({ page }) => {
    let aplicada = false;
    const aplicacoes: string[] = [];
    await page.route('**/api/integracoes/classificacao-externa/perfis', (r) => json(r, { itens: [] }));
    await page.route('**/api/integracoes/classificacao-externa/atendimento/*', (r) =>
      json(r, {
        itens: [recebida(12, aplicada ? 'aplicada' : 'recebida', 30), recebida(11, 'substituida', 10)],
      }),
    );
    await page.route('**/api/integracoes/classificacao-externa/recebidas/*/aplicacao', (r) => {
      aplicacoes.push(`${r.request().method()} ${new URL(r.request().url()).pathname}`);
      aplicada = true;
      return json(r, { id: 12, classificacaoRiscoId: 7001, reclassificou: null }, 201);
    });
    await entrar(page, 'SINT.ADMIN');
    await page.goto('/pa/classificacao-externa');
    await page.getByTestId('classificacao-atendimento').fill('4242');
    const tabela = page.getByTestId('classificacao-recebidas');
    await expect(tabela).toContainText('recebida');
    await expect(page.getByTestId('classificacao-aplicar-11')).toHaveCount(0);
    await semViolacaoAxe(page, 'classificação externa');
    await page.getByTestId('classificacao-aplicar-12').click();
    await expect(page.getByRole('status')).toContainText('Classificação aplicada ao atendimento.');
    expect(aplicacoes).toEqual(['POST /api/integracoes/classificacao-externa/recebidas/12/aplicacao']);
    await expect(page.getByTestId('classificacao-aplicar-12')).toHaveCount(0);
    await expect(tabela).toContainText('aplicada');
  });
});
