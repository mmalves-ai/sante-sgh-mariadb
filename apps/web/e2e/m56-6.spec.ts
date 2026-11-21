// E2E @M56.6 (ficha do M56, etapa 6 de 8, fatia F5; seções 7, 8 e 10 na parte das contas médicas): as contas nascem
// desligadas (a tela diz o motivo) → o administrador registra os pré-requisitos e liga a operadora, os beneficiários, a
// autorização e as contas para as pessoas do teste → o gestor monta a carteira sintética e designa o médico auditor; a
// autorização do SP/SADT com a senha (pela API da etapa 5) → o atendimento recebe o lote em XML TISS: o arquivo com erro
// de XSD é recusado com o que o XSD apontou; o lote certo entra com o protocolo e a glosa automática (a quantidade acima
// da autorizada e a guia sem beneficiário) → o auditor glosa o material e desfaz a glosa automática, conclui a análise e
// baixa o demonstrativo → o atendimento registra o recurso de glosa e o auditor acata em parte → a cobrança da operadora
// vê só os valores e registra o pagamento → recolher; axe sem violação séria em cada estado. Sessão real sobre a fonte
// sintética de dev, tudo em MEMÓRIA (nada vai à cópia); documentos SINTÉTICOS (dígitos calculados aqui).
import { expect, test, type Page } from '@playwright/test';
import { mensagemLoteGuias, type Cabecalho, type GuiaSpSadt } from '@sgh/dominio-faturamento';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const PESSOAS = ['SINT.OPERADORA', 'SINT.OPE.ATENDE', 'SINT.OPE.AUDITOR', 'SINT.OPE.COBRANCA'];
const CHAVES = ['operadora', 'operadora.beneficiarios', 'operadora.autorizacao', 'operadora.contas'];

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
  'idempotency-key': `e2e-m56-6-${k}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
});
async function postar<T>(page: Page, url: string, data: unknown, status = 200): Promise<T> {
  const r = await page.request.post(url, { headers: await cabecalhos(page, url.split('/').pop()!), data });
  expect(r.status(), await r.text()).toBe(status);
  return (await r.json()) as T;
}

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
      justificativa: 'Contas médicas sintéticas (E2E da etapa 6)',
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
/** A carteirinha de 16 dígitos (registro, sequência, verificador módulo 11), para a guia sem beneficiário. */
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

/** A carteira sintética pela API da F1 (o gestor da operadora): devolve a operadora e a carteirinha. */
async function carteira(page: Page, sufixo: string): Promise<{ operadora: number; carteirinha: string }> {
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
  const ben = await postar<{ carteirinha: string }>(
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
  return { operadora: ope.id, carteirinha: ben.carteirinha };
}

const hoje = () => {
  const d = new Date();
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

test.describe('operadora própria, etapa 6: contas médicas, glosa e pagamento @M56.6', () => {
  test.setTimeout(300_000);
  // Ação parada não espera o tempo todo do teste: falha com o passo que travou.
  test.use({ actionTimeout: 30_000 });

  test('desligada → ligar → receber o lote → glosar e desfazer → concluir → demonstrativo → recurso → pagar → recolher; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    const sufixo = String(Date.now() % 100_000).padStart(5, '0');
    const registro = `9${sufixo}`;
    const lab = cnpj('900000010001');

    // As contas nascem desligadas (POL-3): a tela diz o motivo e não mostra os lotes.
    await entrar(page, 'SINT.OPE.ATENDE');
    await page.goto('/operadora/contas');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Contas médicas dos prestadores' }),
    ).toBeVisible();
    await expect(page.getByTestId('contas-desligada')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('contas-lista')).toHaveCount(0);
    await semViolacaoAxe(page, '/operadora/contas (desligada)');

    // O administrador registra os pré-requisitos e liga as chaves para as pessoas do teste.
    await entrar(page, 'SINT.ADMIN');
    await prerequisito(page, 'operadora', 'credenciamento');
    await prerequisito(page, 'operadora.autorizacao', 'aprovacao');
    await prerequisito(page, 'operadora.contas', 'aprovacao');
    for (const c of CHAVES) await chave(page, c, true);

    try {
      // O gestor: a carteira sintética e o médico auditor designado.
      await entrar(page, 'SINT.OPERADORA');
      const { operadora, carteirinha } = await carteira(page, sufixo);
      await postar(page, '/api/operadora/auditores', {
        operadora,
        login: 'SINT.OPE.AUDITOR',
        nome: 'Auditor sintético das contas',
        categoria: 'medico',
        numero: '900061',
        uf: 'SC',
        inicio: hoje(),
      });
      // A autorização do SP/SADT (etapa 5) pelo atendimento e a decisão do auditor, com a senha.
      await entrar(page, 'SINT.OPE.ATENDE');
      const pedido = await postar<{ id: number }>(page, '/api/operadora/autorizacoes', {
        carteirinha,
        prestador: 1,
        executante: null,
        tipoGuia: 4,
        carater: 'E',
        altaComplexidade: false,
        origem: 1,
        guiaPrincipal: null,
        cid: null,
        indicacaoClinica: 'Indicação clínica sintética das contas',
        profissional: { nome: 'Profissional sintético', conselho: 'CRM', numero: '900062', uf: 'SC' },
        internacao: null,
        itens: [{ tabela: 22, codigo: '40301630', descricao: null, quantidade: 2 }],
      });
      await entrar(page, 'SINT.OPE.AUDITOR');
      const f = (await (await page.request.get(`/api/operadora/autorizacoes/${pedido.id}`)).json()) as {
        versao: number;
        itens: { id: number; quantidadeSolicitada: number }[];
      };
      const dec = await postar<{ senha: string }>(page, `/api/operadora/autorizacoes/${pedido.id}/decisao`, {
        versao: f.versao,
        decisao: 'autorizar',
        itens: f.itens.map((i) => ({ item: i.id, quantidadeAutorizada: i.quantidadeSolicitada })),
        diariasAutorizadas: null,
        critica: null,
        fundamento: null,
        parecer: 'Autorizado conforme a indicação',
      });

      // O lote em XML TISS: a guia autorizada (1 a mais na quantidade) e a de carteirinha desconhecida.
      const cab: Cabecalho = {
        sequencialTransacao: '1',
        data: hoje(),
        hora: '09:00:00',
        codigoPrestadorNaOperadora: lab,
        registroANS: registro,
      };
      const sadt = (numero: string, carteira: string, senha: string | null): GuiaSpSadt => ({
        tipo: 'sp-sadt',
        numeroGuiaPrestador: numero,
        beneficiario: { numeroCarteira: carteira, atendimentoRN: false },
        nomeContratadoSolicitante: 'LABORATORIO SINTETICO ALFA',
        profissionalSolicitante: { conselho: '06', numeroConselho: '900062', uf: '42', cbos: '225125' },
        cnes: '9000001',
        caraterAtendimento: '1',
        tipoAtendimento: '23',
        ...(senha ? { autorizacao: { data: hoje(), senha } } : {}),
        itens: [
          {
            sequencial: 1,
            data: '2026-10-20',
            procedimento: { codigoTabela: '22', codigo: '40301630', descricao: 'DOSAGEM SINTETICA' },
            quantidade: 3,
            valorUnitario: 12.35,
          },
        ],
        despesas: [
          {
            sequencial: 1,
            codigoDespesa: '03',
            data: '2026-10-20',
            codigoTabela: '19',
            codigo: '70000001',
            descricao: 'MATERIAL SINTETICO',
            quantidade: 2,
            unidadeMedida: '036',
            valorUnitario: 5,
          },
        ],
      });
      const lote = mensagemLoteGuias(cab, `E2E-${sufixo}`, [
        sadt('E2E-G-1', carteirinha, dec.senha),
        sadt('E2E-G-2', carteirinhaSintetica(registro, 999_999), null),
      ]);

      // O atendimento recebe: o arquivo com erro de XSD é recusado; o lote certo entra com o protocolo.
      await entrar(page, 'SINT.OPE.ATENDE');
      await page.goto('/operadora/contas');
      await expect(page.getByTestId('contas-totais')).toBeVisible({ timeout: 30_000 });
      await semViolacaoAxe(page, '/operadora/contas');
      await page.getByTestId('contas-receber').click();
      const receber = page.getByTestId('form-receber-conta');
      await receber.getByTestId('conta-arquivo').setInputFiles({
        name: 'lote-com-erro.xml',
        mimeType: 'application/xml',
        buffer: Buffer.from(lote.xml.replace(/<ans:CNES>[^<]*<\/ans:CNES>/, ''), 'latin1'),
      });
      await page.getByTestId('conta-receber-confirmar').click();
      await expect(page.getByTestId('conta-receber-recusa')).toContainText('XSD da TISS');
      await expect(page.getByTestId('conta-erros-xsd').locator('li').first()).toBeVisible();
      await semViolacaoAxe(page, 'recebimento recusado pelo XSD');
      await receber.getByTestId('conta-arquivo').setInputFiles({
        name: 'lote.xml',
        mimeType: 'application/xml',
        buffer: Buffer.from(lote.bytes),
      });
      await page.getByTestId('conta-receber-confirmar').click();
      await expect(page.getByTestId('contas-mensagem')).toContainText('recebido com o protocolo');
      await expect(page.getByTestId('contas-avisos')).toContainText(
        'Glosa automática de R$ 59,40 em 3 item(ns)',
      );
      const ficha = page.getByTestId('conta-ficha');
      const protocolo = ((await ficha.getByTestId('conta-ficha-protocolo').textContent()) ?? '').trim();
      expect(protocolo).toMatch(/^\d{12}$/);
      await expect(ficha.getByTestId('conta-ficha-situacao')).toHaveText('Em análise');
      await expect(ficha.getByTestId('conta-guia-2-criticas')).toContainText(
        'Nenhum beneficiário da operadora',
      );
      await expect(ficha.getByTestId('conta-guia-1-itens')).toContainText('1408');
      await expect(ficha.getByTestId('conta-concluir')).toHaveCount(0);
      await semViolacaoAxe(page, 'lote recebido');

      // O auditor: glosa o material, desfaz a glosa automática da quantidade e conclui a análise.
      await entrar(page, 'SINT.OPE.AUDITOR');
      await page.goto('/operadora/contas');
      await expect(page.getByTestId('contas-designacao')).toContainText('médico auditor', {
        timeout: 30_000,
      });
      await page.getByLabel('Protocolo ou número do lote').fill(protocolo);
      await page.getByTestId('contas-buscar').click();
      await expect(page.getByTestId('contas-lista').locator('tbody tr')).toHaveCount(1);
      await page.getByRole('button', { name: `Abrir o lote ${protocolo}` }).click();
      await expect(ficha.getByTestId('conta-ficha-protocolo')).toHaveText(protocolo);
      const dialogo = page.getByTestId('form-dialogo-conta');
      await ficha.getByTestId('conta-glosar-1-1-despesa').click();
      await dialogo.getByLabel('Valor glosado (R$)').fill('5,00');
      await escolher(dialogo.getByTestId('conta-glosa-motivo'), { rotulo: '2009 · Motivo 2009 (sintético)' });
      await dialogo.getByLabel('Justificativa').fill('Uma unidade sem registro de uso');
      await semViolacaoAxe(page, 'glosar item');
      await page.getByTestId('conta-dialogo-confirmar').click();
      await expect(page.getByTestId('contas-mensagem')).toContainText('Glosa de R$ 5,00 em 1 item(ns).');
      await expect(ficha.getByTestId('conta-item-1-1-despesa-glosado')).toHaveText('R$ 5,00');
      await ficha.getByTestId('conta-glosar-1-1-procedimento').click();
      await page.getByTestId('conta-glosa-desfazer').click();
      await expect(page.getByTestId('contas-mensagem')).toContainText('Glosa desfeita em 1 item(ns).');
      await expect(ficha.getByTestId('conta-item-1-1-procedimento-glosado')).toHaveText('R$ 0,00');
      await ficha.getByTestId('conta-concluir').click();
      await expect(page.getByTestId('conta-concluir-texto')).toContainText('a liberar R$ 42,05');
      await page.getByTestId('conta-dialogo-confirmar').click();
      await expect(page.getByTestId('contas-mensagem')).toContainText('liberado para o pagamento');
      await expect(ficha.getByTestId('conta-ficha-situacao')).toHaveText('Liberada para pagamento');
      const baixa = page.waitForEvent('download', { timeout: 30_000 });
      await ficha.getByTestId('conta-demonstrativo').click({ timeout: 15_000 });
      expect((await baixa).suggestedFilename()).toBe(`demonstrativo-${protocolo}.xml`);
      await semViolacaoAxe(page, 'análise concluída');

      // O recurso de glosa do prestador (o atendimento registra) e a decisão do auditor (acatado em parte).
      await entrar(page, 'SINT.OPE.ATENDE');
      await page.goto('/operadora/contas');
      await expect(page.getByTestId('contas-totais')).toBeVisible({ timeout: 30_000 });
      await page.getByLabel('Protocolo ou número do lote').fill(protocolo);
      await page.getByTestId('contas-buscar').click();
      await page.getByRole('button', { name: `Abrir o lote ${protocolo}` }).click();
      await ficha.getByTestId('conta-guia-2-recorrer').click();
      await dialogo
        .getByLabel('Justificativa do prestador')
        .fill('A carteirinha foi digitada errada no lote');
      await page.getByTestId('conta-dialogo-confirmar').click();
      await expect(page.getByTestId('contas-mensagem')).toContainText('Recurso de R$ 47,05 registrado');
      await expect(ficha.getByTestId('conta-guia-2-recurso')).toContainText('Recurso pendente');

      await entrar(page, 'SINT.OPE.AUDITOR');
      await page.goto('/operadora/contas');
      await expect(page.getByTestId('contas-totais')).toBeVisible({ timeout: 30_000 });
      await page.getByTestId('contas-filtro-recursos').check();
      await page.getByTestId('contas-buscar').click();
      await page.getByRole('button', { name: `Abrir o lote ${protocolo}` }).click();
      await ficha.getByTestId('conta-guia-2-decidir').click();
      await dialogo.getByLabel('Valor acatado (R$; 0 mantém a glosa)').fill('37,05');
      await dialogo.getByLabel('Parecer do auditor').fill('Acatado o procedimento; o material segue glosado');
      await semViolacaoAxe(page, 'decidir recurso');
      await page.getByTestId('conta-dialogo-confirmar').click();
      await expect(page.getByTestId('contas-mensagem')).toContainText('Recurso acatado em parte');
      await expect(ficha.getByTestId('conta-valor-saldo')).toHaveText('R$ 79,10');

      // A cobrança da operadora: só os valores (sem a aba dos lotes) e o pagamento ao prestador.
      await entrar(page, 'SINT.OPE.COBRANCA');
      await page.goto('/operadora/cobranca');
      await page.getByTestId('link-contas-medicas').click();
      await expect(page.getByTestId('conta-pagamentos')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('contas-lista')).toHaveCount(0);
      await expect(page.getByTestId('conta-pag-valor')).toHaveText('R$ 79,10');
      await semViolacaoAxe(page, 'pagamento aos prestadores');
      await page.getByRole('button', { name: 'Registrar pagamento' }).first().click();
      const pag = page.getByTestId('form-pagamento');
      await expect(pag.getByLabel('Valor pago (R$)')).toHaveValue('79,1');
      await pag.getByLabel('Documento (transferência, título ou recibo)').fill('TED sintética 123');
      await page.getByTestId('conta-pag-confirmar').click();
      await expect(page.getByTestId('contas-mensagem')).toContainText('o lote está pago');
      await expect(page.getByTestId('conta-pag-vazia')).toBeVisible();
    } finally {
      // Recolher: desligar as contas (e as outras chaves do teste).
      await entrar(page, 'SINT.ADMIN');
      for (const c of [...CHAVES].reverse()) await chave(page, c, false);
    }
    await entrar(page, 'SINT.OPE.ATENDE');
    await page.goto('/operadora/contas');
    await expect(page.getByTestId('contas-desligada')).toBeVisible({ timeout: 30_000 });
    expect(externas).toEqual([]);
  });
});
