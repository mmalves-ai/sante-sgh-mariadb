// E2E @C2-003 (F3.3, 03-PEP linha 115): limites de alerta e aferição detalhada dos sinais vitais. A coordenação de
// enfermagem (com conselho) aplica o padrão do adulto (NEWS2) e inclui um limite por setor na tela de limites (a
// ordem das faixas é conferida na hora, sem pedido ao servidor); depois, a enfermeira do plantão, na tela de sinais
// vitais do paciente sintético, registra a
// aferição detalhada com instrumento, local e posição, mais um parâmetro não aferido com o motivo, e confere o nível
// do alerta em texto na lista das recentes. Fonte sintética; combos por e2e/combos.ts; axe nas duas telas.
// Sem banco (SGH_NUCLEO_SEM_BANCO=1) a porta da enfermagem é a de memória e as rotas do detalhe e dos limites, que só
// gravam no banco próprio, respondem 501 (sinais-detalhe.controller.ts, propria()). As respostas são simuladas aqui,
// com estado, seguindo o contrato de api-sinais-detalhe.ts; a gravação real tem prova no sinais-detalhe-propria.int.spec.
import { expect, test, type Page, type Route } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const PACIENTE = 25001;

const PARAMETROS = [
  { codigo: 'fc', descricao: 'Frequência cardíaca', unidade: 'bpm', alertaMinimo: 20, alertaMaximo: 300 },
  { codigo: 'fr', descricao: 'Frequência respiratória', unidade: 'irpm', alertaMinimo: 2, alertaMaximo: 80 },
  { codigo: 'temp', descricao: 'Temperatura', unidade: '°C', alertaMinimo: 25, alertaMaximo: 45 },
].map((p) => ({ ...p, exibeLocal: true, exigeLocal: false, exibePosicao: true, exigePosicao: false }));
const CATALOGOS = {
  parametros: PARAMETROS,
  instrumentos: [
    { id: 1, descricao: 'Monitor multiparamétrico', parametro: null, padrao: true },
    { id: 2, descricao: 'Oxímetro de pulso', parametro: null, padrao: false },
  ],
  locais: [
    { id: 1, descricao: 'Membro superior direito' },
    { id: 2, descricao: 'Membro superior esquerdo' },
  ],
  posicoes: [
    { id: 1, descricao: 'Sentado' },
    { id: 2, descricao: 'Deitado' },
  ],
  motivos: [
    { id: 1, descricao: 'Paciente em procedimento', exigeComplemento: false },
    { id: 2, descricao: 'Outro motivo', exigeComplemento: true },
  ],
  setores: [
    { id: 10, nome: 'Clínica médica' },
    { id: 11, nome: 'UTI adulto' },
  ],
};

