// F3.8-05 (07-FIN linha 76): renegociação de títulos a receber e baixa pelo demonstrativo da operadora, pela tela.
// Quem lança escolhe o tipo de devedor (convênio, particular ou cliente), busca quem deve, vê TODOS os títulos em aberto
// dele com o saldo real das parcelas, marca, confere a prévia na hora (o saldo do servidor, não valor menos recebido),
// vê a recusa da regra antes de gravar, grava o acordo, abre o histórico e desfaz com motivo. Na tela de
// demonstrativos: escolhe o demonstrativo importado, confere a prévia por título, baixa de uma vez e desfaz a baixa com
// motivo. Axe em cada passo.
// As rotas `financeiro/receber/acordos` e `demonstrativos-importados` dependem do banco do cliente, que a fonte
// sintética do E2E não tem: aqui a API delas é simulada (page.route) com o mesmo formato e a tela é exercitada inteira,
// conferindo o corpo que ela envia. A ligação rota → banco é provada em `receber-acordos-rotas.int.spec.ts` e o que
// fica gravado em `renegociacao-demonstrativo.int.spec.ts`, os dois contra o MariaDB.
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const HOJE = new Date().toISOString().slice(0, 10);

async function entrar(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

const json = (r: Route, corpo: unknown, status = 200) =>
  r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(corpo) });

interface Enviado {
  readonly caminho: string;
  readonly corpo: Record<string, unknown>;
}

