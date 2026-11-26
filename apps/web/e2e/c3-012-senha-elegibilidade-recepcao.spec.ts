// E2E @C3-012 (F7, 02-REC linha 37): a senha de autorização e a elegibilidade da operadora na recepção. Quem edita o
// contrato grava uma regra do plano que exige a senha só num setor (unidade assistencial) e vê o alcance na tabela
// (especialidade, serviço e setor). Na abertura do atendimento, a recepção vê o bloco de elegibilidade e senha (carteiras
// do paciente com a última consulta, consulta em um clique) e a prévia da regra do plano passa a conferir a senha.
// A elegibilidade do paciente vem de resposta sintética (rota interceptada). A regra do plano mora no banco do
// estabelecimento, que a esteira não tem (a API responde 503 sem ele): a tela das regras fala com rotas simuladas de
// massa sintética, que guardam a regra gravada e conferem o pedido (setor e senha). Fonte sintética; axe nas duas telas.
import { expect, test, type Page, type Route } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';

async function entrar(page: Page, login: string): Promise<void> {
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

const P = '/api/atendimento/regras-plano';
const FONTE = { id: 71, rotulo: 'OPERADORA ALFA SINTETICA' };
const SETORES = [
  { id: 801, rotulo: 'SETOR SINTETICO 1' },
  { id: 802, rotulo: 'SETOR SINTETICO 2' },
];

const responder = (rota: Route, corpo: unknown) =>
  rota.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(corpo) });

/** As rotas da regra do plano com massa sintética: as fontes, as regras da fonte e a inclusão (guarda o pedido). */
async function simularRegrasPlano(page: Page): Promise<{ pedidos: Record<string, unknown>[] }> {
  const pedidos: Record<string, unknown>[] = [];
  const regras: Record<string, unknown>[] = [];
  await page.route(`**${P}/fontes`, (rota) => responder(rota, [FONTE]));
  await page.route(
    (u) => u.pathname === P,
    (rota) => {
      const r = rota.request();
      if (r.method() === 'GET')
        return responder(rota, {
          fonte: FONTE,
          hoje: '2026-11-26',
          planos: [{ id: 61, rotulo: 'P1 · PLANO SINTETICO' }],
          categorias: [{ id: 51, rotulo: 'CATEGORIA SINTETICA' }],
          especialidades: [{ id: 41, rotulo: 'ESPECIALIDADE SINTETICA' }],
          servicos: [{ id: 901, rotulo: 'SERVICO SINTETICO A' }],
          setores: SETORES,
          regras,
        });
      const a = r.postDataJSON() as Record<string, unknown>;
      pedidos.push(a);
      const id = 700 + regras.length;
      regras.unshift({
        id,
        versao: 1,
        fontePagadoraId: a['fonteId'],
        planoId: a['planoId'],
        categoriaId: a['categoriaId'],
        estabelecimentoId: a['todasUnidades'] ? null : 1,
        especialidadeId: a['especialidadeId'],
        servicoId: a['servicoId'],
        setorId: a['setorId'],
        exigeCarteira: a['exigeCarteira'],
        exigeValidadeCarteira: a['exigeValidadeCarteira'],
        exigeTitular: a['exigeTitular'],
        exigeGuia: a['exigeGuia'],
        exigeSenhaAutorizacao: a['exigeSenhaAutorizacao'],
        exigeCodigoValidacao: a['exigeCodigoValidacao'],
        tamanhoCarteira: a['tamanhoCarteira'],
        prefixoCarteira: a['prefixoCarteira'],
        permiteDependentes: a['permiteDependentes'],
        prazoRetornoDias: a['prazoRetornoDias'],
        documentosExigidos: a['documentosExigidos'],
        orientacaoRecepcao: a['orientacaoRecepcao'],
        tetoAtendimentos: a['tetoAtendimentos'],
        tetoPeriodoDias: a['tetoPeriodoDias'],
        tetoBloqueia: a['tetoBloqueia'],
        pendencia: a['pendencia'],
        pendenciaMotivo: a['pendenciaMotivo'],
        vigenciaInicio: a['vigenciaInicio'],
        vigenciaFim: a['vigenciaFim'],
        vigente: false,
      });
      return responder(rota, { ok: true, mensagem: 'Regra gravada.', resultado: { id, versao: 1 } });
    },
  );
  return { pedidos };
}

function dataFutura(): string {
  const d = new Date(Date.UTC(2093, 0, 1) + Math.floor(Math.random() * 3_000) * 86_400_000);
  return d.toISOString().slice(0, 10);
}

