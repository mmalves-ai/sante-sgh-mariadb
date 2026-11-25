// C1-066 (03-PEP linha 125): pedido de transporte do paciente na alta, na transferência e entre setores. A visão da
// internação (/internacao/:reg/transporte) valida o pedido na hora, com a mesma regra do domínio que a API aplica:
//   - o transporte entre setores pede o setor de destino;
//   - o que sai do hospital pede o estabelecimento ou o endereço;
//   - a previsão no passado é recusada;
//   - o botão só se habilita sem problema.
// A fila do transporte (/internacao/transportes) abre pelo atalho e pelo menu. Axe em cada passo.
// O E2E roda sem banco próprio (fonte sintética), e as rotas do transporte respondem 503. O que fica no banco é provado
// pelo contrato de efeito transporte-paciente-propria.int.spec.ts:
//   - o pedido ligado à internação e à alta;
//   - agendar, saída e chegada;
//   - cancelar com motivo sem apagar;
//   - as recusas.
import { expect, type Page, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
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

/** Data e hora local no formato do campo datetime-local. */
const local = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T${String(
    d.getHours(),
  ).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

test.describe('internação: pedido de transporte do paciente @C1-066', () => {
  test.setTimeout(180_000);

  test('validação na hora do pedido pela internação, atalho para a fila; axe', async ({ page }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.ADMIN');
    await page.goto('/internacao/1/transporte');
    await expect(page.getByTestId('tela-transporte')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Transporte do paciente');
    await semViolacaoAxe(page, '/internacao/1/transporte (abertura)');

    const pedir = page.getByTestId('transporte-pedir');
    const problemas = page.getByTestId('transporte-problemas');
    // Entre setores (o tipo inicial sem a internação carregada): o setor de destino é pedido na hora.
    await expect(problemas).toContainText('Este transporte vai a um setor do hospital: escolha o setor.');
    await expect(pedir).toBeDisabled();

    // Transferência externa: o setor some, e o estabelecimento ou o endereço passa a ser pedido.
    await escolher(page.getByTestId('transporte-tipo'), 'transferencia_externa');
    await expect(page.getByTestId('transporte-destino-setor')).toHaveCount(0);
    await expect(problemas).toContainText('Informe o estabelecimento de destino ou o endereço.');
    await page.getByTestId('transporte-destino-descricao').fill('Hospital de referência sintético');
    await expect(problemas).not.toContainText('estabelecimento de destino');

    // Previsão no passado: recusada na hora; no futuro, o aviso some.
    await page.getByTestId('transporte-previsto').fill(local(new Date(Date.now() - 3 * 3_600_000)));
    await expect(problemas).toContainText('A previsão do transporte não pode estar no passado.');
    await page.getByTestId('transporte-previsto').fill(local(new Date(Date.now() + 3 * 3_600_000)));
    await expect(problemas).not.toContainText('previsão');
    await page.getByTestId('transporte-oxigenio').check();
    await escolher(page.getByTestId('transporte-prioridade'), 'urgente');
    // Sem a internação do banco do cliente (503), o botão continua travado.
    await expect(pedir).toBeDisabled();
    await semViolacaoAxe(page, '/internacao/1/transporte (pedido em preenchimento)');

    // Atalho para a fila do transporte.
    await page.getByTestId('transporte-ir-fila').click();
    await expect(page).toHaveURL(/\/internacao\/transportes$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Transporte de pacientes');
    await expect(page.getByTestId('transporte-form')).toHaveCount(0);
    await semViolacaoAxe(page, '/internacao/transportes (fila)');
    expect(externas).toEqual([]);
  });
});
