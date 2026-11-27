// E2E @C1-108 (F7, 04-INT L80): a comunicação de internação e alta recebida, do lado da operadora, na tela
// /operadora/troca-tiss. A pendente (carteira não identificada na chegada) vem primeiro; quem recebe contas identifica a
// carteira, aceita a comunicação ou a recusa com o motivo da terminologia de glosas (combo SanteSelecao). As rotas
// /api/operadora/troca-tiss/comunicacoes exigem o banco próprio e o E2E roda com a fonte sintética: as respostas são
// simuladas pelo Playwright com massa SINTÉTICA. O efeito no banco está em
// apps/api/src/modulos/operadora/comunicacao-recebida.int.spec.ts.
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

const comunicacao = (id: number, extra: Record<string, unknown>) => ({
  id,
  versao: 1,
  prestador: 'CLINICA SINTETICA',
  numeroTransacao: `9${id}`,
  numeroCarteira: `SINT-${id}`,
  beneficiario: null,
  matricula: null,
  recemNascido: false,
  tipoEvento: 'internacao',
  eventoEm: '2026-11-24',
  tipoInternacao: 'clinica',
  motivoEncerramento: null,
  recebidoEm: '2026-11-25T10:00:00Z',
  situacao: 'recebida',
  motivoRecusa: null,
  respondidoEm: null,
  ...extra,
});

test.describe('Comunicação de internação recebida pela operadora @C1-108 @fase7', () => {
  test.setTimeout(180_000);

  test('pendente primeiro, identifica a carteira e aceita; a outra é recusada com motivo; axe', async ({ page }) => {
    const enviados: { caminho: string; corpo: Record<string, unknown> }[] = [];
    const itens = [
      comunicacao(1, {}),
      comunicacao(2, { tipoEvento: 'alta', tipoInternacao: null, motivoEncerramento: '12', recemNascido: true }),
      comunicacao(3, { situacao: 'aceita', beneficiario: 7, matricula: 'SINT-MAT-3' }),
    ];
    await page.route('**/api/operadora/troca-tiss**', (r) => json(r, { itens: [] }));
    await page.route('**/api/operadora/troca-tiss/comunicacoes**', async (r) => {
      const u = new URL(r.request().url());
      if (u.pathname.endsWith('/motivos-recusa'))
        return json(r, { itens: [{ id: 50, codigo: '9901', descricao: 'MOTIVO SINTETICO' }] });
      if (r.request().method() === 'POST') {
        const corpo = r.request().postDataJSON() as Record<string, unknown>;
        enviados.push({ caminho: u.pathname, corpo });
        const id = Number(u.pathname.split('/').at(-2));
        const x = itens.find((y) => y.id === id)!;
        if (u.pathname.endsWith('/carteira')) {
          if (corpo['carteira'] === 'ERRADA')
            return json(
              r,
              {
                type: 'carteira-nao-identificada',
                title: 'Comunicação recusada',
                status: 409,
                detail: 'A carteira não corresponde a um beneficiário desta operadora.',
                codigo: 'carteira-nao-identificada',
              },
              409,
            );
          Object.assign(x, { beneficiario: 7, matricula: 'SINT-MAT-1', versao: x.versao + 1 });
          return json(r, { id, versao: x.versao, beneficiario: 7 });
        }
        const aceitar = corpo['acao'] === 'aceitar';
        Object.assign(x, {
          situacao: aceitar ? 'aceita' : 'recusada',
          versao: x.versao + 1,
          motivoRecusa: aceitar ? null : { id: 50, codigo: '9901', descricao: 'MOTIVO SINTETICO' },
        });
        return json(r, { id, versao: x.versao, situacao: x.situacao });
      }
      const s = u.searchParams.get('situacao');
      return json(r, { itens: itens.filter((y) => !s || y.situacao === s) });
    });

    await entrar(page, 'SINT.OPE.AUDITOR');
    await page.goto('/operadora/troca-tiss');
    const lista = page.getByTestId('comunicacoes-lista');
    await expect(lista).toContainText('SINT-1');
    await expect(page.getByTestId('comunicacao-1')).toContainText('Não identificado');
    await expect(page.getByTestId('comunicacao-2')).toContainText('(recém-nascido)');
    await expect(page.getByTestId('comunicacao-responder-3')).toHaveCount(0);

    // Filtro: só as pendentes.
    await escolher(page.getByTestId('comunicacoes-filtro'), { rotulo: 'Pendente' });
    await expect(page.getByTestId('comunicacao-3')).toHaveCount(0);
    await escolher(page.getByTestId('comunicacoes-filtro'), { rotulo: 'Todas' });
    await expect(page.getByTestId('comunicacao-3')).toBeVisible();

    // A 1: aceitar fica desligado sem beneficiário; a carteira errada é apontada; a certa identifica; aceita.
    await page.getByTestId('comunicacao-responder-1').click();
    const painel = page.getByTestId('comunicacao-painel');
    await expect(page.getByTestId('comunicacao-aceitar')).toBeDisabled();
    await page.getByTestId('comunicacao-carteira').locator('input').fill('ERRADA');
    await page.getByTestId('comunicacao-identificar').click();
    await expect(painel).toContainText('não corresponde a um beneficiário');
    await page.getByTestId('comunicacao-carteira').locator('input').fill('SINT.MAT-1');
    await page.getByTestId('comunicacao-identificar').click();
    await expect(page.getByTestId('comunicacao-aviso')).toContainText('Carteira identificada.');
    await expect(page.getByTestId('comunicacao-1')).toContainText('SINT-MAT-1');
    await semViolacaoAxe(page, '/operadora/troca-tiss comunicações');
    await page.getByTestId('comunicacao-aceitar').click();
    await expect(page.getByTestId('comunicacao-aviso')).toContainText('Comunicação aceita.');
    await expect(page.getByTestId('comunicacao-1')).toContainText('Aceita');
    expect(enviados.at(-1)).toEqual({
      caminho: '/api/operadora/troca-tiss/comunicacoes/1/resposta',
      corpo: { versao: 2, acao: 'aceitar' },
    });

    // A 2: recusa só com o motivo escolhido.
    await page.getByTestId('comunicacao-responder-2').click();
    await expect(page.getByTestId('comunicacao-recusar')).toBeDisabled();
    await escolher(page.getByTestId('comunicacao-motivo'), { rotulo: '9901 MOTIVO SINTETICO' });
    await page.getByTestId('comunicacao-recusar').click();
    await expect(page.getByTestId('comunicacao-2')).toContainText('Recusada');
    await expect(page.getByTestId('comunicacao-2')).toContainText('MOTIVO SINTETICO');
    expect(enviados.at(-1)).toEqual({
      caminho: '/api/operadora/troca-tiss/comunicacoes/2/resposta',
      corpo: { versao: 1, acao: 'recusar', motivoRecusa: 50 },
    });
  });
});
