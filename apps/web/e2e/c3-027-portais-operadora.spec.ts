// C3-027 (08-SGO linha 114): portais do beneficiário, da contratante e do corretor, pelo caminho da tela. As rotas
// /api/operadora/portais e /api/portal-operadora exigem o banco próprio, e o E2E roda com a fonte sintética (sem
// núcleo); por isso as respostas são simuladas pelo Playwright com massa SINTÉTICA. O que se prova é a tela: a
// operadora ativa a conta só com os termos aceitos, bloqueia com motivo, decide a solicitação com a versão lida e
// processa o lote de exclusão; o beneficiário vê o cartão digital, escolhe o motivo da exclusão nas opções do portal
// (envio travado sem a data), abre a solicitação de segunda via sem mandar o titular e cancela a aberta. O efeito
// no banco está no contrato de efeito (apps/api/src/modulos/operadora/portais-operadora-propria.int.spec.ts).
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

const conta = (id: number, situacao: string, versao: number) => ({
  id,
  portal: 'beneficiario',
  operadora: 1,
  login: `sint.benef.${id}`,
  email: null,
  celular: null,
  situacao,
  usuario: null,
  beneficiario: 300 + id,
  contratante: null,
  gestor: null,
  corretora: null,
  vendedor: null,
  recebeNotificacoes: true,
  motivoBloqueio: null,
  convidadaEm: '2026-11-01T10:00:00',
  ativadaEm: null,
  versao,
});
const solicitacao = (id: number, situacao: string, versao: number) => ({
  id,
  numero: `SP-SINT-${id}`,
  tipo: 'segunda_via_cartao',
  situacao,
  contaBeneficiario: 1,
  contaContratante: null,
  beneficiario: 301,
  beneficiarioNome: 'Beneficiário sintético',
  dataEfeito: null,
  resultado: null,
  criadaEm: '2026-11-20T09:00:00',
  analisadaEm: null,
  versao,
});

