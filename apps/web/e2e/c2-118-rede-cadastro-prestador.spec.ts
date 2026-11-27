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
// Ligar a operadora exige o registro na ANS cumprido (pré-requisito do recurso); o E2E não depende da ordem dos specs.
async function prerequisito(page: Page): Promise<void> {
  const r = await page.request.put('/api/administracao/liberacao/prerequisitos', {
    headers: { 'x-csrf': await csrf(page), 'idempotency-key': `e2e-c2-118-pre-${Date.now()}` },
    data: {
      recurso: 'operadora',
      tipo: 'credenciamento',
      situacao: 'cumprido',
      validade: '2099-12-31',
      evidencia: 'pré-requisito sintético do E2E',
      senha: SENHA,
    },
  });
  expect(r.status(), await r.text()).toBe(200);
}
const json = (rota: Route, corpo: unknown, status = 200) =>
  rota.fulfill({ status, contentType: 'application/json', body: JSON.stringify(corpo) });
const recusa = (rota: Route, codigo: string, detail: string) =>
  rota.fulfill({
    status: 409,
    contentType: 'application/problem+json',
    body: JSON.stringify({
      type: 'urn:sgh:problema:recusa-de-negocio',
      title: detail,
      status: 409,
      detail,
      codigo,
      campos: ['substituto'],
    }),
  });
const resultado = (id: number, mensagem: string) => ({
  ok: true,
  id,
  versao: 2,
  movimento: null,
  mensagem,
  avisos: [],
});
const hojeBr = () => {
  const d = new Date();
  const z = (n: number) => String(n).padStart(2, '0');
  return `${z(d.getDate())}/${z(d.getMonth() + 1)}/${d.getFullYear()}`;
};

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
    await prerequisito(page);
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

    // Descredenciamento pela tela: tipo do motivo, aviso aos beneficiários e substituto equivalente. A primeira
    // tentativa volta com a recusa do substituto (sem a especialidade), mostrada no campo; a segunda grava.
    const descred: Record<string, unknown>[] = [];
    await page.route(/\/api\/operadora\/prestadores\/\d+\/descredenciar$/, async (r) => {
      descred.push(r.request().postDataJSON() as Record<string, unknown>);
      if (descred.length === 1)
        return recusa(
          r,
          'substituto-sem-especialidade',
          'O substituto não atende a especialidade do prestador que sai.',
        );
      return json(r, resultado(ficha.prestador.id, 'Descredenciamento registrado.'));
    });
    await page.getByTestId('rede-descredenciar').click();
    const fd = page.getByTestId('form-descredenciar');
    await expect(fd).toBeVisible();
    await escolher(fd.getByTestId('rede-desc-tipo-motivo'), { rotulo: 'Qualidade' });
    await fd
      .getByLabel('Motivo do descredenciamento')
      .fill('Indicadores de qualidade abaixo da meta sintética');
    const aviso = fd.getByTestId('rede-desc-aviso').getByRole('textbox');
    await aviso.fill(hojeBr());
    await aviso.press('Tab');
    await escolher(fd.getByTestId('rede-desc-substituto'), { rotulo: /Hospital sintético Gama/ });
    await page.getByTestId('rede-desc-confirmar').click();
    const confirmar = page.getByTestId('confirmacao').getByRole('button', { name: 'Confirmar' });
    await confirmar.click();
    await expect(fd.getByTestId('rede-desc-substituto-recusa')).toContainText(
      'O substituto não atende a especialidade',
    );
    await expect(fd.getByTestId('rede-desc-recusa')).toHaveCount(0);
    await semViolacaoAxe(page, 'descredenciamento com recusa do substituto');
    await page.getByTestId('rede-desc-confirmar').click();
    await confirmar.click();
    await expect(fd).toHaveCount(0);
    expect(descred).toHaveLength(2);
    expect(descred[1]).toMatchObject({ tipoMotivo: 'qualidade' });
    expect(descred[1]?.['avisoBeneficiariosEm']).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(typeof descred[1]?.['substituto']).toBe('number');

    // Credenciamento com contratação indireta: sem o registro na ANS da intermediária, o problema aparece na hora e
    // trava a gravação; com ele, o pedido leva contratacao=2 e operadoraIntermediaria.
    const credenciar: Record<string, unknown>[] = [];
    await page.route(/\/api\/operadora\/prestadores$/, async (r) => {
      if (r.request().method() !== 'POST') return r.fallback();
      credenciar.push(r.request().postDataJSON() as Record<string, unknown>);
      return json(r, resultado(ficha.prestador.id, 'Prestador credenciado.'), 201);
    });
    await page.getByTestId('rede-credenciar').click();
    const fp = page.getByTestId('form-prestador');
    await expect(fp).toBeVisible();
    await fp.getByLabel('CPF ou CNPJ').fill('11.222.333/0001-81');
    await fp.getByLabel('Nome ou razão social').fill('Clínica sintética Delta');
    await fp.getByLabel('CNES (7 dígitos)').fill('1234567');
    await fp.getByLabel('Código do município (IBGE, 7 dígitos)').fill('4205407');
    await escolher(fp.getByTestId('rede-tipo'), { indice: 1 });
    await escolher(fp.getByTestId('rede-natureza'), { indice: 1 });
    await escolher(fp.getByTestId('rede-classificacao'), { indice: 1 });
    await escolher(fp.getByTestId('rede-regime'), { indice: 1 });
    await fp.getByLabel('Número do contrato').fill('CT-SINT-0001');
    await escolher(fp.getByTestId('rede-contratacao'), { rotulo: 'Indireta' });
    await expect(fp.getByTestId('rede-intermediaria-problema')).toContainText(
      'informe o registro na ANS da operadora intermediária',
    );
    await expect(fp.getByTestId('rede-gravar')).toBeDisabled();
    await fp.getByLabel('Registro na ANS da operadora intermediária').fill('12AB');
    await expect(fp.getByTestId('rede-intermediaria-problema')).toContainText('6 dígitos');
    await fp.getByLabel('Registro na ANS da operadora intermediária').fill('123456');
    await expect(fp.getByTestId('rede-intermediaria-problema')).toHaveCount(0);
    await semViolacaoAxe(page, 'credenciamento com contratação indireta');
    await fp.getByTestId('rede-gravar').click();
    await expect.poll(() => credenciar.length).toBe(1);
    expect(credenciar[0]).toMatchObject({ contratacao: 2, operadoraIntermediaria: '123456' });
  });
});
