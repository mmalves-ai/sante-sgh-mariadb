// C1-026 (07-FIN linha 66): dados bancários e chave Pix do profissional, remessa por Pix do título dele e retorno do
// banco, com a segregação de funções: o cadastro de credores (SINT.FIN.CREDOR) mantém a conta e a chave e não vê as
// abas da remessa; quem gera a remessa (SINT.FIN.PAGA) vê o botão de gravar a conta preso e paga pelo Pix. As rotas de
// `/api/financeiro/pagamento-eletronico` só existem no banco do cliente (na fonte sintética respondem 503), então este
// E2E simula essas rotas com um estado em memória que segue a regra do servidor (a conta incluída pelo par
// tipoCredor/credor; o título do profissional entra no Pix só depois que a chave existe). O que fica no banco (a conta
// do profissional e do prestador, a chave escolhida, a remessa e a baixa pelo retorno) é provado nos contratos de
// efeito `aplicacao/pagamento-eletronico-credores.int.spec.ts` e `aplicacao/pagamento-eletronico.int.spec.ts`.
// Este E2E é só de tela (rotas simuladas): não exercita a API, a permissão do servidor nem a gravação. O ciclo pelo
// integrador com o banco do cliente fica pendente, porque a esteira do E2E (tools/obra/e2e-vm.sh, igual ao ci.yml) sobe
// sem núcleo (SGH_NUCLEO_SEM_BANCO=1). O cadastro de credores chega à tela pelo menu, não por endereço digitado.
// Massa SINTÉTICA. Axe nos passos.
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const P = '/api/financeiro/pagamento-eletronico';
const PROFISSIONAL = { id: 9101, nome: 'Profissional Sintético Um', documento: null };

