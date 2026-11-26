// E2E @C2-118 (F7, 08-SGO L101): cadastro complementar do prestador na ficha da rede credenciada (/operadora/rede).
// A equipe de credenciamento abre o prestador e, na mesma ficha: inclui o local de atendimento (o CEP errado aparece na
// hora e trava a gravação), inclui a especialidade nesse local (sem regime aparece na hora), registra a qualificação
// divulgada só com os atributos que valem para o prestador, suspende o prestador (aviso de suspenso hoje) e reativa, e
// vê o registro do descredenciamento com o aviso e o substituto. A rede abre na fonte sintética (rede em memória, como
// no m56-4); as rotas do cadastro complementar exigem o banco próprio e são simuladas pelo Playwright com massa
// SINTÉTICA. O efeito no banco está em apps/api/src/modulos/operadora/rede-cadastro-propria.int.spec.ts.
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const PESSOAS = ['SINT.CREDENCIAMENTO', 'SINT.OPE.AUDITOR'];

async function entrar(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}
const csrf = async (page: Page) =>
  (await page.context().cookies()).find((c) => c.name === 'sgh_csrf')?.value ?? '';
async function chave(page: Page, nome: string): Promise<void> {
  const r = await page.request.post('/api/administracao/liberacao', {
    headers: { 'x-csrf': await csrf(page), 'idempotency-key': `e2e-c2-118-${nome}-${Date.now()}` },
    data: {
      chave: nome,
      tipo: 'recurso',
      escopo: 'pessoa',
      valores: PESSOAS,
      ligar: true,
      justificativa: 'Rede credenciada sintética (E2E C2-118)',
      senha: SENHA,
    },
  });
  expect(r.status(), await r.text()).toBe(200);
}
const json = (rota: Route, corpo: unknown, status = 200) =>
  rota.fulfill({ status, contentType: 'application/json', body: JSON.stringify(corpo) });

