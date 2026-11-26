// E2E @C1-107 (F8, 02-AGE linha 47): cotas e prazos de marcação pelo caminho da tela
// (`/agenda/consultas/cotas-prazos`). O gestor de agendas cria a cota (convênio, por mês, quantidade 2, bloquear),
// vê a validação na hora (sem limite e percentual acima de 100 recusados antes de gravar), vê o uso de hoje contra o
// limite (esgotada em destaque) e cria o prazo de aviso (antecedência incoerente recusada na hora). As cotas e prazos
// só existem no banco do cliente (na fonte sintética a API responde 503): as respostas são simuladas pelo Playwright
// com massa SINTÉTICA, no contrato do servidor. Na marcação (porta da agenda em memória, fonte sintética), a central
// vê a recusa da cota esgotada com o texto próprio e, marcada a consulta, a ficha mostra os avisos devolvidos (prazo ao
// paciente e cota que só alerta); a recusa e os avisos são simulados no contrato do servidor. O efeito no banco e a
// trava na marcação estão em apps/api/src/modulos/agenda/cota-prazo.int.spec.ts.
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const FERIADOS = ['01-01', '04-21', '09-07', '11-02', '11-15', '12-25'];

/** Próximo dia útil a partir de três dias à frente (relógio de São Paulo), fora dos feriados fixos. */
function diaUtil(): string {
  const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  const d = new Date(`${hoje}T12:00:00Z`);
  for (let i = 3; i < 20; i++) {
    const x = new Date(d.getTime() + i * 86_400_000);
    const iso = x.toISOString().slice(0, 10);
    const sem = x.getUTCDay();
    if (sem !== 0 && sem !== 6 && !FERIADOS.includes(iso.slice(5))) return iso;
  }
  throw new Error('sem dia útil');
}

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

  test('na marcação, a cota esgotada recusa com texto próprio e a ficha mostra os avisos', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const externas = vigiarExternas(page);
    const dia = diaUtil();
    let tentativas = 0;
    // 1ª tentativa: a cota bloqueia; 2ª: a marcação passa (porta em memória) e a resposta leva os avisos do contrato.
    await page.route('**/api/agenda/consultas/marcacoes', async (rota) => {
      if (rota.request().method() !== 'POST') return rota.fallback();
      tentativas += 1;
      if (tentativas === 1)
        return json(
          rota,
          {
            type: 'https://sgh.local/problemas/cota-esgotada',
            title: 'Operação recusada',
            status: 409,
            detail: 'Cota sintética esgotada.',
            codigo: 'cota-esgotada',
          },
          409,
        );
      const resposta = await rota.fetch();
      const corpo = (await resposta.json()) as { resultado: Record<string, unknown> };
      corpo.resultado['avisos'] = [
        'Aviso ao paciente: Chegue 15 minutos antes com a carteirinha.',
        'A cota de marcação passou do limite: 3 de 2 no período.',
      ].join('\n');
      return rota.fulfill({ response: resposta, json: corpo });
    });
    await entrar(page, 'SINT.AGENDA');
    await page.goto('/agenda/consultas/marcar');
    await expect(page.getByTestId('tela-marcar')).toBeVisible();
    const busca = page.getByRole('region', { name: 'Buscar vagas' });
    await escolher(busca.getByLabel('Agenda'), '901');
    await page.getByTestId('vagas-de').fill(dia);
    await page.getByTestId('vagas-ate').fill(dia);
    await busca.getByRole('button', { name: 'Buscar vagas' }).click();
    await expect(page.getByTestId('tabela-vagas')).toBeVisible();
    await page
      .getByTestId(new RegExp(`^vaga-901-${dia}-\\d{4}$`))
      .first()
      .click();
    await page.getByTestId('marcar-termo').fill('cinthya');
    await page.getByTestId('marcar-termo').press('Enter');
    await page.getByTestId('paciente-1003').click();
    await escolher(page.getByRole('region', { name: 'Marcar consulta' }).getByLabel('Convênio'), '10');

    await page.getByTestId('botao-marcar').click();
    await expect(
      page.getByText('A cota de marcação deste convênio, especialidade ou item já chegou ao limite'),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/agenda\/consultas\/marcar/);

    await page.getByTestId('botao-marcar').click();
    await expect(page).toHaveURL(/\/agenda\/consultas\/marcacoes\/\d+/);
    const avisos = page.getByTestId('marcacao-aviso');
    await expect(avisos).toHaveCount(2);
    await expect(avisos.nth(0)).toContainText('Chegue 15 minutos antes com a carteirinha.');
    await expect(avisos.nth(1)).toContainText('3 de 2');
    expect(tentativas).toBe(2);
    await semViolacaoAxe(page, 'ficha da marcação com avisos');

    // Os avisos valem uma vez só: recarregada a ficha, somem.
    await page.reload();
    await expect(page.getByTestId('marcacao-dados')).toBeVisible();
    await expect(page.getByTestId('marcacao-aviso')).toHaveCount(0);
    expect(externas).toEqual([]);
  });
});
