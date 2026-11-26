// C2-075 (06-FAT linha 20, F3.7): pacote na conta, 3ª volta, pelo caminho da tela.
// - Cadastro: na tela de pacotes, "Composição e versões" abre na mesma tela as versões (a nova é conferida na hora pela
//   mesma regra do servidor: começa depois da última) e a composição (exceções, tetos e diárias por acomodação, com a
//   linha incompleta recusada na hora), gravada num envio só; item, grupo e acomodação escolhidos pelo nome (o item pela
//   busca de código ou descrição), e o lançamento automático do pacote ligado no mesmo envio.
// - Conta: "Reclassificar itens" vai à rota que reconhece o pacote de lançamento automático e reclassifica os itens; a
//   diária além das incluídas já lançada pela apuração aparece no alerta.
// As rotas exigem o banco próprio; o E2E roda com a fonte sintética, e as respostas destas rotas são simuladas com massa
// SINTÉTICA. Quem cadastra o pacote e reclassifica a conta é o faturista das contas (SINT.CONTAS: faturamento.pacote.* e
// faturamento.item.lancar). O efeito no banco (pacote automático, limite partido, item lançado depois) está no contrato
// de efeito apps/api/src/modulos/faturamento/conta-ajustes-propria.int.spec.ts.
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const CONTA = 7306;
const PACOTE = 61;

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

async function simular(page: Page, enviados: Record<string, unknown>[]): Promise<void> {
  await page.route('**/api/faturamento/pacotes', (rota) =>
    rota.request().method() === 'GET'
      ? json(rota, {
          pacotes: [
            {
              id: 9061,
              pacoteId: PACOTE,
              convenio: 0,
              codigo: 775,
              nome: 'PACOTE SINTETICO C2075',
              valor: 900,
              inicio: '2025-01-01',
              fim: null,
              ativo: true,
              itens: [{ codigo: 1001, quantidade: 2 }],
            },
          ],
          orcamentosPadrao: [],
          orcamentoAntigo: 0,
        })
      : rota.fallback(),
  );
  await page.route(`**/api/faturamento/pacotes/${PACOTE}/composicao`, (rota) => {
    if (rota.request().method() === 'POST') {
      enviados.push({ composicao: rota.request().postDataJSON() });
      return json(rota, { id: PACOTE, excecoes: 1, tetos: 1, diarias: 1 });
    }
    return json(rota, {
      id: PACOTE,
      codigo: 'C2075PC',
      descricao: 'PACOTE SINTETICO C2075',
      valor: 900,
      quantidadeDiarias: 2,
      situacao: 'ativo',
      lancamentoAutomatico: false,
      versoes: [
        {
          id: 1,
          numero: 1,
          vigenciaInicio: '2025-01-01',
          vigenciaFim: null,
          valor: 900,
          quantidadeDiarias: 2,
        },
      ],
      inclusoes: [{ itemId: 1001, grupoId: null, setorId: null, quantidadeLimite: 2 }],
      excecoes: [],
      tetos: [],
      diarias: [],
      opcoes: {
        grupos: [{ id: 31, codigo: 'G31', descricao: 'GRUPO SINTETICO' }],
        setores: [],
        acomodacoes: [
          { id: 4, codigo: 'ENF', descricao: 'ENFERMARIA SINTETICA' },
          { id: 5, codigo: 'APT', descricao: 'APARTAMENTO SINTETICO' },
        ],
        itens: [{ id: 1001, codigo: '1001', descricao: 'ITEM SINTETICO INCLUSO' }],
      },
    });
  });
  await page.route('**/api/faturamento/composicao-pacote/itens?**', (rota) =>
    json(rota, [{ id: 1002, codigo: '1002', descricao: 'ITEM SINTETICO EXCECAO' }]),
  );
  await page.route(`**/api/faturamento/pacotes/${PACOTE}/versoes`, (rota) => {
    enviados.push({ versao: rota.request().postDataJSON() });
    return json(rota, { id: 2 }, 201);
  });
  await page.route(`**/api/faturamento/contas/${CONTA}/ajustes`, (rota) =>
    json(rota, {
      contaId: CONTA,
      situacao: 'aberta',
      editavel: true,
      valores: { itens: 650, acrescimo: 0, desconto: 0, total: 650 },
      reservado: { desconto: 0, acrescimo: 0 },
      ajustes: [],
      motivos: [],
      horario: [],
    }),
  );
  await page.route(`**/api/faturamento/contas/${CONTA}/pacotes`, (rota) =>
    json(rota, {
      contaId: CONTA,
      situacao: 'aberta',
      editavel: true,
      dias: 5,
      aplicados: [
        {
          id: 81,
          versao: 1,
          pacoteId: PACOTE,
          pacote: 'C2075PC - PACOTE SINTETICO C2075',
          numeroVersao: 1,
          valorCobrado: 500,
          ativo: true,
          descaracterizacao: null,
          inclusos: 1,
          aParte: 2,
          alertas: [
            {
              tipo: 'diarias',
              descaracteriza: false,
              mensagem: '3 diária(s) além das 2 incluídas: já lançada(s) à parte a 150.00 cada.',
            },
          ],
        },
      ],
      candidatos: [],
      motivos: [],
    }),
  );
  await page.route(`**/api/faturamento/contas/${CONTA}/pacotes/reclassificacao`, (rota) => {
    enviados.push({ reclassificacao: rota.request().postDataJSON() });
    return json(rota, { id: CONTA, aplicados: 0, reclassificados: 1, partidos: 1 });
  });
}

