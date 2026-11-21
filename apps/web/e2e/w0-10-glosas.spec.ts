// E2E @W0-10 (parte 11e, M8 no portal do prestador): o administrador liga a operadora, as contas e o portal para as
// pessoas do teste → o gestor da operadora cria a operadora sintética, designa o médico auditor e cria a conta do
// portal do Laboratório sintético Alfa → o responsável ativa a conta, entra e envia o lote XML TISS pelas "Contas" (o
// arquivo com erro de XSD é recusado; o certo, com o painel de confirmação, recebe o protocolo) → o auditor conclui a
// análise (a guia de carteirinha desconhecida fica toda glosada) → no portal, "Glosas e recurso": o item glosado com o
// motivo; marca o item, valor e justificativas; painel de confirmação ("Voltar" não envia nada); o recurso fica
// "aguardando decisão" e a guia não se recorre de novo → na ficha interna, o recurso por item aparece e o auditor
// decide item a item (acatado em parte, com parecer) → o prestador vê a decisão do item → recolher; axe sem violação
// séria em cada estado. Sessão real sobre a fonte sintética de dev, tudo em MEMÓRIA (nada vai à cópia); documentos
// SINTÉTICOS (dígitos calculados aqui). Nenhuma saída externa (vigiarExternas).
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { mensagemLoteGuias, type Cabecalho, type GuiaSpSadt } from '@sgh/dominio-faturamento';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';

