// C2-114 (06-SUS linha 54): programação físico-orçamentária, tetos e cotas SUS pelo caminho da tela. As rotas
// /api/sus/programacao exigem o banco próprio, e o E2E roda com a fonte sintética (sem núcleo); por isso as respostas são
// simuladas pelo Playwright com massa SINTÉTICA. O que se prova é a tela: a rota abre o painel da competência com o saldo
// de cada limite e a situação (excedido, alerta), a validação aparece na hora (importação sem conteúdo e cota sem
// quantidade travam o botão sem ir ao servidor), a importação leva a vigência por competência, o teto vai com o alerta e
// o bloqueio, o remanejamento da cota sai da própria linha com o motivo e a decisão é de outra pessoa. O efeito no banco
// está no contrato de efeito (apps/api/src/modulos/sus/programacao-propria.int.spec.ts).
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

const saldo = (x: Record<string, unknown>) => ({
  instrumento: 'todos',
  quantidade: null,
  valor: null,
  consumoQuantidade: 0,
  consumoValor: 0,
  saldoQuantidade: null,
  saldoValor: null,
  percentual: null,
  situacao: 'livre',
  bloqueia: false,
  registros: 0,
  excedentes: 0,
  versao: 1,
  ...x,
});

test.describe('C2-114 programação, tetos e cotas SUS @C2-114', () => {
  test('saldo da competência, importação validada, teto, remanejamento e decisão', async ({ page }) => {
    const pedidos: { caminho: string; corpo: Record<string, unknown> }[] = [];
    await page.route('**/api/sus/programacao**', (r) => {
      const req = r.request();
      const url = new URL(req.url());
      if (req.method() === 'GET') {
        if (url.pathname.endsWith('/opcoes'))
          return json(r, {
            contratos: [{ id: 3, descricao: 'CT-SINT · Secretaria sintética' }],
            setores: [
              { id: 21, descricao: 'Ambulatório sintético (AMB)' },
              { id: 22, descricao: 'Imagem sintética (IMG)' },
            ],
          });
        return json(r, {
          competencia: url.searchParams.get('competencia'),
          periodo: { inicio: '2026-01-01', fim: '2026-01-31' },
          programacoes: [
            {
              id: 5,
              descricao: 'Programação sintética',
              contrato: 3,
              contratoNumero: 'CT-SINT',
              vigenciaInicio: '2026-01-01',
              vigenciaFim: null,
              formaEntrada: 'importada',
              valorTotal: 540,
              situacao: 'rascunho',
              itens: 2,
              versao: 1,
            },
          ],
          saldos: [
            saldo({
              tipo: 'teto',
              id: 8,
              descricao: 'Teto · TODOS',
              valor: 25,
              consumoValor: 30,
              saldoValor: -5,
              percentual: 120,
              situacao: 'excedido',
              bloqueia: true,
              registros: 3,
              excedentes: 1,
            }),
            saldo({
              tipo: 'cota',
              id: 9,
              descricao: 'Cota · BPA · 0301',
              instrumento: 'bpa',
              quantidade: 10,
              consumoQuantidade: 8,
              saldoQuantidade: 2,
              percentual: 80,
              situacao: 'alerta',
            }),
          ],
          registros: { bpa: 3, apac: 0, aih: 0 },
          remanejamentos: [
            {
              id: 31,
              cota: 9,
              tipo: 'setor',
              origem: 'Ambulatório sintético',
              destino: 'Imagem sintética',
              quantidade: 1,
              valor: null,
              motivo: 'Fila maior na imagem',
              situacao: 'solicitada',
              solicitadoEm: '2026-01-10',
              doUsuario: false,
              versao: 1,
            },
          ],
        });
      }
      const corpo = req.postDataJSON() as Record<string, unknown>;
      pedidos.push({ caminho: url.pathname, corpo });
      return json(r, { id: 77, itens: 1, valorTotal: 10, situacao: 'aprovada', destino: 40 }, 201);
    });

    await entrar(page, 'SINT.ADMIN');
    await page.goto('/faturamento/sus/programacao');
    await expect(page.getByTestId('tela-programacao-sus')).toBeVisible();
    await expect(page.getByTestId('saldo-teto-8')).toContainText('Excedido');
    await expect(page.getByTestId('saldo-teto-8')).toContainText('bloqueia');
    await expect(page.getByTestId('saldo-cota-9')).toContainText('Em alerta');

    // Importação: sem conteúdo, o botão fica travado; com o conteúdo, vai com a vigência da competência.
    await expect(page.getByTestId('imp-enviar')).toBeDisabled();
    await escolher(page.getByTestId('imp-contrato'), '3');
    await page.getByTestId('imp-inicio').fill('2026-01');
    await page.getByTestId('imp-conteudo').fill('codigo;quantidade;valor\n0301;100;5,00\n0301010072;4;10');
    await page.getByTestId('imp-enviar').click();
    await expect(page.getByTestId('programacao-aviso')).toContainText('rascunho');
    const imp = pedidos.find((p) => p.caminho === '/api/sus/programacao')!;
    expect(imp.corpo).toMatchObject({ contrato: 3, vigenciaInicio: '2026-01-01', vigenciaFim: null });

    // Ativar o rascunho em um clique.
    await page.getByTestId('ativar-5').click();
    await expect.poll(() => pedidos.some((p) => p.caminho.endsWith('/5/ativar'))).toBe(true);

    // Cota sem quantidade trava; teto com alerta e bloqueio vai inteiro.
    await escolher(page.getByTestId('lim-tipo'), 'cota');
    await expect(page.getByTestId('lim-incluir')).toBeDisabled();
    await expect(page.getByTestId('lim-problemas')).toBeVisible();
    await escolher(page.getByTestId('lim-tipo'), 'teto');
    await page.getByTestId('lim-valor').fill('1000');
    await page.getByTestId('lim-alerta').fill('80');
    await page.getByTestId('lim-bloqueia').check();
    await page.getByTestId('lim-incluir').click();
    await expect
      .poll(() => pedidos.find((p) => p.caminho.endsWith('/limites'))?.corpo)
      .toMatchObject({ tipo: 'teto', valor: 1000, percentualAlerta: 80, bloqueia: true });

    // Remanejar na própria linha: acima do saldo livre trava; com motivo e setor, vai.
    await page.getByTestId('remanejar-9').click();
    await page.getByTestId('rem-quantidade').fill('3');
    await expect(page.getByTestId('rem-problemas')).toContainText('saldo livre');
    await page.getByTestId('rem-quantidade').fill('2');
    await escolher(page.getByTestId('rem-setor'), '22');
    await page.getByTestId('rem-motivo').fill('Fila maior no setor de imagem');
    await page.getByTestId('rem-pedir').click();
    await expect
      .poll(() => pedidos.find((p) => p.caminho.endsWith('/cotas/9/remanejar'))?.corpo)
      .toMatchObject({ tipo: 'setor', destinoSetor: 22, quantidade: 2 });

    // Outra pessoa decide o pedido pendente.
    await page.getByTestId('aprovar-31').click();
    await expect
      .poll(() => pedidos.find((p) => p.caminho.endsWith('/remanejamentos/31/decidir'))?.corpo)
      .toMatchObject({ aprovar: true, versao: 1 });

    await semViolacaoAxe(page, 'programação, tetos e cotas SUS');
  });
});
