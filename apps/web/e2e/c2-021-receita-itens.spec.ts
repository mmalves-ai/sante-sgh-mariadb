// E2E @C2-021 (03-PEP linha 121): receituário com os medicamentos estruturados. O médico busca o medicamento no
// catálogo pela lista sugerida; a tela marca a classe do produto (controlado, antimicrobiano) e confere o receituário na
// hora com a regra do domínio (conferirItensDoTipo): antimicrobiano nunca sai na receita simples (RDC 471/2021) e
// controlado só no controle especial (Portaria 344/98); no antimicrobiano a quantidade começa pelo número e a duração é
// obrigatória. A receita de antimicrobiano com 2 itens é emitida e sai em 2 vias. axe sem violação séria.
// Sessão real sobre a fonte sintética e as portas em MEMÓRIA (dados SINTÉTICOS): a busca do catálogo é simulada pela rota
// interceptada, porque a fonte sintética não traz a classe do produto; a gravação em receita_medica_item e as 2 vias do
// documento estão provadas no contrato de efeito documentos-propria-operacoes.int.spec.ts.
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

const CATALOGO = [
  { nome: 'AMOXICILINA SINTETICA 500 MG', controlado: false, antimicrobiano: true },
  { nome: 'AZITROMICINA SINTETICA 500 MG', controlado: false, antimicrobiano: true },
  { nome: 'CLONAZEPAM SINTETICO 2 MG', controlado: true, antimicrobiano: false },
];

/** Busca sintética do catálogo: devolve os produtos cujo nome contém o termo. */
async function simularCatalogo(page: Page): Promise<void> {
  await page.route('**/api/pep/prescricao/produtos?*', async (r: Route) => {
    const termo = (new URL(r.request().url()).searchParams.get('termo') ?? '').toUpperCase();
    const achados = CATALOGO.filter((p) => p.nome.includes(termo)).map((p, i) => ({
      produto: 9100 + i,
      nome: p.nome,
      unidade: 'CP',
      padronizado: true,
      principiosAtivos: [],
      altoAlerta: false,
      controlado: p.controlado,
      antimicrobiano: p.antimicrobiano,
      doseMinima: null,
      doseMaxima: null,
    }));
    await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(achados) });
  });
}

async function abrirReceitas(page: Page): Promise<void> {
  await page.goto('/pep/paciente/1001/linha-do-tempo');
  await expect(page.getByTestId('tela-prontuario-paciente')).toBeVisible();
  await page.getByTestId('aba-receitas').click();
  await expect(page.getByTestId('form-receita')).toBeVisible();
}

/** Escolhe o medicamento do catálogo pela lista sugerida (digita o termo e depois o nome exato da sugestão). */
async function escolherMedicamento(page: Page, i: number, termo: string, nome: string): Promise<void> {
  const campo = page.getByTestId(`receita-medicamento-${i}`);
  await campo.fill(termo);
  await expect(page.locator(`#receita-sugestoes-${i} option[value="${nome}"]`)).toHaveCount(1);
  await campo.fill(nome);
}

