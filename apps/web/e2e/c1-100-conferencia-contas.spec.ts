// E2E @C1-100 (F7, 08-SGO linha 105): conferência das contas médicas recebidas.
// 1) Regras de crítica.
// Da tela das contas médicas para /operadora/regras-critica-conta: a operadora única já escolhida, a regra em uso na
// lista, a nova regra com a validação do domínio na hora (código repetido, procedimento relacionado igual ao principal,
// glosa automática sem motivo e sem percentual), a gravação com o corpo esperado, tirar de uso (só a versão e a
// situação vão ao servidor; a regra continua na lista, fora de uso) e axe sem violação séria.
// 2) A conferência na ficha da conta (/operadora/contas, abrir o lote): as críticas gravadas no recebimento, os
// demonstrativos entregues, o parecer da auditoria com a validação do domínio na hora (guia, resultado, texto mínimo,
// motivo na glosa, categoria do auditor na médica), o corpo do POST operadora/contas/:id/auditorias e a recarga.
// 3) O formulário some fora da análise e para quem não tem operadora.conta.analisar (SINT.OPE.ATENDE só lê).
// Fonte sintética: as respostas da API são simuladas pela rota (o contrato de efeito no banco está em
// conta-conferencia-propria.int.spec). Nenhum dado de pessoa.
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const OP = 8101;

async function entrar(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

const PROC_A = { id: 9101, codigo: '40301010', descricao: 'EXAME SINTETICO A' };
const PROC_B = { id: 9102, codigo: '40301020', descricao: 'EXAME SINTETICO B' };
const MOTIVO = { id: 9201, codigo: '1801', descricao: 'MOTIVO SINTETICO' };
const EM_USO = {
  id: 701,
  versao: 1,
  codigo: 'AUTO-1',
  descricao: 'EXAMES SINTETICOS EXCLUDENTES',
  tipo: 'auto_excludente',
  principal: PROC_A,
  relacionado: PROC_B,
  prestador: null,
  motivoGlosa: MOTIVO,
  percentual: null,
  glosaAutomatica: true,
  vigenciaInicio: '2026-01-01',
  vigenciaFim: null,
  ativo: true,
};

interface Estado {
  regras: Record<string, unknown>[];
  gravados: { url: string; corpo: Record<string, unknown> }[];
}

async function simular(page: Page, est: Estado): Promise<void> {
  const json = (r: Route, corpo: unknown, status = 200) =>
    r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(corpo) });
  await page.route('**/api/operadora/regras-critica-conta/**', async (r) => {
    const caminho = new URL(r.request().url()).pathname;
    if (r.request().method() === 'POST') {
      const corpo = (r.request().postDataJSON() ?? {}) as Record<string, unknown>;
      est.gravados.push({ url: caminho, corpo });
      if (caminho.endsWith('/situacao')) {
        est.regras = est.regras.map((x) =>
          x['id'] === 701 ? { ...x, versao: 2, ativo: corpo['ativo'] } : x,
        );
        return json(r, { id: 701, versao: 2 });
      }
      est.regras.push({
        ...EM_USO,
        ...corpo,
        id: 702,
        principal: PROC_A,
        relacionado: null,
        motivoGlosa: MOTIVO,
      });
      return json(r, { id: 702, versao: 1 }, 201);
    }
    if (caminho.endsWith('/apoio'))
      return json(r, { procedimentos: [PROC_A, PROC_B], motivos: [MOTIVO], prestadores: [] });
    return json(r, est.regras);
  });
}

