// E2E @C2-045 (F7, 07-FIN linha 90): cobrança Pix sobre o título a receber. As rotas `/api/financeiro/pix/*` só existem
// no banco do cliente (na fonte sintética respondem 503), então este E2E simula essas rotas com um estado em memória que
// segue a regra do servidor. O que fica no banco (chave Pix da conta, cobrança com o copia e cola, retorno com crédito
// na conta e baixa da parcela idempotente pelo fim a fim, devolução com débito e nova baixa do que ficou) está no
// contrato de efeito apps/api/src/modulos/financeiro/aplicacao/cobranca-pix.int.spec.ts. Aqui se prova o fluxo da
// tela: cadastrar a chave aleatória com a conferência na hora, gerar a cobrança da parcela (valor acima do saldo
// recusado na hora), copiar o copia e cola, pagar no simulador com valor a mais, ver a parcela baixada com o excedente
// e devolver uma parte (a prévia diz de onde sai). Axe na tela. Massa SINTÉTICA.
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const P = '/api/financeiro/pix';
const CHAVE_ALEATORIA = '123e4567-e89b-42d3-a456-426614174000';

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
const ok = (rota: Route, mensagem: string) => json(rota, { mensagem, repetida: false, dados: {} });

function simular(page: Page) {
  const corpos: Record<string, unknown>[] = [];
  const chaves: Record<string, unknown>[] = [];
  const parcela = {
    parcela: 901,
    titulo: 'TR-FIC-9',
    sequencia: 1,
    vencimento: '2030-04-10',
    saldo: 100,
    pagador: 'PAGADOR FICTICIO',
    temDocumento: true,
    cobrancaAtiva: null as number | null,
  };
  const cobrancas: Record<string, unknown>[] = [];
  const recebidos: Record<string, unknown>[] = [];
  return {
    corpos,
    async ligar() {
      await page.route('**/api/financeiro/gravacao', (rota) =>
        json(rota, { funcionalidades: {}, operacoes: {}, ambiente: 'dev', destinoExterno: 'simulador' }),
      );
      await page.route('**/api/financeiro/apoio', (rota) =>
        json(rota, {
          contas: [{ id: 7, banco: 1, agencia: 1234, codigo: 5678, descricao: 'CONTA FICTICIA' }],
        }),
      );
      await page.route(`**${P}/chaves`, async (rota) => {
        if (rota.request().method() === 'GET') return json(rota, chaves);
        const c = rota.request().postDataJSON() as Record<string, unknown>;
        corpos.push(c);
        chaves.push({
          id: 41,
          versao: 1,
          conta: c['conta'],
          contaDescricao: 'CONTA FICTICIA',
          tipo: c['tipo'],
          chave: c['chave'],
          padrao: c['padrao'],
          ativa: true,
        });
        return ok(rota, 'Chave Pix cadastrada.');
      });
      await page.route(/\/api\/financeiro\/pix\/parcelas/, (rota) =>
        json(rota, parcela.saldo > 0 ? [parcela] : []),
      );
      await page.route(/\/api\/financeiro\/pix\/cobrancas\/pagar-simulado/, async (rota) => {
        const c = rota.request().postDataJSON() as Record<string, unknown>;
        corpos.push(c);
        const cob = cobrancas.find((x) => x['id'] === c['cobranca'])!;
        // O pagador pagou 120 numa cobrança de 100: a parcela baixa 100 e 20 ficam para devolução.
        cob['situacao'] = 'concluida';
        cob['valorPago'] = 120;
        cob['pagoEm'] = '2030-04-05T10:00:00.000Z';
        recebidos.push({
          retorno: 77,
          fimAFim: 'E00000000203004051000FICTICIO01',
          valor: 120,
          pagoEm: '2030-04-05T10:00:00.000Z',
          situacao: 'baixado',
          baixado: 100,
          devolvido: 0,
          podeDevolver: 120,
          excedenteLivre: 20,
          aviso: null,
        });
        parcela.saldo = 0;
        parcela.cobrancaAtiva = null;
        return ok(
          rota,
          '1 Pix recebido(s): 1 baixado(s) (R$ 100,00), 1 com valor para devolução (R$ 20,00), 0 repetido(s), 0 sem cobrança.',
        );
      });
      await page.route(/\/api\/financeiro\/pix\/cobrancas\/cancelar/, (rota) => ok(rota, 'Cancelada.'));
      await page.route(/\/api\/financeiro\/pix\/cobrancas(\?|$)/, async (rota) => {
        if (rota.request().method() === 'GET')
          return json(
            rota,
            cobrancas.map((c) => ({ ...c, recebidos: c['situacao'] === 'concluida' ? recebidos : [] })),
          );
        const c = rota.request().postDataJSON() as Record<string, unknown>;
        corpos.push(c);
        parcela.cobrancaAtiva = 501;
        cobrancas.push({
          id: 501,
          txid: 'FICTICIO0000000000000000000000001',
          modalidade: c['modalidade'],
          valor: parcela.saldo,
          situacao: 'ativa',
          criadaEm: '2030-04-01T10:00:00.000Z',
          vencimento: null,
          pagador: parcela.pagador,
          titulo: parcela.titulo,
          parcela: parcela.parcela,
          copiaECola: '00020101021226FICTICIO6304ABCD',
          valorPago: null,
          pagoEm: null,
        });
        return ok(rota, 'Cobrança Pix de R$ 100,00 gerada. Ambiente de teste: o QR é simulado.');
      });
      await page.route(`**${P}/devolucoes`, async (rota) => {
        const c = rota.request().postDataJSON() as Record<string, unknown>;
        corpos.push(c);
        const r = recebidos[0]!;
        r['devolvido'] = Number(c['valor']);
        r['podeDevolver'] = 120 - Number(c['valor']);
        r['excedenteLivre'] = 0;
        return ok(rota, 'Devolução de R$ 20,00 feita, do valor pago a mais (a baixa continua).');
      });
    },
  };
}

