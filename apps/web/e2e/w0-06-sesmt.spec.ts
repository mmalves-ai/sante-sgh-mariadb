// E2E @W0-06 (programa CRUD completo; parte 3b-4: SESMT): liga o cadastro de colaboradores, a folha e o SESMT → o RH
// admite uma técnica de enfermagem sintética → o SESMT registra o acidente e a CAT → gera o S-2210 na fila do eSocial
// (nada sai do dev: a transmissão fica desligada) → RETIFICA o acidente e a CAT com motivo (o S-2210 ainda não enviado é
// descartado e fica guardado; o histórico mostra o valor anterior) → ANULA o acidente com motivo (fica anulado, não
// some) → registra a entrega de EPI e a CANCELA com motivo (a linha fica, com quem, quando e o motivo) → recolher.
// O retificador com indRetif 2 e recibo e o S-3000 do evento aceito estão provados na integração na cópia
// (crud-w006.int.spec.ts, caso "SESMT"), porque o aceite exige o retorno do eSocial. Axe sem violação séria nas telas e
// nos diálogos. Sessão real sobre a fonte sintética de dev; pessoas e SESMT em MEMÓRIA (nada vai à cópia); CPF SINTÉTICO.
import { expect, type Locator, type Page, test } from '@playwright/test';
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

