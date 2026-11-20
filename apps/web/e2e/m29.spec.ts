// E2E @M29 (ficha, seção 10): prescrição sintética → fila → dispensação com etiqueta → aceite no tablet → dose não
// administrada → devolução; controlado com dupla conferência; avaliação com intervenção respondida pelo médico; as
// telas do marco sem violação séria do axe. Sessão real sobre a fonte sintética de dev e a porta da farmácia em
// MEMÓRIA (unidade, internados, horários, itens e lotes SINTÉTICOS; nada vai à cópia).
import { expect, type Page, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher, rotulosDoCombo } from './combos.js';

const SENHA = 'Sintetico#2026';

async function entrar(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

test.describe('Farmácia hospitalar e farmácia clínica @M29', () => {
  test.setTimeout(300_000);

  test('fila → dispensação com etiqueta → aceite no tablet → devolução do não administrado; controlado com dupla conferência; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.FARMACEUTICO');

    // Fila da unidade: os pacientes pelo leito e os horários; dispensa a dipirona do 201-A.
    await page.goto('/farmacia/dispensacao');
    await expect(page.getByTestId('tela-farmacia-dispensacao')).toBeVisible();
    const paciente = page.getByTestId('disp-paciente-9001');
    await expect(paciente).toBeVisible();
    await semViolacaoAxe(page, '/farmacia/dispensacao');
    const marca = paciente.locator('[data-testid^="disp-marca-"]').first();
    await marca.check();
    await page.getByTestId('disp-dispensar-9001').click();
    await expect(page.getByTestId('disp-resultado')).toContainText('Doses dispensadas');
    // A etiqueta da dose: na fila da impressora ou o arquivo para o agente local.
    await expect(page.getByTestId('disp-resultado')).toContainText(/etiquetas/i);

    // Controlado (morfina, lista A1) com o lote escolhido entre os de saldo do local, para a dupla conferência; sem o
    // lote, a tela avisa e não dispensa.
    const p2 = page.getByTestId('disp-paciente-9002');
    const loteMorfina = p2.locator('[data-testid^="disp-lote-"]').first();
    await expect
      .poll(async () => (await rotulosDoCombo(loteMorfina)).filter((r) => r.includes('MRF-77')).length)
      .toBe(1);
    const idLote = (await loteMorfina.getAttribute('data-testid'))!.replace('disp-lote-', '');
    await page.getByTestId(`disp-marca-${idLote}`).check();
    await page.getByTestId('disp-dispensar-9002').click();
    await expect(page.getByTestId('disp-aviso')).toContainText('lote');
    await escolher(loteMorfina, { rotulo: /MRF-77/ });
    await page.getByTestId('disp-dispensar-9002').click();
    await expect(page.getByTestId('disp-resultado')).toContainText('Doses dispensadas');

    // Enfermagem do setor: o aceite no tablet.
    await entrar(page, 'SINT.ENF.SETOR');
    await page.goto('/farmacia/entregas');
    await expect(page.getByTestId('tela-farmacia-entregas')).toBeVisible();
    await semViolacaoAxe(page, '/farmacia/entregas');
    await page.locator('[data-testid^="ent-aceitar-tablet-"]').first().click();
    await expect(page.getByTestId('ent-mensagem')).toContainText('Entrega registrada');

    // A dose não administrada volta ao estoque (devolução da dose).
    await entrar(page, 'SINT.FARMACEUTICO');
    await page.goto('/farmacia/devolucoes');
    await page.getByTestId('devd-atendimento').fill('9001');
    await page.getByTestId('devd-abrir').click();
    const dose = page.getByTestId('devd-dose-7001');
    await expect(dose).toBeVisible();
    await dose.locator('[data-testid^="devd-qtde-"]').fill('1');
    await dose.locator('[data-testid^="devd-devolver-dose-"]').click();
    await expect(page.getByTestId('devd-mensagem')).toContainText('devolvida');
    await semViolacaoAxe(page, '/farmacia/devolucoes');

    // Segunda conferência do controlado por outro farmacêutico, com a senha.
    await entrar(page, 'SINT.FARMACEUTICO2');
    await page.goto('/farmacia/controlados');
    await expect(page.getByTestId('tela-farmacia-controlados')).toBeVisible();
    await page.getByTestId('ctrl-abrir-7003').click();
    await page.getByTestId('ctrl-senha').fill(SENHA);
    await page.locator('[data-testid^="ctrl-conferir-"]').first().click();
    await expect(page.getByTestId('ctrl-mensagem')).toContainText('Segunda conferência');
    await semViolacaoAxe(page, '/farmacia/controlados');

    // Livro em modo conferência e a farmácia ambulatorial desligada (o motivo na tela).
    await page.goto('/farmacia/livro');
    await expect(page.getByTestId('livro-modo')).toContainText('Modo conferência');
    await semViolacaoAxe(page, '/farmacia/livro');
    await page.goto('/farmacia/ambulatorial');
    await expect(page.getByTestId('farmacia-em-consulta')).toContainText('CNAE de farmácia');
    await semViolacaoAxe(page, '/farmacia/ambulatorial');

    // Parâmetros da integração e tipos de envio (consulta, config.parametro.ler).
    await entrar(page, 'SINT.ADMIN');
    await page.goto('/farmacia/parametros');
    await expect(page.getByTestId('tela-farmacia-parametros')).toBeVisible();
    await semViolacaoAxe(page, '/farmacia/parametros');
    await page.goto('/farmacia/avaliacao/tipos');
    await expect(page.getByTestId('tela-farmacia-tipos')).toBeVisible();
    await semViolacaoAxe(page, '/farmacia/avaliacao/tipos');
    expect(externas).toEqual([]);
  });

  test('avaliação com intervenção respondida pelo médico; worklist do farmacêutico; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.FARMACEUTICO');
    await page.goto('/farmacia/avaliacao');
    await expect(page.getByTestId('tela-farmacia-avaliacao')).toBeVisible();
    await expect(page.getByTestId('aval-fila')).toContainText('Antimicrobiano');
    await semViolacaoAxe(page, '/farmacia/avaliacao');
    const item = page.locator('[data-testid^="aval-item-"]', { hasText: 'Antimicrobiano' }).first();
    await item.locator('[data-testid^="aval-abrir-"]').click();
    await expect(page.getByTestId('aval-painel')).toBeVisible();
    await page.getByTestId('aval-texto').fill('Sugiro ajustar o intervalo pela função renal do paciente.');
    await page.getByTestId('aval-intervir').click();
    await expect(page.getByTestId('aval-mensagem')).toContainText('Intervenção registrada');
    await semViolacaoAxe(page, '/farmacia/avaliacao (painel)');

    // O médico chega às intervenções pelo aviso na worklist dele.
    await entrar(page, 'SINT.MEDICO.FARM');
    await page.goto('/inicio/medico');
    await page.getByTestId('wl-medico-intervencoes').click();
    await expect(page).toHaveURL(/\/farmacia\/intervencoes/);
    await expect(page.getByTestId('tela-farmacia-intervencoes')).toBeVisible();
    await semViolacaoAxe(page, '/farmacia/intervencoes');
    await page.locator('[data-testid^="int-aceitar-"]').first().click();
    await expect(page.getByTestId('int-mensagem')).toContainText('aceita');

    await entrar(page, 'SINT.FARMACEUTICO');
    await page.goto('/farmacia/avaliacao');
    const de = page.locator('[data-testid^="aval-item-"]', { hasText: 'Antimicrobiano' }).first();
    await de.locator('[data-testid^="aval-abrir-"]').click();
    await expect(page.getByTestId('aval-intervencoes')).toContainText('aceita');
    await page.getByTestId('aval-decidir').click();
    await expect(page.getByTestId('aval-mensagem')).toContainText('Avaliação registrada');
    await page.goto('/inicio/farmacia');
    await expect(page.getByTestId('tela-worklist-farmacia')).toBeVisible();
    await semViolacaoAxe(page, '/inicio/farmacia');
    expect(externas).toEqual([]);
  });
});
