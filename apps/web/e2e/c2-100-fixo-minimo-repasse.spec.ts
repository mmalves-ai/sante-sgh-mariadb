// E2E @C2-100 (06-FAT linha 47): valor fixo mensal e mínimo garantido do médico na tela de regras do repasse, sobre a
// porta PRÓPRIA (MariaDB, cliente do E2E). O analista escolhe o médico pela busca, vê o valor fixo recusado na hora (dia
// de pagamento fora de 1 a 31: o aviso aparece e o botão fica desligado), corrige e inclui o fixo, inclui o mínimo
// garantido, escolhe a apuração em aberto, confere na simulação o fixo da competência e o complemento do mínimo (que
// completa só a produção até o piso), lança e encerra o fixo no fim do mês (nada apagado); axe sem violação séria.
//
// Fonte dos dados: o fixo e o mínimo só existem no banco próprio (sem ele a API responde 503 e o teste é pulado com o
// motivo). Nada por índice de combo: antes da tela, o teste lê pela API o evento de rendimento e a apuração em aberto e
// escolhe cada combo pelo id lido. Isolamento entre execuções: o médico é um profissional com favorecido próprio vigente
// na competência da apuração e SEM fixo nem mínimo que cruze essa competência (lido pela API); o mínimo gravado fecha no
// mês da apuração e o fixo é encerrado no último dia dele. Assim a execução seguinte, no mesmo banco, escolhe outro
// médico em vez de bater no conflito de vigência, que continua recusado pela porta. Faltando algum desses dados, o teste
// é pulado com o motivo dito. Nenhum dado de pessoa sai do teste (só ids em memória).
// Segundo teste: a regra de plantão (remuneração por plantão) cadastrada na mesma tela, com o exemplo calculado na hora.
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
  fixos: (Vigencia & { id: number })[];
  eventos: { id: number }[];
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

// A regra de plantão grava pelo recurso do plantão realizado, que nasce desligado (POL-3): o administrador registra o
// pré-requisito e liga a chave pela tela de liberação, como no E2E W0-06, e recolhe no fim.
const RECURSO_PLANTAO = 'pessoas.plantaoRealizado';
async function abrirLiberacao(page: Page): Promise<void> {
  await entrar(page, 'SINT.ADMIN');
  await page.goto('/administracao/liberacao');
  await expect(page.getByTestId(`recurso-${RECURSO_PLANTAO}`)).toBeVisible({ timeout: 30_000 });
}
async function chavePlantao(page: Page, ligar: boolean, motivo: string): Promise<void> {
  await page.getByTestId(`abrir-${RECURSO_PLANTAO}`).click();
  const form = page.getByTestId('form-liberacao');
  await form.getByTestId(ligar ? 'opcao-ligar' : 'opcao-desligar').check();
  await form.getByLabel('Justificativa').fill(motivo);
  await form.getByTestId('liberacao-senha').fill(SENHA);
  await form.getByTestId('liberacao-aplicar').click();
  await expect(page.getByTestId('mensagem-liberacao')).toContainText('chave(s) alterada(s)');
}
async function ligarPlantao(page: Page, evidencia: string): Promise<void> {
  await abrirLiberacao(page);
  if ((await page.getByTestId(`recurso-${RECURSO_PLANTAO}`).innerText()).includes('Ligada')) return;
  await page.getByTestId(`abrir-${RECURSO_PLANTAO}`).click();
  const pre = page.getByTestId('form-prerequisito');
  await pre.getByLabel('Evidência (protocolo ou número; nunca o certificado ou a senha)').fill(evidencia);
  await pre.locator('#prereq-senha').fill(SENHA);
  await pre.getByRole('button', { name: 'Registrar pré-requisito' }).click();
  await expect(page.getByTestId('mensagem-liberacao')).toBeVisible();
  await chavePlantao(page, true, evidencia);
}