/** A API de acordos e de demonstrativos importados, simulada com estado: devolve o que a tela gravou. */
function simularApi(page: Page): Enviado[] {
  const enviados: Enviado[] = [];
  // O paciente deve dois títulos: um de 450,00 com 150,00 já recebidos (saldo real 300,00) e um de 250,00.
  const titulos = [
    {
      id: 71,
      numero: 'TR-000071',
      documento: 'E2E-71',
      emissao: '2025-01-10',
      valor: 450,
      recebido: 150,
      vencimento: '2025-02-10',
      saldo: 300,
      emEncontro: false,
      parcelas: [
        {
          parcela: 711,
          sequencia: 1,
          vencimento: '2025-02-10',
          valor: 450,
          saldo: 300,
          situacao: 'parcial',
          emEncontro: false,
        },
      ],
    },
    {
      id: 72,
      numero: 'TR-000072',
      documento: 'E2E-72',
      emissao: '2025-03-10',
      valor: 250,
      recebido: 0,
      vencimento: '2025-04-10',
      saldo: 250,
      emEncontro: false,
      parcelas: [
        {
          parcela: 721,
          sequencia: 1,
          vencimento: '2025-04-10',
          valor: 250,
          saldo: 250,
          situacao: 'aberta',
          emEncontro: false,
        },
      ],
    },
  ];
  let acordo: null | {
    situacao: string;
    titulos: number[];
    parcelas: number;
    total: number;
    observacao: string;
  } = null;
  const noAcordo = (id: number) => acordo?.situacao === 'efetivada' && acordo.titulos.includes(id);
  const abertos = () => titulos.filter((t) => !noAcordo(t.id));
  void page.route('**/api/financeiro/receber/acordos**', async (r) => {
    const req = r.request();
    const url = new URL(req.url());
    const caminho = url.pathname.replace('/api/financeiro/receber/acordos', '');
    if (req.method() === 'GET') {
      if (caminho === '/devedores') {
        const tipo = url.searchParams.get('tipo');
        const busca = (url.searchParams.get('busca') ?? '').toUpperCase();
        const saldo = abertos().reduce((x, t) => x + t.saldo, 0);
        if (tipo !== 'E' || saldo === 0 || !'PACIENTE SINTETICO E2E'.includes(busca)) return json(r, []);
        return json(r, [
          {
            id: 7,
            nome: 'PACIENTE SINTETICO E2E',
            titulos: abertos().length,
            saldo,
            maisAntigo: '2025-02-10',
          },
        ]);
      }
      if (caminho === '/titulos-abertos') return json(r, { devedor: 'paciente:7', titulos: abertos() });
      if (caminho === '/1')
        return json(r, {
          id: 1,
          originais: titulos
            .filter((t) => acordo?.titulos.includes(t.id))
            .map((t) => ({
              parcela: t.parcelas[0]?.parcela,
              titulo: t.id,
              numeroTitulo: t.numero,
              documento: t.documento,
              sequencia: 1,
              vencimento: t.vencimento,
              valor: t.valor,
              saldoLevado: t.saldo,
              juros: 0,
              multa: 0,
              desconto: 0,
              situacao: acordo?.situacao === 'efetivada' ? 'renegociada' : 'parcial',
            })),
          novas: Array.from({ length: acordo?.parcelas ?? 0 }, (_, i) => ({
            parcela: 900 + i,
            sequencia: i + 1,
            vencimento: HOJE,
            valor: (acordo?.total ?? 0) / (acordo?.parcelas ?? 1),
            recebido: 0,
            saldo: acordo?.situacao === 'efetivada' ? (acordo?.total ?? 0) / (acordo?.parcelas ?? 1) : 0,
            situacao: acordo?.situacao === 'efetivada' ? 'aberta' : 'cancelada',
          })),
        });
      return json(
        r,
        acordo
          ? [
              {
                id: 1,
                numero: 'RN-000001',
                em: new Date().toISOString(),
                situacao: acordo.situacao,
                devedor: 'PACIENTE SINTETICO E2E',
                responsavel: 'SINT.FIN.LANCA',
                valorOriginal: acordo.total,
                juros: 0,
                multa: 0,
                desconto: 0,
                valorRenegociado: acordo.total,
                parcelas: acordo.parcelas,
                primeiroVencimento: HOJE,
                observacao: acordo.observacao,
                titulo: 99,
                numeroTitulo: 'TR-000099',
                recebido: 0,
                parcelasOriginais: acordo.titulos.length,
              },
            ]
          : [],
      );
    }
    const corpo = (req.postDataJSON() ?? {}) as Record<string, unknown>;
    enviados.push({ caminho: `acordos${caminho}`, corpo });
    if (caminho === '') {
      const ids = corpo['titulos'] as number[];
      const total = titulos.filter((t) => ids.includes(t.id)).reduce((x, t) => x + t.saldo, 0);
      acordo = {
        situacao: 'efetivada',
        titulos: ids,
        parcelas: Number(corpo['quantidadeParcelas']),
        total,
        observacao: '',
      };
      return json(r, {
        mensagem: `Acordo RN-000001 gravado em ${acordo.parcelas} parcela(s).`,
        repetida: false,
      });
    }
    if (caminho === '/1/desfazer' && acordo) {
      acordo = { ...acordo, situacao: 'cancelada', observacao: `Desfeito: ${String(corpo['motivo'])}` };
      return json(r, { mensagem: 'Acordo RN-000001 desfeito.', repetida: false });
    }
    return json(r, { title: 'Não encontrado' }, 404);
  });

  let baixado = false;
  void page.route('**/api/financeiro/receber/demonstrativos-importados**', async (r) => {
    const req = r.request();
    const caminho = new URL(req.url()).pathname.replace(
      '/api/financeiro/receber/demonstrativos-importados',
      '',
    );
    if (req.method() === 'GET') {
      if (caminho === '')
        return json(r, [
          {
            id: 5,
            numero: 'DEM-E2E-1',
            emissao: HOJE,
            convenio: 'CONVENIO SINTETICO E2E',
            situacao: 'importado',
            informado: 1340.85,
            liberado: 1290.85,
            glosa: 50,
            linhas: 4,
            baixado,
          },
        ]);
      return json(
        r,
        baixado
          ? {
              id: 5,
              impedimento: {
                codigo: 'demonstrativo-ja-baixado',
                mensagem:
                  'Este demonstrativo já foi baixado nos títulos. Para refazer, desfaça a baixa dele antes (com o motivo).',
              },
              plano: null,
            }
          : {
              id: 5,
              impedimento: null,
              plano: {
                totalRecebido: 1250.85,
                totalGlosa: 50,
                linhasSemTitulo: 1,
                valorSemTitulo: 40,
                titulos: [
                  {
                    titulo: 81,
                    numero: 'TR-000081',
                    documento: 'E2E-81',
                    saldo: 300.3,
                    recebido: 250.3,
                    glosa: 50,
                    saldoRestante: 50,
                    quita: false,
                    itens: 2,
                  },
                  {
                    titulo: 82,
                    numero: 'TR-000082',
                    documento: 'E2E-82',
                    saldo: 1000.55,
                    recebido: 1000.55,
                    glosa: 0,
                    saldoRestante: 0,
                    quita: true,
                    itens: 1,
                  },
                ],
              },
            },
      );
    }
    const corpo = (req.postDataJSON() ?? {}) as Record<string, unknown>;
    enviados.push({ caminho: `demonstrativos-importados${caminho}`, corpo });
    baixado = caminho === '/5/baixa';
    return json(r, {
      mensagem: baixado ? 'Demonstrativo DEM-E2E-1 baixado.' : 'Baixa do demonstrativo DEM-E2E-1 desfeita.',
      repetida: false,
    });
  });
  return enviados;
}

