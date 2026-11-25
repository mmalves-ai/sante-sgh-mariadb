// F3.1 (02-CAD linha 12) @F3.1-05: a origem e indicação do paciente registrada na ABERTURA do atendimento, sem ir à
// ficha. O bloco fica recolhido e só consulta ao abrir; aberto, é o mesmo componente da ficha (validação na hora, mesmo
// corpo de pedido). As rotas dos vínculos exigem o banco próprio e são simuladas pelo Playwright com massa SINTÉTICA; o
// efeito no banco está no contrato de efeito (apps/api/src/modulos/cadastro/paciente-vinculos-proprio.int.spec.ts).
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const PACIENTE = 1001;

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

test.describe('@F3.1 @F3.1-05 origem do paciente na abertura do atendimento', () => {
  test.describe.configure({ timeout: 240_000 });

  test('recolhido não consulta; aberto, valida na hora e registra a origem; axe', async ({ page }) => {
    const leituras: string[] = [];
    const gravados: Record<string, unknown>[] = [];
    const captacoes: Record<string, unknown>[] = [];
    // A recepção ambulatorial abre o atendimento e registra a origem (o administrador do sistema não abre atendimento).
    await entrar(page, 'SINT.ATENDIMENTO');
    await page.route('**/api/cadastros/vinculos/opcoes', (r) => {
      leituras.push('opcoes');
      return json(r, {
        fontes: [],
        planos: [],
        tiposIndicacao: [
          { id: 7, descricao: 'INDICACAO SINTETICA', exigeProfissional: false, exigeComplemento: true },
          { id: 8, descricao: 'DEMANDA SINTETICA', exigeProfissional: false, exigeComplemento: false },
        ],
        parentescos: [],
        canais: ['indicacao_paciente', 'campanha', 'espontaneo'],
      });
    });
    await page.route(`**/api/cadastros/pacientes/${PACIENTE}/captacoes**`, async (rota) => {
      const req = rota.request();
      if (req.method() === 'GET') {
        leituras.push('captacoes');
        return json(rota, { itens: captacoes });
      }
      const corpo = (req.postDataJSON() ?? {}) as Record<string, unknown>;
      gravados.push(corpo);
      captacoes.push({
        id: 70,
        captadoEm: '2026-11-24T10:00:00',
        canal: corpo['canal'],
        tipoIndicacao: { id: 7, descricao: 'INDICACAO SINTETICA' },
        indicador: corpo['indicadorNome'],
        campanha: null,
        situacao: 'ativa',
      });
      return json(rota, { id: 70 }, 201);
    });

    await page.goto('/recepcao/atendimento/novo');
    await expect(page.getByTestId('tela-abrir-atendimento')).toBeVisible();
    // Sem paciente escolhido não há bloco da origem.
    await expect(page.getByTestId('abrir-atd-origem')).toHaveCount(0);
    await page.getByTestId('abrir-atd-termo').fill('JOSE DA SILVA');
    await page.getByTestId('abrir-atd-buscar').click();
    await page.getByTestId(`abrir-atd-paciente-${PACIENTE}`).click();
    await expect(page.getByTestId('abrir-atd-paciente-escolhido')).toBeVisible();

    // Recolhido: nenhuma consulta dos vínculos.
    const origem = page.getByTestId('abrir-atd-origem');
    await expect(origem).toBeVisible();
    expect(leituras).toHaveLength(0);

    // Aberto: lê a origem do paciente e as opções; o tipo que exige complemento pede quem indicou antes de liberar.
    await origem.locator('summary').click();
    const cap = origem.getByTestId('captacao-paciente');
    await expect(cap.getByText('Origem não registrada.')).toBeVisible();
    const fc = cap.getByTestId('nova-captacao');
    await escolher(fc.getByRole('combobox', { name: 'Canal' }), { rotulo: 'Indicação de paciente' });
    await escolher(fc.getByRole('combobox', { name: 'Tipo de indicação' }), {
      rotulo: 'INDICACAO SINTETICA',
    });
    const registrar = fc.getByRole('button', { name: 'Registrar origem' });
    await expect(fc.getByText('Informe quem indicou.')).toBeVisible();
    await expect(registrar).toBeDisabled();
    await fc.getByLabel('Quem indicou').fill('VIZINHA SINTETICA');
    await semViolacaoAxe(page, '/recepcao/atendimento/novo (origem aberta)');
    await registrar.click();
    await expect(cap.getByRole('status')).toContainText('Origem registrada.');
    await expect(cap.getByRole('listitem').first()).toContainText(
      'Indicação de paciente — INDICACAO SINTETICA: VIZINHA SINTETICA',
    );
    expect(gravados).toEqual([
      {
        canal: 'indicacao_paciente',
        tipoIndicacao: 7,
        indicadorNome: 'VIZINHA SINTETICA',
        indicadorProfissional: null,
        campanha: null,
      },
    ]);
    expect(leituras.filter((l) => l === 'opcoes')).toHaveLength(1);

    // Paciente não identificado (emergência): não há origem a registrar; o bloco some e a abertura continua.
    await page.getByTestId('abrir-atd-nao-identificado').check();
    await expect(page.getByTestId('abrir-atd-origem')).toHaveCount(0);
  });
});
