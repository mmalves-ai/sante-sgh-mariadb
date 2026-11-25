// 06-FAT linha 28: cancelamento de guia enviada e envio de documentos anexos pelo TISS 04.03.00, pela ação da linha em
// `/faturamento/guias`. O recurso exige o banco próprio, e o E2E roda com a fonte sintética (sem núcleo): as respostas de
// /api/tiss/cancelamento-documentos são simuladas pelo Playwright com massa SINTÉTICA. O que se prova é a tela: o pedido
// de cancelamento fica travado até o motivo ter 10 caracteres (validação na hora); pedir vai com a guia e o motivo; o
// rascunho envia e baixa o XML; o recibo vai com o status do padrão escolhido no combo; o arquivo fora do formato é
// recusado na hora, e o documento só entra na lista com o tipo; o registro vai com o tipo do corpo com anexos. O efeito no
// banco está no contrato de efeito (apps/api/src/modulos/tiss/cancelamento-documentos-propria.int.spec.ts). Tag @C2-091.
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const CONTA = 9101;
const C = '**/api/tiss/cancelamento-documentos';

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

const cancelamento = (x: Record<string, unknown>) => ({
  id: 31,
  situacao: 'rascunho',
  motivo: 'Guia emitida em duplicidade',
  solicitadoEm: '2026-11-25T10:00:00.000Z',
  enviadoEm: null,
  retornoEm: null,
  protocolo: null,
  observacao: null,
  versao: 1,
  item: 41,
  situacaoGuia: 'pendente',
  status: null,
  statusDescricao: null,
  guias: 1,
  ...x,
});

const visao = (cancelamentos: unknown[], envios: unknown[] = []) => ({
  conta: CONTA,
  guias: [
    {
      guia: {
        id: 7,
        numeroGuiaPrestador: 'SINT-GUIA-1',
        numeroGuiaOperadora: null,
        situacao: 'enviada',
        tipo: 'sp_sadt',
      },
      cancelamentos,
      envios,
    },
  ],
});

