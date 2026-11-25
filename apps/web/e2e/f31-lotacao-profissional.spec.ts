// E2E @F3.1-09 (02-CAD linha 18): lotação do profissional por estabelecimento e unidade, na aba Lotação da ficha:
// ocupação (CBO, a classificação brasileira de ocupações), carga semanal por tipo com o total na hora, tipo de vínculo
// de trabalho e vigência. A lotação exige o banco próprio, e o E2E roda com a fonte sintética (sem núcleo): as
// respostas destas rotas são simuladas pelo Playwright com massa SINTÉTICA e com estado (o que se grava aparece na
// lista). O que se prova é a tela: o formulário antigo (por registro, em horas por mês) não existe mais; o botão só
// libera com estabelecimento, ocupação e carga entre 1 e 168 horas; as unidades são as do estabelecimento escolhido;
// o corpo do pedido; a recusa do servidor mostrada sem mexer na lista; o aviso de carga somada acima de 60 horas; e
// o encerrar que guarda o fim sem apagar. O efeito no banco (sobreposição e carga acima da semana recusadas,
// estabelecimento fora da sessão recusado, encerrar não apaga) está no contrato de efeito
// (apps/api/src/modulos/cadastro/cadastro-ligacoes.int.spec.ts).
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe } from './ajuda.js';
import { abrirCombo, escolher, esperarValor, fecharCombo } from './combos.js';

const SENHA = 'Sintetico#2026';
const PROF = 4;
const HOJE = '2026-11-24';

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

type Corpo = Record<string, unknown>;
interface Estado {
  itens: Corpo[];
  incluidos: Corpo[];
  encerrados: { caminho: string; corpo: Corpo }[];
}

const ESTABELECIMENTOS = [
  { id: 1, nome: 'HOSPITAL SINTETICO' },
  { id: 2, nome: 'CLINICA SINTETICA' },
];
const UNIDADES = [
  { id: 11, estabelecimento: 1, nome: 'AMBULATORIO SINTETICO' },
  { id: 21, estabelecimento: 2, nome: 'CONSULTORIOS SINTETICOS' },
];
const VINCULOS = [{ id: 5, codigo: '010101', descricao: 'EMPREGATICIO SINTETICO' }];
const OCUPACOES = [{ id: 71, codigo: '225125', descricao: 'MEDICO SINTETICO' }];

/** Simula as rotas da lotação com estado: o que a tela grava volta na leitura seguinte. */
async function simular(page: Page, s: Estado): Promise<void> {
  let proximo = 900;
  const base = `**/api/cadastros/profissionais/${PROF}/lotacoes`;
  await page.route('**/api/cadastros/ligacoes/opcoes**', (r) =>
    json(r, {
      estabelecimentos: ESTABELECIMENTOS,
      unidades: UNIDADES,
      tiposVinculo: VINCULOS,
      ocupacoes: OCUPACOES,
      procedimentos: [],
      especialidades: [],
    }),
  );
  await page.route(base, (r) => {
    if (r.request().method() === 'GET') {
      const cargaHoje = s.itens
        .filter((i) => i['vigente'] === true)
        .reduce((soma, i) => soma + Number(i['cargaSemanal']), 0);
      return json(r, { hoje: HOJE, itens: s.itens, cargaHoje, cargaAlta: cargaHoje > 60 });
    }
    const c = r.request().postDataJSON() as Corpo;
    s.incluidos.push(c);
    // A regra do servidor: duas lotações vigentes no mesmo estabelecimento e unidade não convivem.
    const repetida = s.itens.some(
      (i) =>
        i['vigente'] === true &&
        i['estabelecimento'] === c['estabelecimento'] &&
        i['unidade'] === c['unidade'],
    );
    if (repetida)
      return r.fulfill({
        status: 422,
        contentType: 'application/problem+json',
        body: JSON.stringify({
          type: 'about:blank',
          title: 'Operação recusada',
          status: 422,
          codigo: 'vigencia-sobreposta',
          detail: 'Já existe lotação vigente neste estabelecimento e unidade.',
          campos: ['vigenciaInicio'],
        }),
      });
    const id = ++proximo;
    const carga = Number(c['cargaAmbulatorial']) + Number(c['cargaHospitalar']) + Number(c['cargaOutros']);
    s.itens.push({
      id,
      versao: 1,
      estabelecimento: c['estabelecimento'],
      unidade: c['unidade'],
      estabelecimentoNome: ESTABELECIMENTOS.find((e) => e.id === c['estabelecimento'])?.nome ?? '',
      unidadeNome: UNIDADES.find((u) => u.id === c['unidade'])?.nome ?? null,
      ocupacaoCodigo: '225125',
      ocupacaoDescricao: 'MEDICO SINTETICO',
      tipoVinculoDescricao: c['tipoVinculo'] === 5 ? 'EMPREGATICIO SINTETICO' : null,
      cargaAmbulatorial: c['cargaAmbulatorial'],
      cargaHospitalar: c['cargaHospitalar'],
      cargaOutros: c['cargaOutros'],
      cargaSemanal: carga,
      ocupacaoPadrao: c['ocupacaoPadrao'],
      atendeSus: c['atendeSus'],
      vigenciaInicio: c['vigenciaInicio'],
      vigenciaFim: null,
      vigente: true,
    });
    return json(r, { id }, 201);
  });
  await page.route(`${base}/*/encerrar`, (r) => {
    const caminho = new URL(r.request().url()).pathname;
    const corpo = r.request().postDataJSON() as Corpo;
    s.encerrados.push({ caminho, corpo });
    const id = Number(caminho.split('/').at(-2));
    const item = s.itens.find((i) => i['id'] === id);
    if (item) Object.assign(item, { versao: 2, vigenciaFim: HOJE, vigente: false });
    return json(r, { id });
  });
}

