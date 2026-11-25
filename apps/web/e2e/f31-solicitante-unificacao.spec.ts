// E2E @F3.1-10 (02-CAD linha 20): ficha do solicitante externo (médico de fora que pede exame ou consulta) e a
// unificação do cadastro duplicado. A ficha exige o banco próprio, e o E2E roda com a fonte sintética (sem núcleo):
// as respostas destas rotas são simuladas pelo Playwright com massa SINTÉTICA e com estado (o que se grava aparece na
// leitura seguinte). O que se prova é a tela: o que falta para a guia; os parecidos com o botão de unificar; o painel
// que explica o efeito e só libera com o motivo; a confirmação; o corpo do pedido (duplicado, versão lida e motivo);
// a recusa do servidor mostrada sem mexer na lista; o duplicado na lista dos unificados com os atendimentos que
// seguem ligados a ele; e, na ficha do duplicado, o aviso com o caminho para o cadastro que continua, sem a opção de
// reativar, e o desfazer com motivo. O efeito no banco (ponteiro, duplicado inativo e nunca apagado, atendimento
// intacto, código herdado só onde falta, trilha com o motivo) está no contrato de efeito
// (apps/api/src/modulos/cadastro/solicitante-unificacao.int.spec.ts).
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe } from './ajuda.js';

const SENHA = 'Sintetico#2026';
const MANTIDO = 21;
const DUPLICADO = 22;

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
  /** O duplicado está unificado no cadastro que continua. */
  unificado: boolean;
  /** A próxima unificação é recusada pelo servidor (uma vez). */
  recusar: boolean;
  unificacoes: Corpo[];
  desfeitas: Corpo[];
}

const base = (id: number, nome: string, numero: string) => ({
  id,
  versao: 3,
  nome,
  conselho: 'CRM',
  uf: 'MG',
  numero,
  cpf: null,
  cns: null,
  ocupacao: null,
  ocupacaoCodigo: null,
  especialidade: null,
  instituicaoNome: 'CLINICA SINTETICA',
  instituicaoCnpj: null,
  instituicaoCnes: null,
  telefone: null,
  email: null,
  observacao: null,
  dataInativacao: null,
  faltaParaGuia: ['cbo'],
  codigos: [],
});
const NOME_MANTIDO = 'ANA SOLICITANTE SINTETICA';
const NOME_DUPLICADO = 'DRA ANA SOLICITANTE SINTETICA';

/** Simula as rotas da ficha com estado: a unificação e o desfazer mudam o que as duas fichas devolvem. */
async function simular(page: Page, s: Estado): Promise<void> {
  await page.route('**/api/cadastros/vinculos/opcoes', (r) => json(r, { fontes: [] }));
  await page.route(`**/api/cadastros/solicitantes/${MANTIDO}/ficha`, (r) =>
    json(r, {
      ...base(MANTIDO, NOME_MANTIDO, '9914001'),
      ativo: true,
      unificadoEm: null,
      absorvidos: s.unificado
        ? [
            {
              id: DUPLICADO,
              versao: 4,
              nome: NOME_DUPLICADO,
              registro: 'CRM 9914002/MG',
              quando: '2026-11-24',
              atendimentos: 2,
            },
          ]
        : [],
      parecidos: s.unificado
        ? []
        : [
            {
              id: DUPLICADO,
              nome: NOME_DUPLICADO,
              registro: 'CRM 9914002/MG',
              ativo: true,
              versao: 3,
              motivo: 'mesmo-nome',
              traz: ['cpf', 'telefone'],
              difere: ['email'],
            },
          ],
    }),
  );
  await page.route(`**/api/cadastros/solicitantes/${DUPLICADO}/ficha`, (r) =>
    json(r, {
      ...base(DUPLICADO, NOME_DUPLICADO, '9914002'),
      versao: s.unificado ? 4 : 3,
      ativo: !s.unificado,
      dataInativacao: s.unificado ? '2026-11-24' : null,
      unificadoEm: s.unificado
        ? { id: MANTIDO, nome: NOME_MANTIDO, registro: 'CRM 9914001/MG', quando: '2026-11-24' }
        : null,
      absorvidos: [],
      parecidos: [],
    }),
  );
  await page.route(`**/api/cadastros/solicitantes/${MANTIDO}/unificar`, (r) => {
    s.unificacoes.push(r.request().postDataJSON() as Corpo);
    if (s.recusar) {
      s.recusar = false;
      return r.fulfill({
        status: 409,
        contentType: 'application/problem+json',
        body: JSON.stringify({
          type: 'about:blank',
          title: 'Operação recusada',
          status: 409,
          codigo: 'absorvido-ja-unificado',
          detail: 'Este cadastro já foi unificado em outro.',
          campos: ['absorvido'],
        }),
      });
    }
    s.unificado = true;
    return json(r, { id: MANTIDO });
  });
  await page.route(`**/api/cadastros/solicitantes/${DUPLICADO}/desfazer-unificacao`, (r) => {
    s.desfeitas.push(r.request().postDataJSON() as Corpo);
    s.unificado = false;
    return json(r, { id: DUPLICADO });
  });
}

