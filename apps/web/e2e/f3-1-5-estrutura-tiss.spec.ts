// E2E @F3.1-5 (ficha docs/fases/fichas/F3.1-cadastros.md, 02-CAD linhas 25, 26 e 27): a manutenção da estrutura
// (/cadastros/estrutura, abas Estabelecimento, Unidades e Setores e ramais) e a configuração TISS por fonte pagadora
// (/cadastros/tiss-configuracao) pelo caminho da tela. Validação na hora: CNPJ que não confere segura a gravação;
// setor que aceita lançamento na conta sem centro de custo segura a gravação; a vigência TISS com aviso do domínio
// (código do prestador na operadora, limite de guias do lote) segura a gravação; a faixa mostra o primeiro número antes
// de gravar; encerrar pede o motivo. As rotas /api/cadastros/estrutura-gestao e /api/cadastros/tiss-configuracao exigem
// o banco próprio e o E2E roda com a fonte sintética (sem núcleo): as respostas são simuladas pelo Playwright com massa
// SINTÉTICA. O efeito no banco (versão, trilha com motivo, histórico do responsável, vigência encerrada na véspera,
// faixa sem sobreposição e consumo em ordem) está em apps/api/src/modulos/cadastro/estrutura-gestao.int.spec.ts.
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

type Pedido = { metodo: string; caminho: string; corpo: Record<string, unknown> };

function registrar(pedidos: Pedido[], rota: Route): Pedido {
  const r = rota.request();
  const p = {
    metodo: r.method(),
    caminho: new URL(r.url()).pathname,
    corpo: (r.postDataJSON() ?? {}) as Record<string, unknown>,
  };
  if (p.metodo !== 'GET') pedidos.push(p);
  return p;
}

const ESTABELECIMENTO = {
  id: 1,
  versao: 3,
  codigo: 'E1',
  razaoSocial: 'HOSPITAL SINTETICO LTDA',
  nomeFantasia: 'HOSPITAL SINTETICO',
  cnpj: null,
  inscricaoEstadual: null,
  inscricaoMunicipal: null,
  cnes: null,
  tipo: null,
  porte: null,
  esfera: null,
  hospitalDia: false,
  cep: null,
  logradouro: null,
  numero: null,
  complemento: null,
  bairro: null,
  telefone: null,
  email: null,
  site: null,
  inicioAtividade: null,
  fimAtividade: null,
};
const UNIDADE = {
  id: 21,
  versao: 1,
  codigo: 'U1',
  nome: 'UNIDADE SINTETICA A',
  nomeCompleto: null,
  sigla: null,
  tipo: 'ambulatorio',
  cnes: null,
  cnpj: null,
  cep: null,
  logradouro: null,
  numero: null,
  complemento: null,
  bairro: null,
  telefone: null,
  orientacaoAcesso: null,
  ativo: true,
};
const SETOR = {
  id: 41,
  versao: 2,
  codigo: 'S1',
  nome: 'SETOR SINTETICO',
  sigla: null,
  tipo: 'assistencial',
  superior: null,
  unidade: 21,
  centroCusto: 61,
  centroCustoNome: 'CENTRO SINTETICO',
  responsavel: 81,
  responsavelNome: 'PROFISSIONAL SINTETICO B',
  responsavelInicio: '2026-02-01',
  responsavelFim: null,
  ramalPrincipal: '2001',
  podeSolicitarExames: false,
  aceitaLancamentoConta: true,
  producaoFaturada: false,
  exigeProfissionalAgendamento: false,
  exigeRecursoAgendamento: false,
  siglaAgendamento: null,
  observacaoAgendamento: null,
  ativo: true,
  dataInativacao: null,
  responsaveis: [
    { id: 2, profissional: 81, nome: 'PROFISSIONAL SINTETICO B', inicio: '2026-02-01', fim: null },
    { id: 1, profissional: 80, nome: 'PROFISSIONAL SINTETICO A', inicio: '2025-01-01', fim: '2026-01-31' },
  ],
  ramais: [
    {
      id: 5,
      ramal: '2001',
      contato: null,
      principal: true,
      responsavel: false,
      telefoneExterno: null,
      observacao: null,
    },
  ],
};
const estrutura = () => ({
  estabelecimento: ESTABELECIMENTO,
  unidades: [UNIDADE],
  setores: [SETOR],
  opcoes: {
    tipos: [{ id: 5, nome: 'HOSPITAL GERAL' }],
    portes: [{ id: 2, nome: 'MEDIO' }],
    esferas: [{ id: 3, nome: 'PRIVADA' }],
    centrosCusto: [{ id: 61, nome: 'CENTRO SINTETICO' }],
  },
});