test.describe('C3-027 portais da operadora @C3-027', () => {
  test('operadora: conta ativada com os termos e bloqueada com motivo; solicitação aprovada; lote processado', async ({
    page,
  }) => {
    const pedidos: { caminho: string; corpo: Record<string, unknown> }[] = [];
    await page.route('**/api/operadora/portais/**', (r) => {
      const req = r.request();
      const url = new URL(req.url());
      if (req.method() === 'GET') {
        if (url.pathname.endsWith('/canal-mensagens'))
          return json(r, { canal: 'plataforma', ligado: false, decisao: 'DP-44 a' });
        if (url.pathname.endsWith('/beneficiario/contas'))
          return json(r, { itens: [conta(1, 'convidada', 1), conta(2, 'ativa', 3)] });
        if (url.pathname.includes('/contas')) return json(r, { itens: [] });
        if (url.pathname.endsWith('/solicitacoes'))
          return json(r, { itens: [solicitacao(11, 'em_analise', 2)] });
        if (url.pathname.endsWith('/lotes/21/itens'))
          return json(r, {
            itens: [
              {
                sequencia: 1,
                matricula: 'M-SINT-1',
                nome: 'Beneficiário sintético',
                beneficiario: 301,
                situacao: 'aceito',
                critica: null,
                dataEfeito: '2026-12-01',
                processadoEm: null,
              },
              {
                sequencia: 2,
                matricula: 'M-SINT-9',
                nome: 'Linha sintética',
                beneficiario: null,
                situacao: 'rejeitado',
                critica: 'Matrícula fora da contratante.',
                dataEfeito: '2026-12-01',
                processadoEm: null,
              },
            ],
          });
        if (url.pathname.endsWith('/lotes'))
          return json(r, {
            itens: [
              {
                id: 21,
                numero: 'LC-SINT-1',
                contratante: 41,
                situacao: 'criticado',
                registros: 2,
                aceitos: 1,
                rejeitados: 1,
                recebidoEm: '2026-11-25T08:00:00',
                processadoEm: null,
                versao: 2,
              },
            ],
          });
        return json(r, { itens: [] });
      }
      pedidos.push({ caminho: url.pathname, corpo: req.postDataJSON() as Record<string, unknown> });
      return json(r, { id: 1, versao: 9 });
    });

    await entrar(page, 'SINT.OPERADORA');
    await page.goto('/operadora/portais');
    await expect(page.getByTestId('tela-portais-operadora')).toBeVisible();
    await expect(page.getByTestId('portais-canal')).toContainText('DP-44 a');

    // ativar só com os termos aceitos
    await expect(page.getByTestId('portais-ativar-1')).toBeDisabled();
    await page.getByTestId('portais-termos-1').check();
    await page.getByTestId('portais-ativar-1').click();
    // bloquear só com motivo
    await expect(page.getByTestId('portais-bloquear-2')).toBeDisabled();
    await page.locator('#portais-motivo-2').fill('Uso indevido sintético');
    await page.getByTestId('portais-bloquear-2').click();
    await semViolacaoAxe(page, 'portais da operadora: contas');

    await page.getByTestId('portais-aba-solicitacoes').click();
    await escolher(page.getByTestId('portais-solic-situacao'), 'em_analise');
    await page.getByTestId('portais-aprovar-11').click();

    await page.getByTestId('portais-aba-lotes').click();
    await page.getByTestId('portais-lote-itens-21').click();
    await expect(page.getByTestId('portais-lote-linhas')).toContainText('Matrícula fora da contratante.');
    await page.getByTestId('portais-lote-processar-21').click();
    await page.getByRole('button', { name: /confirmar/i }).click();
    await semViolacaoAxe(page, 'portais da operadora: lotes');

    expect(pedidos).toEqual([
      {
        caminho: '/api/operadora/portais/beneficiario/contas/1/situacao',
        corpo: { versao: 1, acao: 'ativar', motivo: null, termosAceitos: true },
      },
      {
        caminho: '/api/operadora/portais/beneficiario/contas/2/situacao',
        corpo: { versao: 3, acao: 'bloquear', motivo: 'Uso indevido sintético', termosAceitos: false },
      },
      {
        caminho: '/api/operadora/portais/solicitacoes/11/decisao',
        corpo: { versao: 2, acao: 'aprovar', resultado: null },
      },
      { caminho: '/api/operadora/portais/lotes/21/processar', corpo: { versao: 2 } },
    ]);
  });

  test('beneficiário: cartão digital, segunda via sem o titular na tela e cancelamento da aberta', async ({
    page,
  }) => {
    const pedidos: { caminho: string; corpo: Record<string, unknown> }[] = [];
    const lista = [solicitacao(12, 'aberta', 1)];
    await page.route('**/api/portal-operadora/**', (r) => {
      const req = r.request();
      const url = new URL(req.url());
      if (req.method() === 'GET') {
        if (url.pathname.endsWith('/beneficiario/conta'))
          return json(r, {
            id: 1,
            portal: 'beneficiario',
            login: 'sint.benef.1',
            email: null,
            celular: null,
            situacao: 'ativa',
            tipos: ['segunda_via_cartao', 'reembolso', 'alteracao_cadastral', 'exclusao_beneficiario'],
          });
        if (url.pathname.endsWith('/beneficiario/cartao'))
          return json(r, {
            matricula: 'M-SINT-1',
            nome: 'Beneficiário sintético',
            via: 2,
            produto: 'Plano sintético',
            registroAns: null,
            inicioVigencia: '2026-01-01',
            fimVigencia: null,
            valido: true,
          });
        if (url.pathname.endsWith('/solicitacoes')) return json(r, { itens: lista });
        if (url.pathname.endsWith('/beneficiario/opcoes'))
          return json(r, {
            motivosExclusao: [{ id: 7, codigo: 'SINT-EXC', descricao: 'Mudança sintética' }],
            contratos: [],
          });
        return json(r, { itens: [] });
      }
      pedidos.push({ caminho: url.pathname, corpo: req.postDataJSON() as Record<string, unknown> });
      return json(
        r,
        { id: 13, versao: 1, numero: 'SP-SINT-13' },
        url.pathname.endsWith('/cancelar') ? 200 : 201,
      );
    });

    await entrar(page, 'SINT.PORTAL.BENEF');
    await page.goto('/portal-operadora/beneficiario');
    await expect(page.getByTestId('portal-conta')).toContainText('sint.benef.1');
    await page.getByTestId('portal-ver-cartao').click();
    await expect(page.getByTestId('portal-cartao-dados')).toContainText('M-SINT-1');
    await expect(page.getByTestId('portal-cartao-validade')).toBeVisible();

    await expect(page.getByTestId('portal-nova-enviar')).toBeDisabled();
    // exclusão: o motivo vem das opções do portal; sem a data de efeito o envio segue travado
    await escolher(page.getByTestId('portal-nova-tipo'), 'exclusao_beneficiario');
    await escolher(page.getByTestId('portal-nova-motivo'), '7');
    await expect(page.getByTestId('portal-nova-enviar')).toBeDisabled();
    await escolher(page.getByTestId('portal-nova-tipo'), 'segunda_via_cartao');
    await page.getByTestId('portal-nova-enviar').click();
    await page.getByTestId('portal-cancelar-12').click();
    await page.getByRole('button', { name: /confirmar/i }).click();
    await semViolacaoAxe(page, 'portal do beneficiário');

    expect(pedidos).toEqual([
      {
        caminho: '/api/portal-operadora/beneficiario/solicitacoes',
        corpo: {
          tipo: 'segunda_via_cartao',
          beneficiario: null,
          motivo: null,
          dataEfeito: null,
          pedidoReembolso: null,
          dados: null,
          observacao: null,
        },
      },
      { caminho: '/api/portal-operadora/beneficiario/solicitacoes/12/cancelar', corpo: { versao: 1 } },
    ]);
  });
});
