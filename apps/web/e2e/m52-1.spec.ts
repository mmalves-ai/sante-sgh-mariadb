// E2E @M52.1 (ficha do M52, fatia F1; seções 7, 8 e 10 na parte da F1): com o cadastro de colaboradores desligado, a
// tela fica em consulta → o administrador registra a conferência do RH e liga a chave em Funcionalidades → o
// colaborador sintético está com a sessão aberta → o RH consulta o CPF (a prévia reusa o profissional e o usuário:
// regra 1), admite, abre a ficha (CPF mascarado, a situação do cadastro "a confirmar": regra 4), registra a validade
// do conselho (o alerta "vence em breve": regra 3), inclui o dependente e a mudança funcional, e desliga com a senha:
// o acesso é bloqueado no mesmo dia e a sessão do colaborador cai (regra 2) → quem só consulta não vê as ações →
// recolher (desligar a chave). Axe sem violação séria. Sessão real sobre a fonte sintética de dev, gestão de pessoas
// em MEMÓRIA (nada vai à cópia); CPF SINTÉTICO (dígito calculado aqui sobre a base inventada da porta em memória).
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
function cpf(base9: string): string {
  const d1 = dv11(base9, [10, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = dv11(`${base9}${d1}`, [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
  return `${base9}${d1}${d2}`;
}
const br = (d: Date) =>
  `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;

async function chave(page: Page, recurso: string, ligar: boolean, motivo: string): Promise<void> {
  await page.getByTestId(`abrir-${recurso}`).click();
  const form = page.getByTestId('form-liberacao');
  await form.getByTestId(ligar ? 'opcao-ligar' : 'opcao-desligar').check();
  await form.getByLabel('Justificativa').fill(motivo);
  await form.getByTestId('liberacao-senha').fill(SENHA);
  await form.getByTestId('liberacao-aplicar').click();
  await expect(page.getByTestId('mensagem-liberacao')).toContainText('chave(s) alterada(s)');
}

test.describe('gestão de pessoas, fatia F1: colaboradores e admissão @M52.1', () => {
  test.setTimeout(300_000);

  test('desligada → ligar → prévia pelo CPF → admitir → ficha → validade → dependente → mudança → desligar (sessão cai) → só consulta → recolher; axe', async ({
    page,
    browser,
  }) => {
    const externas = vigiarExternas(page);
    const CPF = cpf('900520001');
    const hoje = new Date();
    const em30 = new Date(hoje.getTime() + 30 * 86_400_000);

    // Com a chave desligada, a tela fica em consulta.
    await entrar(page, 'SINT.RH');
    await page.goto('/pessoas/colaboradores');
    await expect(page.getByRole('heading', { level: 1, name: 'Colaboradores' })).toBeVisible();
    await expect(page.getByTestId('pessoas-gravacao-desligada')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('abrir-admissao')).toHaveCount(0);
    await semViolacaoAxe(page, '/pessoas/colaboradores (desligada)');

    // O administrador registra a conferência do RH e liga o cadastro de colaboradores.
    await entrar(page, 'SINT.ADMIN');
    await page.goto('/administracao/liberacao');
    await expect(page.getByTestId('recurso-pessoas.colaborador')).toContainText('Desligada', {
      timeout: 30_000,
    });
    await page.getByTestId('abrir-pessoas.colaborador').click();
    const pre = page.getByTestId('form-prerequisito');
    await pre
      .getByLabel('Evidência (protocolo ou número; nunca o certificado ou a senha)')
      .fill('Conferência sintética do RH');
    await pre.locator('#prereq-senha').fill(SENHA);
    await pre.getByRole('button', { name: 'Registrar pré-requisito' }).click();
    await expect(page.getByTestId('mensagem-liberacao')).toBeVisible();
    await chave(page, 'pessoas.colaborador', true, 'Colaboradores sintéticos do E2E M52.1');

    // O colaborador sintético está trabalhando (sessão aberta em outro navegador).
    const outro = await browser.newContext();
    const colab = await outro.newPage();
    await entrar(colab, 'SINT.COLAB');

    // Regra 1: a prévia pelo CPF reusa o profissional e o usuário.
    await entrar(page, 'SINT.RH');
    await page.goto('/pessoas/colaboradores');
    await page.getByTestId('abrir-admissao').click();
    await expect(page.getByTestId('tela-admissao')).toBeVisible();
    await page.getByLabel('CPF', { exact: true }).fill('123');
    await page.getByTestId('consultar-cpf').click();
    await expect(page.getByText('CPF inválido. Confira os números.')).toBeVisible();
    await page.getByLabel('CPF', { exact: true }).fill(CPF);
    await page.getByTestId('consultar-cpf').click();
    await expect(page.getByTestId('previa-profissional')).toContainText('ENFERMEIRA SINTETICA UM');
    await expect(page.getByTestId('previa-usuario')).toContainText('SINT.COLAB');
    await semViolacaoAxe(page, 'admissão: prévia');
    await page.getByTestId('admissao-continuar').click();
    await page.getByLabel('Data de admissão').fill(br(hoje));
    await page.getByLabel('Data de admissão').press('Tab');
    await page.getByLabel('Cargo', { exact: true }).fill('Enfermeira assistencial');
    await page.getByLabel('Carga semanal (horas)').fill('36');
    await escolher(page.getByTestId('admissao-centro-custo'), { rotulo: /Enfermagem da clínica médica/ });
    await page.getByLabel('Matrícula').fill('E2E-0001');
    await semViolacaoAxe(page, 'admissão: vínculo');
    await page.getByTestId('admissao-revisar').click();
    await expect(page.getByTestId('admissao-resumo')).toContainText('Enfermeira assistencial');
    await page.getByTestId('admissao-gravar').click();
    await expect(page.getByTestId('admissao-concluida')).toBeVisible();
    await page.getByTestId('abrir-ficha-admitido').click();

    // Ficha: CPF mascarado; a situação do cadastro com "a confirmar" (regra 4); o acesso liberado.
    await expect(page.getByTestId('tela-ficha-colaborador')).toBeVisible();
    await expect(page.getByTestId('ficha-cpf')).toContainText('***.***.');
    await expect(page.getByTestId('ficha-cpf')).not.toContainText(CPF.slice(0, 6));
    await expect(page.getByTestId('ficha-situacao-cadastro')).toContainText('a confirmar');
    await expect(page.getByTestId('ficha-acesso')).toContainText('SINT.COLAB: liberado');
    await expect(page.getByTestId('registro-952101')).toContainText('Validade não informada');
    await semViolacaoAxe(page, 'ficha do colaborador');

    // Regra 3: a validade conferida, a 30 dias: "vence em breve".
    await page.getByTestId('registrar-validade-952101').click();
    const fv = page.getByTestId('form-validade');
    await fv.getByLabel('Válido até').fill(br(em30));
    await fv.getByLabel('Válido até').press('Tab');
    await page.getByTestId('validade-gravar').click();
    await expect(page.getByTestId('aviso-ficha')).toContainText('Validade do registro conferida.');
    await expect(page.getByTestId('registro-952101')).toContainText('Vence em breve');

    // Dependente.
    await page.getByTestId('abrir-dependente').click();
    const fd = page.getByTestId('form-dependente');
    await fd.getByLabel('Nome completo').fill('FILHO SINTETICO E2E');
    await fd.getByLabel('Nascimento').fill('10/05/2020');
    await fd.getByLabel('Nascimento').press('Tab');
    await escolher(page.getByTestId('dependente-parentesco'), { rotulo: /^Filho\(a\) ou enteado\(a\)$/ });
    await semViolacaoAxe(page, 'inclusão do dependente');
    await page.getByTestId('dependente-gravar').click();
    await expect(page.getByTestId('ficha-dependentes')).toContainText('FILHO SINTETICO E2E');
    // Onde a profissional atende, por registro (o lado assistencial da ficha).
    await expect(page.getByTestId('registro-unidades-952101')).toContainText('Unidade sintética');
    // Fim do dependente incluído por engano (com confirmação; nunca apagado): sai da ficha.
    await page
      .getByTestId('ficha-dependentes')
      .locator('tr', { hasText: 'FILHO SINTETICO E2E' })
      .getByRole('button', { name: 'Encerrar' })
      .click();
    const fe = page.getByTestId('form-encerrar-dependente');
    await expect(fe).toContainText('não é apagado');
    await fe.getByLabel('Motivo').fill('Incluído por engano no cadastro (E2E)');
    await semViolacaoAxe(page, 'fim do dependente');
    await page.getByTestId('encerrar-dependente-gravar').click();
    await expect(page.getByTestId('aviso-ficha')).toContainText('Dependente encerrado.');
    await expect(page.getByTestId('ficha-dependentes')).not.toContainText('FILHO SINTETICO E2E');

    // Mudança funcional no histórico (só inclusão).
    await page.getByTestId('abrir-mudanca').click();
    const fm = page.getByTestId('form-mudanca');
    await fm.getByLabel('Cargo').fill('Enfermeira supervisora');
    await fm.getByLabel('Motivo').fill('Promoção aprovada pela coordenação de enfermagem');
    await page.getByTestId('mudanca-gravar').click();
    await expect(page.getByTestId('ficha-cargo')).toContainText('Enfermeira supervisora');
    await expect(page.getByTestId('ficha-historico')).toContainText('Mudança de cargo');

    // Regra 2: desligar com a senha; o acesso é bloqueado hoje e a sessão aberta cai.
    await page.getByTestId('abrir-desligamento').click();
    const fx = page.getByTestId('form-desligamento');
    await expect(fx).toContainText('não é apagado');
    await escolher(page.getByTestId('desligamento-tipo'), { rotulo: 'Pedido de demissão' });
    await fx.getByLabel('Motivo').fill('Pedido de demissão do colaborador sintético');
    await fx.getByTestId('desligamento-senha').fill(SENHA);
    await semViolacaoAxe(page, 'desligamento');
    await page.getByTestId('desligamento-confirmar').click();
    await expect(page.getByTestId('resultado-desligamento')).toContainText('Acesso SINT.COLAB bloqueado');
    await page.getByTestId('fechar-desligamento').click();
    await expect(page.getByTestId('ficha-estado')).toContainText('Desligado');
    await expect(page.getByTestId('ficha-acesso')).toContainText('SINT.COLAB: bloqueado');
    await expect(page.getByTestId('abrir-desligamento')).toHaveCount(0);

    await colab.goto('/inicio');
    await expect(colab).toHaveURL(/\/entrar/, { timeout: 30_000 });
    await colab.getByTestId('campo-login').fill('SINT.COLAB');
    await colab.getByTestId('campo-senha').fill(SENHA);
    await colab.getByTestId('botao-entrar').click();
    await expect(colab).not.toHaveURL(/\/inicio/);
    await outro.close();

    // A lista mostra o desligado; quem só consulta não vê as ações.
    await page.goto('/pessoas/colaboradores');
    await escolher(page.getByTestId('filtro-estado'), { rotulo: 'Desligados' });
    await page.getByTestId('filtrar').click();
    await expect(page.getByTestId('tabela-colaboradores')).toContainText('ENFERMEIRA SINTETICA UM');
    // O CPF digitado acha o colaborador (filtro exato; a lista não mostra o CPF); os filtros de unidade e setor.
    await page.getByLabel('Nome, matrícula ou CPF').fill(CPF);
    await page.getByTestId('filtrar').click();
    await expect(page.getByTestId('tabela-colaboradores')).toContainText('ENFERMEIRA SINTETICA UM');
    await expect(page.getByTestId('tabela-colaboradores')).not.toContainText(CPF.slice(0, 6));
    await expect(page.getByTestId('filtro-unidade')).toBeVisible();
    await expect(page.getByTestId('filtro-setor')).toBeVisible();
    await semViolacaoAxe(page, '/pessoas/colaboradores (ligada)');
    await entrar(page, 'SINT.RH.CONSULTA');
    await page.goto('/pessoas/colaboradores');
    await expect(page.getByTestId('pessoas-so-consulta')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('abrir-admissao')).toHaveCount(0);

    // Recolher: desligar a chave (as telas voltam à consulta; os dados ficam).
    await entrar(page, 'SINT.ADMIN');
    await page.goto('/administracao/liberacao');
    await expect(page.getByTestId('recurso-pessoas.colaborador')).toContainText('Ligada', {
      timeout: 30_000,
    });
    await chave(page, 'pessoas.colaborador', false, 'Recolher o E2E M52.1');
    await expect(page.getByTestId('recurso-pessoas.colaborador')).toContainText('Desligada');
    expect(externas).toEqual([]);
  });
});