test.describe('regras de crítica das contas recebidas @C1-100', () => {
  test.describe.configure({ mode: 'serial' });

  test('nova regra com validação na hora, gravação e tirar de uso sem apagar; axe', async ({ page }) => {
    const externas = vigiarExternas(page);
    const est: Estado = { regras: [{ ...EM_USO }], gravados: [] };
    await simular(page, est);
    // A operadora sintética das contas (o apoio real traz a lista; aqui a única, já escolhida).
    await page.route('**/api/operadora/contas/apoio', async (r) => {
      const real = await r.fetch();
      const corpo = (await real.json()) as Record<string, unknown>;
      await r.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ...corpo,
          operadoras: [{ id: OP, nome: 'OPERADORA SINTETICA', registroAns: '999999' }],
        }),
      });
    });
    await entrar(page, 'SINT.OPE.AUDITOR');
    await page.goto('/operadora/contas');
    await page.getByTestId('link-regras-critica-conta').click();
    await expect(page).toHaveURL(/\/operadora\/regras-critica-conta$/);
    await expect(page.getByTestId('tela-regras-critica-conta')).toBeVisible();
    await expect(page.getByTestId('regras-critica-AUTO-1')).toHaveAttribute('data-ativa', 'sim');

    // Validação na hora: código repetido (normalizado), relacionado igual ao principal.
    await page.getByTestId('regras-critica-codigo').locator('input').fill('auto 1');
    await page.getByTestId('regras-critica-descricao').locator('input').fill('GLOSA SINTETICA DE REFERENCIA');
    await escolher(page.getByTestId('regras-critica-principal'), { rotulo: /EXAME SINTETICO A/ });
    await escolher(page.getByTestId('regras-critica-relacionado'), { rotulo: /EXAME SINTETICO A/ });
    const falta = page.getByTestId('regras-critica-falta');
    await expect(falta).toContainText('código diferente das regras já cadastradas');
    await expect(falta).toContainText('procedimento relacionado diferente do principal');
    await expect(page.getByTestId('regras-critica-salvar')).toBeDisabled();

    // Glosa de referência: sem relacionado; exige motivo e percentual.
    await page.getByTestId('regras-critica-codigo').locator('input').fill('REF-1');
    await escolher(page.getByTestId('regras-critica-tipo'), {
      rotulo: 'Glosa de referência do procedimento',
    });
    await expect(page.getByTestId('regras-critica-relacionado')).toHaveCount(0);
    await expect(falta).toContainText('o motivo de glosa');
    await expect(falta).toContainText('o percentual de glosa');
    await escolher(page.getByTestId('regras-critica-motivo'), { rotulo: /1801/ });
    await page.getByTestId('regras-critica-percentual').locator('input').fill('150');
    await expect(falta).toContainText('percentual maior que 0 e até 100');
    await page.getByTestId('regras-critica-percentual').locator('input').fill('30');
    await expect(falta).toHaveCount(0);
    await semViolacaoAxe(page, 'regras de crítica das contas (formulário)');

    await page.getByTestId('regras-critica-salvar').click();
    await expect(page.getByTestId('regras-critica-aviso')).toContainText('Regra cadastrada');
    const inclusao = est.gravados.find((g) => g.url.endsWith(`/regras-critica-conta/${OP}`));
    expect(inclusao?.corpo).toMatchObject({
      codigo: 'REF-1',
      tipo: 'glosa_referencia',
      principal: PROC_A.id,
      relacionado: null,
      motivoGlosa: MOTIVO.id,
      percentual: 30,
      glosaAutomatica: false,
      vigenciaFim: null,
    });
    await expect(page.getByTestId('regras-critica-REF-1')).toBeVisible();

    // Tirar de uso: só versão e situação; a regra continua na lista, fora de uso.
    await page.getByTestId('regras-critica-alternar-AUTO-1').click();
    await expect(page.getByTestId('regras-critica-aviso')).toContainText('Situação da regra alterada');
    const situacao = est.gravados.find((g) => g.url.endsWith('/regra/701/situacao'));
    expect(situacao?.corpo).toEqual({ versao: 1, ativo: false });
    await expect(page.getByTestId('regras-critica-AUTO-1')).toHaveAttribute('data-ativa', 'nao');
    await semViolacaoAxe(page, 'regras de crítica das contas (lista)');
    expect(externas).toEqual([]);
  });

  test('conferência na ficha: críticas, demonstrativos, parecer validado na hora, envio e recarga; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    const est = estadoConta('recebida');
    await simularConta(page, est, true);
    await entrar(page, 'SINT.OPE.AUDITOR');
    await abrirFicha(page);

    // As críticas gravadas no recebimento e o demonstrativo entregue (com as emissões).
    await expect(page.getByTestId('conferencia-critica-1')).toContainText('AUTO-1');
    await expect(page.getByTestId('conferencia-critica-1')).toContainText('40301010');
    await expect(page.getByTestId('conferencia-sem-auditorias')).toBeVisible();
    await expect(page.getByTestId('conferencia-demonstrativo-5')).toContainText('1-202611000001');

    // Validação na hora: sem guia nem resultado, o registro fica desabilitado.
    const falta = page.getByTestId('conferencia-falta');
    await expect(falta).toContainText('a guia');
    await expect(falta).toContainText('o resultado');
    await expect(page.getByTestId('conferencia-registrar')).toBeDisabled();
    await escolher(page.getByTestId('conferencia-guia'), { rotulo: /G-SINT-1/ });
    await escolher(page.getByTestId('conferencia-item'), { rotulo: /40301010/ });
    // Médica sem auditor médico designado; glosa sem motivo; parecer curto.
    await escolher(page.getByTestId('conferencia-tipo'), { rotulo: 'Médica' });
    await escolher(page.getByTestId('conferencia-resultado'), { rotulo: 'Glosa parcial' });
    await page.getByTestId('conferencia-texto').locator('textarea').fill('curto');
    await expect(falta).toContainText('auditor designado da categoria do tipo escolhido');
    await expect(falta).toContainText('o motivo de glosa');
    await expect(falta).toContainText('o parecer com ao menos 10 caracteres');
    await expect(page.getByTestId('conferencia-registrar')).toBeDisabled();
    await escolher(page.getByTestId('conferencia-tipo'), { rotulo: 'Administrativa' });
    await escolher(page.getByTestId('conferencia-motivo'), { rotulo: /1801/ });
    await page
      .getByTestId('conferencia-texto')
      .locator('textarea')
      .fill('  Cobrança junto com o exame excludente.  ');
    await expect(falta).toHaveCount(0);
    await semViolacaoAxe(page, 'conferência da conta (parecer)');

    const lidasAntes = est.leiturasConferencia;
    await page.getByTestId('conferencia-registrar').click();
    await expect(page.getByTestId('conferencia-aviso')).toContainText('Parecer registrado');
    expect(est.pareceres).toEqual([
      {
        guia: 401,
        item: 4011,
        tipo: 'administrativa',
        resultado: 'glosa_parcial',
        parecer: 'Cobrança junto com o exame excludente.',
        motivoGlosa: 9201,
      },
    ]);
    // A recarga traz o parecer gravado na lista.
    await expect(page.getByTestId('conferencia-auditoria-31')).toBeVisible();
    expect(est.leiturasConferencia).toBeGreaterThan(lidasAntes);
    expect(externas).toEqual([]);
  });

  test('fora da análise ou sem operadora.conta.analisar, a conferência só se lê', async ({ page }) => {
    const liberada = estadoConta('analisada');
    await simularConta(page, liberada, true);
    await entrar(page, 'SINT.OPE.AUDITOR');
    await abrirFicha(page);
    await expect(page.getByTestId('conferencia-critica-1')).toBeVisible();
    await expect(page.getByTestId('conferencia-parecer')).toHaveCount(0);

    await page.unrouteAll({ behavior: 'ignoreErrors' });
    const leitura = estadoConta('recebida');
    await simularConta(page, leitura, false);
    await entrar(page, 'SINT.OPE.ATENDE');
    await abrirFicha(page);
    await expect(page.getByTestId('conferencia-demonstrativo-5')).toBeVisible();
    await expect(page.getByTestId('conferencia-parecer')).toHaveCount(0);
    expect(leitura.leiturasApoioRegras).toBe(0);
    expect(leitura.pareceres).toEqual([]);
  });
});