test.describe('ficha do solicitante externo e unificação do duplicado @F3.1-10', () => {
  test.setTimeout(180_000);

  test('unifica a partir dos parecidos, com motivo e confirmação; recusa mostrada; desfaz na ficha do duplicado; axe', async ({
    page,
  }) => {
    const s: Estado = { unificado: false, recusar: true, unificacoes: [], desfeitas: [] };
    await entrar(page, 'SINT.ADMIN');
    await simular(page, s);
    await page.goto(`/cadastros/solicitantes/${MANTIDO}`);
    const tela = page.getByTestId('tela-solicitante');
    await expect(tela).toContainText(NOME_MANTIDO);
    await expect(tela).toContainText('CRM 9914001/MG');
    await expect(page.getByTestId('solicitante-falta-guia')).toContainText('cbo');
    await expect(page.getByTestId('sol-lista-unificados')).toHaveCount(0);

    // Parecidos: o duplicado aparece com o motivo da regra e o botão de unificar; o painel só abre ao escolher.
    const parecidos = page.getByTestId('sol-lista-parecidos');
    await expect(parecidos).toContainText(NOME_DUPLICADO);
    await expect(parecidos).toContainText('mesmo nome no mesmo conselho e UF');
    await expect(page.getByTestId('sol-unificar-painel')).toHaveCount(0);
    await page.getByTestId(`sol-unificar-${DUPLICADO}`).click();
    const painel = page.getByTestId('sol-unificar-painel');
    await expect(painel).toContainText('Atendimentos e pedidos já feitos não mudam');
    // Antes de confirmar, a tela diz o que este cadastro recebe do duplicado, o que os dois têm diferente e como
    // ficar com o registro do duplicado.
    await expect(page.getByTestId('sol-unificar-traz')).toContainText('CPF, telefone');
    await expect(page.getByTestId('sol-unificar-difere')).toContainText('e-mail');
    await expect(page.getByTestId('sol-unificar-registro')).toContainText('trocam de registro');

    // Validação na hora: sem motivo de ao menos 10 letras o botão não libera. Cancelar fecha sem pedir nada.
    const confirmar = page.getByTestId('sol-unificar-confirmar');
    await expect(confirmar).toBeDisabled();
    await page.getByTestId('sol-motivo-unificar').fill('curto');
    await expect(confirmar).toBeDisabled();
    await page.getByTestId('sol-unificar-cancelar').click();
    await expect(painel).toHaveCount(0);
    expect(s.unificacoes).toHaveLength(0);

    // Recusa do servidor: aparece na tela e a lista de parecidos segue como estava.
    await page.getByTestId(`sol-unificar-${DUPLICADO}`).click();
    await page.getByTestId('sol-motivo-unificar').fill('mesmo médico digitado duas vezes');
    await expect(confirmar).toBeEnabled();
    await confirmar.click();
    await page.getByTestId('confirmacao').getByRole('button', { name: 'Confirmar' }).click();
    await expect(page.getByTestId('solicitante-erro')).toContainText('já foi unificado');
    await expect(parecidos).toContainText(NOME_DUPLICADO);
    expect(s.unificacoes).toHaveLength(1);

    // Unificação aceita: o corpo leva o duplicado, a versão lida e o motivo; o duplicado passa à lista dos unificados.
    await confirmar.click();
    await page.getByTestId('confirmacao').getByRole('button', { name: 'Confirmar' }).click();
    const unificados = page.getByTestId('sol-lista-unificados');
    await expect(unificados).toContainText(NOME_DUPLICADO);
    await expect(unificados).toContainText('2 atendimentos seguem ligados a ele');
    await expect(page.getByTestId('sol-lista-parecidos')).toHaveCount(0);
    expect(s.unificacoes[1]).toEqual({
      absorvido: DUPLICADO,
      versao: 3,
      motivo: 'mesmo médico digitado duas vezes',
    });
    await semViolacaoAxe(page, 'ficha do solicitante com unificados');

    // Ficha do duplicado: aviso com o caminho para o cadastro que continua; reativar não é oferecido; desfazer com motivo.
    await unificados.getByRole('link', { name: NOME_DUPLICADO }).click();
    await expect(page).toHaveURL(new RegExp(`/cadastros/solicitantes/${DUPLICADO}$`));
    const aviso = page.getByTestId('solicitante-unificado');
    await expect(aviso).toContainText('Este cadastro foi unificado em');
    await expect(page.getByTestId('sol-unificado-em')).toHaveText(NOME_MANTIDO);
    await expect(page.getByTestId('solicitante-inativo')).toBeVisible();
    await expect(page.getByTestId('sol-situacao')).toHaveCount(0);
    const desfazer = page.getByTestId('sol-desfazer-unificacao');
    await expect(desfazer).toBeDisabled();
    await page.getByTestId('sol-motivo-desfazer').fill('eram dois médicos diferentes');
    await desfazer.click();
    await expect(aviso).toHaveCount(0);
    await expect(page.getByTestId('solicitante-inativo')).toHaveCount(0);
    expect(s.desfeitas).toEqual([{ versao: 4, motivo: 'eram dois médicos diferentes' }]);
    await semViolacaoAxe(page, 'ficha do solicitante depois de desfazer');
  });
});