/** Simula as rotas do detalhe da aferição e dos limites como o banco próprio responderia (contrato da web). */
async function simularSinaisDetalhe(page: Page): Promise<void> {
  type Limite = Record<string, unknown> & { id: number; parametro: string };
  const limites: Limite[] = [];
  const afericoes: Record<string, unknown>[] = [];
  let seq = 100;
  const json = (r: Route, corpo: unknown, status = 200) =>
    r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(corpo) });
  const desc = (c: string) => PARAMETROS.find((p) => p.codigo === c)?.descricao ?? c;
  const limite = (c: Record<string, unknown>): Limite => ({
    id: ++seq,
    parametro: String(c.parametro),
    parametroDescricao: desc(String(c.parametro)),
    estabelecimento: 1,
    setor: c.setor ?? null,
    setorNome: CATALOGOS.setores.find((x) => x.id === c.setor)?.nome ?? null,
    instrumento: c.instrumento ?? null,
    instrumentoDescricao: null,
    sexo: c.sexo ?? 'ambos',
    idadeMinimaDias: c.idadeMinimaDias ?? 0,
    idadeMaximaDias: c.idadeMaximaDias ?? null,
    limiteInferior: c.limiteInferior ?? null,
    normalInferior: c.normalInferior ?? null,
    normalSuperior: c.normalSuperior ?? null,
    limiteSuperior: c.limiteSuperior ?? null,
    ativo: true,
    versao: 1,
  });
  await page.route('**/api/enfermagem/afericao/catalogos', (r) => json(r, CATALOGOS));
  await page.route('**/api/enfermagem/limites-sinais/padrao-news2', (r) => {
    const news2: Record<string, number[]> = {
      fc: [40, 51, 90, 131],
      fr: [8, 12, 20, 25],
      temp: [35, 36.1, 38, 39.1],
    };
    const incluidos: string[] = [];
    const jaTinha: string[] = [];
    for (const [parametro, [li, ni, ns, ls]] of Object.entries(news2)) {
      if (limites.some((l) => l.parametro === parametro && l.setor === null)) jaTinha.push(parametro);
      else {
        incluidos.push(parametro);
        limites.push(
          limite({
            parametro,
            setor: null,
            limiteInferior: li,
            normalInferior: ni,
            normalSuperior: ns,
            limiteSuperior: ls,
          }),
        );
      }
    }
    return json(r, {
      ok: true,
      incluidos,
      jaTinha,
      semParametro: [],
      mensagem: incluidos.length
        ? `Limites do NEWS2 incluídos para ${incluidos.length} parâmetro(s).`
        : 'O estabelecimento já tinha os limites do NEWS2.',
    });
  });
  await page.route('**/api/enfermagem/limites-sinais', (r) => {
    if (r.request().method() === 'GET') return json(r, { limites, regras: [] });
    const l = limite(r.request().postDataJSON() as Record<string, unknown>);
    limites.push(l);
    return json(
      r,
      { ok: true, id: l.id, mensagem: 'Limite incluído: vale para as próximas aferições.' },
      201,
    );
  });
  await page.route(`**/api/enfermagem/pacientes/${PACIENTE}/afericoes`, (r) => {
    if (r.request().method() === 'GET') return json(r, { paciente: PACIENTE, itens: afericoes });
    const corpo = r.request().postDataJSON() as { valores: Record<string, unknown>[] };
    const afericao = ++seq;
    const novos: Record<string, unknown>[] = [];
    const valores = corpo.valores.map((v) => {
      const lim = limites.find((l) => l.parametro === v.tipo);
      const x = v.valor as number | null;
      const nivel =
        v.naoAferido || x === null
          ? null
          : !lim
            ? 'normal'
            : x < Number(lim.limiteInferior) || x > Number(lim.limiteSuperior)
              ? 'critico'
              : x < Number(lim.normalInferior) || x > Number(lim.normalSuperior)
                ? 'atencao'
                : 'normal';
      const item = {
        id: ++seq,
        afericao,
        aferidoEm: '2026-11-27T10:00:00',
        tipo: String(v.tipo),
        descricao: desc(String(v.tipo)),
        unidade: PARAMETROS.find((p) => p.codigo === v.tipo)?.unidade ?? null,
        valor: x,
        nivel,
        instrumento: CATALOGOS.instrumentos.find((i) => i.id === v.instrumento)?.descricao ?? null,
        local: CATALOGOS.locais.find((i) => i.id === v.local)?.descricao ?? null,
        posicao: CATALOGOS.posicoes.find((i) => i.id === v.posicao)?.descricao ?? null,
        naoAferido: Boolean(v.naoAferido),
        motivo: CATALOGOS.motivos.find((i) => i.id === v.motivo)?.descricao ?? null,
        justificativa: (v.justificativa as string | null) ?? null,
      };
      novos.push(item);
      return { id: item.id, tipo: item.tipo, nivel, limite: lim?.id ?? null };
    });
    return json(
      r,
      {
        ok: true,
        afericao,
        setor: null,
        valores,
        mensagem: `Aferição registrada (${valores.length} parâmetro(s)).`,
      },
      201,
    );
  });
}

