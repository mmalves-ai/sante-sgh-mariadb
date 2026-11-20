// E2E @M56.5 (ficha do M56, etapa 5 de 8, fatia F4; seções 7, 8 e 10 na parte da autorização): a autorização nasce
// desligada (a tela diz o motivo e os domínios do item seguem embutidos) → o administrador registra o número da
// operadora na ANS e a designação dos auditores (pré-requisitos) e liga a operadora, os beneficiários e a autorização
// para as pessoas do teste; ele mesmo não abre a tela → o gestor da operadora monta a carteira sintética (operadora,
// plano, contrato e beneficiária) e designa o médico auditor na aba dos auditores → o atendimento registra o pedido de
// SP/SADT (a busca na terminologia) e o de internação, cada um com o protocolo → o auditor pede complemento, o
// atendimento registra o complemento, o auditor autoriza com a senha → a internação no laboratório tem a crítica que
// impede autorizar e o auditor nega, com o comunicado ao beneficiário → o atendimento cancela a autorização → recolher;
// axe sem violação séria em cada estado. Sessão real sobre a fonte sintética de dev, tudo em MEMÓRIA (nada vai à
// cópia); documentos SINTÉTICOS (dígitos calculados aqui).
import { expect, test, type Page } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const PESSOAS = ['SINT.OPERADORA', 'SINT.OPE.ATENDE', 'SINT.OPE.AUDITOR'];