async function entrar(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

const linha = (campos: readonly (readonly [number, string])[]) => {
  const l = Array.from({ length: 240 }, () => ' ');
  for (const [de, v] of campos) for (let i = 0; i < v.length; i++) l[de - 1 + i] = v[i] as string;
  return l.join('');
};
/** Retorno CNAB 240 sintético bem formado: cabeçalho de retorno, um segmento A e o rodapé. */
const RETORNO = [
  linha([
    [1, '001'],
    [8, '0'],
    [143, '2'],
    [158, '000001'],
  ]),
  linha([
    [1, '001'],
    [8, '3'],
    [14, 'A'],
    [74, '00000000000000000001'],
    [120, '000000000010000'],
    [231, '00'],
  ]),
  linha([
    [1, '001'],
    [8, '9'],
    [24, '000003'],
  ]),
].join('\r\n');

interface Estado {
  contas: Record<string, unknown>[];
  gravacoesConta: Record<string, unknown>[];
  remessasPix: Record<string, unknown>[];
  retornos: Record<string, unknown>[];
}

const json = (rota: Route, corpo: unknown, status = 200) =>
  rota.fulfill({ status, contentType: 'application/json', body: JSON.stringify(corpo) });
const ok = (mensagem: string) => ({ ok: true, mensagem, id: 1 });

/** Simula as rotas do pagamento eletrônico; a gravação e a leitura do financeiro só ganham a conta e a ação ligada. */
async function simular(page: Page, e: Estado): Promise<void> {
  await page.route('**/api/financeiro/gravacao', async (rota) => {
    const r = await rota.fetch();
    const base = (r.ok() ? await r.json() : {}) as { operacoes?: Record<string, unknown> };
    await json(rota, {
      ...base,
      destinoExterno: 'simulador',
      operacoes: { ...(base.operacoes ?? {}), gerarRemessa: { ligada: true, motivo: null } },
    });
  });
  await page.route('**/api/financeiro/apoio', async (rota) => {
    const r = await rota.fetch();
    const base = (r.ok() ? await r.json() : {}) as Record<string, unknown>;
    await json(rota, {
      ...base,
      contas: [{ id: 77, banco: 1, agencia: 1234, codigo: 5678, descricao: 'Conta sintética de pagamentos' }],
    });
  });
  await page.route(`**${P}/**`, async (rota) => {
    const url = new URL(rota.request().url());
    const caminho = url.pathname.slice(P.length);
    const metodo = rota.request().method();
    if (caminho === '/credores' && metodo === 'GET') {
      // Busca do fornecedor e do prestador por aqui; a do profissional vem de financeiro/pagar/credores.
      return json(rota, []);
    }
    if (caminho === '/credores/contas' && metodo === 'GET') {
      const tipo = url.searchParams.get('tipo');
      const credor = Number(url.searchParams.get('credor'));
      return json(
        rota,
        e.contas.filter((c) => c['_tipo'] === tipo && c['_credor'] === credor),
      );
    }
    if (caminho === '/credores/contas' && metodo === 'POST') {
      const b = rota.request().postDataJSON() as Record<string, unknown>;
      e.gravacoesConta.push(b);
      if (b['acao'] === 'incluir') {
        e.contas.push({
          _tipo: b['tipoCredor'],
          _credor: b['credor'],
          id: 500 + e.contas.length,
          versao: 1,
          banco: null,
          bancoNome: '',
          tipoConta: b['tipoConta'],
          agencia: null,
          conta: null,
          tipoChavePix: b['tipoChavePix'],
          chavePix: '***.***.247-25',
          titularNome: b['titularNome'],
          titularDocumento: '***.***.247-25',
          preferencial: b['preferencial'],
          ativo: true,
          chavesNoHistorico: 0,
        });
      }
      return json(rota, ok('Dados bancários do credor gravados.'));
    }
    if (caminho === '/bancos') return json(rota, [{ id: 1, nome: 'Banco sintético' }]);
    if (caminho === '/pix/parcelas') {
      const temChave = e.contas.some(
        (c) => c['_tipo'] === 'profissional' && c['_credor'] === PROFISSIONAL.id,
      );
      return json(
        rota,
        e.remessasPix.length > 0
          ? []
          : [
              {
                id: 3001,
                documento: 'HON-1',
                parcela: 1,
                credor: PROFISSIONAL.id,
                credorTipo: 'profissional',
                credorNome: PROFISSIONAL.nome,
                vencimento: '2026-12-10',
                valor: 100,
                temChavePix: temChave,
              },
            ],
      );
    }
    if (caminho === '/pix/remessas' && metodo === 'POST') {
      e.remessasPix.push(rota.request().postDataJSON() as Record<string, unknown>);
      return json(rota, ok('Remessa por Pix gerada.'));
    }
    if (caminho === '/remessas') {
      return json(
        rota,
        e.remessasPix.map((_, i) => ({
          id: 800 + i,
          numero: `PIX-${i + 1}`,
          sequencial: i + 1,
          situacao: 'gerada',
          meio: 'pix',
          conta: 77,
          contaNome: 'Conta sintética de pagamentos',
          valor: 100,
          geradaEm: '2026-12-01T10:00:00',
          dataPagamento: '2026-12-10',
          parcelas: 1,
          pendentes: e.retornos.length > 0 ? 0 : 1,
          retornos: e.retornos.length,
        })),
      );
    }
    if (caminho === '/retornos' && metodo === 'GET') return json(rota, []);
    if (caminho === '/retornos' && metodo === 'POST') {
      e.retornos.push(rota.request().postDataJSON() as Record<string, unknown>);
      return json(rota, ok('Retorno processado: 1 título baixado.'));
    }
    return json(rota, { title: 'rota não simulada' }, 404);
  });
  // A busca do profissional (a mesma do adiantamento).
  await page.route('**/api/financeiro/pagar/credores?**', (rota) => {
    const tipo = new URL(rota.request().url()).searchParams.get('tipo');
    return json(rota, tipo === 'profissional' ? [PROFISSIONAL] : []);
  });
}

test.describe('financeiro: conta e chave Pix do profissional, remessa e retorno @C1-026', () => {
  test.setTimeout(180_000);

  test('cadastro de credores grava a chave do profissional; quem paga gera o Pix e lê o retorno; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    const e: Estado = { contas: [], gravacoesConta: [], remessasPix: [], retornos: [] };
    await simular(page, e);

    // 1. O cadastro de credores: só a aba dos dados bancários; escolhe o tipo profissional e acha pelo nome.
    await entrar(page, 'SINT.FIN.CREDOR');
    // Chega pelo menu (Financeiro > Contas a pagar > Dados bancários e chave Pix do credor), sem a leitura das remessas.
    const menu = page.getByRole('navigation', { name: 'Menu principal' });
    await menu.locator('#menu-buscar').fill('Dados bancários e chave Pix');
    await menu.getByRole('link', { name: 'Dados bancários e chave Pix do credor' }).click();
    await expect(page).toHaveURL(/\/financeiro\/pagar\/pagamento-eletronico\?aba=credor$/);
    await expect(page.getByTestId('tela-fin-pagamento-eletronico')).toBeVisible();
    await expect(page.getByTestId('pe-aba-pix')).toHaveCount(0);
    await escolher(page.getByTestId('pe-credor-tipo'), 'profissional');
    await page.getByTestId('pe-credor-busca').fill('Profissional');
    await page.getByTestId(`pe-credor-opcao-${PROFISSIONAL.id}`).click();
    await expect(page.getByTestId('pe-credor-escolhido')).toBeVisible();
    await expect(page.getByTestId('pe-contas-nenhuma')).toBeVisible();
    await page.getByTestId('pe-titular').fill(PROFISSIONAL.nome);
    await page.getByTestId('pe-documento').fill('529.982.247-25');
    await page.getByTestId('pe-chave').fill('529.982.247-25');
    await expect(page.getByTestId('pe-recusa-conta')).toHaveCount(0);
    await semViolacaoAxe(page, '/financeiro/pagar/pagamento-eletronico (conta do profissional)');
    await page.getByTestId('pe-gravar-conta').click();
    await expect(page.getByTestId('pe-mensagem')).toContainText('Dados bancários do credor gravados');
    expect(e.gravacoesConta[0]).toMatchObject({
      acao: 'incluir',
      tipoCredor: 'profissional',
      credor: PROFISSIONAL.id,
      tipoChavePix: 'cpf',
    });
    expect(e.gravacoesConta[0]).not.toHaveProperty('fornecedor');
    await expect(page.getByTestId('pe-contas')).toContainText(PROFISSIONAL.nome);

    // 2. Quem gera a remessa: o título do profissional já tem chave, entra no Pix e mostra o tipo do credor.
    await entrar(page, 'SINT.FIN.PAGA');
    await page.goto('/financeiro/pagar/pagamento-eletronico?aba=pix');
    await expect(page.getByTestId('pe-pix-tipo-HON-1')).toContainText('Profissional');
    await page.getByTestId('pe-pix-marcar-HON-1').check();
    await escolher(page.getByTestId('pe-pix-conta'), '77');
    await page.getByTestId('pe-pix-data').fill('2026-12-10');
    await expect(page.getByTestId('pe-pix-total')).toContainText('1 título(s)');
    await semViolacaoAxe(page, '/financeiro/pagar/pagamento-eletronico (Pix do profissional)');
    await page.getByTestId('pe-pix-gerar').click();
    await expect(page.getByTestId('pe-mensagem')).toContainText('Remessa por Pix gerada');
    expect(e.remessasPix[0]).toMatchObject({ conta: 77, parcelas: [3001], dataPagamento: '2026-12-10' });

    // 3. O retorno do banco da remessa Pix: arquivo conferido na hora e processado.
    await page.getByTestId('pe-aba-retorno').click();
    await escolher(page.getByTestId('pe-remessa'), '800');
    await page.getByTestId('pe-arquivo').setInputFiles({
      name: 'retorno-pix.ret',
      mimeType: 'text/plain',
      buffer: Buffer.from(RETORNO),
    });
    await expect(page.getByTestId('pe-arquivo-ok')).toContainText('1 título(s)');
    await page.getByTestId('pe-processar').click();
    await expect(page.getByTestId('pe-mensagem')).toContainText('1 título baixado');
    expect(e.retornos[0]).toMatchObject({ remessa: 800, nomeArquivo: 'retorno-pix.ret' });

    // 4. Segregação: quem paga vê a conta do profissional, mas o botão de gravar fica preso, com o motivo escrito.
    await page.getByTestId('pe-aba-credor').click();
    await escolher(page.getByTestId('pe-credor-tipo'), 'profissional');
    await page.getByTestId('pe-credor-busca').fill('Profissional');
    await page.getByTestId(`pe-credor-opcao-${PROFISSIONAL.id}`).click();
    await expect(page.getByTestId('pe-contas')).toContainText(PROFISSIONAL.nome);
    await expect(page.getByTestId('pe-conta-desativar')).toBeDisabled();
    await expect(page.getByTestId('pe-sem-permissao-conta')).toContainText('cadastro de credores');
    await expect(page.getByTestId('pe-gravar-conta')).toBeDisabled();
    expect(e.gravacoesConta).toHaveLength(1);
    expect(externas).toEqual([]);
  });
});
