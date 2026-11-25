// E2E @C1-107 (F8, 02-AGE linha 47): cotas e prazos de marcação pelo caminho da tela
// (`/agenda/consultas/cotas-prazos`). O gestor de agendas cria a cota (convênio, por mês, quantidade 2, bloquear),
// vê a validação na hora (sem limite e percentual acima de 100 recusados antes de gravar), vê o uso de hoje contra o
// limite (esgotada em destaque) e cria o prazo de aviso (antecedência incoerente recusada na hora). As cotas e prazos
// só existem no banco do cliente (na fonte sintética a API responde 503): as respostas são simuladas pelo Playwright
// com massa SINTÉTICA, no contrato do servidor. O efeito no banco e a trava na marcação estão em
// apps/api/src/modulos/agenda/cota-prazo.int.spec.ts.
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
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

const json = (rota: Route, corpo: unknown, status = 200) =>
  rota.fulfill({ status, contentType: 'application/json', body: JSON.stringify(corpo) });

const OPCOES = {
  agenda: [{ id: 9701, nome: 'AGENDA SINTETICA C1107' }],
  fontePagadora: [{ id: 9711, nome: 'CONVENIO SINTETICO C1107' }],
  especialidade: [{ id: 9721, nome: 'ESPECIALIDADE SINTETICA' }],
  tipoMarcacao: [{ id: 9731, nome: 'PRIMEIRA VEZ SINTETICA' }],
  item: [{ id: 9741, nome: 'EXAME SINTETICO' }],
};

function simular(page: Page) {
  const st = {
    cotas: [] as Record<string, unknown>[],
    prazos: [] as Record<string, unknown>[],
    corpos: [] as { url: string; corpo: Record<string, unknown> }[],
  };
  void page.route('**/api/agenda/cotas-prazos**', (r) => {
    const url = new URL(r.request().url());
    if (url.pathname.endsWith('/opcoes')) return json(r, OPCOES);
    if (r.request().method() === 'GET') return json(r, { cotas: st.cotas, prazos: st.prazos });
    const corpo = r.request().postDataJSON() as Record<string, unknown>;
    st.corpos.push({ url: url.pathname, corpo });
    if (url.pathname.endsWith('/cotas')) {
      const id = 9801 + st.cotas.length;
      st.cotas.push({
        ...corpo,
        id,
        versao: 1,
        uso: { usadas: 2, limite: 2, inicio: '2030-03-01', fim: '2030-03-31' },
      });
      return json(r, {
        ok: true,
        resultado: { cota: id },
        repetida: false,
        mensagem: 'Cota de marcação criada.',
      });
    }
    const id = 9901 + st.prazos.length;
    st.prazos.push({ ...corpo, id, versao: 1 });
    return json(r, {
      ok: true,
      resultado: { prazo: id },
      repetida: false,
      mensagem: 'Prazo de aviso criado.',
    });
  });
  return st;
}

test.describe('@C1-107 cotas e prazos de marcação', () => {
  test('cria a cota e o prazo com a validação na hora e mostra o uso da cota', async ({ page }) => {
    const externas = vigiarExternas(page);
    const st = simular(page);
    await entrar(page, 'sint.gestor.agenda');
    await page.goto('/agenda/consultas/cotas-prazos');
    await expect(page.getByTestId('cotas-vazio')).toBeVisible();
    await expect(page.getByTestId('prazos-vazio')).toBeVisible();

    // Cota: sem limite é recusada na hora; percentual acima de 100 também.
    await page.getByTestId('cota-nova').click();
    await escolher(page.getByTestId('cota-edicao').getByLabel('Convênio'), '9711');
    await expect(page.getByTestId('cota-recusa')).toContainText('quantidade máxima');
    await expect(page.getByTestId('cota-gravar')).toBeDisabled();
    await page.getByTestId('cota-percentual').locator('input, textarea').first().fill('150');
    await expect(page.getByTestId('cota-recusa')).toContainText('0 a 100');
    await page.getByTestId('cota-percentual').locator('input, textarea').first().fill('');
    await page.getByTestId('cota-quantidade').locator('input, textarea').first().fill('2');
    await expect(page.getByTestId('cota-recusa')).toHaveCount(0);
    await page.getByTestId('cota-gravar').click();
    await expect(page.getByTestId('cotas-prazos-mensagem')).toHaveText('Cota de marcação criada.');
    expect(st.corpos[0]).toMatchObject({
      url: '/api/agenda/cotas-prazos/cotas',
      corpo: {
        fontePagadora: 9711,
        quantidadeMaxima: 2,
        periodicidade: 'mes',
        acao: 'bloquear',
        ativo: true,
      },
    });
    await expect(page.getByTestId('cota-uso-9801')).toContainText('2 de 2');
    await expect(page.getByTestId('cota-uso-9801')).toContainText('esgotada');

    // Prazo: antecedência máxima menor que a mínima é recusada na hora.
    await page.getByTestId('prazo-novo').click();
    await escolher(page.getByTestId('prazo-edicao').getByLabel('Agenda'), '9701');
    await page.getByTestId('prazo-minima').locator('input, textarea').first().fill('72');
    await page.getByTestId('prazo-maxima').locator('input, textarea').first().fill('2');
    await expect(page.getByTestId('prazo-recusa')).toContainText('não pode ser menor');
    await page.getByTestId('prazo-maxima').locator('input, textarea').first().fill('30');
    await page.getByTestId('prazo-aviso').locator('input, textarea').first().fill('Chegue 15 minutos antes.');
    await page.getByTestId('prazo-gravar').click();
    await expect(page.getByTestId('cotas-prazos-mensagem')).toHaveText('Prazo de aviso criado.');
    expect(st.corpos[1]).toMatchObject({
      url: '/api/agenda/cotas-prazos/prazos',
      corpo: { agenda: 9701, antecedenciaMinimaHoras: 72, antecedenciaMaximaDias: 30 },
    });
    await expect(page.getByTestId('prazos-lista')).toContainText('Chegue 15 minutos antes.');

    await semViolacaoAxe(page, 'cotas e prazos de marcação');
    expect(externas).toEqual([]);
  });
});
