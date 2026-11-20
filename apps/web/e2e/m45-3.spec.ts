// E2E @M45.3 (ficha do M45, seções 7, 10 e 11; etapa 3, balanço hídrico): a enfermeira escolhe a UTI e o paciente,
// abre a janela de 24 horas anterior (fechamento padrão às 7 h) e vê o ganho vindo da checagem (o soro administrado em
// mL) e a diurese dos sinais vitais entrando sem redigitar, e o horário sem mL fora com o motivo; lança uma perda com a
// intensidade (o tipo pede), confere o saldo com as parcelas, o débito urinário e o alerta de oligúria, e fecha as 24
// horas: o ganho da checagem fica gravado no balanço e a janela fica fechada. axe sem violação séria na escolha, no
// balanço e no diálogo do fechamento. Sessão real sobre a fonte sintética e as portas em MEMÓRIA (dados SINTÉTICOS).
import { expect, type Page, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';

async function entrar(page: Page, login: string): Promise<void> {
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

test.describe('Balanço hídrico @M45 @M45.3 @fase5', () => {
  test.setTimeout(240_000);

  test('janela anterior: ganho da checagem e diurese sem redigitar → perda com intensidade → oligúria → fechar às 7 h; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.ENF.PLANTAO');
    await page.goto('/enfermagem/balanco');
    await expect(page.getByTestId('tela-balanco')).toBeVisible();
    await escolher(page.getByTestId('bh-unidade'), 'UTI');
    await escolher(page.getByTestId('bh-paciente'), '25102');
    await semViolacaoAxe(page, '/enfermagem/balanco (escolha)');
    await page.getByTestId('bh-abrir').click();
    await expect(page).toHaveURL(/\/enfermagem\/balanco\/25102$/);
    await expect(page.getByTestId('bh-paciente-cabecalho')).toContainText('Hora de corte da unidade: 07:00');

    // A janela anterior (7 h de ontem às 7 h de hoje, ou a de antes, conforme a hora).
    await escolher(page.getByTestId('bh-janela'), { indice: 1 });
    const inicio = (await page.getByTestId('bh-janela').getAttribute('data-valor')) ?? '';
    expect(inicio).toMatch(/^\d{4}-\d{2}-\d{2}T07:00$/);
    await expect(page.getByTestId('bh-pendente-checagem-45301')).toContainText('SORO GLICOSADO');
    await expect(page.getByTestId('bh-pendente-checagem-45301')).toContainText('500,0 mL');
    await expect(page.getByTestId('bh-pendente-sinal-45352')).toContainText('600,0 mL');
    await expect(page.getByTestId('bh-sem-volume')).toContainText('DIPIRONA');
    await expect(page.getByTestId('bh-ganhos')).toContainText('500,0 mL');
    await semViolacaoAxe(page, '/enfermagem/balanco/:reg (janela anterior)');

    // A perda com a intensidade (a êmese pede), dentro da janela.
    await escolher(page.getByTestId('bh-tipo'), '3');
    await expect(page.getByTestId('bh-intensidade')).toBeVisible();
    await expect(page.getByTestId('bh-registrar')).toBeDisabled();
    await escolher(page.getByTestId('bh-intensidade'), '2');
    await page.getByTestId('bh-aspecto').fill('bilioso');
    await page.getByTestId('bh-volume').fill('100');
    // Fora da janela em curso, a hora é obrigatória e fica dentro da janela exibida.
    await expect(page.getByTestId('bh-registrar')).toBeDisabled();
    await expect(page.getByTestId('bh-hora')).toHaveAttribute('min', inicio);
    await page.getByTestId('bh-hora').fill(`${inicio.slice(0, 10)}T17:00`);
    await page.getByTestId('bh-registrar').click();
    await expect(page.getByTestId('bh-mensagem')).toContainText('Lançamento registrado');
    await expect(page.getByTestId('bh-lancamentos')).toContainText('Êmese · 2+/4+');
    await expect(page.getByTestId('bh-perdas')).toContainText('700,0 mL');
    // O saldo com as parcelas e o débito urinário (600 mL ÷ 70 kg ÷ 24 h) com o alerta de oligúria.
    await expect(page.getByTestId('bh-saldo')).toContainText('-1.056,8 mL');
    // O gráfico desconta as perdas insensíveis: o último ponto é o saldo do resumo.
    await expect(page.getByTestId('bh-grafico-final')).toHaveAttribute('data-saldo', '-1056.8');
    await expect(page.getByTestId('bh-debito')).toContainText('0,36 mL/kg/h');
    await expect(page.getByTestId('bh-oliguria')).toBeVisible();

    // O fechamento de 24 horas (a janela anterior já passou da hora de corte).
    await page.getByTestId('bh-fechar-total').click();
    await expect(page.getByTestId('bh-fechar-pergunta')).toContainText('Fechar o balanço de 24 horas');
    await semViolacaoAxe(page, '/enfermagem/balanco/:reg (fechar)');
    await page.getByTestId('bh-fechar-confirmar').click();
    await expect(page.getByTestId('bh-mensagem')).toContainText('Balanço de 24 horas fechado');
    await expect(page.getByTestId('bh-fechamento-total')).toContainText('-1.056,8 mL');
    await expect(page.getByTestId('bh-fechamento-total')).toContainText('oligúria');
    // O ganho da checagem e a diurese entraram no balanço (uma vez), e a janela não recebe mais nada.
    await expect(page.locator('[data-testid^="bh-lancamento-"][data-origem="checagem"]')).toHaveCount(1);
    await expect(page.locator('[data-testid^="bh-lancamento-"][data-origem="sinal"]')).toHaveCount(1);
    await expect(page.getByTestId('bh-pendentes')).toHaveCount(0);
    await expect(page.getByTestId('bh-form')).toHaveCount(0);
    expect(externas).toEqual([]);
  });
});
