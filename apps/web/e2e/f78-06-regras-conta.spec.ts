// F8 (06-FAT linha 13) @C2-029: criação e quebra automática de contas pelo caminho da tela `/faturamento/regras-conta`.
// As rotas exigem o banco próprio e o E2E roda com a fonte sintética, então as respostas da API são simuladas pelo
// Playwright com massa SINTÉTICA. O que se prova é a tela: a validação do domínio enquanto se digita (a quebra sem
// período nem critério trava o salvar), a gravação da regra de quebra semanal com o corpo esperado e a simulação sobre
// um atendimento mostrando a regra que vale e o período da conta. O efeito no banco está nos contratos de efeito
// apps/api/src/modulos/faturamento/regras-comerciais-propria.int.spec.ts e quebra-conta.int.spec.ts.
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const ATENDIMENTO = 9029;

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

async function simular(page: Page, enviados: Record<string, unknown>[]): Promise<void> {
  const regrasConta: Record<string, unknown>[] = [
    {
      id: 11,
      versao: 1,
      acao: 'criar_conta',
      origemEntrada: 1,
      categoriaAtendimento: null,
      setor: null,
      grupo: null,
      fonteOrigem: null,
      fonteDestino: 3,
      periodicidade: null,
      prioridade: 10,
      vigenciaInicio: '2026-01-01',
      ativo: true,
      excecoes: [],
    },
  ];
  await page.route('**/api/faturamento/regras-comerciais', (r) =>
    json(r, {
      regrasConta,
      descontos: [],
      franquias: [],
      ambulancia: [],
      ligacao: [],
      opcoes: {
        fontes: [
          { id: 2, descricao: 'CONVENIO SINTETICO A' },
          { id: 3, descricao: 'PARTICULAR SINTETICO' },
        ],
        contratos: [],
        origensEntrada: [{ id: 1, descricao: 'PRONTO-SOCORRO SINTETICO' }],
        categoriasAtendimento: [{ id: 4, descricao: 'INTERNACAO SINTETICA' }],
        setores: [{ id: 5, descricao: 'UTI SINTETICA' }],
        grupos: [],
        categoriasAmbulancia: [],
        rotas: [],
        tiposLigacao: [],
      },
    }),
  );
  await page.route('**/api/faturamento/regras-comerciais/contas', (r) => {
    const corpo = r.request().postDataJSON() as Record<string, unknown>;
    enviados.push({ regra: corpo });
    regrasConta.push({
      ...corpo,
      id: 12,
      versao: 1,
      origemEntrada: null,
      categoriaAtendimento: 4,
      excecoes: [],
    });
    return json(r, { id: 12 });
  });
  await page.route('**/api/faturamento/regras-comerciais/simulacao**', (r) => {
    enviados.push({ simulacao: new URL(r.request().url()).searchParams.get('atendimento') });
    return json(r, {
      criacao: { regraId: 11, periodo: null, avaliadas: [{ id: 11, motivo: null }] },
      quebra: {
        regraId: 12,
        periodo: { inicio: '2026-11-23', fim: '2026-11-29' },
        avaliadas: [{ id: 12, motivo: null }],
      },
    });
  });
}

test.describe('@C2-029 criação e quebra automática de contas (06-FAT linha 13)', () => {
  test('validação do domínio na hora, regra de quebra semanal gravada e simulação com o período', async ({
    page,
  }) => {
    const enviados: Record<string, unknown>[] = [];
    await simular(page, enviados);
    await entrar(page, 'SINT.TISS');

    await page.goto('/faturamento/regras-conta');
    await expect(page.getByTestId('tela-regras-conta')).toBeVisible();
    await expect(page.getByTestId('rc-regra-11')).toContainText('PARTICULAR SINTETICO');

    // Quebra sem período nem critério: o domínio recusa enquanto se digita e o salvar fica travado.
    await escolher(page.getByTestId('rc-acao'), { rotulo: 'Quebrar a conta por período' });
    await expect(page.getByTestId('rc-fonte-destino')).toBeHidden();
    await expect(page.getByTestId('rc-erros')).toContainText('período');
    await expect(page.getByTestId('rc-salvar')).toBeDisabled();

    // Com o período semanal e a categoria internação, a regra vale e grava.
    await escolher(page.getByTestId('rc-periodicidade'), { rotulo: /Semanal/ });
    await escolher(page.getByTestId('rc-categoria'), { rotulo: 'INTERNACAO SINTETICA' });
    await expect(page.getByTestId('rc-erros')).toBeHidden();
    await expect(page.getByTestId('rc-salvar')).toBeEnabled();
    await page.getByTestId('rc-salvar').click();
    await expect(page.getByTestId('rc-mensagem')).toContainText('Regra gravada');
    expect(enviados[0]).toMatchObject({
      regra: {
        acao: 'quebrar_conta',
        periodicidade: 'semanal',
        categoriaAtendimentoId: 4,
        fonteDestinoId: null,
      },
    });
    await expect(page.getByTestId('rc-regra-12')).toContainText(/Semanal/);

    // Simulação sobre o atendimento: a regra de quebra que vale e o período da conta.
    await expect(page.getByTestId('rc-simular')).toBeDisabled();
    await page.getByTestId('rc-sim-atendimento').fill(String(ATENDIMENTO));
    await page.getByTestId('rc-simular').click();
    await expect(page.getByTestId('rc-sim-criacao')).toContainText('Vale a regra #11');
    await expect(page.getByTestId('rc-sim-quebra')).toContainText('Vale a regra #12');
    await expect(page.getByTestId('rc-sim-quebra')).toContainText('Conta de 2026-11-23 a 2026-11-29');
    expect(enviados).toContainEqual({ simulacao: String(ATENDIMENTO) });
    await semViolacaoAxe(page, 'criação e quebra de contas');
  });
});
