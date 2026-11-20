// E2E @W0-10 (parte 11a, portal do prestador): o administrador liga a operadora e o portal para as pessoas do teste →
// o gestor da operadora monta a carteira sintética e cria a conta do portal → o responsável do laboratório ativa a
// conta, entra e consulta a elegibilidade da beneficiária (M7: resultado com plano, validade, carências e cobertura, o
// número do registro da consulta e a linha nas últimas consultas; a carteirinha desconhecida dá inelegível, também
// registrada) → troca a senha (painel de confirmação; "Voltar" não envia nada) e o aplicativo autenticador (código
// novo confirmado pelo aplicativo novo) → sai e entra com a senha nova e o aplicativo novo; a senha antiga é recusada →
// recolher; axe sem violação séria em cada estado. Sessão real sobre a fonte sintética de dev, tudo em MEMÓRIA (nada vai
// à cópia); documentos SINTÉTICOS. Nenhuma saída externa (vigiarExternas).
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
  'idempotency-key': `e2e-w0-10-pp-${k}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
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

test.describe('portal do prestador: elegibilidade e trocas da conta @W0-10', () => {
  test.setTimeout(420_000);

  test('ligar → conta → ativar → elegibilidade (registrada) → troca de senha e de autenticador com confirmação → entrar com as novas → recolher; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    const sufixo = String(Date.now() % 100_000).padStart(5, '0');
    const login = `responsavel.${sufixo}@laboratorio.invalid`;
    const senhaPortal = `Portal${sufixo}abcXYZ`;
    const senhaNova = `Trocada${sufixo}defUVW`;

    await entrar(page, 'SINT.ADMIN');
    await prerequisito(page, 'operadora', 'credenciamento');
    await prerequisito(page, 'operadora.autorizacao', 'aprovacao');
    for (const c of CHAVES) await chave(page, c, true);

    try {
      await entrar(page, 'SINT.OPERADORA');
      const carteirinha = await carteira(page, sufixo);
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

      // Ativar a conta e entrar.
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
      await page.getByTestId('pp-login').fill(login);
      await page.getByTestId('pp-senha').fill(senhaPortal);
      await page.getByTestId('pp-codigo').fill(totp(segredo));
      await page.getByTestId('pp-entrar').click();
      await expect(page).toHaveURL(/\/prestador\/pedidos/, { timeout: 30_000 });

      // M7: elegibilidade da beneficiária, com o registro da consulta.
      await page.getByTestId('portal-prestador-menu-elegibilidade').click();
      await expect(page).toHaveURL(/\/prestador\/elegibilidade/);
      await expect(page.getByTestId('pp-eleg-form')).toBeVisible({ timeout: 30_000 });
      await semViolacaoAxe(page, '/prestador/elegibilidade');
      await page.getByTestId('pp-eleg-carteirinha').fill(carteirinha);
      await page.getByTestId('pp-eleg-consultar').click();
      const res = page.getByTestId('pp-eleg-resultado');
      await expect(res).toHaveAttribute('data-elegivel', 'true', { timeout: 30_000 });
      await expect(res).toContainText(`Beneficiária sintética ${sufixo}`);
      await expect(res.getByTestId('pp-eleg-plano')).toContainText(`Plano sintético ${sufixo}`);
      await expect(res.getByTestId('pp-eleg-validade')).toBeVisible();
      await expect(res.getByTestId('pp-eleg-carencias')).toBeVisible();
      await expect(res.getByTestId('pp-eleg-cobertura')).toBeVisible();
      await expect(res.getByTestId('pp-eleg-registro')).toBeVisible();
      const ultimas = page.getByTestId('pp-eleg-ultimas');
      await expect(ultimas.locator('tbody tr')).toHaveCount(1);
      await expect(ultimas).toContainText(carteirinha);
      await semViolacaoAxe(page, 'elegibilidade: elegível');
      // A carteirinha desconhecida: inelegível, também registrada.
      await page.getByTestId('pp-eleg-carteirinha').fill('9999999999999999');
      await page.getByTestId('pp-eleg-consultar').click();
      await expect(res).toHaveAttribute('data-elegivel', 'false', { timeout: 30_000 });
      await expect(res.getByTestId('pp-eleg-motivos')).toBeVisible();
      await expect(ultimas.locator('tbody tr')).toHaveCount(2);
      await semViolacaoAxe(page, 'elegibilidade: inelegível');

      // Troca da senha: o painel de confirmação; "Voltar" não envia nada.
      await page.getByTestId('portal-prestador-menu-conta').click();
      await expect(page).toHaveURL(/\/prestador\/conta/);
      await expect(page.getByTestId('pp-form-senha')).toBeVisible({ timeout: 30_000 });
      await semViolacaoAxe(page, '/prestador/conta');
      await page.getByTestId('pp-senha-atual').fill(senhaPortal);
      await page.getByTestId('pp-senha-nova').fill(senhaNova);
      await page.getByTestId('pp-senha-repetir').fill(senhaNova);
      await page.getByTestId('pp-senha-codigo').fill(totp(segredo));
      await page.getByTestId('pp-senha-trocar').click();
      const painel = page.getByTestId('pp-conta-confirmacao');
      await expect(painel).toBeVisible();
      await semViolacaoAxe(page, 'conta: confirmar a troca da senha');
      await page.getByTestId('pp-conta-voltar').click();
      await expect(painel).toHaveCount(0);
      await page.getByTestId('pp-senha-trocar').click();
      await page.getByTestId('pp-conta-confirmar').click();
      await expect(page.getByTestId('pp-conta')).toContainText('Senha trocada', { timeout: 30_000 });

      // Troca do aplicativo autenticador: a senha (nova) e o código do atual geram o novo, confirmado pelo novo.
      await page.getByTestId('pp-aut-senha').fill(senhaNova);
      await page.getByTestId('pp-aut-codigo').fill(totp(segredo));
      await page.getByTestId('pp-aut-iniciar').click();
      await expect(painel).toBeVisible();
      await page.getByTestId('pp-conta-confirmar').click();
      await expect(page.getByTestId('pp-aut-qr')).toBeVisible({ timeout: 30_000 });
      const segredoNovo =
        /([A-Z2-7]{16,})/.exec((await page.getByTestId('pp-aut-chave').textContent()) ?? '')?.[1] ?? '';
      expect(segredoNovo.length).toBeGreaterThanOrEqual(16);
      expect(segredoNovo).not.toBe(segredo);
      await semViolacaoAxe(page, 'conta: QR do aplicativo novo');
      await page.getByTestId('pp-aut-codigo-novo').fill(totp(segredoNovo));
      await page.getByTestId('pp-aut-confirmar').click();
      await expect(painel).toBeVisible();
      await page.getByTestId('pp-conta-confirmar').click();
      await expect(page.getByTestId('pp-conta')).toContainText('Aplicativo autenticador trocado', {
        timeout: 30_000,
      });

      // Sair e entrar: a senha antiga é recusada; a nova com o aplicativo novo entra.
      await page.context().clearCookies();
      await page.goto('/prestador/entrar');
      await expect(page.getByTestId('portal-prestador-entrar')).toBeVisible({ timeout: 30_000 });
      await page.getByTestId('pp-login').fill(login);
      await page.getByTestId('pp-senha').fill(senhaPortal);
      await page.getByTestId('pp-codigo').fill(totp(segredoNovo));
      await page.getByTestId('pp-entrar').click();
      await expect(page.getByTestId('pp-recusa')).toBeVisible({ timeout: 30_000 });
      await expect(page).toHaveURL(/\/prestador\/entrar/);
      await page.getByTestId('pp-senha').fill(senhaNova);
      await page.getByTestId('pp-codigo').fill(totp(segredoNovo));
      await page.getByTestId('pp-entrar').click();
      await expect(page).toHaveURL(/\/prestador\/pedidos/, { timeout: 30_000 });
      await expect(page.getByTestId('portal-prestador-ola')).toContainText('Responsável sintético');
    } finally {
      await entrar(page, 'SINT.ADMIN');
      for (const c of [...CHAVES].reverse()) await chave(page, c, false);
    }
    expect(externas).toEqual([]);
  });
});