const SENHA = 'Sintetico#2026';
/** As pessoas do teste e a identidade do portal do prestador (as chaves valem para elas no estabelecimento). */
const PESSOAS = ['SINT.OPERADORA', 'SINT.OPE.AUDITOR', 'SGH.PORTAL.PRESTADOR'];
const CHAVES = [
  'operadora',
  'operadora.beneficiarios',
  'operadora.autorizacao',
  'operadora.atendimento',
  'operadora.contas',
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
  'idempotency-key': `e2e-w0-10-gl-${k}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
});
async function postar<T>(page: Page, url: string, data: unknown, status = 200): Promise<T> {
  const r = await page.request.post(url, { headers: await cabecalhos(page, url.split('/').pop()!), data });
  expect(r.status(), await r.text()).toBe(status);
  return (await r.json()) as T;
}

/**
 * Revisão: baixa pelo botão do portal o demonstrativo (análise ou pagamento) e confere o XML TISS baixado e a resposta
 * da rota (nome, mesmo conteúdo, hash do epílogo, XML da ANS).
 */
async function baixarDemonstrativo(pp: Page, conta: number, tipo: 'analise' | 'pagamento'): Promise<void> {
  const botao = pp.getByTestId(
    tipo === 'analise' ? `pp-contas-demonstrativo-${conta}` : `pp-contas-demonstrativo-pagamento-${conta}`,
  );
  await expect(botao).toBeVisible({ timeout: 30_000 });
  const [baixado] = await Promise.all([pp.waitForEvent('download'), botao.click()]);
  expect(baixado.suggestedFilename()).toMatch(/\.xml$/);
  const bytes = readFileSync((await baixado.path())!);
  const xml = bytes.toString('latin1');
  expect(xml).toMatch(/^<\?xml/);
  expect(xml).toContain('ans:');
  const rota = `/api/portal-prestador/contas/${conta}/${tipo === 'analise' ? 'demonstrativo' : 'demonstrativo-pagamento'}`;
  const r = await pp.request.get(rota);
  expect(r.status()).toBe(200);
  const d = (await r.json()) as { nome: string; xmlBase64: string; hash: string };
  expect(d.nome).toBe(baixado.suggestedFilename());
  // O arquivo baixado pelo botão é o mesmo XML da rota (conferido no XSD antes de sair), com o hash do epílogo.
  expect(Buffer.from(d.xmlBase64, 'base64').equals(bytes)).toBe(true);
  expect(d.hash).toMatch(/^[0-9a-f]{32,64}$/i);
  expect(xml.toLowerCase()).toContain(d.hash.toLowerCase());
}

/** Liga ou desliga a chave para as pessoas do teste (Funcionalidades por estabelecimento; reautenticação). */
async function chave(page: Page, nome: string, ligar: boolean): Promise<void> {
  await postar(page, '/api/administracao/liberacao', {
    chave: nome,
    tipo: 'recurso',
    escopo: 'pessoa',
    valores: PESSOAS,
    ligar,
    justificativa: 'Recurso de glosa por item no portal do prestador (E2E do W0-10)',
    senha: SENHA,
  });
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
const cnpj = (b12: string) => {
  const d1 = dv11(b12, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return `${b12}${d1}${dv11(`${b12}${d1}`, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])}`;
};
/** A carteirinha de 16 dígitos (registro, sequência, verificador módulo 11), sem beneficiário na operadora. */
function carteirinhaSintetica(registro: string, seq: number): string {
  const base = `${registro}${String(seq).padStart(9, '0')}`;
  let s = 0;
  let p = 2;
  for (let i = base.length - 1; i >= 0; i--) {
    s += Number(base[i]) * p;
    p = p === 9 ? 2 : p + 1;
  }
  const r = 11 - (s % 11);
  return `${base}${r >= 10 ? 0 : r}`;
}

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

const hoje = () => {
  const d = new Date();
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

interface Glosas {
  versao: number;
  guias: { id: number; itens: { id: number; glosado: number; motivo: string | null }[] }[];
}

test.describe('portal do prestador: recurso de glosa por item @W0-10', () => {
  test.setTimeout(420_000);
  test.use({ actionTimeout: 30_000 });

  test('ligar → conta → lote pelo portal (XSD e protocolo) → análise → recurso por item com confirmação → decisão item a item na ficha → o prestador vê → recolher; axe', async ({
    page,
    browser,
  }) => {
    const externas = vigiarExternas(page);
    const sufixo = String(Date.now() % 100_000).padStart(5, '0');
    const registro = `9${sufixo}`;
    const login = `glosas.${sufixo}@laboratorio.invalid`;
    const senhaPortal = `Glosas${sufixo}abcXYZ`;

    await entrar(page, 'SINT.ADMIN');
    await prerequisito(page, 'operadora', 'credenciamento');
    await prerequisito(page, 'operadora.autorizacao', 'aprovacao');
    await prerequisito(page, 'operadora.contas', 'aprovacao');
    for (const c of CHAVES) await chave(page, c, true);

    const portal = await browser.newContext();
    const pp = await portal.newPage();
    const externasPortal = vigiarExternas(pp);
    try {
      // O gestor: a operadora sintética, o médico auditor e a conta do portal do laboratório (prestador 1).
      await entrar(page, 'SINT.OPERADORA');
      const ope = await postar<{ id: number }>(
        page,
        '/api/operadora/empresas',
        {
          registroAns: registro,
          cnpj: cnpj(`9${sufixo}000001`.slice(0, 12)),
          razaoSocial: `Operadora sintética ${sufixo}`,
          modalidade: 'medicinaGrupo',
        },
        201,
      );
      await postar(page, '/api/operadora/auditores', {
        operadora: ope.id,
        login: 'SINT.OPE.AUDITOR',
        nome: 'Auditor sintético das glosas',
        categoria: 'medico',
        numero: '900071',
        uf: 'SC',
        inicio: hoje(),
      });
      const acesso = await postar<{ codigoAtivacao: string }>(page, '/api/operadora/portal/acessos', {
        operadora: ope.id,
        prestador: 1,
        login,
        nome: 'Responsável sintético das contas',
        tipoAtendimento: 1,
        funcoes: [3],
      });

      // O responsável ativa a conta e entra (contexto próprio do navegador: o portal tem a sua sessão).
      await pp.goto('/prestador/entrar');
      await expect(pp.getByTestId('portal-prestador-entrar')).toBeVisible({ timeout: 30_000 });
      await pp.getByRole('button', { name: /Primeiro acesso/ }).click();
      await pp.getByTestId('pp-login').fill(login);
      await pp.getByTestId('pp-ativacao').fill(acesso.codigoAtivacao);
      await pp.getByTestId('pp-senha').fill(senhaPortal);
      await pp.getByTestId('pp-senha2').fill(senhaPortal);
      await pp.getByTestId('pp-ativar').click();
      await expect(pp.getByTestId('portal-prestador-qr')).toBeVisible();
      const segredo =
        /Ou digite no aplicativo: ([A-Z2-7]+)/.exec(
          (await pp.getByTestId('portal-prestador-entrar').textContent()) ?? '',
        )?.[1] ?? '';
      expect(segredo.length).toBeGreaterThanOrEqual(16);
      await pp.getByTestId('pp-login').fill(login);
      await pp.getByTestId('pp-senha').fill(senhaPortal);
      await pp.getByTestId('pp-codigo').fill(totp(segredo));
      await pp.getByTestId('pp-entrar').click();
      await expect(pp).toHaveURL(/\/prestador\//, { timeout: 30_000 });

      // O lote em XML TISS: uma guia de carteirinha sem beneficiário (a glosa automática leva a guia toda).
      const cab: Cabecalho = {
        sequencialTransacao: '1',
        data: hoje(),
        hora: '09:00:00',
        codigoPrestadorNaOperadora: cnpj('900000010001'),
        registroANS: registro,
      };
      const guia: GuiaSpSadt = {
        tipo: 'sp-sadt',
        numeroGuiaPrestador: `GL-${sufixo}`,
        beneficiario: { numeroCarteira: carteirinhaSintetica(registro, 999_998), atendimentoRN: false },
        nomeContratadoSolicitante: 'LABORATORIO SINTETICO ALFA',
        profissionalSolicitante: { conselho: '06', numeroConselho: '900072', uf: '42', cbos: '225125' },
        cnes: '9000001',
        caraterAtendimento: '1',
        tipoAtendimento: '23',
        itens: [
          {
            sequencial: 1,
            data: hoje(),
            procedimento: { codigoTabela: '22', codigo: '40301630', descricao: 'DOSAGEM SINTETICA' },
            quantidade: 3,
            valorUnitario: 12.35,
          },
        ],
        despesas: [],
      };
      const lote = mensagemLoteGuias(cab, `GL-${sufixo}`, [guia]);

      // Contas: o arquivo com erro de XSD é recusado; o certo passa pelo painel ("Voltar" não envia) e recebe o protocolo.
      await pp.getByTestId('portal-prestador-menu-contas').click();
      await expect(pp).toHaveURL(/\/prestador\/contas/);
      await expect(pp.getByTestId('pp-contas-form')).toBeVisible({ timeout: 30_000 });
      await semViolacaoAxe(pp, '/prestador/contas');
      await pp.getByTestId('pp-contas-arquivo').setInputFiles({
        name: 'lote-com-erro.xml',
        mimeType: 'application/xml',
        buffer: Buffer.from(lote.xml.replace(/<ans:CNES>[^<]*<\/ans:CNES>/, ''), 'latin1'),
      });
      await pp.getByTestId('pp-contas-enviar').click();
      await pp.getByTestId('pp-contas-confirmar').click();
      await expect(pp.getByTestId('pp-contas-recusa')).toContainText('XSD', { timeout: 30_000 });
      await expect(pp.getByTestId('pp-contas-erros-xsd').locator('li').first()).toBeVisible();
      await semViolacaoAxe(pp, 'lote recusado pelo schema');
      await expect(pp.getByTestId('pp-contas-recebido')).toHaveCount(0);
      await pp.getByTestId('pp-contas-arquivo').setInputFiles({
        name: 'lote.xml',
        mimeType: 'application/xml',
        buffer: Buffer.from(lote.bytes),
      });
      await pp.getByTestId('pp-contas-enviar').click();
      await expect(pp.getByTestId('pp-contas-confirma')).toBeVisible();
      await pp.getByTestId('pp-contas-voltar').click();
      await expect(pp.getByTestId('pp-contas-confirma')).toHaveCount(0);
      await pp.getByTestId('pp-contas-enviar').click();
      await pp.getByTestId('pp-contas-confirmar').click();
      const recebido = pp.getByTestId('pp-contas-recebido');
      await expect(recebido).toContainText('Lote recebido com o protocolo', { timeout: 30_000 });
      const protocolo = /protocolo (\d{12})/.exec((await recebido.textContent()) ?? '')?.[1] ?? '';
      expect(protocolo).toMatch(/^\d{12}$/);
      const lista = (await (await pp.request.get('/api/portal-prestador/contas')).json()) as {
        itens: { id: number; protocolo: string }[];
      };
      const conta = lista.itens.find((l) => l.protocolo === protocolo)!.id;
      await expect(pp.getByTestId(`pp-contas-linha-${conta}`)).toBeVisible();
      await expect(pp.getByTestId(`pp-contas-recurso-${conta}`)).toHaveCount(0);
      await semViolacaoAxe(pp, 'lote recebido pelo portal');

      // O auditor conclui a análise (a guia toda glosada pela carteirinha desconhecida).
      await entrar(page, 'SINT.OPE.AUDITOR');
      const ficha0 = (await (await page.request.get(`/api/operadora/contas/${conta}`)).json()) as {
        versao: number;
      };
      await postar(page, `/api/operadora/contas/${conta}/analise`, {
        versao: ficha0.versao,
        observacao: 'Análise sintética do E2E das glosas',
      });

      // No portal: "Glosas e recurso" com o item glosado e o motivo.
      await pp.reload();
      await expect(pp.getByTestId(`pp-contas-recurso-${conta}`)).toBeVisible({ timeout: 30_000 });
      const gl = (await (
        await pp.request.get(`/api/portal-prestador/contas/${conta}/glosas`)
      ).json()) as Glosas;
      const g = gl.guias[0]!;
      const item = g.itens[0]!;
      expect(item.glosado).toBe(37.05);
      expect(item.motivo).not.toBeNull();
      // Revisão: o demonstrativo de análise publicado no portal (botão e XML TISS).
      await baixarDemonstrativo(pp, conta, 'analise');
      await pp.getByTestId(`pp-contas-recurso-${conta}`).click();
      const painel = pp.getByTestId(`pp-contas-recurso-painel-${conta}`);
      await expect(painel.getByTestId(`pp-recurso-item-${item.id}`)).toContainText('R$ 37,05');
      await expect(pp.getByTestId(`pp-recurso-recorrer-${g.id}`)).toBeDisabled();
      await semViolacaoAxe(pp, 'glosas do lote');
      await pp.getByTestId(`pp-recurso-marca-${item.id}`).check();
      await pp.locator(`#pp-recurso-valor-${item.id}`).fill('30,00');
      await pp
        .locator(`#pp-recurso-justificativa-${item.id}`)
        .fill('Beneficiário elegível na data do exame.');
      await pp
        .locator(`#pp-recurso-justificativa-guia-${g.id}`)
        .fill('A carteirinha foi digitada errada no lote; segue a correta.');
      await pp.getByTestId(`pp-recurso-recorrer-${g.id}`).click();
      const confirma = pp.getByTestId(`pp-recurso-confirma-${g.id}`);
      await expect(confirma).toBeVisible();
      await expect(confirma).toContainText('R$ 30,00');
      await semViolacaoAxe(pp, 'confirmar o recurso por item');
      await pp.getByTestId(`pp-recurso-voltar-${g.id}`).click();
      await expect(confirma).toHaveCount(0);
      const semRecurso = (await (
        await pp.request.get(`/api/portal-prestador/contas/${conta}/glosas`)
      ).json()) as { guias: { recurso: unknown }[] };
      expect(semRecurso.guias[0]!.recurso).toBeNull();
      await pp.getByTestId(`pp-recurso-recorrer-${g.id}`).click();
      await pp.getByTestId(`pp-recurso-confirmar-${g.id}`).click();
      await expect(pp.getByTestId('pp-contas-recurso-enviado')).toContainText(
        `Recurso da guia GL-${sufixo} enviado.`,
        { timeout: 30_000 },
      );
      await expect(pp.getByTestId(`pp-recurso-item-${item.id}-recurso`)).toContainText('Recorrido R$ 30,00');
      await expect(pp.getByTestId(`pp-recurso-item-${item.id}-recurso`)).toContainText(
        'Aguardando a decisão da operadora',
      );
      await expect(pp.getByTestId(`pp-recurso-marca-${item.id}`)).toHaveCount(0);
      await expect(pp.getByTestId(`pp-recurso-recorrer-${g.id}`)).toHaveCount(0);
      await semViolacaoAxe(pp, 'recurso enviado');

      // Na operadora: a ficha mostra o recurso por item e o auditor decide item a item (acatado em parte).
      await page.goto('/operadora/contas');
      await expect(page.getByTestId('contas-totais')).toBeVisible({ timeout: 30_000 });
      await page.getByLabel('Protocolo ou número do lote').fill(protocolo);
      await page.getByTestId('contas-buscar').click();
      await page.getByRole('button', { name: `Abrir o lote ${protocolo}` }).click();
      const ficha = page.getByTestId('conta-ficha');
      await expect(ficha.getByTestId('conta-ficha-protocolo')).toHaveText(protocolo);
      await expect(ficha.getByTestId('conta-guia-1-recurso-itens')).toContainText('aguardando decisão');
      await expect(ficha.getByTestId(`conta-recurso-item-${item.id}`)).toContainText(
        'Beneficiário elegível na data do exame.',
      );
      await ficha.getByTestId('conta-guia-1-decidir-itens').click();
      const dialogo = page.getByTestId('form-dialogo-conta');
      await expect(dialogo.getByTestId(`conta-decidir-item-${item.id}`)).toBeVisible();
      await expect(dialogo.locator(`#conta-acatado-item-${item.id}`)).toHaveValue('30');
      await dialogo.locator(`#conta-acatado-item-${item.id}`).fill('20,00');
      await dialogo
        .locator(`#conta-parecer-item-${item.id}`)
        .fill('Acatado em parte: uma dosagem sem pedido.');
      await dialogo
        .locator('#conta-parecer-itens')
        .fill('Carteirinha conferida no cadastro do beneficiário.');
      await semViolacaoAxe(page, 'decidir o recurso item a item');
      await page.getByTestId('conta-dialogo-confirmar').click();
      await expect(page.getByTestId('contas-mensagem')).toContainText(
        `Recurso acatado em parte na guia GL-${sufixo}, item a item`,
        { timeout: 30_000 },
      );
      await expect(ficha.getByTestId(`conta-recurso-item-${item.id}`)).toContainText(
        'acatado R$ 20,00 · Acatado em parte: uma dosagem sem pedido.',
      );
      await expect(ficha.getByTestId('conta-guia-1-decidir-itens')).toHaveCount(0);
      await semViolacaoAxe(page, 'recurso por item decidido');

      // O prestador vê a decisão do item.
      await pp.reload();
      await pp.getByTestId(`pp-contas-recurso-${conta}`).click();
      await expect(pp.getByTestId(`pp-recurso-item-${item.id}-recurso`)).toContainText(
        'Acatado R$ 20,00: Acatado em parte: uma dosagem sem pedido.',
        { timeout: 30_000 },
      );
      await semViolacaoAxe(pp, 'decisão vista pelo prestador');

      // Revisão: com o recurso acatado (R$ 20,00 liberados e nada pago), o demonstrativo de pagamento ainda não sai;
      // a operadora quita o liberado e ele é publicado no portal.
      await expect(pp.getByTestId(`pp-contas-demonstrativo-pagamento-${conta}`)).toHaveCount(0);
      const cedo = await pp.request.get(`/api/portal-prestador/contas/${conta}/demonstrativo-pagamento`);
      expect(cedo.status()).toBe(409);
      expect(await cedo.text()).toContain('demonstrativo-pagamento-antes-da-quitacao');
      const lida = await page.request.get(`/api/operadora/contas/${conta}`);
      expect(lida.status(), await lida.text()).toBe(200);
      const ficha1 = (await lida.json()) as { versao: number };
      await entrar(page, 'SINT.OPERADORA');
      await postar(page, `/api/operadora/contas/${conta}/pagamento`, {
        versao: ficha1.versao,
        valor: 20,
        data: new Date().toISOString().slice(0, 10),
        documento: `TED-E2E-${sufixo}`,
      });
      await pp.reload();
      await baixarDemonstrativo(pp, conta, 'pagamento');
      await baixarDemonstrativo(pp, conta, 'analise');
    } finally {
      await portal.close();
      await entrar(page, 'SINT.ADMIN');
      for (const c of [...CHAVES].reverse()) await chave(page, c, false);
    }
    expect(externas).toEqual([]);
    expect(externasPortal).toEqual([]);
  });
});
