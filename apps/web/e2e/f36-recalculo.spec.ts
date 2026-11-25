// E2E @F3.6 (05-SUP linha 16): o recálculo auditado do saldo pelo caminho da tela. O recálculo grava só no banco
// próprio, e o E2E roda com a fonte sintética (sem núcleo, a prévia responde 501). Por isso a prévia, a aplicação e a
// lista são simuladas pelo Playwright com massa SINTÉTICA, e a operação aparece ligada para a sessão do administrador.
// O que se prova é a tela: sem campo de mês (o período é o do razão, mostrado na prévia), o motivo validado na hora,
// a prévia com o período de fato refeito, o gravado, o refeito e o porquê de cada pendente, e a aplicação que envia o
// escopo e o motivo e mostra o registro na lista. O efeito no banco (saldo, lotes, histórico do item, registro com
// todas as diferenças, trilha e outbox) está no contrato de efeito
// apps/api/src/modulos/suprimentos/recalculo-saldo.int.spec.ts.
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe } from './ajuda.js';

const SENHA = 'Sintetico#2026';
const OP = 'suprimentos.recalcularSaldos';

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

const diferenca = (saldo: number, extra: Record<string, unknown>) => ({
  saldo,
  local: 1,
  localNome: 'LOCAL SINTETICO',
  insumo: saldo,
  insumoNome: `ITEM SINTETICO ${saldo}`,
  movimentos: 3,
  quantidadeGravada: 99,
  quantidadeRefeita: 15,
  custoGravado: 1,
  custoRefeito: 20,
  diferencaQuantidade: -84,
  diferencaValor: 201,
  negativoNoMovimento: null,
  pendencia: null,
  ...extra,
});

test.describe('recálculo auditado do saldo (05-SUP linha 16) @F3.6 @C1-073', () => {
  test('prévia com o período refeito e os pendentes, aplicação com motivo e registro na lista; axe', async ({
    page,
  }) => {
    const registros: Record<string, unknown>[] = [];
    const pedidos: Record<string, unknown>[] = [];
    await page.route('**/api/suprimentos/gravacao', async (rota) => {
      const r = await rota.fetch();
      const corpo = (await r.json()) as { operacoes: Record<string, unknown> };
      corpo.operacoes[OP] = { ligada: true, motivo: null };
      return json(rota, corpo);
    });
    await page.route('**/api/suprimentos/recalculos**', async (rota) => {
      const req = rota.request();
      if (req.method() === 'GET') return json(rota, { itens: registros });
      const corpo = req.postDataJSON() as Record<string, unknown>;
      pedidos.push(corpo);
      if (new URL(req.url()).pathname.endsWith('/previa'))
        return json(rota, {
          abertura: '08/2026',
          inicio: '09/2026',
          saldos: 4,
          diferencas: [
            diferenca(11, {}),
            diferenca(12, { pendencia: 'razao-negativo', negativoNoMovimento: 2 }),
            diferenca(13, { pendencia: 'lote-divergente' }),
            diferenca(14, { pendencia: 'sem-razao', movimentos: 0 }),
          ],
          diferencaQuantidadeTotal: -84,
          diferencaValorTotal: 201,
          pendentes: 3,
        });
      registros.push({
        id: 1,
        inicio: '2026-11-24T10:00:00',
        fim: '2026-11-24T10:00:01',
        usuario: 'sint.admin',
        tela: null,
        terminado: true,
        competencia: '2026-09 a 2026-11',
        motivo: String(corpo['motivo']),
        insumos: 1,
        diferencaValor: 201,
      });
      return json(rota, { mensagem: 'Recálculo aplicado.', repetida: false, ids: { id: 1 }, avisos: [] });
    });

    // O supervisor do estoque tem suprimentos.recalculo.ler e .executar (fonte sintética); o SINT.ADMIN não tem o módulo.
    await entrar(page, 'SINT.SUPERVISOR.ESTOQUE');
    await page.goto('/suprimentos/recalculos');
    await expect(page.getByTestId('tela-suprimentos-recalculos')).toBeVisible();
    await expect(page.getByTestId('rec-form')).toBeVisible();
    // Sem campo de mês: o período vem do razão.
    await expect(page.getByTestId('rec-mes')).toHaveCount(0);
    await semViolacaoAxe(page, '/suprimentos/recalculos');

    // O motivo curto é recusado na hora e a prévia fica desligada.
    await page.getByTestId('rec-motivo').fill('curto');
    await expect(page.getByTestId('rec-recusas')).toContainText('ao menos 10 caracteres');
    await expect(page.getByTestId('rec-previa')).toBeDisabled();
    await page.getByTestId('rec-motivo').fill('Saldo divergente do razão no teste sintético');
    await expect(page.getByTestId('rec-recusas')).toHaveCount(0);
    await page.getByTestId('rec-previa').click();

    await expect(page.getByTestId('rec-resumo')).toContainText('desde 09/2026');
    await expect(page.getByTestId('rec-resumo')).toContainText('3 pendente(s)');
    const pend = page.getByTestId('rec-pendencia');
    await expect(pend).toHaveCount(3);
    await expect(pend.nth(0)).toContainText('negativo no movimento 2');
    await expect(pend.nth(1)).toContainText('soma dos lotes');
    await expect(pend.nth(2)).toContainText('não é zerado');
    expect(pedidos[0]).toMatchObject({ local: null, insumo: null, recalculaCusto: true });
    expect(pedidos[0]).not.toHaveProperty('ano');

    await page.getByTestId('rec-aplicar').click();
    await expect(page.getByTestId('rec-mensagem')).toContainText('Recálculo aplicado');
    expect(pedidos[1]).toMatchObject({ motivo: 'Saldo divergente do razão no teste sintético' });
    await expect(page.getByTestId('rec-tabela')).toContainText(
      'Saldo divergente do razão no teste sintético',
    );
    await expect(page.getByTestId('rec-tabela')).toContainText('2026-09 a 2026-11');
  });
});
