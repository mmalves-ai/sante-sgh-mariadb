// E2E @C2-106 (06-FAT linha 48): remuneração variável por faixa e rateio da equipe na tela de regras do repasse, sobre a
// porta PRÓPRIA (MariaDB, cliente do E2E). O analista monta uma equipe de dois médicos pela busca, vê na hora a recusa
// das cotas que não somam 100% (60 + 30), corrige para 60/40 e grava; inclui uma regra por faixa para a equipe, vê na
// hora a recusa das faixas sobrepostas, corrige e grava; recompõe a equipe (a composição anterior ganha fim, nada é
// apagado); escolhe a apuração em aberto e confere a simulação da regra (período, medida, faixa aplicada, valor e as
// partes 60/40 da equipe); lança a remuneração variável (mensagem com a quantidade, partes marcadas como lançadas e
// o botão sem segundo lançamento); encerra a regra no fim do mês (nada apagado) e confere pela API o que ficou no
// banco; axe sem violação séria em cada estado. As faixas têm valor fixo, para o valor não depender da produção.
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
    membros: {
      profissional: number | null;
      cota: number;
      chefe: boolean;
      inicio: string;
      fim: string | null;
    }[];
  }[];
  eventos: { id: number }[];
  apuracoes: { id: number; competencia: string; situacao: string }[];
}
interface Simulacao {
  regras: {
    regra: number;
    medida: number;
    faixa: number | null;
    valor: number;
    fecha: boolean;
    pendencias: string[];
    partes: { profissional: number | null; cota: number; valor: number; lancado: boolean }[];
  }[];
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

const isoLocal = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const diaSeguinte = (iso: string): string => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + 1);
  return isoLocal(d);
};

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

  test('equipe recusada na hora → 60/40 → recompor → regra por faixa → simular → lançar → encerrar; axe', async ({
    page,
  }) => {
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

    // ── Nova composição: o outro médico passa a chefe com 60%; a anterior ganha fim no dia anterior (nada apagado) ──
    const hoje = isoLocal(new Date());
    const novaData = hoje > de ? hoje : diaSeguinte(de);
    await page.getByTestId(`vf-recompor-${equipe}`).click();
    await expect(page.getByTestId('vf-membros')).toBeVisible();
    await page.getByTestId('vf-equipe-inicio').fill(novaData);
    await page.getByTestId('vf-membro-remover-1').click();
    await page.getByTestId('vf-membro-remover-0').click();
    await adicionarMembro(page, b, '60', true);
    await adicionarMembro(page, a, '40', false);
    await expect(page.getByTestId('vf-soma-cotas')).toContainText('100%');
    const [recompos] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().endsWith(`${R}/equipes/${equipe}/recompor`) && r.request().method() === 'POST',
      ),
      page.getByTestId('vf-equipe-gravar').click(),
    ]);
    expect(recompos.status()).toBe(200);
    await expect(page.getByTestId('vf-mensagem')).toContainText('Gravado');
    const aposRecompor = (await (await page.request.get(R)).json()) as Painel;
    const historico = aposRecompor.equipes.find((e) => e.id === equipe)?.membros ?? [];
    const ontem = isoLocal(new Date(new Date(`${novaData}T12:00:00`).getTime() - 86_400_000));
    // A composição anterior fica no histórico com fim no dia anterior; a nova é a vigente (b chefe 60, a 40).
    expect(
      historico
        .filter((m) => m.fim === ontem)
        .map((m) => [m.profissional, m.cota])
        .sort(),
    ).toEqual(
      [
        [a.profissional, 60],
        [b.profissional, 40],
      ].sort(),
    );
    expect(
      historico
        .filter((m) => m.fim === null && m.inicio === novaData)
        .map((m) => [m.profissional, m.cota, m.chefe])
        .sort(),
    ).toEqual(
      [
        [b.profissional, 60, true],
        [a.profissional, 40, false],
      ].sort(),
    );

    // ── Regra por faixa para a equipe: faixas sobrepostas recusadas na hora, depois corrigidas ──
    await page.getByTestId('vf-regra-codigo').fill(`VF${sufixo}`);
    await page.getByTestId('vf-regra-descricao').fill(`Produtividade sintética ${sufixo}`);
    await escolher(page.getByTestId('vf-regra-beneficiario'), 'equipe');
    await escolher(page.getByTestId('vf-regra-equipe'), String(equipe));
    await escolher(page.getByTestId('vf-regra-indicador'), 'quantidade_procedimentos');
    await escolher(page.getByTestId('vf-regra-periodo'), 'mensal');
    await escolher(page.getByTestId('vf-regra-evento'), String(evento!.id));
    // Sem fim na inclusão: o encerramento adiante é que fecha a regra no mês (encerrar nunca estende).
    await page.getByTestId('vf-regra-inicio').fill(de);
    await page.getByTestId('vf-faixa-0-de').fill('0');
    await page.getByTestId('vf-faixa-0-ate').fill('10');
    await page.getByTestId('vf-faixa-0-percentual').fill('5');
    await page.getByTestId('vf-faixa-0-valor-fixo').fill('100');
    await page.getByTestId('vf-faixa-adicionar').click();
    await page.getByTestId('vf-faixa-1-de').fill('10');
    await page.getByTestId('vf-faixa-1-percentual').fill('8');
    await page.getByTestId('vf-faixa-1-valor-fixo').fill('200');
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

    // ── Na apuração: a regra do mês com o período, a medida, a faixa, o valor e as duas partes 60/40 da equipe ──
    const [simulou] = await Promise.all([
      page.waitForResponse((r) => r.url().includes(`${R}/simulacao`) && r.request().method() === 'GET'),
      escolher(page.getByTestId('vf-apuracao'), String(apuracao!.id)),
    ]);
    expect(simulou.ok()).toBe(true);
    const sim = ((await simulou.json()) as Simulacao).regras.find((r) => r.regra === regra);
    expect(sim).toBeDefined();
    await expect(page.getByTestId('vf-simulacao')).toBeVisible();
    await expect(page.getByTestId(`vf-sim-${regra}`)).toContainText(`Período ${de} a ${ate}`);
    await expect(page.getByTestId(`vf-sim-${regra}-medida`)).toHaveText(String(sim!.medida));
    // Contagem inteira: até 10 cai na faixa 1 (5% + R$ 100), de 11 em diante na faixa 2 (8% + R$ 200).
    const faixaEsperada = sim!.medida <= 10 ? 1 : 2;
    expect(sim!.faixa).toBe(faixaEsperada);
    await expect(page.getByTestId(`vf-sim-${regra}-faixa`)).toContainText(`na faixa ${faixaEsperada}`);
    expect(sim!.valor).toBeGreaterThanOrEqual(faixaEsperada === 1 ? 100 : 200);
    expect(sim!.fecha).toBe(true);
    expect(sim!.pendencias).toEqual([]);
    // Rateio pelas cotas: 60% e 40% do valor (o centavo que sobra vai ao chefe), e a soma fecha no valor.
    const centavos = Math.round(sim!.valor * 100);
    const partes = [...sim!.partes].sort((x, y) => y.cota - x.cota);
    expect(partes.map((p) => p.cota)).toEqual([60, 40]);
    expect(Math.round(partes[1]!.valor * 100)).toBe(Math.round((centavos * 40) / 100));
    expect(Math.round(partes[0]!.valor * 100) + Math.round(partes[1]!.valor * 100)).toBe(centavos);
    expect(partes.every((p) => !p.lancado)).toBe(true);
    for (const i of [0, 1]) {
      await expect(page.getByTestId(`vf-sim-${regra}-parte-${i}`)).toContainText(/60%|40%/);
      await expect(page.getByTestId(`vf-sim-${regra}-parte-${i}`)).toContainText('a lançar');
    }
    await semViolacaoAxe(page, '/repasse/regras (simulação da regra por faixa)');

    // ── Lançar: a mensagem traz a quantidade; as partes passam a lançadas; o botão não lança de novo ──
    await expect(page.getByTestId('vf-lancar')).toBeEnabled();
    const [lancou] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith(`${R}/lancar`) && r.request().method() === 'POST'),
      page.getByTestId('vf-lancar').click(),
    ]);
    expect(lancou.status()).toBe(200);
    const lanc = (await lancou.json()) as { lancamentos: number };
    expect(lanc.lancamentos).toBeGreaterThanOrEqual(2);
    await expect(page.getByTestId('vf-mensagem')).toContainText(
      `${lanc.lancamentos} lançamento(s) gravado(s)`,
    );
    const reSim = (await (
      await page.request.get(`${R}/simulacao?apuracao=${apuracao!.id}`)
    ).json()) as Simulacao;
    const lancada = reSim.regras.find((r) => r.regra === regra);
    expect(lancada?.partes.map((p) => p.lancado)).toEqual([true, true]);
    for (const i of [0, 1])
      await expect(page.getByTestId(`vf-sim-${regra}-parte-${i}`)).toContainText('lançado');
    // Segundo clique: o botão fica desabilitado e nenhuma chamada de lançamento sai.
    let novosLancamentos = 0;
    page.on('request', (q) => {
      if (q.url().endsWith(`${R}/lancar`) && q.method() === 'POST') novosLancamentos += 1;
    });
    await expect(page.getByTestId('vf-lancar')).toBeDisabled();
    await page.getByTestId('vf-lancar').click({ force: true });
    await page.waitForTimeout(500);
    expect(novosLancamentos).toBe(0);

    // ── Encerrar no último dia do mês: só grava o fim da vigência (nada apagado) ──
    await page.getByTestId(`vf-fim-${regra}`).fill(ate);
    await page.getByTestId(`vf-encerrar-${regra}`).click();
    await expect(page.getByTestId('vf-mensagem')).toContainText('nada foi apagado');

    // O que ficou no banco, pela API: a equipe com as cotas 60/40 vigentes (a anterior no histórico) e a regra da
    // equipe fechada no mês.
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
