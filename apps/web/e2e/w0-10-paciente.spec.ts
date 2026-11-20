// E2E @W0-10 (parte 11c1): as trocas da conta do portal do paciente e o cancelamento do pedido LGPD.
//   - a recepção emite o convite na ficha do paciente; o paciente, em outro navegador, faz o primeiro acesso (2FA);
//   - Conta e segurança: troca o aplicativo autenticador (senha e código atuais → QR novo → primeiro código do novo);
//   - Privacidade: abre um pedido do titular e o cancela com motivo (diálogo de confirmação; "Cancelar" no diálogo não
//     cancela); o pedido fica "Cancelado por você", sem o botão; cancelar de novo pela API devolve 409;
//   - troca o e-mail (senha e código do autenticador NOVO): o link vai ao e-mail NOVO, que no dev é a caixa do
//     simulador (lida pela tela interna, nenhuma saída do processo); a conta só muda ao confirmar pelo link; a ficha da
//     recepção mostra a troca pendente; depois de confirmar, a entrada com o e-mail novo e o autenticador novo funciona.
// Parte 11c2a (segundo teste, em série, com a mesma conta): a cópia do prontuário pedida pelo portal (painel de
// confirmação; "Voltar" não pede), conferida, gerada (PDF com marca d'água, hash) e entregue pelo portal na fila interna
// (/portais/paciente/copias, legitimidade e entrega com a senha), baixada pelo paciente; o pedido fica "Respondido" e
// cancelar o respondido pela API devolve 409 (o protocolado não se edita); a portabilidade aberta não tem o pacote IPS
// (sem link, 409 pela API). Revisão: atendida na privacidade interna (SINT.ADMIN, canal "Portal do paciente"), o link
// aparece e o Bundle IPS baixado (document, Composition e Patient) confere com o x-pacote-sha256 e o application/fhir+json.
// Parte 11c2b1 (terceiro teste): a manifestação à ouvidoria pelo portal (confirmação; "Voltar" não envia) aparece na
// ouvidoria interna (SINT.OUVIDORIA, canal "Portal do paciente"), é respondida lá e o paciente lê o protocolo e a resposta.
// Parte 11c2c (quarto teste): a agenda de exames 952 liberada no portal (/agenda/online, uma gravação só); o paciente
// marca o exame e o remarca (novo horário, motivo, confirmação; agenda.remarcarExame, o horário anterior some); paga uma
// consulta particular por Pix simulado; a tesouraria (/tesouraria/portal, SINT.FIN.CONCILIA) registra a divergência
// ("Voltar" no painel não registra) e a baixa, é recusada ao estornar o que conciliou (segregação) e SINT.FIN.TESFIS
// estorna com motivo, senha e confirmação.
// axe sem violação séria nas telas; nenhuma requisição externa. Sessão real sobre a fonte sintética de dev e as portas
// em MEMÓRIA (paciente, conta, pedidos e mensagens SINTÉTICOS).
import { createHash, createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const SENHA_PAC = 'frase-sintetica-longa-w010';
const EMAIL = 'jose.w010@portal.test';
const EMAIL_NOVO = 'jose.novo.w010@portal.test';

async function entrar(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

/** O código do aplicativo autenticador (TOTP de 30 s, 6 dígitos, SHA-1), como o do celular do paciente. */
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

/** O código vale uma vez por conta: cada uso espera o passo de 30 s seguinte ao último usado. */
let ultimoPasso = 0;
/** O segredo do autenticador vigente da conta (o segundo teste entra com ele). */
let chaveConta = '';
async function codigoNovo(page: Page, segredo: string): Promise<string> {
  for (;;) {
    const passo = Math.floor(Date.now() / 1000 / 30);
    // Folga de 2 s antes da virada (o código não pode vencer no caminho até o servidor).
    const resta = 30_000 - (Date.now() % 30_000);
    if (passo > ultimoPasso && resta > 2_000) {
      ultimoPasso = passo;
      return totp(segredo);
    }
    await page.waitForTimeout(Math.min(resta + 300, 30_000));
  }
}

function csrf(cookies: { name: string; value: string }[]): string {
  return cookies.find((c) => c.name === 'sgh_pac_csrf')?.value ?? '';
}

test.describe.serial('portal do paciente: trocas da conta, pedido LGPD e cópia do prontuário @W0-10', () => {
  test.setTimeout(360_000);

  test('convite → primeiro acesso → troca do autenticador → pedido cancelado com motivo (409 de novo) → troca do e-mail pelo simulador → entrada com os novos; axe', async ({
    page,
    browser,
  }) => {
    const externas = vigiarExternas(page);
    // A recepção emite o convite na ficha do paciente.
    await entrar(page, 'SINT.RECEPCAO');
    await page.goto('/cadastros/pacientes/1001');
    await expect(page.getByTestId('conta-portal')).toBeVisible();
    await page.getByTestId('conta-portal-convidar').click();
    const convite = (await page.getByTestId('conta-portal-codigo').innerText()).trim();
    expect(convite).toMatch(/^[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/);

    // O paciente, em outro navegador: o primeiro acesso.
    const contexto = await browser.newContext();
    const pac = await contexto.newPage();
    const externasPac = vigiarExternas(pac);
    await pac.goto('/paciente');
    await expect(pac.getByTestId('tela-portal-paciente')).toBeVisible();
    await pac.getByTestId('pac-primeiro-acesso').click();
    await pac.getByTestId('pac-convite').fill(convite);
    await pac.getByTestId('pac-nascimento').fill('1958-03-12');
    await pac.getByTestId('pac-conferir').click();
    await pac.getByTestId('pac-email-novo').fill(EMAIL);
    await pac.getByTestId('pac-senha-nova').fill(SENHA_PAC);
    await pac.getByTestId('pac-confirmacao').fill(SENHA_PAC);
    await pac.getByTestId('pac-termo').check();
    await pac.getByTestId('pac-politica').check();
    await pac.getByTestId('pac-dados').click();
    await expect(pac.getByTestId('pac-qr')).toBeVisible();
    const chave = /aplicativo:\s*([A-Z2-7]+)/.exec(await pac.locator('form').innerText())?.[1] ?? '';
    expect(chave.length).toBeGreaterThanOrEqual(16);
    await pac.getByTestId('pac-codigo-novo').fill(await codigoNovo(pac, chave));
    await pac.getByTestId('pac-confirmar').click();
    await expect(pac.getByTestId('portal-ativada')).toBeVisible();

    // Conta e segurança: a troca do aplicativo autenticador.
    await pac.getByTestId('portal-menu-seguranca').click();
    await expect(pac.getByTestId('portal-seguranca')).toBeVisible();
    await semViolacaoAxe(pac, '/paciente/seguranca');
    await pac.locator('#pac-2fa-senha').fill(SENHA_PAC);
    await pac.locator('#pac-2fa-cod').fill(await codigoNovo(pac, chave));
    await pac.getByTestId('pac-2fa-iniciar').click();
    await expect(pac.getByTestId('pac-2fa-qr')).toBeVisible();
    const secao2fa = pac.locator('section[aria-labelledby="pac-trocar-2fa"]');
    const chaveNova = /aplicativo:\s*([A-Z2-7]+)/.exec(await secao2fa.innerText())?.[1] ?? '';
    expect(chaveNova.length).toBeGreaterThanOrEqual(16);
    expect(chaveNova).not.toBe(chave);
    await semViolacaoAxe(pac, '/paciente/seguranca (autenticador novo)');
    await pac.getByTestId('pac-2fa-novo').fill(await codigoNovo(pac, chaveNova));
    await pac.getByTestId('pac-2fa-confirmar').click();
    await expect(secao2fa).toContainText('Aplicativo autenticador trocado');
    await expect(pac.getByTestId('pac-2fa-qr')).toHaveCount(0);

    // Privacidade: o pedido do titular aberto é cancelado com motivo.
    await pac.getByTestId('portal-menu-privacidade').click();
    await escolher(pac.getByTestId('pac-tipo-pedido'), 'acesso');
    await pac.getByTestId('pac-pedir-titular').click();
    await expect(pac.getByTestId('pac-pedido-registrado')).toContainText('protocolo');
    const protocolo = /protocolo\s+(\d{4}-\d+)/.exec(
      await pac.getByTestId('pac-pedido-registrado').innerText(),
    )![1]!;
    const cancelar = pac.getByTestId(`pac-cancelar-pedido-${protocolo}`);
    await expect(cancelar).toBeVisible();
    await cancelar.click();
    await expect(pac.getByTestId('pac-cancelar-pedido')).toContainText(protocolo);
    await escolher(pac.getByTestId('pac-motivo-cancelar'), { indice: 0 });
    await semViolacaoAxe(pac, '/paciente/privacidade (cancelar pedido)');
    // "Cancelar" no diálogo de confirmação não cancela.
    await pac.getByTestId('pac-cancelar-enviar').click();
    await pac.getByTestId('confirmacao').getByRole('button', { name: 'Cancelar' }).click();
    await expect(pac.getByTestId('pac-pedido-cancelado')).toHaveCount(0);
    await expect(cancelar).toBeVisible();
    await pac.getByTestId('pac-cancelar-enviar').click();
    await pac.getByTestId('confirmacao').getByRole('button', { name: 'Confirmar' }).click();
    await expect(pac.getByTestId('pac-pedido-cancelado')).toContainText(protocolo);
    await expect(pac.getByTestId('portal-pedidos')).toContainText('Cancelado por você');
    await expect(cancelar).toHaveCount(0);
    // O pedido encerrado não se cancela de novo (409).
    const recancelar = await pac.request.post(`/api/paciente/pedidos/${protocolo}/cancelamento`, {
      headers: { 'x-csrf-paciente': csrf(await contexto.cookies()) },
      data: { motivo: 'desistencia' },
    });
    expect(recancelar.status()).toBe(409);

    // A troca do e-mail: o link vai ao e-mail NOVO (no dev, a caixa do simulador); a conta ainda não muda.
    await pac.getByTestId('portal-menu-seguranca').click();
    await pac.getByTestId('pac-email-novo').fill(EMAIL_NOVO);
    await pac.locator('#pac-email-senha').fill(SENHA_PAC);
    await pac.locator('#pac-email-cod').fill(await codigoNovo(pac, chaveNova));
    await pac.getByTestId('pac-troca-pedir').click();
    await expect(pac.getByTestId('pac-troca-pendente')).toBeVisible();
    await expect(pac.getByTestId('pac-troca-pendente')).not.toContainText(EMAIL_NOVO);

    // A tela interna lê a caixa do simulador (só dev/ci): a mensagem é para o e-mail novo, com o link.
    const caixa = await page.request.get('/api/portal-paciente/simulador/mensagens');
    expect(caixa.status()).toBe(200);
    const { mensagens } = (await caixa.json()) as {
      mensagens: { tipo: string; destino: string; link: string }[];
    };
    const msg = mensagens.find((m) => m.destino === EMAIL_NOVO);
    expect(msg?.tipo).toBe('confirmacao-email');
    expect(mensagens.some((m) => m.destino === EMAIL)).toBe(false);
    const link = new URL(msg!.link, 'https://simulador.invalid');
    expect(link.pathname).toBe('/paciente/email/confirmar');
    // A ficha na recepção mostra a troca pendente (e-mail mascarado).
    await page.goto('/cadastros/pacientes/1001');
    await expect(page.getByTestId('conta-portal')).toContainText('Troca de e-mail pendente');
    await expect(page.getByTestId('conta-portal')).not.toContainText(EMAIL_NOVO);

    // O paciente abre o link e confirma com o botão; a conta passa ao e-mail novo.
    await pac.goto(`${link.pathname}${link.search}`);
    await expect(pac.getByTestId('portal-confirmar-email')).toBeVisible();
    await semViolacaoAxe(pac, '/paciente/email/confirmar');
    await pac.getByTestId('pac-confirmar-email').click();
    await expect(pac.getByTestId('portal-confirmar-email')).toContainText('E-mail trocado');

    // Entrar com o e-mail novo e o autenticador novo.
    await pac.goto('/paciente');
    await pac.getByTestId('pac-email').fill(EMAIL_NOVO);
    await pac.getByTestId('pac-senha').fill(SENHA_PAC);
    await pac.getByTestId('pac-codigo').fill(await codigoNovo(pac, chaveNova));
    await pac.getByTestId('pac-entrar').click();
    await expect(pac.getByTestId('portal-ola')).toContainText('José');
    chaveConta = chaveNova;

    expect(externas).toEqual([]);
    expect(externasPac).toEqual([]);
    await contexto.close();
  });

  test('cópia do prontuário: pedido pelo portal → legitimidade, PDF e entrega na fila interna → download; respondido devolve 409; portabilidade aberta sem pacote IPS, atendida na privacidade e o Bundle IPS baixado (SHA-256); axe', async ({
    page,
    browser,
  }) => {
    expect(chaveConta).not.toBe('');
    const externas = vigiarExternas(page);
    const contexto = await browser.newContext();
    const pac = await contexto.newPage();
    const externasPac = vigiarExternas(pac);
    await pac.goto('/paciente');
    await pac.getByTestId('pac-email').fill(EMAIL_NOVO);
    await pac.getByTestId('pac-senha').fill(SENHA_PAC);
    await pac.getByTestId('pac-codigo').fill(await codigoNovo(pac, chaveConta));
    await pac.getByTestId('pac-entrar').click();
    await expect(pac.getByTestId('portal-ola')).toContainText('José');

    // O paciente pede a cópia: o painel de confirmação; "Voltar" não pede.
    await pac.getByTestId('portal-menu-copia').click();
    await expect(pac.getByTestId('portal-copia')).toBeVisible();
    await pac.getByTestId('pac-copia-observacao').locator('textarea').fill('Para levar ao especialista.');
    await pac.getByTestId('pac-copia-revisar').click();
    await expect(pac.getByTestId('pac-copia-confirmacao')).toContainText('Para levar ao especialista.');
    await semViolacaoAxe(pac, '/paciente/copia (confirmação)');
    await pac.getByTestId('pac-copia-confirmacao').getByRole('button', { name: 'Voltar' }).click();
    await expect(pac.getByTestId('pac-copia-confirmacao')).toHaveCount(0);
    await expect(pac.getByTestId('pac-copia-feito')).toHaveCount(0);
    await pac.getByTestId('pac-copia-revisar').click();
    await pac.getByTestId('pac-copia-pedir').click();
    await expect(pac.getByTestId('pac-copia-feito')).toContainText('Pedido protocolado');
    const protocolo = /protocolado:\s*(\d{4}-\d+)/.exec(
      await pac.getByTestId('pac-copia-feito').innerText(),
    )![1]!;
    await expect(pac.getByTestId(`pac-copia-${protocolo}`)).toContainText('Aguardando a conferência');
    await expect(pac.getByTestId(`pac-copia-baixar-${protocolo}`)).toHaveCount(0);
    const cedo = await pac.request.get(`/api/paciente/copias/${protocolo}/pdf`);
    expect(cedo.status()).toBeGreaterThanOrEqual(400);

    // A portabilidade aberta: sem o link do pacote IPS e 409 pela API.
    await pac.getByTestId('portal-menu-privacidade').click();
    await escolher(pac.getByTestId('pac-tipo-pedido'), 'portabilidade');
    await pac.getByTestId('pac-pedir-titular').click();
    await expect(pac.getByTestId('pac-pedido-registrado')).toContainText('protocolo');
    const portab = /protocolo\s+(\d{4}-\d+)/.exec(
      await pac.getByTestId('pac-pedido-registrado').innerText(),
    )![1]!;
    await expect(pac.getByTestId(`pac-baixar-ips-${portab}`)).toHaveCount(0);
    const ips = await pac.request.get(`/api/paciente/portabilidade/${portab}/ips`);
    expect(ips.status()).toBe(409);

    // A fila interna: legitimidade (senha), geração do PDF e entrega pelo portal (senha).
    await entrar(page, 'SINT.PRIVACIDADE');
    await page.goto('/portais/paciente/copias');
    await expect(page.getByTestId('tela-copias-prontuario')).toBeVisible();
    const linha = page.getByTestId(`cop-linha-${protocolo}`);
    await expect(linha).toBeVisible();
    await expect(page.getByTestId(`cop-etapa-${protocolo}`)).toContainText('Aguardando a conferência');
    await semViolacaoAxe(page, '/portais/paciente/copias');
    await page.getByTestId(`cop-legitimidade-${protocolo}`).click();
    await page
      .getByTestId('cop-prova')
      .locator('input, textarea')
      .first()
      .fill('Documento com foto conferido pela internet.');
    await page.getByTestId('cop-senha').fill(SENHA);
    await page.getByTestId('cop-seguir').click();
    await expect(page.getByTestId('cop-pergunta')).toContainText(protocolo);
    await semViolacaoAxe(page, '/portais/paciente/copias (legitimidade)');
    await page.getByTestId('cop-confirmar').click();
    await expect(page.getByTestId('cop-feito')).toBeVisible();
    await expect(page.getByTestId(`cop-etapa-${protocolo}`)).toContainText('Conferido');

    await page.getByTestId(`cop-gerar-${protocolo}`).click();
    await page.getByTestId('cop-seguir').click();
    await page.getByTestId('cop-confirmar').click();
    await expect(page.getByTestId('cop-feito')).toBeVisible();
    const [baixado] = await Promise.all([page.waitForEvent('download'), page.getByTestId('cop-pdf').click()]);
    expect(baixado.suggestedFilename()).toBe(`copia-prontuario-${protocolo}.pdf`);
    await expect(page.getByTestId(`cop-etapa-${protocolo}`)).toContainText('pronta para entrega');

    await page.getByTestId(`cop-entregar-${protocolo}`).click();
    await escolher(page.getByTestId('cop-meio'), 'portal');
    await page.getByTestId('cop-senha').fill(SENHA);
    await page.getByTestId('cop-seguir').click();
    await expect(page.getByTestId('cop-pergunta')).toContainText('Pelo portal');
    await page.getByTestId('cop-confirmar').click();
    await expect(page.getByTestId('cop-feito')).toContainText('Entrega registrada');
    // O entregue sai da fila dos pendentes; sem o filtro, aparece como entregue.
    await expect(linha).toHaveCount(0);
    await page.getByTestId('cop-pendentes').uncheck();
    await expect(page.getByTestId(`cop-etapa-${protocolo}`)).toContainText('Entregue');
    // O histórico dos atos: solicitação, legitimidade, geração (com o hash) e entrega.
    await page.getByTestId(`cop-atos-${protocolo}`).click();
    const historico = page.getByTestId('cop-historico');
    await expect(historico).toBeVisible();
    await expect(historico.locator('li')).toHaveCount(4);
    await expect(historico).toContainText(/[0-9a-f]{64}/);

    // O paciente baixa o PDF entregue pelo portal.
    await pac.getByTestId('portal-menu-copia').click();
    await expect(pac.getByTestId(`pac-copia-${protocolo}`)).toContainText('Entregue');
    await expect(pac.getByTestId(`pac-copia-baixar-${protocolo}`)).toBeVisible();
    const pdf = await pac.request.get(`/api/paciente/copias/${protocolo}/pdf`);
    expect(pdf.status()).toBe(200);
    expect(pdf.headers()['content-type']).toContain('application/pdf');
    expect((await pdf.body()).subarray(0, 5).toString('latin1')).toBe('%PDF-');

    // O pedido respondido não se cancela: sem o botão e 409 pela API.
    await pac.getByTestId('portal-menu-privacidade').click();
    const pedido = pac.getByTestId('portal-pedidos').locator('tr', { hasText: protocolo });
    await expect(pedido).toContainText('Respondido');
    await expect(pac.getByTestId(`pac-cancelar-pedido-${protocolo}`)).toHaveCount(0);
    const cancelar = await pac.request.post(`/api/paciente/pedidos/${protocolo}/cancelamento`, {
      headers: { 'x-csrf-paciente': csrf(await contexto.cookies()) },
      data: { motivo: 'desistencia' },
    });
    expect(cancelar.status()).toBe(409);

    // Revisão: a portabilidade atendida pela área de privacidade (tela interna) libera o pacote FHIR/IPS no portal.
    await entrar(page, 'SINT.ADMIN');
    await page.goto('/administracao/privacidade');
    const linhaPortab = page.getByTestId(`pedido-${portab}`);
    await expect(linhaPortab).toContainText('Portal do paciente');
    if (await page.getByTestId(`confirmar-${portab}`).count()) {
      await page.getByTestId(`confirmar-${portab}`).click();
      await expect(page.getByTestId('privacidade-aviso')).toBeVisible();
    }
    await page.getByTestId(`atender-${portab}`).click();
    await expect(linhaPortab).toContainText('Atendido');
    await semViolacaoAxe(page, '/administracao/privacidade (portabilidade atendida)');

    await pac.getByTestId('portal-menu-copia').click();
    await pac.getByTestId('portal-menu-privacidade').click();
    const link = pac.getByTestId(`pac-baixar-ips-${portab}`);
    await expect(link).toBeVisible();
    const [ipsBaixado] = await Promise.all([pac.waitForEvent('download'), link.click()]);
    expect(ipsBaixado.suggestedFilename()).toBe(`portabilidade-ips-${portab}.json`);
    const arquivo = readFileSync((await ipsBaixado.path())!);
    const bundle = JSON.parse(arquivo.toString('utf8')) as {
      resourceType: string;
      type: string;
      entry: { resource: { resourceType: string } }[];
    };
    expect(bundle.resourceType).toBe('Bundle');
    expect(bundle.type).toBe('document');
    expect(bundle.entry[0]?.resource.resourceType).toBe('Composition');
    expect(bundle.entry.some((e) => e.resource.resourceType === 'Patient')).toBe(true);
    const viaApi = await pac.request.get(`/api/paciente/portabilidade/${portab}/ips`);
    expect(viaApi.status()).toBe(200);
    expect(viaApi.headers()['content-type']).toContain('application/fhir+json');
    const hash = viaApi.headers()['x-pacote-sha256'];
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    const corpo = await viaApi.body();
    expect(createHash('sha256').update(corpo).digest('hex')).toBe(hash);
    expect((JSON.parse(corpo.toString('utf8')) as { resourceType: string }).resourceType).toBe('Bundle');

    expect(externas).toEqual([]);
    expect(externasPac).toEqual([]);
    await contexto.close();
  });

  test('ouvidoria pelo portal: a manifestação (origem portal) aparece na ouvidoria interna, é respondida lá e o paciente lê o protocolo e a resposta; axe', async ({
    page,
    browser,
  }) => {
    expect(chaveConta).not.toBe('');
    const externas = vigiarExternas(page);
    const contexto = await browser.newContext();
    const pac = await contexto.newPage();
    const externasPac = vigiarExternas(pac);
    await pac.goto('/paciente');
    await pac.getByTestId('pac-email').fill(EMAIL_NOVO);
    await pac.getByTestId('pac-senha').fill(SENHA_PAC);
    await pac.getByTestId('pac-codigo').fill(await codigoNovo(pac, chaveConta));
    await pac.getByTestId('pac-entrar').click();
    await expect(pac.getByTestId('portal-ola')).toContainText('José');

    // O paciente manifesta: o painel de confirmação; "Voltar" não envia.
    await pac.getByTestId('portal-menu-ouvidoria').click();
    await expect(pac.getByTestId('portal-ouvidoria')).toBeVisible();
    await escolher(pac.getByTestId('pac-tipo-manifestacao'), 'reclamacao');
    await pac
      .getByTestId('pac-relato-manifestacao')
      .locator('textarea')
      .fill('Demora de duas horas na recepção do pronto-socorro (texto sintético E2E).');
    await pac.getByTestId('pac-revisar-manifestacao').click();
    await expect(pac.getByTestId('pac-pergunta-manifestacao')).toBeVisible();
    await semViolacaoAxe(pac, '/paciente/ouvidoria (confirmação)');
    await pac.getByTestId('pac-confirmar-manifestacao').getByRole('button', { name: 'Voltar' }).click();
    await expect(pac.getByTestId('pac-confirmar-manifestacao')).toHaveCount(0);
    await expect(pac.getByTestId('pac-manifestacao-enviada')).toHaveCount(0);
    await pac.getByTestId('pac-revisar-manifestacao').click();
    await pac.getByTestId('pac-enviar-manifestacao').click();
    await expect(pac.getByTestId('pac-manifestacao-enviada')).toBeVisible();
    const protocolo = /OUV-\d{4}-\d{6}/.exec(
      await pac.getByTestId('pac-manifestacao-enviada').innerText(),
    )![0];
    const minha = pac.getByTestId(`pac-manifestacao-${protocolo}`);
    await expect(minha).toContainText('Reclamação');
    await expect(minha).toContainText('Recebida');

    // A ouvidoria interna vê a manifestação do portal (canal "Portal do paciente") e a responde.
    await entrar(page, 'SINT.OUVIDORIA');
    await page.goto('/qualidade/ouvidoria');
    await expect(page.getByTestId('tela-ouvidoria')).toBeVisible();
    await page.getByTestId('man-busca').locator('input').fill(protocolo);
    await page.getByTestId('man-buscar').click();
    const abrir = page.locator('[data-testid^="abrir-manifestacao-"]');
    await expect(abrir).toHaveCount(1);
    await expect(page.locator('[data-testid^="manifestacao-"]').filter({ hasText: protocolo })).toContainText(
      'Portal do paciente',
    );
    await abrir.click();
    const man = page.getByTestId('manifestacao-detalhe');
    await expect(man).toContainText(protocolo);
    await expect(man).toContainText('Portal do paciente');
    await expect(man.getByTestId('man-situacao')).toContainText('Aberta');
    await semViolacaoAxe(page, '/qualidade/ouvidoria (manifestação do portal)');
    await man.getByTestId('man-responder').click();
    const resp = man.getByTestId('form-responder');
    await resp
      .getByTestId('man-resposta')
      .locator('textarea')
      .fill('Reforçamos a escala da recepção no horário de pico (texto sintético E2E).');
    await escolher(resp.getByTestId('man-procedente'), 'sim');
    await resp.getByTestId('man-gravar-andamento').click();
    await expect(man.getByTestId('man-situacao')).toContainText('Respondida');

    // O paciente lê a resposta no portal, pelo protocolo.
    await pac.getByTestId('portal-menu-inicio').click();
    await pac.getByTestId('portal-menu-ouvidoria').click();
    await expect(minha).toContainText('Respondida');
    await expect(minha).toContainText('Reforçamos a escala da recepção no horário de pico');
    await semViolacaoAxe(pac, '/paciente/ouvidoria (respondida)');

    expect(externas).toEqual([]);
    expect(externasPac).toEqual([]);
    await contexto.close();
  });

  test('remarcação de exame pelo portal (motivo e confirmação) e tesouraria das cobranças do portal (divergência, baixa e estorno, com confirmação e segregação); axe', async ({
    page,
    browser,
  }) => {
    expect(chaveConta).not.toBe('');
    const externas = vigiarExternas(page);
    // A agenda de exames 952 (aceita o particular e a operadora 306) liberada no portal pela tela interna (as consultas da 902 já vêm liberadas).
    await entrar(page, 'SINT.AGENDA');
    await page.goto('/agenda/online');
    await page.getByTestId('online-abrir-exame-952').click();
    await expect(page.getByTestId('online-detalhe')).toBeVisible();
    await page.getByTestId('online-ativa').check();
    await page.getByTestId('online-gravar').click();
    await expect(page.getByTestId('online-feito')).toContainText('gravada');
    // Uma gravação só (antes o submit do formulário gravava de novo e voltava "alterado por outra pessoa").
    await expect(page.getByText('alterado por outra pessoa')).toHaveCount(0);

    const contexto = await browser.newContext();
    const pac = await contexto.newPage();
    const externasPac = vigiarExternas(pac);
    await pac.goto('/paciente');
    await pac.getByTestId('pac-email').fill(EMAIL_NOVO);
    await pac.getByTestId('pac-senha').fill(SENHA_PAC);
    await pac.getByTestId('pac-codigo').fill(await codigoNovo(pac, chaveConta));
    await pac.getByTestId('pac-entrar').click();
    await expect(pac.getByTestId('portal-ola')).toContainText('José');

    // O paciente marca o exame e o remarca: o novo horário, o motivo e a confirmação (agenda.remarcarExame).
    await pac.getByTestId('portal-menu-agendar').click();
    await expect(pac.getByTestId('pac-nova-marcacao')).toBeVisible();
    await escolher(pac.getByTestId('pac-tipo'), 'exame');
    await escolher(pac.getByTestId('pac-convenio'), '306');
    await pac.getByTestId('pac-buscar').click();
    await pac.locator('[data-testid^="pac-horario-"]').first().click();
    await pac.getByTestId('pac-confirmar').click();
    await expect(pac.getByTestId('pac-agenda-aviso')).toContainText('Marcação feita');
    const exames = pac.locator('[data-testid^="pac-ag-exame-"]');
    await expect(exames).toHaveCount(1);
    const antigo = /pac-ag-exame-(.+)/.exec((await exames.first().getAttribute('data-testid')) ?? '')![1]!;
    const quandoAntigo = (await exames.first().locator('td').first().innerText()).trim();
    await pac.getByTestId(`pac-remarcar-${antigo}`).click();
    await expect(pac.getByTestId('pac-agenda-aviso')).toBeVisible();
    await pac.getByTestId('pac-buscar').click();
    const destino = pac.locator('[data-testid^="pac-horario-"]').nth(1);
    const [, data, hora] = /pac-horario-(\d{4}-\d{2}-\d{2})-(\d{4})/.exec(
      (await destino.getAttribute('data-testid')) ?? '',
    )!;
    const quandoNovo = `${data!.split('-').reverse().join('/')} ${hora!.slice(0, 2)}:${hora!.slice(2)}`;
    expect(quandoNovo).not.toBe(quandoAntigo);
    await destino.click();
    await expect(pac.getByTestId('pac-confirmar-painel')).toBeVisible();
    await escolher(pac.getByTestId('pac-motivo-remarcar'), 'PAC-SAUDE');
    await semViolacaoAxe(pac, '/paciente/agendar (remarcação do exame)');
    await pac.getByTestId('pac-confirmar').click();
    await expect(pac.getByTestId('pac-agenda-aviso')).toContainText(`Remarcado para ${quandoNovo}`);
    // O horário anterior foi liberado: uma só marcação de exame, com o id e o horário novos.
    await expect(pac.getByTestId(`pac-ag-exame-${antigo}`)).toHaveCount(0);
    await expect(exames).toHaveCount(1);
    await expect(exames.first()).toContainText(quandoNovo);

    // Uma consulta particular paga por Pix no gateway simulado, para a tesouraria conciliar.
    await escolher(pac.getByTestId('pac-tipo'), 'consulta');
    await escolher(pac.getByTestId('pac-convenio'), '10');
    await pac.getByTestId('pac-buscar').click();
    await pac.locator('[data-testid^="pac-horario-"]').first().click();
    await pac.getByTestId('pac-confirmar').click();
    await expect(pac.getByTestId('pac-agenda-aviso')).toContainText('Marcação feita');
    const consulta = pac
      .locator('[data-testid^="pac-ag-consulta-"]')
      .filter({ hasText: 'Marcado pelo portal' });
    await expect(consulta).toHaveCount(1);
    const idCons = /pac-ag-consulta-(\d+)/.exec((await consulta.getAttribute('data-testid')) ?? '')![1]!;
    await pac.getByTestId('portal-menu-pagamentos').click();
    await pac.getByTestId(`pac-pix-${idCons}`).click();
    const pix = await pac.getByTestId('pac-pix-codigo').inputValue();
    const transacao = /^SIMULADO-PIX\|([^|]+)\|/.exec(pix)![1]!;
    await pac.getByTestId('pac-conferir-pagamento').click();
    await pac.getByTestId('pac-simular').click();
    await expect(pac.getByTestId('pac-cobranca')).toContainText('Pago');

    // A tesouraria (/tesouraria/portal): quem concilia vê o pagamento confirmado pelo gateway.
    await entrar(page, 'SINT.FIN.CONCILIA');
    await page.goto('/tesouraria/portal');
    await expect(page.getByTestId('tela-tesouraria-portal')).toBeVisible();
    const linha = page.locator('[data-testid^="tes-linha-"]').filter({ hasText: transacao });
    await expect(linha).toHaveCount(1);
    const idPag = /tes-linha-(\d+)/.exec((await linha.getAttribute('data-testid')) ?? '')![1]!;
    await expect(page.getByTestId(`tes-situacao-${idPag}`)).toHaveText('A conciliar');
    await semViolacaoAxe(page, '/tesouraria/portal');
    // Divergência: o valor do extrato e o motivo; "Voltar" no painel de confirmação não registra.
    await page.getByTestId(`tes-divergencia-${idPag}`).click();
    const form = page.getByTestId('tes-form');
    await form.getByTestId('tes-valor').locator('input').fill('140,00');
    await form
      .getByTestId('tes-motivo')
      .locator('input, textarea')
      .fill('Extrato com R$ 10,00 a menos (sintético E2E).');
    await form.getByTestId('tes-seguir').click();
    await expect(form.getByTestId('tes-pergunta')).toContainText(transacao);
    await semViolacaoAxe(page, '/tesouraria/portal (confirmação)');
    await form.getByTestId('tes-voltar').click();
    await expect(page.getByTestId('tes-form')).toHaveCount(0);
    await expect(page.getByTestId(`tes-situacao-${idPag}`)).toHaveText('A conciliar');
    await page.getByTestId(`tes-divergencia-${idPag}`).click();
    await form.getByTestId('tes-valor').locator('input').fill('140,00');
    await form
      .getByTestId('tes-motivo')
      .locator('input, textarea')
      .fill('Extrato com R$ 10,00 a menos (sintético E2E).');
    await form.getByTestId('tes-seguir').click();
    await form.getByTestId('tes-confirmar').click();
    await expect(page.getByTestId('tes-feito')).toContainText('Divergência registrada');
    await expect(page.getByTestId(`tes-situacao-${idPag}`)).toHaveText('Com divergência');
    // A baixa depois da conferência: o valor certo; depois dela, só o estorno.
    await page.getByTestId(`tes-conciliar-${idPag}`).click();
    await form.getByTestId('tes-referencia').locator('input').fill('EXTRATO-W010');
    await form.getByTestId('tes-seguir').click();
    await expect(form.getByTestId('tes-pergunta')).toContainText('R$ 150,00');
    await form.getByTestId('tes-confirmar').click();
    await expect(page.getByTestId('tes-feito')).toContainText('Baixa registrada');
    await expect(page.getByTestId(`tes-situacao-${idPag}`)).toHaveText('Conciliado');
    await expect(page.getByTestId(`tes-conciliar-${idPag}`)).toHaveCount(0);
    await expect(linha).toContainText('Divergência por SINT.FIN.CONCILIA');
    await expect(linha).toContainText('Baixa por SINT.FIN.CONCILIA');
    // Quem conciliou não estorna (segregação): a recusa aparece e nada muda.
    await page.getByTestId(`tes-estornar-${idPag}`).click();
    await form
      .getByTestId('tes-motivo')
      .locator('input, textarea')
      .fill('Tentativa de quem conciliou (sintético E2E).');
    await form.getByTestId('tes-senha').fill(SENHA);
    await form.getByTestId('tes-seguir').click();
    await form.getByTestId('tes-confirmar').click();
    await expect(page.getByTestId('tes-recusa')).toContainText('quem conciliou não estorna');
    await expect(page.getByTestId(`tes-situacao-${idPag}`)).toHaveText('Conciliado');

    // O estorno pelo gateway, por outra pessoa (segregação), com motivo, a senha de novo e a confirmação.
    await entrar(page, 'SINT.FIN.TESFIS');
    await page.goto('/tesouraria/portal');
    await page.getByTestId(`tes-estornar-${idPag}`).click();
    await form
      .getByTestId('tes-motivo')
      .locator('input, textarea')
      .fill('Paciente desistiu da consulta (sintético E2E).');
    await form.getByTestId('tes-senha').fill(SENHA);
    await form.getByTestId('tes-seguir').click();
    await expect(form.getByTestId('tes-pergunta')).toContainText('Estornar R$ 150,00');
    await form.getByTestId('tes-confirmar').click();
    await expect(page.getByTestId('tes-feito')).toContainText('Estorno feito');
    await expect(page.getByTestId(`tes-situacao-${idPag}`)).toHaveText('Estornado');
    await expect(page.getByTestId(`tes-estornar-${idPag}`)).toHaveCount(0);
    await expect(linha).toContainText('Estorno por SINT.FIN.TESFIS');

    expect(externas).toEqual([]);
    expect(externasPac).toEqual([]);
    await contexto.close();
  });
});
