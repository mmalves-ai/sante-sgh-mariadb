// E2E @F3.1-08 (02-CAD linha 16): complemento do cadastro do profissional na aba Dados da ficha: RQE (registro de
// qualificação de especialista), assinatura (certificado e imagem enviada pela própria tela), dado fiscal do repasse e
// conta ou chave de pagamento. O complemento exige o banco próprio, e o E2E roda com a fonte sintética (sem núcleo):
// as respostas destas rotas são simuladas pelo Playwright com massa SINTÉTICA e com estado (o que se grava aparece na
// lista). O que se prova é a tela: a validação na hora (botão só libera com o mínimo; ISS fora de 2% a 5% e INSS retido
// sem PIS marcam o campo), o que vai no pedido, a recusa do servidor mostrada (favorecido terceiro sem confirmação), o
// documento do favorecido mascarado e o encerrar/inativar sem apagar. O efeito no banco está no contrato de efeito
// (apps/api/src/modulos/cadastro/profissional-complemento-proprio.int.spec.ts).
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const PROF = 4;
const CPF_FAVORECIDO = '52998224725';
// PNG sintético de 1x1 (67 bytes): a tela só confere o tipo e o tamanho; o conteúdo é conferido pelo servidor.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

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
  rqes: Corpo[];
  assinaturas: Corpo[];
  fiscais: Corpo[];
  contas: Corpo[];
  enviados: { rota: string; corpo: Corpo }[];
}

