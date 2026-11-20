// E2E @W0-10 (parte 11b1, operadora e portal do prestador): o administrador liga a operadora e o portal para as pessoas
// do teste → o gestor da operadora monta a carteira sintética, designa a médica auditora (tela) e o segundo auditor
// (API) e cria a conta do portal → o responsável do laboratório ativa a conta, entra e pede a autorização → a auditora
// pede o complemento (assume o pedido) → o prestador responde ao complemento pelo portal com o arquivo PDF (painel de
// confirmação; "Voltar" não envia) e vê a resposta com o download → a auditora vê o arquivo na ficha e o baixa → o
// gestor altera a designação dela (motivo; o painel com o antes e o depois) → encerrar sem a redistribuição é recusado
// (409 com a contagem e o protocolo) → a tela exige o auditor que assume, mostra a confirmação e encerra; o pedido passa
// ao segundo auditor → recolher; axe sem violação séria em cada estado. Sessão real sobre a fonte sintética de dev, tudo
// em MEMÓRIA (nada vai à cópia); documentos SINTÉTICOS. Nenhuma saída externa (vigiarExternas).
import { createHmac } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
/** As pessoas do teste e a identidade do portal do prestador (as chaves valem para ela no estabelecimento). */
const PESSOAS = ['SINT.OPERADORA', 'SINT.OPE.ATENDE', 'SINT.OPE.AUDITOR', 'SGH.PORTAL.PRESTADOR'];
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
  'idempotency-key': `e2e-w0-10-ope-${k}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
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
      justificativa: 'Portal do prestador sintético (E2E do W0-10)',
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

/** O cabeçalho CSRF do portal do prestador (token duplo: o cookie repetido no cabeçalho). */
async function csrfPortal(page: Page): Promise<string> {
  return (await page.context().cookies()).find((c) => c.name === 'sgh_portal_prestador_csrf')?.value ?? '';
}

type Auditor = {
  id: number;
  operadora: number;
  login: string;
  versao: number;
  emAnalise: number;
  situacao: string;
};
async function auditores(page: Page, operadora: number): Promise<Auditor[]> {
  const r = await page.request.get('/api/operadora/auditores');
  expect(r.status(), await r.text()).toBe(200);
  return ((await r.json()) as { itens: Auditor[] }).itens.filter((a) => a.operadora === operadora);
}

const PDF = Buffer.from('%PDF-1.4\n% laudo anterior sintetico do E2E\n%%EOF\n');

test.describe('operadora: resposta do prestador com anexo e designação do auditor @W0-10', () => {
  test.setTimeout(480_000);

  test('ligar → designar → conta → pedido → complemento → resposta com PDF pelo portal → anexo na ficha → alterar o auditor → encerrar recusado sem redistribuição → encerrar com redistribuição → recolher; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    const sufixo = String(Date.now() % 100_000).padStart(5, '0');
    const login = `responsavel.${sufixo}@laboratorio.invalid`;
    const senhaPortal = `Portal${sufixo}abcXYZ`;
    const hoje = new Date().toISOString().slice(0, 10);

    await entrar(page, 'SINT.ADMIN');
    await prerequisito(page, 'operadora', 'credenciamento');
    await prerequisito(page, 'operadora.autorizacao', 'aprovacao');
    for (const c of CHAVES) await chave(page, c, true);

    try {
      // O gestor monta a carteira, designa a médica auditora pela tela e o segundo auditor pela API.
      await entrar(page, 'SINT.OPERADORA');
      const { operadora, carteirinha } = await carteira(page, sufixo);
      await page.goto('/operadora/beneficiarios');
      await page.getByTestId('aba-auditores').click({ timeout: 30_000 });
      await page.getByTestId('aut-designar').click();
      const des = page.getByTestId('form-designar');
      await escolher(des.getByTestId('aut-des-operadora'), { rotulo: new RegExp(`ANS 9${sufixo}`) });
      await des.getByLabel('Usuário').fill('SINT.OPE.AUDITOR');
      await des.getByLabel('Nome', { exact: true }).fill('Auditora sintética');
      await escolher(des.getByTestId('aut-des-categoria'), { rotulo: 'Médico auditor' });
      await des.getByLabel('Número no conselho').fill('900021');
      await page.getByTestId('aut-des-gravar').click();
      await expect(page.getByTestId('aut-auditores-mensagem')).toContainText('CRM 900021/SC');
      const dois = await page.request.post('/api/operadora/auditores', {
        headers: await cabecalhos(page, 'auditor2'),
        data: {
          operadora,
          login: 'SINT.OPE.AUDITOR2',
          nome: 'Auditor sintético Dois',
          categoria: 'medico',
          numero: '900013',
          uf: 'SC',
          inicio: hoje,
        },
      });
      expect(dois.status(), await dois.text()).toBe(200);
      const designados = await auditores(page, operadora);
      const a1 = designados.find((a) => a.login === 'SINT.OPE.AUDITOR' && a.situacao === 'ativo')!;
      const a2 = designados.find((a) => a.login === 'SINT.OPE.AUDITOR2' && a.situacao === 'ativo')!;
      expect(a1 && a2).toBeTruthy();

      // A conta do portal do laboratório.
      await page.goto('/operadora/portal-prestador');
      await expect(page.getByTestId('portal-nova')).toBeVisible({ timeout: 30_000 });
      await page.getByTestId('portal-nova').click();
      const dlg = page.getByTestId('portal-dialogo');
      if ((await dlg.getByTestId('portal-operadora').count()) > 0)
        await escolher(dlg.getByTestId('portal-operadora'), { rotulo: new RegExp(`ANS 9${sufixo}`) });
      await escolher(dlg.getByTestId('portal-prestador'), { rotulo: /Laboratório sintético Alfa/ });
      await dlg.getByLabel('E-mail do responsável no prestador').fill(login);
      await dlg.getByLabel('Nome do responsável').fill('Responsável sintético do laboratório');
      for (const f of [1, 2, 3, 7]) await dlg.getByTestId(`portal-funcao-${f}`).check();
      await page.getByTestId('portal-gravar').click();
      const aviso = page.getByTestId('portal-codigo');
      await expect(aviso).toContainText('Código de ativação:');
      const ativacao =
        /Código de ativação: ([A-Z0-9]{12})/.exec((await aviso.textContent()) ?? '')?.[1] ?? '';
      expect(ativacao).toMatch(/^[A-Z0-9]{12}$/);

      // O responsável ativa, entra e pede a autorização (o servidor tira o prestador e a origem da conta).
      const entrarNoPortal = async (segredoAtual: string) => {
        await page.context().clearCookies();
        await page.goto('/prestador/entrar');
        await expect(page.getByTestId('portal-prestador-entrar')).toBeVisible({ timeout: 30_000 });
        await page.getByTestId('pp-login').fill(login);
        await page.getByTestId('pp-senha').fill(senhaPortal);
        await page.getByTestId('pp-codigo').fill(totp(segredoAtual));
        await page.getByTestId('pp-entrar').click();
        await expect(page).toHaveURL(/\/prestador\/pedidos/, { timeout: 30_000 });
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
      const ped = await page.request.post('/api/portal-prestador/autorizacoes', {
        headers: {
          'x-csrf-portal-prestador': await csrfPortal(page),
          'idempotency-key': `e2e-w0-10-ope-pedido-${sufixo}`,
        },
        data: {
          carteirinha,
          tipoGuia: 4,
          carater: 'E',
          altaComplexidade: false,
          guiaPrincipal: null,
          cid: null,
          indicacaoClinica: 'Indicação clínica sintética do pedido',
          profissional: { nome: 'Profissional sintético', conselho: 'CRM', numero: '900031', uf: 'SC' },
          internacao: null,
          itens: [{ tabela: 22, codigo: '40304361', descricao: null, quantidade: 1 }],
        },
      });
      expect(ped.status(), await ped.text()).toBe(200);
      const pedido = (await ped.json()) as { id: number; protocolo: string };
      expect(pedido.protocolo).toMatch(/^\d{20}$/);

      // A auditora pede o complemento (e assume o pedido).
      await entrar(page, 'SINT.OPE.AUDITOR');
      await page.goto('/operadora/autorizacoes');
      await expect(page.getByTestId('aut-designacao')).toContainText('Médico auditor', { timeout: 30_000 });
      const ficha = page.getByTestId('aut-ficha');
      const abrir = async () => {
        await page.getByLabel('Protocolo, senha, carteirinha ou nome do beneficiário').fill(pedido.protocolo);
        await page.getByTestId('aut-buscar').click();
        await expect(page.getByTestId('aut-lista').locator('tbody tr')).toHaveCount(1);
        await page.getByRole('button', { name: `Abrir o pedido ${pedido.protocolo}` }).click();
        await expect(ficha.getByTestId('aut-ficha-protocolo')).toHaveText(pedido.protocolo);
      };
      await abrir();
      await ficha.getByTestId('aut-pedir-complemento').click();
      await page
        .getByTestId('form-dialogo-autorizacao')
        .getByLabel('O que falta')
        .fill('Envie o laudo do exame anterior');
      await page.getByTestId('aut-dialogo-confirmar').click();
      await expect(ficha.getByTestId('aut-ficha-situacao')).toHaveText('Aguardando complemento', {
        timeout: 30_000,
      });

      // O prestador responde ao complemento pelo portal, com o PDF.
      await entrarNoPortal(segredo);
      await page.getByTestId(`pp-abrir-${pedido.id}`).click({ timeout: 30_000 });
      const comp = page.getByTestId('pp-complemento');
      await expect(page.getByTestId('pp-complemento-pedido')).toContainText(
        'Envie o laudo do exame anterior',
      );
      await page.getByTestId('pp-complemento-responder').click();
      await page.locator('#pp-complemento-texto').fill('Segue o laudo anterior sintético');
      await page
        .getByTestId('pp-complemento-arquivo')
        .setInputFiles({ name: 'laudo-anterior.pdf', mimeType: 'application/pdf', buffer: PDF });
      await expect(page.getByTestId('pp-complemento-arquivos')).toContainText('laudo-anterior.pdf');
      await semViolacaoAxe(page, 'portal: resposta ao complemento');
      await page.getByTestId('pp-complemento-enviar').click();
      await expect(page.getByTestId('pp-complemento-confirmacao')).toBeVisible();
      await semViolacaoAxe(page, 'portal: confirmar a resposta ao complemento');
      await page.getByTestId('pp-complemento-voltar').click();
      await expect(page.getByTestId('pp-complemento-confirmacao')).toHaveCount(0);
      await page.getByTestId('pp-complemento-enviar').click();
      await page.getByTestId('pp-complemento-confirmar').click();
      await expect(comp).toContainText('Segue o laudo anterior sintético', { timeout: 30_000 });
      const linkPortal = comp.locator('a[data-testid^="pp-complemento-anexo-"]');
      await expect(linkPortal).toHaveCount(1);
      await expect(page.getByTestId('pp-complemento-responder')).toHaveCount(0);
      const baixadoPortal = await page.request.get((await linkPortal.getAttribute('href'))!);
      expect(baixadoPortal.status()).toBe(200);
      expect(Buffer.from(await baixadoPortal.body()).equals(PDF)).toBe(true);

      // A auditora vê o arquivo na ficha e o baixa.
      await entrar(page, 'SINT.OPE.AUDITOR');
      await page.goto('/operadora/autorizacoes');
      await expect(page.getByTestId('aut-designacao')).toBeVisible({ timeout: 30_000 });
      await abrir();
      await expect(ficha.getByTestId('aut-ficha-situacao')).toHaveText('Em análise');
      const anexos = ficha.getByTestId('aut-ficha-anexos');
      await expect(anexos).toContainText('laudo-anterior.pdf');
      await semViolacaoAxe(page, 'ficha com o anexo do complemento');
      const baixado = await page.request.get((await anexos.locator('a').first().getAttribute('href'))!);
      expect(baixado.status()).toBe(200);
      expect(baixado.headers()['x-anexo-sha256']).toMatch(/^[0-9a-f]{64}$/);
      expect(Buffer.from(await baixado.body()).equals(PDF)).toBe(true);

      // O gestor altera a designação (motivo; o painel com o antes e o depois).
      await entrar(page, 'SINT.OPERADORA');
      await page.goto('/operadora/beneficiarios');
      await page.getByTestId('aba-auditores').click({ timeout: 30_000 });
      await page.getByTestId(`aut-alterar-${a1.id}`).click();
      const alt = page.getByTestId('form-alterar-auditor');
      await alt.locator('#aut-alt-numero').fill('900022');
      await alt.locator('#aut-alt-motivo').fill('Número do conselho corrigido pela diretoria');
      await page.getByTestId('aut-alt-revisar').click();
      const confAlt = page.getByTestId('aut-alt-confirmacao');
      await expect(confAlt).toContainText('CRM 900021/SC');
      await expect(confAlt).toContainText('CRM 900022/SC');
      await semViolacaoAxe(page, 'alterar a designação: confirmação');
      await page.getByTestId('aut-alt-gravar').click();
      await expect(page.getByTestId('form-alterar-auditor')).toHaveCount(0, { timeout: 30_000 });
      await expect(page.getByTestId('aut-auditores-lista')).toContainText('900022');
      const alterado = (await auditores(page, operadora)).find((a) => a.id === a1.id)!;
      expect(alterado.versao).toBeGreaterThan(a1.versao);
      expect(alterado.emAnalise).toBe(1);

      // Encerrar sem a redistribuição: 409 com a contagem e o protocolo; nada muda.
      const recusa = await page.request.post(`/api/operadora/auditores/${a1.id}/encerrar`, {
        headers: await cabecalhos(page, 'encerrar-sem'),
        data: { versao: alterado.versao, motivo: 'Troca sintética do auditor' },
      });
      expect(recusa.status()).toBe(409);
      const problema = (await recusa.json()) as {
        codigo: string;
        dependentes: { quantidade: number; amostra: string[] }[];
      };
      expect(problema.codigo).toBe('auditor-com-autorizacoes');
      expect(problema.dependentes[0]).toMatchObject({ quantidade: 1, amostra: [pedido.protocolo] });

      // A tela exige o auditor que assume, mostra a confirmação e encerra.
      await page.getByTestId(`aut-encerrar-${a1.id}`).click();
      await page.locator('#aut-enc-motivo').fill('Troca sintética do auditor');
      await expect(page.getByTestId('aut-enc-pedidos')).toBeVisible();
      await expect(page.getByTestId('aut-enc-revisar')).toBeDisabled();
      await escolher(page.getByTestId('aut-enc-redistribuir'), { rotulo: /Auditor sintético Dois/ });
      await page.getByTestId('aut-enc-revisar').click();
      await expect(page.getByTestId('aut-enc-confirmacao')).toContainText('Auditor sintético Dois');
      await semViolacaoAxe(page, 'encerrar com a redistribuição: confirmação');
      await page.getByTestId('aut-enc-gravar').click();
      await expect(page.getByTestId('aut-auditores-mensagem')).toContainText(
        '1 pedido(s) em análise passaram',
        {
          timeout: 30_000,
        },
      );
      const depois = await auditores(page, operadora);
      expect(depois.find((a) => a.id === a1.id)).toMatchObject({ situacao: 'encerrado', emAnalise: 0 });
      expect(depois.find((a) => a.id === a2.id)).toMatchObject({ situacao: 'ativo', emAnalise: 1 });
    } finally {
      await entrar(page, 'SINT.ADMIN');
      for (const c of [...CHAVES].reverse()) await chave(page, c, false);
    }
    expect(externas).toEqual([]);
  });
});
