// E2E @C1-009 @F39-5 (04-HOT L128, ficha F3.9): a fila de solicitações do arquivo e a autorização pelo motivo, pelo
// caminho da tela /same/tramite. O arquivista pede o prontuário com o motivo que exige autorização (o aviso aparece na
// hora; a linha sem paciente válido é barrada); no empréstimo direto, o mesmo motivo é barrado na hora; na fila, a
// solicitação aguardando não deixa entregar, a negativa sem justificativa fica bloqueada e a autorização sai com a
// justificativa; autorizada, o volume é entregue por empréstimo ao setor; o item não achado sai da fila com onde se
// procurou; a outra solicitação é cancelada com motivo. As rotas /api/same/tramite exigem o banco próprio e o E2E roda
// com a fonte sintética (sem núcleo): as respostas da API são simuladas pelo Playwright com massa SINTÉTICA. O efeito
// no banco está no contrato de efeito apps/api/src/modulos/adt/same-tramite-propria.int.spec.ts.
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
    { id: 2, descricao: 'Pesquisa clínica sintética', tipo: 'administrativo' },
  ],
  motivos: [
    { id: 5, descricao: 'Auditoria sintética', prazoDias: 3, exigeAutorizacao: false },
    { id: 6, descricao: 'Pesquisa sintética', prazoDias: 15, exigeAutorizacao: true },
  ],
  setores: [{ id: 11, nome: 'Pesquisa clínica (setor) sintético' }],
  arquivos: [{ id: 21, caminho: 'Arquivo sintético sala 1' }],
  prazoPadraoDias: 7,
};

interface Estado {
  autorizacao: 'aguardando' | 'autorizada';
  versao: number;
  item1: string;
  item2: string;
  cancelada: boolean;
}

const solicitacoes = (e: Estado) => [
  {
    id: 50,
    numero: 3001,
    situacao: e.item1 === 'pendente' && e.item2 === 'pendente' ? 'pendente' : 'em_atendimento',
    autorizacao: e.autorizacao,
    solicitante: 900,
    motivo: 'Pesquisa sintética',
    urgente: false,
    destino: 'Pesquisa clínica sintética',
    solicitadaEm: '2026-11-25T10:00:00.000Z',
    desejadaPara: null,
    itens: 2,
    versao: e.versao,
  },
  ...(e.cancelada
    ? []
    : [
        {
          id: 51,
          numero: 3002,
          situacao: 'pendente',
          autorizacao: null,
          solicitante: 900,
          motivo: 'Auditoria sintética',
          urgente: false,
          destino: 'Pesquisa clínica sintética',
          solicitadaEm: '2026-11-25T11:00:00.000Z',
          desejadaPara: null,
          itens: 1,
          versao: 1,
        },
      ]),
];

const itens = (e: Estado) => [
  {
    id: 501,
    sequencia: 1,
    paciente: 7401,
    volume: 9201,
    matricula: 'V000009201',
    situacao: e.item1,
    observacao: null,
    atendidoEm: null,
  },
  {
    id: 502,
    sequencia: 2,
    paciente: 7401,
    volume: 9202,
    matricula: 'V000009202',
    situacao: e.item2,
    observacao: e.item2 === 'nao_localizado' ? 'Estante 4 e setor de pesquisa' : null,
    atendidoEm: null,
  },
];