/** Simula as rotas do complemento com estado: o que a tela grava volta na leitura seguinte. */
async function simular(page: Page, s: Estado): Promise<void> {
  let proximo = 100;
  const base = `**/api/cadastros/profissionais/${PROF}`;
  const corpoDe = (rota: Route, nome: string): Corpo => {
    const corpo = rota.request().postDataJSON() as Corpo;
    s.enviados.push({ rota: nome, corpo });
    return corpo;
  };
  await page.route('**/api/cadastros/profissionais-complemento/opcoes*', (rota) =>
    json(rota, {
      bancos: [{ id: 7, texto: 'BANCO SINTETICO' }],
      tiposConta: [{ id: 1, texto: 'Conta corrente' }],
      especialidades: [{ id: 31, texto: 'Cardiologia' }],
      estabelecimentos: [{ id: 1, texto: 'HOSPITAL SINTETICO' }],
      empresas: [],
    }),
  );
  await page.route(`${base}/complemento`, (rota) => json(rota, { rqes: s.rqes, assinaturas: s.assinaturas }));
  await page.route(`${base}/financeiro`, (rota) => json(rota, { fiscais: s.fiscais, contas: s.contas }));
  await page.route(`${base}/rqes`, (rota) => {
    const c = corpoDe(rota, 'rqes');
    const id = ++proximo;
    s.rqes.push({
      id,
      versao: 1,
      numero: c['numero'],
      uf: c['uf'],
      especialidade: c['especialidade'],
      especialidadeDescricao: 'Cardiologia',
      conselho: 'CRM',
      dataRegistro: c['dataRegistro'],
      ativo: true,
    });
    return json(rota, { id }, 201);
  });
  const assinatura = (tipo: string, c: Corpo, arquivo: number | null): Corpo => ({
    id: ++proximo,
    versao: 1,
    tipo,
    arquivo,
    titular: tipo === 'imagem' ? null : c['titular'],
    numeroSerie: tipo === 'imagem' ? null : c['numeroSerie'],
    emissor: null,
    usoTiss: c['usoTiss'],
    vigenciaInicio: c['vigenciaInicio'],
    vigenciaFim: null,
    ativo: true,
    vigente: true,
  });
  await page.route(`${base}/assinaturas`, (rota) => {
    const a = assinatura('certificado_digital', corpoDe(rota, 'assinaturas'), null);
    s.assinaturas.push(a);
    return json(rota, { id: a['id'] }, 201);
  });
  await page.route(`${base}/assinaturas/imagem`, (rota) => {
    const a = assinatura('imagem', corpoDe(rota, 'imagem'), 901);
    s.assinaturas.push(a);
    return json(rota, { id: a['id'] }, 201);
  });
  await page.route(`${base}/dados-fiscais`, (rota) => {
    const c = corpoDe(rota, 'dados-fiscais');
    const id = ++proximo;
    s.fiscais.unshift({
      id,
      versao: 1,
      estabelecimento: null,
      estabelecimentoNome: null,
      vigenciaInicio: c['vigenciaInicio'],
      vigenciaFim: null,
      tipoRecebedor: c['tipoRecebedor'],
      pessoaJuridica: null,
      empresa: null,
      regime: c['regime'],
      inscricaoMunicipal: null,
      inscricaoInss: null,
      categoriaSefip: null,
      pisPasep: c['pisPasep'],
      aliquotaIss: Number(c['aliquotaIss']),
      percentualInss: Number(c['percentualInss']),
      retemIss: c['retemIss'],
      retemInss: c['retemInss'],
      retemIrrf: c['retemIrrf'],
      retemPisCofinsCsll: c['retemPisCofinsCsll'],
      dependentesIrrf: c['dependentesIrrf'],
      incidencia: c['incidencia'],
      vigente: true,
    });
    return json(rota, { id }, 201);
  });
  await page.route(`${base}/contas`, (rota) => {
    const c = corpoDe(rota, 'contas');
    // A regra do servidor: favorecido que não é o profissional nem a empresa dele só entra confirmado.
    if (c['confirmaTerceiro'] !== true)
      return rota.fulfill({
        status: 409,
        contentType: 'application/problem+json',
        body: JSON.stringify({
          type: 'about:blank',
          title: 'Operação recusada',
          status: 409,
          codigo: 'favorecido-terceiro',
          detail:
            'O favorecido não é o profissional nem a empresa dele no dado fiscal. Confirme o pagamento a terceiro.',
          campos: ['favorecidoDocumento'],
        }),
      });
    const id = ++proximo;
    s.contas.push({
      id,
      versao: 1,
      banco: null,
      bancoDescricao: null,
      agencia: null,
      numeroConta: null,
      tipoChavePix: c['tipoChavePix'],
      chavePix: c['chavePix'],
      favorecidoNome: c['favorecidoNome'],
      favorecidoTipo: c['favorecidoTipo'],
      favorecidoDocumento: c['favorecidoDocumento'],
      principal: s.contas.length === 0,
      ativo: true,
    });
    return json(rota, { id }, 201);
  });
  // Encerrar (dado fiscal e assinatura) e inativar (conta e RQE): a linha fica na lista, nada se apaga.
  await page.route(`${base}/**/encerrar`, (rota) => {
    const caminho = new URL(rota.request().url()).pathname;
    const m = /\/(financeiro\/)?(rqes|assinaturas|dados-fiscais|contas)\/(\d+)\/encerrar$/.exec(caminho);
    const tipo = m?.[2] ?? '';
    const id = Number(m?.[3]);
    s.enviados.push({
      rota: `encerrar:${m?.[1] ?? ''}${tipo}`,
      corpo: rota.request().postDataJSON() as Corpo,
    });
    const lista = { rqes: s.rqes, assinaturas: s.assinaturas, 'dados-fiscais': s.fiscais, contas: s.contas }[
      tipo
    ];
    const x = lista?.find((l) => l['id'] === id);
    if (!x) return json(rota, { status: 404, title: 'Não encontrado' }, 404);
    if (tipo === 'rqes' || tipo === 'contas') Object.assign(x, { ativo: false, principal: false });
    else Object.assign(x, { vigenciaFim: '2026-12-31', vigente: false });
    return json(rota, { id });
  });
}

const enviado = (s: Estado, rota: string) => s.enviados.filter((e) => e.rota === rota).at(-1)?.corpo;

