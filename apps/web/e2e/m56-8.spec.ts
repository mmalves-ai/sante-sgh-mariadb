// E2E @M56.8 (ficha do M56, etapa 8 de 8, fatia F7; seções 7, 8 e 10 na parte do atendimento com protocolo e do
// portal do prestador): o atendimento com protocolo e o portal nascem desligados (a tela diz o motivo) → o administrador
// liga a operadora, os beneficiários, a autorização, o atendimento e o portal para as pessoas do teste (e para a
// identidade do portal) → o gestor da operadora monta a carteira sintética e cria a conta do portal do laboratório (o
// código de ativação aparece uma vez) → o atendimento registra o contato do beneficiário com o protocolo (o prazo
// previsto antes de gravar), consulta pelo número, inicia a análise, responde com a conclusão e o fundamento, registra
// o envio por escrito (o texto para imprimir) e o beneficiário pede a reanálise na ouvidoria (protocolo novo, ligado ao
// de origem), que é prorrogada uma vez e cancelada → o responsável do laboratório ativa a conta no portal (o QR do
// segundo fator), entra com a senha e o código do aplicativo, pede uma autorização (busca na terminologia), consulta o
// protocolo e cancela o pedido → recolher; axe sem violação séria em cada estado. Sessão real sobre a fonte sintética de
// dev, tudo em MEMÓRIA (nada vai à cópia); documentos SINTÉTICOS (dígitos calculados aqui).
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
  'idempotency-key': `e2e-m56-8-${k}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
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
      justificativa: 'Atendimento com protocolo e portal do prestador sintéticos (E2E da etapa 8)',
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

test.describe('operadora própria, etapa 8: atendimento com protocolo e portal do prestador @M56.8', () => {
  test.setTimeout(480_000);

  test('desligados → ligar → conta do portal → protocolo → análise → resposta → escrita → reanálise → portal: ativar, entrar, pedir, consultar, cancelar → recolher; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    const sufixo = String(Date.now() % 100_000).padStart(5, '0');
    const login = `responsavel.${sufixo}@laboratorio.invalid`;
    const senhaPortal = `Portal${sufixo}abcXYZ`;

    // Desligados (POL-3): o bloco dos protocolos e as contas do portal dizem o motivo.
    await entrar(page, 'SINT.OPE.ATENDE');
    await page.goto('/operadora/autorizacoes');
    await expect(page.getByTestId('prot-desligada')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('prot-lista')).toHaveCount(0);
    await semViolacaoAxe(page, '/operadora/autorizacoes (protocolos desligados)');
    await entrar(page, 'SINT.OPERADORA');
    await page.goto('/operadora/portal-prestador');
    await expect(page.getByTestId('portal-desligada')).toBeVisible({ timeout: 30_000 });
    await semViolacaoAxe(page, '/operadora/portal-prestador (desligado)');

    // O administrador registra os pré-requisitos e liga as chaves para as pessoas do teste e para o portal.
    await entrar(page, 'SINT.ADMIN');
    await prerequisito(page, 'operadora', 'credenciamento');
    await prerequisito(page, 'operadora.autorizacao', 'aprovacao');
    for (const c of CHAVES) await chave(page, c, true);

    try {
      // O gestor da operadora monta a carteira e cria a conta do portal do laboratório.
      await entrar(page, 'SINT.OPERADORA');
      const carteirinha = await carteira(page, sufixo);
      await page.goto('/operadora/portal-prestador');
      await expect(page.getByTestId('portal-nova')).toBeVisible({ timeout: 30_000 });
      await semViolacaoAxe(page, '/operadora/portal-prestador');
      await page.getByTestId('portal-nova').click();
      const dlg = page.getByTestId('portal-dialogo');
      if ((await dlg.getByTestId('portal-operadora').count()) > 0)
        await escolher(dlg.getByTestId('portal-operadora'), { rotulo: new RegExp(`ANS 9${sufixo}`) });
      await escolher(dlg.getByTestId('portal-prestador'), { rotulo: /Laboratório sintético Alfa/ });
      await dlg.getByLabel('E-mail do responsável no prestador').fill(login);
      await dlg.getByLabel('Nome do responsável').fill('Responsável sintético do laboratório');
      for (const f of [1, 2, 3, 7]) await dlg.getByTestId(`portal-funcao-${f}`).check();
      await semViolacaoAxe(page, 'nova conta do portal');
      await page.getByTestId('portal-gravar').click();
      const aviso = page.getByTestId('portal-codigo');
      await expect(aviso).toContainText('Código de ativação:');
      const ativacao =
        /Código de ativação: ([A-Z0-9]{12})/.exec((await aviso.textContent()) ?? '')?.[1] ?? '';
      expect(ativacao).toMatch(/^[A-Z0-9]{12}$/);
      await expect(page.getByTestId('portal-lista')).toContainText(login);
      await expect(page.getByTestId('portal-lista')).toContainText('Aguardando a ativação');

      // O atendimento registra o contato do beneficiário com o protocolo (o prazo previsto antes de gravar).
      await entrar(page, 'SINT.OPE.ATENDE');
      await page.goto('/operadora/autorizacoes');
      await expect(page.getByTestId('prot-totais')).toBeVisible({ timeout: 30_000 });
      await semViolacaoAxe(page, '/operadora/autorizacoes (protocolos)');
      await page.getByTestId('prot-novo').click();
      const f = page.getByTestId('form-protocolo');
      await escolher(f.getByTestId('prot-operadora'), { rotulo: new RegExp(`ANS 9${sufixo}`) });
      await escolher(f.getByTestId('prot-instancia'), 'atendimento');
      await escolher(f.getByTestId('prot-natureza'), 'reclamacao-assistencial');
      await escolher(f.getByTestId('prot-canal'), 'telefone');
      await escolher(f.getByTestId('prot-origem'), { indice: 1 });
      await escolher(f.getByTestId('prot-solicitante'), 'beneficiario');
      await f.getByLabel('Carteirinha do beneficiário (16 dígitos)').fill(carteirinha);
      await f.getByTestId('prot-escrita').check();
      await f.getByLabel('Assunto').fill('Demora no agendamento sintético');
      await f.getByLabel('Relato do contato').fill('A beneficiária sintética relata demora no agendamento.');
      await expect(f.getByTestId('prot-prazo-previsto')).toContainText('dias úteis (assistencial)');
      await semViolacaoAxe(page, 'registrar protocolo');
      await f.getByTestId('prot-registrar').click();
      await expect(page.getByTestId('prot-mensagem')).toContainText(/Protocolo \d{20}: resposta até/);
      const numero = /Protocolo (\d{20})/.exec(
        (await page.getByTestId('prot-mensagem').textContent()) ?? '',
      )![1]!;
      expect(numero).toMatch(new RegExp(`^9${sufixo}\\d{14}$`));
      const ficha = page.getByTestId('prot-ficha');
      await expect(ficha.getByTestId('prot-ficha-situacao')).toContainText('Aberto');
      await expect(ficha.getByTestId('prot-ficha-escrita')).toContainText('Pedida em');

      // A consulta pelo número.
      await page.getByLabel('Protocolo (20 dígitos)').fill(numero);
      await page.getByTestId('prot-consultar').click();
      await expect(page.getByTestId('prot-consulta-resultado')).toContainText(
        `Protocolo de atendimento ${numero}`,
      );

      // Análise, resposta com a conclusão e o fundamento, envio por escrito.
      const dialogo = page.getByTestId('prot-dialogo');
      const confirmar = async () => {
        await page.getByTestId('prot-dialogo-confirmar').click();
        await expect(dialogo).toHaveCount(0);
      };
      await ficha.getByTestId('prot-acao-analisar').click();
      await confirmar();
      await expect(ficha.getByTestId('prot-ficha-situacao')).toContainText('Em análise');
      await ficha.getByTestId('prot-acao-responder').click();
      await escolher(dialogo.getByTestId('prot-conclusao'), 'desfavoravel');
      await escolher(dialogo.getByTestId('prot-meio'), 'telefone');
      await dialogo.getByLabel('Resposta conclusiva').fill('O agendamento segue o prazo máximo da norma.');
      await dialogo
        .getByLabel('Cláusula do contrato ou dispositivo legal')
        .fill('Cláusula 7 do contrato sintético');
      await semViolacaoAxe(page, 'responder protocolo');
      await confirmar();
      await expect(ficha.getByTestId('prot-ficha-situacao')).toContainText('Respondido');
      await expect(ficha.getByTestId('prot-ficha-conclusao')).toContainText('Desfavorável ao beneficiário');
      await expect(ficha.getByTestId('prot-acao-encerrar')).toHaveCount(0);
      await ficha.getByTestId('prot-acao-enviarEscrita').click();
      await escolher(dialogo.getByTestId('prot-meio-escrita'), 'email');
      await confirmar();
      await expect(ficha.getByTestId('prot-ficha-escrita')).toContainText('Enviada em');
      // O texto para imprimir traz o protocolo em grupos (operadora, data e sequência), legível ao beneficiário.
      await expect(ficha.getByTestId('prot-texto-escrito')).toContainText(
        `protocolo ${numero.slice(0, 6)} ${numero.slice(6, 14)} ${numero.slice(14)}`,
      );
      await expect(ficha.getByTestId('prot-texto-escrito')).toContainText('Cláusula 7 do contrato sintético');
      await semViolacaoAxe(page, 'ficha do protocolo respondido');

      // A reanálise na ouvidoria: protocolo novo, ligado ao de origem; prorrogada uma vez e cancelada.
      await ficha.getByTestId('prot-acao-reanalise').click();
      await escolher(dialogo.getByTestId('prot-reanalise-canal'), 'telefone');
      await escolher(dialogo.getByTestId('prot-reanalise-origem'), { indice: 1 });
      await dialogo.getByLabel('Pedido de reanálise').fill('A beneficiária pede a reanálise da resposta.');
      await confirmar();
      await expect(ficha.getByTestId('prot-ficha-origem')).toContainText(numero, { timeout: 30_000 });
      await expect(ficha.getByTestId('prot-ficha-prazo')).toContainText('ouvidoria');
      await ficha.getByTestId('prot-acao-prorrogar').click();
      // O novo prazo: o limite da prorrogação única que a própria tela mostra.
      const campoAte = dialogo.getByLabel(/Novo prazo \(até/);
      const limite = /até (\d{2}\/\d{2}\/\d{4})/.exec((await dialogo.textContent()) ?? '')![1]!;
      await campoAte.fill(limite);
      await dialogo.getByLabel('Motivo acordado com o beneficiário').fill('Depende do parecer do auditor.');
      await confirmar();
      await expect(ficha.getByTestId('prot-ficha-prazo')).toContainText('Prorrogado até');
      await expect(ficha.getByTestId('prot-acao-prorrogar')).toHaveCount(0);
      await ficha.getByTestId('prot-acao-cancelar').click();
      await dialogo.getByLabel('Motivo').fill('A beneficiária desistiu da reanálise sintética.');
      await confirmar();
      await expect(ficha.getByTestId('prot-ficha-situacao')).toContainText('Cancelado');
      await semViolacaoAxe(page, 'reanálise cancelada');

      // O portal do prestador: ativar a conta (o QR do segundo fator), entrar, pedir, consultar e cancelar.
      await page.context().clearCookies();
      await page.goto('/prestador/entrar');
      await expect(page.getByTestId('portal-prestador-entrar')).toBeVisible({ timeout: 30_000 });
      await semViolacaoAxe(page, '/prestador/entrar');
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
      await semViolacaoAxe(page, 'portal: conta ativada (QR)');
      await page.getByTestId('pp-login').fill(login);
      await page.getByTestId('pp-senha').fill(senhaPortal);
      await page.getByTestId('pp-codigo').fill(totp(segredo));
      await page.getByTestId('pp-entrar').click();
      await expect(page).toHaveURL(/\/prestador\/pedidos/, { timeout: 30_000 });
      await expect(page.getByTestId('portal-prestador-ola')).toContainText('Responsável sintético');
      await semViolacaoAxe(page, '/prestador/pedidos');

      await page.getByTestId('pp-novo').click();
      const fa = page.getByTestId('form-autorizacao');
      await expect(fa).toBeVisible();
      await expect(fa.getByTestId('aut-prestador')).toHaveCount(0);
      await fa.getByLabel('Carteirinha do beneficiário (16 dígitos)').fill(carteirinha);
      await escolher(fa.getByTestId('aut-tipo'), { rotulo: 'SP/SADT' });
      await fa.getByLabel('Indicação clínica').fill('Indicação clínica sintética do pedido');
      await fa.getByLabel('Nome do profissional').fill('Profissional sintético');
      await fa.getByLabel('Número no conselho').fill('900031');
      await fa.getByLabel('Buscar procedimento (código ou nome)').fill('hemograma');
      await fa.getByTestId('aut-buscar-tuss').click();
      await fa.getByTestId('aut-usar-40304361').click();
      await expect(fa.getByTestId('aut-item-1').getByLabel('Código')).toHaveValue('40304361');
      await semViolacaoAxe(page, 'portal: novo pedido');
      await fa.getByTestId('aut-gravar').click();
      await expect(page.getByTestId('pp-mensagem')).toContainText('Pedido registrado com o protocolo');
      const pedido = /protocolo (\d{20})/.exec(
        (await page.getByTestId('pp-mensagem').textContent()) ?? '',
      )![1]!;
      await page.getByLabel('Protocolo ou carteirinha').fill(pedido);
      await page.getByTestId('pp-buscar').click();
      await expect(page.getByTestId('pp-lista').locator('tbody tr')).toHaveCount(1);
      await page.getByTestId('pp-lista').getByRole('button', { name: /Abrir/ }).click();
      const pf = page.getByTestId('pp-ficha');
      await expect(pf.getByTestId('pp-ficha-situacao')).toContainText('Em análise');
      await expect(pf.getByTestId('pp-ficha-itens')).toContainText('40304361');

      await page.getByTestId('portal-prestador-menu-protocolo').click();
      await expect(page).toHaveURL(/\/prestador\/protocolo/);
      await page.getByLabel('Protocolo (20 dígitos)').fill(pedido);
      await page.getByTestId('pp-consultar').click();
      await expect(page.getByTestId('pp-protocolo-situacao')).toContainText('Em análise');
      await semViolacaoAxe(page, '/prestador/protocolo');

      await page.getByTestId('portal-prestador-menu-pedidos').click();
      await page.getByLabel('Protocolo ou carteirinha').fill(pedido);
      await page.getByTestId('pp-buscar').click();
      await page.getByTestId('pp-lista').getByRole('button', { name: /Abrir/ }).click();
      await pf.getByTestId('pp-cancelar').click();
      await page.getByLabel('Motivo do cancelamento').fill('O pedido sintético foi feito em duplicidade.');
      await page.getByTestId('pp-confirmar-cancelar').click();
      await expect(page.getByTestId('pp-mensagem')).toContainText('Pedido cancelado.');
      await expect(pf.getByTestId('pp-ficha-situacao')).toContainText('Cancelada');

      // A sessão do portal não abre as telas internas.
      await page.goto('/operadora/autorizacoes');
      await expect(page).toHaveURL(/\/(entrar|sem-permissao)/);
      await expect(page.getByTestId('prot-totais')).toHaveCount(0);
    } finally {
      // Recolher: desligar as chaves do teste.
      await entrar(page, 'SINT.ADMIN');
      for (const c of [...CHAVES].reverse()) await chave(page, c, false);
    }
    await entrar(page, 'SINT.OPE.ATENDE');
    await page.goto('/operadora/autorizacoes');
    await expect(page.getByTestId('prot-desligada')).toBeVisible({ timeout: 30_000 });
    expect(externas).toEqual([]);
  });
});
