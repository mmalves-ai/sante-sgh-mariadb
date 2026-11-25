// E2E @F3.1-13 (ficha docs/fases/fichas/F3.1-cadastros.md, 02-CAD linha 27): setores, ramais e centro de custo pelo
// caminho da tela (/cadastros/estrutura, aba Setores e ramais). O que este arquivo cobre além do f3-1-5-estrutura-tiss:
// a árvore pelo setor superior; a troca do responsável pela busca do nome (a lista dos achados fica fora do rótulo da
// busca); a troca de ramais no mesmo formulário (uma gravação, com a versão); produção faturada sem centro de custo
// segura a gravação; inativar pede motivo e data, e a recusa da API diz o que resolver antes (leitos ativos) sem
// perder o que foi digitado; reativar com motivo. As rotas /api/cadastros/estrutura-gestao exigem o banco próprio e
// o E2E roda com a fonte sintética: as respostas são simuladas pelo Playwright com massa SINTÉTICA. O efeito no banco
// (ramal retirado com exclusão lógica, histórico do responsável, trilha com o motivo, uso vivo e data futura
// recusados) está em apps/api/src/modulos/cadastro/estrutura-gestao.int.spec.ts.
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

const setor = (campos: Record<string, unknown>) => ({
  versao: 1,
  sigla: null,
  tipo: 'assistencial',
  superior: null,
  unidade: 21,
  centroCusto: 61,
  centroCustoNome: 'CENTRO SINTETICO',
  responsavel: null,
  responsavelNome: null,
  responsavelInicio: null,
  responsavelFim: null,
  ramalPrincipal: null,
  podeSolicitarExames: false,
  aceitaLancamentoConta: false,
  producaoFaturada: false,
  exigeProfissionalAgendamento: false,
  exigeRecursoAgendamento: false,
  siglaAgendamento: null,
  observacaoAgendamento: null,
  ativo: true,
  dataInativacao: null,
  responsaveis: [],
  ramais: [],
  ...campos,
});

// A ordem da resposta é de propósito diferente da árvore: o filho vem antes do pai.
const SETORES = [
  setor({ id: 42, codigo: 'S1A', nome: 'SETOR SINTETICO FILHO', superior: 41 }),
  setor({
    id: 43,
    codigo: 'S2',
    nome: 'SETOR SINTETICO INATIVO',
    ativo: false,
    dataInativacao: '2026-10-01',
  }),
  setor({
    id: 41,
    versao: 2,
    codigo: 'S1',
    nome: 'SETOR SINTETICO',
    responsavel: 81,
    responsavelNome: 'PROFISSIONAL SINTETICO B',
    responsavelInicio: '2026-02-01',
    ramalPrincipal: '2001',
    aceitaLancamentoConta: true,
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
  }),
];

const ESTRUTURA = {
  estabelecimento: {
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
  },
  unidades: [
    {
      id: 21,
      versao: 1,
      codigo: 'U1',
      nome: 'UNIDADE SINTETICA A',
      nomeCompleto: null,
      sigla: null,
      tipo: 'internacao',
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
    },
  ],
  setores: SETORES,
  opcoes: { tipos: [], portes: [], esferas: [], centrosCusto: [{ id: 61, nome: 'CENTRO SINTETICO' }] },
};

