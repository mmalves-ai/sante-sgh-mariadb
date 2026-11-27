// C2-070 (06-FAT linha 26): a comunicação à operadora desfeita (alta cancelada ou internação excluída), pelo caminho da
// tela. As rotas da comunicação exigem o banco próprio, e o E2E roda com a fonte sintética (sem núcleo); por isso as
// respostas da API são simuladas pelo Playwright com massa SINTÉTICA. O que se prova é a tela: a desfeita mostra quando e
// por quê; a que a operadora já recebeu (retificação pendente) oferece 'Cancelar junto à operadora', pede o motivo e
// envia o 'cancelar' com a versão lida; a cancelada antes de chegar à operadora não oferece nada. O efeito no banco
// (marca, cancelamento, retificação) está no contrato de efeito
// (apps/api/src/modulos/adt/comunicacao-operadora-disparo.int.spec.ts).
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

const base = {
  protocolo: null,
  enviadoEm: null,
  respondidoEm: null,
  resposta: null,
  criadoEm: '2026-11-25T10:00:00.000Z',
  pelaIntegracao: false,
  situacaoEnvio: null,
};

test.describe('C2-070 comunicação à operadora desfeita @C2-070', () => {
  test('desfeita mostra quando e por quê; a recebida pela operadora é cancelada junto a ela', async ({
    page,
  }) => {
    const pedidos: { caminho: string; corpo: Record<string, unknown> }[] = [];
    const itens: Record<string, unknown>[] = [
      {
        ...base,
        id: 901,
        tipo: 'alta',
        situacao: 'confirmada',
        protocolo: 'PR-SINT-9',
        enviadoEm: '2026-11-25T10:01:00.000Z',
        respondidoEm: '2026-11-25T10:05:00.000Z',
        versao: 4,
        desfeitaEm: '2026-11-25T11:00:00.000Z',
        motivoDesfeita: 'Alta cancelada',
        retificacaoPendente: true,
      },
      {
        ...base,
        id: 902,
        tipo: 'internacao',
        situacao: 'cancelada',
        resposta: 'Internação excluída',
        versao: 2,
        desfeitaEm: '2026-11-25T11:00:00.000Z',
        motivoDesfeita: 'Internação excluída',
        retificacaoPendente: false,
      },
    ];
    await page.route('**/api/internacao/comunicacoes-operadora/**', (r) => {
      const req = r.request();
      const url = new URL(req.url());
      if (req.method() === 'GET') return json(r, { itens });
      const corpo = (req.postDataJSON() ?? {}) as Record<string, unknown>;
      pedidos.push({ caminho: url.pathname, corpo });
      if (url.pathname.endsWith('/901/transicao')) {
        Object.assign(itens[0]!, {
          situacao: 'cancelada',
          resposta: corpo['resposta'],
          versao: 5,
          retificacaoPendente: false,
        });
        return json(r, { id: 901, situacao: 'cancelada' });
      }
      return json(r, { id: 0 });
    });

    // Recepção da internação (o administrador não tem permissão clínica nem de faturamento).
    await entrar(page, 'SINT.INTERNACAO');
    await page.goto('/internacao/123/comunicacoes-operadora');
    await expect(page.getByTestId('tela-comunicacao-operadora')).toBeVisible();

    await expect(page.getByTestId('com-op-desfeita-901')).toContainText(
      'Desfeita em 2026-11-25 11:00: Alta cancelada',
    );
    await expect(page.getByTestId('com-op-retificacao-901')).toBeVisible();
    await expect(page.getByTestId('com-op-desfeita-902')).toContainText('Internação excluída');
    await expect(page.getByTestId('com-op-retificacao-902')).toHaveCount(0);
    await expect(page.getByTestId('com-op-cancelar-operadora-902')).toHaveCount(0);

    // Sem motivo, a regra do domínio recusa na tela e nada sai.
    await page.getByTestId('com-op-cancelar-operadora-901').click();
    await expect(page.getByTestId('com-op-problemas')).toContainText('Informe o motivo.');
    expect(pedidos).toHaveLength(0);

    await page
      .getByTestId('com-op-motivo-cancelamento-901')
      .fill('Cancelada junto à operadora, protocolo PR-SINT-10');
    await page.getByTestId('com-op-cancelar-operadora-901').click();
    await expect(page.getByTestId('com-op-alta')).toContainText('Cancelada');
    await expect(page.getByTestId('com-op-retificacao-901')).toHaveCount(0);
    await expect(page.getByTestId('com-op-cancelar-operadora-901')).toHaveCount(0);
    expect(pedidos).toEqual([
      {
        caminho: '/api/internacao/comunicacoes-operadora/901/transicao',
        corpo: {
          acao: 'cancelar',
          versao: 4,
          protocolo: null,
          resposta: 'Cancelada junto à operadora, protocolo PR-SINT-10',
        },
      },
    ]);
    await expect(page.getByText('Sem permissão')).toHaveCount(0);
    await semViolacaoAxe(page, '/internacao/123/comunicacoes-operadora');
  });
});