test.describe('Cadastro complementar do prestador da rede @C2-118 @fase7', () => {
  test.setTimeout(180_000);
  test('local, especialidade, qualificação, suspensão e descredenciamento na ficha; axe', async ({
    page,
  }) => {
    const pedidos: { caminho: string; corpo: Record<string, unknown> }[] = [];
    const ficha = {
      prestador: { id: 0, nome: 'Hospital sintético Beta', pessoa: 'J', hospitalar: true, credenciado: true },
      locais: [] as Record<string, unknown>[],
      especialidades: [] as Record<string, unknown>[],
      qualificacoes: [] as Record<string, unknown>[],
      suspensoes: [] as Record<string, unknown>[],
      descredenciamentos: [
        {
          id: 1,
          tipoMotivo: 'pedido_prestador',
          motivo: 'Saída cancelada a pedido',
          avisoBeneficiariosEm: '2026-10-01',
          efetivoEm: '2026-11-01',
          substituto: 77,
          nomeSubstituto: 'HOSPITAL SINTETICO SUBSTITUTO',
          autorizacaoAns: null,
          situacao: 'cancelado',
          registradoEm: '2026-10-01T10:00:00',
        },
      ],
      suspensoHoje: false,
    };
    const apoio = {
      especialidades: [{ id: 5, codigo: 'CARD', descricao: 'Cardiologia' }],
      atributos: [
        {
          id: 9,
          codigo: 'SINTA',
          descricao: 'Acreditação sintética',
          sigla: 'A',
          pessoaFisica: false,
          pessoaJuridica: true,
          hospital: true,
        },
      ],
    };
    await page.route('**/api/operadora/rede-cadastro/**', async (r) => {
      const u = new URL(r.request().url());
      if (u.pathname.endsWith('/apoio')) return json(r, apoio);
      pedidos.push({ caminho: u.pathname, corpo: r.request().postDataJSON() as Record<string, unknown> });
      if (u.pathname.includes('/suspensoes/')) {
        ficha.suspensoes = ficha.suspensoes.map((s) => ({
          ...s,
          situacao: 'encerrada',
          reativadoEm: '2026-11-25',
        }));
        ficha.suspensoHoje = false;
      }
      return json(r, { id: 1, versao: 2 });
    });
    await page.route(
      /\/api\/operadora\/prestadores\/\d+\/(cadastro|locais|especialidades|qualificacoes|suspensoes)$/,
      async (r) => {
        const u = new URL(r.request().url());
        const id = Number(u.pathname.split('/')[4]);
        ficha.prestador.id = id;
        if (r.request().method() === 'GET') return json(r, ficha);
        const corpo = r.request().postDataJSON() as Record<string, unknown>;
        pedidos.push({ caminho: u.pathname, corpo });
        if (u.pathname.endsWith('/locais'))
          ficha.locais.push({
            id: 21,
            versao: 1,
            sequencia: 1,
            nome: corpo['nome'],
            cnes: null,
            cep: '01310100',
            logradouro: corpo['logradouro'],
            numero: corpo['numero'],
            complemento: null,
            bairro: null,
            municipioIbge: 3550308,
            latitude: null,
            longitude: null,
            telefone: null,
            email: null,
            acessivelCadeirante: true,
            estacionamento: false,
            principal: true,
            divulga: true,
            ativo: true,
            desligadoEm: null,
            motivoDesligamento: null,
          });
        if (u.pathname.endsWith('/especialidades'))
          ficha.especialidades.push({
            id: 31,
            versao: 1,
            especialidade: 5,
            descricao: 'Cardiologia',
            local: 21,
            ambulatorio: true,
            internacao: false,
            urgencia: true,
            hospitalDia: false,
            adulto: true,
            pediatrico: false,
            rqe: null,
            principal: false,
            divulga: true,
            situacao: 'ativa',
          });
        if (u.pathname.endsWith('/qualificacoes'))
          ficha.qualificacoes.push({
            id: 41,
            versao: 1,
            atributo: 9,
            codigoAtributo: 'SINTA',
            descricaoAtributo: 'Acreditação sintética',
            nivel: 'pleno',
            titulo: null,
            divulga: true,
            vigenciaInicio: '2026-11-25',
            vigenciaFim: null,
            vigente: true,
          });
        if (u.pathname.endsWith('/suspensoes')) {
          ficha.suspensoes.push({
            id: 51,
            versao: 1,
            motivo: 'auditoria',
            local: null,
            desde: '2026-11-25',
            reativadoEm: null,
            situacao: 'ativa',
            observacao: null,
          });
          ficha.suspensoHoje = true;
        }
        return json(r, { id: 1, versao: 1 }, 201);
      },
    );

    await entrar(page, 'SINT.ADMIN');
    await chave(page, 'operadora');
    await chave(page, 'operadora.rede');
    await entrar(page, 'SINT.CREDENCIAMENTO');
    await page.goto('/operadora/rede');
    await expect(page.getByTestId('rede-prestadores')).toBeVisible({ timeout: 30_000 });
    // A ficha abre pelo botão da linha (o nome na célula é texto, não ação).
    await page
      .getByTestId('rede-prestadores')
      .getByRole('button', { name: /Hospital sintético Beta/ })
      .first()
      .click();
    const cad = page.getByTestId('rede-cadastro');
    await expect(cad).toBeVisible({ timeout: 30_000 });
    await expect(cad.getByTestId('rede-descredenciamentos')).toContainText('HOSPITAL SINTETICO SUBSTITUTO');
    await expect(cad.getByTestId('rede-descredenciamentos')).toContainText('Cancelado');

    // Local: o CEP curto aparece na hora e trava a gravação; corrigido, grava.
    await cad.getByTestId('rede-local-incluir').click();
    const fl = cad.getByTestId('rede-local-form');
    await fl.getByLabel('Nome de divulgação').fill('Unidade Centro');
    await fl.getByLabel('CEP').fill('0131');
    await expect(fl.getByTestId('rede-local-problemas')).toContainText('O CEP tem 8 dígitos.');
    await expect(fl.getByTestId('rede-local-gravar')).toBeDisabled();
    await fl.getByLabel('CEP').fill('01310-100');
    await fl.getByLabel('Logradouro').fill('Avenida Sintética');
    await fl.getByLabel('Número').fill('100');
    await fl.getByLabel('Município (código IBGE)').fill('3550308');
    await semViolacaoAxe(page, 'local de atendimento');
    await fl.getByTestId('rede-local-gravar').click();
    await expect(cad.getByTestId('rede-locais')).toContainText('Unidade Centro');

    // Especialidade no local: sem regime aparece na hora; com urgência, grava.
    await cad.getByTestId('rede-especialidade-incluir').click();
    const fe = cad.getByTestId('rede-especialidade-form');
    await escolher(fe.getByTestId('rede-especialidade-campo'), { rotulo: 'Cardiologia' });
    await escolher(fe.getByTestId('rede-especialidade-local'), { rotulo: 'Unidade Centro' });
    await fe.getByLabel('Ambulatório').uncheck();
    await expect(fe.getByTestId('rede-especialidade-problemas')).toContainText('Marque ao menos um regime.');
    await fe.getByTestId('rede-especialidade-urgencia').check();
    await fe.getByLabel('Ambulatório').check();
    await fe.getByTestId('rede-especialidade-gravar').click();
    await expect(cad.getByTestId('rede-especialidades')).toContainText('Ambulatório, Urgência');

    // Qualificação: só o atributo que vale para o hospital.
    await cad.getByTestId('rede-qualificacao-incluir').click();
    const fq = cad.getByTestId('rede-qualificacao-form');
    await escolher(fq.getByTestId('rede-qualificacao-atributo'), { rotulo: 'A · Acreditação sintética' });
    await fq.getByLabel('Nível').fill('pleno');
    await fq.getByTestId('rede-qualificacao-gravar').click();
    await expect(cad.getByTestId('rede-qualificacoes')).toContainText('SINTA');

    // Suspensão do prestador inteiro: aviso de suspenso hoje; reativado, some.
    await cad.getByTestId('rede-suspensao-incluir').click();
    const fs = cad.getByTestId('rede-suspensao-form');
    await escolher(fs.getByTestId('rede-suspensao-motivo'), { rotulo: 'Auditoria' });
    await fs.getByTestId('rede-suspensao-gravar').click();
    await expect(cad.getByTestId('rede-suspenso-hoje')).toBeVisible();
    await semViolacaoAxe(page, 'prestador suspenso');
    await cad.getByTestId('rede-suspensao-reativar-51').click();
    await expect(cad.getByTestId('rede-suspenso-hoje')).toHaveCount(0);
    await expect(cad.getByTestId('rede-suspensoes')).toContainText('Encerrada');

    expect(pedidos.map((p) => p.caminho.replace(/\d+/g, ':id'))).toEqual([
      '/api/operadora/prestadores/:id/locais',
      '/api/operadora/prestadores/:id/especialidades',
      '/api/operadora/prestadores/:id/qualificacoes',
      '/api/operadora/prestadores/:id/suspensoes',
      '/api/operadora/rede-cadastro/suspensoes/:id/reativacao',
    ]);
    expect(pedidos[0]?.corpo).toMatchObject({ cep: '01310-100', municipioIbge: 3550308, principal: false });
    expect(pedidos[1]?.corpo).toMatchObject({ especialidade: 5, local: 21, urgencia: true });
  });
});