test.describe('Solicitação de prontuário e autorização pelo motivo @C1-009 @F39-5 @fase3', () => {
  test.setTimeout(180_000);
  test('pede com o motivo que exige autorização, autoriza com justificativa, entrega, não localizado e cancela; axe', async ({
    page,
  }) => {
    const pedidos: { caminho: string; corpo: Record<string, unknown> }[] = [];
    const e: Estado = {
      autorizacao: 'aguardando',
      versao: 1,
      item1: 'pendente',
      item2: 'pendente',
      cancelada: false,
    };
    await page.route('**/api/same/tramite/**', (rota) => {
      const req = rota.request();
      const url = new URL(req.url());
      const caminho = url.pathname.replace('/api/same/tramite/', '');
      if (req.method() === 'GET') {
        if (caminho === 'apoio') return json(rota, apoio);
        if (caminho === 'protocolos') return json(rota, { itens: [] });
        if (caminho === 'emprestimos') return json(rota, { itens: [] });
        if (caminho === 'solicitacoes') return json(rota, { itens: solicitacoes(e) });
        if (caminho === 'solicitacoes/50/itens') return json(rota, { itens: itens(e) });
        return rota.fallback();
      }
      pedidos.push({ caminho, corpo: (req.postDataJSON() ?? {}) as Record<string, unknown> });
      if (caminho === 'solicitacoes') return json(rota, { id: 52, numero: 3003 }, 201);
      if (caminho === 'solicitacoes/50/autorizar') {
        e.autorizacao = 'autorizada';
        e.versao += 1;
        return json(rota, { id: 50, autorizacao: 'autorizada', situacao: 'pendente' });
      }
      if (caminho === 'emprestimos') {
        e.item1 = 'emprestado';
        e.versao += 1;
        return json(rota, { id: 72, prazo: '2026-12-10T10:00:00.000Z', solicitacao: 'em_atendimento' }, 201);
      }
      if (caminho === 'solicitacoes/50/nao-localizado') {
        e.item2 = 'nao_localizado';
        e.versao += 1;
        return json(rota, { id: 50, situacao: 'atendida_parcial' });
      }
      if (caminho === 'solicitacoes/51/cancelar') {
        e.cancelada = true;
        return json(rota, { id: 51, situacao: 'cancelada' });
      }
      return json(rota, { codigo: 'nao-simulado' }, 500);
    });

    await entrar(page, 'SINT.ARQUIVO');
    await page.goto('/same/tramite');
    await expect(page.getByTestId('same-tramite')).toBeVisible();

    // Empréstimo direto com o motivo que exige autorização: barrado na hora.
    await page.getByTestId('tramite-aba-emprestimos').click();
    await page.getByTestId('emp-volume').locator('input').fill('9203');
    await escolher(page.getByTestId('emp-setor'), { rotulo: 'Pesquisa clínica (setor) sintético' });
    await escolher(page.getByTestId('emp-motivo'), { rotulo: 'Pesquisa sintética' });
    await expect(page.getByTestId('emp-exige-autorizacao')).toContainText('O motivo exige autorização');
    await expect(page.getByTestId('emp-emprestar')).toBeDisabled();

    // Pedido: o aviso da autorização aparece ao escolher o motivo; a linha com paciente não numérico é barrada.
    await page.getByTestId('tramite-aba-solicitacoes').click();
    await escolher(page.getByTestId('sol-arquivo'), { rotulo: 'Arquivo sintético sala 1' });
    await escolher(page.getByTestId('sol-destino'), { rotulo: 'Pesquisa clínica sintética' });
    await escolher(page.getByTestId('sol-motivo'), { rotulo: 'Pesquisa sintética' });
    await expect(page.getByTestId('sol-exige-autorizacao')).toBeVisible();
    const linha1 = page.getByTestId('sol-linha-1');
    await linha1.getByTestId('paciente').locator('input').fill('abc');
    await expect(page.getByTestId('sol-falta')).toContainText('O paciente é o número do cadastro.');
    await expect(page.getByTestId('sol-solicitar')).toBeDisabled();
    await linha1.getByTestId('paciente').locator('input').fill('7402');
    await linha1.getByTestId('volume').locator('input').fill('9301');
    await expect(page.getByTestId('sol-falta')).toHaveCount(0);
    await semViolacaoAxe(page, '/same/tramite (pedido de prontuário)');
    expect(pedidos).toHaveLength(0);
    await page.getByTestId('sol-solicitar').click();
    await expect(page.getByTestId('tramite-aviso')).toContainText('3003');
    expect(pedidos[0]).toEqual({
      caminho: 'solicitacoes',
      corpo: { localArquivo: 21, destino: 2, motivo: 6, itens: [{ paciente: 7402, volume: 9301 }] },
    });

    // Fila: aguardando não deixa entregar; negar exige justificativa; autoriza com a justificativa.
    const s = page.getByTestId('sol-3001');
    await expect(s.getByTestId('sol-autorizacao')).toContainText('aguardando autorização');
    await s.getByTestId('sol-ver-itens').click();
    await expect(s.getByTestId('sol-falta-entrega')).toContainText('aguarda a autorização');
    await expect(s.getByTestId('sol-item-1').getByTestId('sol-entregar')).toBeDisabled();
    await expect(s.getByTestId('sol-negar')).toBeDisabled();
    await s.getByTestId('sol-justificativa').locator('input').fill('Projeto aprovado pelo comitê sintético');
    await expect(s.getByTestId('sol-negar')).toBeEnabled();
    await semViolacaoAxe(page, '/same/tramite (fila com autorização)');
    await s.getByTestId('sol-autorizar').click();
    await expect(page.getByTestId('tramite-aviso')).toHaveText('Solicitação nº 3001 autorizada.');
    expect(pedidos[1]).toEqual({
      caminho: 'solicitacoes/50/autorizar',
      corpo: { decisao: 'autorizar', justificativa: 'Projeto aprovado pelo comitê sintético', versao: 1 },
    });
    await expect(s.getByTestId('sol-autorizacao')).toContainText('autorizada');
    await expect(s.getByTestId('sol-decisao')).toHaveCount(0);

    // Autorizada: entrega o volume 1 por empréstimo ao setor.
    await escolher(s.getByTestId('sol-setor-entrega'), { rotulo: 'Pesquisa clínica (setor) sintético' });
    await s.getByTestId('sol-item-1').getByTestId('sol-entregar').click();
    await expect(page.getByTestId('tramite-aviso')).toHaveText('Volume emprestado.');
    expect(pedidos[2]).toEqual({
      caminho: 'emprestimos',
      corpo: { volume: 9201, destinoSetor: 11, solicitacao: 50 },
    });

    // O volume 2 não foi achado: sem dizer onde se procurou fica bloqueado; com a observação, sai da fila.
    const item2 = s.getByTestId('sol-item-2');
    await expect(item2.getByTestId('sol-nao-localizado')).toBeDisabled();
    await item2.getByTestId('sol-onde-procurou').locator('input').fill('Estante 4 e setor de pesquisa');
    await item2.getByTestId('sol-nao-localizado').click();
    await expect(page.getByTestId('tramite-aviso')).toHaveText('Item marcado como não localizado.');
    expect(pedidos[3]).toEqual({
      caminho: 'solicitacoes/50/nao-localizado',
      corpo: { item: 502, motivo: 'Estante 4 e setor de pesquisa', versao: 3 },
    });
    await expect(item2).toContainText('não localizado');

    // A outra solicitação é cancelada com motivo (sem motivo, bloqueado).
    const outra = page.getByTestId('sol-3002');
    await expect(outra.getByTestId('sol-autorizacao')).toHaveCount(0);
    await expect(outra.getByTestId('sol-cancelar')).toBeDisabled();
    await outra.getByTestId('sol-motivo-cancelar').locator('input').fill('Paciente teve alta');
    await outra.getByTestId('sol-cancelar').click();
    await expect(page.getByTestId('tramite-aviso')).toHaveText('Solicitação nº 3002 cancelada.');
    expect(pedidos[4]).toEqual({
      caminho: 'solicitacoes/51/cancelar',
      corpo: { motivo: 'Paciente teve alta', versao: 1 },
    });
    await expect(page.getByTestId('sol-3002')).toHaveCount(0);
  });
});