test.describe('cancelamento de guia e documentos anexos TISS @C2-091', () => {
  test('motivo validado na hora, pedido, envio com XML, recibo pelo combo; documento com formato e tipo; axe', async ({
    page,
  }) => {
    let etapa: 'vazio' | 'rascunho' | 'enviado' | 'processado' = 'vazio';
    const corpos: Record<string, unknown> = {};
    let tipoCorpoDocumentos = '';
    await page.route(`${C}/contas/${CONTA}`, (r) =>
      json(
        r,
        visao(
          etapa === 'vazio'
            ? []
            : [
                cancelamento(
                  etapa === 'rascunho'
                    ? {}
                    : etapa === 'enviado'
                      ? { situacao: 'enviado', versao: 2, enviadoEm: '2026-11-25T10:05:00.000Z' }
                      : {
                          situacao: 'processado',
                          versao: 3,
                          situacaoGuia: 'cancelada',
                          status: '1',
                          statusDescricao: 'Cancelado com sucesso',
                        },
                ),
              ],
        ),
      ),
    );
    await page.route(`${C}/cancelamentos`, (r) => {
      corpos['pedido'] = r.request().postDataJSON();
      etapa = 'rascunho';
      return json(r, { id: 31, guias: 1 }, 201);
    });
    await page.route(`${C}/cancelamentos/31/envio`, (r) => {
      corpos['envio'] = r.request().postDataJSON();
      etapa = 'enviado';
      return json(r, { id: 31, situacao: 'enviado', xml: '<ans:mensagemTISS/>' });
    });
    await page.route(`${C}/cancelamentos/31/recibo`, (r) => {
      corpos['recibo'] = r.request().postDataJSON();
      etapa = 'processado';
      return json(r, { id: 31, situacao: 'processado', canceladas: 1 });
    });
    await page.route(`${C}/envios`, (r) => {
      tipoCorpoDocumentos = r.request().headers()['content-type'] ?? '';
      corpos['documentos'] = r.request().postDataJSON();
      return json(r, { id: 51, numero: 'ED-SINT-1', documentos: 1 }, 201);
    });

    await entrar(page, 'SINT.TISS');
    await page.goto('/faturamento/guias');
    await page.getByTestId(`gu-cancelamento-${CONTA}`).click();
    await expect(page.getByTestId('cd-painel')).toBeVisible();

    // Motivo curto: aviso na hora e botão travado.
    await page.getByTestId('cd-motivo-7').fill('curto');
    await expect(page.getByTestId('cd-motivo-aviso-7')).toBeVisible();
    await expect(page.getByTestId('cd-pedir-7')).toBeDisabled();
    await page.getByTestId('cd-motivo-7').fill('Guia emitida em duplicidade');
    await expect(page.getByTestId('cd-motivo-aviso-7')).toHaveCount(0);
    await page.getByTestId('cd-pedir-7').click();
    await expect(page.getByTestId('cd-cancelamento-31')).toBeVisible();
    expect(corpos['pedido']).toEqual({ guias: [7], motivo: 'Guia emitida em duplicidade' });

    // Enviar baixa o XML montado.
    const baixa = page.waitForEvent('download');
    await page.getByTestId('cd-enviar-31').click();
    expect((await baixa).suggestedFilename()).toBe('cancelamento-guia-31.xml');
    expect(corpos['envio']).toEqual({ versao: 1 });

    // Recibo: status do padrão pelo combo; sem status o botão fica travado.
    await expect(page.getByTestId('cd-recibo-31')).toBeDisabled();
    await page.getByTestId('cd-protocolo-31').fill('PROT-SINT-9');
    await escolher(page.getByTestId('cd-status-31'), { rotulo: /Cancelado com sucesso/ });
    await page.getByTestId('cd-recibo-31').click();
    await expect(page.getByTestId('cd-mensagem')).toContainText('1 guia(s) cancelada(s)');
    expect(corpos['recibo']).toEqual({
      versao: 2,
      protocolo: 'PROT-SINT-9',
      observacao: null,
      erro: null,
      guias: [{ item: 41, status: '1' }],
    });
    await expect(page.getByTestId('cd-cancelamento-31')).toContainText('Cancelado com sucesso');

    // Documento: formato fora do padrão é recusado na hora; com PDF e tipo entra na lista e é registrado.
    await page
      .getByTestId('cd-arquivo-7')
      .setInputFiles({ name: 'sintetico.txt', mimeType: 'text/plain', buffer: Buffer.from('sintetico') });
    await expect(page.getByTestId('cd-arquivo-aviso-7')).toBeVisible();
    await expect(page.getByTestId('cd-acrescentar-7')).toBeDisabled();
    await page.getByTestId('cd-arquivo-7').setInputFiles({
      name: 'laudo-sintetico.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4 sintetico'),
    });
    await expect(page.getByTestId('cd-arquivo-aviso-7')).toHaveCount(0);
    await expect(page.getByTestId('cd-acrescentar-7')).toBeDisabled();
    await escolher(page.getByTestId('cd-tipo-7'), { rotulo: /Laudo do profissional/ });
    await page.getByTestId('cd-acrescentar-7').click();
    await expect(page.getByTestId('cd-lista-7-0')).toContainText('laudo-sintetico.pdf');
    await page.getByTestId('cd-registrar-7').click();
    await expect(page.getByTestId('cd-mensagem')).toContainText('ED-SINT-1');
    expect(tipoCorpoDocumentos).not.toBe('application/json');
    const doc = corpos['documentos'] as { guia: number; documentos: Record<string, unknown>[] };
    expect(doc.guia).toBe(7);
    expect(doc.documentos).toHaveLength(1);
    expect(doc.documentos[0]).toMatchObject({
      nome: 'laudo-sintetico.pdf',
      tipoMime: 'application/pdf',
      tipoDocumento: '02',
    });

    await semViolacaoAxe(page, '/faturamento/guias (cancelamento e documentos TISS)');
  });
});
