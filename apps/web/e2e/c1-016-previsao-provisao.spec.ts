// F8 (07-FIN linha 68): a tela da previsão e provisão de pagamentos. As leituras e gravações de
// `/api/financeiro/compensacao` só existem no banco do cliente (na fonte sintética respondem 503), então este E2E
// simula as rotas com um estado em memória que segue a regra do servidor (a receita se realiza pelo título a receber,
// a despesa pelo a pagar; motivo com 5 caracteres ou mais). O que fica no banco é provado no contrato de efeito
// `compensacao-previsao-receita.int.spec.ts`; aqui se prova o fluxo da tela: o previsto × realizado do período com os
// totais, realizar a receita escolhendo o título a receber na lista (sem digitar número), cancelar a ocorrência com o
// motivo conferido enquanto se digita (o motivo fica na linha), encerrar a previsão, gravar uma nova previsão com o fim
// conferido na hora, presa ao credor escolhido na lista (o corpo leva o credor, o centro de custo e a conta bancária; na
// receita, a fonte pagadora), as provisões do passivo (liquidar escolhendo o título a pagar do mesmo credor na lista,
// reverter com o valor conferido contra o saldo e o motivo, e a nova provisão com o profissional exigido no honorário na
// hora) e o item no menu. Axe em cada passo. Massa SINTÉTICA.
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
  'financeiro.provisionarPassivo',
  'financeiro.liquidarProvisaoPassivo',
  'financeiro.reverterProvisaoPassivo',
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
    const provisoes = [
      {
        id: 1,
        tipo: 'honorario_medico',
        competencia: '2026-11-01',
        descricao: 'HONORARIO SINTETICO',
        conta: '2.9.9.207 PASSIVO SINTETICO',
        provisionado: 4000,
        baixado: 1500,
        revertido: 0,
        saldo: 2500,
        situacao: 'parcial',
      },
    ];
    const titulosPagar = [
      { id: 601, lado: 'pagar', numero: 'TP-SINT-601', data: '', valor: 2400 },
      { id: 602, lado: 'pagar', numero: 'TP-SINT-602', data: '', valor: 900 },
    ];

    // A leitura pode ser cortada por uma navegação (entrar, goto) com a resposta ainda a caminho: aí a resposta é
    // descartada e não há o que cumprir.
    await page.route('**/api/financeiro/gravacao', async (rota) => {
      let corpo: { operacoes: Record<string, unknown> };
      try {
        corpo = (await (await rota.fetch()).json()) as { operacoes: Record<string, unknown> };
      } catch {
        return rota.abort().catch(() => undefined);
      }
      for (const op of OPERACOES) corpo.operacoes[op] = { ligada: true, motivo: null };
      return json(rota, corpo).catch(() => undefined);
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
        if (caminho === '/provisoes') return json(rota, provisoes);
        if (caminho === '/provisoes/titulos') {
          const p = provisoes.find((x) => x.id === Number(url.searchParams.get('provisao')));
          return json(rota, p && p.saldo > 0 ? titulosPagar : []);
        }
        if (caminho === '/apoios')
          return json(rota, {
            naturezas: [
              { id: 71, rotulo: '9207.1.1 DESPESA SINTETICA', tipo: 'despesa' },
              { id: 72, rotulo: '9207.2.1 RECEITA SINTETICA', tipo: 'receita' },
            ],
            contas: [{ id: 91, rotulo: '2.9.9.207 PASSIVO SINTETICO' }],
            fornecedores: [{ id: 81, rotulo: 'FORNECEDOR SINTETICO' }],
            fontesPagadoras: [{ id: 82, rotulo: 'OPERADORA SINTETICA' }],
            centrosCusto: [{ id: 83, rotulo: 'CENTRO SINTETICO' }],
            contasBancarias: [{ id: 84, rotulo: 'CONTA SINTETICA' }],
            profissionais: [{ id: 85, rotulo: 'PROFISSIONAL SINTETICO' }],
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
      if (caminho === '/provisoes/liquidar') {
        const p = provisoes.find((x) => x.id === corpo['provisao']);
        const t = titulosPagar.find((x) => x.id === corpo['tituloPagar']);
        if (!p || !t) return recusa(rota, 'titulo-inexistente', 'O título a pagar não existe.');
        const consumo = Math.min(p.saldo, t.valor);
        Object.assign(p, {
          baixado: p.baixado + consumo,
          saldo: p.saldo - consumo,
          situacao: p.saldo - consumo > 0 ? 'parcial' : 'liquidada',
        });
        titulosPagar.splice(titulosPagar.indexOf(t), 1);
        return ok('Provisão liquidada pelo título.');
      }
      if (caminho === '/provisoes/reverter') {
        const p = provisoes.find((x) => x.id === corpo['provisao']);
        const v = Number(corpo['valor']);
        if (!p || v > p.saldo) return recusa(rota, 'valor-acima-do-saldo', 'A reversão vai até o saldo.');
        Object.assign(p, {
          revertido: p.revertido + v,
          saldo: p.saldo - v,
          situacao: p.saldo - v > 0 ? 'parcial' : 'revertida',
        });
        return ok('Reversão gravada; o ajuste fica no histórico da provisão.');
      }
      if (caminho === '/provisoes') {
        if (corpo['tipo'] === 'honorario_medico' && !corpo['profissional'])
          return recusa(rota, 'profissional-obrigatorio', 'O honorário provisionado exige o profissional.');
        provisoes.unshift({
          id: ++proximo,
          tipo: String(corpo['tipo']),
          competencia: String(corpo['competencia']),
          descricao: String(corpo['descricao']),
          conta: '2.9.9.207 PASSIVO SINTETICO',
          provisionado: Number(corpo['valor']),
          baixado: 0,
          revertido: 0,
          saldo: Number(corpo['valor']),
          situacao: 'provisionada',
        });
        return ok('Provisão gravada.');
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
    titulosPagar.forEach((t) => (t.data = dia('02')));
    provisoes[0]!.competencia = `${mes}-01`;

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
    // Na despesa, o campo é o credor; na receita, a fonte pagadora (a troca do tipo limpa a escolha).
    await escolher(page.getByTestId('pp-tipo'), { rotulo: 'Receita' });
    await expect(page.getByTestId('pp-nova')).toContainText('Fonte pagadora');
    await escolher(page.getByTestId('pp-tipo'), { rotulo: 'Despesa' });
    await escolher(page.getByTestId('pp-natureza'), { rotulo: /DESPESA SINTETICA/ });
    await expect(page.getByTestId('pp-nova')).toContainText('Credor');
    await escolher(page.getByTestId('pp-credor'), { rotulo: 'FORNECEDOR SINTETICO' });
    await escolher(page.getByTestId('pp-centro'), { rotulo: 'CENTRO SINTETICO' });
    await escolher(page.getByTestId('pp-conta-bancaria'), { rotulo: 'CONTA SINTETICA' });
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
        fornecedor: 81,
        centroCusto: 83,
        contaBancaria: 84,
      },
    });
    await expect(page.getByTestId('pp-lista')).toContainText('ALUGUEL SINTETICO');

    // Liquidar a provisão: a lista traz os títulos a pagar do mesmo credor, o mais próximo do saldo já escolhido.
    await page.getByTestId('pp-liquidar-1').click();
    await expect(page.getByTestId('pp-acao-provisao')).toContainText('2.500,00');
    await expect(page.getByTestId('pp-confirmar-provisao')).toBeEnabled();
    await semViolacaoAxe(page, '/financeiro/tesouraria/previsao (liquidar provisão)');
    await page.getByTestId('pp-confirmar-provisao').click();
    await expect(page.getByTestId('fat-mensagem')).toContainText('Provisão liquidada');
    expect(corpos.at(-1)).toEqual({
      caminho: '/provisoes/liquidar',
      corpo: { provisao: 1, tituloPagar: 601 },
    });
    await expect(page.getByTestId('pp-provisao-1')).toContainText('100,00');
    await expect(page.getByTestId('pp-provisao-situacao-1')).toContainText('Liquidada em parte');

    // Reverter: o valor acima do saldo e o motivo curto deixam o botão desligado; com tudo certo, o saldo zera.
    await page.getByTestId('pp-reverter-1').click();
    await page.getByTestId('pp-rev-valor').fill('150');
    await expect(page.getByTestId('pp-rev-valor-erro')).toBeVisible();
    await page.getByTestId('pp-rev-motivo').fill('glosa');
    await expect(page.getByTestId('pp-confirmar-provisao')).toBeDisabled();
    await page.getByTestId('pp-rev-valor').fill('100');
    await expect(page.getByTestId('pp-rev-valor-erro')).toHaveCount(0);
    await page.getByTestId('pp-rev-motivo').fill('glosa da conta');
    await expect(page.getByTestId('pp-confirmar-provisao')).toBeEnabled();
    await semViolacaoAxe(page, '/financeiro/tesouraria/previsao (reverter provisão)');
    await page.getByTestId('pp-confirmar-provisao').click();
    await expect(page.getByTestId('fat-mensagem')).toContainText('Reversão gravada');
    expect(corpos.at(-1)).toEqual({
      caminho: '/provisoes/reverter',
      corpo: { provisao: 1, valor: 100, motivo: 'glosa da conta', data: apoio.hoje },
    });
    await expect(page.getByTestId('pp-provisao-situacao-1')).toContainText('Revertida');
    await expect(page.getByTestId('pp-liquidar-1')).toHaveCount(0);

    // Nova provisão: o honorário sem profissional é apontado na hora; com o profissional, grava.
    await page.getByTestId('pp-prov-descricao').fill('HONORARIO NOVO SINTETICO');
    await escolher(page.getByTestId('pp-prov-conta'), { rotulo: /PASSIVO SINTETICO/ });
    await page.getByTestId('pp-prov-valor').fill('3000');
    await expect(page.getByTestId('pp-prov-profissional-falta')).toBeVisible();
    await expect(page.getByTestId('pp-gravar-provisao')).toBeDisabled();
    await escolher(page.getByTestId('pp-prov-profissional'), { rotulo: 'PROFISSIONAL SINTETICO' });
    await expect(page.getByTestId('pp-prov-profissional-falta')).toHaveCount(0);
    await semViolacaoAxe(page, '/financeiro/tesouraria/previsao (nova provisão)');
    await page.getByTestId('pp-gravar-provisao').click();
    await expect(page.getByTestId('fat-mensagem')).toContainText('Provisão gravada');
    expect(corpos.at(-1)).toEqual({
      caminho: '/provisoes',
      corpo: {
        tipo: 'honorario_medico',
        competencia: `${mes}-01`,
        descricao: 'HONORARIO NOVO SINTETICO',
        contaContabil: 91,
        valor: 3000,
        profissional: 85,
      },
    });
    await expect(page.getByTestId('pp-provisoes')).toContainText('HONORARIO NOVO SINTETICO');

    // O item está no menu.
    await page.goto('/inicio');
    await (await itemDoMenu(page, 'Previsão e provisão')).click();
    await expect(page).toHaveURL(/\/financeiro\/tesouraria\/previsao/);
    await expect(page.getByTestId('tela-fin-previsao')).toBeVisible();
    expect(externas).toEqual([]);
  });
});
