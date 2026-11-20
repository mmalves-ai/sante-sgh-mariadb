// E2E @W1-08 (enfermagem: estorno da checagem e aprazamento no horário):
//   - checar a dose e estornar com o motivo da lista e a justificativa: o horário volta a checar e o histórico guarda
//     a checagem e o estorno;
//   - a dose com baixa de estoque (morfina sintética): o estorno avisa, oferece a devolução na farmácia e estorna com
//     a devolução pendente;
//   - reaprazar o horário com a hora nova e o motivo;
//   - a ordem de contenção entra no turno da enfermagem (checagens de perfusão e pele).
// axe sem violação séria. Sessão real sobre a fonte sintética e as portas em MEMÓRIA (dados SINTÉTICOS).
import { expect, type Page, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const UTI1 = { atendimento: 25101, pulseira: 'P25001|A25201' };
const UTI2 = { atendimento: 25102, pulseira: 'P25002|A25202' };
const P3 = 25103;

async function entrar(page: Page, login: string): Promise<void> {
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

async function horarioCom(page: Page, texto: string): Promise<number> {
  const linha = page
    .locator('[data-testid^="ph-"][data-estado]')
    .filter({ hasText: texto })
    .filter({ has: page.locator('[data-testid^="ph-checar-"]') })
    .first();
  await expect(linha).toBeVisible();
  return Number((await linha.getAttribute('data-testid'))!.replace('ph-', ''));
}

async function checar(page: Page, id: number, pulseira: string, conferente = false): Promise<void> {
  await page.getByTestId(`ph-checar-${id}`).click();
  await expect(page.getByTestId('form-checagem')).toBeVisible();
  await page.getByTestId('chk-pulseira').fill(pulseira);
  await page.getByTestId('chk-avisos-conferidos').check();
  if (conferente) {
    await page.getByTestId('chk-conferente-login').fill('SINT.ENF.APOIO');
    await page.getByTestId('chk-conferente-senha').fill(SENHA);
  }
  await page.getByTestId('chk-registrar').click();
  await expect(page.getByTestId(`ph-${id}`)).toHaveAttribute('data-estado', 'administrada');
}

async function confirmar(page: Page): Promise<void> {
  const dialogo = page.getByTestId('confirmacao');
  await expect(dialogo).toBeVisible();
  await dialogo.getByRole('button', { name: 'Confirmar' }).click();
}

async function pedirEstorno(page: Page, id: number, motivo: string, justificativa: string): Promise<void> {
  await page.getByTestId(`ph-historico-${id}`).click();
  await expect(page.getByTestId('historico-horario')).toBeVisible();
  await escolher(page.getByTestId('estorno-motivo'), motivo);
  await page.getByTestId('estorno-justificativa').fill(justificativa);
}

test.describe('Estorno da checagem e aprazamento @W1-08 @crud', () => {
  test.setTimeout(180_000);

  test('checar e estornar; dose com baixa de estoque com a devolução pendente; axe', async ({ page }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.ENF.PLANTAO');

    // Checar e estornar (checado por engano): o horário volta a checar.
    await page.goto(`/enfermagem/checagem/${UTI1.atendimento}`);
    await expect(page.getByTestId('painel-paciente')).toBeVisible();
    const dose = await horarioCom(page, 'DIPIRONA');
    await checar(page, dose, UTI1.pulseira);
    await pedirEstorno(page, dose, 'checado-por-engano', 'checado no paciente do leito ao lado');
    await semViolacaoAxe(page, '/enfermagem/checagem (estorno)');
    await page.getByTestId('estornar').click();
    await confirmar(page);
    await expect(page.getByTestId(`ph-${dose}`)).not.toHaveAttribute('data-estado', 'administrada');
    await expect(page.getByTestId(`ph-checar-${dose}`)).toBeVisible();
    // A checagem estornada continua visível no histórico, com o estorno.
    await page.getByTestId(`ph-historico-${dose}`).click();
    await expect(page.getByTestId('historico-horario').locator('li')).not.toHaveCount(0);
    await expect(page.getByTestId('historico-horario')).toContainText(/estorn/i);
    await page.keyboard.press('Escape');

    // Dose com baixa de estoque (morfina, alta vigilância): o aviso, a devolução e o estorno com a pendência.
    await page.goto(`/enfermagem/checagem/${UTI2.atendimento}`);
    const morfina = await horarioCom(page, 'MORFINA');
    await checar(page, morfina, UTI2.pulseira, true);
    await pedirEstorno(page, morfina, 'nao-administrado', 'paciente vomitou antes da administração');
    await page.getByTestId('estornar').click();
    await confirmar(page);
    await expect(page.getByTestId('estorno-estoque-baixado')).toBeVisible();
    await expect(page.getByTestId('estorno-devolver-dose')).toHaveAttribute('href', /\/farmacia\/devolucoes/);
    await expect(page.getByTestId(`ph-${morfina}`)).toHaveAttribute('data-estado', 'administrada');
    await semViolacaoAxe(page, '/enfermagem/checagem (estorno com baixa de estoque)');
    await page.getByTestId('estornar-com-pendencia').click();
    await confirmar(page);
    await expect(page.getByTestId(`ph-${morfina}`)).not.toHaveAttribute('data-estado', 'administrada');
    expect(externas).toEqual([]);
  });

  test('reaprazar com a hora nova e o motivo; a contenção no turno; axe', async ({ page }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.ENF.PLANTAO');

    await page.goto('/enfermagem/aprazamento');
    await expect(page.getByTestId('apr-grade')).toBeVisible();
    const marcar = page.locator('[data-testid^="apr-marcar-"]').first();
    const id = (await marcar.getAttribute('data-testid'))!.replace('apr-marcar-', '');
    await marcar.check();
    await escolher(page.getByTestId(`apr-acao-${id}`), 'reaprazar');
    const hora = page.getByTestId(`apr-hora-${id}`);
    const atual = await hora.inputValue();
    const nova = new Date(`${atual}:00`);
    nova.setHours(nova.getHours() + 1);
    const p2 = (n: number) => String(n).padStart(2, '0');
    await hora.fill(
      `${nova.getFullYear()}-${p2(nova.getMonth() + 1)}-${p2(nova.getDate())}T${p2(nova.getHours())}:${p2(nova.getMinutes())}`,
    );
    await page.getByTestId(`apr-motivo-${id}`).fill('Paciente em exame de imagem');
    await semViolacaoAxe(page, '/enfermagem/aprazamento (reaprazar)');
    await page.getByTestId('apr-confirmar').click();
    await expect(page.getByTestId('apr-mensagem')).toBeVisible();
    await expect(page.getByTestId(`apr-registrado-${id}`)).toContainText('Reaprazar');

    // A ordem de contenção gera as checagens de perfusão e pele no turno.
    await page.goto('/enfermagem/contencao');
    await expect(page.getByTestId('tela-contencao')).toBeVisible();
    await escolher(page.getByTestId('enf-unidade'), 'UTI');
    await page.getByTestId(`ct-prescrever-${P3}`).click();
    await escolher(page.getByTestId('ct-motivo'), { rotulo: /retirada de dispositivo/ });
    await page
      .getByTestId('ct-justificativa')
      .fill('Tentou retirar o cateter duas vezes; contenção verbal sem efeito');
    await page.getByTestId('ct-membro-msd').check();
    await page.getByTestId('ct-prazo').fill('4');
    await page.getByTestId('ct-intervalo').fill('60');
    await page.getByTestId('ct-ordem-confirmar').click();
    await expect(page.getByTestId(`ct-paciente-${P3}`)).toHaveAttribute('data-situacao', 'ativa');
    await page.goto('/enfermagem/turno');
    await escolher(page.getByTestId('enf-unidade'), 'UTI');
    await expect(page.getByTestId('turno-contencoes')).toBeVisible();
    await semViolacaoAxe(page, '/enfermagem/turno (contenção)');
    expect(externas).toEqual([]);
  });
});
