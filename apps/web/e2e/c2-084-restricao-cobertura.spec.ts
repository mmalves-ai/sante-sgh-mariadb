// E2E @C2-084 (F7, 09-AREA linha 76): restrição de cobertura por fonte pagadora e compatibilidade entre procedimentos.
// Na tela /faturamento/cobertura: a fonte pelo combo, a restrição nova com a validação do domínio na hora (descrição,
// item, quantidade limite, critério de idade invertido), o item buscado por código, a gravação; o par de compatibilidade
// repetido nos dois sentidos avisado antes de enviar; a visão por atendimento com liberar exceção (justificativa
// obrigatória na hora) e revogar com confirmação; a resposta 503 sem banco próprio; axe sem violação séria.
// Fonte sintética: as respostas da API são simuladas pela rota (o contrato de efeito no banco está em
// restricao-cobertura-propria.int.spec). Nenhum dado de pessoa.
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const U = '/api/faturamento/cobertura';
const FONTE = 9101;
const ATEND = 880011;

async function entrar(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

const OPCOES = {
  justificativas: [{ id: 31, codigo: 'JS1', descricao: 'JUSTIFICATIVA SINTETICA', textoPadrao: null }],
  fontes: [{ id: FONTE, nome: 'CONVENIO SINTETICO' }],
  planos: [{ id: 41, descricao: 'PLANO SINTETICO' }],
  setores: [{ id: 51, nome: 'SETOR SINTETICO' }],
  grupos: [{ id: 61, descricao: 'GRUPO SINTETICO' }],
  tabelas: [{ id: 71, descricao: 'TABELA SINTETICA' }],
  prestadores: [{ id: 81, nome: 'PRESTADOR SINTETICO' }],
};
const PAR = {
  id: 201,
  versao: 1,
  fontePagadoraId: FONTE,
  itemId: 1001,
  relacionadoId: 1002,
  tipo: 'incompativel',
  exigeItem: false,
  quantidadeLimite: null,
  validadeDias: 0,
  vigenciaInicio: '2026-01-01',
  vigenciaFim: null,
  ativo: true,
  itemCodigo: 'S0001',
  itemDescricao: 'PROCEDIMENTO SINTETICO A',
  relacionadoCodigo: 'S0002',
  relacionadoDescricao: 'PROCEDIMENTO SINTETICO B',
  fonteNome: 'CONVENIO SINTETICO',
};
const ITENS = [
  { id: 1001, codigo: 'S0001', descricao: 'PROCEDIMENTO SINTETICO A', grupoId: 61 },
  { id: 1002, codigo: 'S0002', descricao: 'PROCEDIMENTO SINTETICO B', grupoId: 61 },
];

interface Estado {
  restricoes: unknown[];
  excecoes: { id: number; versao: number; revogada: boolean }[];
  gravados: { url: string; corpo: Record<string, unknown> }[];
}

async function simular(page: Page, est: Estado, indisponivel = false): Promise<void> {
  const json = (r: Route, corpo: unknown, status = 200) =>
    r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(corpo) });
  await page.route(`**${U}**`, async (r) => {
    const url = new URL(r.request().url());
    const caminho = url.pathname;
    if (indisponivel)
      return r.fulfill({
        status: 503,
        contentType: 'application/problem+json',
        body: JSON.stringify({
          type: 'about:blank',
          title: 'Indisponível',
          status: 503,
          detail: 'A restrição de cobertura exige o banco próprio.',
        }),
      });
    if (r.request().method() === 'POST') {
      const corpo = (r.request().postDataJSON() ?? {}) as Record<string, unknown>;
      est.gravados.push({ url: caminho, corpo });
      if (caminho.endsWith('/restricoes')) {
        est.restricoes.push({
          ...corpo,
          id: 301,
          versao: 1,
          estabelecimentoId: 1,
          fonteNome: 'CONVENIO SINTETICO',
          planoDescricao: null,
          itemCodigo: 'S0001',
          itemDescricao: 'PROCEDIMENTO SINTETICO A',
          grupoDescricao: null,
          tabelaDescricao: null,
        });
        return json(r, { id: 301 });
      }
      if (caminho.endsWith(`/atendimentos/${ATEND}/excecoes`)) {
        est.excecoes.push({ id: 401, versao: 1, revogada: false });
        return json(r, { id: 401 }, 201);
      }
      if (caminho.endsWith('/revogacao')) {
        est.excecoes = est.excecoes.map((x) => ({ ...x, revogada: true, versao: x.versao + 1 }));
        return json(r, { id: 401 });
      }
      return json(r, { id: 1 });
    }
    if (caminho.endsWith('/itens')) {
      const termo = (url.searchParams.get('termo') ?? '').toUpperCase();
      return json(
        r,
        ITENS.filter((i) => i.codigo.startsWith(termo) || i.descricao.includes(termo)),
      );
    }
    if (caminho.endsWith(`/atendimentos/${ATEND}/excecoes`))
      return json(r, {
        atendimentoId: ATEND,
        fontePagadoraId: FONTE,
        tipoAtendimento: 'ambulatorial',
        excecoes: est.excecoes.map((x) => ({
          ...x,
          restricaoId: 301,
          restricaoDescricao: 'RESTRICAO SINTETICA',
          itemId: 1001,
          itemCodigo: 'S0001',
          itemDescricao: 'PROCEDIMENTO SINTETICO A',
          grupoDescricao: null,
          quantidadeAutorizada: 1,
          numeroGuia: null,
          observacao: null,
          justificativa: 'JUSTIFICATIVA SINTETICA',
          autor: 'USUARIO SINTETICO',
          autorizadoEm: '2026-11-25T10:00:00.000Z',
          tiposAtendimento: ['ambulatorial'],
        })),
        restricoes: [{ id: 301, descricao: 'RESTRICAO SINTETICA', itemId: 1001, grupoId: null }],
      });
    return json(r, { restricoes: est.restricoes, pares: [PAR], opcoes: OPCOES });
  });
}

