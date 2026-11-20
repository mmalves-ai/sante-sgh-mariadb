// E2E @M50.4 (ficha do M50, seção 10, na parte da etapa 4): "teleconsulta com simulador".
//   - a recepção emite o convite e a paciente sintética 1003 ativa a conta (o mesmo caminho da etapa 1);
//   - no portal, a teleconsulta de hoje (a semente da sessão sintética): a sala de espera pede o termo e o local; a
//     paciente aceita, informa o estado e a cidade e fica na sala de espera;
//   - o médico vê a paciente na espera, o alerta do crônico sem consulta presencial, confirma a declaração e o CID e
//     inicia: a sala do provedor simulado abre e o atendimento é aberto como uma consulta; a paciente entra na sala;
//   - a teleinterconsulta: o médico pede a opinião do cardiologista no atendimento aberto, com o consentimento; o
//     convidado abre a sala e registra o parecer; o médico encerra a teleconsulta como concluída;
//   - a paciente marca outra consulta por teleconsulta pelo Agendar (a agenda que oferece);
//   - a agenda oferecida no portal com a teleconsulta, na tela interna.
// axe sem violação séria nas telas; nenhuma requisição externa. Sessão real sobre a fonte sintética de dev e as portas em
// MEMÓRIA (pacientes, agendas e e-mails SINTÉTICOS; o provedor de vídeo é o simulado).
import { createHmac } from 'node:crypto';
import { expect, type Page, test } from '@playwright/test';
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

/** O código do aplicativo autenticador (TOTP de 30 s, 6 dígitos, SHA-1). */
function totp(segredoBase32: string, agora = Date.now()): string {
  const ALF = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of segredoBase32.replace(/=+$/, '').toUpperCase())
    bits += ALF.indexOf(c).toString(2).padStart(5, '0');
  const bytes = Buffer.from((bits.match(/.{8}/g) ?? []).map((b) => parseInt(b, 2)));
  const passo = Buffer.alloc(8);
  passo.writeBigUInt64BE(BigInt(Math.floor(agora / 1000 / 30)));
  const h = createHmac('sha1', bytes).update(passo).digest();
  const o = h[h.length - 1]! & 0xf;
  const n = ((h[o]! & 0x7f) << 24) | (h[o + 1]! << 16) | (h[o + 2]! << 8) | h[o + 3]!;
  return String(n % 1_000_000).padStart(6, '0');
}

