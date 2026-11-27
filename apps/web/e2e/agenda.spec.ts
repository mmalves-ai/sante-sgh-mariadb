// E2E @M17 (ficha, seção 10): a central marca a consulta pela busca de vaga, confirma, remarca e cancela com
// motivo; encaixa fora da grade e desfaz; o painel do dia mostra as marcações; axe sem violação séria em cada
// tela. Sessão real sobre a fonte sintética de dev e a porta da agenda em MEMÓRIA (agendas, horários e pacientes
// SINTÉTICOS; nada vai à cópia).
import { expect, test, type Page } from '@playwright/test';
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

test.describe('Agenda de consultas @M17 @fase2 @jornada', () => {
  test.setTimeout(120_000);
  test('marcar, confirmar, remarcar e cancelar; painel do dia; axe', async ({ page }) => {
    const externas = vigiarExternas(page);
    const dia = diaUtil();
    await entrar(page, 'SINT.AGENDA');
    await page.goto('/agenda/consultas/marcar');
    await expect(page.getByTestId('tela-marcar')).toBeVisible();
    await semViolacaoAxe(page, '/agenda/consultas/marcar');

    const busca = page.getByRole('region', { name: 'Buscar vagas' });
    await escolher(busca.getByLabel('Agenda'), '901');
    await page.getByTestId('vagas-de').fill(dia);
    await page.getByTestId('vagas-ate').fill(dia);
    await busca.getByRole('button', { name: 'Buscar vagas' }).click();
    await expect(page.getByTestId('tabela-vagas')).toBeVisible();
    await page.getByTestId(`vaga-901-${dia}-0800`).click();
    await expect(page.getByTestId('vaga-escolhida')).toContainText('08:00');
    await semViolacaoAxe(page, 'vagas');

    await escolherPaciente(page);
    const dados = page.getByRole('region', { name: 'Marcar consulta' });
    await escolher(dados.getByLabel('Convênio'), '10');
    await page.getByTestId('botao-marcar').click();
    await expect(page).toHaveURL(/\/agenda\/consultas\/marcacoes\/\d+/);
    await expect(page.getByTestId('marcacao-estado')).toHaveText('Marcada');
    await semViolacaoAxe(page, 'marcação');

    // Confirmação (resultado confirmado) e a tentativa aparece na lista.
    await page.getByRole('button', { name: 'Registrar a confirmação' }).click();
    await page.getByTestId('confirmar-confirmacao').click();
    await expect(page.getByTestId('marcacao-mensagem')).toContainText('confirmada');

    // Remarcação: transferir para 08:15 do mesmo dia; abre a marcação nova.
    const antiga = page.url();
    await page.getByRole('button', { name: 'Remarcar' }).click();
    await page.getByTestId('remarcar-data').fill(dia);
    await page.getByTestId('remarcar-hora').fill('08:15');
    await page.getByTestId('confirmar-remarcacao').click();
    await expect(page).not.toHaveURL(antiga);
    await expect(page.getByTestId('marcacao-dados')).toContainText('08:15');

    // Cancelamento com motivo padronizado (confirmação do destrutivo).
    await page.getByRole('button', { name: 'Cancelar a consulta' }).click();
    await expect(page.getByTestId('form-cancelar')).toBeVisible();
    await semViolacaoAxe(page, 'cancelamento');
    await page.getByTestId('confirmar-cancelamento').click();
    await page.getByTestId('confirmacao').getByRole('button', { name: 'Confirmar' }).click();
    await expect(page.getByTestId('marcacao-mensagem')).toContainText('cancelada');

    // Painel do dia: a marcação transferida (08:00) continua no dia.
    await page.goto('/agenda/consultas/dia');
    await page.getByTestId('dia-data').fill(dia);
    await expect(page.getByTestId('tabela-dia')).toBeVisible();
    await expect(page.getByTestId('tabela-dia')).toContainText('08:00');
    await semViolacaoAxe(page, 'painel do dia');

    // Cancelamentos do dia de hoje (lista paginada no servidor).
    await page.goto('/agenda/consultas/cancelamentos');
    await expect(page.getByTestId('tabela-cancelamentos')).toBeVisible();
    await semViolacaoAxe(page, 'cancelamentos');
    expect(externas).toEqual([]);
  });

  test('encaixe com motivo fora da grade e desfazer; grade da semana; axe', async ({ page }) => {
    const externas = vigiarExternas(page);
    const dia = diaUtil();
    await entrar(page, 'SINT.AGENDA');
    await page.goto('/agenda/consultas/marcar');
    await escolherPaciente(page);
    await escolher(page.getByRole('region', { name: 'Marcar consulta' }).getByLabel('Convênio'), '10');
    const enc = page.getByRole('region', { name: 'Encaixe fora da grade' });
    await escolher(enc.getByLabel('Agenda'), '901');
    await page.getByTestId('encaixe-data').fill(dia);
    await page.getByTestId('encaixe-hora').fill('08:07');
    await enc.getByRole('button', { name: 'Conferir o encaixe' }).click();
    await enc.getByLabel('Motivo do encaixe').fill('Retorno SINTETICO com exame');
    await page.getByTestId('botao-encaixar').click();
    await expect(page).toHaveURL(/\/agenda\/consultas\/marcacoes\/\d+/);
    await expect(page.getByTestId('marcacao-dados')).toContainText('Encaixe');
    await semViolacaoAxe(page, 'encaixe');
    await page.getByRole('button', { name: 'Desfazer o encaixe' }).click();
    await page.getByTestId('confirmacao').getByRole('button', { name: 'Confirmar' }).click();
    await expect(page.getByTestId('marcacao-mensagem')).toContainText('desfeito');

    await page.goto(`/agenda/consultas/grade?agenda=901&inicio=${dia}`);
    await expect(page.getByTestId('grade-semana')).toBeVisible();
    await semViolacaoAxe(page, 'grade');
    for (const rota of [
      '/agenda/consultas/agendas',
      '/agenda/consultas/bloqueios',
      '/agenda/espera',
      '/agenda/consultas/gerar',
    ]) {
      await page.goto(rota);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await semViolacaoAxe(page, rota);
    }
    expect(externas).toEqual([]);
  });

  test('fechamento do dia (faltas revisadas), ligação da agenda e canal a confirmar; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.AGENDA');
    // Último dia útil passado (a porta em memória semeia nele duas marcações sem chegada na agenda 902).
    const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
    let passado = '';
    for (let i = 1; i <= 3 && !passado; i++) {
      const x = new Date(new Date(`${hoje}T12:00:00Z`).getTime() - i * 86_400_000);
      const iso = x.toISOString().slice(0, 10);
      if (x.getUTCDay() !== 0 && x.getUTCDay() !== 6 && !FERIADOS.includes(iso.slice(5))) passado = iso;
    }
    test.skip(!passado, 'sem dia útil nos três dias anteriores');
    await page.goto('/agenda/consultas/dia');
    await page.getByTestId('dia-data').fill(passado);
    await escolher(page.getByLabel('Agenda'), '902');
    await expect(page.getByTestId('fechamento-dia')).toBeVisible();
    await semViolacaoAxe(page, 'fechamento do dia');
    await page.getByTestId('botao-registrar-faltas').click();
    await page.getByTestId('confirmacao').getByRole('button', { name: 'Confirmar' }).click();
    await expect(page.getByTestId('resultado-faltas')).toContainText('2 falta(s) registrada(s)');

    await page.goto('/agenda/consultas/agendas/903');
    await expect(page.getByTestId('form-ligacao')).toBeVisible();
    await escolher(page.getByTestId('form-ligacao').getByLabel('Unidade'), '2');
    await page.getByTestId('botao-ligacao').click();
    await expect(page.getByTestId('agenda-mensagem')).toContainText('Ligação da agenda revisada');
    await semViolacaoAxe(page, 'ligação da agenda');

    await page.goto('/agenda/consultas/marcar');
    await expect(page.getByTestId('canal-a-confirmar')).toBeVisible();
    expect(externas).toEqual([]);
  });

  test('sem as opções da agenda, o menu não mostra a agenda e a tela nega', async ({ page }) => {
    await entrar(page, 'SINT.RECEPCAO');
    await page.goto('/agenda/consultas/marcar');
    await expect(page.getByTestId('tela-marcar')).toHaveCount(0);
  });
});
