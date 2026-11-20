// E2E @M48.3 (ficha do M48, etapa 3, CCIH; seções 7, 8, 10 e 11): o médico abre a prescrição do paciente internado e vê o
// alerta do antimicrobiano restrito sem liberação no prazo da política (regra 6: só informa, nada é suspenso); a CCIH
// acha o paciente na vigilância ativa, abre a ficha e registra o cateter venoso central; libera o restrito na fila dos
// antimicrobianos e o alerta some da prescrição; define a precaução de contato por KPC (regra 7), que o médico vê no
// cabeçalho do prontuário, e a encerra pelas culturas negativas; os denominadores e a higiene das mãos abrem. axe sem violação séria em cada tela. Sessão real
// sobre a fonte sintética e as portas em MEMÓRIA (dados SINTÉTICOS; nada vai à cópia).
import { expect, type Page, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
/** A internação sintética com o restrito vencido (porta em memória da CCIH) e o item prescrito dela. */
const INTERNACAO = 4801;
const ITEM = 480101;

/** A data de n dias atrás no relógio do estabelecimento sintético (America/Sao_Paulo), DD/MM/AAAA. */
function diasAtras(n: number): string {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(Date.now() - n * 86_400_000));
  const v = (t: string) => p.find((x) => x.type === t)?.value ?? '00';
  return `${v('day')}/${v('month')}/${v('year')}`;
}

