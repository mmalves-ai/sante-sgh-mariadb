// E2E @M56.7 (ficha do M56, etapa 7 de 8, fatia F6; seções 7, 8 e 10 na parte das obrigações com a ANS): os envios
// nascem desligados (a tela diz o motivo) → o administrador registra os pré-requisitos (certificado e a conferência
// no validador oficial) e liga a operadora, os beneficiários e os envios para a pessoa do teste → o responsável pelos
// envios monta a carteira sintética → a aba de pendências do SIB mostra o beneficiário sem endereço e o complemento
// grava → a prévia do SIB da competência encerrada sai sem problemas e o arquivo é gerado com o SHA-256 → transmitir
// (simulador: sem recibo) → retorno simulado com o CCO → a TPS do trimestre com os valores vigentes → o aviso de
// ressarcimento ao SUS colado, com a sugestão de impugnação e a decisão → recolher; axe sem violação séria em cada
// estado. Sessão real sobre a fonte sintética de dev, tudo em MEMÓRIA (nada vai à cópia); documentos SINTÉTICOS.
import { expect, test, type Page } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const PESSOAS = ['SINT.OPERADORA'];
const CHAVES = ['operadora', 'operadora.beneficiarios', 'operadora.ans'];

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
  'idempotency-key': `e2e-m56-7-${k}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
});
async function postar<T>(page: Page, url: string, data: unknown, status = 200): Promise<T> {
  const r = await page.request.post(url, { headers: await cabecalhos(page, url.split('/').pop()!), data });
  expect(r.status(), await r.text()).toBe(status);
  return (await r.json()) as T;
}

/** Liga ou desliga a chave para a pessoa do teste (Funcionalidades por estabelecimento; reautenticação). */
async function chave(page: Page, nome: string, ligar: boolean): Promise<void> {
  const r = await page.request.post('/api/administracao/liberacao', {
    headers: await cabecalhos(page, `${nome}-${ligar}`),
    data: {
      chave: nome,
      tipo: 'recurso',
      escopo: 'pessoa',
      valores: PESSOAS,
      ligar,
      justificativa: 'Envios à ANS sintéticos (E2E da etapa 7)',
      senha: SENHA,
    },
  });
  expect(r.status(), await r.text()).toBe(200);
}

async function prerequisito(page: Page, recurso: string, tipo: string): Promise<void> {
  const r = await page.request.put('/api/administracao/liberacao/prerequisitos', {
    headers: await cabecalhos(page, `pre-${recurso}-${tipo}`),
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

/** A carteira sintética pela API da F1: a operadora, o beneficiário e a carteirinha. */
async function carteira(
  page: Page,
  sufixo: string,
): Promise<{ operadora: number; beneficiario: number; carteirinha: string }> {
  const ope = await postar<{ id: number }>(
    page,
    '/api/operadora/empresas',
    {
      registroAns: `9${sufixo}`,
      cnpj: cnpj(`9${sufixo}000001`.slice(0, 12)),
      razaoSocial: `Operadora sintética ${sufixo}`,
      modalidade: 'medicinaGrupo',
    },
    201,
  );
  const prod = await postar<{ id: number }>(
    page,
    '/api/operadora/produtos',
    {
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
      carencias: { urgencia: 1, partos: 300, demais: 30, cpt: 0 },
      precos: [100, 120, 130, 140, 150, 170, 200, 240, 300, 400],
    },
    201,
  );
  const ctr = await postar<{ id: number }>(
    page,
    '/api/operadora/contratos',
    {
      produto: prod.id,
      numero: `E2E-${sufixo}-1`,
      tipo: 1,
      contratanteNome: 'Contratante sintético do E2E',
      contratanteDocumento: cpf(`8${sufixo}012`.slice(0, 9)),
      formaReajuste: 1,
      mesReajuste: 5,
      tipoVigencia: 2,
      inicio: '2026-01-01',
    },
    201,
  );
  const ben = await postar<{ id: number; carteirinha: string }>(
    page,
    '/api/operadora/beneficiarios',
    {
      contrato: ctr.id,
      vinculo: 1,
      nome: `Beneficiário sintético ${sufixo}`,
      cpf: cpf(`7${sufixo}023`.slice(0, 9)),
      nascimento: '1975-03-10',
      sexo: 'M',
      nomeMae: 'Mãe sintética',
      inclusao: '2026-02-01',
    },
    201,
  );
  return { operadora: ope.id, beneficiario: ben.id, carteirinha: ben.carteirinha };
}

/** A competência mensal encerrada (o mês anterior) e o trimestre encerrado mais recente. */
function competencias(): { mes: string; trimestre: string; dia: string } {
  const d = new Date();
  const p = (x: number) => String(x).padStart(2, '0');
  const anterior = new Date(d.getFullYear(), d.getMonth() - 1, 1);
  const tri = Math.floor(d.getMonth() / 3); // trimestre corrente (0 a 3): o encerrado é o anterior
  const anoTri = tri === 0 ? d.getFullYear() - 1 : d.getFullYear();
  return {
    mes: `${anterior.getFullYear()}-${p(anterior.getMonth() + 1)}`,
    trimestre: `${anoTri}-T${tri === 0 ? 4 : tri}`,
    dia: `${p(anterior.getDate())}/${p(anterior.getMonth() + 1)}/${anterior.getFullYear()}`,
  };
}

test.describe('operadora própria, etapa 7: obrigações com a ANS @M56.7', () => {
  test.setTimeout(300_000);
  test.use({ actionTimeout: 30_000 });

  test('desligada → ligar → pendência do SIB → complemento → prévia → gerar → transmitir → retorno → TPS → aviso do SUS → decidir → recolher; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    const sufixo = String(Date.now() % 100_000).padStart(5, '0');
    const c = competencias();

    // Os envios nascem desligados (POL-3): a tela diz o motivo e mostra os catálogos da ANS.
    await entrar(page, 'SINT.OPERADORA');
    await page.goto('/operadora/ans');
    await expect(page.getByTestId('tela-operadora-ans')).toBeVisible();
    await expect(page.getByTestId('ans-desligada')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('ans-lista')).toHaveCount(0);
    await semViolacaoAxe(page, '/operadora/ans (desligada)');

    // O administrador registra os pré-requisitos e liga as chaves para a pessoa do teste.
    await entrar(page, 'SINT.ADMIN');
    await prerequisito(page, 'operadora', 'credenciamento');
    await prerequisito(page, 'operadora.ans', 'certificado');
    await prerequisito(page, 'operadora.ans', 'aprovacao');
    for (const k of CHAVES) await chave(page, k, true);

    await entrar(page, 'SINT.OPERADORA');
    const cart = await carteira(page, sufixo);
    await page.goto('/operadora/ans');
    await expect(page.getByTestId('ans-destino')).toBeVisible({ timeout: 30_000 });
    await escolher(page.getByTestId('ans-operadora'), String(cart.operadora));

    // Pendências do SIB: o beneficiário sem endereço; o complemento grava.
    await page.getByTestId('ans-aba-sib').click();
    const pend = page.getByTestId(`ans-sib-${cart.beneficiario}`);
    await expect(pend).toBeVisible();
    await semViolacaoAxe(page, '/operadora/ans (pendências do SIB)');
    await page.getByTestId(`ans-sib-complementar-${cart.beneficiario}`).click();
    const comp = page.getByTestId('ans-complemento');
    await expect(comp).toBeVisible();
    await page.locator('#sib-logradouro').fill('Rua Sintética do E2E');
    await page.locator('#sib-numero').fill('10');
    await page.locator('#sib-bairro').fill('Centro');
    await page.locator('#sib-municipio').fill('4205407');
    await page.locator('#sib-cep').fill('88000000');
    await semViolacaoAxe(page, '/operadora/ans (complemento do SIB)');
    await page.getByTestId('ans-complemento-gravar').click();
    await expect(page.getByTestId('ans-sib-mensagem')).toBeVisible();

    // SIB da competência encerrada: prévia sem problemas, gerar, a ficha com o SHA-256.
    await page.getByTestId('ans-aba-envios').click();
    await page.getByTestId('ans-novo').click();
    const gerar = page.getByTestId('ans-gerar');
    await expect(gerar).toBeVisible();
    await escolher(page.getByTestId('ans-gerar-obrigacao'), 'SIB');
    await page.locator('#ans-gerar-competencia').fill(c.mes);
    await page.getByTestId('ans-previa').click();
    await expect(page.getByTestId('ans-previa-sem-problemas')).toBeVisible();
    await semViolacaoAxe(page, '/operadora/ans (prévia do SIB)');
    await page.getByTestId('ans-gerar-confirmar').click();
    await expect(page.getByTestId('ans-mensagem')).toBeVisible();
    const linha = page.getByTestId('ans-lista').locator('tr[data-testid^="ans-envio-"]').first();
    await expect(linha).toBeVisible();
    await linha.locator('[data-testid^="ans-abrir-"]').click();
    const ficha = page.getByTestId('ans-ficha');
    await expect(ficha).toBeVisible();
    await expect(page.getByTestId('ans-ficha-situacao')).toHaveAttribute('data-situacao', 'gerado');
    await expect(page.getByTestId('ans-ficha-hash')).toHaveText(/^[0-9a-f]{64}$/);
    await expect(page.getByTestId('ans-item-1')).toBeVisible();
    await semViolacaoAxe(page, '/operadora/ans (ficha do SIB)');

    // Transmitir no simulador (sem recibo) e o retorno simulado com o CCO.
    await page.getByTestId('ans-transmitir').click();
    await expect(page.getByTestId('ans-dialogo')).toBeVisible();
    await page.getByTestId('ans-dialogo-confirmar').click();
    await expect(page.getByTestId('ans-ficha-situacao')).toHaveAttribute('data-situacao', 'enviado');
    await page.getByTestId('ans-retorno').click();
    await expect(page.getByTestId('ans-retorno-modo')).toBeVisible();
    await semViolacaoAxe(page, '/operadora/ans (retorno)');
    await page.getByTestId('ans-dialogo-confirmar').click();
    await expect(page.getByTestId('ans-ficha-situacao')).toHaveAttribute('data-situacao', 'aceito');
    await expect(page.getByTestId('ans-ficha-historico').locator('li')).toHaveCount(3);

    // TPS do trimestre encerrado: os valores vigentes da ANS na prévia.
    await page.getByTestId('ans-novo').click();
    await escolher(page.getByTestId('ans-gerar-obrigacao'), 'TPS');
    await page.locator('#ans-gerar-competencia').fill(c.trimestre);
    await expect(page.getByTestId('ans-gerar-valores-tps').locator('li').first()).toBeVisible();
    await page.getByTestId('ans-previa').click();
    await expect(page.getByTestId('ans-previa-resultado')).toBeVisible();
    await semViolacaoAxe(page, '/operadora/ans (prévia da TPS)');
    await page.getByTestId('ans-gerar-confirmar').click();
    await expect(page.getByTestId('ans-mensagem')).toBeVisible();

    // Ressarcimento ao SUS: o aviso colado (o beneficiário coberto e o desconhecido), a sugestão e a decisão.
    await page.getByTestId('ans-aba-ressarcimento').click();
    await page.getByTestId('ans-novo-aviso').click();
    await expect(page.getByTestId('ans-aviso')).toBeVisible();
    await page.locator('#ans-aviso-numero').fill(`77${sufixo}`);
    await page
      .locator('#ans-aviso-atendimentos')
      .fill(
        [
          `AIH;4126000000011;${cart.carteirinha};${c.dia};${c.dia};0303010010;1500,50`,
          `APAC;4126000000022;123456789012345;${c.dia};${c.dia};0304010014;300,00`,
        ].join('\n'),
      );
    await expect(page.getByTestId('ans-aviso-lidos')).toBeVisible();
    await semViolacaoAxe(page, '/operadora/ans (aviso de ressarcimento)');
    await page.getByTestId('ans-aviso-registrar').click();
    await expect(page.getByTestId('ans-mensagem')).toBeVisible();
    const aviso = page.getByTestId('ans-lista').locator('tr[data-testid^="ans-envio-"]').first();
    await aviso.locator('[data-testid^="ans-abrir-"]').click();
    await expect(page.getByTestId('ans-ficha')).toBeVisible();
    await expect(page.getByTestId('ans-item-2')).toBeVisible();
    await page.getByTestId('ans-decidir-2').click();
    await expect(page.getByTestId('ans-decisao-sugestao')).toBeVisible();
    await semViolacaoAxe(page, '/operadora/ans (decisão do atendimento)');
    await page.getByTestId('ans-dialogo-confirmar').click();
    await expect(page.getByTestId('ans-item-2').locator('[data-decisao="impugnar"]')).toBeVisible();

    // Recolher: desligar os envios para a pessoa; a tela volta a mostrar o motivo.
    await entrar(page, 'SINT.ADMIN');
    await chave(page, 'operadora.ans', false);
    await entrar(page, 'SINT.OPERADORA');
    await page.goto('/operadora/ans');
    await expect(page.getByTestId('ans-desligada')).toBeVisible({ timeout: 30_000 });
    for (const k of ['operadora.beneficiarios', 'operadora']) {
      await entrar(page, 'SINT.ADMIN');
      await chave(page, k, false);
    }
    expect(externas).toEqual([]);
  });
});
