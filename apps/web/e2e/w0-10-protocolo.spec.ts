// E2E @W0-10 (parte 11b2b, protocolo de atendimento aberto pelo portal do prestador): o administrador liga a operadora,
// o atendimento e o portal para as pessoas do teste → o gestor da operadora monta a carteira sintética e cria a conta
// do portal (com a função do protocolo) → o responsável do laboratório ativa a conta, entra e abre o protocolo pela
// tela (painel de confirmação; "Voltar" não grava) → o atendimento abre o protocolo na ficha interna, inicia a análise
// e registra o contato → o prestador vê a interação e responde com 1 arquivo (painel de confirmação; "Voltar" não
// envia) e baixa o anexo → a ficha interna mostra a resposta do prestador e baixa o mesmo arquivo → recolher; axe sem
// violação séria em cada estado. Sessão real sobre a fonte sintética de dev, tudo em MEMÓRIA (nada vai à cópia);
// documentos SINTÉTICOS. Nenhuma saída externa (vigiarExternas).
import { createHmac } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
/** As pessoas do teste e a identidade do portal do prestador (as chaves valem para ela no estabelecimento). */
const PESSOAS = ['SINT.OPERADORA', 'SINT.OPE.ATENDE', 'SGH.PORTAL.PRESTADOR'];
const CHAVES = [
  'operadora',
  'operadora.beneficiarios',
  'operadora.autorizacao',
  'operadora.atendimento',
  'operadora.portalPrestador',
];

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
  'idempotency-key': `e2e-w0-10-prot-${k}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
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
      justificativa: 'Portal do prestador sintético (E2E do W0-10, protocolo)',
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

/** O código do aplicativo autenticador (TOTP de 30 s, 6 dígitos, SHA-1), como o do celular do responsável. */
function totp(segredoBase32: string, agora = Date.now()): string {
  const ALF = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of segredoBase32.replace(/=+$/, '').toUpperCase())
    bits += ALF.indexOf(c).toString(2).padStart(5, '0');
  const bytes = Buffer.from((bits.match(/.{8}/g) ?? []).map((b) => parseInt(b, 2)));
  const passo = Buffer.alloc(8);
  passo.writeBigUInt64BE(BigInt(Math.floor(agora / 1000 / 30)));
  const h = createHmac('sha1', bytes).update(passo).digest();
  const o = h[h.length - 1]! & 0xf;
  const n = ((h[o]! & 0x7f) << 24) | (h[o + 1]! << 16) | (h[o + 2]! << 8) | h[o + 3]!;
  return String(n % 1_000_000).padStart(6, '0');
}

/** A carteira sintética pela API da F1 (o gestor da operadora): devolve a carteirinha da beneficiária. */
async function carteira(page: Page, sufixo: string): Promise<{ operadora: number; carteirinha: string }> {
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
  return { operadora: ope.id, carteirinha: ben.carteirinha! };
}

const PDF = Buffer.from('%PDF-1.4\n% guia de encaminhamento sintetica do E2E\n%%EOF\n');

test.describe('operadora: protocolo aberto pelo portal do prestador e a interação com anexo @W0-10', () => {
  test.setTimeout(420_000);

  test('ligar → conta com a função 7 → abrir o protocolo pelo portal → contato na ficha interna → resposta com PDF pelo portal → anexo na ficha → recolher; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    const sufixo = String(Date.now() % 100_000).padStart(5, '0');
    const login = `responsavel.${sufixo}@laboratorio.invalid`;
    const senhaPortal = `Portal${sufixo}abcXYZ`;

    await entrar(page, 'SINT.ADMIN');
    await prerequisito(page, 'operadora', 'credenciamento');
    await prerequisito(page, 'operadora.autorizacao', 'aprovacao');
    for (const c of CHAVES) await chave(page, c, true);

    try {
      // O gestor monta a carteira e cria a conta do portal do laboratório (com a função do protocolo).
      await entrar(page, 'SINT.OPERADORA');
      const { carteirinha } = await carteira(page, sufixo);
      await page.goto('/operadora/portal-prestador');
      await expect(page.getByTestId('portal-nova')).toBeVisible({ timeout: 30_000 });
      await page.getByTestId('portal-nova').click();
      const dlg = page.getByTestId('portal-dialogo');
      if ((await dlg.getByTestId('portal-operadora').count()) > 0)
        await escolher(dlg.getByTestId('portal-operadora'), { rotulo: new RegExp(`ANS 9${sufixo}`) });
      await escolher(dlg.getByTestId('portal-prestador'), { rotulo: /Laboratório sintético Alfa/ });
      await dlg.getByLabel('E-mail do responsável no prestador').fill(login);
      await dlg.getByLabel('Nome do responsável').fill('Responsável sintético do laboratório');
      for (const f of [1, 7]) await dlg.getByTestId(`portal-funcao-${f}`).check();
      await page.getByTestId('portal-gravar').click();
      const aviso = page.getByTestId('portal-codigo');
      await expect(aviso).toContainText('Código de ativação:');
      const ativacao =
        /Código de ativação: ([A-Z0-9]{12})/.exec((await aviso.textContent()) ?? '')?.[1] ?? '';
      expect(ativacao).toMatch(/^[A-Z0-9]{12}$/);

      // O responsável ativa a conta e entra.
      const entrarNoPortal = async (segredoAtual: string) => {
        await page.context().clearCookies();
        await page.goto('/prestador/entrar');
        await expect(page.getByTestId('portal-prestador-entrar')).toBeVisible({ timeout: 30_000 });
        await page.getByTestId('pp-login').fill(login);
        await page.getByTestId('pp-senha').fill(senhaPortal);
        await page.getByTestId('pp-codigo').fill(totp(segredoAtual));
        await page.getByTestId('pp-entrar').click();
        await expect(page).toHaveURL(/\/prestador\//, { timeout: 30_000 });
        await expect(page).not.toHaveURL(/\/prestador\/entrar/);
      };
      await page.context().clearCookies();
      await page.goto('/prestador/entrar');
      await expect(page.getByTestId('portal-prestador-entrar')).toBeVisible({ timeout: 30_000 });
      await page.getByRole('button', { name: /Primeiro acesso/ }).click();
      await page.getByTestId('pp-login').fill(login);
      await page.getByTestId('pp-ativacao').fill(ativacao);
      await page.getByTestId('pp-senha').fill(senhaPortal);
      await page.getByTestId('pp-senha2').fill(senhaPortal);
      await page.getByTestId('pp-ativar').click();
      await expect(page.getByTestId('portal-prestador-qr')).toBeVisible();
      const segredo =
        /Ou digite no aplicativo: ([A-Z2-7]+)/.exec(
          (await page.getByTestId('portal-prestador-entrar').textContent()) ?? '',
        )?.[1] ?? '';
      expect(segredo.length).toBeGreaterThanOrEqual(16);
      await entrarNoPortal(segredo);

      // O prestador abre o protocolo pela tela: o painel confirma; "Voltar" não grava.
      await page.goto('/prestador/protocolo');
      await page.getByTestId('pp-abrir-protocolo').click({ timeout: 30_000 });
      const abertura = page.getByTestId('pp-abertura');
      await abertura.locator('#pp-abertura-carteirinha').fill(carteirinha);
      await abertura.locator('#pp-abertura-assunto').fill('Dúvida sintética sobre a cobertura do exame');
      await abertura
        .locator('#pp-abertura-relato')
        .fill('O laboratório sintético pergunta se o exame tem cobertura no plano da beneficiária.');
      await semViolacaoAxe(page, 'portal: abrir o protocolo');
      await page.getByTestId('pp-abertura-enviar').click();
      await expect(page.getByTestId('pp-abertura-confirmacao')).toBeVisible();
      await semViolacaoAxe(page, 'portal: confirmar a abertura do protocolo');
      await page.getByTestId('pp-abertura-voltar').click();
      await expect(page.getByTestId('pp-abertura-confirmacao')).toHaveCount(0);
      await expect(page.getByTestId('pp-protocolo-resultado')).toHaveCount(0);
      await page.getByTestId('pp-abertura-enviar').click();
      await page.getByTestId('pp-abertura-confirmar').click();
      await expect(page.getByTestId('pp-protocolo-resultado')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('pp-protocolo-mensagem')).toBeVisible();
      const numero = /(\d{20})/.exec(
        (await page.getByTestId('pp-protocolo-mensagem').textContent()) ?? '',
      )?.[1];
      const protocolo = numero ?? (await page.locator('#pp-numero').inputValue());
      expect(protocolo).toMatch(/^\d{20}$/);
      await expect(page.getByTestId('pp-protocolo-situacao')).toContainText('Aberto');
      await expect(page.getByTestId('pp-interacoes')).toBeVisible();
      await semViolacaoAxe(page, 'portal: protocolo aberto');

      // O atendimento abre o protocolo na ficha interna, inicia a análise e registra o contato.
      await entrar(page, 'SINT.OPE.ATENDE');
      await page.goto('/operadora/autorizacoes');
      const fichaInterna = page.getByTestId('prot-ficha');
      const dialogo = page.getByTestId('prot-dialogo');
      const abrirInterno = async () => {
        await page.getByLabel('Protocolo (20 dígitos)').fill(protocolo, { timeout: 30_000 });
        await page.getByTestId('prot-consultar').click();
        await expect(page.getByTestId('prot-consulta-resultado')).toContainText(
          `Protocolo de atendimento ${protocolo}`,
        );
        await page.getByTestId('prot-consulta-abrir').click();
        await expect(fichaInterna).toBeVisible();
      };
      const confirmar = async () => {
        await page.getByTestId('prot-dialogo-confirmar').click();
        await expect(dialogo).toHaveCount(0, { timeout: 30_000 });
      };
      await abrirInterno();
      await expect(fichaInterna.getByTestId('prot-ficha-situacao')).toContainText('Aberto');
      await fichaInterna.getByTestId('prot-acao-analisar').click();
      await confirmar();
      await expect(fichaInterna.getByTestId('prot-ficha-situacao')).toContainText('Em análise');
      await fichaInterna.getByTestId('prot-acao-interagir').click();
      await dialogo
        .getByLabel('Descreva o contato')
        .fill('Pedimos ao laboratório a guia de encaminhamento do médico assistente.');
      await semViolacaoAxe(page, 'ficha interna: registrar o contato');
      await confirmar();
      await expect(fichaInterna.getByTestId('prot-ficha-eventos')).toContainText(
        'Contato com o beneficiário',
      );

      // O prestador vê a interação e responde com 1 arquivo: o painel confirma; "Voltar" não envia.
      await entrarNoPortal(segredo);
      await page.goto('/prestador/protocolo');
      await page.locator('#pp-numero').fill(protocolo, { timeout: 30_000 });
      await page.getByTestId('pp-consultar').click();
      await expect(page.getByTestId('pp-protocolo-situacao')).toContainText('Em análise', {
        timeout: 30_000,
      });
      const interacao = page.locator('article[data-testid^="pp-interacao-"]').filter({
        hasText: 'Pedimos ao laboratório a guia de encaminhamento',
      });
      await expect(interacao).toHaveCount(1);
      const evento = ((await interacao.getAttribute('data-testid')) ?? '').replace('pp-interacao-', '');
      expect(evento).toMatch(/^\d+$/);
      await page.getByTestId(`pp-responder-${evento}`).click();
      await page.locator('#pp-interacao-texto').fill('Segue a guia de encaminhamento sintética');
      await page
        .getByTestId('pp-interacao-arquivo')
        .setInputFiles({ name: 'guia-encaminhamento.pdf', mimeType: 'application/pdf', buffer: PDF });
      await expect(page.getByTestId('pp-interacao-arquivos')).toContainText('guia-encaminhamento.pdf');
      await semViolacaoAxe(page, 'portal: responder à interação');
      await page.getByTestId('pp-interacao-enviar').click();
      await expect(page.getByTestId('pp-interacao-confirmacao')).toBeVisible();
      await semViolacaoAxe(page, 'portal: confirmar a resposta à interação');
      await page.getByTestId('pp-interacao-voltar').click();
      await expect(page.getByTestId('pp-interacao-confirmacao')).toHaveCount(0);
      await expect(page.locator('[data-testid^="pp-resposta-anexo-"]')).toHaveCount(0);
      await page.getByTestId('pp-interacao-enviar').click();
      await page.getByTestId('pp-interacao-confirmar').click();
      await expect(page.getByTestId('pp-protocolo-mensagem')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId(`pp-interacao-${evento}`)).toContainText(
        'Segue a guia de encaminhamento sintética',
      );
      const linkPortal = page.locator('a[data-testid^="pp-resposta-anexo-"]');
      await expect(linkPortal).toHaveCount(1);
      const baixadoPortal = await page.request.get((await linkPortal.getAttribute('href'))!);
      expect(baixadoPortal.status()).toBe(200);
      expect(Buffer.from(await baixadoPortal.body()).equals(PDF)).toBe(true);
      await semViolacaoAxe(page, 'portal: interação respondida');

      // A ficha interna mostra a resposta do prestador e baixa o mesmo arquivo.
      await entrar(page, 'SINT.OPE.ATENDE');
      await page.goto('/operadora/autorizacoes');
      await abrirInterno();
      const respostas = fichaInterna.getByTestId('prot-respostas-prestador');
      await expect(respostas).toContainText('Segue a guia de encaminhamento sintética');
      const linkInterno = respostas.locator('a[data-testid^="prot-resposta-anexo-"]');
      await expect(linkInterno).toHaveCount(1);
      await expect(linkInterno).toContainText('guia-encaminhamento.pdf');
      await semViolacaoAxe(page, 'ficha interna com a resposta do prestador');
      const baixado = await page.request.get((await linkInterno.getAttribute('href'))!);
      expect(baixado.status()).toBe(200);
      expect(Buffer.from(await baixado.body()).equals(PDF)).toBe(true);
    } finally {
      await entrar(page, 'SINT.ADMIN');
      for (const c of [...CHAVES].reverse()) await chave(page, c, false);
    }
    expect(externas).toEqual([]);
  });
});
