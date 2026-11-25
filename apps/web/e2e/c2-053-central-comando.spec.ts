// E2E @C2-053 (F8, 01-ADM linha 117): central de comando assistencial, pela tela própria:
//   - a diretoria clínica abre "Central de comando assistencial", inclui um tema e uma regra de risco por permanência
//     (critério que vale para todo paciente em acompanhamento), com a validação na hora (código inválido e critério
//     sem alvo desligam o botão de gravar), e um limite de fluxo de ocupação;
//   - a enfermagem apura os riscos, vê o risco no quadro do paciente, reconhece e resolve com a conduta (curta demais
//     é recusada na hora), inclui uma meta das 24 horas e a marca como cumprida.
// Sessão real sobre a fonte sintética; dados SINTÉTICOS (nada vai à cópia). Combos por e2e/combos.ts. axe sem
// violação séria.
import { expect, test, type Page } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const URL = '/enfermagem/central-comando';

async function entrar(page: Page, login: string): Promise<void> {
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

test.describe('@C2-053 central de comando assistencial', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(180_000);
  const marca = Date.now().toString(36).toUpperCase().slice(-6);
  const codigoRegra = `PERM.${marca}`;

  test('configura tema, regra com critério e limite de fluxo, com validação na hora', async ({ page }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.DIRETOR.CLINICO');
    await page.goto(URL);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Central de comando assistencial');
    await expect(page.getByTestId('cc-apurar')).toBeVisible();

    // Tema novo.
    await page.getByTestId('cc-tema-codigo').fill(`T.${marca}`);
    await page.getByTestId('cc-tema-descricao').fill('Tema sintético de permanência');
    await page.getByTestId('cc-incluir-tema').click();
    await expect(page.getByTestId('cc-temas')).toContainText(`T.${marca}`);

    // Validação na hora: código inválido e critério sem alvo.
    await page.getByTestId('cc-regra-codigo').fill('x');
    await page.getByTestId('cc-regra-nome').fill('Permanência sintética');
    await expect(page.getByTestId('cc-problemas-regra')).toContainText('O código da regra');
    await expect(page.getByTestId('cc-problemas-regra')).toContainText('alvo do seu tipo');
    await expect(page.getByTestId('cc-gravar-regra')).toBeDisabled();

    await page.getByTestId('cc-regra-codigo').fill(codigoRegra);
    await escolher(page.getByTestId('cc-regra-tema'), { rotulo: new RegExp(`T\\.${marca}`) });
    await escolher(page.getByTestId('cc-regra-gravidade'), { rotulo: 'Alta' });
    await escolher(page.getByTestId('cc-criterio-tipo-0'), { rotulo: 'Permanência' });
    await page.getByTestId('cc-criterio-horas-0').fill('0');
    await expect(page.getByTestId('cc-problemas-regra')).toHaveCount(0);
    await page.getByTestId('cc-gravar-regra').click();
    await expect(page.getByTestId('cc-regras')).toContainText(codigoRegra);

    // Limite de fluxo: a atenção acima do crítico é recusada na hora.
    await escolher(page.getByTestId('cc-limite-tipo'), { rotulo: 'Ocupação' });
    await page.getByTestId('cc-limite-atencao').fill('95');
    await page.getByTestId('cc-limite-critico').fill('90');
    await expect(page.getByTestId('cc-problema-limite')).toContainText('abaixo do crítico');
    await expect(page.getByTestId('cc-incluir-limite')).toBeDisabled();
    await page.getByTestId('cc-limite-atencao').fill('80');
    await page.getByTestId('cc-incluir-limite').click();
    await expect(page.getByTestId('cc-mensagem')).toBeVisible();
    await expect(page.getByTestId('cc-alertas')).toContainText('Ocupação');
    await semViolacaoAxe(page, `${URL} (configuração)`);

    expect(externas).toEqual([]);
  });

  test('apura, reconhece e resolve o risco e cumpre a meta das 24 horas', async ({ page }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.ENF.PLANTAO');
    await page.goto(URL);
    await page.getByTestId('cc-apurar').click();
    await expect(page.getByTestId('cc-mensagem')).toContainText('paciente(s) avaliado(s)');

    const semPacientes = await page.getByTestId('cc-sem-pacientes').isVisible();
    test.skip(semPacientes, 'O cliente sintético não tem paciente em acompanhamento.');

    const linha = page.locator('[data-testid^="cc-paciente-"]', { hasText: codigoRegra }).first();
    await expect(linha).toBeVisible();
    await linha.locator('[data-testid^="cc-abrir-"]').click();
    const visao = page.getByTestId('cc-visao');
    await expect(visao).toBeVisible();

    const ocorrencia = visao.locator('[data-testid^="cc-ocorrencia-"]', { hasText: codigoRegra }).first();
    await expect(ocorrencia).toBeVisible();
    await ocorrencia.locator('[data-testid^="cc-reconhecer-"]').click();
    await expect(ocorrencia.locator('[data-testid^="cc-situacao-"]')).toHaveText('Reconhecida');

    // A conduta curta é recusada na hora; a completa resolve.
    await ocorrencia.locator('[data-testid^="cc-conduta-"]').first().fill('curta');
    await expect(ocorrencia.locator('[data-testid^="cc-resolver-"]')).toBeDisabled();
    await ocorrencia
      .locator('[data-testid^="cc-conduta-"]')
      .first()
      .fill('Conduta sintética: reavaliado e plano de alta revisto.');
    await ocorrencia.locator('[data-testid^="cc-resolver-"]').click();
    await expect(ocorrencia.locator('[data-testid^="cc-situacao-"]')).toHaveText('Resolvida');

    // Meta das 24 horas: descrição curta recusada na hora; a válida entra e é cumprida.
    await escolher(page.getByTestId('cc-meta-categoria'), { rotulo: 'Mobilização' });
    await page.getByTestId('cc-meta-descricao').fill('abc');
    await expect(page.getByTestId('cc-problema-meta')).toContainText('pelo menos 5 letras');
    await expect(page.getByTestId('cc-incluir-meta')).toBeDisabled();
    const descricao = `Sentar na poltrona ${marca}`;
    await page.getByTestId('cc-meta-descricao').fill(descricao);
    await page.getByTestId('cc-incluir-meta').click();
    const meta = visao.locator('[data-testid^="cc-meta-"]', { hasText: descricao }).first();
    await expect(meta).toBeVisible();
    await meta.locator('[data-testid^="cc-cumprir-"]').click();
    await expect(meta.locator('[data-testid^="cc-meta-situacao-"]')).toHaveText('Cumprida');
    await semViolacaoAxe(page, `${URL} (visão do paciente)`);

    expect(externas).toEqual([]);
  });
});
