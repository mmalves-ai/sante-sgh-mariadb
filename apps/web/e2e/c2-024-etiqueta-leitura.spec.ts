// E2E @C2-024 (F3.6, 05-SUP linha 14): etiqueta de identificação do estoque e leitura do código, pelo caminho da tela.
// O almoxarife abre "Etiquetas de identificação", lê o código da embalagem (o item vem preenchido), vê a conferência na
// hora (item rastreável sem lote não emite), escolhe o lote e emite 2 etiquetas: a tabela mostra o identificador e o
// conteúdo legível e o arquivo da impressora vem pronto. A leitura de uma etiqueta já consumida aparece recusada na
// hora, e a leitura de lote vencido mostra o alerta.
// A etiqueta grava só no banco próprio, que a fonte sintética do E2E não tem: as respostas de `/api/suprimentos/leitura`,
// `/api/suprimentos/etiquetas` e `/api/suprimentos/lotes` são simuladas pelo Playwright com massa SINTÉTICA no mesmo
// formato do servidor. A regra está em packages/dominio-suprimentos/src/identificacao-estoque-emissao.spec.ts e o que
// fica no banco em apps/api/src/modulos/suprimentos/etiqueta-identificacao.int.spec.ts.
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
  rota.fulfill({
    status,
    contentType: status >= 400 ? 'application/problem+json' : 'application/json',
    body: JSON.stringify(corpo),
  });

const ITEM = {
  codigo: 9101,
  nome: 'SORO SINTETICO 500 ML',
  unidade: 'FR',
  rastreavel: true,
  controlado: false,
  antimicrobiano: false,
  consignado: false,
  ativo: true,
};
const leitura = (over: Record<string, unknown>) => ({
  item: ITEM,
  quantidade: 1,
  lote: null,
  loteId: null,
  validade: null,
  identificador: null,
  origem: 'codigo-item',
  padrao: null,
  alertas: [],
  ...over,
});

test.describe('@C2-024 etiqueta de identificação e leitura do código', () => {
  test('lê a embalagem, confere na hora, emite as etiquetas e recusa a etiqueta consumida', async ({
    page,
  }) => {
    await entrar(page, 'SINT.ALMOXARIFE');
    await page.route(/\/api\/suprimentos\/leitura\?codigo=/, (rota) => {
      const codigo = new URL(rota.request().url()).searchParams.get('codigo') ?? '';
      if (codigo === 'E0000016')
        return json(
          rota,
          {
            type: 'about:blank',
            title: 'Recusado',
            status: 422,
            codigo: 'etiqueta-inativa',
            detail: 'Etiqueta consumida: não pode ser movimentada de novo.',
          },
          422,
        );
      if (codigo === 'VENCIDO')
        return json(rota, leitura({ lote: 'SINTLV', validade: '2020-01-31', alertas: ['vencido'] }));
      return json(rota, leitura({ quantidade: 1 }));
    });
    await page.route(/\/api\/suprimentos\/lotes\?/, (rota) =>
      json(rota, [
        {
          id: 71,
          lote: 'SINTL1',
          validade: '2027-03-31',
          quantidade: 40,
          diasParaVencer: 490,
          alerta: 'nenhum',
        },
      ]),
    );
    let corpo: Record<string, unknown> | null = null;
    await page.route(/\/api\/suprimentos\/etiquetas$/, (rota) => {
      corpo = rota.request().postDataJSON() as Record<string, unknown>;
      return json(
        rota,
        {
          id: 1,
          etiquetas: [
            {
              id: 1,
              identificador: 'E0000016',
              datamatrix: '',
              barras: 'E0000016',
              legivel: '(10)SINTL1(21)E0000016',
            },
            {
              id: 2,
              identificador: 'E000002X',
              datamatrix: '',
              barras: 'E000002X',
              legivel: '(10)SINTL1(21)E000002X',
            },
          ],
          zpl: '^XA^FDE0000016^FS^XZ^XA^FDE000002X^FS^XZ',
        },
        201,
      );
    });

    await page.goto('/suprimentos/etiquetas');
    await expect(page.getByTestId('tela-suprimentos-etiquetas')).toBeVisible();
    await page.getByTestId('etq-leitura-codigo').fill('07891234567895');
    await page.getByTestId('etq-leitura-codigo').press('Enter');
    await expect(page.getByTestId('etq-item')).toContainText('SORO SINTETICO 500 ML');
    // Rastreável sem lote: a conferência na hora trava a emissão.
    await expect(page.getByTestId('etq-problema').first()).toBeVisible();
    await expect(page.getByTestId('etq-emitir')).toBeDisabled();
    await escolher(page.getByTestId('etq-local'), { indice: 1 });
    await escolher(page.getByTestId('etq-lote'), { rotulo: /SINTL1/ });
    await page.getByTestId('etq-etiquetas').fill('2');
    await expect(page.getByTestId('etq-emitir')).toBeEnabled();
    await page.getByTestId('etq-emitir').click();
    await expect(page.getByTestId('etq-emitidas')).toContainText('E0000016');
    await expect(page.getByTestId('etq-emitidas')).toContainText('E000002X');
    await expect(page.getByTestId('etq-zpl')).toContainText('^XA');
    expect(corpo).toMatchObject({ insumo: 9101, lote: 71, etiquetas: 2, tipo: 'unidade' });

    // A etiqueta consumida é recusada na leitura; o lote vencido mostra o alerta.
    await page.getByTestId('etq-leitura-codigo').fill('E0000016');
    await page.getByTestId('etq-leitura-codigo').press('Enter');
    await expect(page.getByText('Etiqueta consumida')).toBeVisible();
    await page.getByTestId('etq-leitura-codigo').fill('VENCIDO');
    await page.getByTestId('etq-leitura-codigo').press('Enter');
    await expect(page.getByTestId('etq-leitura-alerta-vencido')).toBeVisible();
    await semViolacaoAxe(page, '/suprimentos/etiquetas');
  });
});
