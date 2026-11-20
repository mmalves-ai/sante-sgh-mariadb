// E2E @M25 (ficha, seção 10): a linha do tempo do turno; o aprazamento proposto e confirmado (registrado no novo);
// a checagem com a pulseira; a dupla checagem (alta vigilância, segundo profissional com login e senha próprios); o
// não administrado com o motivo; a suspensão vinda da prescrição (o outro sistema suspende entre a leitura e o
// "Registrar": nada é gravado e o conflito fica visível, resolvido pelo enfermeiro); a J9 completa no tablet (rede
// cortada: a checagem fica cifrada no aparelho e vai na volta da rede) e o conflito sem rede, os dois no perfil do
// tablet de 10 polegadas; sinais vitais; passagem de plantão com o
// aceite de quem recebe; axe sem violação séria em cada tela. Sessão real sobre a fonte sintética e a porta em
// MEMÓRIA (pacientes e horários SINTÉTICOS; nada vai à cópia).
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { type BrowserContext, expect, type Page, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const POR_FORA = resolve(import.meta.dirname, '../../../.tmp/e2e-enfermagem-por-fora.json');
// Pacientes e internações sintéticos da porta em memória (porta-memoria.ts).
const UTI1 = { atendimento: 25101, pulseira: 'P25001|A25201' };
const UTI2 = { atendimento: 25102, pulseira: 'P25002|A25202' };
const UTI3 = { atendimento: 25103, pulseira: 'P25003|A25203' };
const ENF4 = { atendimento: 25104, pulseira: 'P25004|A25204' };

async function entrar(page: Page, login: string): Promise<void> {
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

/** O id do primeiro horário a checar com o texto na grade do paciente. */
async function horarioCom(page: Page, texto: string): Promise<number> {
  const linha = page
    .locator('[data-testid^="ph-"][data-estado]')
    .filter({ hasText: texto })
    .filter({ has: page.locator('[data-testid^="ph-checar-"]') })
    .first();
  await expect(linha).toBeVisible();
  return Number((await linha.getAttribute('data-testid'))!.replace('ph-', ''));
}

async function abrirChecagem(page: Page, id: number, pulseira: string): Promise<void> {
  await page.getByTestId(`ph-checar-${id}`).click();
  await expect(page.getByTestId('form-checagem')).toBeVisible();
  await page.getByTestId('chk-pulseira').fill(pulseira);
  await page.getByTestId('chk-avisos-conferidos').check();
}

test.describe('Enfermagem beira-leito @M25', () => {
  test.setTimeout(300_000);
  test.beforeAll(() => rmSync(POR_FORA, { force: true }));
  test.afterAll(() => rmSync(POR_FORA, { force: true }));

  test('turno → aprazamento → checagem com pulseira → não administrado → dupla checagem → suspensão por fora → conflito; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.ENF.PLANTAO');

    // Linha do tempo do turno da UTI sintética.
    await page.goto('/enfermagem/turno');
    await expect(page.getByTestId('tela-turno')).toBeVisible();
    await escolher(page.getByTestId('enf-unidade'), 'UTI');
    await expect(page.getByTestId('turno-resumo')).toBeVisible();
    await expect(page.locator('[data-testid^="horario-"]').first()).toBeVisible();
    await semViolacaoAxe(page, '/enfermagem/turno');

    // Aprazamento: a proposta da grade, confirmada em lote pelo enfermeiro (W1-08: grava no horário, sem aviso).
    await page.goto('/enfermagem/aprazamento');
    await expect(page.getByTestId('apr-grade')).toBeVisible();
    await expect(page.getByTestId('apr-motivo')).toHaveCount(0);
    const primeiro = page.locator('[data-testid^="apr-marcar-"]').first();
    const idApr = (await primeiro.getAttribute('data-testid'))!.replace('apr-marcar-', '');
    await primeiro.check();
    await semViolacaoAxe(page, '/enfermagem/aprazamento');
    await page.getByTestId('apr-confirmar').click();
    await expect(page.getByTestId('apr-mensagem')).toBeVisible();
    await expect(page.getByTestId(`apr-registrado-${idApr}`)).toBeVisible();

    // Checagem em tela com a pulseira lida: administrado.
    await page.goto(`/enfermagem/checagem/${UTI1.atendimento}`);
    await expect(page.getByTestId('painel-paciente')).toBeVisible();
    await semViolacaoAxe(page, '/enfermagem/checagem');
    const dose = await horarioCom(page, 'DIPIRONA');
    await abrirChecagem(page, dose, UTI1.pulseira);
    await semViolacaoAxe(page, '/enfermagem/checagem (formulário)');
    await page.getByTestId('chk-registrar').click();
    await expect(page.getByTestId('chk-mensagem')).toBeVisible();
    await expect(page.getByTestId(`ph-${dose}`)).toHaveAttribute('data-estado', 'administrada');

    // Não administrado com o motivo da lista.
    const outra = await horarioCom(page, 'DIPIRONA');
    await abrirChecagem(page, outra, UTI1.pulseira);
    await page.getByTestId('chk-naoAdministrado').check();
    await expect(page.getByTestId('chk-registrar')).toBeDisabled();
    await escolher(page.getByTestId('chk-motivo'), 'recusa');
    await page.getByTestId('chk-registrar').click();
    await expect(page.getByTestId(`ph-${outra}`)).toHaveAttribute('data-estado', 'naoAdministrada');

    // Histórico do horário checado.
    await page.getByTestId(`ph-historico-${dose}`).click();
    await expect(page.getByTestId('historico-horario')).toContainText('Checado aqui');
    await page.keyboard.press('Escape');

    // Dupla checagem (alta vigilância): o segundo profissional com login e senha próprios.
    await page.goto(`/enfermagem/checagem/${UTI2.atendimento}`);
    const morfina = await horarioCom(page, 'MORFINA');
    await abrirChecagem(page, morfina, UTI2.pulseira);
    await expect(page.getByTestId('chk-dupla')).toBeVisible();
    await expect(page.getByTestId('chk-registrar')).toBeDisabled();
    await page.getByTestId('chk-conferente-login').fill('SINT.ENF.APOIO');
    await page.getByTestId('chk-conferente-senha').fill(SENHA);
    await page.getByTestId('chk-registrar').click();
    await expect(page.getByTestId(`ph-${morfina}`)).toHaveAttribute('data-estado', 'administrada');

    // Suspensão vinda da prescrição: o outro sistema suspende depois da leitura; nada é gravado, o conflito aparece.
    await page.goto(`/enfermagem/checagem/${UTI3.atendimento}`);
    const cef = await horarioCom(page, 'CEFTRIAXONA');
    await abrirChecagem(page, cef, UTI3.pulseira);
    mkdirSync(dirname(POR_FORA), { recursive: true });
    writeFileSync(POR_FORA, JSON.stringify({ suspensos: [cef] }));
    await page.getByTestId('chk-registrar').click();
    await expect(page.getByTestId('recusa-enfermagem').first()).toBeVisible();
    await expect(page.getByTestId(`ph-${cef}`)).toHaveAttribute('data-estado', 'suspensa');
    await page.getByTestId('chk-conflito').click();

    // Conflitos: o enfermeiro resolve (nunca sobrescreve).
    await expect(page.getByTestId('tela-conflitos')).toBeVisible();
    const resolver = page.locator('[data-testid^="conf-resolver-"]').first();
    await expect(resolver).toBeVisible();
    await semViolacaoAxe(page, '/enfermagem/conflitos');
    await resolver.click();
    await escolher(page.getByTestId('conf-resolucao'), 'farmaciaAvisada');
    await page.getByTestId('conf-observacao').fill('Dose devolvida à farmácia.');
    await page.getByTestId('conf-confirmar').click();
    await expect(page.getByTestId('conf-mensagem')).toBeVisible();

    // Sinais vitais: registro na grade e o gráfico.
    await page.goto('/enfermagem/paciente/25001/sinais-vitais');
    await expect(page.getByTestId('sv-form')).toBeVisible();
    await page.getByTestId('sv-fc').fill('82');
    await page.getByTestId('sv-temperatura').fill('36,8');
    await page.getByTestId('sv-registrar').click();
    await expect(page.getByTestId('sv-mensagem')).toBeVisible();
    await expect(page.getByTestId('sv-grade')).toContainText('82');
    await semViolacaoAxe(page, '/enfermagem/paciente/sinais-vitais');
    expect(externas).toEqual([]);
  });

  // Ficha, seção 10 (beira-leito): sem rede e o conflito no perfil do tablet de 10 polegadas (retrato, toque).
  test.describe('perfil tablet de 10 polegadas', () => {
    test.use({ viewport: { width: 800, height: 1280 }, hasTouch: true, isMobile: true });

    test('J9: a beira do leito sem rede guarda a checagem e envia na volta da rede', async ({
      page,
      context,
    }) => {
      await entrar(page, 'SINT.ENF.PLANTAO');
      await page.goto('/beira-leito/checagem');
      await expect(page.getByTestId('tela-beira-leito')).toBeVisible();
      await page.getByTestId('beira-codigo').fill(ENF4.pulseira);
      await page.getByTestId('beira-ler').click();
      await expect(page.getByTestId('beira-paciente')).toBeVisible();
      await expect(page.getByTestId('painel-paciente')).toBeVisible();
      await semViolacaoAxe(page, '/beira-leito/checagem');
      const omeprazol = await horarioCom(page, 'OMEPRAZOL');

      // A rede cai no meio do plantão: a checagem vai cifrada para a fila do aparelho.
      await (context as BrowserContext).setOffline(true);
      await expect(page.getByTestId('sem-rede')).toBeVisible();
      await page.getByTestId(`ph-checar-${omeprazol}`).click();
      await page.getByTestId('chk-avisos-conferidos').check();
      await page.getByTestId('chk-registrar').click();
      await expect(page.getByTestId('chk-mensagem')).toContainText('Sem rede');
      await expect(page.getByTestId('pendentes-aparelho')).toBeVisible();

      // A rede volta: a fila vai na ordem, com a chave de cada ato, e o horário aparece checado.
      await (context as BrowserContext).setOffline(false);
      await expect(page.getByTestId('resultado-sincronizacao')).toBeVisible({ timeout: 60_000 });
      await expect(page.getByTestId('pendentes-aparelho')).toHaveCount(0);
      await expect(page.getByTestId(`ph-${omeprazol}`)).toHaveAttribute('data-estado', 'administrada');
    });

    test('conflito no tablet: a prescrição é suspensa enquanto o aparelho está sem rede; nada é sobrescrito', async ({
      page,
      context,
    }) => {
      await entrar(page, 'SINT.ENF.PLANTAO');
      await page.goto('/beira-leito/checagem');
      await expect(page.getByTestId('tela-beira-leito')).toBeVisible();
      await page.getByTestId('beira-codigo').fill(UTI3.pulseira);
      await page.getByTestId('beira-ler').click();
      await expect(page.getByTestId('painel-paciente')).toBeVisible();
      const cef = await horarioCom(page, 'CEFTRIAXONA');

      await (context as BrowserContext).setOffline(true);
      await expect(page.getByTestId('sem-rede')).toBeVisible();
      await page.getByTestId(`ph-checar-${cef}`).click();
      await page.getByTestId('chk-avisos-conferidos').check();
      await page.getByTestId('chk-registrar').click();
      await expect(page.getByTestId('pendentes-aparelho')).toBeVisible();

      // O outro sistema suspende a prescrição enquanto o tablet está sem rede.
      const lerPorFora = (): { suspensos?: number[] } => {
        try {
          return JSON.parse(readFileSync(POR_FORA, 'utf8')) as { suspensos?: number[] };
        } catch {
          return {};
        }
      };
      const antes = lerPorFora();
      mkdirSync(dirname(POR_FORA), { recursive: true });
      writeFileSync(POR_FORA, JSON.stringify({ ...antes, suspensos: [...(antes.suspensos ?? []), cef] }));

      await (context as BrowserContext).setOffline(false);
      await expect(page.getByTestId('resultado-sincronizacao')).toBeVisible({ timeout: 60_000 });
      await expect(page.getByTestId('resultado-sincronizacao').getByRole('link')).toBeVisible();
      await expect(page.getByTestId(`ph-${cef}`)).toHaveAttribute('data-estado', 'suspensa');
    });
  });

  test('passagem de plantão com o aceite de quem recebe', async ({ page, browser }) => {
    await entrar(page, 'SINT.ENF.PLANTAO');
    await page.goto('/enfermagem/plantao');
    await expect(page.getByTestId('tela-plantao')).toBeVisible();
    await escolher(page.getByTestId('enf-unidade'), 'UTI');
    await expect(page.getByTestId(`pl-paciente-${UTI1.atendimento}`)).toBeVisible();
    await page.getByTestId(`sbar-${UTI1.atendimento}-situacao`).fill('Estável, sem queixas.');
    await page.getByTestId(`sbar-${UTI1.atendimento}-recomendacao`).fill('Reavaliar a dor às 16h.');
    await page.getByTestId('pl-recebedor').fill('SINT.ENF.APOIO');
    await semViolacaoAxe(page, '/enfermagem/plantao');
    await page.getByTestId('pl-passar').click();
    await expect(page.getByTestId('pl-mensagem')).toBeVisible();
    await expect(page.locator('[data-situacao="aguardandoAceite"]').first()).toBeVisible();

    // Quem recebe aceita, na sessão dele: a responsabilidade passa.
    const outro = await browser.newContext();
    const p2 = await outro.newPage();
    await entrar(p2, 'SINT.ENF.APOIO');
    await p2.goto('/enfermagem/plantao');
    await escolher(p2.getByTestId('enf-unidade'), 'UTI');
    const aceitar = p2.locator('[data-testid^="pl-aceitar-"]').first();
    await expect(aceitar).toBeVisible();
    await aceitar.click();
    await expect(p2.getByTestId('pl-mensagem')).toContainText('aceito');
    await expect(p2.locator('[data-situacao="aceita"]').first()).toBeVisible();
    await outro.close();
  });
});