test.describe('pacote: composição, versões e reclassificação @C2-075', () => {
  test.setTimeout(180_000);

  test('versão conferida na hora; composição com linha incompleta recusada; gravar num envio; reclassificar a conta; axe', async ({
    page,
  }) => {
    const enviados: Record<string, unknown>[] = [];
    await entrar(page, 'SINT.CONTAS');
    await simular(page, enviados);

    await page.goto('/faturamento/pacotes');
    await expect(page.getByTestId('tela-faturamento-pacotes')).toBeVisible();
    await page.getByTestId('pac-composicao-9061').click();
    await expect(page.getByTestId('pacote-composicao')).toBeVisible();
    await expect(page.getByTestId('pc-versoes')).toContainText('2025-01-01');
    await semViolacaoAxe(page, '/faturamento/pacotes (composição)');

    // Nova versão: começar antes da última é recusado na hora; depois, sai com o valor e as diárias.
    await page.getByTestId('pc-ini').fill('2024-12-01');
    await expect(page.getByTestId('pc-erro-ini')).toContainText('começa depois de 2025-01-01');
    await expect(page.getByTestId('pc-criar-versao')).toBeDisabled();
    await page.getByTestId('pc-ini').fill('2026-02-01');
    await page.getByTestId('pc-valor').fill('950');
    await page.getByTestId('pc-diarias').fill('3');
    await expect(page.getByTestId('pc-erro-ini')).toHaveCount(0);
    await page.getByTestId('pc-criar-versao').click();
    await expect.poll(() => enviados.find((e) => 'versao' in e)).toBeTruthy();
    expect(enviados.find((e) => 'versao' in e)?.['versao']).toEqual({
      vigenciaInicio: '2026-02-01',
      valor: 950,
      quantidadeDiarias: 3,
    });

    // Composição: exceção sem item nem grupo e teto sem limite são recusados na hora.
    await page.getByTestId('pc-mais-excecao').click();
    await expect(page.getByTestId('pc-erro-excecao-0')).toContainText('item ou o grupo');
    await page.getByTestId('pc-mais-teto').click();
    await expect(page.getByTestId('pc-erro-teto-0')).toContainText('ao menos um teto');
    await expect(page.getByTestId('pc-gravar')).toBeDisabled();
    await page.getByTestId('pc-busca-item').fill('1002');
    await expect(page.getByTestId('pc-achados')).toBeVisible();
    await escolher(page.getByTestId('pc-ex-item-0'), '1002');
    await escolher(page.getByTestId('pc-ex-efeito-0'), 'descaracteriza');
    await page.getByTestId('pc-te-dias-0').fill('7');
    await page.getByTestId('pc-mais-diaria').click();
    await expect(page.getByTestId('pc-erro-diaria-0')).toContainText('Escolha a acomodação');
    await escolher(page.getByTestId('pc-di-acom-0'), '4');
    await page.getByTestId('pc-di-qtd-0').fill('2');
    await page.getByTestId('pc-lancamento-automatico').check();
    await page.getByTestId('pc-gravar').click();
    await expect.poll(() => enviados.find((e) => 'composicao' in e)).toBeTruthy();
    expect(enviados.find((e) => 'composicao' in e)?.['composicao']).toMatchObject({
      lancamentoAutomatico: true,
      excecoes: [{ itemId: 1002, efeito: 'descaracteriza' }],
      tetos: [{ diasTeto: 7, descaracteriza: true }],
      diarias: [{ categoriaAcomodacaoId: 4, quantidadeDiarias: 2 }],
    });

    // Na conta: o alerta mostra a diária adicional já lançada; reclassificar vai à rota de reconhecimento.
    await page.goto(`/faturamento/contas/${CONTA}/ajustes`);
    await expect(page.getByTestId('aj-alertas')).toContainText('já lançada(s) à parte');
    await page.getByTestId('aj-reclassificar').click();
    await expect.poll(() => enviados.find((e) => 'reclassificacao' in e)).toBeTruthy();
  });
});
