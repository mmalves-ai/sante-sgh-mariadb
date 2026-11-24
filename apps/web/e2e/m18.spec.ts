// E2E @M18 (ficha, seção 10): a central de exames marca o exame pela busca de vaga e cancela com motivo; o bloco
// agenda a cirurgia no mapa, move e cancela, e registra o ato; axe sem violação séria em cada tela. Sessão real sobre
// a fonte sintética de dev e as portas da agenda de exames e do centro cirúrgico em MEMÓRIA (agendas, salas,
// profissionais e pacientes SINTÉTICOS; nada vai à cópia).
import { expect, type Page, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const FERIADOS = ['01-01', '04-21', '09-07', '11-02', '11-15', '12-25'];

function hojeSp(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
}

/** Próximo dia útil a partir de depois de amanhã (relógio de São Paulo), fora dos feriados fixos. */
function diaUtil(): string {
  const d = new Date(`${hojeSp()}T12:00:00Z`);
  for (let i = 2; i < 20; i++) {
    const x = new Date(d.getTime() + i * 86_400_000);
    const iso = x.toISOString().slice(0, 10);
    const sem = x.getUTCDay();
    if (sem !== 0 && sem !== 6 && !FERIADOS.includes(iso.slice(5))) return iso;
  }
  throw new Error('sem dia útil');
}

/** O próximo dia útil (o dia em que a porta em memória põe as duas cirurgias que se cruzam na sala 2). */
function proximoDiaUtil(): string {
  const d = new Date(`${hojeSp()}T12:00:00Z`);
  for (let i = 1; i < 10; i++) {
    const x = new Date(d.getTime() + i * 86_400_000);
    if (x.getUTCDay() !== 0 && x.getUTCDay() !== 6) return x.toISOString().slice(0, 10);
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

test.describe('Agenda de exames e centro cirúrgico @M18 @fase2', () => {
  test.setTimeout(150_000);

  test('marcar e cancelar exame; agendas, geração, cancelamentos e resíduo; axe', async ({ page }) => {
    const externas = vigiarExternas(page);
    const dia = diaUtil();
    await entrar(page, 'SINT.EXAME');
    await page.goto('/agenda/exames/marcar');
    await expect(page.getByTestId('tela-marcar-exame')).toBeVisible();
    await semViolacaoAxe(page, '/agenda/exames/marcar');

    const busca = page.getByRole('region', { name: 'Buscar vagas' });
    await escolher(busca.getByLabel('Agenda'), '951');
    await page.getByTestId('vagas-exame-de').fill(dia);
    await page.getByTestId('vagas-exame-ate').fill(dia);
    await busca.getByRole('button', { name: 'Buscar vagas' }).click();
    await expect(page.getByTestId('tabela-vagas-exame')).toBeVisible();
    await page.getByTestId(`vaga-exame-951-${dia}-0700`).click();
    await expect(page.getByTestId('vaga-exame-escolhida')).toContainText('07:00');

    await page.getByTestId('marcar-exame-termo').fill('cinthya');
    await page.getByTestId('marcar-exame-termo').press('Enter');
    await page.getByTestId('paciente-exame-1003').click();
    await expect(page.getByTestId('paciente-exame-escolhido')).toBeVisible();
    const dados = page.getByRole('region', { name: 'Marcar exame' });
    await escolher(dados.getByLabel('Convênio', { exact: true }), '10');
    await escolher(dados.getByLabel('Exame escolhido'), '7001');
    await semViolacaoAxe(page, 'marcação de exame preenchida');
    await page.getByTestId('botao-marcar-exame').click();
    await expect(page).toHaveURL(/\/agenda\/exames\/marcacoes\/\d+/);
    await expect(page.getByTestId('marcacao-exame-estado')).toHaveText('Marcado');
    await expect(page.getByTestId('marcacao-exame-dados')).toContainText('ULTRASSONOGRAFIA DE ABDOME TOTAL');
    await semViolacaoAxe(page, 'marcação de exame');

    // Cancelamento com motivo padronizado (confirmação do destrutivo).
    await page.getByRole('button', { name: 'Cancelar o exame' }).click();
    await expect(page.getByTestId('form-cancelar-exame')).toBeVisible();
    await semViolacaoAxe(page, 'cancelamento de exame');
    await page.getByTestId('confirmar-cancelamento-exame').click();
    await page.getByTestId('confirmacao').getByRole('button', { name: 'Confirmar' }).click();
    await expect(page.getByTestId('marcacao-exame-mensagem')).toContainText('cancelado');

    await page.goto('/agenda/exames/cancelamentos');
    await expect(page.getByTestId('tabela-cancelamentos-exame')).toBeVisible();
    await semViolacaoAxe(page, 'cancelamentos de exames');

    await page.goto('/agenda/exames/residuo');
    await expect(page.getByTestId('residuo-totais')).toBeVisible();
    await semViolacaoAxe(page, 'resíduo');

    await page.goto('/agenda/exames/agendas');
    await page.getByTestId('agenda-exame-951').click();
    await expect(page.getByTestId('tabela-cobertura-exame')).toBeVisible();
    await semViolacaoAxe(page, 'agendas de exames');

    await page.goto('/agenda/exames/gerar?agenda=952');
    await expect(page.getByTestId('tela-gerar-exame')).toBeVisible();
    await semViolacaoAxe(page, 'geração da grade de exames');
    await page.goto('/agenda/exames/escalas?agenda=952');
    await expect(page.getByTestId('tabela-escala-exame')).toBeVisible();
    await semViolacaoAxe(page, 'escala de exames');
    expect(externas).toEqual([]);
  });

  test('agendar, mover e cancelar cirurgia no mapa; alerta de sobreposição; axe', async ({ page }) => {
    const externas = vigiarExternas(page);
    const dia = diaUtil();
    await entrar(page, 'SINT.BLOCO');
    await page.goto('/cirurgia/mapa');
    await expect(page.getByTestId('tela-mapa-cirurgico')).toBeVisible();
    await semViolacaoAxe(page, '/cirurgia/mapa');

    const pedido = page.getByTestId('form-agendar-cirurgia');
    await escolher(pedido.getByLabel('Sala', { exact: true }), '1');
    await page.getByTestId('pedido-data').fill(dia);
    await page.getByTestId('pedido-hora').fill('07:00');
    await page.getByTestId('pedido-duracao').fill('90');
    await page.getByTestId('pedido-termo').fill('cinthya');
    await page.getByTestId('pedido-termo').press('Enter');
    await page.getByTestId('paciente-cirurgia-1003').click();
    await page.getByTestId('pedido-procedimento').fill('COLE');
    await page.getByTestId('pedido-procedimento').press('Enter');
    await page.getByTestId('procedimento-30101271').click();
    await expect(page.getByTestId('procedimento-escolhido')).toContainText('COLECISTECTOMIA');
    await escolher(pedido.getByLabel('Convênio', { exact: true }), '10');
    await escolher(pedido.getByLabel('Cirurgião', { exact: true }), '5001:9001');
    await semViolacaoAxe(page, 'pedido de sala preenchido');
    await page.getByTestId('botao-agendar-cirurgia').click();
    await expect(page).toHaveURL(/\/cirurgia\/agendamentos\/\d+/);
    await expect(page.getByTestId('agendamento-estado')).toHaveText('Confirmado');
    await semViolacaoAxe(page, 'agendamento cirúrgico');

    // Mover para as 13:00 do mesmo dia, com a justificativa.
    await page.getByRole('button', { name: 'Mover de sala ou de horário' }).click();
    await page.getByTestId('mover-hora').fill('13:00');
    await page.getByLabel('Motivo da mudança').fill('Mudança pedida pela equipe');
    await page.getByTestId('confirmar-mover').click();
    await expect(page.getByTestId('agendamento-mensagem')).toContainText('movida');
    await expect(page.getByTestId('agendamento-dados')).toContainText('13:00');

    // Cancelar com motivo codificado (confirmação do destrutivo): a sala é liberada.
    await page.getByRole('button', { name: 'Cancelar ou suspender' }).click();
    await expect(page.getByTestId('form-cancelar-cirurgia')).toBeVisible();
    await semViolacaoAxe(page, 'cancelamento de cirurgia');
    await page.getByTestId('confirmar-cancelar-cirurgia').click();
    await page.getByTestId('confirmacao').getByRole('button', { name: 'Confirmar' }).click();
    await expect(page.getByTestId('agendamento-mensagem')).toContainText('cancelada');

    // O mapa de amanhã mostra o alerta das cirurgias que se cruzam na sala 2 (gravadas fora destas telas).
    await page.goto('/cirurgia/mapa');
    await page.getByTestId('mapa-inicio').fill(proximoDiaUtil());
    await page.getByRole('button', { name: 'Ver o mapa' }).click();
    await expect(page.getByTestId('alerta-sobreposicao')).toBeVisible();
    await semViolacaoAxe(page, 'mapa com sobreposição');
    await page.goto('/cirurgia/cancelamentos');
    await expect(page.getByTestId('tela-cancelamentos-cirurgia')).toBeVisible();
    // O histórico da agenda no período: a inclusão e a remarcação feitas acima.
    await expect(page.getByTestId('tabela-historico-agenda')).toContainText('Inclusão');
    await expect(page.getByTestId('tabela-historico-agenda')).toContainText('Remarcação');
    await semViolacaoAxe(page, 'cirurgias canceladas');
    expect(externas).toEqual([]);
  });

  test('registrar o ato cirúrgico; realizadas com o casamento; salas e usuários; axe', async ({ page }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.BLOCO');
    await page.goto('/cirurgia/registro');
    await expect(page.getByTestId('tela-registro-cirurgia')).toBeVisible();
    await semViolacaoAxe(page, '/cirurgia/registro');
    const form = page.getByTestId('form-registro');
    await page.getByTestId('registro-reg').fill('77002');
    await page.getByTestId('registro-data').fill(hojeSp());
    await escolher(form.getByLabel('Sala', { exact: true }), '1');
    await escolher(form.getByLabel('Convênio', { exact: true }), '10');
    await page.getByTestId('registro-inicio').fill('08:00');
    await page.getByTestId('registro-fim').fill('09:30');
    await form.getByLabel('Procedimento (código ou início do nome)').fill('COLE');
    await form.getByLabel('Procedimento (código ou início do nome)').press('Enter');
    await form.getByRole('button', { name: /COLECISTECTOMIA/ }).click();
    await escolher(form.getByLabel('Cirurgião', { exact: true }), '5001:9001');
    // F3.4 (04-CC linha 95): a participação do cirurgião, com entrada na sala e o percentual.
    await expect(page.getByTestId('registro-participacao')).toBeVisible();
    await page.getByTestId('part-cirurgiao-entrada').fill('08:00');
    await page.getByTestId('part-cirurgiao-perc').fill('100');
    await escolher(form.getByLabel('Classificação ASA', { exact: true }), '2');
    await semViolacaoAxe(page, 'registro do ato preenchido');
    await page.getByTestId('botao-registrar').click();
    await expect(page.getByTestId('registro-mensagem')).toContainText('registrado');
    await expect(page.getByTestId('tabela-realizadas')).toContainText('Registrada sem agendamento');
    // A busca pelo atendimento (REG) acha o ato sem período; outro REG não acha nada.
    await page.getByTestId('realizadas-reg').fill('77002');
    await page.getByTestId('filtro-realizadas').getByRole('button', { name: 'Filtrar' }).click();
    await expect(page.getByTestId('tabela-realizadas').locator('tbody tr')).toHaveCount(1);
    await page.getByTestId('realizadas-reg').fill('12345');
    await page.getByTestId('filtro-realizadas').getByRole('button', { name: 'Filtrar' }).click();
    await expect(page.getByTestId('tabela-realizadas')).toHaveCount(0);

    await page.goto('/cirurgia/salas');
    await page.getByTestId('sala-1').click();
    await expect(page.getByTestId('usuarios-da-sala')).toContainText('SINT.BLOCO');
    await semViolacaoAxe(page, 'salas cirúrgicas');
    expect(externas).toEqual([]);
  });
});
