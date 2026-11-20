// E2E @M46.2 (ficha do M46, seções 7, 10 e 11; etapa 2: checklist de cirurgia segura, rastreio no bloco e painel para
// familiares): a enfermagem do bloco abre o checklist da cirurgia do próximo dia útil pelo menu e conclui a entrada; o
// anestesista tenta marcar a incisão na ficha anestésica sem a pausa cirúrgica e a trava recusa; a enfermagem conclui a
// pausa (a incisão aparece liberada) e o anestesista marca a incisão; a saída conclui o checklist. O bloco registra a
// entrada do paciente (o código do painel aparece), a ida à sala e a saída; o painel para familiares da TV (token do
// aparelho) mostra só o código, a etapa e o horário — o DOM não tem o nome do paciente, o procedimento nem a sala.
// axe sem violação séria. Sessão real sobre a fonte sintética e as portas em MEMÓRIA (dados SINTÉTICOS).
import { type APIRequestContext, type Browser, expect, type Page, test } from '@playwright/test';
import { ORIGEM, semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const AG = 702;
const PERGUNTAS = new Set([
  'alergiaConhecida',
  'viaAereaDificil',
  'riscoSangramento',
  'problemasEquipamento',
]);

async function entrar(page: Page, login: string): Promise<void> {
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

async function novaAba(browser: Browser, login: string): Promise<Page> {
  const ctx = await browser.newContext({ baseURL: ORIGEM, timezoneId: 'America/Sao_Paulo' });
  const p = await ctx.newPage();
  await entrar(p, login);
  return p;
}

let sequencia = 0;
async function postar(page: Page, url: string, data: unknown) {
  const csrf = (await page.context().cookies()).find((c) => c.name === 'sgh_csrf')?.value ?? '';
  return (page.request as APIRequestContext).post(url, {
    headers: { 'x-csrf': csrf, 'idempotency-key': `e2e-m462-${Date.now()}-${++sequencia}` },
    data: data as object,
  });
}

/** O próximo dia útil em São Paulo (o da cirurgia sintética 702). */
function proximoUtil(): string {
  const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  const d = new Date(`${hoje}T12:00:00Z`);
  do d.setUTCDate(d.getUTCDate() + 1);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
  return d.toISOString().slice(0, 10);
}

/** Responde todos os itens do momento com a resposta que conclui (a pergunta com "Não"), confirma e conclui. */
async function concluirMomento(page: Page, momento: 'inducao' | 'incisao' | 'saida'): Promise<void> {
  const m = page.getByTestId(`chk-momento-${momento}`);
  const itens = m.locator('[data-testid^="chk-item-"]');
  const n = await itens.count();
  for (let i = 0; i < n; i++) {
    const item = itens.nth(i);
    const codigo = ((await item.getAttribute('data-testid')) ?? '').replace('chk-item-', '');
    // As perguntas (alergia, via aérea, sangramento, equipamento) com "Não"; os itens a fazer com "Sim".
    await item.getByLabel(PERGUNTAS.has(codigo) ? 'Não' : 'Sim', { exact: true }).check();
  }
  await page.getByTestId(`chk-confirmar-${momento}`).click();
  await expect(page.getByTestId('chk-mensagem')).toContainText('confirmados');
  await expect(page.getByTestId(`chk-concluir-${momento}`)).toBeEnabled();
  await page.getByTestId(`chk-concluir-${momento}`).click();
  await expect(page.getByTestId(`chk-concluido-${momento}`)).toBeVisible();
}

test.describe('Checklist de cirurgia segura, rastreio no bloco e painel para familiares @M46 @M46.2 @fase5', () => {
  test.setTimeout(300_000);

  test('checklist em três momentos com a trava da incisão; rastreio com o código; painel da família sem nome; axe', async ({
    page,
    browser,
  }) => {
    const externas = vigiarExternas(page);
    const dia = proximoUtil();

    // A enfermagem do bloco (circulante) pelo menu do checklist: a cirurgia do próximo dia útil.
    await entrar(page, 'SINT.ENF.BLOCO');
    await page.goto('/bloco/checklist');
    await expect(page.getByTestId('tela-checklist')).toBeVisible();
    await page.getByTestId('chk-data').fill(dia);
    await expect(page.getByTestId(`chk-cirurgia-${AG}`)).toContainText('Não iniciado');
    await semViolacaoAxe(page, '/bloco/checklist (escolha)');
    await page.getByTestId(`chk-abrir-${AG}`).click();
    await expect(page).toHaveURL(new RegExp(`/bloco/checklist/${AG}$`));
    await expect(page.getByTestId('chk-incisao')).toContainText('aguardando a pausa cirúrgica');
    // A pausa não conclui antes da entrada (o botão fica desabilitado: há itens pendentes e a ordem).
    await expect(page.getByTestId('chk-concluir-incisao')).toBeDisabled();
    // A alergia conhecida com "Sim" pede a observação.
    await page.getByTestId('chk-item-alergiaConhecida').getByLabel('Sim', { exact: true }).check();
    await expect(page.getByTestId('chk-obs-alergiaConhecida')).toBeVisible();
    await page.getByTestId('chk-item-alergiaConhecida').getByLabel('Não', { exact: true }).check();
    await semViolacaoAxe(page, '/bloco/checklist/:agenda');
    await concluirMomento(page, 'inducao');

    // O anestesista tenta marcar a incisão na ficha sem a pausa cirúrgica: a trava recusa.
    const anest = await novaAba(browser, 'SINT.ANESTESISTA');
    await anest.goto(`/bloco/ficha-anestesica/${AG}`);
    await expect(anest.getByTestId('tela-ficha-anestesica')).toBeVisible();
    await anest.getByTestId('fa-marcar-entradaSala').click();
    await expect(anest.getByTestId('fa-marco-entradaSala')).not.toContainText('Marcar agora');
    await anest.getByTestId('fa-marcar-inicioAnestesia').click();
    await expect(anest.getByTestId('fa-marco-inicioAnestesia')).not.toContainText('Marcar agora');
    await anest.getByTestId('fa-marcar-inicioCirurgia').click();
    await expect(anest.getByTestId('recusa-anestesia')).toContainText('pausa cirúrgica');
    await expect(anest.getByTestId('fa-marco-inicioCirurgia')).toContainText('Marcar agora');

    // A pausa cirúrgica concluída: a incisão aparece liberada e o anestesista marca a incisão.
    await concluirMomento(page, 'incisao');
    await expect(page.getByTestId('chk-incisao')).toContainText('Incisão liberada');
    await anest.reload();
    await anest.getByTestId('fa-marcar-inicioCirurgia').click();
    await expect(anest.getByTestId('fa-marco-inicioCirurgia')).not.toContainText('Marcar agora');
    await anest.context().close();
    await concluirMomento(page, 'saida');
    await expect(page.getByTestId('chk-momento-saida')).toContainText('Concluído às');
    await semViolacaoAxe(page, '/bloco/checklist/:agenda (concluído)');

    // O quadro do bloco e o rastreio: a entrada cria o código do painel; a ida à sala.
    const bloco = await novaAba(browser, 'SINT.BLOCO');
    await bloco.goto('/bloco/rastreio');
    await expect(bloco.getByTestId('tela-rastreio')).toBeVisible();
    await bloco.getByTestId('ras-data').fill(dia);
    await expect(bloco.getByTestId(`ras-seguranca-${AG}`)).toContainText(
      'Entrada feito · Pausa feito · Saída feito',
    );
    await expect(bloco.getByTestId('ras-totais')).toContainText('Cirurgias: 2');
    await semViolacaoAxe(bloco, '/bloco/rastreio (quadro)');
    await bloco.getByTestId(`ras-abrir-${AG}`).click();
    await expect(bloco.getByTestId('ras-paciente')).toBeVisible();
    await escolher(bloco.getByTestId('ras-local'), '1');
    await bloco.getByTestId('ras-registrar').click();
    await expect(bloco.getByTestId('ras-mensagem')).toContainText('Pré-operatório');
    const codigo = ((await bloco.getByTestId('ras-codigo-valor').textContent()) ?? '').trim();
    expect(codigo).toMatch(/^[A-Z]{3}-\d{3}$/);
    await escolher(bloco.getByTestId('ras-tipo'), 'transferencia');
    await escolher(bloco.getByTestId('ras-local'), '3');
    await escolher(bloco.getByTestId('ras-sala-cirurgica'), '2');
    await bloco.getByTestId('ras-registrar').click();
    await expect(bloco.getByTestId('ras-mensagem')).toContainText('Sala cirúrgica');
    await expect(bloco.getByTestId(`ras-local-${AG}`)).toContainText('Sala cirúrgica 2');
    await semViolacaoAxe(bloco, '/bloco/rastreio (paciente)');

    // O painel para familiares da TV (token do aparelho): só o código, a etapa e o horário.
    const senhas = await novaAba(browser, 'SINT.SENHAS');
    const tv = await postar(senhas, '/api/recepcao/dispositivos', {
      tipo: 'paineltv',
      nome: 'TV da espera do centro cirúrgico',
      recepcao: null,
      locais: [],
      geradores: [],
      conteudo: 'bloco',
      portalOrdem: null,
      usuarioLegado: null,
      validadeDias: 30,
      voz: false,
    });
    expect(tv.status(), await tv.text()).toBe(201);
    const criado = (await tv.json()) as { endereco: string; token: string };
    expect(criado.endereco).toMatch(/^\/paineis\/bloco-familia\/\d+$/);
    await senhas.goto(`${criado.endereco}#token=${criado.token}`);
    const painel = senhas.getByTestId('painel-bloco-familia');
    await expect(painel.getByTestId(`painel-familia-${codigo}`)).toContainText('Em cirurgia');
    // Regra 5 (verificação do DOM): nenhum nome, procedimento, sala nem número do agendamento.
    const texto = (await painel.textContent()) ?? '';
    expect(texto).not.toMatch(/PACIENTE|SINTETICO|COLECIST|HERNIO|Sala cirúrgica|\b702\b/i);
    await semViolacaoAxe(senhas, '/paineis/bloco-familia/:dispositivo');

    // A saída do bloco: o painel mostra "Saiu do centro cirúrgico" logo depois (propagação abaixo de 2 s).
    await escolher(bloco.getByTestId('ras-tipo'), 'alta');
    await escolher(bloco.getByTestId('ras-destino'), 'unidade');
    await bloco.getByTestId('ras-registrar').click();
    await expect(bloco.getByTestId('ras-mensagem')).toContainText('Saída do bloco registrada');
    await expect(painel.getByTestId(`painel-familia-${codigo}`)).toContainText('Saiu do centro cirúrgico', {
      timeout: 3_000,
    });
    await senhas.context().close();
    await bloco.context().close();
    expect(externas).toEqual([]);
  });
});
