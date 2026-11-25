// E2E @C2-061 (F7, 08-SGO L107): trocas TISS da operadora pela tela /operadora/troca-tiss. A lista mostra as trocas
// recebidas e enviadas com o filtro de tipo e direção (combos SanteSelecao); o arquivo que não é .xml é apontado na hora e
// o botão fica desligado; a mensagem recebida mostra o protocolo do pedido de autorização, o resultado guia a guia do
// cancelamento e a recusa do arquivo com o que o XSD apontou. As rotas /api/operadora/troca-tiss exigem o banco próprio e
// o E2E roda com a fonte sintética: as respostas são simuladas pelo Playwright com massa SINTÉTICA. O efeito no banco
// está em apps/api/src/modulos/operadora/troca-tiss-propria.int.spec.ts e a rota em troca-tiss.controller.spec.ts.
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

const troca = (id: number, extra: Record<string, unknown>) => ({
  id,
  direcao: 'recebida',
  tipo: 'solicitacao_procedimento',
  canal: 'arquivo',
  prestador: 'CLINICA SINTETICA',
  sequencial: String(id),
  protocolo: null,
  registradaEm: '2026-11-25T10:00:00',
  situacao: 'processada',
  mensagemErro: null,
  ...extra,
});

// Mensagens SINTÉTICAS (o conteúdo não importa: a resposta do servidor é simulada).
const XML = (tipo: string) =>
  Buffer.from(
    `<?xml version="1.0" encoding="ISO-8859-1"?><ans:mensagemTISS xmlns:ans="http://www.ans.gov.br/padroes/tiss/schemas"><ans:cabecalho><ans:identificacaoTransacao><ans:tipoTransacao>${tipo}</ans:tipoTransacao></ans:identificacaoTransacao></ans:cabecalho></ans:mensagemTISS>`,
    'latin1',
  );

test.describe('Trocas TISS da operadora @C2-061 @fase7', () => {
  test.setTimeout(180_000);
  test('lista com filtro, arquivo conferido na hora, pedido com protocolo, cancelamento guia a guia e recusa do XSD; axe', async ({
    page,
  }) => {
    const filtros: string[] = [];
    const enviados: Record<string, unknown>[] = [];
    let resposta: { status: number; corpo: unknown } = { status: 200, corpo: {} };
    await page.route('**/api/operadora/troca-tiss**', async (r) => {
      const u = new URL(r.request().url());
      if (r.request().method() === 'POST' && u.pathname.endsWith('/mensagens')) {
        enviados.push(r.request().postDataJSON() as Record<string, unknown>);
        return json(r, resposta.corpo, resposta.status);
      }
      filtros.push(u.search);
      const itens = [
        troca(1, { protocolo: '99999920261125000001' }),
        troca(2, { tipo: 'cancelamento_guia', situacao: 'rejeitada', mensagemErro: 'MOTIVO SINTETICO' }),
        troca(3, { direcao: 'enviada', tipo: 'demonstrativo_pagamento', situacao: 'enviada' }),
      ].filter(
        (x) =>
          (!u.searchParams.get('tipo') || x.tipo === u.searchParams.get('tipo')) &&
          (!u.searchParams.get('direcao') || x.direcao === u.searchParams.get('direcao')),
      );
      return json(r, { itens });
    });

    await entrar(page, 'SINT.OPE.AUDITOR');
    await page.goto('/operadora/troca-tiss');
    await expect(page.getByTestId('troca-lista')).toContainText('Pedido de autorização');
    await expect(page.getByTestId('troca-2')).toContainText('MOTIVO SINTETICO');
    await expect(page.getByTestId('troca-3')).toContainText('Enviada ao prestador');

    // Filtro pelos combos: só as enviadas.
    await escolher(page.getByTestId('troca-filtro-direcao'), { rotulo: 'Enviada ao prestador' });
    await expect(page.getByTestId('troca-1')).toHaveCount(0);
    await expect(page.getByTestId('troca-3')).toContainText('Demonstrativo de pagamento');
    expect(filtros.some((f) => f.includes('direcao=enviada'))).toBe(true);
    await escolher(page.getByTestId('troca-filtro-direcao'), { rotulo: 'Todas' });
    await expect(page.getByTestId('troca-1')).toBeVisible();

    // Arquivo que não é XML: apontado na hora, nada enviado.
    await page.getByTestId('troca-arquivo').setInputFiles({
      name: 'mensagem.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('texto'),
    });
    await expect(page.getByTestId('troca-receber')).toContainText('Escolha um arquivo .xml.');
    await expect(page.getByTestId('troca-enviar')).toBeDisabled();

    // Pedido de autorização: processado com o protocolo.
    resposta = {
      status: 200,
      corpo: {
        troca: 4,
        tipo: 'solicitacao_procedimento',
        situacao: 'processada',
        protocolo: '99999920261125000005',
        motivos: [],
      },
    };
    await page.getByTestId('troca-arquivo').setInputFiles({
      name: 'pedido.xml',
      mimeType: 'application/xml',
      buffer: XML('SOLICITACAO_PROCEDIMENTOS'),
    });
    await page.getByTestId('troca-enviar').click();
    await expect(page.getByTestId('troca-protocolo')).toContainText('99999920261125000005');
    expect(enviados[0]).toMatchObject({ canal: 'arquivo' });
    expect(Buffer.from(String(enviados[0]!['arquivo']), 'base64').toString('latin1')).toContain(
      'SOLICITACAO_PROCEDIMENTOS',
    );

    // Cancelamento de guia: o resultado guia a guia.
    resposta = {
      status: 200,
      corpo: {
        troca: 5,
        tipo: 'cancelamento_guia',
        situacao: 'processada',
        protocolo: '99999920261125000006',
        motivos: [],
        guias: [
          { numeroGuiaPrestador: 'G-SINT-1', resultado: 'cancelada', observacao: null },
          {
            numeroGuiaPrestador: 'G-SINT-2',
            resultado: 'nao_localizada',
            observacao: 'Guia não localizada.',
          },
        ],
      },
    };
    await page.getByTestId('troca-arquivo').setInputFiles({
      name: 'cancelamento.xml',
      mimeType: 'application/xml',
      buffer: XML('CANCELA_GUIA'),
    });
    await page.getByTestId('troca-enviar').click();
    await expect(page.getByTestId('troca-guias')).toContainText('Não localizada');
    await expect(page.getByTestId('troca-guias')).toContainText('G-SINT-1');
    await semViolacaoAxe(page, '/operadora/troca-tiss');

    // Recusa do arquivo: o que o XSD apontou, sem registro.
    resposta = {
      status: 409,
      corpo: {
        type: 'recusa-de-negocio',
        title: 'Mensagem recusada',
        status: 409,
        detail: 'A mensagem não passou no XSD da TISS.',
        codigo: 'xsd-invalido',
        avisos: ['Elemento sintético fora da ordem.'],
      },
    };
    await page.getByTestId('troca-arquivo').setInputFiles({
      name: 'invalida.xml',
      mimeType: 'application/xml',
      buffer: XML('COMUNICACAO_BENEFICIARIO'),
    });
    await page.getByTestId('troca-enviar').click();
    await expect(page.getByTestId('troca-recusa')).toContainText('não passou no XSD');
    await expect(page.getByTestId('troca-erros-xsd')).toContainText('Elemento sintético fora da ordem.');
  });
});
