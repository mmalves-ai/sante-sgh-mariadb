// F8 (06-FAT linha 23) @C1-015: serviços acessórios da conta pelo caminho da tela. As rotas exigem o banco próprio e o
// E2E roda com a fonte sintética, então as respostas da API são simuladas pelo Playwright com massa SINTÉTICA (números
// de telefone inventados). O que se prova é a tela: o layout do tarifador conferido enquanto se digita (coluna
// repetida trava o salvar), a prévia do arquivo antes de gravar (abrangência e linhas ruins), a importação a partir
// da conta com o ramal e o resultado com a linha recusada e o motivo, e o lançamento das ligações pendentes. O efeito
// no banco está no contrato de efeito apps/api/src/modulos/faturamento/tarifador-propria.int.spec.ts.
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const CONTA = 7815;

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

const LAYOUT = {
  id: 31,
  versao: 1,
  descricao: 'CENTRAL SINTETICA',
  ativo: true,
  separador: 'ponto_virgula',
  cabecalho: true,
  formatoData: 'dia_mes_ano',
  formatoDuracao: 'horas_minutos_segundos',
  decimal: ',',
  dddLocal: '54',
  colunaRamal: 1,
  colunaDataHora: 2,
  colunaHora: null,
  colunaDuracao: 3,
  colunaNumero: 4,
  colunaValor: 5,
  colunaAtendimento: null,
};

async function simular(page: Page, enviados: Record<string, unknown>[]): Promise<void> {
  const ligacoes = [
    {
      id: 1,
      tipo: 'local',
      iniciadaEm: '2026-01-20T10:00:00.000Z',
      duracaoSegundos: 125,
      valor: 0.8,
      situacao: 'pendente',
      itemId: null,
    },
  ];
  await page.route('**/api/faturamento/regras-comerciais', (r) =>
    json(r, {
      regrasConta: [],
      descontos: [],
      franquias: [],
      ambulancia: [],
      ligacao: [
        {
          id: 5,
          versao: 1,
          tipoLigacaoId: 1,
          itemMinutoId: 9,
          itemSegundoId: null,
          assumeValorTarifador: true,
          ativo: true,
        },
      ],
      opcoes: {
        fontes: [],
        contratos: [],
        origensEntrada: [],
        categoriasAtendimento: [],
        setores: [],
        grupos: [],
        categoriasAmbulancia: [{ id: 1, descricao: 'UTI MOVEL SINTETICA' }],
        rotas: [{ id: 2, descricao: 'TRAJETO SINTETICO (20 km)' }],
        tiposLigacao: [{ id: 1, descricao: 'LOCAL SINTETICA' }],
      },
    }),
  );
  await page.route('**/api/faturamento/servicos-acessorios', (r) =>
    json(r, { layouts: [LAYOUT], itens: [{ id: 9, codigo: 'F815MI', descricao: 'MINUTO SINTETICO' }] }),
  );
  await page.route('**/api/faturamento/servicos-acessorios/layouts', (r) => {
    enviados.push({ layout: r.request().postDataJSON() });
    return json(r, { id: 32 });
  });
  await page.route('**/api/faturamento/ligacoes-tarifadas/importacao', (r) => {
    enviados.push({ importacao: r.request().postDataJSON() });
    return json(r, {
      id: 50,
      lidas: 3,
      registradas: 1,
      repetidas: 0,
      outroRamal: 1,
      recusadas: 1,
      porAbrangencia: { local: 1 },
      linhasRecusadas: [{ linha: 4, motivo: 'data_invalida' }],
    });
  });
  await page.route(`**/api/faturamento/contas/${CONTA}/comercial**`, (r) =>
    json(r, {
      conta: { id: CONTA, numero: 'C-7815', situacao: 'aberta', atendimentoId: 70 },
      previa: {
        franquia: [],
        desconto: null,
        situacao: { vinculo: null, origemVinculo: null, coberturaPacienteId: null },
      },
      aplicados: [],
      ligacoes,
    }),
  );
  await page.route(`**/api/faturamento/contas/${CONTA}/ligacoes/lancamento`, (r) => {
    enviados.push({ lancamento: true });
    ligacoes[0]!.situacao = 'lancada';
    return json(r, { id: CONTA, lancadas: 1 });
  });
}