test.describe('@C2-045 cobrança Pix sobre o título a receber', () => {
  test.setTimeout(180_000);
  test('chave conferida na hora, cobrança da parcela, pagamento no simulador com baixa e devolução do excedente', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    const api = simular(page);
    await api.ligar();
    await entrar(page, 'SINT.ADMIN');
    await page.goto('/financeiro/receber/pix');
    await expect(page.getByTestId('tela-fin-pix')).toBeVisible();
    await expect(page.getByTestId('px-simulador')).toBeVisible();

    // Chave Pix: a chave torta é recusada na hora; a aleatória certa grava.
    await page.getByTestId('px-aba-chaves').click();
    await expect(page.getByTestId('px-sem-chaves')).toBeVisible();
    await escolher(page.getByTestId('px-chave-conta'), '7');
    await escolher(page.getByTestId('px-chave-tipo'), 'aleatoria');
    await page.getByTestId('px-chave-valor').fill('nao-e-chave');
    await expect(page.getByTestId('px-recusa-chave')).toBeVisible();
    await expect(page.getByTestId('px-incluir-chave')).toBeDisabled();
    await page.getByTestId('px-chave-valor').fill(CHAVE_ALEATORIA);
    await expect(page.getByTestId('px-recusa-chave')).toHaveCount(0);
    await page.getByTestId('px-incluir-chave').click();
    await expect(page.getByTestId('px-mensagem')).toContainText('Chave Pix cadastrada');
    expect(api.corpos.at(-1)).toEqual({
      acao: 'incluir',
      conta: 7,
      tipo: 'aleatoria',
      chave: CHAVE_ALEATORIA,
      padrao: true,
    });
    await expect(page.getByTestId('px-chave-41')).toHaveAttribute('data-ativa', 'true');

    // Cobrar: a parcela, a chave padrão já escolhida; valor acima do saldo recusado na hora.
    await page.getByTestId('px-aba-cobrar').click();
    await page.getByTestId('px-escolher-901').click();
    await expect(page.getByTestId('px-parcela-escolhida')).toContainText('TR-FIC-9/1');
    await page.getByTestId('px-valor').fill('150');
    await expect(page.getByTestId('px-recusa-cobranca')).toContainText('saldo da parcela');
    await expect(page.getByTestId('px-gerar')).toBeDisabled();
    await page.getByTestId('px-valor').fill('');
    await expect(page.getByTestId('px-recusa-cobranca')).toHaveCount(0);
    await page.getByTestId('px-gerar').click();
    await expect(page.getByTestId('px-mensagem')).toContainText('Cobrança Pix de R$ 100,00 gerada');
    expect(api.corpos.at(-1)).toEqual({ parcela: 901, chave: 41, modalidade: 'imediata' });
    await expect(page.getByTestId('px-copia-cola')).toHaveValue('00020101021226FICTICIO6304ABCD');
    await page.getByTestId('px-copiar').click();
    await expect(page.getByTestId('px-copiado')).toBeVisible();
    await semViolacaoAxe(page, '/financeiro/receber/pix (cobrar)');

    // Cobranças: quem baixa é a tesouraria (segregação: quem cobra não baixa). O simulador paga 120; a parcela baixa
    // 100 e 20 ficam livres para devolver.
    await entrar(page, 'SINT.FIN.PAGA');
    await page.goto('/financeiro/receber/pix');
    await expect(page.getByTestId('px-simulador')).toBeVisible();
    await page.getByTestId('px-aba-cobrancas').click();
    await expect(page.getByTestId('px-cobranca-501')).toHaveAttribute('data-situacao', 'ativa');
    await page.getByTestId('px-pagar-simulado-501').click();
    await expect(page.getByTestId('px-mensagem')).toContainText('1 baixado(s) (R$ 100,00)');
    expect(api.corpos.at(-1)).toEqual({ cobranca: 501 });
    await expect(page.getByTestId('px-cobranca-501')).toHaveAttribute('data-situacao', 'concluida');
    await expect(page.getByTestId('px-excedente-77')).toContainText('20,00');

    // Devolução: a prévia diz que sai do pago a mais; acima do que pode ser devolvido, recusa na hora.
    await page.getByTestId('px-devolver-77').click();
    await expect(page.getByTestId('px-plano-devolucao')).toContainText('baixa da parcela continua');
    await page.getByTestId('px-valor-devolver').fill('130');
    await expect(page.getByTestId('px-recusa-devolucao')).toContainText('ainda pode ser devolvido');
    await expect(page.getByTestId('px-confirmar-devolucao')).toBeDisabled();
    await page.getByTestId('px-valor-devolver').fill('20,00');
    await escolher(page.getByTestId('px-motivo-devolucao'), 'SL02');
    await page.getByTestId('px-confirmar-devolucao').click();
    await expect(page.getByTestId('px-mensagem')).toContainText('Devolução de R$ 20,00 feita');
    expect(api.corpos.at(-1)).toEqual({ retorno: 77, valor: 20, motivo: 'SL02' });
    await expect(page.getByTestId('px-excedente-77')).toHaveCount(0);
    await semViolacaoAxe(page, '/financeiro/receber/pix (cobranças)');
    expect(externas).toEqual([]);
  });
});
