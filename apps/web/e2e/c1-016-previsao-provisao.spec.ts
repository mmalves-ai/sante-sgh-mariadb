// F8 (07-FIN linha 68): a tela da previsão e provisão de pagamentos. As leituras e gravações de
// `/api/financeiro/compensacao` só existem no banco do cliente (na fonte sintética respondem 503), então este E2E
// simula as rotas com um estado em memória que segue a regra do servidor (a receita se realiza pelo título a receber,
// a despesa pelo a pagar; motivo com 5 caracteres ou mais). O que fica no banco é provado no contrato de efeito
// `compensacao-previsao-receita.int.spec.ts`; aqui se prova o fluxo da tela: o previsto × realizado do período com os
// totais, realizar a receita escolhendo o título a receber na lista (sem digitar número), cancelar a ocorrência com o
// motivo conferido enquanto se digita (o motivo fica na linha), encerrar a previsão, gravar uma nova previsão com o fim
// conferido na hora e o item no menu. Axe em cada passo. Massa SINTÉTICA.
import { expect, type Page, type Route, test } from '@playwright/test';
import { escolher } from './combos.js';
import { itemDoMenu, semViolacaoAxe, vigiarExternas } from './ajuda.js';

const SENHA = 'Sintetico#2026';
const OPERACOES = [
  'financeiro.criarPrevisaoFinanceira',
  'financeiro.realizarPrevisaoFinanceira',
  'financeiro.estenderPrevisaoFinanceira',
  'financeiro.cancelarOcorrenciaPrevisao',
  'financeiro.encerrarPrevisaoFinanceira',
] as const;

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
const recusa = (rota: Route, codigo: string, detail: string) =>
  rota.fulfill({
    status: 409,
    contentType: 'application/problem+json',
    body: JSON.stringify({ type: `urn:sgh:erro:${codigo}`, title: detail, status: 409, detail, codigo }),
  });

interface Ocorrencia {
  id: number;
  previsao: number;
  previsaoAtiva: boolean;
  descricao: string;
  tipo: 'despesa' | 'receita';
  competencia: string;
  dataEsperada: string;
  previsto: number;
  situacao: 'aberta' | 'realizada' | 'cancelada';
  realizado: number | null;
  diferenca: number | null;
  titulo: string | null;
  motivoCancelamento: string | null;
}

