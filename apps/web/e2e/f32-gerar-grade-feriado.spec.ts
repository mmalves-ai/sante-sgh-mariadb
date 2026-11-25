// F3.2 (02-AGE linha 41): gerar a grade de horários por período pulando o dia sem expediente, pelo caminho da tela.
// Sessão real sobre a fonte sintética e a porta da agenda em MEMÓRIA (agendas e feriados SINTÉTICOS). O que se prova
// é o fluxo: a prévia deixa de fora o dia do calendário e diz quantos dias pulou; marcando "gerar também nos
// feriados" o dia volta; a gravação cria os horários só dos dias úteis; a segunda prévia é recusada (nada novo); e o lote
// é revertido pela escala, deixando o período livre de novo. O efeito no banco (feriado e dia não útil do
// estabelecimento, ponto facultativo, meio expediente, feriado do outro estabelecimento) está no contrato de efeito
// apps/api/src/modulos/agenda/porta-propria.int.spec.ts (caso "02-AGE 41").
import { expect, type Page, test } from '@playwright/test';
import { semViolacaoAxe } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const AGENDA = '902';
/** Dias sem expediente da sessão sintética (mês e dia; repetem todo ano). */
const SEM_EXPEDIENTE = ['01-01', '04-21', '09-07', '11-02', '11-15', '12-25'];
const DIA_MS = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const br = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;

/**
 * A primeira semana (segunda a sexta), além da grade já semeada, que tem um dia sem expediente em dia de semana.
 * Devolve o dia pulado e os dias úteis que sobram.
 */
function semanaComDiaPulado(): { de: string; ate: string; pulado: string; uteis: string[] } {
  const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  const base = new Date(`${hoje}T12:00:00Z`).getTime();
  for (let i = 35; i < 800; i++) {
    const x = new Date(base + i * DIA_MS);
    const sem = x.getUTCDay();
    if (sem === 0 || sem === 6 || !SEM_EXPEDIENTE.includes(iso(x).slice(5))) continue;
    const segunda = x.getTime() - (sem - 1) * DIA_MS;
    const dias = [0, 1, 2, 3, 4].map((n) => iso(new Date(segunda + n * DIA_MS)));
    const pulados = dias.filter((d) => SEM_EXPEDIENTE.includes(d.slice(5)));
    if (pulados.length !== 1) continue;
    return {
      de: dias[0] as string,
      ate: dias[4] as string,
      pulado: pulados[0] as string,
      uteis: dias.filter((d) => d !== pulados[0]),
    };
  }
  throw new Error('sem semana com dia sem expediente');
}

async function entrar(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

async function verPrevia(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Ver a prévia' }).click();
  await expect(page.getByTestId('previa-grade')).toBeVisible();
}

test.describe('F3.2 gerar a grade pulando o dia sem expediente @F3.2-07', () => {
  test.setTimeout(120_000);
  test('a prévia pula o dia do calendário, a gravação gera só os dias úteis e o lote é revertido', async ({
    page,
  }) => {
    const s = semanaComDiaPulado();
    await entrar(page, 'SINT.AGENDA');
    await page.goto('/agenda/consultas/gerar');
    const tela = page.getByTestId('tela-gerar');
    await expect(tela).toBeVisible();
    await escolher(tela.getByLabel('Agenda'), AGENDA);
    await page.getByTestId('gerar-de').fill(s.de);
    await page.getByTestId('gerar-ate').fill(s.ate);

    // Prévia: o dia sem expediente fica de fora e a tela diz que pulou um dia.
    await verPrevia(page);
    await expect(page.getByTestId('previa-pulados')).toContainText('1 feriado(s)');
    await expect(page.getByTestId(`previa-dia-${s.pulado}`)).toHaveCount(0);
    for (const d of s.uteis) await expect(page.getByTestId(`previa-dia-${d}`)).toContainText(br(d));
    await expect(page.locator('[data-testid^="previa-dia-"]')).toHaveCount(s.uteis.length);
    await semViolacaoAxe(page, 'prévia da grade');

    // Escolha explícita de quem gera: com "gerar também nos feriados" o dia volta à prévia.
    await page.getByTestId('gerar-feriados').check();
    await verPrevia(page);
    await expect(page.getByTestId('previa-pulados')).toContainText('0 feriado(s)');
    await expect(page.getByTestId(`previa-dia-${s.pulado}`)).toContainText(br(s.pulado));
    await expect(page.locator('[data-testid^="previa-dia-"]')).toHaveCount(s.uteis.length + 1);

    // Grava sem o feriado: só os dias úteis ganham horário.
    await page.getByTestId('gerar-feriados').uncheck();
    await verPrevia(page);
    await expect(page.getByTestId(`previa-dia-${s.pulado}`)).toHaveCount(0);
    await page
      .getByTestId('previa-grade')
      .getByRole('button', { name: /^Gerar \d+ horário\(s\)$/ })
      .click();
    await expect(page.getByTestId('gerar-mensagem')).toBeVisible();

    // A segunda prévia do mesmo período é recusada com o motivo dito na tela: nada novo a gerar.
    await page.getByRole('button', { name: 'Ver a prévia' }).click();
    await expect(page.getByTestId('recusa-agenda')).toContainText('Nenhum horário novo no período');
    await expect(page.getByTestId('previa-grade')).toHaveCount(0);

    // Reverter o lote pela escala da agenda: a linha da geração do período passa a "Revertida".
    await page.goto(`/agenda/consultas/escalas?agenda=${AGENDA}`);
    const lote = page
      .getByTestId('geracoes')
      .locator('tbody tr')
      .filter({ hasText: br(s.de) })
      .filter({ hasText: br(s.ate) })
      .filter({ has: page.getByRole('button', { name: 'Reverter' }) });
    await expect(lote).toHaveCount(1);
    await lote.getByRole('button', { name: 'Reverter' }).click();
    await page.getByTestId('confirmacao').getByRole('button', { name: 'Confirmar' }).click();
    await expect(
      page
        .getByTestId('geracoes')
        .locator('tbody tr')
        .filter({ hasText: br(s.de) })
        .filter({ hasText: br(s.ate) })
        .filter({ hasText: 'Revertida' }),
    ).not.toHaveCount(0);

    // Revertido, o período volta a aceitar a geração, ainda sem o dia do calendário.
    await page.goto('/agenda/consultas/gerar');
    await escolher(page.getByTestId('tela-gerar').getByLabel('Agenda'), AGENDA);
    await page.getByTestId('gerar-de').fill(s.de);
    await page.getByTestId('gerar-ate').fill(s.ate);
    await verPrevia(page);
    await expect(page.locator('[data-testid^="previa-dia-"]')).toHaveCount(s.uteis.length);
    await expect(page.getByTestId(`previa-dia-${s.pulado}`)).toHaveCount(0);
  });
});