async function entrar(page: Page, login: string): Promise<void> {
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

async function prescricao(page: Page): Promise<void> {
  await entrar(page, 'SINT.MEDICO');
  await page.goto('/pep/paciente/1003/prescricao');
  await expect(page.getByTestId('tela-prescricao-paciente')).toBeVisible();
}

test.describe('CCIH: alerta do restrito, vigilância e dispositivo, liberação, precaução definida e encerrada @M48 @M48.3 @fase5', () => {
  test.setTimeout(240_000);

  test('prescrição com alerta → vigilância → ficha → cateter → liberação → alerta some → precaução → encerrada; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);

    // O prescritor vê o alerta do restrito sem liberação no prazo; a prescrição segue valendo.
    await prescricao(page);
    const alerta = page.getByTestId('alerta-antimicrobiano-ccih');
    await expect(alerta).toBeVisible();
    await expect(alerta).toContainText('MEROPENEM');
    await semViolacaoAxe(page, '/pep/paciente/:id/prescricao (alerta da CCIH)');

    // A CCIH acha o paciente na vigilância ativa e registra o cateter na ficha.
    await entrar(page, 'SINT.CCIH');
    await expect(page.getByTestId('cartao-ccih')).toBeVisible();
    await page.goto('/qualidade/ccih/vigilancia');
    await expect(page.getByTestId('tela-ccih-vigilancia')).toBeVisible();
    await expect(page.getByTestId(`vigilancia-${INTERNACAO}`)).toBeVisible();
    await semViolacaoAxe(page, '/qualidade/ccih/vigilancia');
    await page.getByTestId(`abrir-${INTERNACAO}`).click();
    const ficha = page.getByTestId('ficha-internado');
    await expect(ficha).toBeVisible();
    await expect(ficha.getByTestId('ficha-antimicrobianos')).toContainText('MEROPENEM');
    await ficha.getByTestId('novo-dispositivo').click();
    await escolher(ficha.getByTestId('dispositivo-tipo'), 'cvc');
    const data = ficha.getByRole('textbox', { name: 'Data da inserção' });
    await data.fill(diasAtras(2));
    await data.blur();
    const hora = ficha.getByRole('textbox', { name: 'Hora da inserção' });
    await hora.fill('08:30');
    await hora.blur();
    await semViolacaoAxe(page, '/qualidade/ccih/vigilancia (ficha, novo dispositivo)');
    await ficha.getByTestId('dispositivo-gravar').click();
    await expect(ficha.getByTestId('ficha-dispositivos')).toContainText('Cateter venoso central');

    // A CCIH libera o restrito na fila (com os dias autorizados).
    await page.goto('/qualidade/ccih/antimicrobianos');
    await expect(page.getByTestId('tela-ccih-antimicrobianos')).toBeVisible();
    await expect(page.getByTestId(`atm-${ITEM}`)).toBeVisible();
    await semViolacaoAxe(page, '/qualidade/ccih/antimicrobianos');
    await page.getByTestId(`decidir-${ITEM}`).click();
    const decisao = page.getByTestId('form-decisao');
    await escolher(decisao.getByTestId('decisao'), 'liberado');
    await decisao.getByTestId('decisao-dias').locator('input').fill('7');
    await decisao
      .getByTestId('decisao-justificativa')
      .locator('textarea')
      .fill('Cultura com enterobactéria sensível só a carbapenêmico (texto sintético).');
    await decisao.getByTestId('decisao-gravar').click();
    await expect(page.getByTestId('atm-aviso')).toBeVisible();
    // O consumo da competência (DDD por 1.000 pacientes-dia e DOT, com as parcelas).
    await page.locator('input[name="secao-atm"][value="consumo"]').check();
    await expect(page.getByTestId('atm-consumo')).toBeVisible();
    await expect(page.getByTestId('consumo-ddd')).toBeVisible();
    await semViolacaoAxe(page, '/qualidade/ccih/antimicrobianos (consumo)');

    // A precaução de contato por KPC, definida e encerrada pela CCIH.
    await page.goto('/qualidade/ccih/precaucoes');
    await expect(page.getByTestId('tela-ccih-precaucoes')).toBeVisible();
    await escolher(page.getByTestId('precaucao-paciente'), { rotulo: /PACIENTE SINTETICO CCIH/ });
    await page.getByTestId('precaucao-nova').click();
    const form = page.getByTestId('formulario-precaucao');
    await expect(form).toBeVisible();
    await escolher(form.getByTestId('precaucao-motivo'), 'kpc');
    await expect(form.locator('input[name="precaucao-tipo"][value="contato"]')).toBeChecked();
    await semViolacaoAxe(page, '/qualidade/ccih/precaucoes (definir)');
    await form.getByTestId('precaucao-gravar').click();
    const tabela = page.getByTestId('tabela-precaucoes');
    await expect(tabela).toContainText('KPC');
    await expect(tabela).toContainText('PACIENTE SINTETICO CCIH');
    await semViolacaoAxe(page, '/qualidade/ccih/precaucoes (aberta)');

    // A precaução aparece no cabeçalho do prontuário (regra 7) para o médico.
    await entrar(page, 'SINT.MEDICO');
    await page.goto('/pep/paciente/1003/linha-do-tempo');
    await expect(page.getByTestId('tela-prontuario-paciente')).toBeVisible();
    await expect(page.getByTestId('precaucao-cabecalho')).toContainText('Precaução de contato');
    await expect(page.getByTestId('precaucao-cabecalho')).toContainText('KPC');
    await semViolacaoAxe(page, '/pep/paciente/:id/linha-do-tempo (precaução no cabeçalho)');

    // A CCIH encerra a precaução pelas culturas de controle negativas.
    await entrar(page, 'SINT.CCIH');
    await page.goto('/qualidade/ccih/precaucoes');
    await tabela.locator('[data-testid^="encerrar-"]').first().click();
    const fim = page.getByTestId('form-encerrar');
    await escolher(fim.getByTestId('encerrar-motivo'), 'culturasNegativas');
    await fim.getByTestId('encerrar-gravar').click();
    await expect(page.getByTestId('precaucoes-nenhuma')).toBeVisible();

    // Denominadores com as contas e a higiene das mãos (tablet) abrem sem violação.
    await page.goto('/qualidade/ccih/iras');
    await expect(page.getByTestId('tela-ccih-iras')).toBeVisible();
    await expect(page.getByTestId('tabela-denominadores')).toBeVisible();
    await semViolacaoAxe(page, '/qualidade/ccih/iras');
    await page.goto('/qualidade/ccih/maos-surtos');
    await expect(page.getByTestId('tela-ccih-maos-surtos')).toBeVisible();
    await semViolacaoAxe(page, '/qualidade/ccih/maos-surtos');

    // Liberado o restrito, o alerta some da prescrição.
    await prescricao(page);
    await expect(page.getByTestId('escolher-atendimento')).toBeVisible();
    await expect(page.getByTestId('alerta-antimicrobiano-ccih')).toHaveCount(0);

    expect(externas).toEqual([]);
  });
});