const ultimoDia = (comp: string): string => {
  const [a, m] = comp.split('-').map(Number) as [number, number];
  return `${comp.slice(0, 7)}-${String(new Date(Date.UTC(a, m, 0)).getUTCDate()).padStart(2, '0')}`;
};
const cruza = (v: Vigencia, de: string, ate: string): boolean =>
  v.inicio <= ate && (v.fim === null || v.fim >= de);

/** O médico livre da execução: favorecido próprio vigente na competência e nenhum fixo/mínimo cruzando o mês. */
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
    // Um fixo aberto (sem fim) cruza qualquer mês seguinte: o médico com fixo aberto também fica de fora.
    if (![...p.minimos, ...p.fixos].some((v) => v.fim === null || cruza(v, de, ate)))
      return { profissional: f.profissional, nome: f.profissionalNome };
    if (vistos.size >= 40) break;
  }
  return null;
}

test.describe('valor fixo mensal e mínimo garantido do repasse @C2-100', () => {
  test.setTimeout(180_000);

  test('fixo recusado na hora → fixo → mínimo → simular → lançar → encerrar o fixo; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.REP.ANALISTA');

    // ── Os dados do cliente do E2E, lidos pela API (nada por índice de combo) ──
    const sonda = await page.request.get(R);
    test.skip(sonda.status() === 503, 'Sessão sem banco próprio: o fixo e o mínimo gravam só no MariaDB.');
    expect(sonda.ok()).toBe(true);
    const base = (await sonda.json()) as Painel;
    const apuracao = base.apuracoes[0];
    const evento = base.eventos[0];
    test.skip(!apuracao, 'Sem apuração em aberto no cliente do E2E.');
    test.skip(!evento, 'Sem evento de rendimento no cliente do E2E.');
    const de = `${apuracao!.competencia.slice(0, 7)}-01`;
    const ate = ultimoDia(de);
    const medico = await medicoLivre(page.request, de, ate);
    test.skip(
      medico === null,
      'Sem médico com favorecido próprio vigente e sem fixo nem mínimo na competência da apuração.',
    );
    const achados = (await (
      await page.request.get(`/api/repasse/prestadores?termo=${encodeURIComponent(medico!.nome)}`)
    ).json()) as { prestador: number; registro: number }[];
    const registro = achados.find((x) => x.prestador === medico!.profissional)?.registro;
    test.skip(registro === undefined, 'O médico livre não aparece na busca de prestadores.');

    await page.goto('/repasse/regras');
    await expect(page.getByTestId('tela-rep-regras')).toBeVisible();
    await expect(page.getByTestId('rf-fixo-minimo')).toBeVisible();

    // O médico pela busca (nome · conselho), escolhido pelo registro lido.
    await page.getByTestId('rf-medico-busca').fill(medico!.nome);
    await page.getByTestId('rf-medico-buscar').click();
    await escolher(page.getByTestId('rf-medico'), String(registro));
    await expect(page.getByTestId('rf-form-fixo')).toBeVisible();
    await semViolacaoAxe(page, '/repasse/regras (fixo e mínimo)');

    // Valor fixo: o dia de pagamento fora de 1 a 31 é recusado na hora, sem ir ao servidor.
    await page.getByTestId('rf-fixo-descricao').fill('Coordenação sintética do E2E');
    await page.getByTestId('rf-fixo-valor').fill('1500');
    await page.getByTestId('rf-fixo-dia').fill('32');
    await escolher(page.getByTestId('rf-fixo-evento'), String(evento!.id));
    await page.getByTestId('rf-fixo-inicio').fill(de);
    await expect(page.getByTestId('rf-fixo-problemas')).toContainText('entre 1 e 31');
    await expect(page.getByTestId('rf-fixo-incluir')).toBeDisabled();
    await page.getByTestId('rf-fixo-dia').fill('10');
    await expect(page.getByTestId('rf-fixo-problemas')).toHaveCount(0);
    const [gravouFixo] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith(`${R}/fixos`) && r.request().method() === 'POST'),
      page.getByTestId('rf-fixo-incluir').click(),
    ]);
    expect(gravouFixo.status()).toBe(201);
    const fixo = ((await gravouFixo.json()) as { id: number }).id;
    await expect(page.getByTestId('rf-mensagem')).toContainText('Gravado');
    await expect(page.getByTestId(`rf-fixo-${fixo}`)).toContainText('1.500,00');

    // Mínimo garantido, com a vigência fechada no mês da apuração e o piso acima de qualquer produção sintética.
    await page.getByTestId('rf-minimo-valor').fill('50000');
    await escolher(page.getByTestId('rf-minimo-evento'), String(evento!.id));
    await page.getByTestId('rf-minimo-inicio').fill(de);
    await page.getByTestId('rf-minimo-fim').fill(ate);
    await expect(page.getByTestId('rf-minimo-problemas')).toHaveCount(0);
    await page.getByTestId('rf-minimo-incluir').click();
    await expect(page.getByTestId('rf-mensagem')).toContainText('Gravado');
    await expect(page.getByTestId('rf-minimos')).toContainText('50.000,00');

    // Na apuração: o fixo entra uma vez na competência e o complemento completa só a produção até o piso.
    await escolher(page.getByTestId('rf-apuracao'), String(apuracao!.id));
    await expect(page.getByTestId('rf-simulacao')).toBeVisible();
    await expect(page.getByTestId('rf-item-valor_fixo')).toHaveCount(1);
    await expect(page.getByTestId('rf-item-valor_fixo')).toContainText('1.500,00');
    await expect(page.getByTestId('rf-item-valor_fixo')).toContainText('a lançar');
    await expect(page.getByTestId('rf-item-complemento_minimo')).toBeVisible();
    await semViolacaoAxe(page, '/repasse/regras (simulação do fixo e do mínimo)');
    await page.getByTestId('rf-lancar').click();
    await expect(page.getByTestId('rf-mensagem')).toContainText('lançamento(s)');
    await expect(page.getByTestId('rf-simulacao')).not.toContainText('a lançar');
    await expect(page.getByTestId('rf-lancar')).toBeDisabled();

    // Encerrar o fixo no último dia do mês da apuração: só grava o fim da vigência (nada apagado).
    await page.getByTestId(`rf-fim-fixo-${fixo}`).fill(ate);
    await page.getByTestId(`rf-encerrar-fixo-${fixo}`).click();
    await expect(page.getByTestId('rf-mensagem')).toContainText('nada foi apagado');

    // O que ficou no banco, pela API: o fixo encerrado no mês e o mínimo fechado nele, ambos do médico.
    const depois = (await (
      await page.request.get(`${R}?profissional=${medico!.profissional}`)
    ).json()) as Painel;
    expect(depois.fixos.filter((v) => v.id === fixo && v.inicio === de && v.fim === ate)).toHaveLength(1);
    expect(depois.minimos.filter((v) => v.inicio === de && v.fim === ate)).toHaveLength(1);

    expect(externas).toEqual([]);
  });

  // Regra de plantão (remuneração por plantão): recusada na hora sem recorte, exemplo calculado (dia útil, fim de semana
  // com fator e feriado pelo percentual), inclusão, conferência pela API do que ficou no banco e encerramento da vigência
  // (nada apagado). Isolamento: descrição única por execução e vigência num ano futuro, encerrada no próprio dia.
  test('regra de plantão: recusa na hora → exemplo calculado → incluir → encerrar; axe', async ({ page }) => {
    const externas = vigiarExternas(page);
    await ligarPlantao(page, 'Conferência sintética da coordenação médica (E2E C2-100)');
    await entrar(page, 'SINT.REP.ANALISTA');
    const P = '/api/pessoas/realizado';
    const sonda = await page.request.get(`${P}/regras-plantao`);
    test.skip(sonda.status() === 503, 'Sessão sem banco próprio: a regra de plantão grava só no MariaDB.');
    test.skip(sonda.status() === 403, 'O perfil do E2E não lê o plantão realizado.');
    expect(sonda.ok()).toBe(true);
    const apoio = (await (await page.request.get(`${P}/apoio`)).json()) as {
      unidades: { codigo: number }[];
      acoes: { lancar: boolean; tarifa: boolean };
    };
    const setor = apoio.unidades[0]?.codigo;
    test.skip(setor === undefined, 'Sem setor no estabelecimento do E2E.');

    await page.goto('/repasse/regras');
    await expect(page.getByTestId('rp-regras-plantao')).toBeVisible();
    test.skip(
      !(await page.getByTestId('rp-form').isVisible()),
      'O perfil do E2E não cadastra regra de plantão.',
    );

    const nome = `PLANTAO E2E ${Date.now().toString(36).toUpperCase()}`;
    const inicio = `2040-0${1 + (Date.now() % 9)}-01`;
    await page.getByTestId('rp-descricao').fill(nome);
    await page.getByTestId('rp-valorPadrao').fill('1200');
    // Sem setor, escala nem profissional: recusado na hora, botão desligado.
    await expect(page.getByTestId('rp-problema')).toContainText('profissional, a escala ou o setor');
    await expect(page.getByTestId('rp-incluir')).toBeDisabled();
    await escolher(page.getByTestId('rp-setor'), String(setor));
    await escolher(page.getByTestId('rp-forma'), 'por_plantao');
    await page.getByTestId('rp-horas').fill('12');
    await page.getByTestId('rp-valorFimSemana').fill('1500');
    await page.getByTestId('rp-fator').fill('1,2');
    await page.getByTestId('rp-percentualFeriado').fill('100');
    await page.getByTestId('rp-inicio').fill(inicio);
    // O exemplo de 12 h pela mesma regra do servidor: 1200 × 1,2; 1500 × 1,2; (1200 + 100%) × 1,2.
    await expect(page.getByTestId('rp-exemplo-util')).toContainText('1.440,00');
    await expect(page.getByTestId('rp-exemplo-fim_semana')).toContainText('1.800,00');
    await expect(page.getByTestId('rp-exemplo-feriado')).toContainText('2.880,00');
    await semViolacaoAxe(page, '/repasse/regras');
    await page.getByTestId('rp-incluir').click();
    await expect(page.getByTestId('rp-mensagem')).toContainText('Regra de plantão incluída');

    // O que ficou no banco, pela API.
    type Regra = {
      id: number;
      descricao: string;
      setor: number | null;
      valorPadrao: number;
      fator: number | null;
      inicio: string;
      fim: string | null;
    };
    const lidas = ((await (await page.request.get(`${P}/regras-plantao`)).json()) as { itens: Regra[] })
      .itens;
    const regra = lidas.find((r) => r.descricao === nome);
    expect(regra).toMatchObject({ setor, valorPadrao: 1200, fator: 1.2, inicio, fim: null });

    // Encerrar no próprio dia do início: só grava o fim da vigência.
    await page.getByTestId(`rp-fim-${regra!.id}`).fill(inicio);
    await page.getByTestId(`rp-encerrar-${regra!.id}`).click();
    await expect(page.getByTestId('rp-mensagem')).toContainText('encerrada');
    const depois = ((await (await page.request.get(`${P}/regras-plantao`)).json()) as { itens: Regra[] })
      .itens;
    expect(depois.filter((r) => r.id === regra!.id && r.fim === inicio)).toHaveLength(1);
    expect(externas).toEqual([]);

    // Recolher: a chave volta a desligada.
    await abrirLiberacao(page);
    await chavePlantao(page, false, 'Recolher o E2E C2-100');
  });
});