test.describe('@C1-015 serviços acessórios da conta (06-FAT linha 23)', () => {
  test('layout conferido na hora, importação com prévia a partir da conta e lançamento das ligações', async ({
    page,
  }) => {
    const enviados: Record<string, unknown>[] = [];
    await simular(page, enviados);
    await entrar(page, 'SINT.TISS');

    await page.goto(`/faturamento/servicos-acessorios?conta=${CONTA}`);
    await expect(page.getByTestId('tela-servicos-acessorios')).toBeVisible();
    await expect(page.getByTestId('sa-conta-cabecalho')).toContainText('C-7815');
    await expect(page.getByTestId('sa-conta-ligacoes')).toContainText('pendente');

    // Layout novo: a coluna repetida trava o salvar enquanto se digita.
    await page.getByTestId('sa-aba-tarifador').click();
    await page.getByTestId('sa-layout-descricao').fill('CENTRAL SINTETICA 2');
    await escolher(page.getByTestId('sa-layout-separador'), { rotulo: /Tabula/ });
    await page.getByTestId('sa-layout-colunaValor').fill('3');
    await expect(page.getByTestId('sa-layout-salvar')).toBeDisabled();
    await page.getByTestId('sa-layout-colunaValor').fill('4');
    await expect(page.getByTestId('sa-layout-salvar')).toBeEnabled();
    await page.getByTestId('sa-layout-salvar').click();
    await expect(page.getByTestId('sa-mensagem')).toBeVisible();
    expect(enviados[0]).toMatchObject({
      layout: { separador: 'tabulacao', colunaValor: 4, colunaNumero: 3 },
    });

    // Importação a partir da conta: a prévia sai antes de gravar.
    await page.getByTestId('sa-aba-conta').click();
    await page.getByTestId('sa-conta-importar').click();
    await escolher(page.getByTestId('sa-imp-layout'), { rotulo: 'CENTRAL SINTETICA' });
    await expect(page.getByTestId('sa-imp-conta')).toHaveValue(String(CONTA));
    await page.getByTestId('sa-imp-arquivo').setInputFiles({
      name: 'bilhetes.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(
        [
          'RAMAL;DATA;DURACAO;NUMERO;VALOR',
          '201;20/01/2026 10:00:00;00:02:05;32221234;0,80',
          '202;20/01/2026 11:00:00;00:01:00;32229999;0,40',
          '201;31/02/2026 10:00;00:01:00;32221234;1,00',
        ].join('\n'),
      ),
    });
    await expect(page.getByTestId('sa-previa')).toContainText('3 linha(s), 2 legível(is), 1 com problema');
    await expect(page.getByTestId('sa-previa')).toContainText('Local');
    // Sem o ramal do quarto, o arquivo da central (todos os ramais) não vai para a conta.
    await expect(page.getByTestId('sa-imp-erros')).toContainText('ramal do quarto');
    await expect(page.getByTestId('sa-imp-gravar')).toBeDisabled();
    await page.getByTestId('sa-imp-ramal').fill('201');
    await expect(page.getByTestId('sa-imp-erros')).toBeHidden();
    await page.getByTestId('sa-imp-gravar').click();
    await expect(page.getByTestId('sa-mensagem')).toContainText('1 registrada(s)');
    await expect(page.getByTestId('sa-imp-recusadas')).toContainText('data inválida');
    expect(enviados[1]).toMatchObject({ importacao: { layoutId: 31, contaId: CONTA, ramal: '201' } });

    // Lançamento das ligações pendentes na conta, num clique.
    await page.getByTestId('sa-aba-conta').click();
    await page.getByTestId('sa-conta-lancar-ligacoes').click();
    await expect(page.getByTestId('sa-mensagem')).toContainText('1 ligação(ões) lançada(s)');
    expect(enviados).toContainEqual({ lancamento: true });
    await semViolacaoAxe(page, 'serviços acessórios');
  });
});
