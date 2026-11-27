// E2E @C2-116 (F7, 08-SGO L98, decisão 56): regras de franquia do plano pela tela /operadora/franquia-regras, aberta
// pelo atalho da tela de regras de coparticipação. O analista escolhe a operadora e o plano, vê a regra mensal vigente,
// monta uma nova regra e a validação na hora aponta o percentual junto com o fator e o teto por guia acima do limite;
// corrigido, cadastra a regra e depois encerra a mensal pela vigência (a regra nunca é apagada e fica no histórico). As
// rotas /api/operadora/franquia-regras exigem o banco próprio e o E2E roda com a fonte sintética: as respostas são
// simuladas pelo Playwright com massa SINTÉTICA, no contrato da API. O efeito no banco está em
// apps/api/src/modulos/operadora/regras-franquia-propria.int.spec.ts e cobranca-franquia.int.spec.ts.
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

async function data(page: Page, testid: string, texto: string): Promise<void> {
  const campo = page.getByTestId(testid).locator('input');
  await campo.fill(texto);
  await campo.press('Tab');
}
const campo = (page: Page, testid: string) => page.getByTestId(testid).locator('input');

const regra = (x: Record<string, unknown>): Record<string, unknown> => ({
  id: 1,
  versao: 1,
  codigo: 'MENSAL',
  descricao: 'FRANQUIA MENSAL SINTETICA',
  tipoFranquia: 3,
  tipoFranquiaDescricao: 'POR PERIODO SINTETICA',
  plano: 5,
  contrato: null,
  grupo: null,
  grupoDescricao: null,
  regime: null,
  regimeDescricao: null,
  valor: 200,
  percentual: 50,
  fator: null,
  tetoPorGuia: 80,
  periodoAcumulo: 'mes',
  diasInternacao: 3,
  cobraGuiaAmbulatorialNaInternacao: false,
  inicio: '2026-01-01',
  fim: null,
  vigente: true,
  ...x,
});

