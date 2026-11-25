// E2E @C2-047 (F7, 08-SGO L106): reembolso ao beneficiário pela tela /operadora/reembolsos, aberta pelo link da tela de
// cobrança. A fila mostra o prazo legal e o atraso; o nome abre a visão por beneficiário (total do ano); o pedido abre com
// os itens e o limite pela tabela do município; a glosa sem motivo é apontada na hora e a prévia do pago muda; a análise
// concluída e o pagamento vão ao servidor com a versão. As rotas /api/operadora/reembolsos exigem o banco próprio e o E2E
// roda com a fonte sintética: as respostas são simuladas pelo Playwright com massa SINTÉTICA. O efeito no banco está em
// apps/api/src/modulos/operadora/reembolso-propria.int.spec.ts.
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

const resumo = (situacao: string, extra: Record<string, unknown> = {}) => ({
  id: 7,
  versao: 1,
  numero: 'RB-101',
  beneficiario: { id: 3, nome: 'BENEFICIARIO SINTETICO', matricula: '000123' },
  prestadorNome: 'CLINICA SINTETICA',
  dataAtendimento: '2026-11-10',
  solicitadoEm: '2026-10-01T10:00:00',
  prazoPagamento: '2026-10-31',
  diasParaOPrazo: -3,
  atrasado: true,
  valorApresentado: 650,
  valorGlosado: 0,
  valorReembolsado: 0,
  situacao,
  ...extra,
});

test.describe('Reembolso ao beneficiário @C2-047 @fase7', () => {
  test.setTimeout(180_000);
  test('fila com atraso, visão por beneficiário, glosa por item com motivo e pagamento; axe', async ({
    page,
  }) => {
    const pedidos: { caminho: string; corpo: Record<string, unknown> }[] = [];
    let situacao = 'em_analise';
    await page.route('**/api/operadora/reembolsos**', async (r) => {
      const u = new URL(r.request().url());
      const caminho = u.pathname.replace('/api/operadora/reembolsos', '');
      if (r.request().method() === 'POST') {
        const corpo = r.request().postDataJSON() as Record<string, unknown>;
        pedidos.push({ caminho, corpo });
        if (caminho.endsWith('/analise')) situacao = 'aprovado_parcial';
        if (caminho.endsWith('/pagamento')) situacao = 'pago';
        return json(r, { id: 7, versao: pedidos.length + 1, situacao });
      }
      if (caminho === '/apoio')
        return json(r, {
          operadoras: [{ id: 1, nome: 'OPERADORA SINTETICA' }],
          modalidades: [],
          motivos: [{ id: 9, codigo: '1801', descricao: 'MOTIVO SINTETICO' }],
        });
      if (caminho === '' || caminho === '/') return json(r, [resumo(situacao)]);
      if (caminho.startsWith('/beneficiario/'))
        return json(r, { pedidos: [resumo(situacao)], reembolsadoNoAno: 1200 });
      if (caminho === '/7')
        return json(r, {
          ...resumo(situacao, {
            versao: pedidos.length + 1,
            valorReembolsado: situacao === 'em_analise' ? 0 : 400,
          }),
          canal: 'presencial',
          prestadorDocumento: '11222333000181',
          numeroDocumentoFiscal: 'NF-1',
          tabelaReferencia: { id: 4, nome: 'REFERENCIA SINTETICA' },
          observacao: null,
          analisadoEm: null,
          pagoEm: situacao === 'pago' ? '2026-11-25' : null,
          motivoCancelamento: null,
          itens: [
            {
              id: 11,
              versao: 1,
              procedimento: { id: 5, codigo: 'L0209RB1', descricao: 'CONSULTA SINTETICA' },
              quantidade: 1,
              valorApresentado: 450,
              valorLimite: 300,
              valorGlosado: 0,
              valorCoparticipacao: 0,
              valorReembolsado: 0,
              situacao: 'pendente',
              glosas: [],
            },
          ],
          anexos: [{ id: 21, nome: 'recibo.pdf', tipoMime: 'application/pdf', bytes: 1000 }],
        });
      return json(r, []);
    });

    await entrar(page, 'SINT.OPERADORA');
    await page.goto('/operadora/cobranca');
    await page.getByTestId('link-reembolso').click();
    await expect(page).toHaveURL(/\/operadora\/reembolsos/);
    await expect(page.getByTestId('reembolso-atraso-7')).toContainText('atrasado 3 dia(s)');

    await page.getByTestId('reembolso-benef-7').click();
    await expect(page.getByTestId('reembolso-total-ano')).toContainText('1.200,00');

    await page.getByTestId('reembolso-abrir-7').click();
    await expect(page.getByTestId('reembolso-itens')).toContainText('300,00');
    await page.getByTestId('glosa-valor-0').locator('input').fill('50');
    await expect(page.getByTestId('reembolso-itens')).toContainText('Escolha o motivo da glosa.');
    await expect(page.getByTestId('reembolso-concluir')).toBeDisabled();
    await escolher(page.getByTestId('glosa-motivo-0'), { rotulo: /1801/ });
    await expect(page.getByTestId('reembolso-paga-0')).toContainText('250,00');
    await semViolacaoAxe(page, '/operadora/reembolsos');
    await page.getByTestId('reembolso-concluir').click();
    await expect(page.getByTestId('reembolso-aviso')).toContainText('Análise concluída');
    const analise = pedidos.find((p) => p.caminho.endsWith('/analise'))!;
    expect(analise.corpo).toMatchObject({
      decisao: 'concluir',
      itens: [{ item: 11, glosas: [{ motivo: 9, valor: 50 }] }],
    });

    await page.getByTestId('reembolso-pagar').click();
    await expect(page.getByTestId('reembolso-pago')).toContainText('creditado na conta do beneficiário');
    expect(pedidos.find((p) => p.caminho.endsWith('/pagamento'))!.corpo).toMatchObject({ versao: 2 });
  });
});
