// E2E @C2-083 (07-FIN linha 157): remuneração variável do profissional, sobre a porta PRÓPRIA (MariaDB, cliente do
// E2E). O analista escolhe o médico pela busca, inclui o mínimo garantido, vê as faixas sobrepostas recusadas na hora (o
// botão fica desligado e o aviso aparece), corrige e inclui a meta de produtividade, informa o valor apurado da
// competência, escolhe a apuração em aberto, confere a simulação (lançado/a lançar) e lança; axe sem violação séria.
//
// Fonte dos dados: a remuneração variável só existe no banco próprio (sem ele a API responde 503 e o teste é pulado com o
// motivo). O teste não depende de índice de combo: antes da tela, ele lê pela API o evento de rendimento, o indicador e
// a apuração em aberto do cliente do E2E e escolhe cada combo pelo id lido. Isolamento entre execuções: o médico é um
// profissional com favorecido próprio vigente na competência da apuração e SEM mínimo nem meta que cruze essa
// competência (lido pela API); as regras gravadas têm a vigência fechada no mês da apuração (início no 1º dia, fim no
// último). Assim a execução seguinte, no mesmo banco, escolhe outro médico em vez de bater no conflito de vigência, que
// continua recusado pela porta. Faltando algum desses dados, o teste é pulado com o motivo dito. Nenhum dado de pessoa
// sai do teste (só ids em memória).
import { expect, type APIRequestContext, type Page, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const R = '/api/repasse/remuneracao-variavel';

interface Vigencia {
  inicio: string;
  fim: string | null;
}
interface Painel {
  minimos: Vigencia[];
  metas: Vigencia[];
  eventos: { id: number }[];
  indicadores: { id: number }[];
  apuracoes: { id: number; competencia: string; situacao: string }[];
}
interface Favorecido extends Vigencia {
  profissional: number;
  profissionalNome: string | null;
  tipo: string;
  ativo: boolean;
}

async function entrar(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

const ultimoDia = (comp: string): string => {
  const [a, m] = comp.split('-').map(Number) as [number, number];
  return `${comp.slice(0, 7)}-${String(new Date(Date.UTC(a, m, 0)).getUTCDate()).padStart(2, '0')}`;
};
const cruza = (v: Vigencia, de: string, ate: string): boolean =>
  v.inicio <= ate && (v.fim === null || v.fim >= de);

/** O médico livre da execução: favorecido próprio vigente na competência e nenhum mínimo/meta cruzando o mês. */
async function medicoLivre(
  api: APIRequestContext,
  de: string,
  ate: string,
): Promise<{ profissional: number; nome: string } | null> {
  const r = await api.get('/api/repasse/favorecidos');
  if (!r.ok()) return null;
  const vistos = new Set<number>();
  for (const f of ((await r.json()) as { itens: Favorecido[] }).itens) {
    if (vistos.has(f.profissional) || !f.ativo || f.tipo !== 'proprio_profissional' || !f.profissionalNome)
      continue;
    if (!cruza(f, de, ate) || f.inicio > de) continue;
    vistos.add(f.profissional);
    const p = (await (await api.get(`${R}?profissional=${f.profissional}`)).json()) as Painel;
    if (![...p.minimos, ...p.metas].some((v) => cruza(v, de, ate)))
      return { profissional: f.profissional, nome: f.profissionalNome };
    if (vistos.size >= 40) break;
  }
  return null;
}

test.describe('remuneração variável do profissional @C2-083', () => {
  test.setTimeout(180_000);

  test('mínimo → faixas recusadas na hora → meta → valor apurado → simular → lançar; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.REP.ANALISTA');

    // ── Os dados do cliente do E2E, lidos pela API (nada por índice de combo) ──
    const sonda = await page.request.get(R);
    test.skip(
      sonda.status() === 503,
      'Sessão sem banco próprio: a remuneração variável grava só no MariaDB.',
    );
    expect(sonda.ok()).toBe(true);
    const base = (await sonda.json()) as Painel;
    const apuracao = base.apuracoes[0];
    const evento = base.eventos[0];
    const indicador = base.indicadores[0];
    test.skip(!apuracao, 'Sem apuração em aberto no cliente do E2E.');
    test.skip(!evento, 'Sem evento de rendimento no cliente do E2E.');
    test.skip(!indicador, 'Sem indicador de produtividade no cliente do E2E.');
    const de = `${apuracao!.competencia.slice(0, 7)}-01`;
    const ate = ultimoDia(de);
    const medico = await medicoLivre(page.request, de, ate);
    test.skip(
      medico === null,
      'Sem médico com favorecido próprio vigente e sem regra variável na competência da apuração.',
    );
    const achados = (await (
      await page.request.get(`/api/repasse/prestadores?termo=${encodeURIComponent(medico!.nome)}`)
    ).json()) as { prestador: number; registro: number }[];
    const registro = achados.find((x) => x.prestador === medico!.profissional)?.registro;
    test.skip(registro === undefined, 'O médico livre não aparece na busca de prestadores.');

    await page.goto('/repasse/remuneracao-variavel');
    await expect(page.getByTestId('tela-rep-remuneracao-variavel')).toBeVisible();

    // O médico pela busca (nome · conselho), escolhido pelo registro lido.
    await page.getByTestId('rv-medico-busca').fill(medico!.nome);
    await page.getByTestId('rv-medico-buscar').click();
    await escolher(page.getByTestId('rv-medico'), String(registro));
    await expect(page.getByTestId('rv-min-incluir')).toBeVisible();
    await semViolacaoAxe(page, '/repasse/remuneracao-variavel');

    // Mínimo garantido, com a vigência fechada no mês da apuração: sem evento o botão fica desligado; com tudo, grava.
    await page.getByTestId('rv-min-valor').fill('5000');
    await page.getByTestId('rv-min-inicio').fill(de);
    await page.getByTestId('rv-min-fim').fill(ate);
    await expect(page.getByTestId('rv-min-incluir')).toBeDisabled();
    await escolher(page.getByTestId('rv-min-evento'), String(evento!.id));
    await expect(page.getByTestId('rv-min-incluir')).toBeEnabled();
    await page.getByTestId('rv-min-incluir').click();
    await expect(page.getByTestId('rv-mensagem')).toContainText('Gravado');
    await expect(page.getByTestId('rv-minimos')).toContainText('5.000,00');

    // Meta de produtividade: faixas sobrepostas recusadas na hora, sem ir ao servidor.
    await escolher(page.getByTestId('rv-meta-indicador'), String(indicador!.id));
    await escolher(page.getByTestId('rv-meta-forma'), { rotulo: /% da produção/ });
    await escolher(page.getByTestId('rv-meta-evento'), String(evento!.id));
    await page.getByTestId('rv-meta-inicio').fill(de);
    await page.getByTestId('rv-meta-fim').fill(ate);
    await page.getByTestId('rv-faixa-de-0').fill('80');
    await page.getByTestId('rv-faixa-ate-0').fill('100');
    await page.getByTestId('rv-faixa-premio-0').fill('5');
    await page.getByTestId('rv-faixa-mais').click();
    await page.getByTestId('rv-faixa-de-1').fill('95');
    await page.getByTestId('rv-faixa-premio-1').fill('10');
    await expect(page.getByTestId('rv-faixas-problemas')).toContainText('se sobrepõem');
    await expect(page.getByTestId('rv-meta-incluir')).toBeDisabled();
    await page.getByTestId('rv-faixa-de-1').fill('100.01');
    await expect(page.getByTestId('rv-faixas-problemas')).toHaveCount(0);
    const [gravouMeta] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith(`${R}/metas`) && r.request().method() === 'POST'),
      page.getByTestId('rv-meta-incluir').click(),
    ]);
    expect(gravouMeta.status()).toBe(201);
    const meta = ((await gravouMeta.json()) as { id: number }).id;
    await expect(page.getByTestId('rv-mensagem')).toContainText('Gravado');
    await expect(page.getByTestId('rv-metas')).toBeVisible();

    // Valor apurado na competência da apuração, na linha da meta recém-gravada.
    await page.getByTestId(`rv-apu-comp-${meta}`).fill(de.slice(0, 7));
    await page.getByTestId(`rv-apu-valor-${meta}`).fill('92');
    await page.getByTestId(`rv-apu-informar-${meta}`).click();
    await expect(page.getByTestId('rv-mensagem')).toContainText('Gravado');
    await expect(page.getByTestId(`rv-apurados-${meta}`)).toContainText('92');

    // Na apuração: simulação com o complemento do mínimo, depois o lançamento (o favorecido próprio está vigente).
    await escolher(page.getByTestId('rv-apuracao'), String(apuracao!.id));
    await expect(page.getByTestId('rv-sim-itens')).toBeVisible();
    await expect(page.getByTestId('rv-sim-itens')).toContainText('a lançar');
    await semViolacaoAxe(page, '/repasse/remuneracao-variavel (apuração)');
    await page.getByTestId('rv-lancar').click();
    await expect(page.getByTestId('rv-mensagem')).toContainText('lançamento(s)');
    await expect(page.getByTestId('rv-sim-itens')).not.toContainText('a lançar');
    await expect(page.getByTestId('rv-lancar')).toBeDisabled();

    // O que ficou no banco, pela API: as duas regras do médico fechadas no mês da apuração.
    const depois = (await (
      await page.request.get(`${R}?profissional=${medico!.profissional}`)
    ).json()) as Painel;
    expect(depois.minimos.filter((v) => v.inicio === de && v.fim === ate)).toHaveLength(1);
    expect(depois.metas.filter((v) => v.inicio === de && v.fim === ate)).toHaveLength(1);

    expect(externas).toEqual([]);
  });
});
