// E2E @C1-121 (02-AGE 48): lista de espera com prioridade legal. (1) espera-prioridade-legal: a inclusão com o grupo
// legal (gestante) põe o pedido à frente de quem entrou antes sem prioridade, com o grupo na coluna de prioridade.
// (2) espera-motivo-oferta: a oferta da vaga a quem tem pedido à frente recusa sem motivo, recusa a vaga de outra
// agenda, aceita com o motivo e mostra o motivo na linha e no histórico do pedido. Sessão real sobre a fonte sintética de dev e a porta da agenda em MEMÓRIA (agendas
// e pacientes SINTÉTICOS; nada vai à cópia).
import { expect, test, type Locator, type Page } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const FERIADOS = ['01-01', '04-21', '09-07', '11-02', '11-15', '12-25'];

/** Próximo dia útil a partir de depois de amanhã (relógio de São Paulo), fora dos feriados fixos. */
function diaUtil(): string {
  const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  const d = new Date(`${hoje}T12:00:00Z`);
  for (let i = 2; i < 20; i++) {
    const x = new Date(d.getTime() + i * 86_400_000);
    const iso = x.toISOString().slice(0, 10);
    const sem = x.getUTCDay();
    if (sem !== 0 && sem !== 6 && !FERIADOS.includes(iso.slice(5))) return iso;
  }
  throw new Error('sem dia útil');
}

async function entrar(page: Page): Promise<void> {
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill('SINT.AGENDA');
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

/**
 * Inclui o paciente sintético na fila da agenda, com o grupo legal escolhido ('' = pelo cadastro e pela idade), e
 * devolve o id do pedido gravado (a lista mostra o nome mascarado, então a linha é achada pelo id).
 */
async function incluir(
  page: Page,
  termo: string,
  paciente: number,
  agenda: string,
  grupo: string,
): Promise<number> {
  const regiao = page.getByRole('region', { name: 'Incluir na fila' });
  await page.getByTestId('espera-termo').fill(termo);
  await page.getByTestId('espera-termo').press('Enter');
  await page.getByTestId(`espera-paciente-${paciente}`).click();
  await escolher(regiao.getByLabel('Agenda'), agenda);
  await escolher(page.getByTestId('espera-urgencia'), 'normal');
  await escolher(page.getByTestId('espera-prioridade-legal'), grupo);
  const resposta = page.waitForResponse(
    (r) => r.request().method() === 'POST' && /\/api\/agenda\/espera$/.test(new URL(r.url()).pathname),
  );
  await page.getByTestId('botao-incluir-espera').click();
  const corpo = (await (await resposta).json()) as { resultado?: { espera?: unknown } };
  await expect(page.getByTestId('espera-mensagem')).toContainText('Incluído na fila');
  const id = Number(corpo.resultado?.espera);
  expect(id).toBeGreaterThan(0);
  return id;
}

/** A linha do pedido na lista, pelo id gravado, conferindo que é da agenda esperada. */
const linha = (page: Page, id: number, agenda: string): Locator =>
  page.getByTestId('tabela-espera').getByTestId(`espera-${id}`).filter({ hasText: agenda });

test.describe('Lista de espera com prioridade legal @C1-121 @fase3', () => {
  test.setTimeout(120_000);

  test('espera-prioridade-legal: o grupo legal passa à frente de quem entrou antes; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page);
    await page.goto('/agenda/espera');
    await expect(page.getByTestId('tela-espera')).toBeVisible();
    await semViolacaoAxe(page, '/agenda/espera');

    // Entra primeiro sem prioridade; depois, a gestante (grupo 3).
    const primeiro = await incluir(page, 'cinthya', 1003, '903', '');
    const depois = await incluir(page, 'silva', 1001, '903', '3');

    const gestante = linha(page, depois, 'ORTOPEDIA');
    const semPrioridade = linha(page, primeiro, 'ORTOPEDIA');
    await expect(gestante.locator('td').nth(0)).toHaveText('1');
    await expect(gestante.locator('td').nth(3)).toContainText('Preferencial');
    await expect(gestante.locator('td').nth(3)).toContainText('Gestante');
    await expect(semPrioridade.locator('td').nth(0)).toHaveText('2');
    await expect(semPrioridade.locator('td').nth(3)).toContainText('Normal');
    await semViolacaoAxe(page, 'fila com prioridade legal');
    expect(externas).toEqual([]);
  });

  test('espera-motivo-oferta: fora da ordem só com motivo; vaga de outra agenda recusada; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    const dia = diaUtil();
    await entrar(page);
    await page.goto('/agenda/espera');
    await expect(page.getByTestId('tela-espera')).toBeVisible();

    await incluir(page, 'cinthya', 1003, '904', '');
    const idSegundo = await incluir(page, 'silva', 1002, '904', '');
    const segundo = linha(page, idSegundo, 'PEDIATRIA');
    await expect(segundo.locator('td').nth(0)).toHaveText('2');

    await segundo.getByRole('button', { name: 'Marcar' }).click();
    const oferta = page.getByTestId('tabela-espera').locator('form');
    await expect(page.getByTestId('espera-motivo-oferta')).toBeVisible();
    await page.getByTestId('espera-data').fill(dia);
    await page.getByTestId('espera-hora').fill('08:00');

    // Sem motivo: recusa com a orientação; o pedido continua aguardando.
    await page.getByTestId('botao-ofertar-espera').click();
    await expect(page.getByTestId('recusa-agenda')).toContainText('informe o motivo');
    await expect(segundo).toContainText('Aguardando');
    await semViolacaoAxe(page, 'oferta fora da ordem recusada');

    // Vaga de outra agenda (ortopedia) para o pedido da pediatria: recusada.
    await escolher(oferta.getByLabel('Agenda'), '903');
    await page.getByTestId('espera-motivo-oferta').fill('Retorno sintético com exame pronto');
    await page.getByTestId('botao-ofertar-espera').click();
    await expect(page.getByTestId('recusa-agenda')).toContainText('não é da agenda do pedido');
    await expect(segundo).toContainText('Aguardando');

    // A vaga da própria agenda, com o motivo: ofertada.
    await escolher(oferta.getByLabel('Agenda'), '904');
    await page.getByTestId('botao-ofertar-espera').click();
    await expect(page.getByTestId('espera-mensagem')).toContainText('Vaga ofertada');
    await expect(segundo).toContainText('Vaga ofertada');
    // O motivo exigido fica registrado: aparece na linha do pedido e no histórico (entrada e oferta, com o motivo).
    await expect(segundo).toContainText('Fora da ordem: Retorno sintético com exame pronto');
    const historico = page.getByRole('region', { name: 'Histórico do pedido' });
    await expect(historico.locator('li')).toHaveCount(2);
    await expect(historico.locator('li').nth(0)).toContainText('Entrada na fila');
    await expect(historico.locator('li').nth(1)).toContainText('Vaga ofertada');
    await expect(historico.locator('li').nth(1)).toContainText('Retorno sintético com exame pronto');
    await semViolacaoAxe(page, 'oferta com motivo');
    expect(externas).toEqual([]);
  });
});
