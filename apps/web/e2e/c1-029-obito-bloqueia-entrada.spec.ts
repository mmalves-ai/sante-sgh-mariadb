// C1-029 (02-CAD linha 13) @C1-029: o óbito registrado no cadastro fecha a porta de entrada do paciente.
//  1. O médico emite a declaração de óbito (com número) na aba de alta do prontuário; a emissão marca o cadastro
//     (falecido, declaração e data) na mesma transação.
//  2. A recepção tenta abrir atendimento para o paciente: o servidor recusa com `paciente-falecido` e a tela mostra o
//     motivo com a data, sem gravar e sem mensagem geral com código de correlação.
// A recusa de verdade (o que fica no banco) está nos contratos de efeito
// apps/api/src/modulos/pep/documentos-propria-pareceres.int.spec.ts (marca e desfaz no cadastro),
// apps/api/src/modulos/atendimento/abertura-modulo-origem.int.spec.ts (abertura),
// apps/api/src/modulos/agenda/porta-propria.int.spec.ts (marcação e encaixe) e
// apps/api/src/modulos/adt/internacao-falecido.int.spec.ts (admissão e pré-internação). Aqui a recusa da gravação é a
// resposta do servidor simulada pelo Playwright (massa SINTÉTICA), como no vizinho f31-regra-campo-abertura.
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const PACIENTE = 1001;
const MENSAGEM = 'Não é possível abrir atendimento: o paciente tem óbito registrado em 20/11/2026.';

async function entrar(page: Page, login: string): Promise<void> {
  await page.goto('/entrar');
  const campo = page.getByTestId('campo-login');
  await campo.waitFor({ state: 'visible', timeout: 30_000 }).catch(() => page.reload());
  await campo.fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

const json = (rota: Route, corpo: unknown, status = 200) =>
  rota.fulfill({ status, contentType: 'application/json', body: JSON.stringify(corpo) });

test.describe('@C1-029 óbito no cadastro barra novo atendimento', () => {
  test.describe.configure({ timeout: 240_000 });

  test('o médico emite a declaração de óbito; a recepção não abre atendimento para o paciente; axe', async ({
    browser,
  }) => {
    // 1. Emissão pela aba de alta do prontuário.
    const ctxMed = await browser.newContext();
    const med = await ctxMed.newPage();
    await entrar(med, 'SINT.MEDICO');
    await med.goto(`/pep/paciente/${PACIENTE}/alergias`);
    await med.getByTestId('aba-alta').click();
    const form = med.getByTestId('form-obito');
    await expect(form).toBeVisible();
    await form.getByLabel('Data e hora do óbito').fill('2026-11-20T10:00');
    await form.getByLabel('Número da declaração').fill('90002901');
    await form.getByLabel('Causa (a)').fill('Causa SINTETICA imediata');
    await form.locator('input[type=password]').fill(SENHA);
    await form.getByRole('button').click();
    await expect(med.getByTestId('aba-alta-conteudo')).toContainText('Óbito registrado em');
    await ctxMed.close();

    // 2. A recepção tenta abrir o atendimento: o servidor recusa com o motivo do óbito.
    const ctxRec = await browser.newContext();
    const page = await ctxRec.newPage();
    await entrar(page, 'SINT.ATENDIMENTO');
    let gravacoes = 0;
    await page.route('**/api/atendimento', (rota) => {
      if (rota.request().method() !== 'POST') return rota.fallback();
      gravacoes += 1;
      return json(
        rota,
        {
          type: 'https://sgh.local/problemas/paciente-falecido',
          title: 'Operação recusada',
          status: 409,
          detail: MENSAGEM,
          codigo: 'paciente-falecido',
          campos: ['paciente'],
        },
        409,
      );
    });
    await page.goto('/recepcao/atendimento/novo');
    await expect(page.getByTestId('tela-abrir-atendimento')).toBeVisible();
    await page.getByTestId('abrir-atd-termo').fill('JOSE DA SILVA');
    await page.getByTestId('abrir-atd-buscar').click();
    await page.getByTestId(`abrir-atd-paciente-${PACIENTE}`).click();
    await expect(page.getByTestId('abrir-atd-paciente-escolhido')).toBeVisible();
    const ficha = page.getByRole('region', { name: 'Dados do atendimento' });
    await escolher(ficha.getByLabel('Tipo', { exact: true }), 'consulta');
    await escolher(ficha.getByLabel('Convênio', { exact: true }), '306');
    await escolher(ficha.getByLabel('Especialidade', { exact: true }), '15');
    await escolher(ficha.getByLabel('Profissional', { exact: true }), '7101');
    await escolher(ficha.getByLabel('Unidade', { exact: true }), '1');
    await escolher(ficha.getByLabel('Centro de custo', { exact: true }), '300600');
    await page.getByTestId('abrir-atd-procedimento').fill('10101012');
    await page.getByTestId('abrir-atd-cid').fill('febre');
    await page.getByTestId('abrir-atd-cid-buscar').click();
    await page.getByTestId('abrir-atd-cid-1').click();
    await page.getByTestId('botao-abrir-atendimento').click();

    // Continua na abertura (nada foi gravado), com o motivo do óbito e a data; sem ir aos impressos.
    await expect(page.getByTestId('tela-abrir-atendimento')).toContainText(MENSAGEM);
    await expect(page.getByTestId('tela-impressos')).toHaveCount(0);
    expect(gravacoes).toBe(1);
    await semViolacaoAxe(page, 'abertura recusada por óbito registrado');
    await ctxRec.close();
  });
});
