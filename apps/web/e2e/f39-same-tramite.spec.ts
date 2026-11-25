// E2E @F39-5 (04-HOT L127 e L128, ficha F3.9): protocolo em lote entre setores e empréstimo de prontuário, pelo caminho
// da tela. O arquivista sai da movimentação pelo link do trâmite; na fila do setor marca um item como recebido e recusa
// o outro (a recusa sem motivo é barrada na hora pela regra do domínio); na aba de envio o lote com o mesmo setor dos
// dois lados e sem itens é barrado na hora e, montado, sai com o corpo certo; na aba de empréstimos o prazo do motivo
// aparece antes de emprestar, o atrasado mostra os dias e é cobrado, e o volume é devolvido. As rotas
// /api/same/tramite exigem o banco próprio e o E2E roda com a fonte sintética (sem núcleo): as respostas da API são
// simuladas pelo Playwright com massa SINTÉTICA. O efeito no banco está no contrato de efeito
// apps/api/src/modulos/adt/same-tramite-propria.int.spec.ts.
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

const apoio = {
  setoresTramite: [
    { id: 1, descricao: 'Arquivo central sintético', tipo: 'arquivo' },
    { id: 2, descricao: 'Faturamento sintético', tipo: 'faturamento' },
  ],
  motivos: [
    { id: 5, descricao: 'Auditoria sintética', prazoDias: 3 },
    { id: 6, descricao: 'Pesquisa sintética', prazoDias: null },
  ],
  setores: [{ id: 11, nome: 'UTI adulto sintética' }],
  arquivos: [{ id: 21, caminho: 'Sala 1' }],
  prazoPadraoDias: 7,
};

function protocolo(conferido: boolean) {
  return {
    id: 40,
    numero: 1001,
    conteudo: 'misto',
    remetente: { id: 2, descricao: 'Faturamento sintético' },
    destinatario: { id: 1, descricao: 'Arquivo central sintético' },
    prioridade: 'urgente',
    situacao: conferido ? 'recebido' : 'enviado',
    emitidoEm: '2026-11-24T10:00:00.000Z',
    versao: conferido ? 2 : 1,
    itens: [
      {
        id: 401,
        sequencia: 1,
        tipo: 'volume_prontuario',
        alvo: 9101,
        descricao: null,
        recebido: conferido,
        recusado: false,
        motivoRecusa: null,
      },
      {
        id: 402,
        sequencia: 2,
        tipo: 'documento',
        alvo: null,
        descricao: 'Guia sintética',
        recebido: false,
        recusado: conferido,
        motivoRecusa: conferido ? 'Faltou a assinatura' : null,
      },
    ],
  };
}

function emprestimo(cobrancas: number, devolvido: boolean) {
  return {
    id: 70,
    movimento: 900,
    origem: 'tramite',
    numero: 'E70',
    volume: { id: 9102, matricula: 'V000009102', paciente: 7401 },
    destino: 'UTI adulto sintética',
    motivo: 'Auditoria sintética',
    emprestadoEm: '2026-11-10T10:00:00.000Z',
    prazo: '2026-11-13T10:00:00.000Z',
    devolvidoEm: devolvido ? '2026-11-24T10:00:00.000Z' : null,
    situacao: devolvido ? 'devolvido' : 'emprestado',
    diasAtraso: 11,
    cobrancas,
    versao: 1 + cobrancas,
  };
}

