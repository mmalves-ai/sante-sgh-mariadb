// E2E @F3.5-02 (F3.5, 05-SADT linha 4): a cobrança do exame pedido pelo caminho da tela /sadt/pedido. A visão por
// paciente mostra, em cada exame, se ele já está na conta ou se a cobrança ficou pendente; os pendentes são lançados
// de uma vez, sem redigitar o pedido, e o cancelamento com motivo que tira da conta avisa do estorno. As rotas do
// pedido exigem o banco próprio e o E2E roda com a fonte sintética (sem núcleo): as respostas são simuladas pelo
// Playwright com massa SINTÉTICA. O efeito no banco (item da conta com a memória, exame marcado, totais refeitos,
// estorno sem apagar, recusa em conta fechada) está em apps/api/src/modulos/sadt/aplicacao/pedido-conta.int.spec.ts.
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

const ATENDIMENTO = {
  id: 900,
  numero: 'AT-900',
  paciente: 800,
  nome: 'PACIENTE SINTETICO',
  prontuario: 'P-800',
  sexo: 'feminino',
  nascimento: '1990-01-01',
  idadeAnos: 36,
};

test.describe('Cobrança do exame pedido @F3.5-02', () => {
  test.setTimeout(180_000);
  test('exame na conta ou pendente à vista; lançar os pendentes de uma vez; cancelar avisa do estorno; axe', async ({
    page,
  }) => {
    const gravacoes: string[] = [];
    // O exame liberado ficou sem cobrança (sem preço na data do pedido); o solicitado já está na conta.
    let cobranca701 = 'pendente';
    let situacao702 = 'solicitado';
    await page.route('**/api/sadt/kits**', (rota) => json(rota, { itens: [] }));
    await page.route('**/api/sadt/itens/**', (rota) => {
      const caminho = new URL(rota.request().url()).pathname;
      if (rota.request().method() !== 'POST') return json(rota, { itens: [] });
      gravacoes.push(caminho);
      situacao702 = 'cancelado';
      return json(rota, { id: 702, requisicaoCancelada: false, conta: 'estornado' });
    });
    await page.route('**/api/sadt/pedidos/**', (rota) => {
      const req = rota.request();
      const caminho = new URL(req.url()).pathname.replace(/^\/api\/sadt\/pedidos\//, '');
      if (caminho === 'motivos')
        return json(rota, {
          setores: [{ id: 601, nome: 'LABORATORIO SINTETICO' }],
          cancelamento: [{ id: 41, descricao: 'PEDIDO EM DUPLICIDADE SINTETICO', exigeComplemento: false }],
          recoleta: [],
        });
      if (caminho === 'atendimentos') return json(rota, { itens: [ATENDIMENTO] });
      if (caminho === 'atendimentos/900/conta' && req.method() === 'POST') {
        gravacoes.push(caminho);
        cobranca701 = 'na_conta';
        return json(rota, {
          conta: 77,
          itens: [
            { item: 701, exame: 'POTASSIO SINTETICO', contaItem: 9001, pendencia: null, mensagem: null },
          ],
        });
      }
      if (caminho === 'atendimentos/900')
        return json(rota, {
          atendimento: { ...ATENDIMENTO, estabelecimento: 'HOSPITAL SINTETICO' },
          podeAutorizarExcecao: false,
          requisicoes: [
            {
              id: 500,
              numero: 'RQ-500',
              situacao: 'solicitada',
              prioridade: 'rotina',
              solicitadaEm: '2026-03-15T12:00:00.000Z',
              itens: [
                {
                  id: 701,
                  sequencia: 1,
                  exame: 'POTASSIO SINTETICO',
                  situacao: 'liberado',
                  coletaPendente: false,
                  cobranca: cobranca701,
                },
                {
                  id: 702,
                  sequencia: 2,
                  exame: 'SODIO SINTETICO',
                  situacao: situacao702,
                  coletaPendente: false,
                  cobranca: situacao702 === 'cancelado' ? 'nao_se_aplica' : 'na_conta',
                },
              ],
            },
          ],
        });
      return json(rota, { title: 'Não encontrado', status: 404 }, 404);
    });

    await entrar(page, 'SINT.BIOMEDICO');
    await page.goto('/sadt/pedido');
    await expect(page.getByTestId('pedido-exames')).toBeVisible();
    await page.getByTestId('pedido-busca').fill('SINTETICO');
    await page.getByTestId('pedido-buscar').click();
    await page.getByTestId('pedido-escolher-900').click();
    await expect(page.getByTestId('pedido-cabecalho')).toBeVisible();

    // A cobrança de cada exame à vista, na visão do paciente.
    await expect(page.getByTestId('pedido-cobranca-701')).toContainText('Cobrança pendente');
    await expect(page.getByTestId('pedido-cobranca-702')).toContainText('Na conta');
    await expect(page.locator('[data-testid="pedido-anteriores"] select')).toHaveCount(0);

    // Os pendentes vão para a conta de uma vez, sem redigitar o pedido.
    await page.getByTestId('pedido-lancar-pendentes').click();
    await expect(page.getByTestId('pedido-mensagem')).toContainText('1 exame(s) lançado(s) na conta');
    await expect(page.getByTestId('pedido-cobranca-701')).toContainText('Na conta');
    await expect(page.getByTestId('pedido-lancar-pendentes')).toHaveCount(0);
    expect(gravacoes).toEqual(['atendimentos/900/conta']);
    await semViolacaoAxe(page, '/sadt/pedido (cobrança)');

    // O cancelamento com o motivo do cadastro diz o que aconteceu com a cobrança.
    await escolher(page.getByTestId('pedido-item-702'), { rotulo: 'PEDIDO EM DUPLICIDADE SINTETICO' });
    await page.getByTestId('pedido-cancelar-702').click();
    await expect(page.getByTestId('pedido-mensagem')).toContainText('cobrança estornada da conta');
    await expect(page.getByTestId('pedido-cobranca-702')).toHaveCount(0);
    expect(gravacoes).toEqual(['atendimentos/900/conta', '/api/sadt/itens/702/cancelar']);
  });
});
