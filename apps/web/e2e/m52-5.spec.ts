// E2E @M52.5 (ficha do M52, fatia F5; seções 7, 8 e 10 na parte da F5): com o SESMT desligado, as telas ficam em
// consulta → o administrador registra as conferências e liga o cadastro de colaboradores e o SESMT → o RH admite uma
// técnica de enfermagem sintética → o SESMT monta o mapa de riscos da função (fator biológico da tabela do eSocial e a
// luva exigida) → o painel mostra "Sem ASO" → registra o ASO admissional com exame (regra 17) → a 1ª dose da hepatite B
// (esquema incompleto) → o acidente com material biológico (profilaxia sugerida, sorologia de 4 marcos, CAT a emitir:
// regra 18) e a emissão da CAT com o PDF → o EPI que falta, a entrega com CA vencido recusada e a válida com a
// assinatura conferida (regra 19) → quem só consulta não vê as ações → recolher (desligar a chave). Axe sem violação
// séria em cada tela. Sessão real sobre a fonte sintética de dev, gestão de pessoas e SESMT em MEMÓRIA (nada vai à
// cópia); CPF SINTÉTICO (dígito calculado aqui sobre a base inventada).
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
const br = (d: Date) =>
  `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;

/** O campo de texto ou de data dentro do invólucro do componente (o data-testid fica no invólucro). */
const entrada = (l: Locator) => l.locator('input, textarea').first();
async function preencher(l: Locator, valor: string): Promise<void> {
  const e = entrada(l);
  await e.fill(valor);
  await e.press('Tab');
}

async function ligar(page: Page, recurso: string, evidencia: string): Promise<void> {
  await page.getByTestId(`abrir-${recurso}`).click();
  const pre = page.getByTestId('form-prerequisito');
  await pre.getByLabel('Evidência (protocolo ou número; nunca o certificado ou a senha)').fill(evidencia);
  await pre.locator('#prereq-senha').fill(SENHA);
  await pre.getByRole('button', { name: 'Registrar pré-requisito' }).click();
  await expect(page.getByTestId('mensagem-liberacao')).toBeVisible();
  await chave(page, recurso, true, evidencia);
}
async function chave(page: Page, recurso: string, ligada: boolean, motivo: string): Promise<void> {
  await page.getByTestId(`abrir-${recurso}`).click();
  const form = page.getByTestId('form-liberacao');
  await form.getByTestId(ligada ? 'opcao-ligar' : 'opcao-desligar').check();
  await form.getByLabel('Justificativa').fill(motivo);
  await form.getByTestId('liberacao-senha').fill(SENHA);
  await form.getByTestId('liberacao-aplicar').click();
  await expect(page.getByTestId('mensagem-liberacao')).toContainText('chave(s) alterada(s)');
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

test.describe('gestão de pessoas, fatia F5: SESMT @M52.5', () => {
  test.setTimeout(420_000);

  test('desligado → ligar → admitir → mapa de riscos → painel → ASO → vacina → acidente e CAT → EPI e assinatura → só consulta → recolher; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    const hoje = br(new Date());
    const sufixo = String(Date.now() % 100_000).padStart(5, '0');
    const NOME = `TECNICA SINTETICA SESMT ${sufixo}`;

    // Com o SESMT desligado, as telas ficam em consulta.
    await entrar(page, 'SINT.SESMT');
    await page.goto('/pessoas/sesmt/aso');
    await expect(page.getByRole('heading', { level: 1, name: 'ASO e exames ocupacionais' })).toBeVisible();
    await expect(page.getByTestId('sesmt-gravacao-desligada')).toBeVisible({ timeout: 30_000 });
    await semViolacaoAxe(page, '/pessoas/sesmt/aso (desligado)');

    // O administrador registra as conferências e liga o cadastro de colaboradores e o SESMT.
    await entrar(page, 'SINT.ADMIN');
    await page.goto('/administracao/liberacao');
    await expect(page.getByTestId('recurso-pessoas.sesmt')).toContainText('Desligada', { timeout: 30_000 });
    if (!(await page.getByTestId('recurso-pessoas.colaborador').innerText()).includes('Ligada'))
      await ligar(page, 'pessoas.colaborador', 'Conferência sintética do RH (E2E M52.5)');
    await ligar(page, 'pessoas.sesmt', 'Conferência sintética do SESMT (E2E M52.5)');

    // O RH admite a técnica de enfermagem (pessoa nova, sem cadastro de profissional).
    await entrar(page, 'SINT.RH');
    await page.goto('/pessoas/colaboradores');
    await page.getByTestId('abrir-admissao').click();
    await page.getByLabel('CPF', { exact: true }).fill(cpf(`9005250${sufixo.slice(-2)}`));
    await page.getByTestId('consultar-cpf').click();
    await page.getByTestId('admissao-continuar').click();
    await page.getByLabel('Nome completo').fill(NOME);
    await page.getByLabel('Data de admissão').fill(hoje);
    await page.getByLabel('Data de admissão').press('Tab');
    await page.getByLabel('Cargo', { exact: true }).fill('Técnico de enfermagem');
    await page.getByLabel('Carga semanal (horas)').fill('36');
    await escolher(page.getByTestId('admissao-centro-custo'), { rotulo: /Enfermagem da clínica médica/ });
    await page.getByLabel('Matrícula').fill(`E2E-525-${sufixo}`);
    await page.getByTestId('admissao-revisar').click();
    await page.getByTestId('admissao-gravar').click();
    await expect(page.getByTestId('admissao-concluida')).toBeVisible();

    // Mapa de riscos da função: o fator biológico do eSocial e a luva exigida.
    await entrar(page, 'SINT.SESMT');
    await page.goto('/pessoas/sesmt/riscos');
    await expect(page.getByTestId('tela-sesmt-riscos')).toBeVisible();
    await page.getByTestId('nova-linha-risco').click();
    const fl = page.getByTestId('form-linha-risco');
    await preencher(fl.getByTestId('linha-funcao'), 'Técnico de enfermagem');
    await preencher(fl.getByTestId('linha-inicio'), hoje);
    await entrada(fl.getByTestId('linha-fator-termo')).fill('biol');
    await fl.getByTestId('linha-fator-buscar').click();
    await escolher(fl.getByTestId('linha-fator'), { rotulo: /^03\.01\.001/ });
    await escolher(fl.getByTestId('linha-grupo'), { rotulo: 'Biológico' });
    await semViolacaoAxe(page, 'riscos: inclusão do fator');
    await fl.getByTestId('linha-gravar').click();
    await expect(page.getByTestId('sesmt-aviso')).toContainText('Fator de risco incluído.');
    await page.getByTestId('nova-linha-risco').click();
    await fl.getByText('EPI exigido').click();
    await preencher(fl.getByTestId('linha-funcao'), 'Técnico de enfermagem');
    await preencher(fl.getByTestId('linha-inicio'), hoje);
    await preencher(fl.getByTestId('linha-epi'), 'Luva de procedimento');
    await fl.getByTestId('linha-gravar').click();
    await expect(page.getByTestId('sesmt-aviso')).toContainText('EPI exigido incluído.');
    await expect(page.getByTestId('tabela-mapa')).toContainText('Luva de procedimento');

    // Painel: sem ASO; o prontuário; o ASO admissional com exame (regra 17).
    await page.goto('/pessoas/sesmt/aso');
    await entrada(page.getByTestId('painel-termo')).fill(NOME);
    await page.getByTestId('painel-filtrar').click();
    await expect(page.getByTestId('tabela-painel')).toContainText('Sem ASO');
    await semViolacaoAxe(page, 'ASO: painel');
    await page.getByTestId('tabela-painel').getByRole('button', { name: NOME }).click();
    await expect(page.getByTestId('situacao-aso')).toContainText('Sem ASO');
    await page.getByTestId('novo-aso').click();
    const fa = page.getByTestId('form-aso');
    await escolher(fa.getByTestId('aso-tipo'), { rotulo: 'Admissional' });
    await preencher(fa.getByTestId('aso-data'), hoje);
    await escolher(fa.getByTestId('aso-conclusao'), { rotulo: 'Apto' });
    await preencher(fa.getByTestId('aso-medico'), 'MEDICA DO TRABALHO SINTETICA');
    await fa.getByTestId('aso-incluir-exame').click();
    await preencher(fa.getByTestId('aso-exame-nome-0'), 'Hemograma completo');
    await preencher(fa.getByTestId('aso-exame-data-0'), hoje);
    await escolher(fa.getByTestId('aso-exame-resultado-0'), { rotulo: 'Normal' });
    await semViolacaoAxe(page, 'ASO: formulário');
    await fa.getByTestId('aso-gravar').click();
    await expect(page.getByTestId('sesmt-aviso')).toContainText('ASO registrado.');
    await expect(page.getByTestId('situacao-aso')).toContainText('ASO em dia');
    await expect(page.getByTestId('tabela-asos')).toContainText('Hemograma completo');

    // Vacina: a 1ª dose da hepatite B; o esquema fica incompleto.
    await page.goto('/pessoas/sesmt/vacinas');
    await escolherColaborador(page, NOME);
    await page.getByTestId('nova-vacina').click();
    const fv = page.getByTestId('form-vacina');
    await escolher(fv.getByTestId('vacina-vacina'), { rotulo: 'Hepatite B' });
    await preencher(fv.getByTestId('vacina-data'), hoje);
    await escolher(fv.getByTestId('vacina-dose'), { rotulo: '1ª dose' });
    await preencher(fv.getByTestId('vacina-lote'), 'L-SINT-E2E');
    await preencher(fv.getByTestId('vacina-validade-lote'), '31/12/2030');
    await fv.getByTestId('vacina-gravar').click();
    await expect(page.getByTestId('sesmt-aviso')).toContainText('Dose registrada.');
    await expect(page.getByTestId('vacina-hepatite-b')).toContainText('Hepatite B: esquema incompleto');
    await semViolacaoAxe(page, 'vacinação');

    // Acidente com material biológico (regra 18): profilaxia sugerida, sorologia, CAT a emitir; a emissão e o PDF.
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
    await semViolacaoAxe(page, 'CAT: registro do acidente');
    await fc.getByTestId('acidente-gravar').click();
    await expect(page.getByTestId('sesmt-aviso')).toContainText('Acidente registrado.');
    const det = page.getByTestId('detalhe-acidente');
    await expect(det.getByTestId('acidente-profilaxia')).toContainText('Indicada');
    await expect(det.getByTestId('sorologias')).toContainText('180 dias');
    await expect(det.getByTestId('acidente-cat')).toContainText('CAT a emitir');
    const fcat = det.getByTestId('form-cat');
    await escolher(fcat.getByTestId('cat-tipo'), { rotulo: 'Inicial' });
    await preencher(fcat.getByTestId('cat-numero'), `E2E-CAT-${sufixo}`);
    await preencher(fcat.getByTestId('cat-emitida-em'), hoje);
    await fcat.getByTestId('cat-gravar').click();
    await expect(page.getByTestId('sesmt-aviso')).toContainText('CAT registrada');
    await expect(det.getByTestId('acidente-cat')).toContainText(`E2E-CAT-${sufixo}`);
    await expect(det.getByTestId('cat-pdf')).toBeVisible();
    await semViolacaoAxe(page, 'CAT: acompanhamento');

    // EPI (regra 19): a luva falta; o CA vencido é recusado; a entrega válida e a assinatura conferida.
    await page.goto('/pessoas/sesmt/riscos');
    await escolherColaborador(page, NOME);
    await expect(page.getByTestId('epis-faltando')).toContainText('Luva de procedimento');
    const fe = page.getByTestId('form-registro-epi');
    await preencher(fe.getByTestId('registro-epi-data'), hoje);
    await preencher(fe.getByTestId('registro-epi-nome'), 'Luva de procedimento');
    await preencher(fe.getByTestId('registro-epi-ca'), '12345');
    await preencher(fe.getByTestId('registro-epi-ca-validade'), '01/01/2020');
    await preencher(fe.getByTestId('registro-epi-quantidade'), '2');
    await fe.getByTestId('registro-epi-gravar').click();
    await expect(page.getByTestId('recusa-pessoas')).toContainText('CA deste EPI estava vencido');
    await preencher(fe.getByTestId('registro-epi-ca-validade'), '31/12/2030');
    await fe.getByTestId('registro-epi-gravar').click();
    await expect(page.getByTestId('sesmt-aviso')).toContainText('imprima o comprovante');
    await expect(page.getByTestId('epis-faltando')).toHaveCount(0);
    const linha = page
      .getByTestId('tabela-registros-epi')
      .locator('tr', { hasText: 'Luva de procedimento' })
      .first();
    await expect(linha.getByRole('link', { name: 'Comprovante' })).toBeVisible();
    // D-PPP-525: o PPP de consulta do colaborador (PDF/A, leitura auditada).
    await expect(page.getByTestId('ppp-pdf')).toHaveAttribute('href', /\/epi\/\d+\/ppp\/pdf$/);
    const ppp = await page.request.get(String(await page.getByTestId('ppp-pdf').getAttribute('href')));
    expect(ppp.status()).toBe(200);
    await linha.getByRole('button', { name: 'Assinatura conferida' }).click();
    await expect(page.getByTestId('sesmt-aviso')).toContainText('Assinatura registrada.');
    await semViolacaoAxe(page, 'riscos e EPI do colaborador');

    // Quem só consulta não vê as ações.
    await entrar(page, 'SINT.SESMT.CONSULTA');
    await page.goto('/pessoas/sesmt/aso');
    await expect(page.getByTestId('sesmt-so-consulta')).toBeVisible({ timeout: 30_000 });
    await escolherColaborador(page, NOME);
    await expect(page.getByTestId('tabela-asos')).toContainText('Admissional');
    await expect(page.getByTestId('novo-aso')).toHaveCount(0);
    await semViolacaoAxe(page, 'ASO: só consulta');

    // Recolher: desligar o SESMT (as telas voltam à consulta; os registros ficam).
    await entrar(page, 'SINT.ADMIN');
    await page.goto('/administracao/liberacao');
    await chave(page, 'pessoas.sesmt', false, 'Recolher o E2E M52.5');
    expect(externas).toEqual([]);
  });
});
