// E2E @C2-111 (F8, 06-FAT L49): rateio do repasse por setor e custos do prestador pela tela /repasse/rateio-custos,
// aberta pelas regras do repasse. O analista escolhe o médico, inclui o custo do prestador (a forma troca o campo),
// monta a regra de rateio com dois setores (a soma aparece na hora e o botão só libera com 100%), escolhe a apuração,
// vê o que a regra daria e grava o rateio; por fim, encerra a regra. As rotas /api/repasse/rateio-custos exigem o banco
// próprio e o E2E roda com a fonte sintética: as respostas são simuladas pelo Playwright com massa SINTÉTICA. O efeito
// no banco está em apps/api/src/modulos/repasse/rateio-custo-propria.int.spec.ts.
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe } from './ajuda.js';
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

const json = (rota: Route, corpo: unknown, status = 200) =>
  rota.fulfill({ status, contentType: 'application/json', body: JSON.stringify(corpo) });

const painelBase = {
  tipos: [
    {
      id: 5,
      codigo: 'SALA',
      descricao: 'Uso de sala sintético',
      natureza: 'custo',
      forma: 'informado',
      valorPadrao: null,
      percentualPadrao: null,
      ativo: true,
      versao: 1,
    },
  ],
  custos: [] as unknown[],
  regras: [] as unknown[],
  setores: [
    { id: 31, nome: 'Setor sintético A', centroCusto: 41, centroNome: 'Centro sintético A' },
    { id: 32, nome: 'Setor sintético B', centroCusto: 42, centroNome: 'Centro sintético B' },
  ],
  centros: [
    { id: 41, nome: 'Centro sintético A' },
    { id: 42, nome: 'Centro sintético B' },
  ],
  grupos: [{ id: 51, descricao: 'Grupo sintético' }],
  apuracoes: [{ id: 61, numero: 'AP-1', competencia: '2026-10-01', situacao: 'apurada' }],
};
const regraGravada = {
  id: 71,
  descricao: 'Rateio sintético',
  profissional: 7001,
  profissionalNome: 'MEDICO SINTETICO',
  grupoRepasse: null,
  grupoDescricao: null,
  base: 'repasse',
  inicio: '2026-01-01',
  fim: null,
  versao: 1,
  setores: [
    {
      setor: 31,
      setorNome: 'Setor sintético A',
      centroCusto: 41,
      centroNome: 'Centro sintético A',
      percentual: 60,
    },
    {
      setor: 32,
      setorNome: 'Setor sintético B',
      centroCusto: 42,
      centroNome: 'Centro sintético B',
      percentual: 40,
    },
  ],
};