async function entrar(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

async function csrf(page: Page): Promise<string> {
  return (await page.context().cookies()).find((c) => c.name === 'sgh_csrf')?.value ?? '';
}
const cabecalhos = async (page: Page, k: string) => ({
  'x-csrf': await csrf(page),
  'idempotency-key': `e2e-m56-5-${k}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
});

/** Liga ou desliga a chave para as pessoas do teste (Funcionalidades por estabelecimento; reautenticação). */
async function chave(page: Page, nome: string, ligar: boolean): Promise<void> {
  const r = await page.request.post('/api/administracao/liberacao', {
    headers: await cabecalhos(page, `${nome}-${ligar}`),
    data: {
      chave: nome,
      tipo: 'recurso',
      escopo: 'pessoa',
      valores: PESSOAS,
      ligar,
      justificativa: 'Autorização de guias sintética (E2E da etapa 5)',
      senha: SENHA,
    },
  });
  expect(r.status(), await r.text()).toBe(200);
}

async function prerequisito(page: Page, recurso: string, tipo: string): Promise<void> {
  const r = await page.request.put('/api/administracao/liberacao/prerequisitos', {
    headers: await cabecalhos(page, `pre-${recurso}`),
    data: {
      recurso,
      tipo,
      situacao: 'cumprido',
      validade: '2099-12-31',
      evidencia: 'pré-requisito sintético do E2E',
      senha: SENHA,
    },
  });
  expect(r.status(), await r.text()).toBe(200);
}

function dv11(base: string, pesos: readonly number[]): number {
  let s = 0;
  pesos.forEach((p, i) => (s += Number(base[i]) * p));
  const r = s % 11;
  return r < 2 ? 0 : 11 - r;
}
const cpf = (b9: string) => {
  const d1 = dv11(b9, [10, 9, 8, 7, 6, 5, 4, 3, 2]);
  return `${b9}${d1}${dv11(`${b9}${d1}`, [11, 10, 9, 8, 7, 6, 5, 4, 3, 2])}`;
};
const cnpj = (b12: string) => {
  const d1 = dv11(b12, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return `${b12}${d1}${dv11(`${b12}${d1}`, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])}`;
};

/** A carteira sintética pela API da F1 (o gestor da operadora): devolve a carteirinha da beneficiária. */
async function carteira(page: Page, sufixo: string): Promise<string> {
  const post = async (url: string, data: unknown) => {
    const r = await page.request.post(url, { headers: await cabecalhos(page, url.split('/').pop()!), data });
    expect(r.status(), await r.text()).toBe(201);
    return r.json() as Promise<{ id: number; carteirinha?: string }>;
  };
  const ope = await post('/api/operadora/empresas', {
    registroAns: `9${sufixo}`,
    cnpj: cnpj(`9${sufixo}000001`.slice(0, 12)),
    razaoSocial: `Operadora sintética ${sufixo}`,
    modalidade: 'medicinaGrupo',
  });
  const prod = await post('/api/operadora/produtos', {
    operadora: ope.id,
    codigo: `E2E-${sufixo}`,
    nome: `Plano sintético ${sufixo}`,
    natureza: 'plano',
    registroAns: `9${sufixo}001`,
    tipoContratacao: 1,
    segmentacao: 'ambulatorialHospitalar',
    abrangencia: 'estadual',
    acomodacao: 2,
    coparticipacao: { tipo: 1, valor: null },
    carencias: { urgencia: 1, partos: 300, demais: 180, cpt: 24 },
    precos: [100, 120, 130, 140, 150, 170, 200, 240, 300, 400],
  });
  const ctr = await post('/api/operadora/contratos', {
    produto: prod.id,
    numero: `E2E-${sufixo}-1`,
    tipo: 1,
    contratanteNome: 'Contratante sintético do E2E',
    contratanteDocumento: cpf(`8${sufixo}012`.slice(0, 9)),
    formaReajuste: 1,
    mesReajuste: 5,
    tipoVigencia: 2,
    inicio: '2026-01-01',
  });
  const ben = await post('/api/operadora/beneficiarios', {
    contrato: ctr.id,
    vinculo: 1,
    nome: `Beneficiária sintética ${sufixo}`,
    cpf: cpf(`7${sufixo}023`.slice(0, 9)),
    nascimento: '1980-05-10',
    sexo: 'F',
    nomeMae: 'Mãe sintética',
    inclusao: '2026-02-01',
  });
  return ben.carteirinha!;
}

test.describe('operadora própria, etapa 5: autorização de guias e auditoria médica @M56.5', () => {
  test.setTimeout(300_000);

  test('desligada → ligar → designar o auditor → registrar → complemento → autorizar → negar com o comunicado → cancelar → recolher; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    const sufixo = String(Date.now() % 100_000).padStart(5, '0');

    // A autorização nasce desligada (POL-3): a tela diz o motivo; os domínios do item seguem embutidos.
    await entrar(page, 'SINT.OPE.ATENDE');
    await page.goto('/operadora/autorizacoes');
    await expect(page.getByRole('heading', { level: 1, name: 'Autorização de guias' })).toBeVisible();
    await expect(page.getByTestId('aut-desligada')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('aut-lista')).toHaveCount(0);
    await expect(page.getByTestId('grupo-dominios-operadoraAtendimento')).toBeVisible();
    await semViolacaoAxe(page, '/operadora/autorizacoes (desligada)');

    // O administrador registra os pré-requisitos e liga as chaves para as pessoas do teste; ele não abre a tela.
    await entrar(page, 'SINT.ADMIN');
    await prerequisito(page, 'operadora', 'credenciamento');
    await prerequisito(page, 'operadora.autorizacao', 'aprovacao');
    for (const c of ['operadora', 'operadora.beneficiarios', 'operadora.autorizacao'])
      await chave(page, c, true);
    await page.goto('/operadora/autorizacoes');
    await expect(page.getByTestId('tela-operadora-autorizacoes')).toHaveCount(0);

    try {
      // O gestor da operadora monta a carteira e designa o médico auditor (aba dos auditores, sem ver as guias).
      await entrar(page, 'SINT.OPERADORA');
      const carteirinha = await carteira(page, sufixo);
      await page.goto('/operadora/beneficiarios');
      await page.getByTestId('aba-auditores').click({ timeout: 30_000 });
      await page.getByTestId('aut-designar').click();
      const des = page.getByTestId('form-designar');
      await escolher(des.getByTestId('aut-des-operadora'), { rotulo: new RegExp(`ANS 9${sufixo}`) });
      await des.getByLabel('Usuário').fill('SINT.OPE.AUDITOR');
      await des.getByLabel('Nome', { exact: true }).fill('Auditora sintética');
      await escolher(des.getByTestId('aut-des-categoria'), { rotulo: 'Médico auditor' });
      await des.getByLabel('Número no conselho').fill('900021');
      await semViolacaoAxe(page, 'designar auditor');
      await page.getByTestId('aut-des-gravar').click();
      await expect(page.getByTestId('aut-auditores-mensagem')).toContainText('CRM 900021/SC');
      await expect(page.getByTestId('aut-auditores-lista')).toContainText('Auditora sintética');
      // O gestor não vê as guias (conteúdo clínico), mas abre o item e mantém os motivos de ligação (revisão M56.5).
      await page.goto('/operadora/autorizacoes');
      await expect(page.getByTestId('aut-sem-guias')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('aut-totais')).toHaveCount(0);
      await expect(page.getByTestId('grupo-dominios-operadoraAtendimento')).toContainText(
        'Motivos de ligação',
      );
      await expect(page.getByTestId('operadora-outras-tabelas')).toBeVisible();

      // O atendimento registra o pedido de SP/SADT no laboratório, com a busca na terminologia.
      await entrar(page, 'SINT.OPE.ATENDE');
      await page.goto('/operadora/autorizacoes');
      await expect(page.getByTestId('aut-totais')).toBeVisible({ timeout: 30_000 });
      await semViolacaoAxe(page, '/operadora/autorizacoes');
      const registrar = async (
        tipo: string,
        extra: (f: ReturnType<Page['getByTestId']>) => Promise<void>,
      ) => {
        await page.getByTestId('aut-registrar').click();
        const f = page.getByTestId('form-autorizacao');
        await expect(f).toBeVisible();
        await f.getByLabel('Carteirinha do beneficiário (16 dígitos)').fill(carteirinha);
        await escolher(f.getByTestId('aut-prestador'), { rotulo: /Laboratório sintético Alfa/ });
        await escolher(f.getByTestId('aut-tipo'), { rotulo: tipo });
        await f.getByLabel('Indicação clínica').fill('Indicação clínica sintética do pedido');
        await f.getByLabel('Nome do profissional').fill('Profissional sintético');
        await f.getByLabel('Número no conselho').fill('900031');
        await extra(f);
        await f.getByTestId('aut-gravar').click();
        await expect(page.getByTestId('aut-mensagem')).toContainText('Pedido registrado com o protocolo');
        await expect(page.getByTestId('aut-ficha-protocolo')).toHaveText(/^\d{20}$/);
        return (await page.getByTestId('aut-ficha-protocolo').textContent())?.trim() ?? '';
      };
      const sadt = await registrar('SP/SADT', async (f) => {
        await f.getByLabel('Buscar procedimento (código ou nome)').fill('hemograma');
        await f.getByTestId('aut-buscar-tuss').click();
        await f.getByTestId('aut-usar-40304361').click();
        await expect(f.getByTestId('aut-item-1').getByLabel('Código')).toHaveValue('40304361');
        await semViolacaoAxe(page, 'registrar pedido');
      });
      expect(sadt).toMatch(new RegExp(`^9${sufixo}\\d{14}$`));
      const ficha = page.getByTestId('aut-ficha');
      await expect(ficha.getByTestId('aut-ficha-situacao')).toHaveText('Em análise');
      await expect(ficha.getByTestId('aut-ficha-itens')).toContainText('Hemograma sintético');
      await expect(ficha.getByTestId('aut-ficha-criticas')).toContainText('cobertura parcial temporária');
      await expect(ficha.getByTestId('aut-decidir')).toHaveCount(0);

      const internacao = await registrar('Internação', async (f) => {
        await f.getByLabel('CID-10 (por exemplo, J18.9)').fill('J18.9');
        await expect(f.getByTestId('aut-internacao')).toBeVisible();
        await f.getByTestId('aut-item-1').getByLabel('Código').fill('40301630');
      });

      // O auditor pede complemento do SP/SADT; o atendimento registra o complemento recebido.
      await entrar(page, 'SINT.OPE.AUDITOR');
      await page.goto('/operadora/autorizacoes');
      await expect(page.getByTestId('aut-designacao')).toContainText('Médico auditor', { timeout: 30_000 });
      const abrir = async (protocolo: string) => {
        await page.getByLabel('Protocolo, senha, carteirinha ou nome do beneficiário').fill(protocolo);
        await page.getByTestId('aut-buscar').click();
        await expect(page.getByTestId('aut-lista').locator('tbody tr')).toHaveCount(1);
        await page.getByRole('button', { name: `Abrir o pedido ${protocolo}` }).click();
        await expect(ficha.getByTestId('aut-ficha-protocolo')).toHaveText(protocolo);
      };
      const dialogo = page.getByTestId('form-dialogo-autorizacao');
      await abrir(sadt);
      await ficha.getByTestId('aut-pedir-complemento').click();
      await dialogo.getByLabel('O que falta').fill('Envie o laudo do exame anterior');
      await page.getByTestId('aut-dialogo-confirmar').click();
      await expect(page.getByTestId('aut-mensagem')).toContainText('Complemento pedido');
      await expect(ficha.getByTestId('aut-ficha-situacao')).toHaveText('Aguardando complemento');

      await entrar(page, 'SINT.OPE.ATENDE');
      await page.goto('/operadora/autorizacoes');
      await expect(page.getByTestId('aut-totais')).toBeVisible({ timeout: 30_000 });
      await abrir(sadt);
      await ficha.getByTestId('aut-responder-complemento').click();
      await dialogo.getByLabel('O que o prestador enviou').fill('Laudo anterior enviado pelo prestador');
      await page.getByTestId('aut-dialogo-confirmar').click();
      await expect(ficha.getByTestId('aut-ficha-situacao')).toHaveText('Em análise');

      // O auditor autoriza o SP/SADT (a senha) e nega a internação no laboratório (a crítica impede autorizar).
      await entrar(page, 'SINT.OPE.AUDITOR');
      await page.goto('/operadora/autorizacoes');
      await expect(page.getByTestId('aut-totais')).toBeVisible({ timeout: 30_000 });
      await abrir(sadt);
      await ficha.getByTestId('aut-decidir').click();
      const dec = page.getByTestId('form-decisao');
      await dec.getByLabel('Parecer', { exact: true }).fill('Autorizado conforme a indicação clínica');
      await semViolacaoAxe(page, 'decidir pedido');
      await page.getByTestId('aut-dec-gravar').click();
      await expect(page.getByTestId('aut-mensagem')).toContainText('Pedido autorizado, senha');
      await expect(ficha.getByTestId('aut-ficha-senha')).toContainText(`9${sufixo}`);

      await abrir(internacao);
      await expect(ficha.getByTestId('aut-ficha-criticas')).toContainText('Impede autorizar');
      await ficha.getByTestId('aut-decidir').click();
      await expect(dec.getByTestId('aut-dec-decisao')).toContainText('Negar');
      await escolher(dec.getByTestId('aut-dec-critica'), { rotulo: /Cobertura do procedimento/ });
      await dec
        .getByLabel('Cláusula do contrato ou dispositivo legal')
        .fill('Cláusula 5 do contrato sintético');
      await dec.getByLabel('Parecer', { exact: true }).fill('O laboratório não tem o regime de internação');
      await page.getByTestId('aut-dec-gravar').click();
      await expect(page.getByTestId('aut-mensagem')).toContainText('Pedido negado');
      await expect(ficha.getByTestId('aut-ficha-comunicado')).toContainText(`Protocolo ${internacao}`);
      await expect(ficha.getByTestId('aut-ficha-comunicado')).toContainText(
        'Fundamento: Cláusula 5 do contrato sintético.',
      );
      await semViolacaoAxe(page, 'pedido negado com o comunicado');

      // O atendimento cancela a autorização (a senha deixa de valer).
      await entrar(page, 'SINT.OPE.ATENDE');
      await page.goto('/operadora/autorizacoes');
      await expect(page.getByTestId('aut-totais')).toBeVisible({ timeout: 30_000 });
      await abrir(sadt);
      await ficha.getByTestId('aut-cancelar').click();
      await dialogo.getByLabel('Motivo do cancelamento').fill('O prestador desistiu do pedido sintético');
      await page.getByTestId('aut-dialogo-confirmar').click();
      await page.getByTestId('confirmacao').getByRole('button', { name: 'Confirmar' }).click();
      await expect(page.getByTestId('aut-mensagem')).toContainText('deixa de valer');
      await expect(ficha.getByTestId('aut-ficha-situacao')).toHaveText('Cancelada');
    } finally {
      // Recolher: desligar a autorização (e as outras chaves do teste).
      await entrar(page, 'SINT.ADMIN');
      for (const c of ['operadora.autorizacao', 'operadora.beneficiarios', 'operadora'])
        await chave(page, c, false);
    }
    await entrar(page, 'SINT.OPE.ATENDE');
    await page.goto('/operadora/autorizacoes');
    await expect(page.getByTestId('aut-desligada')).toBeVisible({ timeout: 30_000 });
    expect(externas).toEqual([]);
  });
});
