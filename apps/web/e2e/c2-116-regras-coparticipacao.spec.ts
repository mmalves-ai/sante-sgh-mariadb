// E2E @C2-116 (F7, 08-SGO L98): regras de coparticipação do plano pela tela /operadora/coparticipacao-regras, aberta
// pelo menu da operadora própria. O analista escolhe a operadora e o plano, vê a regra geral vigente, monta uma regra
// restrita a um tipo de guia e a validação na hora aponta o percentual fora da faixa e os tetos invertidos (evento acima
// do mês); corrigido, cadastra a regra e depois encerra a geral pela vigência (a regra nunca é apagada e fica no
// histórico). As rotas /api/operadora/coparticipacao-regras exigem o banco próprio e o E2E roda com a fonte sintética:
// as respostas são simuladas pelo Playwright com massa SINTÉTICA. O efeito no banco está em
// apps/api/src/modulos/operadora/regras-coparticipacao-propria.int.spec.ts.
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

const regra = (x: Record<string, unknown>): Record<string, unknown> => ({
  id: 1,
  versao: 1,
  codigo: 'GERAL',
  descricao: 'REGRA GERAL SINTETICA',
  plano: 5,
  contrato: null,
  tipo: 'percentual',
  valor: 30,
  tetoEvento: 100,
  tetoMensal: 300,
  tetoAnual: 1200,
  procedimento: null,
  procedimentoDescricao: null,
  grupo: null,
  grupoDescricao: null,
  tipoGuia: null,
  tipoGuiaDescricao: null,
  regime: null,
  regimeDescricao: null,
  inicio: '2026-01-01',
  fim: null,
  vigente: true,
  ...x,
});

test.describe('Regras de coparticipação @C2-116 @fase7', () => {
  test.setTimeout(180_000);
  test('regra por tipo de guia com validação na hora, cadastro e encerramento da geral; axe', async ({
    page,
  }) => {
    const pedidos: { caminho: string; metodo: string; corpo: Record<string, unknown> }[] = [];
    let regras: Record<string, unknown>[] = [regra({})];

    await page.route('**/api/operadora/cobranca/tela', (r) =>
      json(r, {
        liberacao: { ligada: true, motivo: null },
        acoes: { gerar: true, motivo: null },
        operadoras: [{ id: 7, razaoSocial: 'OPERADORA SINTETICA', registroAns: '410361' }],
        hoje: '2026-11-25',
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
      const req = r.request();
      const caminho = new URL(req.url()).pathname;
      if (req.method() === 'GET' && caminho.endsWith('/opcoes'))
        return json(r, {
          planos: [{ id: 5, rotulo: 'PLANO SINTETICO ENFERMARIA' }],
          contratos: [],
          tiposGuia: [
            { id: 1, rotulo: 'Consulta' },
            { id: 2, rotulo: 'SP/SADT' },
          ],
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
        regra({
          id: 2,
          codigo: String(corpo.codigo),
          descricao: String(corpo.descricao),
          valor: corpo.valor,
          tetoEvento: corpo.tetoEvento,
          tetoMensal: corpo.tetoMensal,
          tetoAnual: corpo.tetoAnual,
          tipoGuia: 2,
          tipoGuiaDescricao: 'SP/SADT',
          inicio: String(corpo.inicio),
        }),
      ];
      return json(r, { id: 2, versao: 1 }, 201);
    });

    await entrar(page, 'SINT.OPERADORA');
    await page.goto('/operadora/coparticipacao-regras');
    const tela = page.getByTestId('tela-regras-coparticipacao');
    await expect(tela).toBeVisible();
    await expect(page.getByTestId('copart-operadora')).toContainText('OPERADORA SINTETICA');
    await escolher(page.getByTestId('copart-alvo'), { rotulo: /PLANO SINTETICO/ });
    await expect(page.getByTestId('copart-regra-GERAL')).toContainText('Geral');
    await expect(page.getByTestId('copart-regra-GERAL')).toContainText('(vigente)');

    // Nova regra só para SP/SADT: a validação aponta na hora o percentual fora da faixa e os tetos invertidos.
    await page.getByTestId('copart-codigo').locator('input').fill('SADT');
    await page.getByTestId('copart-descricao').locator('input').fill('EXAMES SINTETICOS');
    await page.getByTestId('copart-valor').locator('input').fill('120');
    await page.getByTestId('copart-teto-evento').locator('input').fill('500');
    await page.getByTestId('copart-teto-mes').locator('input').fill('200');
    await escolher(page.getByTestId('copart-tipo-guia'), { rotulo: 'SP/SADT' });
    await data(page, 'copart-inicio', '01/12/2026');
    const falta = page.getByTestId('copart-falta');
    await expect(falta).toContainText('percentual de 0 a 100');
    await expect(falta).toContainText('teto do evento até o do mês');
    await expect(page.getByTestId('copart-salvar')).toBeDisabled();

    await page.getByTestId('copart-valor').locator('input').fill('20');
    await page.getByTestId('copart-teto-evento').locator('input').fill('80');
    await expect(falta).toHaveCount(0);
    await page.getByTestId('copart-salvar').click();
    await expect(page.getByTestId('copart-aviso')).toContainText('Regra cadastrada.');
    await expect(page.getByTestId('copart-regra-SADT')).toContainText('Guia: SP/SADT');
    const inclusao = pedidos.find((p) => p.metodo === 'POST' && !p.caminho.endsWith('/encerrar'));
    expect(inclusao?.corpo).toMatchObject({
      plano: 5,
      contrato: null,
      tipo: 'percentual',
      valor: 20,
      tetoEvento: 80,
      tetoMensal: 200,
      tipoGuia: 2,
      inicio: '2026-12-01',
    });

    // Encerra a geral pela vigência: a linha continua na lista, sem o selo de vigente.
    await page.getByTestId('copart-encerrar-GERAL').click();
    await expect(page.getByTestId('copart-confirmar-encerrar')).toBeDisabled();
    await data(page, 'copart-fim-encerrar', '30/11/2026');
    await page.getByTestId('copart-confirmar-encerrar').click();
    await expect(page.getByTestId('copart-aviso')).toContainText('Regra encerrada.');
    await expect(page.getByTestId('copart-regra-GERAL')).not.toContainText('(vigente)');
    expect(pedidos.find((p) => p.caminho.endsWith('/regra/1/encerrar'))?.corpo).toMatchObject({
      versao: 1,
      fim: '2026-11-30',
    });

    await semViolacaoAxe(page, 'regras de coparticipação');
  });
});