test.describe('rateio do repasse por setor e custos do prestador @C2-111', () => {
  test.setTimeout(240_000);
  test.use({ actionTimeout: 30_000 });
  test('custo do prestador → regra com soma na hora → rateio da apuração → encerrar; axe', async ({
    page,
  }) => {
    let rateado = false;
    let comRegra = false;
    const corpos: Record<string, unknown> = {};
    await page.route('**/api/repasse/prestadores**', (rota) =>
      json(rota, [{ prestador: 7001, registro: 900111, nome: 'MEDICO SINTETICO', conselho: 'CRM 0000' }]),
    );
    await page.route('**/api/repasse/rateio-custos**', async (rota) => {
      const url = new URL(rota.request().url());
      const metodo = rota.request().method();
      if (metodo === 'GET' && url.pathname.endsWith('/apuracao/61'))
        return json(rota, {
          apuracao: { id: 61, competencia: '2026-10-01', situacao: 'apurada' },
          rateavel: true,
          gravado: rateado
            ? [
                {
                  profissional: 7001,
                  profissionalNome: 'MEDICO SINTETICO',
                  setor: 31,
                  setorNome: 'Setor sintético A',
                  valor: 3600,
                },
                {
                  profissional: 7001,
                  profissionalNome: 'MEDICO SINTETICO',
                  setor: 32,
                  setorNome: 'Setor sintético B',
                  valor: 2400,
                },
              ]
            : [],
          totaisPorSetor: rateado
            ? [
                { setor: 31, setorNome: 'Setor sintético A', valor: 3600 },
                { setor: 32, setorNome: 'Setor sintético B', valor: 2400 },
              ]
            : [],
          simulado: [
            { profissional: 7001, setor: 31, regra: 71, base: 'repasse', valor: 3600 },
            { profissional: 7001, setor: 32, regra: 71, base: 'repasse', valor: 2400 },
          ],
          pendencias: [],
        });
      if (metodo === 'GET') return json(rota, { ...painelBase, regras: comRegra ? [regraGravada] : [] });
      if (url.pathname.endsWith('/custos')) {
        corpos['custo'] = rota.request().postDataJSON();
        return json(rota, { id: 81 }, 201);
      }
      if (url.pathname.endsWith('/regras')) {
        corpos['regra'] = rota.request().postDataJSON();
        comRegra = true;
        return json(rota, { id: 71 }, 201);
      }
      if (url.pathname.endsWith('/ratear')) {
        corpos['ratear'] = rota.request().postDataJSON();
        rateado = true;
        return json(rota, { gravadas: 2, excluidas: 0, pendencias: [] });
      }
      if (url.pathname.endsWith('/rateio/71/encerrar')) {
        corpos['encerrar'] = rota.request().postDataJSON();
        return json(rota, { id: 71 });
      }
      return json(rota, { codigo: 'nao-simulado' }, 404);
    });

    await entrar(page, 'SINT.REP.ANALISTA');
    await page.goto('/repasse/regras');
    await page.getByTestId('rg-ir-rateio-custos').click();
    await expect(page).toHaveURL(/\/repasse\/rateio-custos/);
    await expect(page.getByTestId('tela-rep-rateio-custos')).toBeVisible();
    await semViolacaoAxe(page, 'rateio e custos do prestador');

    // Visão por médico.
    await page.getByTestId('rc-medico-busca').fill('SINTETICO');
    await page.getByTestId('rc-medico-buscar').click();
    await expect(page.getByTestId('rc-novo-custo')).toBeVisible();

    // Custo do prestador: a forma percentual troca o campo; o botão só libera com o essencial.
    await expect(page.getByTestId('rc-custo-incluir')).toBeDisabled();
    await escolher(page.getByTestId('rc-custo-tipo'), { rotulo: /SALA/ });
    await page.getByTestId('rc-custo-descricao').fill('Sala sintética');
    await escolher(page.getByTestId('rc-custo-forma'), { rotulo: /produção/ });
    await page.getByTestId('rc-custo-percentual').fill('2');
    await expect(page.getByTestId('rc-custo-incluir')).toBeEnabled();
    await page.getByTestId('rc-custo-incluir').click();
    await expect(page.getByTestId('rc-mensagem')).toContainText('Custo incluído');
    expect(corpos['custo']).toMatchObject({
      profissional: 7001,
      tipo: 5,
      forma: 'percentual',
      percentual: 2,
      valor: null,
    });

    // Regra de rateio com dois setores: a soma aparece na hora e trava o botão até 100%.
    await page.getByTestId('rc-regra-descricao').fill('Rateio sintético');
    await escolher(page.getByTestId('rc-regra-setor-0'), { rotulo: 'Setor sintético A' });
    await page.getByTestId('rc-regra-pct-0').fill('60');
    await expect(page.getByTestId('rc-regra-soma')).toContainText('60');
    await expect(page.getByTestId('rc-regra-incluir')).toBeDisabled();
    await page.getByTestId('rc-regra-mais-setor').click();
    await escolher(page.getByTestId('rc-regra-setor-1'), { rotulo: 'Setor sintético B' });
    await expect(page.getByTestId('rc-regra-pct-1')).toHaveValue('40');
    await expect(page.getByTestId('rc-regra-soma')).toContainText('100%');
    await expect(page.getByTestId('rc-regra-incluir')).toBeEnabled();
    await page.getByTestId('rc-regra-incluir').click();
    await expect(page.getByTestId('rc-mensagem')).toContainText('Regra de rateio incluída');
    expect(corpos['regra']).toMatchObject({
      profissional: 7001,
      grupoRepasse: null,
      base: 'repasse',
      setores: [
        { setor: 31, percentual: 60 },
        { setor: 32, percentual: 40 },
      ],
    });
    await expect(page.getByTestId('rc-regra-71')).toContainText('Setor sintético A 60%');

    // Rateio da apuração: o previsto pela regra e a gravação.
    await escolher(page.getByTestId('rc-apuracao'), { rotulo: /AP-1/ });
    await expect(page.getByTestId('rc-previsto')).toContainText('Setor sintético B');
    await page.getByTestId('rc-ratear').click();
    await expect(page.getByTestId('rc-mensagem')).toContainText('2 linha(s)');
    expect(corpos['ratear']).toEqual({ apuracao: 61 });
    await expect(page.getByTestId('rc-total-31')).toBeVisible();
    await semViolacaoAxe(page, 'rateio gravado');

    // Encerrar a regra só antecipa o fim.
    await page.getByTestId('rc-regra-fim-71').fill('2026-12-31');
    await page.getByTestId('rc-regra-encerrar-71').click();
    await expect(page.getByTestId('rc-mensagem')).toContainText('Encerrado');
    expect(corpos['encerrar']).toEqual({ versao: 1, fim: '2026-12-31' });
  });
});
