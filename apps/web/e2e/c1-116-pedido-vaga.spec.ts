// E2E @C1-116 (02-AGE linha 53): o médico pede, no prontuário, a vaga de exame que ainda não tem horário. Abre a aba
// Pedidos de vaga do paciente, vê o pedido que veio da regulação, escolhe a especialidade e dois procedimentos; o
// procedimento repetido é recusado na hora pela regra do domínio (botão bloqueado); corrige, pede e vê o pedido na
// lista com a situação "Aguardando vaga". A API da lista de espera é simulada (dados SINTÉTICOS) e o corpo do POST é
// conferido. axe sem violação séria.
import { expect, test, type Page } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const PACIENTE = 1001;

async function entrar(page: Page, login: string): Promise<void> {
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

const regulado = {
  id: 501,
  situacao: 'aguardando',
  prioridade: 'normal',
  entradaEm: '2030-03-01T12:00:00.000Z',
  prazoLimite: null,
  especialidade: 'CARDIOLOGIA SINTETICA',
  agenda: null,
  solicitante: null,
  regulacao: 'REG-2030-1',
  observacao: null,
  itens: [],
};

test.describe('Pedido de vaga do médico no prontuário @C1-116 @fase8', () => {
  test.setTimeout(120_000);
  test('pede vaga com a especialidade e os procedimentos, com a regra conferida na hora', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    const pedidos: unknown[] = [regulado];
    let corpo: Record<string, unknown> | null = null;
    await page.route('**/api/agenda/pedidos-vaga/paciente/*', (r) =>
      r.fulfill({
        json: {
          pedidos,
          especialidades: [{ id: 11, nome: 'CARDIOLOGIA SINTETICA' }],
          itens: [
            { id: 21, nome: 'ECOCARDIOGRAMA SINTETICO', tipo: 'exame' },
            { id: 22, nome: 'TESTE ERGOMETRICO SINTETICO', tipo: 'exame' },
          ],
          solicitante: { id: 7, nome: 'MEDICO SINTETICO' },
        },
      }),
    );
    await page.route('**/api/agenda/pedidos-vaga', (r) => {
      corpo = r.request().postDataJSON() as Record<string, unknown>;
      pedidos.unshift({
        ...regulado,
        id: 502,
        prioridade: 'urgente',
        solicitante: 'MEDICO SINTETICO',
        regulacao: null,
        itens: [
          { sequencia: 1, descricao: 'ECOCARDIOGRAMA SINTETICO', quantidade: 1, situacao: 'aguardando' },
          { sequencia: 2, descricao: 'TESTE ERGOMETRICO SINTETICO', quantidade: 1, situacao: 'aguardando' },
        ],
      });
      return r.fulfill({ json: { ok: true, resultado: { id: 502, itens: 2 }, repetida: false } });
    });

    await entrar(page, 'SINT.MEDICO');
    await page.goto(`/pep/paciente/${PACIENTE}/linha-do-tempo`);
    await page.getByTestId('aba-pedidos-vaga').click();
    const aba = page.getByTestId('aba-pedidos-vaga-conteudo');
    await expect(aba).toBeVisible();
    await expect(aba.getByTestId('pedido-vaga-501')).toContainText('REG-2030-1');
    await semViolacaoAxe(page, 'pedidos de vaga');

    const form = aba.getByTestId('pedido-vaga-form');
    await escolher(form.locator('.campo').first(), '11');
    await escolher(form.getByTestId('pedido-vaga-item-0').locator('.campo').first(), '21');
    await form.getByRole('button', { name: 'Incluir procedimento' }).click();
    // O mesmo procedimento duas vezes: a regra do domínio recusa na hora, sem ida ao servidor.
    await escolher(form.getByTestId('pedido-vaga-item-1').locator('.campo').first(), '21');
    await expect(form.getByTestId('pedido-vaga-problemas')).toContainText('duas vezes');
    await expect(form.getByRole('button', { name: 'Pedir vaga' })).toBeDisabled();
    await escolher(form.getByTestId('pedido-vaga-item-1').locator('.campo').first(), '22');
    await expect(form.getByTestId('pedido-vaga-problemas')).toHaveCount(0);
    await escolher(form.locator('.campo').filter({ hasText: 'Prioridade clínica' }), 'urgente');
    await form.getByRole('button', { name: 'Pedir vaga' }).click();

    await expect(aba.getByTestId('pedido-vaga-502')).toContainText('Aguardando vaga');
    await expect(aba.getByTestId('pedido-vaga-502')).toContainText('ECOCARDIOGRAMA SINTETICO');
    expect(corpo).toMatchObject({
      paciente: PACIENTE,
      especialidade: 11,
      prioridade: 'urgente',
      itens: [
        { itemAgendavel: 21, quantidade: 1 },
        { itemAgendavel: 22, quantidade: 1 },
      ],
    });
    expect(externas).toEqual([]);
  });
});
