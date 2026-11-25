// E2E @C2-042 (F7, 03-PEP linha 134): protocolos gerenciados com os critérios de entrada avaliados pelo sistema e as
// etapas com meta de tempo, pela tela própria:
//   - a diretoria clínica abre "Protocolos: critérios e metas", escolhe um protocolo com modelo de mercado (sepse, dor
//     torácica ou AVC) e aplica as metas de mercado: as etapas aparecem com a meta em minutos;
//   - a validação é na hora: a faixa invertida do critério e a fórmula com grupo inexistente desligam o botão de gravar;
//   - inclui uma etapa nova com meta e vê a etapa na lista;
//   - o alerta de elegíveis e os protocolos em andamento respondem (avaliação pelo servidor).
// Sessão real sobre a fonte sintética; dados SINTÉTICOS (nada vai à cópia). axe sem violação séria.
import { expect, test, type Page } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';

async function entrar(page: Page, login: string): Promise<void> {
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

test.describe('@C2-042 protocolos gerenciados: critérios e metas', () => {
  test.setTimeout(180_000);

  test('aplica as metas de mercado, valida na hora e inclui etapa', async ({ page }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.DIRETOR.CLINICO');

    const lista = await page.request.get('/api/enfermagem/protocolos-gerenciados');
    expect(lista.status(), await lista.text()).toBe(200);
    const itens = ((await lista.json()) as { itens: { id: number; nome: string; temModelo: boolean }[] })
      .itens;
    const alvo = itens.find((p) => p.temModelo);
    test.skip(!alvo, 'O cliente sintético não tem protocolo de sepse, dor torácica ou AVC cadastrado.');

    await page.goto('/enfermagem/protocolos-criterios');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Protocolos gerenciados');
    await expect(page.getByTestId('pc-avaliar')).toBeVisible();
    await page.getByTestId('pc-avaliar').click();
    await expect(page.getByText(/atendimento\(s\) avaliado\(s\)/)).toBeVisible();

    await escolher(page.getByTestId('pc-protocolo'), { rotulo: new RegExp(alvo!.nome) });
    await page.getByTestId('pc-modelo').click();
    await expect(page.getByTestId('pc-mensagem')).toContainText(/Modelo aplicado|já tinha tudo/);
    await expect(page.getByTestId('pc-etapas-config').getByRole('row').first()).toBeVisible();
    await semViolacaoAxe(page, '/enfermagem/protocolos-criterios (configuração)');

    // Validação na hora: a faixa invertida e a fórmula com grupo inexistente.
    await page.getByTestId('pc-minimo').fill('100');
    await page.getByTestId('pc-maximo').fill('50');
    await expect(page.getByTestId('pc-problema-criterio')).toContainText('menor que o mínimo');
    await expect(page.getByTestId('pc-incluir-criterio')).toBeDisabled();
    await page.getByTestId('pc-formula').fill('grupo_que_nao_existe E');
    await expect(page.getByTestId('pc-problema-formula')).toBeVisible();
    await expect(page.getByTestId('pc-gravar-formula')).toBeDisabled();

    // Etapa nova com meta.
    const nome = `Reavaliação sintética ${Date.now()}`;
    await page.getByTestId('pc-nome-etapa').fill(nome);
    await escolher(page.getByTestId('pc-tipo-etapa'), { rotulo: 'Reavaliação' });
    await page.getByTestId('pc-meta-etapa').fill('120');
    await escolher(page.getByTestId('pc-obrigatoria'), { rotulo: 'Opcional' });
    await page.getByTestId('pc-incluir-etapa').click();
    await expect(page.getByTestId('pc-mensagem')).toContainText('Etapa incluída');
    await expect(page.getByTestId('pc-etapas-config')).toContainText(nome);

    expect(externas).toEqual([]);
  });
});
