// F3.7 (06-FAT linhas 6, 8 e 9): a tela "Cobrança por fonte pagadora", pelo caminho do faturista. A cobrança por fonte
// exige o banco próprio, e o E2E roda com a fonte sintética (sem núcleo): as respostas da API destas rotas são
// simuladas pelo Playwright com massa SINTÉTICA, e a sessão ganha as permissões de editar contrato e credenciamento
// (a tela só esconde; quem decide é o servidor). O que se prova é a tela: a conferência mostra o código da fonte e a
// cobrança proibida pela exceção; a validação na hora (item e grupo juntos, proibir sem motivo, fim antes de hoje)
// segura o envio; o de-para, a exceção e as equivalências do mat/med com a operadora (código na fonte e fator) e com a TUSS saem com o
// corpo certo; a referência de mercado do item mostra a edição, o valor pela base, PMC/PF e as vigências por edição; e o
// encerramento manda a versão e o fim, sem apagar. O efeito no banco está no contrato de efeito
// (apps/api/src/modulos/precos/cobranca-propria.int.spec.ts).
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const FONTE = 5372;
const TABELA_MATMED = 9;
const hoje = new Date().toISOString().slice(0, 10);

const json = (rota: Route, corpo: unknown, status = 200) =>
  rota.fulfill({ status, contentType: 'application/json', body: JSON.stringify(corpo) });

async function entrar(page: Page): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill('SINT.FATURAMENTO');
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

const lista = (colunas: [string, string][], itens: Record<string, unknown>[]) => ({
  colunas: colunas.map(([campo, rotulo]) => ({ campo, rotulo })),
  itens,
  total: itens.length,
});

