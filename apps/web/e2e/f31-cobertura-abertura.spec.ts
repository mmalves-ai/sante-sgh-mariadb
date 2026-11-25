// F3.1 (02-CAD linha 9): a carteira do cadastro do paciente na abertura do atendimento, pelo caminho da tela. As
// coberturas exigem o banco próprio e o E2E roda com a fonte sintética: a rota das coberturas é simulada pelo
// Playwright com massa SINTÉTICA. O que se prova é a tela: ao escolher o paciente, a carteira proposta preenche o
// convênio, o plano, a carteirinha e a validade sem digitar; a carteira vencida avisa e leva à ficha do paciente em
// outra aba (a abertura não se desmonta); ao voltar, a carteira renovada na ficha entra sem perder o que já estava
// preenchido; ao esvaziar o convênio, o que veio da carteira sai. A escolha da proposta e o efeito no banco estão no domínio
// (packages/dominio-cadastro/src/cobertura) e no contrato de efeito (paciente-vinculos-proprio.int.spec.ts).
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const PACIENTE = 1001;
const CONVENIO = 306;

async function entrar(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

const json = (rota: Route, corpo: unknown, status = 200) =>
  rota.fulfill({ status, contentType: 'application/json', body: JSON.stringify(corpo) });

const carteira = (
  id: number,
  situacaoNoDia: string,
  numero: string,
  validade: string,
  principal: boolean,
) => ({
  id,
  fontePagadora: { id: CONVENIO, nome: 'OPERADORA SINTETICA' },
  plano: { id: 31, nome: 'PLANO SINTETICO OURO' },
  numeroCarteira: numero,
  validade,
  vigenciaInicio: '2026-01-01',
  vigenciaFim: null,
  titular: true,
  titularNome: null,
  principal,
  situacaoNoDia,
  versao: 1,
});

async function escolherPaciente(page: Page): Promise<void> {
  await page.goto('/recepcao/atendimento/novo');
  await page.getByTestId('abrir-atd-termo').fill('JOSE DA SILVA');
  await page.getByTestId('abrir-atd-buscar').click();
  await page.getByTestId(`abrir-atd-paciente-${PACIENTE}`).click();
  await expect(page.getByTestId('abrir-atd-paciente-escolhido')).toBeVisible();
}

test.describe('@F3.1 @F3.1-04 carteira do cadastro na abertura do atendimento', () => {
  test.describe.configure({ timeout: 240_000 });

  test('a carteira proposta preenche convênio, plano, carteirinha e validade; a vencida avisa; axe', async ({
    page,
  }) => {
    await entrar(page, 'SINT.ATENDIMENTO');
    await page.route(`**/api/cadastros/pacientes/${PACIENTE}/coberturas`, (r) =>
      json(r, {
        hoje: '2026-11-24',
        itens: [
          carteira(900, 'vigente', '0099887766', '2027-06-30', true),
          carteira(899, 'vencida', '0011223344', '2026-03-31', false),
        ],
        proposta: 900,
        avisos: [
          {
            id: 899,
            codigo: 'carteira-vencida',
            mensagem: 'Carteira OPERADORA SINTETICA vencida em 2026-03-31: peça a carteira nova.',
          },
        ],
      }),
    );
    await escolherPaciente(page);

    // Sem digitar: o convênio, o plano, a carteirinha e a validade vêm da carteira proposta.
    await expect(page.getByTestId('abrir-atd-da-carteira')).toBeVisible();
    const segurado = page.getByRole('region', { name: 'Segurado e carteirinha' });
    await expect(segurado.getByLabel('Validade da carteirinha')).toHaveValue('2027-06-30');
    await expect(segurado.getByLabel('Carteirinha', { exact: true })).toHaveValue('0099887766');
    await expect(segurado.getByLabel('Plano', { exact: true })).toHaveValue('PLANO SINTETICO OURO');
    await expect(page.getByTestId('abrir-atd-carteira-aviso')).toContainText('vencida em 2026-03-31');
    await expect(page.getByTestId('abrir-atd-ver-carteiras')).toHaveAttribute(
      'href',
      `/cadastros/pacientes/${PACIENTE}`,
    );
    await semViolacaoAxe(page, '/recepcao/atendimento/novo (carteira do cadastro)');

    // Esvaziar o convênio tira o que veio da carteira (a carteirinha de um convênio não fica em outro).
    const ficha = page.getByRole('region', { name: 'Dados do atendimento' });
    await escolher(ficha.getByLabel('Convênio', { exact: true }), '');
    await expect(page.getByTestId('abrir-atd-da-carteira')).toHaveCount(0);
    await expect(segurado.getByLabel('Validade da carteirinha')).toHaveValue('');
    // Voltar ao convênio da carteira traz a carteira de novo.
    await escolher(ficha.getByLabel('Convênio', { exact: true }), String(CONVENIO));
    await expect(page.getByTestId('abrir-atd-da-carteira')).toBeVisible();
    await expect(segurado.getByLabel('Validade da carteirinha')).toHaveValue('2027-06-30');
  });

  test('sem carteira em vigor, a abertura segue à mão e aponta a ficha do paciente', async ({ page }) => {
    await entrar(page, 'SINT.ATENDIMENTO');
    await page.route(`**/api/cadastros/pacientes/${PACIENTE}/coberturas`, (r) =>
      json(r, {
        hoje: '2026-11-24',
        itens: [carteira(899, 'encerrada', '0011223344', '2026-03-31', false)],
        proposta: null,
        avisos: [],
      }),
    );
    await escolherPaciente(page);
    await expect(page.getByText('O paciente não tem carteira em vigor no cadastro.')).toBeVisible();
    await expect(page.getByTestId('abrir-atd-da-carteira')).toHaveCount(0);
    await expect(page.getByTestId('abrir-atd-ver-carteiras')).toBeVisible();
  });

  test('a ficha abre em outra aba; na volta, a carteira renovada entra e o que já estava preenchido fica', async ({
    page,
  }) => {
    await entrar(page, 'SINT.ATENDIMENTO');
    // A resposta do cadastro muda entre as leituras: primeiro só a vencida; depois de renovada na ficha, a vigente.
    let renovada = false;
    await page.route(`**/api/cadastros/pacientes/${PACIENTE}/coberturas`, (r) =>
      json(
        r,
        renovada
          ? {
              hoje: '2026-11-24',
              itens: [carteira(899, 'vigente', '0055667788', '2027-12-31', true)],
              proposta: 899,
              avisos: [],
            }
          : {
              hoje: '2026-11-24',
              itens: [carteira(899, 'vencida', '0011223344', '2026-03-31', true)],
              proposta: null,
              avisos: [
                {
                  id: 899,
                  codigo: 'carteira-vencida',
                  mensagem: 'Carteira OPERADORA SINTETICA vencida em 2026-03-31: peça a carteira nova.',
                },
              ],
            },
      ),
    );
    await escolherPaciente(page);
    const segurado = page.getByRole('region', { name: 'Segurado e carteirinha' });
    await expect(page.getByTestId('abrir-atd-carteira-aviso')).toContainText('vencida em 2026-03-31');
    await expect(page.getByTestId('abrir-atd-da-carteira')).toHaveCount(0);

    // O que a pessoa já preencheu antes de ir à ficha.
    await page.getByLabel('Observação da ficha').fill('ABERTURA SINTETICA EM CURSO');

    // O atalho abre a ficha em outra aba: a abertura continua montada, com o que foi preenchido.
    const atalho = page.getByTestId('abrir-atd-ver-carteiras');
    await expect(atalho).toHaveAttribute('target', '_blank');
    const [ficha] = await Promise.all([page.context().waitForEvent('page'), atalho.click()]);
    await expect(ficha).toHaveURL(new RegExp(`/cadastros/pacientes/${PACIENTE}$`));
    renovada = true;
    await ficha.close();
    await expect(page).toHaveURL(/\/recepcao\/atendimento\/novo/);
    await expect(page.getByTestId('abrir-atd-paciente-escolhido')).toBeVisible();

    // Na volta, as carteiras são relidas (ao focar a aba ou pelo botão) e a renovada preenche a abertura.
    await page.getByTestId('abrir-atd-reler-carteiras').click();
    await expect(page.getByTestId('abrir-atd-da-carteira')).toBeVisible();
    await expect(segurado.getByLabel('Carteirinha', { exact: true })).toHaveValue('0055667788');
    await expect(segurado.getByLabel('Validade da carteirinha')).toHaveValue('2027-12-31');
    await expect(segurado.getByLabel('Plano', { exact: true })).toHaveValue('PLANO SINTETICO OURO');
    await expect(page.getByTestId('abrir-atd-carteira-aviso')).toHaveCount(0);
    await expect(page.getByLabel('Observação da ficha')).toHaveValue('ABERTURA SINTETICA EM CURSO');
  });
});
