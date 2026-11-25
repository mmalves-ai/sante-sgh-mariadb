// E2E @C2-060 (matriz de riscos da qualidade: controles estruturados do risco). Na reavaliação do risco, a pessoa da
// qualidade liga controles do catálogo do hospital com tipo e eficácia, vê a eficácia do conjunto enquanto preenche, e
// a tela recusa na hora o controle sem nome, o repetido (mesmo nome com outra grafia) e o risco mitigado sem controle
// eficaz. Gravado, a matriz mostra quantos controles e a eficácia do conjunto. axe sem violação séria no formulário.
// Sessão real sobre a fonte sintética (dados SINTÉTICOS; nada vai à cópia). O risco de partida entra pela API da sessão.
import { expect, type Page, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';

/** A data de n dias à frente no relógio do estabelecimento sintético (America/Sao_Paulo), AAAA-MM-DD. */
function diaAFrente(n: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(Date.now() + n * 86_400_000));
}

async function entrar(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

/** POST pela sessão do navegador (CSRF do cookie e uma Idempotency-Key), devolvendo o JSON. */
async function postar<T = { id: number }>(page: Page, url: string, corpo: unknown): Promise<T> {
  const r = await page.evaluate(
    async ([u, c]) => {
      const csrf = /(?:^|;\s*)sgh_csrf=([^;]+)/.exec(document.cookie)?.[1] ?? '';
      const resp = await fetch(u as string, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          'x-csrf': csrf,
          'idempotency-key': `e2e.c2060.${Math.random().toString(36).slice(2)}`,
        },
        body: JSON.stringify(c),
      });
      return { status: resp.status, corpo: (await resp.json()) as unknown };
    },
    [url, corpo] as const,
  );
  expect(r.status, `${url}: ${JSON.stringify(r.corpo)}`).toBeLessThan(300);
  return r.corpo as T;
}

test.describe('Qualidade: controles estruturados do risco na matriz GUT @C2-060', () => {
  test('reavaliar o risco com controles, eficácia do conjunto e recusas na hora; axe', async ({ page }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.QUALIDADE');
    const titulo = `Queda no banho sintética ${Math.random().toString(36).slice(2, 7)}`;
    const risco = await postar(page, '/api/qualidade/gestao/riscos', {
      risco: null,
      versao: null,
      titulo,
      descricao: 'Risco sintético de queda no banho sem barra de apoio.',
      area: 'UTI',
      categoria: 'assistencial',
      gravidade: 3,
      urgencia: 3,
      tendencia: 2,
      controles: null,
      responsavel: 'Coordenação sintética',
      situacao: 'emTratamento',
      reavaliarEm: diaAFrente(60),
      justificativa: null,
    });

    await page.goto('/qualidade/gestao/riscos');
    await page.getByTestId(`reavaliar-${String(risco.id)}`).click();
    const form = page.getByTestId('form-risco');
    await expect(form).toBeVisible();
    await expect(form.getByTestId('risco-controles-conjunto')).toContainText('Sem controle estruturado');

    // Dois controles: a linha sem nome não vai.
    await form.getByTestId('risco-controle-adicionar').click();
    await form.getByTestId('risco-controle-adicionar').click();
    await form.getByTestId('risco-controle-nome-0').fill('Barra de apoio');
    await escolher(form.getByTestId('risco-controle-eficacia-0'), 'eficaz');
    await form.getByTestId('risco-gravar').click();
    await expect(form).toContainText('Dê nome a cada controle');

    // O mesmo nome com outra grafia é recusado na hora.
    await form.getByTestId('risco-controle-nome-1').fill(' barra de apóio ');
    await form.getByTestId('risco-gravar').click();
    await expect(form).toContainText('duas vezes');

    // Mitigado com o único outro controle ineficaz e a barra também ineficaz: recusa.
    await form.getByTestId('risco-controle-nome-1').fill('Alarme de chamada no banheiro');
    await escolher(form.getByTestId('risco-controle-tipo-1'), 'detectivo');
    await escolher(form.getByTestId('risco-controle-eficacia-1'), 'ineficaz');
    await escolher(form.getByTestId('risco-controle-eficacia-0'), 'ineficaz');
    await escolher(form.getByTestId('risco-situacao'), 'mitigado');
    await expect(form.getByTestId('risco-controles-conjunto')).toContainText('Ineficaz');
    await form.getByTestId('risco-gravar').click();
    await expect(form).toContainText('ao menos um controle eficaz');

    // A barra avaliada eficaz: (1 + 0) ÷ 2 = 0,5, parcialmente eficaz.
    await escolher(form.getByTestId('risco-controle-eficacia-0'), 'eficaz');
    await expect(form.getByTestId('risco-controles-conjunto')).toContainText('Parcialmente eficaz');
    await semViolacaoAxe(page, '/qualidade/gestao/riscos (controles do risco)');
    await form.getByTestId('risco-gravar').click();
    await expect(form).toBeHidden();

    const resumo = page.getByTestId(`risco-controles-${String(risco.id)}`);
    await expect(resumo).toContainText('Controles: 2');
    await expect(resumo).toContainText('Parcialmente eficaz');

    // Reaberto, o formulário traz os controles gravados; retirar um deixa a lista exata.
    await page.getByTestId(`reavaliar-${String(risco.id)}`).click();
    await expect(form.getByTestId('risco-controle-nome-0')).toHaveValue(/Alarme de chamada|Barra de apoio/);
    await form.getByTestId('risco-controle-retirar-1').click();
    await escolher(form.getByTestId('risco-controle-eficacia-0'), 'eficaz');
    await form.getByTestId('risco-gravar').click();
    await expect(form).toBeHidden();
    await expect(resumo).toContainText('Controles: 1');
    expect(externas).toEqual([]);
  });
});