test.describe('restrição de cobertura e compatibilidade @C2-084', () => {
  test.describe.configure({ mode: 'serial' });

  test('restrição com validação na hora, par repetido, liberar e revogar exceção; axe', async ({ page }) => {
    const externas = vigiarExternas(page);
    const est: Estado = { restricoes: [], excecoes: [], gravados: [] };
    await simular(page, est);
    await entrar(page, 'SINT.CONTAS');
    await page.goto('/faturamento/cobertura');
    await expect(page.getByTestId('cobertura')).toBeVisible();

    // Restrição: a fonte primeiro (o botão "nova" fica desligado sem ela).
    await escolher(page.getByTestId('cob-fonte'), { rotulo: 'CONVENIO SINTETICO' });
    await page.getByTestId('cob-nova').click();
    const form = page.getByTestId('cob-form-restricao');
    await expect(page.getByTestId('cob-r-erro-descricao')).toBeVisible();
    await expect(page.getByTestId('cob-r-erro-item')).toBeVisible();
    await expect(page.getByTestId('cob-r-gravar')).toBeDisabled();
    await page.getByTestId('cob-r-descricao').fill('RESTRICAO SINTETICA');
    await page.getByTestId('cob-r-item-termo').fill('S0001');
    await page.getByTestId('cob-r-item-buscar').click();
    await page.getByTestId('cob-r-item-op-S0001').click();
    await expect(page.getByTestId('cob-r-item-escolhido')).toContainText('S0001');
    await expect(page.getByTestId('cob-r-erro-item')).toHaveCount(0);

    // Limite de quantidade exige a quantidade positiva, na hora.
    await escolher(page.getByTestId('cob-r-tipo'), { rotulo: 'Limite de quantidade' });
    await expect(page.getByTestId('cob-r-erro-qtd')).toBeVisible();
    await page.getByTestId('cob-r-qtd').fill('2');
    await expect(page.getByTestId('cob-r-erro-qtd')).toHaveCount(0);

    // Critério de faixa de idade invertido: recusado na hora pela regra do domínio.
    await page.getByTestId('cob-crit-add').click();
    await escolher(page.getByTestId('cob-crit-0-tipo'), { rotulo: 'Faixa de idade' });
    await page.getByTestId('cob-crit-0-idmin').fill('60');
    await page.getByTestId('cob-crit-0-idmax').fill('18');
    await expect(page.getByTestId('cob-crit-0-erro')).toBeVisible();
    await page.getByTestId('cob-crit-0-idmax').fill('99');
    await expect(page.getByTestId('cob-crit-0-erro')).toHaveCount(0);
    await semViolacaoAxe(page, 'restrição de cobertura (formulário)');
    await page.getByTestId('cob-r-gravar').click();
    await expect(page.getByTestId('cob-aviso')).toBeVisible();
    await expect(form).toHaveCount(0);
    await expect(page.getByTestId('cob-restricao-301')).toContainText('RESTRICAO SINTETICA');
    const gravada = est.gravados.find((g) => g.url.endsWith('/restricoes'))!.corpo;
    expect(gravada['fontePagadoraId']).toBe(FONTE);
    expect(gravada['itemId']).toBe(1001);
    expect(gravada['quantidadeLimite']).toBe(2);
    expect(gravada['criterios']).toEqual([{ tipo: 'faixa_idade', idadeMinima: 60, idadeMaxima: 99 }]);

    // Compatibilidade: o mesmo par ao contrário é avisado e não sai.
    await page.getByTestId('cob-aba-pares').click();
    await expect(page.getByTestId('cob-par-201')).toBeVisible();
    await page.getByTestId('cob-novo-par').click();
    await page.getByTestId('cob-p-item-termo').fill('S0002');
    await page.getByTestId('cob-p-item-buscar').click();
    await page.getByTestId('cob-p-item-op-S0002').click();
    await page.getByTestId('cob-p-rel-termo').fill('S0002');
    await page.getByTestId('cob-p-rel-buscar').click();
    await page.getByTestId('cob-p-rel-op-S0002').click();
    await expect(page.getByTestId('cob-p-erro-rel')).toBeVisible();
    await page.getByTestId('cob-p-rel-trocar').click();
    await page.getByTestId('cob-p-rel-termo').fill('S0001');
    await page.getByTestId('cob-p-rel-buscar').click();
    await page.getByTestId('cob-p-rel-op-S0001').click();
    await expect(page.getByTestId('cob-p-repetido')).toBeVisible();
    await expect(page.getByTestId('cob-p-gravar')).toBeDisabled();
    await page.getByTestId('cob-p-cancelar').click();
    expect(est.gravados.some((g) => g.url.endsWith('/pares'))).toBe(false);

    // Por atendimento: liberar por exceção (justificativa obrigatória na hora) e revogar com confirmação.
    await page.goto(`/faturamento/cobertura?atendimento=${ATEND}`);
    await expect(page.getByTestId('cob-a-vazio')).toBeVisible();
    await escolher(page.getByTestId('cob-x-restricao'), { rotulo: 'RESTRICAO SINTETICA' });
    await expect(page.getByTestId('cob-x-erro-just')).toBeVisible();
    await expect(page.getByTestId('cob-x-liberar')).toBeDisabled();
    await escolher(page.getByTestId('cob-x-justificativa'), { rotulo: /JUSTIFICATIVA SINTETICA/ });
    await page.getByTestId('cob-x-qtd').fill('1');
    await page.getByTestId('cob-x-liberar').click();
    await expect(page.getByTestId('cob-exc-401')).toBeVisible();
    const liberada = est.gravados.find((g) => g.url.endsWith(`/atendimentos/${ATEND}/excecoes`))!.corpo;
    expect(liberada['restricaoId']).toBe(301);
    expect(liberada['justificativaId']).toBe(31);
    expect(liberada['quantidadeAutorizada']).toBe(1);
    await page.getByTestId('cob-exc-revogar-401').click();
    await page.getByTestId('confirmacao').getByRole('button', { name: 'Confirmar' }).click();
    await expect(page.getByTestId('cob-exc-revogada')).toBeVisible();
    expect(est.gravados.find((g) => g.url.endsWith('/revogacao'))!.corpo).toEqual({ versao: 1 });
    await semViolacaoAxe(page, 'restrição de cobertura (atendimento)');
    expect(externas).toEqual([]);
  });

  test('sem banco próprio: 503 explicado na tela', async ({ page }) => {
    await simular(page, { restricoes: [], excecoes: [], gravados: [] }, true);
    await entrar(page, 'SINT.CONTAS');
    await page.goto('/faturamento/cobertura');
    await expect(page.getByTestId('cobertura')).toContainText('banco próprio');
    await expect(page.getByTestId('cob-restricoes')).toHaveCount(0);
  });
});
