// 06-FAT linha 25: liberação na alçada da OPME acima do limite do procedimento, pela tela `/faturamento/opme-liberacao`.
// A liberação exige o banco próprio, e o E2E roda com a fonte sintética (sem núcleo): as respostas da API desta rota são
// simuladas pelo Playwright com massa SINTÉTICA. O que se prova é a tela: o pedido retido mostra o valor contra o
// limite e a justificativa; quem pediu vê o próprio pedido sem liberar (quatro olhos) e pode cancelar; recusar fica
// travado até o motivo ser escrito (validação na hora); liberar é um clique e o pedido passa a decidido. O efeito no
// banco está no contrato de efeito (apps/api/src/modulos/tiss/opme-guia-propria.int.spec.ts). Tag @C2-057.
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

const pedido = (x: Record<string, unknown>) => ({
  id: 1,
  versao: 1,
  situacao: 'pendente',
  valor: 1600,
  nivelAtual: 1,
  numero: 'SA-SINT-1',
  solicitacao: 11,
  situacaoPedido: 'rascunho',
  paciente: 'Paciente Sintético',
  fonte: 'Operadora Sintética',
  solicitante: 'Faturista Sintético',
  meu: false,
  solicitadoEm: '2026-11-25T10:00:00.000Z',
  motivoConclusao: null,
  limiteValor: 1000,
  limiteQuantidade: null,
  motivos: ['A OPME soma 1600.00, acima do limite de 1000.00 do procedimento nesta fonte pagadora.'],
  justificativa: 'Haste longa exigida pela revisão da prótese',
  decisoes: [],
  ...x,
});

test.describe('liberação de OPME acima do limite @C2-057', () => {
  test('pedido retido: recusa só com motivo, liberação em um clique, pedido próprio só cancela; axe', async ({
    page,
  }) => {
    let liberado = false;
    let corpoDecisao: Record<string, unknown> | null = null;
    await page.route('**/api/tiss/opme-liberacao', (r) =>
      json(r, {
        pedidos: [
          liberado
            ? pedido({
                situacao: 'aprovado',
                versao: 2,
                decisoes: [
                  {
                    nivel: 1,
                    decisao: 'aprovado',
                    justificativa: null,
                    aprovador: 'Gestor Sintético',
                    em: null,
                  },
                ],
              })
            : pedido({}),
          pedido({ id: 2, numero: 'SA-SINT-2', meu: true, valor: 1400 }),
        ],
      }),
    );
    await page.route('**/api/tiss/opme-liberacao/1/decisao', (r) => {
      corpoDecisao = r.request().postDataJSON() as Record<string, unknown>;
      liberado = true;
      return json(r, { id: 1, situacao: 'aprovado', faltam: [] }, 201);
    });
    await page.route('**/api/tiss/opme-liberacao/2/decisao', (r) =>
      json(r, { id: 2, situacao: 'cancelado', faltam: [] }, 201),
    );
    await entrar(page, 'SINT.CONTAS');
    await page.goto('/faturamento/opme-liberacao');
    const card = page.getByTestId('opme-lib-SA-SINT-1');
    await expect(card).toContainText('Haste longa exigida');
    await expect(card.getByTestId('opme-lib-valor')).toContainText('1.600,00');
    await expect(card.getByTestId('opme-lib-valor')).toContainText('1.000,00');
    // Recusar fica travado sem motivo (mesma regra do servidor).
    await expect(page.getByTestId('opme-lib-recusar-SA-SINT-1')).toBeDisabled();
    await page.getByTestId('opme-lib-motivo-SA-SINT-1').fill('Há similar na tabela');
    await expect(page.getByTestId('opme-lib-recusar-SA-SINT-1')).toBeEnabled();
    await page.getByTestId('opme-lib-motivo-SA-SINT-1').fill('');
    // O pedido próprio: aviso dos quatro olhos, sem liberar, só cancelar.
    const meu = page.getByTestId('opme-lib-SA-SINT-2');
    await expect(meu.getByTestId('opme-lib-meu')).toBeVisible();
    await expect(page.getByTestId('opme-lib-aprovar-SA-SINT-2')).toHaveCount(0);
    await expect(page.getByTestId('opme-lib-cancelar-SA-SINT-2')).toBeVisible();
    await semViolacaoAxe(page, '/faturamento/opme-liberacao (liberação de OPME)');
    await page.getByTestId('opme-lib-aprovar-SA-SINT-1').click();
    await expect(page.getByTestId('opme-lib-aviso')).toContainText('Decisão registrada');
    expect(corpoDecisao).toMatchObject({ versao: 1, decisao: 'aprovar' });
    await expect(page.getByTestId('opme-lib-decidido-SA-SINT-1')).toContainText('Liberado');
  });
});