test.describe('financeiro: previsão e provisão @C1-016', () => {
  test.setTimeout(180_000);

  test('previsto × realizado, realiza a receita pelo título a receber, cancela com motivo, encerra e cria; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    const corpos: { caminho: string; corpo: Record<string, unknown> }[] = [];
    const ocorrencias: Ocorrencia[] = [];
    const titulosReceber = [
      { id: 501, lado: 'receber', numero: 'TR-SINT-501', data: '', valor: 1900 },
      { id: 502, lado: 'receber', numero: 'TR-SINT-502', data: '', valor: 2500 },
    ];
    let proximo = 10;

    await page.route('**/api/financeiro/gravacao', async (rota) => {
      const r = await rota.fetch();
      const corpo = (await r.json()) as { operacoes: Record<string, unknown> };
      for (const op of OPERACOES) corpo.operacoes[op] = { ligada: true, motivo: null };
      return json(rota, corpo);
    });
    await page.route('**/api/financeiro/compensacao/**', async (rota) => {
      const req = rota.request();
      const url = new URL(req.url());
      const caminho = url.pathname.replace(/^.*\/compensacao/, '');
      if (req.method() === 'GET') {
        if (caminho === '/previsoes') {
          const de = url.searchParams.get('de') ?? '';
          const ate = url.searchParams.get('ate') ?? '';
          return json(
            rota,
            ocorrencias.filter((o) => o.dataEsperada >= de && o.dataEsperada <= ate),
          );
        }
        if (caminho === '/previsoes/titulos') {
          const o = ocorrencias.find((x) => x.id === Number(url.searchParams.get('ocorrencia')));
          return json(rota, o?.tipo === 'receita' ? titulosReceber : []);
        }
        if (caminho === '/provisoes')
          return json(rota, [
            {
              id: 1,
              tipo: 'honorario_medico',
              competencia: ocorrencias[0]?.competencia ?? '2026-11-01',
              descricao: 'HONORARIO SINTETICO',
              conta: '2.9.9.207 PASSIVO SINTETICO',
              provisionado: 4000,
              baixado: 1500,
              revertido: 0,
              saldo: 2500,
              situacao: 'parcial',
            },
          ]);
        if (caminho === '/apoios')
          return json(rota, {
            naturezas: [
              { id: 71, rotulo: '9207.1.1 DESPESA SINTETICA', tipo: 'despesa' },
              { id: 72, rotulo: '9207.2.1 RECEITA SINTETICA', tipo: 'receita' },
            ],
            contas: [],
          });
        return json(rota, []);
      }
      const corpo = req.postDataJSON() as Record<string, unknown>;
      corpos.push({ caminho, corpo });
      const ok = (mensagem: string) => json(rota, { mensagem, repetida: false, ids: {}, avisos: [] });
      const o = ocorrencias.find((x) => x.id === Number(corpo['ocorrencia']));
      if (caminho === '/previsoes/realizar') {
        if (!o || o.situacao !== 'aberta')
          return recusa(rota, 'previsao-fechada', 'A ocorrência já foi realizada.');
        if (o.tipo === 'receita' && !corpo['tituloReceber'])
          return recusa(
            rota,
            'titulo-de-outro-lado',
            'A previsão de receita se realiza pelo título a receber.',
          );
        const t = titulosReceber.find((x) => x.id === Number(corpo['tituloReceber']));
        Object.assign(o, {
          situacao: 'realizada',
          realizado: t?.valor ?? 0,
          diferenca: (t?.valor ?? 0) - o.previsto,
          titulo: t?.numero ?? null,
        });
        return ok('Ocorrência realizada pelo título; a diferença ficou registrada.');
      }
      if (caminho === '/previsoes/ocorrencias/cancelar') {
        if (String(corpo['motivo'] ?? '').trim().length < 5)
          return recusa(rota, 'motivo-obrigatorio', 'Diga o motivo.');
        Object.assign(o ?? {}, { situacao: 'cancelada', motivoCancelamento: corpo['motivo'] });
        return ok('Ocorrência prevista cancelada; a linha fica no histórico.');
      }
      if (caminho === '/previsoes/encerrar') {
        for (const x of ocorrencias)
          if (x.previsao === corpo['previsao']) {
            x.previsaoAtiva = false;
            if (x.situacao === 'aberta' && x.dataEsperada > String(corpo['data']))
              Object.assign(x, {
                situacao: 'cancelada',
                motivoCancelamento: `Encerramento da previsão em ${corpo['data']}: ${corpo['motivo']}`,
              });
          }
        return ok('Previsão encerrada; as ocorrências abertas depois da data foram canceladas.');
      }
      if (caminho === '/previsoes') {
        const inicio = String(corpo['dataInicio']);
        const previsao = ++proximo;
        ocorrencias.push({
          id: ++proximo,
          previsao,
          previsaoAtiva: true,
          descricao: String(corpo['descricao']),
          tipo: corpo['tipo'] as 'despesa' | 'receita',
          competencia: `${inicio.slice(0, 7)}-01`,
          dataEsperada: inicio,
          previsto: Number(corpo['valor']),
          situacao: 'aberta',
          realizado: null,
          diferenca: null,
          titulo: null,
          motivoCancelamento: null,
        });
        return ok('Previsão gravada com as ocorrências.');
      }
      return ok('Previsão estendida por mais 12 meses.');
    });

    await entrar(page, 'SINT.FIN.LANCA');
    const apoio = (await (await page.request.get('/api/financeiro/apoio')).json()) as { hoje: string };
    const mes = apoio.hoje.slice(0, 7);
    const dia = (d: string) => `${mes}-${d}`;
    for (const [i, d] of ['05', '15', '25'].entries())
      ocorrencias.push({
        id: i + 1,
        previsao: i === 0 ? 1 : 2,
        previsaoAtiva: true,
        descricao: i === 0 ? 'REPASSE SINTETICO' : 'MANUTENCAO SINTETICA',
        tipo: i === 0 ? 'receita' : 'despesa',
        competencia: `${mes}-01`,
        dataEsperada: dia(d),
        previsto: 2000,
        situacao: 'aberta',
        realizado: null,
        diferenca: null,
        titulo: null,
        motivoCancelamento: null,
      });
    titulosReceber.forEach((t) => (t.data = dia('01')));

    await page.goto('/financeiro/tesouraria/previsao');
    await expect(page.getByTestId('tela-fin-previsao')).toBeVisible();
    await expect(page.getByTestId('pp-lista').locator('tbody tr')).toHaveCount(3);
    await expect(page.getByTestId('pp-totais')).toContainText('6.000,00');
    await expect(page.getByTestId('pp-provisoes')).toContainText('2.500,00');
    await semViolacaoAxe(page, '/financeiro/tesouraria/previsao (período)');

    // Realizar a receita: a lista traz os títulos a receber, o de valor mais próximo já escolhido.
    await page.getByTestId('pp-realizar-1').click();
    await expect(page.getByTestId('pp-acao')).toBeVisible();
    await expect(page.getByTestId('pp-confirmar')).toBeEnabled();
    await semViolacaoAxe(page, '/financeiro/tesouraria/previsao (realizar)');
    await page.getByTestId('pp-confirmar').click();
    await expect(page.getByTestId('fat-mensagem')).toContainText('Ocorrência realizada');
    expect(corpos.at(-1)).toEqual({
      caminho: '/previsoes/realizar',
      corpo: { ocorrencia: 1, tituloReceber: 501 },
    });
    await expect(page.getByTestId('pp-situacao-1')).toContainText('Realizada');
    await expect(page.getByTestId('pp-situacao-1')).toContainText('TR-SINT-501');
    await expect(page.getByTestId('pp-linha-1')).toContainText('100,00');
    await expect(page.getByTestId('pp-realizar-1')).toHaveCount(0);

    // Cancelar a ocorrência: o motivo curto deixa o botão desligado; com o motivo, a linha mostra o motivo.
    await page.getByTestId('pp-cancelar-2').click();
    await page.getByTestId('pp-motivo').fill('erro');
    await expect(page.getByTestId('pp-confirmar')).toBeDisabled();
    await expect(page.getByTestId('pp-acao')).toContainText('Faltam 1 caracteres');
    await page.getByTestId('pp-motivo').fill('manutenção suspensa no mês');
    await expect(page.getByTestId('pp-confirmar')).toBeEnabled();
    await semViolacaoAxe(page, '/financeiro/tesouraria/previsao (cancelar ocorrência)');
    await page.getByTestId('pp-confirmar').click();
    await expect(page.getByTestId('fat-mensagem')).toContainText('Ocorrência prevista cancelada');
    expect(corpos.at(-1)).toEqual({
      caminho: '/previsoes/ocorrencias/cancelar',
      corpo: { ocorrencia: 2, motivo: 'manutenção suspensa no mês' },
    });
    await expect(page.getByTestId('pp-situacao-2')).toContainText('manutenção suspensa no mês');

    // Encerrar a previsão: a ocorrência adiante fica cancelada com o motivo do encerramento.
    await page.getByTestId('pp-encerrar-3').click();
    await page.getByTestId('pp-data-encerramento').fill(dia('20'));
    await page.getByTestId('pp-motivo').fill('contrato encerrado');
    await page.getByTestId('pp-confirmar').click();
    await expect(page.getByTestId('fat-mensagem')).toContainText('Previsão encerrada');
    expect(corpos.at(-1)).toEqual({
      caminho: '/previsoes/encerrar',
      corpo: { previsao: 2, data: dia('20'), motivo: 'contrato encerrado' },
    });
    await expect(page.getByTestId('pp-situacao-3')).toContainText('Encerramento da previsão');
    await expect(page.getByTestId('pp-encerrar-3')).toHaveCount(0);

    // Nova previsão: o fim antes do início é apontado na hora e o botão só liga com tudo certo.
    await page.getByTestId('pp-descricao').fill('ALUGUEL SINTETICO');
    await escolher(page.getByTestId('pp-natureza'), { rotulo: /DESPESA SINTETICA/ });
    await page.getByTestId('pp-valor').fill('1500');
    await page.getByTestId('pp-inicio').fill(dia('10'));
    await page.getByTestId('pp-fim').fill(dia('01'));
    await expect(page.getByTestId('pp-fim-erro')).toBeVisible();
    await expect(page.getByTestId('pp-gravar')).toBeDisabled();
    await page.getByTestId('pp-fim').fill(dia('28'));
    await expect(page.getByTestId('pp-fim-erro')).toHaveCount(0);
    await semViolacaoAxe(page, '/financeiro/tesouraria/previsao (nova previsão)');
    await page.getByTestId('pp-gravar').click();
    await expect(page.getByTestId('fat-mensagem')).toContainText('Previsão gravada');
    expect(corpos.at(-1)).toEqual({
      caminho: '/previsoes',
      corpo: {
        descricao: 'ALUGUEL SINTETICO',
        tipo: 'despesa',
        natureza: 71,
        valor: 1500,
        periodicidade: 'mensal',
        dataInicio: dia('10'),
        dataFim: dia('28'),
        ajuste: 'postergar',
      },
    });
    await expect(page.getByTestId('pp-lista')).toContainText('ALUGUEL SINTETICO');

    // O item está no menu.
    await page.goto('/inicio');
    await (await itemDoMenu(page, 'Previsão e provisão')).click();
    await expect(page).toHaveURL(/\/financeiro\/tesouraria\/previsao/);
    await expect(page.getByTestId('tela-fin-previsao')).toBeVisible();
    expect(externas).toEqual([]);
  });
});
