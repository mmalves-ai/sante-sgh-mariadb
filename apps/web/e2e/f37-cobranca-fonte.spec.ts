// F3.7 (06-FAT linhas 6, 8 e 9): a tela "Cobrança por fonte pagadora", pelo caminho do faturista. A cobrança por fonte
// exige o banco próprio, e o E2E roda com a fonte sintética (sem núcleo): as respostas da API destas rotas são
// simuladas pelo Playwright com massa SINTÉTICA, e a sessão ganha as permissões de editar contrato e credenciamento
// (a tela só esconde; quem decide é o servidor). O que se prova é a tela: a conferência mostra o código da fonte e a
// cobrança proibida pela exceção; a validação na hora (item e grupo juntos, proibir sem motivo, fim antes de hoje)
// segura o envio; o de-para, a exceção e a equivalência do mat/med com a TUSS saem com o corpo certo; e o
// encerramento manda a versão e o fim, sem apagar. O efeito no banco está no contrato de efeito
// (apps/api/src/modulos/precos/cobranca-propria.int.spec.ts).
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const FONTE = 5372;
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
  await page.route('**/api/precos/matmed/referencia/77/equivalencias', (rota) => {
    if (rota.request().method() === 'POST') {
      enviados.push({ url: rota.request().url(), corpo: rota.request().postDataJSON() });
      return json(rota, { id: 41 }, 201);
    }
    return json(
      rota,
      lista(
        [
          ['tipo', 'Equivalência'],
          ['codigo', 'Código'],
        ],
        [{ tipo: 'tuss', codigo: '9001' }],
      ),
    );
  });
  for (const caminho of [
    '**/api/faturamento/de-para',
    '**/api/faturamento/de-para/*/encerramento',
    '**/api/faturamento/credenciamento/excecoes',
  ])
    await page.route(caminho, (rota) => {
      if (rota.request().method() !== 'POST') return rota.continue();
      enviados.push({ url: rota.request().url(), corpo: rota.request().postDataJSON() });
      return json(rota, { id: 12 }, rota.request().url().includes('encerramento') ? 200 : 201);
    });
}

test.describe('F3.7 cobrança por fonte pagadora @F3.7 @C1-004', () => {
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

    // Mat/med: as equivalências do item e a ligação com a TUSS (exata por padrão).
    await page.getByTestId('cobranca-aba-matmed').click();
    await page.getByTestId('mm-item').fill('77');
    await page.getByTestId('mm-ver').click();
    await expect(page.getByTestId('cobranca-lista')).toContainText('9001');
    await page.getByTestId('mm-termo').fill('88');
    await page.getByTestId('mm-gravar').click();
    await expect(page.getByTestId('cobranca-aviso')).toContainText('41');
    expect(enviados.at(-1)?.corpo).toMatchObject({
      fontePagadoraId: null,
      termoTussId: 88,
      tipoEquivalenciaTuss: 'exata',
      fatorConversao: 1,
    });
    await semViolacaoAxe(page, '/faturamento/cobranca-fonte (mat/med)');
  });
});