async function simular(page: Page, enviados: { url: string; corpo: unknown }[]): Promise<void> {
  // A sessão real, com as permissões da tela somadas.
  await page.route('**/api/sessao', async (rota) => {
    if (rota.request().method() !== 'GET') return rota.continue();
    const r = await rota.fetch();
    if (!r.ok()) return rota.fulfill({ response: r });
    const s = (await r.json()) as { permissoes?: string[] };
    s.permissoes = [
      ...(s.permissoes ?? []),
      'convenio.credenciamento.ler',
      'convenio.credenciamento.editar',
      'convenio.contrato.editar',
      'preco.tabela.ler',
    ];
    return rota.fulfill({ response: r, json: s });
  });
  await page.route('**/api/cadastros/convenios?**', (rota) =>
    json(rota, {
      itens: [
        {
          codigo: FONTE,
          nome: 'OPERADORA SINTETICA F372',
          situacao: 'ativo',
          aceitaAtendimento: { aceita: true, motivo: null },
          classificacao: null,
          registroAns: null,
          tabelas: { honorariosInternacao: null, honorariosExterna: null, diarias: null, matmed: null },
        },
      ],
      total: 1,
      destino: 'memoria',
    }),
  );
  await page.route('**/api/faturamento/conferencia-cobranca?**', (rota) =>
    json(rota, {
      codigo: 'F372-COD',
      descricao: 'ITEM NA FONTE',
      quantidade: 0.5,
      equivalenciaId: 11,
      unidade: 'CX',
      percentualCobranca: 70,
      credenciamento: { permitido: false, origem: 'excecao', excecaoId: 31 },
      codigoPrestadorNaFonte: 'PREST-9',
      avisos: ['Exceção: FORA DO CONTRATO F372'],
    }),
  );
  await page.route('**/api/faturamento/de-para-exames?**', (rota) =>
    json(rota, {
      ...lista(
        [
          ['id', 'Id'],
          ['codigo', 'Código'],
          ['inicio', 'Vigência: início'],
          ['fim', 'Vigência: fim'],
          ['versao', 'Versão'],
        ],
        [
          { id: 10, codigo: 'ANTIGO', inicio: '2025-01-01', fim: '2025-12-31', versao: 2 },
          { id: 11, codigo: 'F372-COD', inicio: '2026-01-01', fim: null, versao: 3 },
        ],
      ),
      pagina: 0,
      porPagina: 50,
      avisos: [],
    }),
  );
  await page.route('**/api/faturamento/credenciamento?**', (rota) =>
    json(
      rota,
      lista(
        [
          ['id', 'Id'],
          ['profissional', 'Profissional'],
          ['inicio', 'Vigência: início'],
          ['fim', 'Vigência: fim'],
          ['versao', 'Versão'],
        ],
        [{ id: 21, profissional: 'PROFISSIONAL SINTETICO F372', inicio: '2025-01-01', fim: null, versao: 1 }],
      ),
    ),
  );
  await page.route('**/api/faturamento/credenciamento/excecoes?**', (rota) =>
    json(
      rota,
      lista(
        [
          ['id', 'Id'],
          ['fim', 'Vigência: fim'],
          ['versao', 'Versão'],
        ],
        [],
      ),
    ),
  );
  let proximaEquivalencia = 41;
  await page.route('**/api/precos/matmed/referencia/77/equivalencias', (rota) => {
    if (rota.request().method() === 'POST') {
      enviados.push({ url: rota.request().url(), corpo: rota.request().postDataJSON() });
      return json(rota, { id: proximaEquivalencia++ }, 201);
    }
    return json(
      rota,
      lista(
        [
          ['tipo', 'Equivalência'],
          ['codigo', 'Código'],
          ['fator', 'Fator'],
        ],
        [
          { tipo: 'operadora', codigo: 'F372-MM', fator: 10 },
          { tipo: 'tuss', codigo: '9001', fator: 1 },
        ],
      ),
    );
  });
  // A referência de mercado do mat/med (tabela sintética 9, item 77): a edição carregada, o valor pela base da
  // tabela (PMC), o PMC e o PF da data-base, e a linha do tempo das vigências, uma por edição.
  await page.route('**/api/precos/tabelas?**', (rota) =>
    json(rota, {
      tabelas: [
        {
          tipo: 'matmed',
          codigo: TABELA_MATMED,
          nome: 'REFERENCIA SINTETICA F372',
          situacao: null,
          modelo: null,
          compartilhada: false,
          comPercentual: false,
          convenios: [],
        },
      ],
    }),
  );
  await page.route('**/api/precos/matmed/edicoes', (rota) =>
    json(rota, {
      edicoes: [
        { id: 3, versao: 1372 },
        { id: 2, versao: 1371 },
      ],
      total: 2,
    }),
  );
  await page.route(`**/api/precos/matmed/${TABELA_MATMED}/itens?**`, (rota) =>
    json(rota, {
      itens: [
        {
          id: 1,
          codigo: 77,
          nome: 'MATERIAL SINTETICO F372',
          classificacao: null,
          unidade: 'CX',
          referencia: 'PMC',
          situacao: null,
          vigencia: '2026-11-01',
          valor: 15.5,
          pmc: 15.5,
          pf: 11.25,
          edicao: 3,
        },
      ],
      total: 1,
      pagina: 0,
      porPagina: 50,
      dataBase: hoje,
      truncada: false,
    }),
  );
  await page.route(`**/api/precos/matmed/${TABELA_MATMED}/itens/77/vigencias`, (rota) =>
    json(rota, {
      tipo: 'matmed',
      tabela: TABELA_MATMED,
      codigo: 77,
      nome: 'MATERIAL SINTETICO F372',
      vigencias: [
        { data: '2026-11-01', valor: 15.5, pmc: 15.5, pf: 11.25, edicao: 3, vigente: true, futura: false },
        { data: '2026-05-01', valor: 14, pmc: 14, pf: 10.5, edicao: 2, vigente: false, futura: false },
      ],
    }),
  );
  for (const caminho of [
    '**/api/faturamento/de-para',
    '**/api/faturamento/de-para/*/encerramento',
    '**/api/faturamento/credenciamento/excecoes',
    '**/api/faturamento/credenciamento-cobranca',
  ])
    await page.route(caminho, (rota) => {
      if (rota.request().method() !== 'POST') return rota.continue();
      enviados.push({ url: rota.request().url(), corpo: rota.request().postDataJSON() });
      return json(rota, { id: 12 }, rota.request().url().includes('encerramento') ? 200 : 201);
    });
}

