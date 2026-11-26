// E2E @C1-090 (F3.7, 06-FAT linha 16): exceções das regras de lançamento automático.
// Da tela do lançamento automático para /faturamento/lancamento-automatico/excecoes: a regra com a exceção vigente, a
// nova exceção com a validação do domínio na hora (sem motivo, item e grupo juntos, nenhuma natureza), o plano filtrado
// pela fonte escolhida, a gravação com o corpo esperado e o encerramento com confirmação (só a versão vai ao servidor);
// a resposta 503 sem banco próprio; axe sem violação séria.
// Fonte sintética: as respostas da API são simuladas pela rota (o contrato de efeito no banco está em
// regra-excecao-propria.int.spec). Nenhum dado de pessoa.
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher, rotulosDoCombo } from './combos.js';

const SENHA = 'Sintetico#2026';
const U = '/api/faturamento/regras-lancamento/excecoes';
const REGRA = 7101;

async function entrar(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

const TODAS = { internacao: true, ambulatorial: true, externo: true, urgencia: true, domiciliar: true };
const VIGENTE = {
  id: 501,
  versao: 1,
  todosEstabelecimentos: false,
  fontePagadoraId: 9201,
  fonte: 'CONVENIO SINTETICO A',
  planoId: null,
  plano: null,
  setorId: null,
  setor: null,
  especialidadeId: null,
  especialidade: null,
  itemId: null,
  item: null,
  grupoId: null,
  grupo: null,
  efeito: 'nao_aplicar',
  aplica: TODAS,
  vigenciaInicio: '2026-11-01',
  vigenciaFim: null,
  situacao: 'vigente',
  motivo: 'CONTRATO SINTETICO SEM TAXA',
  criadoPor: 'USUARIO SINTETICO',
};
const OPCOES = {
  fontes: [
    { id: 9201, rotulo: 'CONVENIO SINTETICO A' },
    { id: 9202, rotulo: 'CONVENIO SINTETICO B' },
  ],
  planos: [
    { id: 9301, rotulo: 'PLANO SINTETICO A1', fontePagadoraId: 9201 },
    { id: 9302, rotulo: 'PLANO SINTETICO B1', fontePagadoraId: 9202 },
  ],
  setores: [{ id: 9401, rotulo: 'SETOR SINTETICO' }],
  especialidades: [{ id: 9501, rotulo: 'ESPECIALIDADE SINTETICA' }],
  grupos: [{ id: 9601, rotulo: 'GRUPO SINTETICO' }],
};
const ITENS = [{ id: 9701, codigo: 'S9701', descricao: 'TAXA SINTETICA', grupoId: 9601 }];

interface Estado {
  excecoes: Record<string, unknown>[];
  gravados: { url: string; corpo: Record<string, unknown> }[];
}

async function simular(page: Page, est: Estado, indisponivel = false): Promise<void> {
  const json = (r: Route, corpo: unknown, status = 200) =>
    r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(corpo) });
  await page.route('**/api/faturamento/cobertura/itens**', (r) => {
    const termo = (new URL(r.request().url()).searchParams.get('termo') ?? '').toUpperCase();
    return json(
      r,
      ITENS.filter((i) => i.codigo.startsWith(termo) || i.descricao.includes(termo)),
    );
  });
  await page.route(`**${U}**`, async (r) => {
    const caminho = new URL(r.request().url()).pathname;
    if (indisponivel)
      return r.fulfill({
        status: 503,
        contentType: 'application/problem+json',
        body: JSON.stringify({
          type: 'about:blank',
          title: 'Indisponível',
          status: 503,
          detail: 'As exceções da regra de lançamento exigem o banco próprio.',
        }),
      });
    if (r.request().method() === 'POST') {
      const corpo = (r.request().postDataJSON() ?? {}) as Record<string, unknown>;
      est.gravados.push({ url: caminho, corpo });
      if (caminho.endsWith('/encerramento')) {
        est.excecoes = est.excecoes.map((x) =>
          x['id'] === 501 ? { ...x, versao: 2, vigenciaFim: '2026-11-24', situacao: 'encerrada' } : x,
        );
        return json(r, { id: 501, vigenciaFim: '2026-11-24' });
      }
      est.excecoes.unshift({
        ...VIGENTE,
        ...corpo,
        id: 502,
        fonte: 'CONVENIO SINTETICO B',
        plano: 'PLANO SINTETICO B1',
        situacao: 'vigente',
      });
      return json(r, { id: 502 });
    }
    return json(r, {
      hoje: '2026-11-25',
      regras: [
        {
          id: REGRA,
          codigo: 'TXS1',
          descricao: 'TAXA DE ABERTURA SINTETICA',
          gatilho: 'abertura_atendimento',
          vigenciaInicio: '2026-01-01',
          vigenciaFim: null,
          excecoes: est.excecoes,
        },
      ],
      opcoes: OPCOES,
    });
  });
}