test.describe('financeiro: renegociação a receber e baixa pelo demonstrativo @F3.8-05', () => {
  test.setTimeout(240_000);

  test('particular: devedor → títulos com saldo real → prévia → gravar → histórico → desfazer; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    const enviados = simularApi(page);
    await entrar(page, 'SINT.FIN.LANCA');
    await page.goto('/financeiro/receber/renegociacoes');
    await expect(page.getByTestId('tela-fin-renegociacoes')).toBeVisible();
    await expect(page.getByTestId('ac-formulario')).toBeVisible();
    await semViolacaoAxe(page, '/financeiro/receber/renegociacoes');

    // Cliente sem saldo em aberto: a tela diz; particular: o paciente aparece com a soma do que deve.
    await escolher(page.getByTestId('ac-tipo'), 'O');
    await expect(page.getByTestId('ac-sem-devedor')).toBeVisible();
    await escolher(page.getByTestId('ac-tipo'), 'E');
    await page.getByTestId('ac-busca').fill('nome que nao existe');
    await expect(page.getByTestId('ac-sem-devedor')).toBeVisible();
    await page.getByTestId('ac-busca').fill('sintetico');
    await escolher(page.getByTestId('ac-devedor'), '7');

    // Todos os títulos em aberto do devedor, com o saldo das parcelas (300,00 no título de 450,00 já recebido em parte).
    await expect(page.getByTestId('ac-titulos').locator('tbody tr')).toHaveCount(2);
    await expect(page.getByTestId('ac-resumo-devedor')).toContainText('550,00');
    await expect(page.getByTestId('ac-gravar')).toHaveCount(0);
    await page.getByTestId('ac-marcar-71').check();

    // A prévia aparece na hora, com o saldo do servidor: uma parcela de 300,00; com três, três de 100,00.
    await expect(page.getByTestId('ac-previa')).toBeVisible();
    await expect(page.getByTestId('ac-previa-total')).toContainText('300,00');
    await expect(page.getByTestId('ac-previa-parcelas').locator('tbody tr')).toHaveCount(1);
    await page.getByTestId('ac-parcelas').fill('3');
    await expect(page.getByTestId('ac-previa-parcelas').locator('tbody tr')).toHaveCount(3);
    await expect(page.getByTestId('ac-previa-parcelas').locator('tbody tr').first()).toContainText('100,00');
    await page.getByTestId('ac-marcar-todos').click();
    await expect(page.getByTestId('ac-previa-total')).toContainText('550,00');
    await page.getByTestId('ac-marcar-72').uncheck();
    await expect(page.getByTestId('ac-previa-total')).toContainText('300,00');
    await semViolacaoAxe(page, '/financeiro/receber/renegociacoes (prévia)');

    // A regra recusa antes de gravar: o desconto não pode zerar o acordo; corrigido, a prévia volta.
    await page.getByTestId('ac-desconto').fill('99999999');
    await expect(page.getByTestId('ac-impedimento')).toContainText('desconto');
    await expect(page.getByTestId('ac-previa')).toHaveCount(0);
    await expect(page.getByTestId('ac-gravar')).toBeDisabled();
    await page.getByTestId('ac-desconto').fill('');
    await expect(page.getByTestId('ac-impedimento')).toHaveCount(0);
    await page.getByTestId('ac-parcelas').fill('0');
    await expect(page.getByTestId('ac-impedimento')).toContainText('parcelas');
    await page.getByTestId('ac-parcelas').fill('3');
    await expect(page.getByTestId('ac-previa')).toBeVisible();

    // Gravar: a tela envia os títulos marcados e as condições; o acordo aparece na lista, em vigor.
    await page.getByTestId('ac-gravar').click();
    await expect(page.getByTestId('ac-mensagem')).toContainText('RN-000001');
    expect(enviados.at(-1)).toMatchObject({
      caminho: 'acordos',
      corpo: { titulos: [71], juros: 0, multa: 0, desconto: 0, quantidadeParcelas: 3 },
    });
    await expect(page.getByTestId('ac-lista').locator('tbody tr')).toHaveCount(1);
    await expect(page.getByTestId('ac-lista')).toContainText('Em vigor');

    // O histórico: a parcela que entrou com o saldo levado e as três parcelas novas.
    await page.getByTestId('ac-historico-1').click();
    await expect(page.getByTestId('ac-detalhe')).toContainText('E2E-71');
    await expect(page.getByTestId('ac-detalhe')).toContainText('Renegociada');
    await expect(page.getByTestId('ac-detalhe').locator('table').nth(1).locator('tbody tr')).toHaveCount(3);
    await semViolacaoAxe(page, '/financeiro/receber/renegociacoes (histórico)');

    // Desfazer com motivo: o acordo fica na lista como desfeito e o título volta a poder ser marcado.
    await page.getByTestId('ac-desfazer-1').click();
    await page.getByTestId('ac-motivo').fill('Paciente não assinou o termo');
    await page.getByTestId('ac-confirmar-desfazer').click();
    await expect(page.getByTestId('ac-mensagem')).toContainText('desfeito');
    expect(enviados.at(-1)).toEqual({
      caminho: 'acordos/1/desfazer',
      corpo: { motivo: 'Paciente não assinou o termo' },
    });
    await expect(page.getByTestId('ac-lista')).toContainText('Desfeita');
    await expect(page.getByTestId('ac-desfazer-1')).toHaveCount(0);
    expect(externas).toEqual([]);
  });

  test('demonstrativo importado: prévia por título → baixar de uma vez → desfazer a baixa com motivo; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    const enviados = simularApi(page);
    await entrar(page, 'SINT.FIN.LANCA');
    await page.goto('/financeiro/receber/demonstrativos');
    await expect(page.getByTestId('tela-fin-demonstrativos')).toBeVisible();
    await expect(page.getByTestId('fin-baixa-demonstrativo')).toBeVisible();

    // A prévia: o que cada título recebe, a glosa que fica em aberto e a linha sem título, de fora.
    await escolher(page.getByTestId('bxd-demonstrativo'), '5');
    await expect(page.getByTestId('bxd-previa').locator('tbody tr')).toHaveCount(2);
    await expect(page.getByTestId('bxd-totais')).toContainText('1.250,85');
    await expect(page.getByTestId('bxd-sem-titulo')).toContainText('40,00');
    await expect(page.getByTestId('bxd-baixar')).toBeDisabled();
    await semViolacaoAxe(page, '/financeiro/receber/demonstrativos (prévia da baixa)');

    // Um botão baixa tudo, na conta e na data escolhidas.
    await escolher(page.getByTestId('bxd-conta'), { indice: 1 });
    await page.getByTestId('bxd-baixar').click();
    await expect(page.getByTestId('bxd-mensagem')).toContainText('baixado');
    expect(enviados.at(-1)).toMatchObject({
      caminho: 'demonstrativos-importados/5/baixa',
      corpo: { dataRecebimento: HOJE },
    });
    expect(Number(enviados.at(-1)?.corpo['conta'])).toBeGreaterThan(0);

    // Já baixado: a tela mostra o impedimento e o caminho de desfazer, que exige o motivo.
    await expect(page.getByTestId('bxd-impedimento')).toContainText('já foi baixado');
    await expect(page.getByTestId('bxd-desfazer')).toBeVisible();
    await expect(page.getByTestId('bxd-confirmar-desfazer')).toBeDisabled();
    await semViolacaoAxe(page, '/financeiro/receber/demonstrativos (desfazer a baixa)');
    await page.getByTestId('bxd-motivo').fill('Crédito lançado na conta errada');
    await page.getByTestId('bxd-confirmar-desfazer').click();
    await expect(page.getByTestId('bxd-mensagem')).toContainText('desfeita');
    expect(enviados.at(-1)).toEqual({
      caminho: 'demonstrativos-importados/5/desfazer-baixa',
      corpo: { motivo: 'Crédito lançado na conta errada' },
    });
    // Desfeita, a prévia volta e o demonstrativo pode ser baixado de novo.
    await expect(page.getByTestId('bxd-desfazer')).toHaveCount(0);
    await expect(page.getByTestId('bxd-previa')).toBeVisible();
    expect(externas).toEqual([]);
  });
});
