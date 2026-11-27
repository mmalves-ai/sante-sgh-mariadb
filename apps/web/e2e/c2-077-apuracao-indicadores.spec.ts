// E2E @C2-077 (F3, 01-REL L112): apuração mensal dos indicadores obrigatórios de internação, pela tela
// /relatorios/apuracao-indicadores aberta pelo link dos Indicadores hospitalares. O administrador vê a competência
// sem apuração, a conferência na hora (mês que ainda não começou desliga os botões), apura o mês e lê a tabela com
// numerador, denominador, valor, meta e situação. As rotas exigem o banco próprio e o E2E roda com a fonte sintética:
// as respostas são simuladas pelo Playwright com massa SINTÉTICA (só agregados). O efeito no banco está em
// apps/api/src/modulos/relatorio/apuracao-internacao-propria.int.spec.ts.
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe } from './ajuda.js';

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

const COMPETENCIA = '2026-01';
const apuracoes = [
  {
    codigo: 'mediaPermanencia',
    nome: 'Média de permanência',
    competencia: `${COMPETENCIA}-01`,
    numerador: 1240,
    denominador: 310,
    valor: 4,
    valorMeta: 5,
    situacaoMeta: 'na_meta',
    situacao: 'previa',
    dadosAte: '2026-02-01T03:00:00.000Z',
  },
  {
    codigo: 'taxaOcupacao',
    nome: 'Taxa de ocupação',
    competencia: `${COMPETENCIA}-01`,
    numerador: 1240,
    denominador: 1550,
    valor: 80,
    valorMeta: 85,
    situacaoMeta: 'fora_da_meta',
    situacao: 'previa',
    dadosAte: '2026-02-01T03:00:00.000Z',
  },
];

test.describe('Apuração dos indicadores de internação @C2-077 @fase3', () => {
  test.setTimeout(120_000);
  test('competência sem apuração, conferência na hora, apurar e ler numerador e denominador; axe', async ({
    page,
  }) => {
    let apurado: Record<string, unknown> | null = null;
    await page.route('**/api/relatorios/indicadores-internacao/apuracao**', async (r) => {
      if (r.request().method() === 'POST') {
        apurado = r.request().postDataJSON() as Record<string, unknown>;
        return json(r, {
          competencia: COMPETENCIA,
          incluidas: 2,
          atualizadas: 0,
          mantidasFechadas: 0,
          semMudanca: 0,
          apuracoes,
        });
      }
      const competencia = new URL(r.request().url()).searchParams.get('competencia') ?? '';
      return json(r, { competencia, apuracoes: [] });
    });

    // A diretoria lê os indicadores hospitalares (o administrador do sistema não tem a leitura) e apura o mês.
    await entrar(page, 'SINT.DIRETORIA');
    await page.goto('/relatorios/indicadores');
    await page.getByTestId('link-apuracao-indicadores').click();
    await expect(page).toHaveURL(/\/relatorios\/apuracao-indicadores/);
    await expect(page.getByTestId('tela-apuracao-indicadores')).toBeVisible();
    await expect(page.getByTestId('apuracao-vazia')).toBeVisible();

    // Conferência na hora: um mês que ainda não começou desliga "Ver" e "Apurar".
    const campo = page.getByTestId('apuracao-competencia');
    await campo.fill('2099-01');
    await expect(page.getByTestId('apuracao-competencia-erro')).toContainText('ainda não começou');
    await expect(page.getByTestId('apuracao-apurar')).toBeDisabled();

    await campo.fill(COMPETENCIA);
    await expect(page.getByTestId('apuracao-competencia-erro')).toHaveCount(0);
    await page.getByTestId('apuracao-apurar').click();
    await expect(page.getByTestId('apuracao-resultado')).toContainText('2 incluídas');
    expect(apurado).toEqual({ competencia: COMPETENCIA });

    const tabela = page.getByTestId('tabela-apuracao');
    await expect(tabela).toContainText('01/2026');
    await expect(page.getByTestId('apuracao-taxaOcupacao')).toContainText('1.240');
    await expect(page.getByTestId('apuracao-taxaOcupacao')).toContainText('1.550');
    await expect(page.getByTestId('apuracao-taxaOcupacao-valor')).toContainText('80');
    await expect(page.getByTestId('apuracao-taxaOcupacao-meta')).toContainText('Fora da meta');
    await expect(page.getByTestId('apuracao-mediaPermanencia-meta')).toContainText('Na meta');
    await semViolacaoAxe(page, 'apuração dos indicadores de internação');
  });
});
