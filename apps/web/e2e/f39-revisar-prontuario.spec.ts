// E2E @F3.9 revisarProntuario (ficha F3.9-apoio): a comissão de revisão de prontuários publica o checklist, sorteia a
// amostra, revisa um prontuário com o item "sumário de alta" não conforme (a pendência vai ao médico assistente, aberta
// e com o texto do item) e depois corrige a revisão com justificativa: o item fica conforme, a revisão passa a
// "Conforme" e a pendência do item é cancelada (segue visível como cancelada). O que fica no banco próprio (itens sem
// apagar, percentual ponderado pelo peso, "não se aplica" recusado, reabertura da pendência) está no contrato de efeito
// apps/api/src/modulos/qualidade/porta-propria-revisar-prontuario.int.spec.ts. Axe sem violação séria no diálogo. Sessão
// real sobre a fonte sintética e as portas em MEMÓRIA (dados SINTÉTICOS; nada vai à cópia).
import { expect, type Page, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const ITENS_CONFORMES = [
  'identificacao',
  'anamnese',
  'evolucao-diaria',
  'prescricao',
  'exames',
  'consentimento',
  'assinatura',
];

async function entrar(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

async function postar(page: Page, url: string, corpo: unknown): Promise<void> {
  const r = await page.evaluate(
    async ([u, c]) => {
      const csrf = /(?:^|;\s*)sgh_csrf=([^;]+)/.exec(document.cookie)?.[1] ?? '';
      const resp = await fetch(u as string, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          'x-csrf': csrf,
          'idempotency-key': `e2e.f39rp.${Math.random().toString(36).slice(2)}`,
        },
        body: JSON.stringify(c),
      });
      return { status: resp.status, corpo: (await resp.json()) as unknown };
    },
    [url, corpo] as const,
  );
  expect(r.status, `${url}: ${JSON.stringify(r.corpo)}`).toBeLessThan(300);
}

test.describe('Qualidade: revisão do prontuário pelo checklist com pendência ao médico e correção @F3.9 @fase3', () => {
  test.setTimeout(300_000);

  test('revisar com item não conforme → pendência ao médico → corrigir a revisão; axe', async ({ page }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.QUALIDADE');
    const nome = `Revisão F3.9 E2E ${String(Date.now())}`;
    await postar(page, '/api/qualidade/gestao/comissoes', {
      comissao: null,
      versao: null,
      tipo: 'prontuario',
      nome,
      periodicidade: 'mensal',
      membros: [{ nome: 'Médico revisor sintético', funcao: 'Presidente', login: null }],
      ativa: true,
    });
    await page.goto('/qualidade/gestao/revisao-prontuarios');
    await expect(page.getByTestId('tela-revisao-prontuarios')).toBeVisible();
    await escolher(page.getByTestId('revisao-comissao'), { rotulo: nome });

    await page.getByTestId('revisao-aba-checklist').click();
    await page.getByTestId('checklist-editar').click();
    await expect(page.getByTestId('checklist-item-0')).toBeVisible();
    await page.getByTestId('checklist-publicar').click();
    await expect(page.getByTestId('revisao-aviso')).toContainText('revisão 1');

    await page.getByTestId('revisao-aba-sorteios').click();
    await page.getByTestId('revisao-quantidade').getByRole('textbox').fill('4');
    await page.getByTestId('revisao-semente').getByRole('textbox').fill('E2E-F39-RP');
    await page.getByTestId('revisao-sortear').click();
    await expect(page.getByTestId('revisao-aviso')).toContainText('semente E2E-F39-RP');

    // Revisão com o sumário de alta não conforme: a pendência vai ao médico assistente.
    const prontuarios = page.getByTestId('tabela-prontuarios');
    await expect(prontuarios.locator('tbody tr')).toHaveCount(4);
    const linha = prontuarios.locator('tbody tr', { hasText: 'MEDICO SINTETICO' }).first();
    const reg = (await linha.locator('td').nth(1).innerText()).trim();
    await linha.getByTestId(`revisar-${reg}`).click();
    const d = page.getByTestId('dialogo-correcao');
    await expect(d.getByTestId('correcao-confirmar')).toBeDisabled();
    for (const item of ITENS_CONFORMES) await d.getByTestId(`resultado-${item}-conforme`).check();
    await d.getByTestId('resultado-sumario-alta-naoConforme').check();
    await d.getByTestId('observacao-sumario-alta').getByRole('textbox').fill('Sem as orientações de alta.');
    await semViolacaoAxe(page, 'revisão do prontuário com item não conforme');
    await d.getByTestId('correcao-confirmar').click();
    await expect(d).toBeHidden();
    const l = page.getByTestId(`prontuario-${reg}`);
    await expect(l).toContainText('Não conforme');
    await expect(l).toContainText('Item não conforme: Sumário de alta');
    await expect(l).toContainText('Aberta');

    // Correção com justificativa: o item fica conforme e a pendência do item é cancelada.
    await l.getByTestId(`revisar-${reg}`).click();
    await expect(d.getByTestId('resultado-sumario-alta-naoConforme')).toBeChecked();
    await d.getByTestId('resultado-sumario-alta-conforme').check();
    await d
      .getByTestId('correcao-justificativa')
      .fill('As orientações de alta estavam no anexo do sumário (conferido na revisão).');
    await semViolacaoAxe(page, 'correção da revisão do prontuário');
    await d.getByTestId('correcao-confirmar').click();
    await expect(d).toBeHidden();
    await expect(l).not.toContainText('Não conforme');
    await expect(l).toContainText('Conforme');
    await expect(l).toContainText('Cancelada');
    await expect(l.getByTestId(`dar-aval-${reg}`)).toHaveCount(1);
    expect(externas).toEqual([]);
  });
});