test.describe('Protocolo e empréstimo do arquivo @F39-5 @fase3', () => {
  test.setTimeout(180_000);
  test('recebe item a item com recusa por motivo, envia o lote validado na hora, empresta com o prazo do motivo, cobra e devolve; axe', async ({
    page,
  }) => {
    const pedidos: { caminho: string; corpo: Record<string, unknown> }[] = [];
    let conferido = false;
    let cobrancas = 0;
    let devolvido = false;
    await page.route('**/api/same/tramite/**', (rota) => {
      const req = rota.request();
      const url = new URL(req.url());
      const caminho = url.pathname.replace('/api/same/tramite/', '');
      if (req.method() === 'GET') {
        if (caminho === 'apoio') return json(rota, apoio);
        if (caminho === 'protocolos')
          return json(rota, {
            itens: url.searchParams.get('sentido') === 'saida' ? [] : conferido ? [] : [protocolo(false)],
          });
        if (caminho === 'emprestimos')
          return json(rota, { itens: devolvido ? [] : [emprestimo(cobrancas, false)] });
        return rota.fallback();
      }
      pedidos.push({ caminho, corpo: (req.postDataJSON() ?? {}) as Record<string, unknown> });
      if (caminho === 'protocolos/40/receber') {
        conferido = true;
        return json(rota, { id: 40, situacao: 'recebido' });
      }
      if (caminho === 'protocolos') return json(rota, { id: 41, numero: 1002, situacao: 'enviado' }, 201);
      if (caminho === 'emprestimos') return json(rota, { id: 71 }, 201);
      if (caminho === 'emprestimos/70/cobrar') {
        cobrancas += 1;
        return json(rota, { id: 70 });
      }
      if (caminho === 'emprestimos/70/devolver') {
        devolvido = true;
        return json(rota, { id: 70 });
      }
      return json(rota, { codigo: 'nao-simulado' }, 500);
    });

    await entrar(page, 'SINT.ARQUIVO');
    await page.goto('/same/guarda');
    await page.getByTestId('same-ir-tramite').click();
    await expect(page).toHaveURL(/\/same\/tramite$/);
    const tela = page.getByTestId('same-tramite');
    await expect(tela).toBeVisible();

    // Receber: item 1 chegou; item 2 recusado, primeiro sem motivo (barrado na hora), depois com o motivo.
    const p = page.getByTestId('tramite-protocolo-1001');
    await expect(p).toBeVisible();
    await semViolacaoAxe(page, '/same/tramite (fila de recebimento)');
    await p.getByTestId('tramite-item-1').getByTestId('chegou').check();
    await p.getByTestId('tramite-item-2').getByTestId('recusar').check();
    await expect(p.getByTestId('tramite-falta-conferencia')).toContainText(
      'A recusa do item exige o motivo.',
    );
    await expect(p.getByTestId('tramite-gravar-conferencia')).toBeDisabled();
    await p.getByTestId('motivo-recusa').locator('input').fill('Faltou a assinatura');
    await expect(p.getByTestId('tramite-falta-conferencia')).toHaveCount(0);
    expect(pedidos).toHaveLength(0);
    await p.getByTestId('tramite-gravar-conferencia').click();
    await expect(page.getByTestId('tramite-aviso')).toContainText('1001');
    expect(pedidos[0]).toEqual({
      caminho: 'protocolos/40/receber',
      corpo: {
        itens: [
          { item: 401, aceito: true, motivo: null },
          { item: 402, aceito: false, motivo: 'Faltou a assinatura' },
        ],
        versao: 1,
      },
    });
    await expect(page.getByTestId('tramite-fila-vazia')).toBeVisible();

    // Enviar: mesmo setor dos dois lados e sem itens é barrado na hora; montado, sai com o corpo certo.
    await page.getByTestId('tramite-aba-enviar').click();
    await escolher(page.getByTestId('tramite-remetente'), { rotulo: 'Arquivo central sintético' });
    await escolher(page.getByTestId('tramite-destinatario'), { rotulo: 'Arquivo central sintético' });
    const falta = page.getByTestId('tramite-falta-lote');
    await expect(falta).toContainText('O setor de destino tem de ser outro que não o remetente.');
    await expect(falta).toContainText('O protocolo precisa de ao menos um item.');
    await expect(page.getByTestId('tramite-emitir')).toBeDisabled();
    await escolher(page.getByTestId('tramite-destinatario'), { rotulo: 'Faturamento sintético' });
    await page.getByTestId('tramite-novo-item-1').getByTestId('alvo').locator('input').fill('9101');
    await page.getByTestId('tramite-mais-item').click();
    await escolher(page.getByTestId('tramite-novo-item-2').getByTestId('tipo'), {
      rotulo: 'Documento avulso',
    });
    await page
      .getByTestId('tramite-novo-item-2')
      .getByTestId('descricao')
      .locator('input')
      .fill('Guia sintética');
    await page.getByTestId('tramite-urgente').check();
    await expect(falta).toHaveCount(0);
    await semViolacaoAxe(page, '/same/tramite (montagem do lote)');
    await page.getByTestId('tramite-emitir').click();
    await expect(page.getByTestId('tramite-aviso')).toContainText('1002');
    expect(pedidos[1]).toEqual({
      caminho: 'protocolos',
      corpo: {
        remetente: 1,
        destinatario: 2,
        prioridade: 'urgente',
        itens: [
          { tipo: 'volume_prontuario', alvo: 9101, descricao: null },
          { tipo: 'documento', alvo: null, descricao: 'Guia sintética' },
        ],
      },
    });

    // Empréstimos: o prazo do motivo aparece antes de emprestar; o atrasado é cobrado e devolvido.
    await page.getByTestId('tramite-aba-emprestimos').click();
    await expect(page.getByTestId('emp-emprestar')).toBeDisabled();
    await page.getByTestId('emp-volume').locator('input').fill('9103');
    await escolher(page.getByTestId('emp-setor'), { rotulo: 'UTI adulto sintética' });
    await escolher(page.getByTestId('emp-motivo'), { rotulo: 'Auditoria sintética' });
    const ate = new Date(Date.now() + 3 * 86_400_000).toLocaleDateString('pt-BR');
    await expect(page.getByTestId('emp-devolver-ate')).toContainText(ate);
    await page.getByTestId('emp-emprestar').click();
    await expect(page.getByTestId('tramite-aviso')).toHaveText('Volume emprestado.');
    expect(pedidos[2]).toEqual({
      caminho: 'emprestimos',
      corpo: { volume: 9103, destinoSetor: 11, motivo: 5, prazoDias: null },
    });
    const linha = page.getByTestId('emp-9102');
    await expect(linha.getByTestId('emp-atraso')).toHaveText('11 dia(s) de atraso');
    await semViolacaoAxe(page, '/same/tramite (empréstimos)');
    await linha.getByTestId('emp-cobrar').click();
    await expect(page.getByTestId('tramite-aviso')).toHaveText('Cobrança registrada.');
    expect(pedidos[3]).toEqual({ caminho: 'emprestimos/70/cobrar', corpo: { versao: 1 } });
    await linha.getByTestId('emp-devolver').click();
    await expect(page.getByTestId('tramite-aviso')).toHaveText('Volume devolvido ao arquivo.');
    expect(pedidos[4]).toEqual({ caminho: 'emprestimos/70/devolver', corpo: { versao: 2 } });
    await expect(page.getByTestId('emp-9102')).toHaveCount(0);
  });
});