test.describe('Receituário com itens estruturados @C2-021 @F3.3', () => {
  test('antimicrobiano na receita simples é recusado na hora e a tela sugere o receituário certo', async ({
    page,
  }) => {
    await entrar(page, 'SINT.MEDICO');
    await simularCatalogo(page);
    await abrirReceitas(page);
    await escolher(page.getByTestId('receita-tipo'), { rotulo: /Receita simples/ });
    await escolherMedicamento(page, 0, 'AMOXI', 'AMOXICILINA SINTETICA 500 MG');
    await page.getByTestId('receita-posologia-0').fill('1 cápsula de 8 em 8 horas');
    await page.getByTestId('receita-quantidade-0').fill('21 cápsulas');
    await expect(page.getByTestId('receita-problema-0')).toContainText('RDC 471/2021');
    await expect(page.getByTestId('emitir-receita')).toBeDisabled();
    await expect(page.getByTestId('receita-tipo-sugerido')).toContainText('antimicrobiano');
    // A faixa do paciente fica fixa no alto: com a tela rolada ela cobre o botão do receituário sugerido (axe
    // target-size). Volta ao topo, como o leitor vê a sugestão logo abaixo do tipo.
    await page.evaluate(() => {
      window.scrollTo(0, 0);
      document.getElementById('conteudo')?.scrollTo(0, 0);
    });
    await semViolacaoAxe(page, '/pep/paciente/1001 receitas (antimicrobiano na simples)');
    await page.getByTestId('receita-usar-tipo').click();
    // No antimicrobiano a duração é obrigatória: sem ela o envio segue travado.
    await expect(page.getByTestId('receita-problema-0')).toContainText('duração');
    await expect(page.getByTestId('emitir-receita')).toBeDisabled();
  });

  test('controlado fora do controle especial é recusado (Portaria 344/98)', async ({ page }) => {
    await entrar(page, 'SINT.MEDICO');
    await simularCatalogo(page);
    await abrirReceitas(page);
    await escolher(page.getByTestId('receita-tipo'), { rotulo: /antimicrobiano/ });
    await escolherMedicamento(page, 0, 'CLONA', 'CLONAZEPAM SINTETICO 2 MG');
    await expect(page.getByTestId('receita-problema-0')).toContainText('Portaria 344/98');
    await expect(page.getByTestId('receita-tipo-sugerido')).toContainText('controle especial');
    await page.getByTestId('receita-usar-tipo').click();
    await page.getByTestId('receita-posologia-0').fill('1 comprimido à noite');
    await page.getByTestId('receita-quantidade-0').fill('30 comprimidos');
    await expect(page.getByTestId('receita-problema-0')).toHaveCount(0);
    await expect(page.getByTestId('emitir-receita')).toBeEnabled();
  });

  test('receita de antimicrobiano com 2 itens, quantidade e duração: emitida com os itens estruturados', async ({
    page,
  }) => {
    await entrar(page, 'SINT.MEDICO');
    await simularCatalogo(page);
    const corpos: unknown[] = [];
    page.on('request', (r) => {
      if (r.method() === 'POST' && /\/receitas$/.test(new URL(r.url()).pathname))
        corpos.push(r.postDataJSON());
    });
    await abrirReceitas(page);
    await escolher(page.getByTestId('receita-tipo'), { rotulo: /antimicrobiano/ });
    await escolherMedicamento(page, 0, 'AMOXI', 'AMOXICILINA SINTETICA 500 MG');
    await page.getByTestId('receita-posologia-0').fill('1 cápsula de 8 em 8 horas');
    await page.getByTestId('receita-quantidade-0').fill('21 cápsulas');
    await page.locator('[data-testid="form-receita"] fieldset').nth(0).getByLabel('Duração').fill('7 dias');
    await page.getByRole('button', { name: 'Mais um medicamento' }).click();
    await escolherMedicamento(page, 1, 'AZITRO', 'AZITROMICINA SINTETICA 500 MG');
    await page.getByTestId('receita-posologia-1').fill('1 comprimido ao dia');
    await page.getByTestId('receita-quantidade-1').fill('3 comprimidos');
    await page.locator('[data-testid="form-receita"] fieldset').nth(1).getByLabel('Duração').fill('3 dias');
    await expect(page.locator('[data-testid^="receita-problema-"]')).toHaveCount(0);
    await page.getByTestId('emitir-receita').click();
    await expect(page.getByTestId('aba-receitas-conteudo')).toContainText('Receita emitida.');
    expect(corpos.at(-1)).toMatchObject({
      tipo: 'antimicrobiano',
      itens: [
        { medicamento: 'AMOXICILINA SINTETICA 500 MG', quantidade: '21 cápsulas', duracao: '7 dias' },
        { medicamento: 'AZITROMICINA SINTETICA 500 MG', quantidade: '3 comprimidos', duracao: '3 dias' },
      ],
    });
    await expect(page.getByTestId('tabela-receita')).toContainText('antimicrobiano');
    await semViolacaoAxe(page, '/pep/paciente/1001 receitas (antimicrobiano emitida)');
  });
});
