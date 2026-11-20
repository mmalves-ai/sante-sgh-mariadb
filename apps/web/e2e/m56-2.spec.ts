// E2E @M56.2 (ficha do M56, fatia F1; seções 4, 7, 8 e 10 na parte da F1): com a parte desligada, a tela de
// beneficiários diz o que falta → o administrador registra o registro da operadora na ANS e liga a operadora e a parte
// de beneficiários em Funcionalidades → o gestor da operadora cadastra a operadora (empresa distinta), o plano (a regra
// da ANS das faixas etárias recusa a tabela fora dela), o contrato de pessoa física, o titular (carteirinha e 1ª via)
// e o dependente, emite a segunda via com o motivo, consulta a elegibilidade, exclui o titular (o dependente sai
// junto) e vê a elegibilidade recusada → o atendente da operadora só consulta → o administrador do hospital não abre
// a tela → o administrador recolhe (desliga as duas chaves para as pessoas do teste). Axe sem violação séria. Sessão real sobre a fonte
// sintética de dev, operadora em MEMÓRIA (nada vai à cópia); documentos SINTÉTICOS (dígito calculado aqui).
import { expect, test, type Page } from '@playwright/test';
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
/** CPF sintético válido a partir de 9 dígitos inventados. */
function cpf(base9: string): string {
  const d1 = dv11(base9, [10, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = dv11(`${base9}${d1}`, [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
  return `${base9}${d1}${d2}`;
}
/** CNPJ sintético válido a partir de 12 dígitos inventados. */
function cnpj(base12: string): string {
  const d1 = dv11(base12, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = dv11(`${base12}${d1}`, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return `${base12}${d1}${d2}`;
}

/**
 * Pessoas que o teste libera. A liberação e o recolhimento são por PESSOA, como nos E2E seguintes do M56 (@M56.3 a
 * @M56.7): recolher no escopo do estabelecimento deixaria a chave dele desligada, e ela recusa sempre, por cima da
 * liberação por pessoa com que os seguintes ligam (a suíte @M56 dependeria da ordem).
 */
const PESSOAS = ['SINT.OPERADORA', 'SINT.OPE.ATENDE'];

/** Liga ou desliga, para as pessoas do teste, uma chave da operadora em Funcionalidades (o administrador). */
async function chave(page: Page, recurso: string, ligar: boolean, motivo: string): Promise<void> {
  await page.getByTestId(`abrir-${recurso}`).click();
  const form = page.getByTestId('form-liberacao');
  await form.getByTestId(ligar ? 'opcao-ligar' : 'opcao-desligar').check();
  await escolher(form.getByTestId('liberacao-escopo'), 'pessoa');
  await form.getByTestId('liberacao-valores').fill(PESSOAS.join('\n'));
  await form.getByLabel('Justificativa').fill(motivo);
  await form.getByTestId('liberacao-senha').fill(SENHA);
  await form.getByTestId('liberacao-aplicar').click();
  await expect(page.getByTestId('mensagem-liberacao')).toContainText('chave(s) alterada(s)');
}

test.describe('operadora própria, fatia F1: beneficiários, planos e contratos @M56.2', () => {
  test.setTimeout(300_000);

  test('desligada → ligar → operadora → plano → contrato → titular e dependente → 2ª via → elegibilidade → exclusão → só consulta → recolher; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    // Números por execução (a memória do servidor de teste guarda as execuções anteriores).
    const sufixo = String(Date.now() % 100_000).padStart(5, '0');
    const registro = `9${sufixo}`;

    // Regra 1: com a parte desligada, a tela só diz o que falta.
    await entrar(page, 'SINT.OPERADORA');
    await page.goto('/operadora/beneficiarios');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Beneficiários, planos e contratos' }),
    ).toBeVisible();
    await expect(page.getByTestId('operadora-fatia-desligada')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('aba-beneficiarios')).toHaveCount(0);
    await semViolacaoAxe(page, '/operadora/beneficiarios (desligada)');

    // O administrador registra o pré-requisito (registro na ANS) e liga a operadora e a parte de beneficiários.
    await entrar(page, 'SINT.ADMIN');
    await page.goto('/administracao/liberacao');
    await expect(page.getByTestId('recurso-operadora')).toContainText('Desligada', { timeout: 30_000 });
    await page.getByTestId('abrir-operadora').click();
    const pre = page.getByTestId('form-prerequisito');
    await pre
      .getByLabel('Evidência (protocolo ou número; nunca o certificado ou a senha)')
      .fill(`ANS ${registro}`);
    await pre.locator('#prereq-senha').fill(SENHA);
    await pre.getByRole('button', { name: 'Registrar pré-requisito' }).click();
    await expect(page.getByTestId('mensagem-liberacao')).toBeVisible();
    await chave(page, 'operadora', true, 'Operadora sintética do E2E M56.2');
    await chave(page, 'operadora.beneficiarios', true, 'Beneficiários sintéticos do E2E M56.2');

    // O gestor da operadora: a empresa distinta (regra 3).
    await entrar(page, 'SINT.OPERADORA');
    await page.goto('/operadora/beneficiarios');
    await expect(page.getByTestId('aba-beneficiarios')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('aba-empresa').click();
    await page.getByTestId('empresa-incluir').click();
    const fe = page.getByTestId('form-empresa');
    await fe.getByLabel('Registro na ANS (6 dígitos)').fill(registro);
    await fe.getByLabel('CNPJ').fill(cnpj(`9${sufixo}000100`.slice(0, 12)));
    await fe.getByLabel('Razão social').fill(`Operadora Sintética E2E ${registro}`);
    await semViolacaoAxe(page, 'inclusão da operadora');
    await page.getByTestId('empresa-gravar').click();
    await expect(page.getByTestId('tabela-empresas')).toContainText(registro);
    const ativa = page.getByTestId('operadora-ativa');
    if (await ativa.count()) await escolher(ativa, { rotulo: new RegExp(registro) });

    // Plano: a tabela de preços fora da regra da ANS é recusada; depois, gravada.
    await page.getByTestId('aba-produtos').click();
    await page.getByTestId('produto-incluir').click();
    const fp = page.getByTestId('form-produto');
    await fp.getByLabel('Código interno').fill('ENF-E2E');
    await fp.getByLabel('Nome do produto').fill('Plano sintético enfermaria');
    await fp.getByLabel('Registro do produto na ANS (9 dígitos)').fill(`${registro}001`);
    const precos = ['100', '120', '130', '140', '150', '170', '200', '240', '300', '700'];
    const faixas = [
      '0 a 18 anos',
      '19 a 23 anos',
      '24 a 28 anos',
      '29 a 33 anos',
      '34 a 38 anos',
      '39 a 43 anos',
      '44 a 48 anos',
      '49 a 53 anos',
      '54 a 58 anos',
      '59 anos ou mais',
    ];
    for (const [i, f] of faixas.entries()) await fp.getByLabel(f, { exact: true }).fill(precos[i]!);
    await page.getByTestId('produto-gravar').click();
    await expect(page.getByTestId('recusa-operadora')).toContainText('6 vezes');
    await fp.getByLabel('59 anos ou mais', { exact: true }).fill('400');
    await semViolacaoAxe(page, 'inclusão do plano');
    await page.getByTestId('produto-gravar').click();
    await expect(page.getByTestId('produto-ENF-E2E')).toContainText('Plano sintético enfermaria');

    // Contrato de pessoa física (CPF do contratante).
    await page.getByTestId('aba-contratos').click();
    await page.getByTestId('contrato-incluir').click();
    const fc = page.getByTestId('form-contrato');
    await fc.getByLabel('Número do contrato').fill(`E2E-${sufixo}`);
    await fc.getByLabel('Contratante', { exact: true }).fill('Contratante Sintético E2E');
    await fc.getByLabel('CPF ou CNPJ do contratante').fill(cpf(`8${sufixo}001`.slice(0, 9)));
    await fc.getByLabel('Início da vigência').fill('01/01/2026');
    await fc.getByLabel('Início da vigência').press('Tab');
    await semViolacaoAxe(page, 'inclusão do contrato');
    await page.getByTestId('contrato-gravar').click();
    await expect(page.getByTestId(`contrato-E2E-${sufixo}`)).toContainText('***.');

    // Titular: a carteirinha de 16 dígitos com o registro da operadora e a 1ª via.
    await page.getByTestId('aba-beneficiarios').click();
    await page.getByTestId('beneficiario-incluir-titular').click();
    const fb = page.getByTestId('form-beneficiario');
    await fb.getByLabel('Nome', { exact: true }).fill('Titular Sintética E2E');
    await fb.getByLabel('CPF', { exact: true }).fill(cpf(`7${sufixo}002`.slice(0, 9)));
    await fb.getByLabel('Nascimento').fill('10/05/1980');
    await fb.getByLabel('Nascimento').press('Tab');
    await fb.getByLabel('Nome da mãe').fill('Mãe Sintética E2E');
    await fb.getByLabel('Adesão (início das carências)').fill('01/02/2026');
    await fb.getByLabel('Adesão (início das carências)').press('Tab');
    await semViolacaoAxe(page, 'inclusão do titular');
    await page.getByTestId('beneficiario-gravar').click();
    await expect(page.getByTestId('mensagem-beneficiario')).toContainText('carteirinha');
    const ficha = page.getByTestId('ficha-beneficiario');
    await expect(ficha.getByTestId('ficha-carteirinha')).toContainText(registro);
    const carteirinha = ((await ficha.getByTestId('ficha-carteirinha').textContent()) ?? '')
      .split('·')[0]!
      .replace(/\D/g, '');
    expect(carteirinha).toHaveLength(16);
    await expect(ficha.getByTestId('tabela-vias').locator('tbody tr')).toHaveCount(1);
    await expect(ficha.getByTestId('cartao-carteirinha')).toContainText('Titular Sintética E2E');
    await semViolacaoAxe(page, 'ficha do titular');

    // Dependente do mesmo contrato (menor, sem CPF).
    await ficha.getByTestId('beneficiario-incluir-dependente').click();
    await fb.getByLabel('Nome', { exact: true }).fill('Dependente Sintético E2E');
    await fb.getByLabel('Nascimento').fill('01/03/2015');
    await fb.getByLabel('Nascimento').press('Tab');
    await fb.getByLabel('Nome da mãe').fill('Titular Sintética E2E');
    await page.getByTestId('beneficiario-gravar').click();
    await expect(page.getByTestId('mensagem-beneficiario')).toContainText('carteirinha');
    await expect(page.getByTestId('tabela-beneficiarios').locator('tbody tr')).toHaveCount(2);

    // Segunda via do titular com o motivo.
    const linhaTitular = page
      .getByTestId('tabela-beneficiarios')
      .locator('tbody tr', { hasText: 'Titular Sintética E2E' });
    await expect(linhaTitular).toContainText('***.');
    await linhaTitular.getByRole('button', { name: 'Abrir' }).click();
    await expect(ficha.getByTestId('lista-dependentes')).toContainText('Dependente Sintético E2E');
    await escolher(ficha.getByTestId('segunda-via-motivo'), { indice: 0 });
    await ficha.getByTestId('segunda-via-emitir').click();
    await expect(page.getByTestId('mensagem-beneficiario')).toContainText('Via 2');
    await expect(ficha.getByTestId('tabela-vias').locator('tbody tr')).toHaveCount(2);

    // Elegibilidade pela carteirinha.
    await page.getByTestId('aba-elegibilidade').click();
    const el = page.getByTestId('operadora-elegibilidade');
    await el.getByLabel('Número da carteirinha').fill(carteirinha);
    await page.getByTestId('elegibilidade-consultar').click();
    await expect(page.getByTestId('elegibilidade-resultado')).toHaveAttribute('data-elegivel', 'true');
    await expect(page.getByTestId('elegibilidade-carencias')).toContainText('Partos a termo');
    await semViolacaoAxe(page, 'elegibilidade');

    // Exclusão do titular: o dependente sai junto; a elegibilidade passa a recusar.
    await page.getByTestId('aba-beneficiarios').click();
    await page
      .getByTestId('tabela-beneficiarios')
      .locator('tbody tr', { hasText: 'Titular Sintética E2E' })
      .getByRole('button', { name: 'Abrir' })
      .click();
    await escolher(ficha.getByTestId('baixa-motivo'), { indice: 0 });
    await ficha.getByTestId('baixa-confirmar').click();
    await page.getByTestId('confirmacao').getByRole('button', { name: 'Confirmar' }).click();
    await expect(page.getByTestId('mensagem-beneficiario')).toContainText('1 dependente');
    await expect(ficha.getByTestId('ficha-situacao')).toHaveAttribute('data-situacao', 'excluido');
    await page.getByTestId('aba-elegibilidade').click();
    await el.getByLabel('Número da carteirinha').fill(carteirinha);
    await page.getByTestId('elegibilidade-consultar').click();
    await expect(page.getByTestId('elegibilidade-resultado')).toHaveAttribute('data-elegivel', 'false');
    await expect(page.getByTestId('elegibilidade-motivos')).toContainText('Beneficiário excluído.');

    // O atendente da operadora só consulta.
    await entrar(page, 'SINT.OPE.ATENDE');
    await page.goto('/operadora/beneficiarios');
    await expect(page.getByTestId('operadora-so-consulta')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('beneficiario-incluir-titular')).toHaveCount(0);
    await semViolacaoAxe(page, '/operadora/beneficiarios (só consulta)');

    // O administrador do hospital não abre a tela da operadora; recolher: desliga as duas chaves.
    await entrar(page, 'SINT.ADMIN');
    await page.goto('/operadora/beneficiarios');
    await expect(page.getByTestId('tela-operadora-beneficiarios')).toHaveCount(0);
    await page.goto('/administracao/liberacao');
    // Ligada só para as pessoas do teste: o estabelecimento continua desligado.
    await expect(page.getByTestId('recurso-operadora')).toContainText('Desligada', { timeout: 30_000 });
    await chave(page, 'operadora.beneficiarios', false, 'Recolher o E2E M56.2');
    await chave(page, 'operadora', false, 'Recolher o E2E M56.2');
    await expect(page.getByTestId('recurso-operadora')).toContainText('Desligada');
    // Recolhida: o gestor da operadora volta a ver só o que falta.
    await entrar(page, 'SINT.OPERADORA');
    await page.goto('/operadora/beneficiarios');
    await expect(page.getByTestId('operadora-fatia-desligada')).toBeVisible({ timeout: 30_000 });
    expect(externas).toEqual([]);
  });
});
