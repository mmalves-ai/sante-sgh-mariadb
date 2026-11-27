// E2E @W0-10 (partes 11d1, 11d2a, 11d2b e 11d2c): a conta do médico externo e o pedido de cirurgia (I/A/E do portal do médico).
//   - o médico pede o acesso (autocadastro com o 2FA); a recepção do SADT aprova e liga a conta ao corpo clínico;
//   - no portal, o médico pede uma cirurgia e a ALTERA (motivo, painel de confirmação; "Voltar" não envia): o pedido
//     fica na versão 2 e a versão anterior aparece com o motivo;
//   - a secretaria do bloco confirma o pedido na sala; alterar o confirmado pela API (o mesmo corpo da tela) devolve 409;
//   - o médico pede uma segunda cirurgia (fica pendente), troca a senha (painel) e o e-mail: o link vai ao e-mail NOVO,
//     que no dev é a caixa do simulador (lida pela sessão interna; nada sai do processo); confirmado pelo link, as
//     sessões terminam e ele entra com a senha nova;
//   - a recepção bloqueia a conta com motivo, senha e confirmação: a sessão do portal termina e a entrada é recusada;
//     desbloqueia; encerra: o painel mostra a contagem dos pedidos pendentes e só segue com a decisão sobre eles
//     (retirar); o histórico da conta mostra os atos, as trocas e a decisão.
//   - (11d2a, M4) meus pacientes: a conta ligada ao CLINICO SINTETICO C (o registro do SINT.MEDICO na memória do PEP)
//     só vê o paciente em que o SINT.MEDICO registrou a evolução (vínculo assistencial da fila interna); o resumo do
//     prontuário abre com o aviso de acesso registrado; o paciente sem vínculo é negado (403 sem-vinculo-assistencial).
//   - (11d2b, M5) crítico: o potássio crítico do 1001 liberado no laboratório aparece no portal da conta ligada ao
//     CLINICO C aguardando a ciência; a notificação da conta vai ao simulador (sem dado do paciente); sem ciência no
//     prazo (a faixa com 1 minuto, devolvida a 30 no fim) a vigia sobe o aviso ao plantonista; a ciência com a conduta
//     (painel; "Voltar" não registra) para o escalonamento, a segunda é 409 e o painel interno mostra "Com ciência".
//   - (11d2c, M6) fila de assinatura remota: o SINT.MEDICO (login do CLINICO C) vincula o certificado em nuvem no
//     provedor SIMULADO (o PSC de homologação fica para a credencial do dono) e emite um atestado do 1001; no portal, a
//     conta ligada ao CLINICO C vê o certificado e o atestado a assinar, revisa (painel; "Voltar" não vai ao provedor),
//     confirma, autoriza no provedor simulado e volta à tela de retorno do portal com 1 assinado; o atestado sai da fila
//     e aparece assinado na tela interna do médico.
// axe sem violação séria nas telas; nenhuma requisição externa. Sessão real sobre a fonte sintética de dev e as portas
// em MEMÓRIA (conta, corpo clínico, pedidos e mensagens SINTÉTICOS).
import { createHmac } from 'node:crypto';
import { expect, type Page, test } from '@playwright/test';
import { ORIGEM, semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const SENHA_MED = 'senha-longa-sintetica-w010m';
const SENHA_MED_NOVA = 'outra-senha-longa-sintetica-w010m';
const NUMERO = '77010';
/** CPF sintético válido (verificadores conferidos) por número do conselho: o autocadastro exige o CPF do médico. */
const CPF_DO_NUMERO: Record<string, string> = {
  '77010': '770.100.010-06',
  '77011': '770.110.011-31',
  '77012': '770.120.012-67',
  '77013': '770.130.013-92',
};
const EMAIL = 'cirurgiao.w010@exemplo.invalid';
const EMAIL_NOVO = 'cirurgiao.novo.w010@exemplo.invalid';

/** CPF sintético com dígitos verificadores a partir de 9 dígitos (o mesmo do E2E do M49: o CPF da sessão SINT.MEDICO). */
function cpfSintetico(base9: string): string {
  const d = base9.split('').map(Number);
  for (const n of [9, 10]) {
    let s = 0;
    for (let k = 0; k < n; k++) s += d[k]! * (n + 1 - k);
    const r = (s * 10) % 11;
    d.push(r === 10 ? 0 : r);
  }
  return d.join('');
}
const CPF_SINT_MEDICO = cpfSintetico('900000001');

/** Na página do provedor simulado, o titular digita o CPF e autoriza; volta à tela de origem (mesma origem). */
async function autorizarNoProvedor(page: Page, cpf: string, volta: RegExp): Promise<void> {
  await expect(page.getByRole('heading', { name: 'Provedor de certificado simulado' })).toBeVisible();
  expect(page.url().startsWith(ORIGEM)).toBe(true);
  await page.getByLabel('CPF do titular').fill(cpf);
  await page.getByRole('button', { name: 'Autorizar' }).click();
  await expect(page).toHaveURL(volta);
}

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

let ultimoPasso = 0;
/** Um código de um passo ainda não usado (o código do médico vale uma vez). */
async function codigoNovo(page: Page, segredo: string): Promise<string> {
  for (;;) {
    const passo = Math.floor(Date.now() / 1000 / 30);
    const resta = 30_000 - (Date.now() % 30_000);
    if (passo > ultimoPasso && resta > 2_000) {
      ultimoPasso = passo;
      return totp(segredo);
    }
    await page.waitForTimeout(Math.min(resta + 300, 30_000));
  }
}

/** Entra no portal pela tela; devolve o status HTTP da entrada. */
async function entrarMedico(med: Page, senha: string, segredo: string, numero = NUMERO): Promise<number> {
  await med.goto('/resultados');
  await escolher(med.getByTestId('portal-perfil'), 'medicoExterno');
  await med.getByTestId('portal-uf').fill('SP');
  await med.getByTestId('portal-numero').fill(numero);
  await med.getByTestId('portal-senha').fill(senha);
  await med.getByTestId('portal-codigo').fill(await codigoNovo(med, segredo));
  const resposta = med.waitForResponse(
    (r) => r.request().method() === 'POST' && /\/api\/portal\/[^/]+\/medico$/.test(r.url()),
  );
  await med.getByTestId('portal-entrar').click();
  return (await resposta).status();
}

const emDias = (k: number) => {
  const d = new Date();
  d.setDate(d.getDate() + k);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

async function pedirCirurgia(med: Page, nome: string, data: string, hora: string): Promise<void> {
  await med.getByTestId('pm-nome').fill(nome);
  await med.getByTestId('pm-nascimento').fill('1971-03-04');
  await escolher(med.getByTestId('pm-sala'), { indice: 2 });
  await med.getByTestId('pm-data').fill(data);
  await med.getByTestId('pm-hora').fill(hora);
  await med.getByTestId('pm-duracao').fill('90');
  await med.getByTestId('pm-procedimento').fill('COLE');
  await med.getByRole('button', { name: 'Buscar procedimento' }).click();
  await med.getByTestId('pm-proc-30101271').click();
  await escolher(med.getByTestId('pm-convenio'), { indice: 1 });
  await med.getByTestId('pm-pedir').click();
  await expect(med.getByTestId('pm-mensagem')).toContainText('Cirurgia pedida');
}

/** Um ato da recepção sobre a conta (motivo, senha, "Seguir" e a pergunta de confirmação). */
async function atoConta(page: Page, ato: 'bloquear' | 'desbloquear', motivo: string): Promise<void> {
  await page.getByTestId(`pmc-${ato}-${NUMERO}`).click();
  await page.getByTestId(`pmc-motivo-${NUMERO}`).fill(motivo);
  await page.getByTestId(`pmc-senha-${NUMERO}`).fill(SENHA);
  await page.getByTestId(`pmc-seguir-${NUMERO}`).click();
  await expect(page.getByTestId(`pmc-pergunta-${NUMERO}`)).toBeVisible();
  await page.getByTestId(`pmc-confirmar-${NUMERO}`).click();
}

/** O médico interno (SINT.MEDICO) registra a evolução do paciente internado 1001: o vínculo assistencial nasce. */
async function registrarEvolucao(page: Page): Promise<void> {
  await entrar(page, 'SINT.MEDICO');
  await page.goto('/pep/rascunhos');
  await page.getByTestId('busca-paciente-registro').fill('silva');
  await page.getByTestId('busca-paciente-registro').press('Enter');
  await page.getByTestId('registro-paciente-1001').getByRole('link').click();
  await page.getByTestId('modelo-EVAM').getByRole('link').click();
  await expect(page.getByTestId('form-renderer')).toBeVisible();
  await page.getByRole('textbox', { name: /Exame físico/ }).fill('Exame SINTETICO W010');
  await page.getByRole('textbox', { name: /Quadro clínico/ }).fill('Quadro SINTETICO W010');
  await page.getByTestId('finalizar-registro').click();
  await expect(page.getByTestId('registro-finalizado')).toBeVisible();
}

/** Autocadastro do médico externo (o segredo do autenticador); a recepção aprova (sem ligar ao corpo clínico). */
async function autocadastroAprovado(page: Page, med: Page, NUM: string, email: string): Promise<string> {
  const padrao = med.waitForResponse((r) => r.url().endsWith('/api/portal/estabelecimento'));
  await med.goto('/medico/cadastro');
  await padrao;
  await med.getByTestId('medico-nome').fill('Clinico Externo W010');
  await med.getByTestId('medico-uf').fill('SP');
  await med.getByTestId('medico-numero').fill(NUM);
  await med.getByTestId('medico-cpf').fill(CPF_DO_NUMERO[NUM]!);
  await med.getByTestId('medico-email').fill(email);
  await med.getByTestId('medico-senha').fill(SENHA_MED);
  await med.getByTestId('medico-aceite').check();
  await med.getByTestId('medico-enviar').click();
  const otpauth = (await med.getByTestId('medico-otpauth').locator('code').textContent()) ?? '';
  const segredo = new URL(otpauth).searchParams.get('secret')!;
  await entrar(page, 'SINT.RECEPCAO.SADT');
  await page.goto('/sadt/solicitantes/autocadastro');
  await page.getByTestId(`autocadastro-cadastrar-${NUM}`).click();
  await escolher(page.getByTestId(`autocadastro-candidato-${NUM}`), { indice: 1 });
  await page.getByTestId(`autocadastro-aprovar-${NUM}`).click();
  await expect(page.getByTestId('autocadastro-mensagem')).toContainText('aprovado');
  return segredo;
}

/**
 * A recepção liga a conta ao CLINICO SINTETICO C (o registro do SINT.MEDICO na memória do corpo clínico). Um
 * profissional fica em uma conta só: a conta de outro teste desta execução ligada a ele é desligada antes (confirmação).
 */
async function ligarAoClinicoC(page: Page, NUM: string): Promise<void> {
  await page.goto('/portais/medico-externo');
  await expect(page.getByTestId(`pmi-conta-${NUM}`)).toBeVisible({ timeout: 30_000 });
  const outra = page.locator('[data-testid^="pmi-ligado-"]').filter({ hasText: 'CLINICO SINTETICO C' });
  if ((await outra.count()) > 0) {
    const numero = (await outra.first().getAttribute('data-testid'))!.replace('pmi-ligado-', '');
    await page.getByTestId(`pmi-desligar-${numero}`).click();
    await page.getByTestId('confirmacao').getByRole('button', { name: 'Confirmar' }).click();
    await expect(page.getByTestId(`pmi-ligado-${numero}`)).toHaveCount(0);
  }
  await page.getByTestId(`pmi-termo-${NUM}`).fill('CLINICO SINTETICO');
  await page.getByTestId(`pmi-termo-${NUM}`).press('Enter');
  await escolher(page.getByTestId(`pmi-profissional-${NUM}`), { rotulo: 'CLINICO SINTETICO C' });
  await page.getByTestId(`pmi-ligar-${NUM}`).click();
  await expect(page.getByTestId('pmi-mensagem')).toContainText('ligada');
}

test.describe('portal do médico externo: conta e pedido de cirurgia @W0-10', () => {
  test.setTimeout(420_000);

  test('autocadastro → pedido alterado com versão → confirmado 409 → trocas de senha e e-mail pelo simulador → bloqueio → encerramento com a decisão sobre os pendentes; axe', async ({
    page,
    browser,
  }) => {
    const externas = vigiarExternas(page);
    const contexto = await browser.newContext();
    const med = await contexto.newPage();
    const externasMed = vigiarExternas(med);

    // Autocadastro com o segundo fator.
    const padrao = med.waitForResponse((r) => r.url().endsWith('/api/portal/estabelecimento'));
    await med.goto('/medico/cadastro');
    await padrao;
    await med.getByTestId('medico-nome').fill('Cirurgiao Externo W010');
    await med.getByTestId('medico-uf').fill('SP');
    await med.getByTestId('medico-numero').fill(NUMERO);
    await med.getByTestId('medico-cpf').fill(CPF_DO_NUMERO[NUMERO]!);
    await med.getByTestId('medico-email').fill(EMAIL);
    await med.getByTestId('medico-senha').fill(SENHA_MED);
    await med.getByTestId('medico-aceite').check();
    await med.getByTestId('medico-enviar').click();
    const otpauth = (await med.getByTestId('medico-otpauth').locator('code').textContent()) ?? '';
    const segredo = new URL(otpauth).searchParams.get('secret')!;

    // A recepção do SADT aprova e liga a conta ao corpo clínico (busca pelo nome).
    await entrar(page, 'SINT.RECEPCAO.SADT');
    await page.goto('/sadt/solicitantes/autocadastro');
    // O número é novo (nenhum solicitante com ele): a recepção cadastra o médico, e ele vira o candidato.
    await page.getByTestId(`autocadastro-cadastrar-${NUMERO}`).click();
    await escolher(page.getByTestId(`autocadastro-candidato-${NUMERO}`), { indice: 1 });
    await page.getByTestId(`autocadastro-aprovar-${NUMERO}`).click();
    await expect(page.getByTestId('autocadastro-mensagem')).toContainText('aprovado');
    await page.goto('/portais/medico-externo');
    await expect(page.getByTestId(`pmi-conta-${NUMERO}`)).toBeVisible({ timeout: 30_000 });
    await page.getByTestId(`pmi-termo-${NUMERO}`).fill('CIRURGIAO SINTETICO');
    await page.getByTestId(`pmi-termo-${NUMERO}`).press('Enter');
    await escolher(page.getByTestId(`pmi-profissional-${NUMERO}`), { rotulo: 'CIRURGIAO SINTETICO A' });
    await page.getByTestId(`pmi-ligar-${NUMERO}`).click();
    await expect(page.getByTestId('pmi-mensagem')).toContainText('ligada');
    await expect(page.getByTestId(`pmc-situacao-${NUMERO}`)).toHaveText('Ativa');

    // O médico entra e pede uma cirurgia.
    await entrarMedico(med, SENHA_MED, segredo);
    await expect(med.getByTestId('portal-sessao')).toBeVisible();
    await med.goto('/medico-externo/agenda');
    const data = emDias(9);
    await pedirCirurgia(med, 'Wanda Alterada Sintetica', data, '1400');
    const linha = med.locator('[data-testid^="pm-pedido-"]').filter({ hasText: 'WANDA ALTERADA SINTETICA' });
    await expect(linha).toContainText('Solicitado');
    const idPedido = Number(((await linha.getAttribute('data-testid')) ?? '').replace('pm-pedido-', ''));
    expect(idPedido).toBeGreaterThan(0);

    // Altera o pedido não confirmado: motivo e painel; "Voltar" não envia; confirmado, vira a versão 2.
    await med.getByTestId(`pm-alterar-${idPedido}`).click();
    await med.getByTestId('pm-hora').fill('1500');
    await med.getByTestId('pm-motivo').fill('Ajuste do horário pedido pela equipe');
    await med.getByTestId('pm-pedir').click();
    await expect(med.getByTestId('pm-alteracao-confirmar')).toContainText('Ajuste do horário');
    await semViolacaoAxe(med, '/medico-externo/agenda (alteração)');
    await med.getByTestId('pm-alteracao-confirmar').getByRole('button', { name: 'Voltar' }).click();
    await expect(med.getByTestId('pm-alteracao-confirmar')).toHaveCount(0);
    await med.getByTestId('pm-pedir').click();
    const envio = med.waitForRequest((r) => r.url().endsWith(`/pedidos/${idPedido}/alteracao`));
    await med.getByTestId('pm-alteracao-sim').click();
    const corpoAlteracao = (await envio).postDataJSON() as Record<string, unknown>;
    await expect(med.getByTestId('pm-mensagem')).toContainText('versão 2');
    await expect(med.getByTestId(`pm-pedido-situacao-${idPedido}`)).toContainText('Versão 2');
    await med.getByTestId(`pm-versoes-${idPedido}`).locator('summary').click();
    await expect(med.getByTestId(`pm-versoes-${idPedido}`)).toContainText('Ajuste do horário');

    // A secretaria do bloco confirma o pedido na sala.
    await entrar(page, 'SINT.BLOCO');
    await page.goto('/cirurgia/mapa');
    await page.getByTestId('mapa-inicio').fill(data);
    await page.getByRole('button', { name: 'Ver o mapa' }).click();
    const sol = page.getByTestId('lista-solicitacoes').locator('li').filter({ hasText: 'WANDA A. S.' });
    await sol.getByRole('button', { name: 'Confirmar na sala' }).click();
    await expect(page.getByTestId('pedido-termo')).toHaveValue('WANDA ALTERADA SINTETICA');
    await page.getByTestId('pedido-termo').fill('cinthya');
    await page.getByTestId('pedido-termo').press('Enter');
    await page.getByTestId('paciente-cirurgia-1003').click();
    await expect(page.getByTestId('pedido-hora')).toHaveValue(/15:?00/);
    await page.getByTestId('botao-agendar-cirurgia').click();
    await expect(page).toHaveURL(/\/cirurgia\/agendamentos\/\d+/);
    await expect(page.getByTestId('agendamento-estado')).toHaveText('Confirmado');

    // O confirmado não se altera: sem o botão na tela e 409 pela API com o mesmo corpo (versão atual).
    await med.goto('/medico-externo/agenda');
    await expect(med.getByTestId(`pm-pedido-situacao-${idPedido}`)).not.toContainText('Solicitado');
    await expect(med.getByTestId(`pm-alterar-${idPedido}`)).toHaveCount(0);
    const csrf = (await contexto.cookies()).find((c) => c.name === 'sgh_portal_csrf')?.value ?? '';
    const r409 = await med.request.post(`/api/portal/medico-externo/pedidos/${idPedido}/alteracao`, {
      headers: { 'x-csrf-portal': csrf },
      data: { ...corpoAlteracao, versao: 2, motivo: 'Tentativa depois da confirmação' },
    });
    expect(r409.status()).toBe(409);

    // Um segundo pedido, que fica pendente (para o encerramento).
    await pedirCirurgia(med, 'Pedro Pendente Sintetico', emDias(12), '0800');

    // Troca da senha (painel de confirmação).
    await med.goto('/medico-externo/conta');
    await expect(med.getByTestId('pm-form-senha')).toBeVisible({ timeout: 30_000 });
    await med.locator('#pm-senha-atual').fill(SENHA_MED);
    await med.locator('#pm-senha-nova').fill(SENHA_MED_NOVA);
    await med.locator('#pm-senha-nova2').fill(SENHA_MED_NOVA);
    await med.locator('#pm-senha-codigo').fill(await codigoNovo(med, segredo));
    await med.getByTestId('pm-senha-trocar').click();
    await expect(med.getByTestId('pm-conta-confirmacao')).toBeVisible();
    await semViolacaoAxe(med, '/medico-externo/conta (confirmação)');
    await med.getByTestId('pm-conta-confirmar').click();
    await expect(med.getByTestId('pm-form-senha')).toContainText('Senha trocada');

    // Troca do e-mail: o link vai ao e-mail NOVO (caixa do simulador no dev); a conta ainda não muda.
    await med.getByTestId('pm-email-novo').fill(EMAIL_NOVO);
    await med.locator('#pm-email-senha').fill(SENHA_MED_NOVA);
    await med.locator('#pm-email-codigo').fill(await codigoNovo(med, segredo));
    await med.getByTestId('pm-troca-pedir').click();
    await expect(med.getByTestId('pm-conta-confirmacao')).toContainText(EMAIL_NOVO);
    await med.getByTestId('pm-conta-confirmar').click();
    await expect(med.getByTestId('pm-troca-pendente')).toBeVisible();
    await expect(med.getByTestId('pm-troca-pendente')).not.toContainText(EMAIL_NOVO);

    await entrar(page, 'SINT.RECEPCAO.SADT');
    const caixa = await page.request.get('/api/portal-medico/simulador/mensagens');
    expect(caixa.status()).toBe(200);
    const { mensagens } = (await caixa.json()) as {
      mensagens: { tipo: string; destino: string; link: string }[];
    };
    const msg = mensagens.find((m) => m.destino === EMAIL_NOVO);
    expect(msg?.tipo).toBe('confirmacao-email');
    expect(mensagens.some((m) => m.destino === EMAIL)).toBe(false);
    const link = new URL(msg!.link, 'https://simulador.invalid');
    expect(link.pathname).toBe('/medico-externo/email/confirmar');

    // O médico abre o link e confirma; as sessões terminam e ele entra com a senha nova.
    await med.goto(`${link.pathname}${link.search}`);
    await expect(med.getByTestId('pm-confirmar-email-tela')).toBeVisible();
    await semViolacaoAxe(med, '/medico-externo/email/confirmar');
    await med.getByTestId('pm-confirmar-email').click();
    await expect(med.getByTestId('pm-confirmar-email-tela')).toContainText('E-mail confirmado');
    await entrarMedico(med, SENHA_MED_NOVA, segredo);
    await expect(med.getByTestId('portal-sessao')).toBeVisible();

    // A recepção bloqueia: a sessão do portal termina e a entrada é recusada.
    await page.goto('/portais/medico-externo');
    await expect(page.getByTestId(`pmi-conta-${NUMERO}`)).toBeVisible({ timeout: 30_000 });
    await atoConta(page, 'bloquear', 'Conduta em apuração pela diretoria clínica');
    await expect(page.getByTestId('pmi-mensagem')).toContainText('Conta bloqueada');
    await expect(page.getByTestId(`pmc-situacao-${NUMERO}`)).toHaveText('Bloqueada');
    await med.goto('/medico-externo/agenda');
    await expect(med.getByRole('alert').filter({ hasText: 'Sessão encerrada' })).toBeVisible({
      timeout: 30_000,
    });
    expect(await entrarMedico(med, SENHA_MED_NOVA, segredo)).toBe(401);
    await expect(med.getByRole('alert')).toBeVisible();
    await expect(med.getByTestId('portal-sessao')).toHaveCount(0);

    // Desbloqueia e encerra: a contagem dos pendentes exige a decisão (retirar).
    await atoConta(page, 'desbloquear', 'Apuração concluída sem pendência');
    await expect(page.getByTestId(`pmc-situacao-${NUMERO}`)).toHaveText('Ativa');
    await page.getByTestId(`pmc-encerrar-${NUMERO}`).click();
    await page.getByTestId(`pmc-motivo-${NUMERO}`).fill('Descredenciado a pedido do próprio médico');
    await page.getByTestId(`pmc-senha-${NUMERO}`).fill(SENHA);
    await expect(page.getByTestId(`pmc-pendentes-${NUMERO}`)).toContainText('1 pedido(s)');
    await expect(page.getByTestId(`pmc-seguir-${NUMERO}`)).toBeDisabled();
    await semViolacaoAxe(page, '/portais/medico-externo (encerramento)');
    await page.getByTestId(`pmc-decisao-retirar-${NUMERO}`).check();
    await page.getByTestId(`pmc-seguir-${NUMERO}`).click();
    await expect(page.getByTestId(`pmc-pergunta-${NUMERO}`)).toContainText('definitivo');
    await page.getByTestId(`pmc-confirmar-${NUMERO}`).click();
    await expect(page.getByTestId('pmi-mensagem')).toContainText('1 pedido(s) retirado(s)');

    // A encerrada sai da lista padrão; no filtro próprio, o histórico com os atos, as trocas e a decisão.
    await expect(page.getByTestId(`pmi-conta-${NUMERO}`)).toHaveCount(0);
    await escolher(page.getByTestId('pmi-filtro-situacao'), 'encerradas');
    await page.getByRole('button', { name: 'Filtrar' }).click();
    await expect(page.getByTestId(`pmc-situacao-${NUMERO}`)).toHaveText('Encerrada', { timeout: 30_000 });
    await expect(page.getByTestId(`pmc-encerrar-${NUMERO}`)).toHaveCount(0);
    await page.getByTestId(`pmc-historico-${NUMERO}`).click();
    const atos = page.getByTestId(`pmc-atos-${NUMERO}`);
    for (const a of ['Bloqueio', 'Desbloqueio', 'Encerramento', 'Troca de senha', 'Troca de e-mail'])
      await expect(atos).toContainText(a);
    await expect(atos).toContainText('Descredenciado a pedido');

    expect(externas).toEqual([]);
    expect(externasMed).toEqual([]);
    await contexto.close();
  });

  test('meus pacientes: só o paciente com vínculo assistencial aparece e abre (acesso registrado); o outro é negado; axe', async ({
    page,
    browser,
  }) => {
    const NUM = '77011';
    const externas = vigiarExternas(page);
    const contexto = await browser.newContext();
    const med = await contexto.newPage();
    const externasMed = vigiarExternas(med);

    // O médico interno (SINT.MEDICO) registra a evolução do paciente internado 1001: o vínculo assistencial nasce.
    await registrarEvolucao(page);

    // Autocadastro do médico externo; a recepção aprova (sem ligar ao corpo clínico ainda).
    const segredo = await autocadastroAprovado(page, med, NUM, 'clinico.w010@exemplo.invalid');

    // Sem a conta ligada a um profissional, não há lista (nenhum vínculo).
    await entrarMedico(med, SENHA_MED, segredo, NUM);
    await expect(med.getByTestId('portal-sessao')).toBeVisible();
    await med.goto('/medico-externo/pacientes');
    await expect(med.getByTestId('pm-sem-vinculo')).toBeVisible({ timeout: 30_000 });

    // A recepção liga a conta ao CLINICO SINTETICO C.
    await ligarAoClinicoC(page, NUM);

    // Meus pacientes: o 1001 (vínculo pelo registro) aparece e abre; o acesso fica registrado.
    await med.goto('/medico-externo/pacientes');
    await expect(med.getByTestId('pm-profissional')).toContainText('CLINICO SINTETICO C', {
      timeout: 30_000,
    });
    await expect(med.getByTestId('pm-paciente-1001')).toContainText(/JOSÉ DA SILVA/i);
    await semViolacaoAxe(med, '/medico-externo/pacientes');
    const listados = await med
      .locator('[data-testid^="pm-paciente-"]')
      .evaluateAll((xs) =>
        xs.map((x) => Number((x.getAttribute('data-testid') ?? '').replace('pm-paciente-', ''))),
      );
    const acesso = med.waitForResponse((r) => r.url().endsWith('/api/portal/medico-externo/pacientes/1001'));
    await med.getByTestId('pm-abrir-1001').click();
    expect((await acesso).status()).toBe(200);
    await expect(med.getByTestId('pm-prontuario')).toContainText(/JOSÉ DA SILVA/i);
    await expect(med.getByTestId('pm-acesso-registrado')).toBeVisible();
    await semViolacaoAxe(med, '/medico-externo/pacientes (prontuário)');
    await med.getByTestId('pm-fechar').click();
    await expect(med.getByTestId('pm-prontuario')).toHaveCount(0);

    // Sem vínculo assistencial, o prontuário é negado (o paciente só do cadastro e o internado sem registro dele,
    // quando nenhum outro teste desta execução o ligou ao SINT.MEDICO).
    const negar = [1, ...[1003].filter((x) => !listados.includes(x))];
    for (const paciente of negar) {
      const r = await med.request.get(`/api/portal/medico-externo/pacientes/${paciente}`);
      expect(r.status()).toBe(403);
      expect(((await r.json()) as { codigo?: string }).codigo).toBe('sem-vinculo-assistencial');
    }

    expect(externas).toEqual([]);
    expect(externasMed).toEqual([]);
    await contexto.close();
  });
  test('crítico: o valor crítico do paciente com vínculo chega ao portal, é notificado pelo simulador, escalona no prazo e recebe a ciência com a conduta; axe', async ({
    page,
    browser,
  }) => {
    const NUM = '77012';
    const externas = vigiarExternas(page);
    const contexto = await browser.newContext();
    const med = await contexto.newPage();
    const externasMed = vigiarExternas(med);

    // O vínculo assistencial do 1001 (evolução do SINT.MEDICO) e a conta ligada ao CLINICO SINTETICO C.
    await registrarEvolucao(page);
    const segredo = await autocadastroAprovado(page, med, NUM, 'clinico.critico.w010@exemplo.invalid');
    await ligarAoClinicoC(page, NUM);
    await entrarMedico(med, SENHA_MED, segredo, NUM);
    await expect(med.getByTestId('portal-sessao')).toBeVisible();

    // A faixa do potássio com o prazo de 1 minuto (só para este teste; volta a 30 no fim): o escalonamento cabe no E2E.
    await entrar(page, 'SINT.BIOMEDICO');
    const faixa = (prazoMinutos: number) => ({
      ato: 15,
      exame: 'K',
      elemento: 0,
      abaixoDe: 2.5,
      acimaDe: 6.5,
      prazoMinutos,
      aprovacao: 'Diretoria clínica, ata sintética 1/2026',
      ativo: true,
    });
    const gravarFaixa = async (prazo: number) => {
      const csrf = (await page.context().cookies()).find((c) => c.name === 'sgh_csrf')?.value ?? '';
      const r = await page.request.post('/api/sadt/valores-criticos', {
        headers: { 'x-csrf': csrf, 'idempotency-key': `e2e-w0-10-faixa-${prazo}-${Date.now()}` },
        data: faixa(prazo),
      });
      expect(r.status(), await r.text()).toBe(200);
    };
    await gravarFaixa(1);

    try {
      // O potássio pedido no prontuário, coletado, recebido, digitado crítico e liberado (o aviso nasce na liberação).
      await entrar(page, 'SINT.MEDICO');
      await page.goto('/pep/paciente/1001/exames');
      await page.getByTestId('incluir-exame-502').click();
      await page.getByTestId('enviar-pedido').click();
      // Decisão 60 do dono: a regra fica como está. Se a massa sintética do dia já tem um potássio do 1001 nas últimas
      // 24 h, o pedido mostra o aviso de exame repetido (não bloqueia) e o médico confirma o aviso, como na rotina.
      const enviado = page.getByTestId('aba-exames-conteudo').getByText('Pedido enviado.');
      const avisosPedido = page.getByTestId('avisos-pedido');
      await expect(enviado.or(avisosPedido)).toBeVisible();
      if (!(await enviado.isVisible())) {
        await expect(avisosPedido).toContainText(/POTÁSSIO|repetido|24 horas/i);
        await page.getByTestId('confirmar-avisos').check();
        await page.getByTestId('enviar-pedido').click();
      }
      await expect(page.getByTestId('aba-exames-conteudo')).toContainText('Pedido enviado.');
      await entrar(page, 'SINT.BIOMEDICO');
      await page.goto('/sadt/coleta');
      // Só um grupo ainda por coletar (com o botão): o potássio anterior da massa, já coletado, fica de fora.
      const grupo = page
        .locator('[data-testid^="coleta-grupo-"]')
        .filter({ hasText: 'POTÁSSIO' })
        .filter({ has: page.locator('[data-testid^="coleta-coletar-"]') })
        .first();
      await expect(grupo).toBeVisible();
      const indice = (await grupo.getAttribute('data-testid'))!.replace('coleta-grupo-', '');
      await page.getByTestId(`coleta-pulseira-${indice}`).fill('P1001|A31337');
      await page.getByTestId(`coleta-conferido-${indice}`).check();
      await page.getByTestId(`coleta-coletar-${indice}`).click();
      await expect(page.getByTestId('coleta-mensagem')).toContainText(/Amostra [0-9A-Z]{10} coletada/);
      await page.goto('/sadt/exames');
      // O pedido deste teste é o mais novo dos potássios ainda selecionáveis (o maior ID): um anterior da massa do dia
      // não é confundido com ele.
      const linhas = page
        .locator('[data-testid^="sadt-exame-"]')
        .filter({ hasText: 'POTÁSSIO' })
        .filter({ hasText: 'Pedido do prontuário' })
        .filter({ has: page.locator('[data-testid^="sadt-selecionar-"]') });
      await expect(linhas.first()).toBeVisible();
      const ids = await linhas.evaluateAll((els) =>
        els.map((el) => Number(el.getAttribute('data-testid')!.replace('sadt-exame-', ''))),
      );
      const exame = Math.max(...ids);
      await page.getByTestId(`sadt-selecionar-${exame}`).check();
      await page.getByTestId('sadt-receber').click();
      await expect(page.getByTestId('sadt-mensagem')).toContainText('Pedido recebido');
      await page.goto(`/sadt/resultados/digitacao?exame=${exame}`);
      await page.getByTestId('digitacao-valor-0').fill('7,3');
      await page.getByTestId('digitacao-gravar').click();
      await expect(page.getByTestId('digitacao-mensagem')).toContainText('Resultado digitado');
      await page.goto('/sadt/resultados/liberacao');
      await page.getByTestId(`liberacao-confirmar-${exame}`).check();
      await page.getByTestId(`liberacao-liberar-${exame}`).click();
      await expect(page.getByTestId('liberacao-mensagem')).toContainText('aviso do valor crítico');

      // No portal: o aviso do paciente dele, aguardando a ciência (dentro do prazo).
      await med.goto('/medico-externo/criticos');
      const aviso = med
        .locator('tr[data-testid^="pm-critico-"]')
        .filter({ hasText: '7.3' })
        .or(med.locator('tr[data-testid^="pm-critico-"]').filter({ hasText: '7,3' }));
      await expect(aviso.first()).toBeVisible({ timeout: 30_000 });
      const idAviso = Number((await aviso.first().getAttribute('data-testid'))!.replace('pm-critico-', ''));
      await expect(aviso.first()).toContainText(/JOSÉ DA SILVA/i);
      await expect(med.getByTestId(`pm-critico-situacao-${idAviso}`)).toContainText(
        'Aguardando a sua ciência',
      );
      await expect(med.getByTestId('pm-criticos-pendentes')).toBeVisible();
      await semViolacaoAxe(med, '/medico-externo/criticos');

      // Sem a ciência no prazo (1 minuto), a vigia sobe o aviso ao plantonista; a notificação da conta saiu pelo
      // simulador (a vigia do portal, a cada minuto).
      await expect(async () => {
        await med.reload();
        await expect(med.getByTestId(`pm-critico-situacao-${idAviso}`)).toContainText(
          /Já com (plantonista|supervisor)/,
          {
            timeout: 5_000,
          },
        );
        await expect(med.getByTestId(`pm-critico-situacao-${idAviso}`)).toContainText('Avisado em', {
          timeout: 1_000,
        });
      }).toPass({ timeout: 180_000, intervals: [10_000] });
      await entrar(page, 'SINT.RECEPCAO.SADT');
      const caixa = await page.request.get('/api/portal-medico/simulador/mensagens');
      expect(caixa.status()).toBe(200);
      const { mensagens } = (await caixa.json()) as {
        mensagens: { tipo: string; destino: string; link: string }[];
      };
      const notificacao = mensagens.filter((m) => m.tipo === 'resultado-critico');
      expect(notificacao.length).toBeGreaterThan(0);
      expect(new URL(notificacao[0]!.link, 'https://simulador.invalid').pathname).toBe(
        '/medico-externo/criticos',
      );
      // Nenhum dado do paciente na mensagem.
      // (Revisão: os carimbos ISO saem antes da busca; "…:47.304Z" casava com 7.3 e o teste falhava conforme o relógio.)
      expect(JSON.stringify(notificacao).replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, '<carimbo>')).not.toMatch(
        /SILVA|7[.,]3/i,
      );

      // A ciência com a conduta: painel de confirmação ("Voltar" não registra) e o registro.
      await med.getByTestId(`pm-ciencia-${idAviso}`).click();
      await med.getByTestId('pm-conduta').fill('Repetido o exame e iniciada a correção (SINTETICO W010)');
      await med.getByTestId('pm-ciencia-revisar').click();
      await expect(med.getByTestId('pm-ciencia-confirmar')).toBeVisible();
      await med.getByTestId('pm-ciencia-confirmar').getByRole('button', { name: 'Voltar' }).click();
      await expect(med.getByTestId('pm-ciencia-confirmar')).toHaveCount(0);
      await expect(med.getByTestId(`pm-critico-situacao-${idAviso}`)).not.toContainText('Ciência em');
      await med.getByTestId('pm-ciencia-revisar').click();
      await med.getByTestId('pm-ciencia-sim').click();
      await expect(med.getByTestId('pm-ciencia-feita')).toContainText('Ciência registrada');
      await expect(med.getByTestId(`pm-critico-situacao-${idAviso}`)).toContainText('Ciência em');
      await expect(med.getByTestId(`pm-ciencia-${idAviso}`)).toHaveCount(0);
      await semViolacaoAxe(med, '/medico-externo/criticos (ciência)');
      // A segunda ciência é recusada (409: registro novo uma vez).
      const csrf = (await contexto.cookies()).find((c) => c.name === 'sgh_portal_csrf')?.value ?? '';
      const r409 = await med.request.post(`/api/portal/medico-externo/criticos/${idAviso}/ciencia`, {
        headers: { 'x-csrf-portal': csrf },
        data: { conduta: 'Outra conduta SINTETICA' },
      });
      expect(r409.status()).toBe(409);

      // O painel interno do valor crítico mostra a ciência (a do prontuário, que parou o escalonamento).
      await entrar(page, 'SINT.BIOMEDICO');
      await page.goto('/sadt/valores-criticos');
      await expect(page.getByTestId(`aviso-situacao-${exame}`)).toContainText('Com ciência');
    } finally {
      await entrar(page, 'SINT.BIOMEDICO');
      await gravarFaixa(30);
    }

    expect(externas).toEqual([]);
    expect(externasMed).toEqual([]);
    await contexto.close();
  });

  test('assinatura remota: o atestado emitido pelo profissional ligado é assinado pelo portal com o certificado em nuvem (provedor simulado) e sai da fila; axe', async ({
    page,
    browser,
  }) => {
    const NUM = '77013';
    const externas = vigiarExternas(page);
    const contexto = await browser.newContext();
    const med = await contexto.newPage();
    const externasMed = vigiarExternas(med);

    // O certificado em nuvem do SINT.MEDICO (o login do CLINICO C), pelo provedor simulado com o CPF da sessão.
    await entrar(page, 'SINT.MEDICO');
    await page.goto('/conta/certificado');
    await expect(page.getByTestId('tela-meu-certificado')).toBeVisible();
    await expect(page.getByTestId('cert-lista').or(page.getByTestId('cert-nenhum'))).toBeVisible();
    if (await page.getByTestId('cert-nenhum').isVisible()) {
      await escolher(page.getByTestId('cert-provedor'), 'simulador');
      await page.getByTestId('cert-autorizar').click();
      await autorizarNoProvedor(page, CPF_SINT_MEDICO, /\/conta\/certificado/);
      await expect(page.getByTestId('cert-aviso')).toContainText('Certificado vinculado');
    }

    // Um atestado do 1001 emitido pelo SINT.MEDICO: aguarda a assinatura qualificada.
    await page.goto('/pep/paciente/1001/alergias');
    await page.getByTestId('aba-atestados').click();
    await page
      .getByTestId('atestado-texto')
      .fill('Atesto, para os devidos fins, que o paciente esteve em atendimento SINTETICO W010.');
    await page.getByTestId('atestado-dias').fill('1');
    const emissao = page.waitForResponse(
      (r) => r.url().endsWith('/api/pep/paciente/1001/atestados') && r.request().method() === 'POST',
    );
    await page.getByTestId('emitir-atestado').click();
    const doc = ((await (await emissao).json()) as { documento: number }).documento;
    await expect(page.getByTestId('aba-atestados-conteudo')).toContainText('Documento emitido.');

    // A conta do portal ligada ao CLINICO SINTETICO C (cujo login é o SINT.MEDICO).
    const segredo = await autocadastroAprovado(page, med, NUM, 'clinico.assina.w010@exemplo.invalid');
    await ligarAoClinicoC(page, NUM);
    await entrarMedico(med, SENHA_MED, segredo, NUM);
    await expect(med.getByTestId('portal-sessao')).toBeVisible();

    // A fila do portal: o certificado em nuvem e o atestado a assinar.
    await med.goto('/medico-externo/assinaturas');
    await expect(med.getByTestId('pm-ass-certificado')).toContainText('Certificado em nuvem');
    await expect(med.getByTestId(`pm-ass-${doc}`)).toContainText('SILVA');
    await semViolacaoAxe(med, '/medico-externo/assinaturas');

    // Revisar abre o painel com a série; "Voltar" não vai ao provedor.
    await med.getByTestId(`pm-ass-escolher-${doc}`).check();
    await med.getByTestId('pm-ass-revisar').click();
    await expect(med.getByTestId('pm-ass-confirmar')).toBeVisible();
    await semViolacaoAxe(med, 'confirmação da assinatura remota');
    await med.getByTestId('pm-ass-confirmar').getByRole('button', { name: 'Voltar' }).click();
    await expect(med.getByTestId('pm-ass-confirmar')).toBeHidden();
    await expect(med).toHaveURL(/\/medico-externo\/assinaturas$/);

    // Confirmar: o provedor simulado (o titular autoriza com o CPF) devolve à tela de retorno do portal.
    await med.getByTestId('pm-ass-revisar').click();
    await med.getByTestId('pm-ass-sim').click();
    await autorizarNoProvedor(med, CPF_SINT_MEDICO, /\/medico-externo\/assinaturas\/retorno/);
    await expect(med.getByTestId('pm-ret-resultado')).toContainText('Assinatura concluída.', {
      timeout: 60_000,
    });
    await expect(med.getByTestId('pm-ret-contagem')).toContainText(
      '1 assinado(s), 0 pendente(s), 0 recusado(s)',
    );
    // O código do provedor sai da URL.
    expect(new URL(med.url()).searchParams.get('code')).toBeNull();
    await semViolacaoAxe(med, '/medico-externo/assinaturas/retorno');

    // O atestado sai da fila do portal e aparece assinado na tela interna do médico.
    await med.getByTestId('pm-ret-voltar').click();
    await expect(med.getByTestId('pm-ass-certificado')).toBeVisible();
    await expect(med.getByTestId(`pm-ass-${doc}`)).toHaveCount(0);
    await entrar(page, 'SINT.MEDICO');
    await page.goto('/pep/assinaturas');
    await expect(page.getByTestId('tela-assinar-documentos')).toBeVisible();
    await expect(page.getByTestId(`assinado-${doc}`)).toBeVisible();

    expect(externas).toEqual([]);
    expect(externasMed).toEqual([]);
    await contexto.close();
  });
});