test.describe('F3.7 cobrança por fonte pagadora @F3.7 @C1-004 @C1-022', () => {
  test('faturista confere a guia, grava de-para, exceção e equivalência do mat/med e encerra sem apagar', async ({
    page,
  }) => {
    const enviados: { url: string; corpo: unknown }[] = [];
    await simular(page, enviados);
    await entrar(page);
    await page.goto('/faturamento/cobranca-fonte');
    await expect(page.getByTestId('cobranca-escolha')).toBeVisible();
    await escolher(page.getByTestId('cobranca-convenio'), { rotulo: /OPERADORA SINTETICA F372/ });

    // Conferência: código e quantidade da fonte, percentual e a proibição pela exceção, na hora.
    const pedido = page.waitForRequest('**/api/faturamento/conferencia-cobranca?**');
    await page.getByTestId('cf-item').fill('501');
    await page.getByTestId('cf-profissional').fill('601');
    await page.getByTestId('cf-conferir').click();
    const url = new URL((await pedido).url());
    expect(url.searchParams.get('convenio')).toBe(String(FONTE));
    expect(url.searchParams.get('item')).toBe('501');
    expect(url.searchParams.get('profissional')).toBe('601');
    await expect(page.getByTestId('cf-codigo')).toContainText('F372-COD');
    await expect(page.getByTestId('cf-credenciamento')).toContainText('proibida');
    await expect(page.getByTestId('cf-resultado')).toContainText('FORA DO CONTRATO F372');
    await semViolacaoAxe(page, '/faturamento/cobranca-fonte (conferência)');

    // De-para: item e grupo juntos é recusado na hora; gravado, o corpo leva a fonte, o código e o divisor.
    await page.getByTestId('cobranca-aba-dePara').click();
    await expect(page.getByTestId('cobranca-lista')).toContainText('ANTIGO');
    await page.getByTestId('dp-item').fill('501');
    await page.getByTestId('dp-grupo').fill('9');
    await expect(page.getByTestId('dp-erros')).toContainText('item ou o grupo');
    await expect(page.getByTestId('dp-gravar')).toBeDisabled();
    await page.getByTestId('dp-grupo').fill('');
    await page.getByTestId('dp-codigo').fill('F372-NOVO');
    await page.getByTestId('dp-divisao').fill('10');
    await page.getByTestId('dp-gravar').click();
    await expect(page.getByTestId('cobranca-aviso')).toContainText('encerrado na véspera');
    expect(enviados.at(-1)?.url).toMatch(/\/api\/faturamento\/de-para$/);
    expect(enviados.at(-1)?.corpo).toMatchObject({
      fontePagadoraId: FONTE,
      itemId: 501,
      grupoId: null,
      codigo: 'F372-NOVO',
      fatorDivisao: 10,
      tipoAtendimento: 'todos',
    });

    // Encerrar: só o registro aberto tem a ação; fim antes de hoje é recusado na hora; vai a versão e o fim.
    await expect(page.getByTestId('encerrar-10')).toHaveCount(0);
    await page.getByTestId('encerrar-11').click();
    await page.getByTestId('enc-fim').fill('2020-01-01');
    await expect(page.getByTestId('enc-erro')).toBeVisible();
    await page.getByTestId('enc-fim').fill(hoje);
    await page.getByTestId('enc-motivo').fill('CONTRATO NOVO F372');
    await page.getByTestId('enc-confirmar').click();
    await expect(page.getByTestId('cobranca-aviso')).toContainText('Registro 11 encerrado');
    expect(enviados.at(-1)?.url).toMatch(/\/api\/faturamento\/de-para\/11\/encerramento$/);
    expect(enviados.at(-1)?.corpo).toEqual({ versao: 3, vigenciaFim: hoje, motivo: 'CONTRATO NOVO F372' });

    // Credenciamento: a lista mostra quem já pode cobrar; profissional e prestador juntos é recusado na hora;
    // gravado, vai a fonte, o profissional, o código na fonte e o início (hoje, por padrão).
    await page.getByTestId('cobranca-aba-credenciamento').click();
    await expect(page.getByTestId('cobranca-lista')).toContainText('PROFISSIONAL SINTETICO F372');
    await page.getByTestId('cr-profissional').fill('601');
    await page.getByTestId('cr-prestador').fill('701');
    await expect(page.getByTestId('cr-erros')).toContainText('não os dois');
    await expect(page.getByTestId('cr-gravar')).toBeDisabled();
    await page.getByTestId('cr-prestador').fill('');
    await page.getByTestId('cr-codigo').fill('F372-PREST');
    await page.getByTestId('cr-gravar').click();
    await expect(page.getByTestId('cobranca-aviso')).toBeVisible();
    expect(enviados.at(-1)?.url).toMatch(/\/api\/faturamento\/credenciamento-cobranca$/);
    expect(enviados.at(-1)?.corpo).toMatchObject({
      fontePagadoraId: FONTE,
      profissionalId: 601,
      prestadorId: null,
      codigoNaFonte: 'F372-PREST',
      recebeDiretoDaFonte: false,
      vigenciaInicio: hoje,
    });

    // Exceção: proibir sem motivo é recusado na hora; com o motivo, vai o profissional e o item.
    await page.getByTestId('cobranca-aba-excecoes').click();
    await page.getByTestId('ex-sujeito-id').fill('601');
    await page.getByTestId('ex-item').fill('501');
    await expect(page.getByTestId('ex-erros')).toContainText('motivo');
    await expect(page.getByTestId('ex-gravar')).toBeDisabled();
    await page.getByTestId('ex-motivo').fill('FORA DO CONTRATO F372');
    await page.getByTestId('ex-gravar').click();
    await expect(page.getByTestId('cobranca-aviso')).toBeVisible();
    expect(enviados.at(-1)?.corpo).toMatchObject({
      profissionalId: 601,
      prestadorId: null,
      fontePagadoraId: FONTE,
      itemId: 501,
      efeito: 'proibe',
      motivo: 'FORA DO CONTRATO F372',
    });

    // Mat/med: as equivalências do item; primeiro com a operadora escolhida (código na fonte e fator de conversão),
    // depois a ligação com a TUSS (exata por padrão), sem a operadora.
    await page.getByTestId('cobranca-aba-matmed').click();
    await page.getByTestId('mm-item').fill('77');
    await page.getByTestId('mm-ver').click();
    await expect(page.getByTestId('cobranca-lista')).toContainText('F372-MM');
    await expect(page.getByTestId('cobranca-lista')).toContainText('9001');
    await page.getByTestId('mm-codigo').fill('F372-MM');
    await page.getByLabel('Descrição na fonte').fill('MATERIAL NA FONTE F372');
    await page.getByLabel('Unidade na fonte').fill('CX');
    await page.getByLabel('Fator de conversão').fill('10');
    await page.getByTestId('mm-gravar').click();
    await expect(page.getByTestId('cobranca-aviso')).toContainText('41');
    expect(enviados.at(-1)?.url).toMatch(/\/api\/precos\/matmed\/referencia\/77\/equivalencias$/);
    expect(enviados.at(-1)?.corpo).toMatchObject({
      fontePagadoraId: FONTE,
      codigoNaFonte: 'F372-MM',
      descricaoNaFonte: 'MATERIAL NA FONTE F372',
      unidade: 'CX',
      fatorConversao: 10,
      termoTussId: null,
      tipoEquivalenciaTuss: null,
      vigenciaInicio: hoje,
    });

    // Sem código na fonte e sem termo, a tela recusa na hora (falta o destino da equivalência).
    await page.getByTestId('mm-codigo').fill('');
    await expect(page.getByTestId('mm-erros')).toBeVisible();
    await expect(page.getByTestId('mm-gravar')).toBeDisabled();
    await page.getByLabel('Fator de conversão').fill('1');
    await page.getByTestId('mm-termo').fill('88');
    await page.getByTestId('mm-gravar').click();
    await expect(page.getByTestId('cobranca-aviso')).toContainText('42');
    expect(enviados.at(-1)?.corpo).toMatchObject({
      fontePagadoraId: null,
      codigoNaFonte: null,
      termoTussId: 88,
      tipoEquivalenciaTuss: 'exata',
      fatorConversao: 1,
    });
    await semViolacaoAxe(page, '/faturamento/cobranca-fonte (mat/med)');

    // A referência de mercado do item: a edição mais recente, o valor pela base da tabela, PMC e PF na data-base,
    // e as vigências por edição (a atual marcada como vigente; a anterior preservada na linha do tempo).
    await page.goto('/precos/matmed');
    await expect(page.getByText('mais recente 1372')).toBeVisible();
    const tabela = page.getByTestId('tabela-matmed');
    await expect(tabela).toContainText(hoje);
    const linha = tabela.getByRole('row', { name: /MATERIAL SINTETICO F372/ });
    await expect(linha).toContainText('PMC');
    await expect(linha).toContainText('2026-11-01');
    await expect(linha).toContainText('15,50 / 11,25');
    await page.getByTestId('vigencias-77').click();
    const painel = page.getByTestId('painel-vigencias-valor');
    await expect(painel).toContainText('MATERIAL SINTETICO F372');
    await expect(painel.getByRole('listitem').nth(0)).toContainText('2026-11-01 — 15,50 (15,50 / 11,25)');
    await expect(painel.getByRole('listitem').nth(0)).toContainText('vigente');
    await expect(painel.getByRole('listitem').nth(1)).toContainText('2026-05-01 — 14,00 (14,00 / 10,50)');
    await expect(painel.getByRole('listitem').nth(1)).not.toContainText('vigente');
    await semViolacaoAxe(page, '/precos/matmed (referência do item)');
  });
});