async function entrar(page: Page, login: string): Promise<void> {
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

test.describe('Limites de alerta e aferição detalhada dos sinais vitais @C2-003 @fase3', () => {
  test('NEWS2, limite por setor, aferição com detalhe e não aferido com motivo; axe', async ({ page }) => {
    const externas = vigiarExternas(page);
    await simularSinaisDetalhe(page);
    // Os limites são da coordenação de enfermagem (perfil com conselho: enfermagem.limiteSinal.editar).
    await entrar(page, 'SINT.COORD.ENF');

    // Tela de limites: padrão NEWS2 num clique.
    await page.goto('/enfermagem/limites-sinais');
    const tela = page.getByTestId('tela-limites-sinais');
    await expect(
      tela.getByRole('heading', { level: 1, name: 'Limites de alerta dos sinais vitais' }),
    ).toBeVisible();
    await expect(tela).not.toContainText(/SPDATA|legado|sistema atual/i);
    await page.getByTestId('ls-news2').click();
    await expect(page.getByTestId('ls-feito')).toBeVisible();
    await expect(page.getByTestId('ls-ativos')).toBeVisible();

    // Faixas fora de ordem: a tela avisa na hora e não grava.
    let gravacoes = 0;
    page.on('request', (r) => {
      if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/enfermagem/limites-sinais')
        gravacoes++;
    });
    await escolher(page.getByTestId('ls-parametro'), { indice: 0 });
    await escolher(page.getByTestId('ls-setor'), { indice: 1 });
    await page.getByTestId('ls-normal-inferior').fill('100');
    await page.getByTestId('ls-normal-superior').fill('60');
    await expect(page.getByTestId('ls-problema')).toContainText('em ordem');
    await expect(page.getByTestId('ls-incluir')).toBeDisabled();
    expect(gravacoes).toBe(0);

    // Limite válido do setor: entra na lista dos ativos.
    await page.getByTestId('ls-limite-inferior').fill('40');
    await page.getByTestId('ls-normal-inferior').fill('50');
    await page.getByTestId('ls-normal-superior').fill('100');
    await page.getByTestId('ls-limite-superior').fill('130');
    await expect(page.getByTestId('ls-problema')).toHaveCount(0);
    await semViolacaoAxe(page, '/enfermagem/limites-sinais');
    await page.getByTestId('ls-incluir').click();
    await expect(page.getByTestId('ls-feito')).toBeVisible();
    await expect(page.getByTestId('ls-ativos')).toContainText('130');

    // Sinais vitais do paciente: aferição detalhada, pela enfermeira do plantão.
    await page.context().clearCookies();
    await entrar(page, 'SINT.ENF.PLANTAO');
    await page.goto(`/enfermagem/paciente/${PACIENTE}/sinais-vitais`);
    const painel = page.getByTestId('sd-painel');
    await expect(painel.getByRole('heading', { name: 'Aferição detalhada' })).toBeVisible();
    const parametros = painel.locator('fieldset[data-testid^="sd-param-"]');
    await expect(parametros.first()).toBeVisible();
    const primeiro = (await parametros.nth(0).getAttribute('data-testid'))!.replace('sd-param-', '');
    const segundo = (await parametros.nth(1).getAttribute('data-testid'))!.replace('sd-param-', '');

    // Primeiro parâmetro com valor, instrumento e, quando o cadastro mostra, local e posição.
    await page.getByTestId(`sd-valor-${primeiro}`).fill('80');
    await escolher(page.getByTestId(`sd-instrumento-${primeiro}`), { indice: 1 });
    if (await page.getByTestId(`sd-local-${primeiro}`).count())
      await escolher(page.getByTestId(`sd-local-${primeiro}`), { indice: 1 });
    if (await page.getByTestId(`sd-posicao-${primeiro}`).count())
      await escolher(page.getByTestId(`sd-posicao-${primeiro}`), { indice: 1 });

    // Segundo parâmetro não aferido: sem o motivo, a conferência do domínio avisa na hora e o botão fica preso.
    await page.getByTestId(`sd-nao-${segundo}`).check();
    await expect(page.getByTestId(`sd-erros-${segundo}`)).toContainText('motivo');
    await expect(page.getByTestId('sd-registrar')).toBeDisabled();
    await escolher(page.getByTestId(`sd-motivo-${segundo}`), { indice: 1 });
    if (await page.getByTestId(`sd-complemento-${segundo}`).count())
      await page.getByTestId(`sd-complemento-${segundo}`).fill('Paciente em procedimento');
    await expect(page.getByTestId(`sd-erros-${segundo}`)).toHaveCount(0);
    if (await page.getByTestId('sd-confirmar').count()) await page.getByTestId('sd-confirmar').check();
    await semViolacaoAxe(page, '/enfermagem/paciente/sinais-vitais (aferição detalhada)');
    await page.getByTestId('sd-registrar').click();
    if (await page.getByTestId('sd-confirmar').count()) {
      // O servidor pediu a confirmação pelo limite do setor: confirma e grava de novo.
      await page.getByTestId('sd-confirmar').check();
      await page.getByTestId('sd-registrar').click();
    }
    await expect(page.getByTestId('sd-feito')).toBeVisible();

    // Recentes: o nível em texto e o não aferido com o motivo.
    const recentes = page.getByTestId('sd-recentes');
    await expect(recentes).toBeVisible();
    await expect(recentes.locator('td[data-testid^="sd-nivel-"]').first()).toHaveText(
      /Normal|Atenção|Crítico/,
    );
    await expect(recentes).toContainText('Não aferido');
    expect(externas).toEqual([]);
  });
});
