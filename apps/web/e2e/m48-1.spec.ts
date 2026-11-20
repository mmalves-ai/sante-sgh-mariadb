// E2E @M48.1 (ficha do M48, etapa 1, notificação de incidentes leve e Notivisa; seções 7, 10 e 11): o médico, com o
// prontuário do paciente aberto, usa o botão global "Notificar incidente" da barra superior; o diálogo mostra o paciente
// da tela (só o ID do atendimento sai do navegador) e devolve o número e o código de acompanhamento; o NSP acha a
// notificação na lista, faz a triagem (evento adverso com óbito: atenção imediata), vê o prazo de 72 horas vencido na fila
// de prazos e manda a devolutiva; o notificador lê a devolutiva no acompanhamento pelo número e pelo código. axe sem violação
// séria no diálogo e em cada tela. Sessão real sobre a fonte sintética e as portas em MEMÓRIA (dados SINTÉTICOS; nada
// vai à cópia).
import { expect, type Page, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';

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

test.describe('Notificação de incidentes: botão global, triagem do NSP, prazo de 72 h vencido e devolutiva @M48 @M48.1 @fase5', () => {
  test.setTimeout(240_000);

  test('prontuário → botão global → diálogo → lista do NSP → triagem → fila de prazos → devolutiva → acompanhamento; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);

    // O médico, no prontuário do paciente, notifica pelo botão global (o contexto clínico vem da tela).
    await entrar(page, 'SINT.MEDICO');
    await page.goto('/pep/paciente/1003/linha-do-tempo');
    await expect(page.getByTestId('tela-prontuario-paciente')).toBeVisible();
    await expect(page.getByTestId('linha-do-tempo')).toBeVisible();
    await expect(page.getByTestId('notificar-incidente')).toBeVisible();
    await page.getByTestId('notificar-incidente').click();
    const dialogo = page.getByTestId('dialogo-notificar');
    await expect(dialogo).toBeVisible();
    await expect(dialogo.getByTestId('notificar-explicacao')).toBeVisible();
    await expect(dialogo.getByTestId('notificar-paciente')).toContainText('CINTHYA');
    // A queda foi há 4 dias: o prazo de 72 horas do óbito já venceu quando o NSP faz a triagem.
    const data = dialogo.getByRole('textbox', { name: 'Data do incidente' });
    await data.fill(diasAtras(4));
    await data.blur();
    await escolher(dialogo.getByTestId('notificar-tipo'), 'queda');
    await dialogo.locator('input[name="notificar-chegou"][value="sim"]').check();
    await dialogo.locator('input[name="notificar-dano"][value="obito"]').check();
    await dialogo
      .getByTestId('notificar-descricao')
      .locator('textarea')
      .fill('Queda do leito durante a madrugada, sem grade elevada (texto sintético).');
    await semViolacaoAxe(page, 'diálogo "Notificar incidente" (prontuário)');
    await dialogo.getByTestId('notificar-enviar').click();
    await expect(dialogo.getByTestId('notificacao-enviada')).toBeVisible();
    const protocolo = (await dialogo.getByTestId('notificacao-protocolo').textContent())!.trim();
    const codigo = (await dialogo.getByTestId('notificacao-codigo').textContent())!.trim();
    expect(protocolo).toMatch(/^NSP-\d{4}-\d{6}$/);
    expect(codigo).toMatch(/^[A-Z0-9]{10}$/);
    await semViolacaoAxe(page, 'diálogo "Notificar incidente" (enviada)');

    // O NSP acha a notificação na lista e faz a triagem (evento adverso com óbito).
    await entrar(page, 'SINT.NSP');
    await page.goto('/qualidade/nsp/notificacoes');
    await expect(page.getByTestId('tela-nsp-notificacoes')).toBeVisible();
    await expect(page.getByTestId(`nsp-linha-${protocolo}`)).toBeVisible();
    await semViolacaoAxe(page, '/qualidade/nsp/notificacoes');
    await page.getByTestId(`nsp-abrir-${protocolo}`).click();
    await expect(page.getByTestId('tela-nsp-detalhe')).toBeVisible();
    await expect(page.getByTestId('atencao-imediata')).toBeVisible();
    await expect(page.getByTestId('nsp-paciente')).toContainText('CINTHYA');
    await page.locator('input[name="triagem-classificacao"][value="eventoAdverso"]').check();
    await page.locator('input[name="triagem-dano"][value="obito"]').check();
    await semViolacaoAxe(page, '/qualidade/nsp/notificacoes/:id (triagem)');
    await page.getByTestId('triagem-confirmar').click();
    await expect(page.getByTestId('nsp-feito')).toBeVisible();
    await expect(page.getByTestId('nsp-situacao')).toContainText('Triada');
    await expect(page.getByTestId('nsp-prazos')).toContainText('72 horas');
    const detalhe = page.url();

    // A fila de prazos mostra o prazo do óbito (72 horas) com os campos do Notivisa só com as iniciais.
    await page.goto('/qualidade/nsp/prazos');
    const linha = page.getByTestId(`prazo-linha-${protocolo}`);
    await expect(linha).toBeVisible();
    await expect(linha).toContainText('72 horas');
    await expect(linha.locator('[data-situacao]').first()).toHaveAttribute('data-situacao', 'vencido');
    await page.getByTestId(`prazo-notivisa-${protocolo}`).click();
    await expect(page.getByTestId('gerar-campos')).toBeVisible();
    await semViolacaoAxe(page, '/qualidade/nsp/prazos');

    // A devolutiva ao notificador.
    await page.goto(detalhe);
    await expect(page.getByTestId('painel-devolutiva')).toBeVisible();
    await page
      .getByTestId('devolutiva-texto')
      .locator('textarea')
      .fill(
        'Obrigado pela notificação: a grade do leito passa a ser conferida em toda ronda (texto sintético).',
      );
    await page.getByTestId('devolutiva-enviar').click();
    await expect(page.getByTestId('nsp-feito')).toBeVisible();
    await expect(page.getByTestId('nsp-linha-do-tempo')).toContainText('grade do leito');

    // O notificador lê a devolutiva no acompanhamento (número + código).
    await entrar(page, 'SINT.MEDICO');
    await page.goto('/qualidade/notificar?aba=acompanhar');
    await expect(page.getByTestId('form-acompanhar')).toBeVisible();
    await page.getByTestId('acompanhar-protocolo').locator('input').fill(protocolo);
    await page.getByTestId('acompanhar-codigo').locator('input').fill(codigo);
    await page.getByTestId('acompanhar-consultar').click();
    await expect(page.getByTestId('acompanhamento')).toBeVisible();
    await expect(page.getByTestId('acompanhar-devolutiva').first()).toContainText('grade do leito');
    await semViolacaoAxe(page, '/qualidade/notificar?aba=acompanhar');

    expect(externas).toEqual([]);
  });
});