test.describe('exceções das regras de lançamento automático @C1-090', () => {
  test.describe.configure({ mode: 'serial' });

  test('nova exceção com validação na hora, plano pela fonte, gravação e encerramento; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    const est: Estado = { excecoes: [{ ...VIGENTE }], gravados: [] };
    await simular(page, est);
    await entrar(page, 'SINT.ADMIN');
    await page.goto('/faturamento/lancamento-automatico');
    await page.getByTestId('aut-excecoes').click();
    await expect(page).toHaveURL(/\/faturamento\/lancamento-automatico\/excecoes$/);
    await expect(page.getByTestId('tela-excecoes-regra')).toBeVisible();
    await expect(page.getByTestId('exr-situacao-501')).toContainText('Vigente');

    // Validação na hora: gravar sem regra nem motivo mostra os erros do domínio e não envia.
    await page.getByTestId('exr-nova').click();
    await page.getByTestId('exr-gravar').click();
    await expect(page.getByTestId('exr-erro-regraLancamento')).toBeVisible();
    await expect(page.getByTestId('exr-erro-motivo')).toBeVisible();
    expect(est.gravados).toEqual([]);

    await escolher(page.getByTestId('exr-regra'), { rotulo: /TAXA DE ABERTURA SINTETICA/ });
    await escolher(page.getByTestId('exr-efeito'), { rotulo: 'Aplicar a regra somente no recorte' });
    await escolher(page.getByTestId('exr-fonte'), { rotulo: 'CONVENIO SINTETICO B' });
    // O plano mostra só os da fonte escolhida.
    expect(await rotulosDoCombo(page.getByTestId('exr-plano'))).toEqual(['Qualquer', 'PLANO SINTETICO B1']);
    await escolher(page.getByTestId('exr-plano'), { rotulo: 'PLANO SINTETICO B1' });

    // Item e grupo juntos são recusados na hora.
    await page.getByTestId('exr-item-termo').fill('S97');
    await page.getByTestId('exr-item-buscar').click();
    await page.getByTestId('exr-item-op-S9701').click();
    await escolher(page.getByTestId('exr-grupo'), { rotulo: 'GRUPO SINTETICO' });
    await expect(page.getByTestId('exr-erro-grupo')).toBeVisible();
    await escolher(page.getByTestId('exr-grupo'), { rotulo: 'Qualquer' });
    await expect(page.getByTestId('exr-erro-grupo')).toHaveCount(0);

    // Nenhuma natureza marcada é recusada; volta a internação.
    for (const k of ['internacao', 'ambulatorial', 'externo', 'urgencia', 'domiciliar'])
      await page.getByTestId(`exr-nat-${k}`).uncheck();
    await expect(page.getByTestId('exr-erro-aplica')).toBeVisible();
    await page.getByTestId('exr-nat-internacao').check();
    await expect(page.getByTestId('exr-erro-aplica')).toHaveCount(0);

    await page.getByTestId('exr-inicio').fill('2026-12-01');
    await page.getByTestId('exr-fim').fill('2026-11-30');
    await expect(page.getByTestId('exr-erro-vigenciaFim')).toBeVisible();
    await page.getByTestId('exr-fim').fill('');
    await page.getByTestId('exr-motivo').fill('Plano sintetico com taxa so na internacao');
    await semViolacaoAxe(page, 'exceções da regra de lançamento (formulário)');
    await page.getByTestId('exr-gravar').click();
    await expect(page.getByTestId('exr-mensagem')).toContainText('Exceção gravada');
    expect(est.gravados[0]).toEqual({
      url: U,
      corpo: {
        regraLancamentoId: REGRA,
        todosEstabelecimentos: false,
        fontePagadoraId: 9202,
        planoId: 9302,
        setorId: null,
        especialidadeId: null,
        itemId: 9701,
        grupoId: null,
        efeito: 'aplicar_somente',
        aplica: { internacao: true, ambulatorial: false, externo: false, urgencia: false, domiciliar: false },
        vigenciaInicio: '2026-12-01',
        vigenciaFim: null,
        motivo: 'Plano sintetico com taxa so na internacao',
      },
    });
    await expect(page.getByTestId('exr-excecao-502')).toBeVisible();

    // Encerrar pede confirmação e manda só a versão; a exceção continua na lista, encerrada.
    await page.getByTestId('exr-encerrar-501').click();
    await page.getByTestId('confirmacao').getByRole('button', { name: 'Confirmar' }).click();
    await expect(page.getByTestId('exr-mensagem')).toContainText('Exceção encerrada');
    expect(est.gravados[1]).toEqual({ url: `${U}/501/encerramento`, corpo: { versao: 1 } });
    await expect(page.getByTestId('exr-situacao-501')).toContainText('Encerrada');
    await expect(page.getByTestId('exr-encerrar-501')).toHaveCount(0);
    await semViolacaoAxe(page, 'exceções da regra de lançamento (lista)');
    expect(externas).toEqual([]);
  });

  test('sem banco próprio: 503 explicado na tela', async ({ page }) => {
    await simular(page, { excecoes: [], gravados: [] }, true);
    await entrar(page, 'SINT.ADMIN');
    await page.goto('/faturamento/lancamento-automatico/excecoes');
    await expect(page.getByTestId('tela-excecoes-regra')).toContainText('banco próprio');
    await expect(page.getByTestId('exr-nova')).toHaveCount(0);
  });
});