// ── conferência na ficha (fonte sintética) ──────────────────────────────────────────────────────────

const CONTA = 40;

interface EstadoConta {
  situacao: 'recebida' | 'analisada';
  auditorias: Record<string, unknown>[];
  pareceres: Record<string, unknown>[];
  leiturasConferencia: number;
  leiturasApoioRegras: number;
}
const estadoConta = (situacao: EstadoConta['situacao']): EstadoConta => ({
  situacao,
  auditorias: [],
  pareceres: [],
  leiturasConferencia: 0,
  leiturasApoioRegras: 0,
});

function resumo(situacao: string) {
  return {
    id: CONTA,
    protocolo: '202611000001',
    operadora: OP,
    prestador: 9301,
    prestadorNome: 'PRESTADOR SINTETICO',
    numeroLote: '910001',
    tipoGuia: 'sp-sadt',
    competencia: '2026-11',
    guias: 1,
    recebidaEm: '2026-11-20T10:00:00',
    prazoPagamento: '2026-12-20',
    vencida: false,
    situacao,
    recursosPendentes: 0,
    apresentado: 200,
    glosado: 0,
    acatado: 0,
    liberado: 0,
    pago: 0,
    saldo: 200,
    versao: 1,
  };
}

function detalhe(situacao: string) {
  return {
    ...resumo(situacao),
    operadoraNome: 'OPERADORA SINTETICA',
    registroAns: '999999',
    arquivo: { nome: 'lote.xml', bytes: 10, sha256: 'h1', hashEpilogo: 'e1', versaoTiss: '4.03.00' },
    analisadaEm: null,
    analisadaPor: null,
    observacao: null,
    motivoDevolucao: null,
    guiasDetalhe: [
      {
        id: 401,
        ordem: 1,
        numeroGuiaPrestador: 'G-SINT-1',
        numeroGuiaOperadora: null,
        senha: null,
        carteirinha: 'SINT0001',
        beneficiario: null,
        autorizacao: null,
        carater: '1',
        inicio: '2026-11-05',
        fim: '2026-11-05',
        apresentado: 200,
        glosado: 0,
        acatado: 0,
        criticas: [],
        recurso: null,
        recursosItens: [],
        itens: [
          {
            id: 4011,
            sequencial: 1,
            grupo: 'procedimento',
            codigoDespesa: null,
            tabela: '22',
            codigo: '40301010',
            descricao: 'EXAME SINTETICO A',
            data: '2026-11-05',
            quantidade: 1,
            valorUnitario: 200,
            apresentado: 200,
            glosado: 0,
            motivo: null,
            motivoNome: null,
            justificativa: null,
            origem: null,
            critica: null,
          },
        ],
      },
    ],
    eventos: [],
    acoes: [],
  };
}