test.describe('lotação do profissional por estabelecimento e unidade @F3.1-09', () => {
  test.setTimeout(180_000);

  test('carga conferida na hora, unidade do estabelecimento, recusa mostrada, carga alta avisada e encerrar sem apagar; axe', async ({
    page,
  }) => {
    const s: Estado = { itens: [], incluidos: [], encerrados: [] };
    await entrar(page, 'SINT.ADMIN');
    await simular(page, s);
    await page.goto(`/cadastros/profissionais/${PROF}`);
    await page.getByTestId('prof-aba-lotacao').click();
    const aba = page.getByTestId('lotacoes-profissional');
    await expect(aba).toBeVisible();
    // O caminho antigo (lotação por registro, em horas por mês) saiu da aba: só existe o formulário novo.
    await expect(page.getByTestId('gravar-lotacao')).toHaveCount(0);
    await expect(page.getByTestId('nl-registro')).toHaveCount(0);
    await expect(page.getByTestId('form-lotacao')).toHaveCount(1);
    await expect(page.getByTestId('lista-lotacoes')).toHaveCount(0);

    // Validação na hora: sem estabelecimento, ocupação e carga, o botão não libera.
    const incluir = page.getByTestId('lotacao-incluir');
    const total = page.getByTestId('lotacao-total');
    await expect(incluir).toBeDisabled();
    await expect(total).toContainText('0 h');
    await expect(total).toHaveClass(/erro/);

    // As unidades oferecidas são só as do estabelecimento escolhido.
    await escolher(page.getByTestId('lot-est'), { rotulo: 'HOSPITAL SINTETICO' });
    const unidades = await abrirCombo(page.getByTestId('lot-un'));
    await expect(unidades.getByRole('option', { name: 'AMBULATORIO SINTETICO' })).toHaveCount(1);
    await expect(unidades.getByRole('option', { name: 'CONSULTORIOS SINTETICOS' })).toHaveCount(0);
    await fecharCombo(page.getByTestId('lot-un'), unidades);
    await escolher(page.getByTestId('lot-un'), { rotulo: 'AMBULATORIO SINTETICO' });
    await escolher(page.getByTestId('lot-cbo'), { rotulo: /225125 MEDICO SINTETICO/ });
    await escolher(page.getByTestId('lot-vinc'), { rotulo: /EMPREGATICIO SINTETICO/ });
    await expect(incluir).toBeDisabled();

    // Carga acima das 168 horas da semana: o total fica marcado e o botão não libera.
    await page.getByTestId('lot-amb').fill('100');
    await page.getByTestId('lot-hosp').fill('80');
    await expect(total).toContainText('180 h');
    await expect(total).toHaveClass(/erro/);
    await expect(incluir).toBeDisabled();
    await page.getByTestId('lot-amb').fill('30');
    await page.getByTestId('lot-hosp').fill('20');
    await expect(total).toContainText('50 h');
    await expect(total).not.toHaveClass(/erro/);
    await expect(incluir).toBeEnabled();

    // Gravação: o pedido leva os ids escolhidos e a carga por tipo; a lotação aparece na lista como vigente.
    await incluir.click();
    await expect(page.getByTestId('lista-lotacoes').locator('li')).toHaveCount(1);
    expect(s.incluidos).toHaveLength(1);
    expect(s.incluidos[0]).toMatchObject({
      estabelecimento: 1,
      unidade: 11,
      ocupacao: 71,
      tipoVinculo: 5,
      cargaAmbulatorial: 30,
      cargaHospitalar: 20,
      cargaOutros: 0,
      vigenciaFim: null,
    });
    expect(String(s.incluidos[0]!['vigenciaInicio'])).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const primeira = page.getByTestId('lotacao-901');
    await expect(primeira).toContainText('HOSPITAL SINTETICO');
    await expect(primeira).toContainText('AMBULATORIO SINTETICO');
    await expect(primeira).toContainText('225125 MEDICO SINTETICO');
    await expect(primeira).toContainText('50 h/semana');
    await expect(primeira).toContainText('EMPREGATICIO SINTETICO');
    await expect(primeira).toContainText('Vigente');
    await expect(page.getByTestId('lotacao-carga-alta')).toHaveCount(0);
    await expect(page.getByTestId('lotacao-erro')).toHaveCount(0);

    // Recusa do servidor (mesmo estabelecimento e unidade ainda vigentes): o erro aparece e a lista não muda.
    await incluir.click();
    await expect(page.getByTestId('lotacao-erro')).toBeVisible();
    expect(s.incluidos).toHaveLength(2);
    await expect(page.getByTestId('lista-lotacoes').locator('li')).toHaveCount(1);

    // Segunda lotação em outro estabelecimento: a unidade antiga não serve mais e a soma passa de 60 h (aviso).
    await escolher(page.getByTestId('lot-est'), { rotulo: 'CLINICA SINTETICA' });
    await esperarValor(page.getByTestId('lot-un'), '');
    await escolher(page.getByTestId('lot-un'), { rotulo: 'CONSULTORIOS SINTETICOS' });
    await page.getByTestId('lot-amb').fill('20');
    await page.getByTestId('lot-hosp').fill('0');
    await expect(total).toContainText('20 h');
    await incluir.click();
    await expect(page.getByTestId('lista-lotacoes').locator('li')).toHaveCount(2);
    await expect(page.getByTestId('lotacao-erro')).toHaveCount(0);
    expect(s.incluidos[2]).toMatchObject({ estabelecimento: 2, unidade: 21, cargaAmbulatorial: 20 });
    await expect(page.getByTestId('lotacao-carga-alta')).toContainText('70 h');

    // Encerrar grava o fim da vigência: a lotação continua na lista, encerrada, e não pode ser encerrada de novo.
    await primeira.getByTestId('lotacao-encerrar').click();
    await expect(primeira).toContainText('Encerrada');
    await expect(primeira.getByTestId('lotacao-encerrar')).toHaveCount(0);
    await expect(page.getByTestId('lista-lotacoes').locator('li')).toHaveCount(2);
    expect(s.encerrados).toEqual([
      {
        caminho: `/api/cadastros/profissionais/${PROF}/lotacoes/901/encerrar`,
        corpo: { versao: 1, fim: null },
      },
    ]);
    await expect(page.getByTestId('lotacao-carga-alta')).toHaveCount(0);
    await expect(page.getByTestId('lotacao-902').getByTestId('lotacao-encerrar')).toHaveCount(1);

    await semViolacaoAxe(page, 'lotação do profissional');
  });
});