test.describe('Regras de franquia @C2-116 @fase7', () => {
  test.setTimeout(180_000);
  test('franquia com validação na hora, cadastro e encerramento da mensal; axe', async ({ page }) => {
    const pedidos: { caminho: string; metodo: string; corpo: Record<string, unknown> }[] = [];
    let regras: Record<string, unknown>[] = [regra({})];

    await page.route('**/api/operadora/cobranca/tela', (r) =>
      json(r, {
        liberacao: { ligada: true, motivo: null },
        acoes: { gerar: true, motivo: null },
        operadoras: [{ id: 7, razaoSocial: 'OPERADORA SINTETICA', registroAns: '410361' }],
        hoje: '2026-11-27',
        mensagens: { enviar: false, motivo: 'fora de produção' },
        parametros: {
          multaPercentual: 2,
          jurosPercentualMes: 1,
          diasLimiteNotificacao: 50,
          diasInadimplencia: 60,
          diasPrazoNotificacao: 10,
          parcelasMaximas: 12,
        },
      }),
    );
    await page.route('**/api/operadora/coparticipacao-procedimentos**', (r) => json(r, []));
    await page.route('**/api/operadora/coparticipacao-regras/**', async (r) => {
      const caminho = new URL(r.request().url()).pathname;
      if (caminho.endsWith('/opcoes'))
        return json(r, { planos: [], contratos: [], tiposGuia: [], grupos: [], regimes: [] });
      return json(r, []);
    });
    await page.route('**/api/operadora/franquia-regras/**', async (r) => {
      const req = r.request();
      const caminho = new URL(req.url()).pathname;
      if (req.method() === 'GET' && caminho.endsWith('/opcoes'))
        return json(r, {
          planos: [{ id: 5, rotulo: 'PLANO SINTETICO ENFERMARIA' }],
          contratos: [],
          tiposFranquia: [{ id: 3, rotulo: 'POR PERIODO SINTETICA' }],
          grupos: [],
          regimes: [],
        });
      if (req.method() === 'GET') return json(r, regras);
      const corpo = (req.postDataJSON() ?? {}) as Record<string, unknown>;
      pedidos.push({ caminho, metodo: req.method(), corpo });
      if (caminho.endsWith('/encerrar')) {
        regras = regras.map((x) =>
          x.id === 1 ? { ...x, versao: 2, fim: String(corpo.fim), vigente: false } : x,
        );
        return json(r, { id: 1, versao: 2 });
      }
      regras = [
        ...regras,
        regra({ ...corpo, id: 2, tipoFranquiaDescricao: 'POR PERIODO SINTETICA', vigente: true }),
      ];
      return json(r, { id: 2, versao: 1 }, 201);
    });

    await entrar(page, 'SINT.OPERADORA');
    await page.goto('/operadora/coparticipacao-regras');
    await page.getByTestId('link-franquia').click();
    await expect(page).toHaveURL(/\/operadora\/franquia-regras/);
    await expect(page.getByTestId('tela-regras-franquia')).toBeVisible();
    await expect(page.getByTestId('franq-operadora')).toContainText('OPERADORA SINTETICA');
    await escolher(page.getByTestId('franq-alvo'), { rotulo: /PLANO SINTETICO/ });
    await expect(page.getByTestId('franq-regra-MENSAL')).toContainText('Por mês');
    await expect(page.getByTestId('franq-regra-MENSAL')).toContainText('(vigente)');

    // Nova regra anual: a validação aponta na hora o percentual com o fator e o teto acima do limite.
    await campo(page, 'franq-codigo').fill('ANUAL');
    await campo(page, 'franq-descricao').fill('FRANQUIA ANUAL SINTETICA');
    await escolher(page.getByTestId('franq-tipo'), { rotulo: 'POR PERIODO SINTETICA' });
    await campo(page, 'franq-limite').fill('300');
    await campo(page, 'franq-percentual').fill('40');
    await campo(page, 'franq-fator').fill('0,5');
    await campo(page, 'franq-teto').fill('500');
    await escolher(page.getByTestId('franq-janela'), { rotulo: 'Por ano' });
    await data(page, 'franq-inicio', '01/12/2026');
    const falta = page.getByTestId('franq-falta');
    await expect(falta).toContainText('o percentual ou o fator, não os dois');
    await expect(falta).toContainText('teto por guia até o limite');
    await expect(page.getByTestId('franq-salvar')).toBeDisabled();

    await campo(page, 'franq-fator').fill('');
    await campo(page, 'franq-teto').fill('100');
    await expect(falta).toHaveCount(0);
    await page.getByTestId('franq-salvar').click();
    await expect(page.getByTestId('franq-aviso')).toContainText('Regra cadastrada.');
    await expect(page.getByTestId('franq-regra-ANUAL')).toContainText('Por ano');
    const inclusao = pedidos.find((p) => p.metodo === 'POST' && !p.caminho.endsWith('/encerrar'));
    expect(inclusao?.caminho).toMatch(/\/api\/operadora\/franquia-regras\/7$/);
    expect(inclusao?.corpo).toMatchObject({
      plano: 5,
      contrato: null,
      tipoFranquia: 3,
      valor: 300,
      percentual: 40,
      fator: null,
      tetoPorGuia: 100,
      periodoAcumulo: 'ano',
      inicio: '2026-12-01',
    });

    // Encerra a mensal pela vigência: a linha continua na lista, sem o selo de vigente.
    await page.getByTestId('franq-encerrar-MENSAL').click();
    await expect(page.getByTestId('franq-confirmar-encerrar')).toBeDisabled();
    await data(page, 'franq-fim-encerrar', '30/11/2026');
    await page.getByTestId('franq-confirmar-encerrar').click();
    await expect(page.getByTestId('franq-aviso')).toContainText('Regra encerrada.');
    await expect(page.getByTestId('franq-regra-MENSAL')).not.toContainText('(vigente)');
    expect(pedidos.find((p) => p.caminho.endsWith('/regra/1/encerrar'))?.corpo).toMatchObject({
      versao: 1,
      fim: '2026-11-30',
    });

    await semViolacaoAxe(page, 'regras de franquia');
  });
});
