// E2E @C2-106 (06-FAT linha 48): remuneração variável por faixa e rateio da equipe na tela de regras do repasse, sobre a
// porta PRÓPRIA (MariaDB, cliente do E2E). O analista monta uma equipe de dois médicos pela busca, vê na hora a recusa
// das cotas que não somam 100% (60 + 30), corrige para 60/40 e grava; inclui uma regra por faixa para a equipe, vê na
// hora a recusa das faixas sobrepostas, corrige e grava; escolhe a apuração em aberto e confere a simulação da regra
// (período, medida e partes da equipe); encerra a regra no fim do mês (nada apagado) e confere pela API o que ficou no
// banco; axe sem violação séria em cada estado.
//
// Fonte dos dados: sintética. A equipe e a regra só existem no banco próprio (sem ele a API responde 503 e o teste é
// pulado com o motivo). Nada por índice de combo: o evento, a apuração e os dois médicos são lidos pela API e cada
// combo é escolhido pelo id lido. Isolamento entre execuções: código da equipe e da regra únicos por execução, e a
// regra fecha no mês da apuração. Nenhum dado de pessoa sai do teste (só ids em memória).
import { expect, type APIRequestContext, type Page, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const R = '/api/repasse/variavel-faixa';

interface Painel {
  regras: { id: number; codigo: string; equipe: number | null; inicio: string; fim: string | null }[];
  equipes: {
    id: number;
    codigo: string;
    membros: { profissional: number | null; cota: number; fim: string | null }[];
  }[];
  eventos: { id: number }[];
  apuracoes: { id: number; competencia: string; situacao: string }[];
}
interface Favorecido {
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

/** Dois médicos distintos que a busca de prestadores encontra, com o registro de cada um para o combo. */
async function doisMedicos(
  api: APIRequestContext,
): Promise<{ profissional: number; nome: string; registro: number }[]> {
  const r = await api.get('/api/repasse/favorecidos');
  if (!r.ok()) return [];
  const achados: { profissional: number; nome: string; registro: number }[] = [];
  for (const f of ((await r.json()) as { itens: Favorecido[] }).itens) {
    if (!f.ativo || f.tipo !== 'proprio_profissional' || !f.profissionalNome) continue;
    if (achados.some((a) => a.profissional === f.profissional)) continue;
    const lista = (await (
      await api.get(`/api/repasse/prestadores?termo=${encodeURIComponent(f.profissionalNome)}`)
    ).json()) as { prestador: number; registro: number }[];
    // O primeiro achado da busca é o que a tela escolhe; o teste ainda escolhe pelo registro lido.
    const reg = lista.find((x) => x.prestador === f.profissional)?.registro;
    if (reg !== undefined)
      achados.push({ profissional: f.profissional, nome: f.profissionalNome, registro: reg });
    if (achados.length === 2) break;
  }
  return achados;
}

async function adicionarMembro(
  page: Page,
  m: { nome: string; registro: number },
  cota: string,
  chefe: boolean,
): Promise<void> {
  await page.getByTestId('vf-membro-busca').fill(m.nome);
  await page.getByTestId('vf-membro-buscar').click();
  await escolher(page.getByTestId('vf-membro'), String(m.registro));
  await page.getByTestId('vf-membro-cota').fill(cota);
  if (chefe) await page.getByTestId('vf-membro-chefe').check();
  await page.getByTestId('vf-membro-adicionar').click();
}

test.describe('remuneração variável por faixa e rateio da equipe @C2-106', () => {
  test.setTimeout(180_000);

  test('equipe recusada na hora → 60/40 → regra por faixa → simular → encerrar; axe', async ({ page }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.REP.ANALISTA');

    // ── Os dados do cliente do E2E, lidos pela API (nada por índice de combo) ──
    const sonda = await page.request.get(R);
    test.skip(sonda.status() === 503, 'Sessão sem banco próprio: a regra por faixa grava só no MariaDB.');
    expect(sonda.ok()).toBe(true);
    const base = (await sonda.json()) as Painel;
    const apuracao = base.apuracoes[0];
    const evento = base.eventos[0];
    test.skip(!apuracao, 'Sem apuração em aberto no cliente do E2E.');
    test.skip(!evento, 'Sem evento de rendimento no cliente do E2E.');
    const medicos = await doisMedicos(page.request);
    test.skip(medicos.length < 2, 'Sem dois médicos com favorecido próprio achados pela busca.');
    const [a, b] = medicos as [(typeof medicos)[0], (typeof medicos)[0]];
    const de = `${apuracao!.competencia.slice(0, 7)}-01`;
    const ate = ultimoDia(de);
    const sufixo = Date.now().toString(36).toUpperCase();

    await page.goto('/repasse/regras');
    await expect(page.getByTestId('tela-rep-regras')).toBeVisible();
    await expect(page.getByTestId('vf-variavel-faixa')).toBeVisible();
    await expect(page.getByTestId('vf-form-equipe')).toBeVisible();
    await semViolacaoAxe(page, '/repasse/regras (variável por faixa)');

    // ── Equipe: 60 + 30 recusado na hora (a soma precisa dar 100%), corrigido para 60/40 ──
    await page.getByTestId('vf-equipe-codigo').fill(`EQ${sufixo}`);
    await page.getByTestId('vf-equipe-nome').fill(`Equipe sintética ${sufixo}`);
    await page.getByTestId('vf-equipe-inicio').fill(de);
    await adicionarMembro(page, a, '60', true);
    await adicionarMembro(page, b, '30', false);
    await expect(page.getByTestId('vf-soma-cotas')).toContainText('90%');
    await expect(page.getByTestId('vf-equipe-problemas')).toContainText('precisam somar 100%');
    await expect(page.getByTestId('vf-equipe-gravar')).toBeDisabled();
    await page.getByTestId('vf-membro-remover-1').click();
    await adicionarMembro(page, b, '40', false);
    await expect(page.getByTestId('vf-soma-cotas')).toContainText('100%');
    await expect(page.getByTestId('vf-equipe-problemas')).toHaveCount(0);
    const [gravouEquipe] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith(`${R}/equipes`) && r.request().method() === 'POST'),
      page.getByTestId('vf-equipe-gravar').click(),
    ]);
    expect(gravouEquipe.status()).toBe(201);
    const equipe = ((await gravouEquipe.json()) as { id: number }).id;
    await expect(page.getByTestId('vf-mensagem')).toContainText('Gravado');
    await expect(page.getByTestId(`vf-equipe-${equipe}`)).toContainText('60%');
    await expect(page.getByTestId(`vf-equipe-${equipe}`)).toContainText('40%');

    // ── Regra por faixa para a equipe: faixas sobrepostas recusadas na hora, depois corrigidas ──
    await page.getByTestId('vf-regra-codigo').fill(`VF${sufixo}`);
    await page.getByTestId('vf-regra-descricao').fill(`Produtividade sintética ${sufixo}`);
    await escolher(page.getByTestId('vf-regra-beneficiario'), 'equipe');
    await escolher(page.getByTestId('vf-regra-equipe'), String(equipe));
    await escolher(page.getByTestId('vf-regra-indicador'), 'quantidade_procedimentos');
    await escolher(page.getByTestId('vf-regra-periodo'), 'mensal');
    await escolher(page.getByTestId('vf-regra-evento'), String(evento!.id));
    await page.getByTestId('vf-regra-inicio').fill(de);
    await page.getByTestId('vf-regra-fim').fill(ate);
    await page.getByTestId('vf-faixa-0-de').fill('0');
    await page.getByTestId('vf-faixa-0-ate').fill('10');
    await page.getByTestId('vf-faixa-0-percentual').fill('5');
    await page.getByTestId('vf-faixa-adicionar').click();
    await page.getByTestId('vf-faixa-1-de').fill('10');
    await page.getByTestId('vf-faixa-1-percentual').fill('8');
    await expect(page.getByTestId('vf-regra-problemas')).toContainText('se sobrepõem');
    await expect(page.getByTestId('vf-regra-incluir')).toBeDisabled();
    await page.getByTestId('vf-faixa-1-de').fill('11');
    await expect(page.getByTestId('vf-regra-problemas')).toHaveCount(0);
    await semViolacaoAxe(page, '/repasse/regras (regra por faixa preenchida)');
    const [gravouRegra] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith(`${R}/regras`) && r.request().method() === 'POST'),
      page.getByTestId('vf-regra-incluir').click(),
    ]);
    expect(gravouRegra.status()).toBe(201);
    const regra = ((await gravouRegra.json()) as { id: number }).id;
    await expect(page.getByTestId('vf-mensagem')).toContainText('Gravado');
    await expect(page.getByTestId(`vf-regra-${regra}`)).toContainText('Acréscimo');

    // ── Na apuração: a regra do mês com o período, a medida e as duas partes da equipe ──
    await escolher(page.getByTestId('vf-apuracao'), String(apuracao!.id));
    await expect(page.getByTestId('vf-simulacao')).toBeVisible();
    await expect(page.getByTestId(`vf-sim-${regra}`)).toContainText(`Período ${de} a ${ate}`);
    await expect(page.getByTestId(`vf-sim-${regra}-medida`)).toBeVisible();
    await semViolacaoAxe(page, '/repasse/regras (simulação da regra por faixa)');

    // ── Encerrar no último dia do mês: só grava o fim da vigência (nada apagado) ──
    await page.getByTestId(`vf-fim-${regra}`).fill(ate);
    await page.getByTestId(`vf-encerrar-${regra}`).click();
    await expect(page.getByTestId('vf-mensagem')).toContainText('nada foi apagado');

    // O que ficou no banco, pela API: a equipe com as cotas 60/40 vigentes e a regra da equipe fechada no mês.
    const depois = (await (await page.request.get(R)).json()) as Painel;
    const eq = depois.equipes.find((e) => e.id === equipe);
    expect(
      eq?.membros
        .filter((m) => m.fim === null)
        .map((m) => m.cota)
        .sort((x, y) => y - x),
    ).toEqual([60, 40]);
    expect(depois.regras.filter((r) => r.id === regra && r.equipe === equipe && r.fim === ate)).toHaveLength(
      1,
    );
    expect(externas).toEqual([]);
  });
});