test.describe('Estrutura e configuração TISS @F3.1-5 @F3.1', () => {
  test.setTimeout(180_000);

  test('estrutura: CNPJ conferido na hora, unidade incluída e inativada com motivo, setor exige centro de custo; axe', async ({
    page,
  }) => {
    const pedidos: Pedido[] = [];
    await page.route('**/api/cadastros/estrutura-gestao**', (rota) => {
      const p = registrar(pedidos, rota);
      if (p.metodo === 'GET') return json(rota, estrutura());
      return json(rota, { id: p.caminho.endsWith('/setores') ? 42 : 22 });
    });
    await entrar(page, 'SINT.ADMIN');
    await page.goto('/cadastros/estrutura/estabelecimento');
    await expect(page.getByRole('heading', { name: 'Estrutura do estabelecimento' })).toBeVisible();

    // Estabelecimento: CNPJ com dígito errado segura a gravação; o correto libera e vai com a versão.
    const cnpj = page.locator('input[name="cnpj"]');
    await cnpj.fill('11222333000182');
    await expect(page.getByText('O CNPJ não confere.')).toBeVisible();
    await expect(page.getByTestId('gravar-estabelecimento')).toBeDisabled();
    await cnpj.fill('11222333000181');
    await expect(page.getByText('O CNPJ não confere.')).toHaveCount(0);
    await page.getByTestId('gravar-estabelecimento').click();
    await expect(page.getByTestId('gravado')).toBeVisible();
    const est = pedidos.find((x) => x.caminho.endsWith('/estabelecimento'))!;
    expect(est.metodo).toBe('PUT');
    expect(est.corpo).toMatchObject({ cnpj: '11222333000181', versao: 3 });
    await semViolacaoAxe(page, 'estrutura: estabelecimento');

    // Unidades: incluir e inativar com motivo (o botão só libera com 10 letras).
    await page.getByTestId('aba-unidades').click();
    await expect(page.getByTestId('unidade-U1')).toBeVisible();
    await page.getByTestId('nova-unidade').click();
    await page.locator('input[name="unidade-codigo"]').fill('U2');
    await page.locator('input[name="unidade-nome"]').fill('UNIDADE SINTETICA B');
    await page.getByTestId('gravar-unidade').click();
    await expect(page.getByTestId('gravado')).toBeVisible();
    const nova = pedidos.find((x) => x.caminho.endsWith('/unidades'))!;
    expect(nova.metodo).toBe('POST');
    expect(nova.corpo).toMatchObject({ codigo: 'U2', nome: 'UNIDADE SINTETICA B', tipo: 'ambulatorio' });
    await page.getByTestId('unidade-U1').getByRole('button').click();
    const inativar = page.getByRole('button', { name: 'Inativar' });
    await page.locator('input[name="motivo-unidade"]').fill('curto');
    await expect(inativar).toBeDisabled();
    await page.locator('input[name="motivo-unidade"]').fill('Unidade desativada pela reforma');
    await inativar.click();
    await expect(page.getByTestId('gravado')).toBeVisible();
    const sit = pedidos.find((x) => x.caminho.endsWith('/unidades/21/situacao'))!;
    expect(sit.corpo).toMatchObject({ ativo: false, versao: 1, motivo: 'Unidade desativada pela reforma' });
    await semViolacaoAxe(page, 'estrutura: unidades');

    // Setores: o histórico de quem respondeu aparece; lançamento na conta sem centro de custo segura a gravação.
    await page.getByTestId('aba-setores').click();
    await page.getByTestId('setor-S1').getByRole('button').click();
    await expect(page.getByTestId('setor-historico-responsaveis')).toContainText('PROFISSIONAL SINTETICO A');
    await expect(page.getByTestId('setor-historico-responsaveis')).toContainText('2026-01-31');
    await page.getByTestId('novo-setor').click();
    await page.locator('input[name="setor-codigo"]').fill('S2');
    await page.locator('input[name="setor-nome"]').fill('SETOR SINTETICO B');
    await page.locator('input[name="setor-aceitaLancamentoConta"]').check();
    await expect(page.getByText('Quem lança na conta precisa de centro de custo.')).toBeVisible();
    const gravarSetor = page.getByTestId('gravar-setor');
    await expect(gravarSetor).toBeDisabled();
    await escolher(page.getByRole('combobox', { name: /Centro de custo/ }), '61');
    await expect(gravarSetor).toBeEnabled();
    await page.getByTestId('incluir-ramal').click();
    await page.locator('input[name="ramal-0"]').fill('2002');
    await gravarSetor.click();
    await expect(page.getByTestId('gravado')).toBeVisible();
    const setor = pedidos.find((x) => x.caminho.endsWith('/setores'))!;
    expect(setor.metodo).toBe('POST');
    expect(setor.corpo).toMatchObject({
      codigo: 'S2',
      centroCusto: 61,
      aceitaLancamentoConta: true,
      ramais: [{ ramal: '2002', principal: true }],
    });
    await semViolacaoAxe(page, 'estrutura: setores');
  });

  test('TISS: nova vigência com aviso na hora, faixa com o primeiro número e encerrar com motivo; axe', async ({
    page,
  }) => {
    const pedidos: Pedido[] = [];
    const faixa = {
      id: 91,
      versao: 1,
      tipoGuia: 'sp_sadt',
      formaGeracao: 'faixa_operadora',
      prefixo: 'SP',
      tamanhoFixo: 8,
      numeroInicial: 1,
      numeroFinal: 1000,
      proximoNumero: 991,
      usados: 990,
      restantes: 10,
      noFim: true,
      vigenciaInicio: '2026-01-01',
      vigenciaFim: null,
      situacao: 'ativa',
    };
    await page.route('**/api/cadastros/tiss-configuracao**', (rota) => {
      const p = registrar(pedidos, rota);
      if (p.metodo === 'GET')
        return json(rota, {
          fontes: [{ id: 11, nome: 'CONVENIO SINTETICO' }],
          versoes: [{ id: 3, nome: '04.03.00' }],
          configuracoes: [],
          faixas: new URL(rota.request().url()).searchParams.get('fonte') ? [faixa] : [],
        });
      return json(rota, { id: 99 });
    });
    await entrar(page, 'SINT.ADMIN');
    await page.goto('/cadastros/tiss-configuracao');
    await expect(page.getByRole('heading', { name: 'Configuração TISS por fonte pagadora' })).toBeVisible();
    await escolher(page.getByTestId('fonte'), '11');
    await expect(page.getByTestId('faixas')).toContainText('SP1 – 1000');

    // Nova vigência: sem o código do prestador na operadora o botão segura; limite do lote acima de 100 também.
    await page.getByTestId('nova-vigencia').click();
    const gravar = page.getByTestId('gravar-configuracao');
    await expect(gravar).toBeDisabled();
    await page.locator('input[name="codigoPrestadorOperadora"]').fill('123456');
    await page.locator('input[name="limiteGuiasLote"]').fill('200');
    await expect(page.locator('input[name="limiteGuiasLote"]')).toHaveAttribute('aria-invalid', 'true');
    await expect(gravar).toBeDisabled();
    await page.locator('input[name="limiteGuiasLote"]').fill('50');
    await expect(gravar).toBeEnabled();
    await gravar.click();
    await expect(page.getByTestId('gravado')).toBeVisible();
    const cfg = pedidos.find((x) => x.caminho === '/api/cadastros/tiss-configuracao')!;
    expect(cfg.metodo).toBe('POST');
    expect(cfg.corpo).toMatchObject({
      fontePagadora: 11,
      codigoPrestadorOperadora: '123456',
      limiteGuiasLote: '50',
    });
    await semViolacaoAxe(page, 'tiss: vigência');

    // Faixa nova: o primeiro número aparece antes de gravar (prefixo e zeros).
    await page.getByTestId('nova-faixa').click();
    await page.locator('input[name="prefixo"]').fill('SP');
    await page.locator('input[name="tamanhoFixo"]').fill('8');
    await page.locator('input[name="numeroInicial"]').fill('1001');
    await page.locator('input[name="numeroFinal"]').fill('2000');
    await expect(page.getByTestId('exemplo-numero')).toContainText('SP00001001');
    await page.getByTestId('gravar-faixa').click();
    await expect(page.getByTestId('gravado')).toBeVisible();
    const nf = pedidos.find((x) => x.caminho.endsWith('/faixas'))!;
    expect(nf.corpo).toMatchObject({
      fontePagadora: 11,
      tipoGuia: 'sp_sadt',
      numeroInicial: '1001',
      numeroFinal: '2000',
    });

    // Encerrar a faixa no fim: só com motivo de 10 letras.
    const linha = page.getByTestId('faixas').locator('tr').first();
    await expect(linha).toContainText('990');
    const encerrar = linha.getByRole('button', { name: 'Encerrar faixa' });
    await expect(encerrar).toBeDisabled();
    await linha.locator('input').fill('Operadora trocou a faixa');
    await encerrar.click();
    await expect(page.getByTestId('gravado')).toBeVisible();
    const enc = pedidos.find((x) => x.caminho.endsWith('/faixas/91/encerrar'))!;
    expect(enc.corpo).toMatchObject({ versao: 1, motivo: 'Operadora trocou a faixa' });
    await semViolacaoAxe(page, 'tiss: faixas');
  });
});