test.describe('Senha e elegibilidade da operadora na recepção @C3-012 @fase7', () => {
  test('regra da senha por setor gravada com o alcance na tabela; axe', async ({ page }) => {
    const externas = vigiarExternas(page);
    const { pedidos } = await simularRegrasPlano(page);
    await entrar(page, 'SINT.FATURAMENTO');
    await page.goto('/recepcao/atendimento/regras-plano');
    const tela = page.getByTestId('tela-regras-plano');
    await escolher(page.getByTestId('rp-fonte'), { rotulo: /alfa/i });
    await expect(page.getByTestId('rp-setor')).toBeVisible();
    await expect(page.getByTestId('rp-especialidade')).toBeVisible();
    await expect(page.getByTestId('rp-servico')).toBeVisible();
    await escolher(page.getByTestId('rp-setor'), { indice: 1 });
    await page.getByTestId('rp-exigeSenhaAutorizacao').click();
    const inicio = dataFutura();
    await page.getByTestId('rp-campo-vigenciaInicio').fill(inicio);
    await semViolacaoAxe(page, 'regras do plano com setor');
    await page.getByTestId('rp-gravar').click();
    await expect(tela.getByRole('columnheader', { name: 'Especialidade, serviço e setor' })).toBeVisible();
    await expect(
      tela
        .getByRole('cell', { name: /Todas as especialidades · Todos os serviços · (?!Todos os setores)/ })
        .first(),
    ).toBeVisible();
    // O pedido leva o setor escolhido e a senha exigida (só nele), com o início informado.
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0]).toMatchObject({
      acao: 'incluir',
      fonteId: FONTE.id,
      setorId: SETORES[0]!.id,
      especialidadeId: null,
      servicoId: null,
      exigeSenhaAutorizacao: true,
      vigenciaInicio: inicio,
    });
    expect(externas).toEqual([]);
  });

  test('a supervisão da recepção confere a abertura na prévia por especialidade, serviço e setor; axe', async ({
    page,
  }) => {
    // A prévia é a crítica da abertura (POST .../previa pede atendimento.atendimento.abrir): quem só edita o contrato
    // não a vê; a supervisão da recepção, que lê o contrato e abre atendimento, a vê com o alcance da regra.
    const externas = vigiarExternas(page);
    await simularRegrasPlano(page);
    await entrar(page, 'SINT.RECEPCAO.SUPERVISAO');
    await page.goto('/recepcao/atendimento/regras-plano');
    await escolher(page.getByTestId('rp-fonte'), { rotulo: /alfa/i });
    await expect(page.getByTestId('rp-previa-especialidade')).toBeVisible();
    await expect(page.getByTestId('rp-previa-servico')).toBeVisible();
    await expect(page.getByTestId('rp-previa-setor')).toBeVisible();
    await expect(page.getByTestId('rp-previa-senhaAutorizacao')).toBeVisible();
    await expect(page.getByTestId('rp-gravar')).toHaveCount(0);
    await semViolacaoAxe(page, 'prévia das regras do plano');
    expect(externas).toEqual([]);
  });

  test('abertura mostra a elegibilidade e colhe a senha; axe', async ({ page }) => {
    const externas = vigiarExternas(page);
    await page.route('**/api/tiss/elegibilidade/pacientes/*', (rota) =>
      rota.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          coberturas: [
            {
              id: 91,
              fontePagadora: 'OPERADORA ALFA SINTETICA',
              carteira: '000123',
              validade: null,
              ultimaElegibilidadeEm: '2026-11-26',
              ultimaAprovada: true,
            },
          ],
          consultas: [
            {
              id: 501,
              fontePagadora: 'OPERADORA ALFA SINTETICA',
              carteira: '000123',
              situacao: 'elegivel',
              solicitadaEm: '2026-11-26',
              respondidaEm: '2026-11-26',
              motivoNegativa: null,
              codigoValidacao: 'VAL-SINT-1',
              por: 'SINT.GUICHE',
              versao: 1,
              pelaOperadora: false,
            },
          ],
        }),
      }),
    );
    await entrar(page, 'SINT.GUICHE');
    // 02-REC linha 37: os serviços da abertura (fonte sintética), para a regra que vale só num serviço.
    await page.route('**/api/atendimento/regras-plano/servicos', (rota) =>
      rota.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          { id: 901, rotulo: 'SERVICO SINTETICO A' },
          { id: 902, rotulo: 'SERVICO SINTETICO B' },
        ]),
      }),
    );
    await page.goto('/recepcao/atendimento/novo');
    const bloco = page.getByTestId('elegibilidade-abertura');
    await expect(bloco).toBeVisible();
    await expect(page.getByTestId('abrir-senha-convenio')).toBeVisible();
    await expect(page.getByTestId('abrir-validade-senha')).toBeVisible();
    await escolher(page.getByTestId('abrir-servico'), { rotulo: /SERVICO SINTETICO A/ });
    await semViolacaoAxe(page, 'abertura com elegibilidade');
    expect(externas).toEqual([]);
  });
});