test.describe('telemedicina, etapa 4: sala de espera, teleconsulta com o simulador e teleinterconsulta @M50.4', () => {
  test.setTimeout(360_000);

  test('termo e local na sala de espera → o médico inicia com o alerta do crônico → a paciente entra → teleinterconsulta → encerra; teleconsulta pelo Agendar; axe', async ({
    page,
    browser,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.RECEPCAO');
    await page.goto('/cadastros/pacientes/1003');
    await page.getByTestId('conta-portal-convidar').click();
    const codigo = (await page.getByTestId('conta-portal-codigo').innerText()).trim();

    // A paciente ativa a conta do portal.
    const contexto = await browser.newContext();
    const pac = await contexto.newPage();
    const externasPac = vigiarExternas(pac);
    await pac.goto('/paciente');
    await pac.getByTestId('pac-primeiro-acesso').click();
    await pac.getByTestId('pac-convite').fill(codigo);
    await pac.getByTestId('pac-nascimento').fill('1990-07-01');
    await pac.getByTestId('pac-conferir').click();
    await pac.getByTestId('pac-email-novo').fill('cinthya.m504@portal.test');
    await pac.getByTestId('pac-senha-nova').fill('frase-sintetica-longa');
    await pac.getByTestId('pac-confirmacao').fill('frase-sintetica-longa');
    await pac.getByTestId('pac-termo').check();
    await pac.getByTestId('pac-politica').check();
    await pac.getByTestId('pac-dados').click();
    await expect(pac.getByTestId('pac-qr')).toBeVisible();
    const chave = /aplicativo:\s*([A-Z2-7]+)/.exec(await pac.locator('form').innerText())?.[1] ?? '';
    await pac.getByTestId('pac-codigo-novo').fill(totp(chave));
    await pac.getByTestId('pac-confirmar').click();
    await expect(pac.getByTestId('portal-ativada')).toBeVisible();

    // A teleconsulta de hoje: a sala de espera pede o termo e o local.
    await pac.getByTestId('portal-menu-teleconsulta').click();
    const item = pac.locator('[data-testid^="pac-tele-abrir-"]').first();
    await expect(item).toBeVisible();
    await semViolacaoAxe(pac, '/paciente/teleconsulta');
    await item.click();
    await expect(pac.getByTestId('pac-tele-termo')).toBeVisible();
    await pac.getByTestId('pac-tele-esperar').click();
    await expect(pac.getByTestId('pac-tele-sala')).toContainText('Leia e aceite o termo');
    await pac.getByTestId('pac-tele-aceito').check();
    await escolher(pac.getByTestId('pac-tele-uf'), 'RJ');
    await pac.locator('#pac-tele-municipio').fill('Petropolis');
    await pac.getByTestId('pac-tele-esperar').click();
    await expect(pac.getByTestId('pac-tele-na-espera')).toBeVisible();
    await expect(pac.getByTestId('pac-tele-situacao')).toContainText('Na sala de espera');
    await semViolacaoAxe(pac, '/paciente/teleconsulta/:id (sala de espera)');

    // O médico: a paciente na espera, o alerta do crônico, a declaração e o CID; iniciar.
    await entrar(page, 'SINT.MEDICO');
    await page.goto('/pep/telemedicina');
    const espera = page.locator('[data-testid^="tele-espera-"]').first();
    await expect(espera).toBeVisible();
    await semViolacaoAxe(page, '/pep/telemedicina');
    const id = /tele-espera-(\d+)/.exec((await espera.getAttribute('data-testid')) ?? '')![1]!;
    await page.getByTestId(`tele-abrir-${id}`).click();
    await expect(page.getByTestId('teled-alerta')).toContainText('sem consulta presencial');
    await expect(page.getByTestId('teled-local')).toContainText('PETROPOLIS/RJ');
    await semViolacaoAxe(page, '/pep/telemedicina/:id (antes de iniciar)');
    await page.locator('#teled-busca-cid').fill('I10');
    await page.locator('#teled-busca-cid').press('Enter');
    await escolher(page.getByTestId('teled-cid'), '2');
    await page.getByTestId('teled-declaracao').check();
    await page.getByTestId('teled-ciente').check();
    await page.getByTestId('teled-iniciar-acao').click();
    await expect(page.getByTestId('teled-mensagem')).toContainText('Teleconsulta iniciada');
    await expect(page.getByTestId('teled-sala-simulada')).toContainText('SIM-SALA-');
    await expect(page.getByTestId('teled-atendimento')).toBeVisible();
    await semViolacaoAxe(page, '/pep/telemedicina/:id (em andamento)');

    // A paciente entra na sala do médico (a sala simulada).
    await pac.reload();
    await pac.getByTestId('pac-tele-entrar').click();
    await expect(pac.getByTestId('pac-tele-simulada')).toContainText('nenhuma imagem nem som sai');
    await semViolacaoAxe(pac, '/paciente/teleconsulta/:id (na sala)');

    // A teleinterconsulta no atendimento aberto: o cardiologista convidado, o motivo e o consentimento.
    await page.goto('/pep/telemedicina');
    await page.locator('#tele-busca-atd').press('Enter');
    await escolher(page.getByTestId('tele-pedir-atendimento'), { indice: 1 });
    await escolher(page.getByTestId('tele-pedir-convidado'), '7102');
    await page.locator('#tele-pedir-motivo').fill('Opinião sobre o controle da pressão SINTETICO');
    await page.getByTestId('tele-pedir-consentimento').check();
    await page.getByTestId('tele-pedir-enviar').click();
    await expect(page.getByTestId('tele-mensagem')).toContainText('Teleinterconsulta pedida');

    const ctxCardio = await browser.newContext();
    const cardio = await ctxCardio.newPage();
    const externasCardio = vigiarExternas(cardio);
    await entrar(cardio, 'SINT.CARDIO.TELE');
    await cardio.goto('/pep/telemedicina');
    const inter = cardio.locator('[data-testid^="tele-inter-abrir-"]').first();
    await expect(inter).toBeVisible();
    await inter.click();
    await cardio.getByTestId('teled-inter-sala').click();
    await expect(cardio.getByTestId('teled-sala-simulada')).toBeVisible();
    await cardio.locator('#teled-parecer-texto').fill('Sem contraindicação ao ajuste SINTETICO');
    await cardio.getByTestId('teled-responder').click();
    await expect(cardio.getByTestId('teled-mensagem')).toContainText('Parecer registrado');
    await expect(cardio.getByTestId('teled-parecer')).toContainText('Sem contraindicação');
    await semViolacaoAxe(cardio, '/pep/telemedicina/:id (teleinterconsulta)');

    // O médico encerra a teleconsulta como concluída.
    await page.goto(`/pep/telemedicina/${id}`);
    await page.getByTestId('teled-encerrar-acao').click();
    await page.getByTestId('confirmacao').getByRole('button', { name: 'Confirmar' }).click();
    await expect(page.getByTestId('teled-mensagem')).toContainText('Teleconsulta encerrada');
    await pac.reload();
    await expect(pac.getByTestId('pac-tele-situacao')).toContainText('Encerrada');

    // Outra consulta por teleconsulta pelo Agendar (a agenda sintética oferece a teleconsulta).
    await pac.getByTestId('portal-menu-agendar').click();
    await escolher(pac.getByTestId('pac-modalidade'), 'teleconsulta');
    await escolher(pac.getByTestId('pac-convenio'), '10');
    await pac.getByTestId('pac-buscar').click();
    await pac.locator('[data-testid^="pac-horario-"]').last().click();
    await pac.getByTestId('pac-confirmar').click();
    await expect(pac.getByTestId('pac-agenda-aviso')).toContainText('Teleconsulta marcada');
    await expect(pac.locator('[data-testid^="pac-tele-"]').first()).toContainText('Teleconsulta');
    await semViolacaoAxe(pac, '/paciente/agendar (teleconsulta)');

    // A agenda oferecida no portal com a teleconsulta (tela interna).
    await entrar(page, 'SINT.AGENDA');
    await page.goto('/agenda/online');
    await page.getByTestId('online-abrir-consulta-902').click();
    await expect(page.getByTestId('online-teleconsulta')).toBeChecked();

    expect(externas).toEqual([]);
    expect(externasPac).toEqual([]);
    expect(externasCardio).toEqual([]);
    await contexto.close();
    await ctxCardio.close();
  });
});