function dv11(base: string, pesos: readonly number[]): number {
  let s = 0;
  pesos.forEach((p, i) => (s += Number(base[i]) * p));
  const r = s % 11;
  return r < 2 ? 0 : 11 - r;
}
function cpf(base9: string): string {
  const d1 = dv11(base9, [10, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = dv11(`${base9}${d1}`, [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
  return `${base9}${d1}${d2}`;
}
const p2 = (x: number) => String(x).padStart(2, '0');
const br = (d: Date) => `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()}`;
const entrada = (l: Locator) => l.locator('input, textarea').first();
async function preencher(l: Locator, valor: string): Promise<void> {
  const e = entrada(l);
  await e.fill(valor);
  await e.press('Tab');
}

async function chave(page: Page, recurso: string, ligar: boolean, motivo: string): Promise<void> {
  await page.getByTestId(`abrir-${recurso}`).click();
  const form = page.getByTestId('form-liberacao');
  await form.getByTestId(ligar ? 'opcao-ligar' : 'opcao-desligar').check();
  await form.getByLabel('Justificativa').fill(motivo);
  await form.getByTestId('liberacao-senha').fill(SENHA);
  await form.getByTestId('liberacao-aplicar').click();
  await expect(page.getByTestId('mensagem-liberacao')).toContainText('chave(s) alterada(s)');
}
async function ligar(page: Page, recurso: string, evidencia: string): Promise<void> {
  await expect(page.getByTestId(`recurso-${recurso}`)).toBeVisible({ timeout: 30_000 });
  const cartao = await page.getByTestId(`recurso-${recurso}`).innerText();
  if (cartao.includes('Ligada')) return;
  if (cartao.includes('Sem pré-requisito externo')) return chave(page, recurso, true, evidencia);
  await page.getByTestId(`abrir-${recurso}`).click();
  const pre = page.getByTestId('form-prerequisito');
  await pre.getByLabel('Evidência (protocolo ou número; nunca o certificado ou a senha)').fill(evidencia);
  await pre.locator('#prereq-senha').fill(SENHA);
  await pre.getByRole('button', { name: 'Registrar pré-requisito' }).click();
  await expect(page.getByTestId('mensagem-liberacao')).toBeVisible({ timeout: 30_000 });
  await chave(page, recurso, true, evidencia);
}

async function escolherColaborador(page: Page, nome: string): Promise<void> {
  const sel = page.getByTestId('seletor-colaborador');
  await entrada(sel.getByTestId('buscar-colaborador-termo')).fill(nome);
  await sel.getByTestId('buscar-colaborador').click();
  await sel
    .getByTestId('colaboradores-achados')
    .getByRole('button', { name: new RegExp(nome) })
    .first()
    .click();
  await expect(sel.getByRole('heading', { name: nome })).toBeVisible();
}

/** O diálogo do motivo: confirmar fica desabilitado com menos de 10 caracteres; a confirmação destrutiva pergunta. */
async function confirmarComMotivo(
  page: Page,
  testid: string,
  motivo: string,
  destrutivo = true,
): Promise<void> {
  const d = page.getByTestId(testid);
  await expect(d).toBeVisible();
  await d.getByLabel('Motivo').fill('curto');
  await expect(page.getByTestId(`${testid}-confirmar`)).toBeDisabled();
  await d.getByLabel('Motivo').fill(motivo);
  await semViolacaoAxe(page, `diálogo ${testid}`);
  await page.getByTestId(`${testid}-confirmar`).click();
  if (destrutivo) await page.getByTestId('confirmacao').getByRole('button', { name: 'Confirmar' }).click();
}

test.describe('W0-06 (parte 3b-4): retificar e anular o acidente e a CAT, cancelar o EPI @W0-06', () => {
  test.setTimeout(420_000);

  test('ligar → admitir → acidente e CAT → S-2210 na fila → retificar → anular → EPI cancelado → recolher; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    const hoje = br(new Date());
    const sufixo = String(Date.now() % 100_000).padStart(5, '0');
    const NOME = `TECNICA SINTETICA W006 ${sufixo}`;

    await entrar(page, 'SINT.ADMIN');
    await page.goto('/administracao/liberacao');
    await expect(page.getByTestId('recurso-pessoas.sesmt')).toBeVisible({ timeout: 30_000 });
    await ligar(page, 'pessoas.colaborador', 'Conferência sintética do RH (E2E W0-06)');
    await ligar(page, 'pessoas.folha', 'Conferência sintética do departamento pessoal (E2E W0-06)');
    await ligar(page, 'pessoas.sesmt', 'Conferência sintética do SESMT (E2E W0-06)');

    // O departamento pessoal registra os parâmetros do empregador no eSocial (vigência da competência atual).
    await entrar(page, 'SINT.DP.FOLHA');
    await page.goto('/pessoas/esocial');
    await expect(page.getByTestId('esocial-eventos')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('esocial-aba-parametros').click();
    await expect(
      page
        .getByTestId('esocial-parametros-vazio')
        .or(page.locator('[data-testid^="esocial-vigencia-"]').first()),
    ).toBeVisible({ timeout: 30_000 });
    const agora = new Date();
    const competencia = `${agora.getFullYear()}-${p2(agora.getMonth() + 1)}`;
    if ((await page.getByTestId(`esocial-vigencia-${competencia}`).count()) === 0) {
      await page.getByTestId('esocial-parametros-nova').click();
      await entrada(page.getByTestId('esocial-param-classTrib')).fill('99');
      await entrada(page.getByTestId('esocial-param-cnae')).fill('8610101');
      await entrada(page.getByTestId('esocial-param-fap')).fill('1,0000');
      await entrada(page.getByTestId('esocial-param-lotacao')).fill('LOT01');
      await entrada(page.getByTestId('esocial-param-fpas')).fill('515');
      await entrada(page.getByTestId('esocial-param-tercs')).fill('0115');
      await entrada(page.getByTestId('esocial-param-tabrubr')).fill('SANTE');
      await page.getByTestId('esocial-param-gravar').click();
      await expect(page.getByTestId('esocial-parametros-aviso')).toBeVisible({ timeout: 30_000 });
    }

    await entrar(page, 'SINT.RH');
    await page.goto('/pessoas/colaboradores');
    await page.getByTestId('abrir-admissao').click();
    await page.getByLabel('CPF', { exact: true }).fill(cpf(`9006065${sufixo.slice(-2)}`));
    await page.getByTestId('consultar-cpf').click();
    await page.getByTestId('admissao-continuar').click();
    await page.getByLabel('Nome completo').fill(NOME);
    await page.getByLabel('Data de admissão').fill(hoje);
    await page.getByLabel('Data de admissão').press('Tab');
    await page.getByLabel('Cargo', { exact: true }).fill('Técnico de enfermagem');
    await page.getByLabel('Carga semanal (horas)').fill('36');
    await escolher(page.getByTestId('admissao-centro-custo'), { rotulo: /Enfermagem da clínica médica/ });
    await page.getByLabel('Matrícula').fill(`E2E-W06-${sufixo}`);
    await page.getByTestId('admissao-revisar').click();
    await page.getByTestId('admissao-gravar').click();
    await expect(page.getByTestId('admissao-concluida')).toBeVisible();

    // O acidente e a CAT.
    await entrar(page, 'SINT.SESMT');
    await page.goto('/pessoas/sesmt/cat');
    await page.getByTestId('novo-acidente').click();
    const fc = page.getByTestId('form-acidente');
    await escolherColaborador(page, NOME);
    await preencher(fc.getByTestId('acidente-data'), hoje);
    await preencher(fc.getByTestId('acidente-hora'), '00:05');
    await preencher(fc.getByTestId('acidente-local'), 'Posto de enfermagem 2');
    await preencher(
      fc.getByTestId('acidente-descricao'),
      'Picada de agulha ao descartar material perfurocortante.',
    );
    await fc.getByTestId('acidente-biologico').check();
    await fc.getByTestId('acidente-perfuro').check();
    await escolher(fc.getByTestId('acidente-exposicao'), { rotulo: /^Percutânea/ });
    await escolher(fc.getByTestId('acidente-material'), { rotulo: 'Sangue' });
    await escolher(fc.getByTestId('acidente-fonte'), { rotulo: 'Fonte desconhecida' });
    await fc.getByTestId('acidente-gravar').click();
    await expect(page.getByTestId('sesmt-aviso')).toContainText('Acidente registrado.');
    const det = page.getByTestId('detalhe-acidente');
    const fcat = det.getByTestId('form-cat');
    await escolher(fcat.getByTestId('cat-tipo'), { rotulo: 'Inicial' });
    await preencher(fcat.getByTestId('cat-numero'), `E2E-W06-${sufixo}`);
    await preencher(fcat.getByTestId('cat-emitida-em'), hoje);
    await fcat.getByTestId('cat-gravar').click();
    await expect(page.getByTestId('sesmt-aviso')).toContainText('CAT registrada');
    await expect(det.getByTestId('acidente-historico')).toContainText('Nenhuma correção.');

    // O S-2210 original na fila do eSocial (só a fila: a transmissão fica desligada no dev).
    const fila = det.getByTestId('acidente-fila');
    await expect(fila).toContainText('Nenhum S-2210 gerado');
    await fila.getByTestId('acidente-gerar-s2210').click();
    await expect(det.getByTestId('acidente-efeito-esocial')).toContainText(
      /S-2210 gerado na fila|Pendências/,
    );
    await expect(fila).toContainText('S-2210');
    await semViolacaoAxe(page, 'CAT: fila do eSocial');

    // Retificar o acidente e a CAT com motivo: o registro vai inteiro; o valor anterior fica no histórico.
    await det.getByTestId('acidente-retificar').click();
    const dr = page.getByTestId('dlg-retificar-acidente');
    await expect(dr).toBeVisible();
    await preencher(dr.getByTestId('ret-local'), 'Posto de enfermagem 3');
    await preencher(dr.getByTestId('ret-cid'), 'W46');
    await confirmarComMotivo(
      page,
      'dlg-retificar-acidente',
      'Local do acidente lançado errado no registro.',
      false,
    );
    await expect(page.getByTestId('sesmt-aviso')).toBeVisible();
    const hist = det.getByTestId('acidente-historico');
    await expect(hist).toContainText('Retificação');
    await expect(hist).toContainText('Local do acidente lançado errado no registro.');
    await expect(hist).toContainText('Local: Posto de enfermagem 2 → Posto de enfermagem 3');
    await expect(hist).toContainText('CID-10: — → W46');
    await expect(fila).toContainText('descartado');
    await semViolacaoAxe(page, 'CAT: histórico da retificação');

    // Anular o acidente lançado por engano: fica anulado (não some) e as ações saem.
    await det.getByTestId('acidente-anular').click();
    await confirmarComMotivo(page, 'dlg-anular-acidente', 'Acidente registrado na colaboradora errada.');
    await expect(det.getByTestId('acidente-anulado')).toContainText(
      'Acidente registrado na colaboradora errada.',
    );
    await expect(hist).toContainText('Anulação');
    await expect(det.getByTestId('acidente-retificar')).toHaveCount(0);
    await expect(det.getByTestId('acidente-anular')).toHaveCount(0);
    await semViolacaoAxe(page, 'CAT: acidente anulado');

    // EPI: a entrega lançada por engano se cancela com motivo e continua na lista.
    await page.goto('/pessoas/sesmt/riscos');
    await escolherColaborador(page, NOME);
    const fe = page.getByTestId('form-registro-epi');
    await preencher(fe.getByTestId('registro-epi-data'), hoje);
    await preencher(fe.getByTestId('registro-epi-nome'), 'Luva de procedimento');
    await preencher(fe.getByTestId('registro-epi-ca'), '12345');
    await preencher(fe.getByTestId('registro-epi-ca-validade'), '31/12/2030');
    await preencher(fe.getByTestId('registro-epi-quantidade'), '2');
    await fe.getByTestId('registro-epi-gravar').click();
    await expect(page.getByTestId('sesmt-aviso')).toContainText('imprima o comprovante');
    const linha = page
      .getByTestId('tabela-registros-epi')
      .locator('tr', { hasText: 'Luva de procedimento' })
      .first();
    await linha.getByRole('button', { name: 'Cancelar registro' }).click();
    await confirmarComMotivo(page, 'dlg-cancelar-epi', 'Entrega lançada em dobro por engano.');
    await expect(linha).toContainText('Entrega lançada em dobro por engano.');
    await expect(linha.getByRole('button', { name: 'Cancelar registro' })).toHaveCount(0);
    await expect(page.getByTestId('epi-historico')).toContainText('Cancelamento do registro');
    await semViolacaoAxe(page, 'EPI: registro cancelado');

    await entrar(page, 'SINT.ADMIN');
    await page.goto('/administracao/liberacao');
    await chave(page, 'pessoas.sesmt', false, 'Recolher o E2E W0-06 do SESMT');
    expect(externas).toEqual([]);
  });
});
