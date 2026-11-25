// E2E @C1-001 (02-AGE linha 49, ficha F3.2): a central marca a consulta escolhendo o grupo de prioridade legal
// (Lei 10.048/2000, Lei 10.741/2003 e Lei 13.466/2017) no combo `marcar-prioridade-legal`, faz um encaixe com outro
// grupo, e o painel do dia mostra o selo da prioridade em cada marcação; axe sem violação séria. Sessão real sobre a
// fonte sintética de dev e a porta da agenda em MEMÓRIA (grupos, agendas, horários e pacientes SINTÉTICOS). A ordem
// dos encaixes do mesmo minuto pelo peso do grupo é regra do domínio (ordem-painel.spec.ts): a memória não aceita
// dois encaixes no mesmo minuto, então aqui se confere o selo de cada um.
import { expect, test, type Page } from '@playwright/test';
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
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

async function escolherPaciente(page: Page): Promise<void> {
  await page.getByTestId('marcar-termo').fill('cinthya');
  await page.getByTestId('marcar-termo').press('Enter');
  await page.getByTestId('paciente-1003').click();
  await expect(page.getByTestId('paciente-escolhido')).toBeVisible();
}

/** Id da marcação aberta depois de gravar (a tela vai para o detalhe). */
async function idDaMarcacao(page: Page): Promise<number> {
  await expect(page).toHaveURL(/\/agenda\/consultas\/marcacoes\/\d+/);
  return Number(/\/marcacoes\/(\d+)/.exec(page.url())?.[1]);
}

test.describe('Prioridade legal na marcação @C1-001 @F3.2', () => {
  test.setTimeout(120_000);
  test('marcar e encaixar com o grupo; selo no painel do dia; axe', async ({ page }) => {
    const externas = vigiarExternas(page);
    const dia = diaUtil();
    await entrar(page, 'SINT.AGENDA');

    // Marcação na grade com o grupo "Gestante".
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
    await expect(page.getByTestId('vaga-escolhida')).toBeVisible();
    await escolherPaciente(page);
    const dados = page.getByRole('region', { name: 'Marcar consulta' });
    await escolher(dados.getByLabel('Convênio'), '10');
    await escolher(page.getByTestId('marcar-prioridade-legal'), { rotulo: 'Gestante' });
    await semViolacaoAxe(page, 'marcação com prioridade legal');
    await page.getByTestId('botao-marcar').click();
    const marcada = await idDaMarcacao(page);

    // Encaixe fora da grade com o grupo "Acima de 80 anos".
    await page.goto('/agenda/consultas/marcar');
    await escolherPaciente(page);
    await escolher(page.getByRole('region', { name: 'Marcar consulta' }).getByLabel('Convênio'), '10');
    await escolher(page.getByTestId('marcar-prioridade-legal'), { rotulo: 'Acima de 80 anos' });
    const enc = page.getByRole('region', { name: 'Encaixe fora da grade' });
    await escolher(enc.getByLabel('Agenda'), '901');
    await page.getByTestId('encaixe-data').fill(dia);
    await page.getByTestId('encaixe-hora').fill('08:22');
    await enc.getByRole('button', { name: 'Conferir o encaixe' }).click();
    await enc.getByLabel('Motivo do encaixe').fill('Prioridade SINTETICA');
    await page.getByTestId('botao-encaixar').click();
    const encaixe = await idDaMarcacao(page);
    await expect(page.getByTestId('marcacao-dados')).toContainText('Encaixe');

    // Painel do dia: o selo da prioridade em cada marcação.
    await page.goto('/agenda/consultas/dia');
    await page.getByTestId('dia-data').fill(dia);
    await escolher(page.getByLabel('Agenda'), '901');
    await expect(page.getByTestId('tabela-dia')).toBeVisible();
    await expect(page.getByTestId(`dia-prioridade-${marcada}`)).toContainText('Gestante');
    await expect(page.getByTestId(`dia-prioridade-${encaixe}`)).toContainText('Acima de 80 anos');
    await semViolacaoAxe(page, 'painel do dia com prioridade legal');

    // Limpeza: desfaz o encaixe (o minuto volta a ficar livre para a próxima rodada).
    await page.goto(`/agenda/consultas/marcacoes/${encaixe}`);
    await page.getByRole('button', { name: 'Desfazer o encaixe' }).click();
    await page.getByTestId('confirmacao').getByRole('button', { name: 'Confirmar' }).click();
    await expect(page.getByTestId('marcacao-mensagem')).toContainText('desfeito');
    expect(externas).toEqual([]);
  });
});