test.describe('complemento do profissional: RQE, assinatura, dado fiscal e conta @F3.1-08', () => {
  test.setTimeout(180_000);

  test('validação na hora, gravação de cada bloco, recusa do servidor mostrada e encerrar sem apagar; axe', async ({
    page,
  }) => {
    const s: Estado = { rqes: [], assinaturas: [], fiscais: [], contas: [], enviados: [] };
    await entrar(page, 'SINT.ADMIN');
    await simular(page, s);
    await page.goto(`/cadastros/profissionais/${PROF}`);
    await page.getByTestId('prof-aba-dados').click();
    const aba = page.getByTestId('complemento-profissional');
    await expect(aba).toBeVisible();
    const ok = page.getByTestId('compl-ok');

    // RQE: o botão só libera com número, UF e especialidade; gravado, aparece na lista com o conselho e a UF.
    const formRqe = page.getByTestId('form-rqe');
    const gravarRqe = formRqe.locator('button[type="submit"]');
    await expect(gravarRqe).toBeDisabled();
    await page.getByTestId('rqe-numero').fill('45678');
    await escolher(page.getByTestId('rqe-uf'), 'MG');
    await expect(gravarRqe).toBeDisabled();
    await escolher(page.getByTestId('rqe-especialidade'), { rotulo: 'Cardiologia' });
    await expect(gravarRqe).toBeEnabled();
    await gravarRqe.click();
    await expect(ok).toBeVisible();
    await expect(page.getByTestId('lista-rqe')).toContainText('45678');
    await expect(page.getByTestId('lista-rqe')).toContainText('CRM/MG');
    expect(enviado(s, 'rqes')).toMatchObject({ numero: '45678', uf: 'MG', especialidade: 31 });

    // Assinatura por certificado: titular e série; a impressão digital é opcional.
    const formAss = page.getByTestId('form-assinatura');
    const gravarAss = formAss.locator('button[type="submit"]');
    await expect(gravarAss).toBeDisabled();
    await page.getByTestId('ass-titular').fill('TITULAR SINTETICO');
    await page.getByTestId('ass-serie').fill('F31A0801');
    await expect(gravarAss).toBeEnabled();
    await gravarAss.click();
    await expect(page.getByTestId('lista-assinatura')).toContainText('F31A0801');
    expect(enviado(s, 'assinaturas')).toMatchObject({
      tipo: 'certificado_digital',
      numeroSerie: 'F31A0801',
      arquivo: null,
    });

    // Assinatura em imagem: o que não é PNG nem JPEG recusa na hora; a imagem vai em base64 pela rota própria.
    await escolher(page.getByTestId('ass-tipo'), 'imagem');
    const arquivo = page.getByTestId('arquivo-assinatura');
    await arquivo.setInputFiles({
      name: 'assinatura.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.7 sintetico'),
    });
    await expect(page.getByTestId('imagem-erro')).toBeVisible();
    await expect(gravarAss).toBeDisabled();
    await arquivo.setInputFiles({ name: 'assinatura.png', mimeType: 'image/png', buffer: PNG });
    await expect(page.getByTestId('imagem-erro')).toHaveCount(0);
    await expect(gravarAss).toBeEnabled();
    await gravarAss.click();
    await expect.poll(() => enviado(s, 'imagem')).toBeTruthy();
    expect(String(enviado(s, 'imagem')?.['conteudo'])).toMatch(/^data:image\/png;base64,/);
    expect(enviado(s, 'imagem')).toMatchObject({ nomeOriginal: 'assinatura.png' });
    await expect(page.getByTestId('lista-assinatura').locator('tbody tr')).toHaveCount(2);

    // Dado fiscal (cargo do repasse): ISS fora de 2% a 5% marca o campo; INSS retido sem PIS também; ajustado, grava.
    const formFiscal = page.getByTestId('form-fiscal');
    await expect(formFiscal).toBeVisible();
    const gravarFiscal = formFiscal.locator('button[type="submit"]');
    const iss = page.getByTestId('fiscal-iss');
    await iss.fill('10');
    await expect(iss).toHaveAttribute('aria-invalid', 'true');
    await expect(gravarFiscal).toBeDisabled();
    await iss.fill('5');
    await expect(iss).toHaveAttribute('aria-invalid', 'false');
    await page.getByTestId('fiscal-retem-iss').check();
    await page.getByTestId('fiscal-retem-inss').check();
    await page.getByTestId('fiscal-inss').fill('11');
    await expect(page.getByTestId('fiscal-pis')).toHaveAttribute('aria-invalid', 'true');
    await expect(gravarFiscal).toBeDisabled();
    await page.getByTestId('fiscal-pis').fill('12056412545');
    await expect(gravarFiscal).toBeEnabled();
    await gravarFiscal.click();
    await expect(page.getByTestId('lista-fiscal').locator('tbody tr')).toHaveCount(1);
    expect(enviado(s, 'dados-fiscais')).toMatchObject({
      tipoRecebedor: 'pessoa_fisica',
      regime: 'autonomo',
      estabelecimento: null,
      pessoaJuridica: null,
      retemIss: true,
      retemInss: true,
      pisPasep: '12056412545',
    });
    await semViolacaoAxe(page, 'complemento do profissional');

    // Conta por chave de pagamento: sem conta nem chave não libera; favorecido terceiro sem confirmação é recusado
    // pelo servidor e a tela mostra o motivo; confirmado, grava; o documento do favorecido fica mascarado na lista.
    const formConta = page.getByTestId('form-conta');
    const gravarConta = formConta.locator('button[type="submit"]');
    await page.getByTestId('conta-favorecido').fill('FAVORECIDO SINTETICO');
    await page.getByTestId('conta-documento').fill(CPF_FAVORECIDO);
    await expect(gravarConta).toBeDisabled();
    await escolher(page.getByTestId('conta-tipo-chave'), 'cpf');
    await page.getByTestId('conta-chave').fill(CPF_FAVORECIDO);
    await expect(gravarConta).toBeEnabled();
    await gravarConta.click();
    await expect(aba.getByTestId('mensagem-erro')).toContainText('Confirme o pagamento a terceiro');
    await expect(page.getByTestId('lista-contas')).toHaveCount(0);
    await page.getByTestId('conta-confirma-terceiro').check();
    await gravarConta.click();
    const contas = page.getByTestId('lista-contas');
    await expect(contas.locator('tbody tr')).toHaveCount(1);
    await expect(contas).toContainText('FAVORECIDO SINTETICO');
    await expect(contas).toContainText('•••••••4725');
    await expect(contas).not.toContainText(CPF_FAVORECIDO.slice(0, 7));
    expect(enviado(s, 'contas')).toMatchObject({
      banco: null,
      tipoChavePix: 'cpf',
      chavePix: CPF_FAVORECIDO,
      confirmaTerceiro: true,
    });

    // Encerrar e inativar não apagam: a linha continua na lista, e o dado fiscal e a conta vão pela rota do repasse.
    await page.getByTestId('lista-fiscal').locator('tbody tr').first().getByRole('button').click();
    await expect.poll(() => enviado(s, 'encerrar:financeiro/dados-fiscais')).toBeTruthy();
    await expect(page.getByTestId('lista-fiscal').locator('tbody tr')).toHaveCount(1);
    await expect(page.getByTestId('lista-fiscal').getByRole('button')).toHaveCount(0);
    await contas.locator('tbody tr').first().getByRole('button').click();
    await expect.poll(() => enviado(s, 'encerrar:financeiro/contas')).toBeTruthy();
    await expect(contas.locator('tbody tr')).toHaveCount(1);
    await expect(contas.getByRole('button')).toHaveCount(0);
    await page.getByTestId('lista-rqe').locator('tbody tr').first().getByRole('button').click();
    await expect.poll(() => enviado(s, 'encerrar:rqes')).toBeTruthy();
    await expect(page.getByTestId('lista-rqe').locator('tbody tr')).toHaveCount(1);
    expect(enviado(s, 'encerrar:rqes')).toMatchObject({ versao: 1 });
  });
});