test.describe('Setores, ramais e centro de custo @F3.1-13 @F3.1', () => {
  test.setTimeout(180_000);

  test('árvore pelo superior; troca de responsável e de ramais numa gravação; inativar recusado diz o que resolver; reativar; axe', async ({
    page,
  }) => {
    const pedidos: Pedido[] = [];
    let recusarInativacao = true;
    await page.route('**/api/cadastros/estrutura-gestao**', (rota) => {
      const r = rota.request();
      const caminho = new URL(r.url()).pathname;
      if (r.method() === 'GET') {
        if (caminho.endsWith('/profissionais'))
          return json(rota, [{ id: 82, nome: 'PROFISSIONAL SINTETICO C' }]);
        return json(rota, ESTRUTURA);
      }
      pedidos.push({
        metodo: r.method(),
        caminho,
        corpo: (r.postDataJSON() ?? {}) as Record<string, unknown>,
      });
      if (caminho.endsWith('/setores/41/situacao') && recusarInativacao) {
        recusarInativacao = false;
        return rota.fulfill({
          status: 409,
          contentType: 'application/problem+json',
          body: JSON.stringify({
            type: 'urn:sgh:problema:recusa-de-negocio',
            title: 'Operação recusada',
            status: 409,
            codigo: 'setor-com-leitos-ativos',
            detail:
              'Inative antes os leitos das unidades de internação deste setor. Há paciente ocupando leito neste setor: transfira ou dê alta antes.',
            campos: ['situacao'],
            regras: [
              {
                codigo: 'setor-com-leitos-ativos',
                mensagem: 'Inative antes os leitos das unidades de internação deste setor.',
              },
              {
                codigo: 'setor-com-pacientes-internados',
                mensagem: 'Há paciente ocupando leito neste setor: transfira ou dê alta antes.',
              },
            ],
          }),
        });
      }
      return json(rota, { id: 41 });
    });
    await entrar(page, 'SINT.ADMIN');
    await page.goto('/cadastros/estrutura/estabelecimento');
    await expect(page.getByRole('heading', { name: 'Estrutura do estabelecimento' })).toBeVisible();
    await page.getByTestId('aba-setores').click();

    // Árvore: raízes na ordem recebida e o filho logo abaixo do pai; a linha traz unidade, ramal e responsável.
    const linhas = page.getByTestId('arvore-setores').locator('li');
    await expect(linhas).toHaveCount(3);
    expect(await linhas.evaluateAll((l) => l.map((x) => x.getAttribute('data-testid')))).toEqual([
      'setor-S2',
      'setor-S1',
      'setor-S1A',
    ]);
    const s1 = page.getByTestId('setor-S1');
    await expect(s1).toContainText('UNIDADE SINTETICA A');
    await expect(s1).toContainText('Ramal 2001');
    await expect(s1).toContainText('PROFISSIONAL SINTETICO B');
    await expect(page.getByTestId('setor-S2')).toContainText('Inativo 2026-10-01');

    // Edição: histórico de quem respondeu; novo responsável pela busca; ramal antigo retirado e outro incluído.
    await s1.getByRole('button').click();
    await expect(page.getByTestId('setor-historico-responsaveis')).toContainText(
      'PROFISSIONAL SINTETICO A · 2025-01-01 a 2026-01-31',
    );
    await expect(page.getByTestId('setor-historico-responsaveis')).toContainText(
      'PROFISSIONAL SINTETICO B · 2026-02-01 a atual',
    );
    await page.locator('input[name="setor-responsavel"]').fill('SIN');
    await escolher(page.getByTestId('setor-responsavel-achado'), '82');
    await page.locator('input[name="setor-responsavelInicio"]').fill('2026-11-01');
    await page.getByRole('button', { name: 'Retirar' }).click();
    await expect(page.locator('input[name="ramal-0"]')).toHaveCount(0);
    await page.getByTestId('incluir-ramal').click();
    await page.locator('input[name="ramal-0"]').fill('2010');
    await semViolacaoAxe(page, 'setores: formulário de edição');
    await page.getByTestId('gravar-setor').click();
    await expect(page.getByTestId('gravado')).toBeVisible();
    const alterado = pedidos.find((x) => x.caminho.endsWith('/setores/41'))!;
    expect(alterado.metodo).toBe('PUT');
    expect(alterado.corpo).toMatchObject({
      versao: 2,
      codigo: 'S1',
      centroCusto: 61,
      responsavel: 82,
      responsavelInicio: '2026-11-01',
      ramais: [{ id: null, ramal: '2010', principal: true }],
    });
    expect(alterado.corpo['ramais']).toHaveLength(1);

    // Produção faturada sem centro de custo segura a gravação na hora; escolhido o centro, libera.
    await page.getByTestId('novo-setor').click();
    await page.locator('input[name="setor-codigo"]').fill('S3');
    await page.locator('input[name="setor-nome"]').fill('SETOR SINTETICO C');
    await expect(page.getByTestId('gravar-setor')).toBeEnabled();
    await page.locator('input[name="setor-producaoFaturada"]').check();
    await expect(page.getByText('Quem lança na conta precisa de centro de custo.')).toBeVisible();
    await expect(page.getByTestId('gravar-setor')).toBeDisabled();
    await escolher(page.getByRole('combobox', { name: /Centro de custo/ }), '61');
    await expect(page.getByText('Quem lança na conta precisa de centro de custo.')).toHaveCount(0);
    await expect(page.getByTestId('gravar-setor')).toBeEnabled();

    // Inativar: só com motivo de 10 letras; a recusa diz o que resolver antes e o motivo digitado fica.
    await s1.getByRole('button').click();
    const situacao = page.getByTestId('situacao-setor');
    const motivo = page.locator('input[name="motivo-setor"]');
    await motivo.fill('curto');
    await expect(situacao).toBeDisabled();
    await motivo.fill('Setor fechado pela reforma');
    await page.getByLabel('Data', { exact: true }).fill('2026-11-20');
    await situacao.click();
    await expect(page.getByTestId('mensagem-erro')).toContainText('Operação recusada');
    // Dois impedimentos: os dois aparecem de uma vez (sem uma volta por motivo).
    await expect(page.getByTestId('recusa-motivo').locator('li')).toHaveText([
      'Inative antes os leitos das unidades de internação deste setor.',
      'Há paciente ocupando leito neste setor: transfira ou dê alta antes.',
    ]);
    await expect(page.getByTestId('gravado')).toHaveCount(0);
    await expect(motivo).toHaveValue('Setor fechado pela reforma');
    await semViolacaoAxe(page, 'setores: recusa da inativação');
    await situacao.click();
    await expect(page.getByTestId('gravado')).toBeVisible();
    await expect(page.getByTestId('recusa-motivo')).toHaveCount(0);
    const inativacoes = pedidos.filter((x) => x.caminho.endsWith('/setores/41/situacao'));
    expect(inativacoes).toHaveLength(2);
    expect(inativacoes[1]!.corpo).toMatchObject({
      versao: 2,
      ativo: false,
      data: '2026-11-20',
      motivo: 'Setor fechado pela reforma',
    });

    // Reativar o setor inativo: sem campo de data, com motivo.
    await page.getByTestId('setor-S2').getByRole('button').click();
    await expect(page.getByLabel('Data', { exact: true })).toHaveCount(0);
    await expect(situacao).toContainText('Reativar');
    await expect(situacao).toBeDisabled();
    await motivo.fill('Setor reaberto depois da reforma');
    await situacao.click();
    await expect(page.getByTestId('gravado')).toBeVisible();
    const reativado = pedidos.find((x) => x.caminho.endsWith('/setores/43/situacao'))!;
    expect(reativado.corpo).toMatchObject({
      versao: 1,
      ativo: true,
      motivo: 'Setor reaberto depois da reforma',
    });
    await semViolacaoAxe(page, 'setores: árvore');
  });

  test('gravação do setor recusada: todos os motivos de uma vez; código sem texto próprio mostra o detalhe; sem detalhe, o texto de reserva', async ({
    page,
  }) => {
    const recusa = (corpo: Record<string, unknown>) => ({
      status: 409,
      contentType: 'application/problem+json',
      body: JSON.stringify({
        type: 'urn:sgh:problema:recusa-de-negocio',
        title: 'Operação recusada',
        status: 409,
        ...corpo,
      }),
    });
    // Na ordem: dois motivos (regras), um código que a tela não conhece só com o detalhe, um sem detalhe, e aceita.
    const respostas = [
      recusa({
        codigo: 'responsavel-sem-inicio',
        detail: 'Informe o início da responsabilidade. Já existe setor com este código.',
        campos: ['responsavelInicio', 'codigo'],
        regras: [
          { codigo: 'responsavel-sem-inicio', mensagem: 'Informe o início da responsabilidade.' },
          { codigo: 'codigo-repetido', mensagem: 'Já existe setor com este código.' },
        ],
      }),
      recusa({ codigo: 'superior-em-ciclo', detail: 'O setor superior não pode ser um subordinado dele.' }),
      recusa({ codigo: 'codigo-sem-texto' }),
    ];
    let gravacoes = 0;
    await page.route('**/api/cadastros/estrutura-gestao**', (rota) => {
      const r = rota.request();
      if (r.method() === 'GET') return json(rota, ESTRUTURA);
      gravacoes += 1;
      const resposta = respostas.shift();
      return resposta ? rota.fulfill(resposta) : json(rota, { id: 41 });
    });
    await entrar(page, 'SINT.ADMIN');
    await page.goto('/cadastros/estrutura/estabelecimento');
    await page.getByTestId('aba-setores').click();
    await page.getByTestId('setor-S1').getByRole('button').click();
    const motivos = page.getByTestId('recusa-motivo').locator('li');
    const gravar = page.getByTestId('gravar-setor');

    await gravar.click();
    await expect(page.getByTestId('mensagem-erro')).toContainText('Operação recusada');
    await expect(motivos).toHaveText([
      'Informe o início da responsabilidade.',
      'Já existe setor com este código.',
    ]);
    await expect(page.getByTestId('gravado')).toHaveCount(0);
    // O formulário continua aberto com o que foi digitado.
    await expect(page.locator('input[name="setor-codigo"]')).toHaveValue('S1');
    await semViolacaoAxe(page, 'setores: recusa da gravação com dois motivos');

    await gravar.click();
    await expect(motivos).toHaveText(['O setor superior não pode ser um subordinado dele.']);

    await gravar.click();
    await expect(motivos).toHaveText([
      'A gravação foi recusada: confira os campos preenchidos e tente de novo.',
    ]);

    await gravar.click();
    await expect(page.getByTestId('gravado')).toBeVisible();
    await expect(page.getByTestId('recusa-motivo')).toHaveCount(0);
    expect(gravacoes).toBe(4);
  });
});