function conferencia(est: EstadoConta) {
  return {
    criticas: [
      {
        id: 1,
        guia: 401,
        numeroGuia: 'G-SINT-1',
        item: 4011,
        itemCodigo: '40301010',
        regra: { id: 701, codigo: 'AUTO-1' },
        motivoGlosa: '1801',
        descricao: 'Procedimentos que não se cobram juntos',
        tipo: 'glosa',
        ocorridaEm: '2026-11-20T10:00:00',
      },
    ],
    auditorias: est.auditorias,
    demonstrativos: [
      {
        id: 5,
        versao: 2,
        numero: '1-202611000001',
        emitidoEm: '2026-11-21T09:00:00',
        informado: 200,
        liberado: 200,
        glosa: 0,
        situacao: 'enviado',
        emissoes: 2,
      },
    ],
  };
}

async function simularConta(page: Page, est: EstadoConta, analisa: boolean): Promise<void> {
  const json = (r: Route, corpo: unknown, status = 200) =>
    r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(corpo) });
  await page.route(
    (u) => u.pathname.startsWith('/api/operadora/contas'),
    async (r) => {
      const req = r.request();
      const caminho = new URL(req.url()).pathname;
      if (caminho.endsWith('/contas/apoio'))
        return json(r, {
          operadoras: [{ id: OP, nome: 'OPERADORA SINTETICA', registroAns: '999999' }],
          prestadores: [{ id: 9301, nome: 'PRESTADOR SINTETICO' }],
          motivos: [],
          auditor: null,
          ligada: true,
          motivo: null,
          podeLer: true,
          podeReceber: false,
          podeAnalisar: analisa,
          podePagar: false,
          hoje: '2026-11-25',
          parametros: { diasPagamento: 30, maximoKilobytes: 1024 },
        });
      if (caminho === '/api/operadora/contas')
        return json(r, {
          itens: [resumo(est.situacao)],
          proxima: null,
          totais: {
            emAnalise: 1,
            aPagar: 0,
            vencidas: 0,
            recursosPendentes: 0,
            valorEmAnalise: 200,
            valorAPagar: 0,
          },
        });
      if (caminho.endsWith(`/contas/${CONTA}`)) return json(r, detalhe(est.situacao));
      if (caminho.endsWith(`/contas/${CONTA}/conferencia`)) {
        est.leiturasConferencia += 1;
        return json(r, conferencia(est));
      }
      if (caminho.endsWith(`/contas/${CONTA}/auditorias`) && req.method() === 'POST') {
        const corpo = (req.postDataJSON() ?? {}) as Record<string, unknown>;
        est.pareceres.push(corpo);
        est.auditorias.push({
          id: 31,
          guia: 401,
          numeroGuia: 'G-SINT-1',
          item: corpo['item'] ?? null,
          tipo: corpo['tipo'],
          resultado: corpo['resultado'],
          parecer: corpo['parecer'],
          motivoGlosa: '1801',
          auditor: 'AUDITOR SINTETICO',
          registradaEm: '2026-11-25T10:00:00',
        });
        return json(r, { id: 31, versao: 1 }, 201);
      }
      return json(r, { title: 'não simulado' }, 404);
    },
  );
  await page.route(`**/api/operadora/regras-critica-conta/${OP}/apoio`, async (r) => {
    est.leiturasApoioRegras += 1;
    return json(r, { procedimentos: [PROC_A, PROC_B], motivos: [MOTIVO], prestadores: [] });
  });
}

async function abrirFicha(page: Page): Promise<void> {
  await page.goto('/operadora/contas');
  await page.getByTestId(`contas-abrir-${CONTA}`).click();
  await expect(page.getByTestId('conta-ficha')).toBeVisible();
  await expect(page.getByTestId('conta-conferencia')).toBeVisible();
}
