// C1-044 (07-FIN linha 99): tipo por perfil no título a receber. Na tela de permissões do financeiro, a operação "Título
// a receber" lista tipos de documento financeiro (fatura, recibo); marcar o primeiro restringe o perfil só nessa operação
// (no título a pagar o perfil segue livre), retirar o último deixa o perfil restrito sem nada e desfazer a restrição é
// um passo explícito. Na emissão do título a receber, o combo do tipo de documento oferece só o que está liberado ao
// perfil do usuário: com o recibo liberado, o título sai com o recibo; a fatura (fora da lista) nem aparece, e a API a
// recusa se vier assim mesmo; sem tipo liberado, a emissão fica travada com o aviso. Fonte sintética (sessão em
// memória). Axe no fim.
import { expect, type Page, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher, rotulosDoCombo } from './combos.js';

const SENHA = 'Sintetico#2026';
const PERFIL = '9302';

async function csrf(page: Page): Promise<string> {
  return (await page.context().cookies()).find((c) => c.name === 'sgh_csrf')?.value ?? '';
}

async function entrar(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

/** Deixa o perfil livre e sem tipo marcado na operação aberta (a memória da sessão sintética guarda entre execuções). */
async function limparOperacao(page: Page, codigos: readonly string[]): Promise<void> {
  for (const c of codigos) {
    const caixa = page.getByTestId(`pfin-tipo-${c}`);
    await expect(caixa).toBeVisible();
    if (await caixa.isChecked()) {
      await caixa.click();
      await expect(caixa).not.toBeChecked();
    }
  }
  if ((await page.getByTestId('pfin-tipos-aviso').textContent())?.includes('Perfil restrito')) {
    await page.getByTestId('pfin-restricao').click();
    await expect(page.getByTestId('pfin-tipos-aviso')).toContainText('Perfil livre');
  }
}

test.describe('financeiro: tipo de documento por perfil no título a receber @C1-044', () => {
  test.setTimeout(180_000);

  test('a lista do título a receber é de tipos de documento e vale só nessa operação; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.FIN.LANCA');
    await page.goto('/financeiro/parametros/permissoes');
    await expect(page.getByTestId('tela-fin-permissoes')).toBeVisible();

    await escolher(page.getByTestId('pfin-perfil'), PERFIL);
    await escolher(page.getByTestId('pfin-operacao'), 'contas_receber');
    const tipos = page.getByTestId('pfin-tipos');
    await expect(tipos.getByRole('columnheader', { name: 'Tipo de documento' })).toBeVisible();
    await limparOperacao(page, ['fatura', 'recibo']);
    const aviso = page.getByTestId('pfin-tipos-aviso');
    await expect(aviso).toContainText('Perfil livre');

    // Marcar o recibo restringe o perfil: a fatura fica de fora.
    const recibo = page.getByTestId('pfin-tipo-recibo');
    await recibo.click();
    await expect(recibo).toBeChecked();
    await expect(aviso).toContainText('Perfil restrito');
    await expect(page.getByTestId('pfin-tipo-fatura')).not.toBeChecked();

    // No título a pagar o mesmo perfil segue com a sua própria lista (tipos de credor).
    await escolher(page.getByTestId('pfin-operacao'), 'contas_pagar');
    await expect(tipos.getByRole('columnheader', { name: 'Tipo de credor' })).toBeVisible();
    await expect(page.getByTestId('pfin-tipo-fatura')).toHaveCount(0);

    // De volta ao título a receber: retirar o último tipo deixa o perfil restrito sem nada; desfazer é explícito.
    await escolher(page.getByTestId('pfin-operacao'), 'contas_receber');
    await expect(recibo).toBeChecked();
    await recibo.click();
    await expect(recibo).not.toBeChecked();
    await expect(aviso).toContainText('Perfil restrito');
    await semViolacaoAxe(page, '/financeiro/parametros/permissoes (título a receber restrito sem tipo)');
    await page.getByTestId('pfin-restricao').click();
    await expect(aviso).toContainText('Perfil livre');
    expect(externas).toEqual([]);
  });

  test('a emissão do título a receber oferece só o tipo liberado; fora da lista é recusado; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.FIN.LANCA');
    await page.goto('/financeiro/parametros/permissoes');
    await escolher(page.getByTestId('pfin-perfil'), PERFIL);
    await escolher(page.getByTestId('pfin-operacao'), 'contas_receber');
    await limparOperacao(page, ['fatura', 'recibo']);
    await page.getByTestId('pfin-tipo-recibo').click();
    await expect(page.getByTestId('pfin-tipos-aviso')).toContainText('Perfil restrito');

    // Na emissão, o combo traz só o recibo (já escolhido) e o aviso do perfil restrito.
    await page.goto('/financeiro/receber/titulos');
    await expect(page.getByTestId('tela-fin-titulos-receber')).toBeVisible();
    const tipo = page.getByTestId('tr-tipo-documento');
    await expect(tipo).toContainText('RECIBO');
    expect(await rotulosDoCombo(tipo)).toEqual(['RECIBO']);
    await expect(page.getByTestId('tr-tipo-documento-aviso')).toContainText(
      'só os tipos de documento listados',
    );

    // A conta da competência do convênio 93 vira título com o recibo.
    await page.getByTestId('tr-c-convenio').fill('93');
    await page.getByTestId('tr-c-mes').fill(String(new Date().getUTCMonth() + 1));
    await page.getByTestId('tr-c-consultar').click();
    await expect(page.getByTestId('tr-contas')).toBeVisible();
    await page.getByTestId('tr-marcar-9393').check();
    await page.getByTestId('tr-c-documento').fill(String(800_000 + (Date.now() % 100_000)));
    await page.getByTestId('tr-gerar-marcadas').click();
    await expect(page.getByTestId('tr-mensagem')).toContainText('Título a receber criado');
    await semViolacaoAxe(page, '/financeiro/receber/titulos (tipo de documento liberado)');

    // A fatura, fora da lista, é recusada pela API mesmo que venha no pedido (e nada grava).
    const r = await page.request.post('/api/financeiro/receber/titulos', {
      headers: {
        'x-csrf': await csrf(page),
        'idempotency-key': `e2e-c1-044-fatura-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      },
      data: {
        contas: [{ conta: 9393, versao: null }],
        vencimento: new Date().toISOString().slice(0, 10),
        documento: 1,
        referente: '',
        tipoDocumento: 9601,
      },
    });
    expect(r.status()).toBe(409);
    expect(await r.text()).toContain('tipo-lancamento-nao-liberado');

    // Sem tipo liberado ao perfil, a emissão trava com o aviso para pedir a liberação.
    await page.goto('/financeiro/parametros/permissoes');
    await escolher(page.getByTestId('pfin-perfil'), PERFIL);
    await escolher(page.getByTestId('pfin-operacao'), 'contas_receber');
    await page.getByTestId('pfin-tipo-recibo').click();
    await expect(page.getByTestId('pfin-tipo-recibo')).not.toBeChecked();
    await page.goto('/financeiro/receber/titulos');
    await expect(page.getByTestId('tr-tipo-documento-aviso')).toContainText('peça a liberação');
    await expect(page.getByTestId('tr-gerar-marcadas')).toBeDisabled();
    await expect(page.getByTestId('tr-gerar-competencia')).toBeDisabled();

    // Desfaz a restrição: o perfil volta a emitir com todos os tipos.
    await page.goto('/financeiro/parametros/permissoes');
    await escolher(page.getByTestId('pfin-perfil'), PERFIL);
    await escolher(page.getByTestId('pfin-operacao'), 'contas_receber');
    await page.getByTestId('pfin-restricao').click();
    await expect(page.getByTestId('pfin-tipos-aviso')).toContainText('Perfil livre');
    expect(externas).toEqual([]);
  });
});
