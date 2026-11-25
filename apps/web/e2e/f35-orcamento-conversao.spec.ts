// E2E @F3.5-14 (F3.5, 05-SADT linha 26): o orçamento de exames particulares e a conversão em atendimento pelo caminho
// da tela /sadt/orcamentos. O preço da tabela da fonte particular aparece na hora (sem valor digitado), a validade em
// branco segue o padrão do estabelecimento (o campo não é enviado) e a digitada prevalece; o orçamento gravado entra na
// lista; a conversão parte dos atendimentos do paciente (nunca um id digitado). As simulações seguem o contrato do
// servidor (ServicoOrcamentoSadt.atendimentos): orçamento de interessado sem cadastro e sem CPF não tem atendimento a
// oferecer até a tela buscar e escolher o paciente (a rota recebe ?paciente=); aí a avaliação mostra o paciente e só
// libera o botão depois da confirmação do vínculo. Orçamento de paciente cadastrado já lista os atendimentos dele e
// converte sem confirmação de vínculo. Convertido, a situação muda na lista. As rotas do orçamento de exames exigem o banco
// próprio e o E2E roda com a fonte sintética (sem núcleo): as respostas são simuladas pelo Playwright com massa
// SINTÉTICA. O efeito no banco (orçamento e itens com o preço da tabela, requisição, valores aprovados na conta,
// situação, recusas sem gravar) está em apps/api/src/modulos/sadt/aplicacao/orcamento-propria.int.spec.ts.
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';

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

interface CorpoOrcamento {
  nome: string | null;
  fontePagadora: number;
  exames: { exame: number; quantidade: number; valor: number | null }[];
  desconto: number;
  validadeDias?: number;
}

const ID = 9500;
const ATENDIMENTO = 900;
const PACIENTE = 800;
const PRECO_TABELA = 40;
const HOJE = '2026-03-15';
const validade = (dias: number) =>
  new Date(Date.parse(`${HOJE}T00:00:00Z`) + dias * 86_400_000).toISOString().slice(0, 10);

const ORCAMENTO_CADASTRADO: CorpoOrcamento = {
  nome: null,
  fontePagadora: 11,
  exames: [{ exame: 301, quantidade: 3, valor: null }],
  desconto: 0,
};

/**
 * As respostas das rotas do orçamento de exames, no contrato do servidor. `comCadastro`: o orçamento já existe na
 * lista, em aberto, de um paciente cadastrado (a conversão lista os atendimentos dele e não pede confirmação de
 * vínculo); sem ele, a lista começa vazia e o orçamento gravado é de um interessado sem cadastro e sem CPF.
 */
async function simular(page: Page, comCadastro: boolean) {
  const previas: CorpoOrcamento[] = [];
  const gravados: CorpoOrcamento[] = comCadastro ? [{ ...ORCAMENTO_CADASTRADO }] : [];
  const conversoes: Record<string, unknown>[] = [];
  let convertido = false;
  const consultasAtendimentos: (string | null)[] = [];
  const buscasPaciente: string[] = [];
  // A prévia do servidor: o preço da tabela quando o balcão não informa valor; a validade padrão é de 7 dias aqui.
  const montar = (c: CorpoOrcamento) => {
    const itens = c.exames.map((x) => {
      const unitario = x.valor ?? PRECO_TABELA;
      return {
        exame: x.exame,
        codigo: 'K',
        nome: 'POTASSIO SINTETICO',
        quantidade: x.quantidade,
        unitario,
        total: unitario * x.quantidade,
        origemPreco: x.valor === null ? 'tabela' : 'informado',
        precoTabela: PRECO_TABELA,
      };
    });
    const bruto = itens.reduce((a, i) => a + i.total, 0);
    return {
      itens,
      bruto,
      desconto: c.desconto,
      total: bruto - c.desconto,
      validade: validade(c.validadeDias ?? 7),
    };
  };
  await page.route('**/api/sadt/orcamentos-exames**', (rota) => {
    const req = rota.request();
    const caminho = new URL(req.url()).pathname.replace(/^\/api\/sadt\/orcamentos-exames\/?/, '');
    const post = req.method() === 'POST';
    if (caminho === 'apoio')
      return json(rota, {
        exames: [{ id: 301, codigo: 'K', nome: 'POTASSIO SINTETICO', tipo: 'laboratorio' }],
        fontes: [{ id: 11, nome: 'PARTICULAR SINTETICO' }],
      });
    if (caminho === 'previa' && post) {
      const c = req.postDataJSON() as CorpoOrcamento;
      previas.push(c);
      return json(rota, montar(c));
    }
    if (caminho === '' && post) {
      const c = req.postDataJSON() as CorpoOrcamento;
      gravados.push(c);
      const m = montar(c);
      return json(rota, { id: ID, numero: 'OP-000001', total: m.total, validade: m.validade });
    }
    if (caminho === `${ID}/atendimentos`) {
      // Contrato do servidor: do paciente do orçamento; sem ele (e sem CPF), só do paciente escolhido na busca.
      const escolhido = new URL(req.url()).searchParams.get('paciente');
      consultasAtendimentos.push(escolhido);
      const doPaciente = comCadastro || escolhido === String(PACIENTE);
      return json(rota, {
        itens: doPaciente
          ? [
              {
                id: ATENDIMENTO,
                paciente: PACIENTE,
                pacienteNome: 'PACIENTE SINTETICO',
                numero: 'AT-900',
                entradaEm: `${HOJE}T12:00:00.000Z`,
                situacao: 'aberto',
                fonte: 'PARTICULAR SINTETICO',
              },
            ]
          : [],
      });
    }
    if (caminho === `${ID}/avaliar` && post)
      return json(rota, {
        paciente: { id: PACIENTE, nome: 'PACIENTE SINTETICO' },
        // O vínculo só pede confirmação quando o orçamento não tem paciente cadastrado.
        confirmarPaciente: !comCadastro,
        restricoes: [],
        segue: true,
        codigo: null,
        motivo: null,
      });
    if (caminho === `${ID}/converter` && post) {
      conversoes.push(req.postDataJSON() as Record<string, unknown>);
      convertido = true;
      return json(rota, {
        id: ID,
        atendimento: ATENDIMENTO,
        conta: 77,
        requisicoes: [{ requisicao: 500, numero: 'RQ-500' }],
      });
    }
    return json(rota, { title: 'Não encontrado', status: 404 }, 404);
  });
  // A lista: vazia até gravar; depois, o orçamento gravado, em aberto e, convertido, com a situação nova.
  await page.route(/\/api\/sadt\/orcamentos(\?.*)?$/, (rota) => {
    const g = gravados[0];
    if (!g) return json(rota, { itens: [], cortada: false });
    const m = montar(g);
    return json(rota, {
      itens: [
        {
          id: ID,
          nome: g.nome ?? 'PACIENTE SINTETICO',
          paciente: comCadastro ? PACIENTE : null,
          convenio: { codigo: 11, nome: 'PARTICULAR SINTETICO' },
          ato: 1,
          atoRotulo: 'OP-000001',
          data: HOJE,
          validade: m.validade,
          situacao: convertido ? 'convertido' : 'aberto',
          itens: m.itens.map((i) => ({ exame: i.codigo, nome: i.nome, valor: i.total })),
          total: m.total,
          convertidoEm: convertido ? { atendimento: ATENDIMENTO, em: `${HOJE}T12:30:00.000Z` } : null,
        },
      ],
      cortada: false,
    });
  });

  // A busca do cadastro de pacientes (a da conversão): um paciente sintético para o termo pedido.
  await page.route('**/api/cadastros/pacientes?**', (rota) => {
    buscasPaciente.push(new URL(rota.request().url()).searchParams.get('termo') ?? '');
    return json(rota, {
      tipo: 'auto',
      itens: [
        {
          id: PACIENTE,
          prontuario: 800,
          nome: 'PACIENTE SINTETICO',
          nomeSocial: null,
          nascimento: '1980-01-01',
          sexo: 'F',
          maeMascarada: null,
          cpfMascarado: null,
          telefoneMascarado: null,
          situacao: 'ativo',
          obito: false,
          homonimo: false,
        },
      ],
      sugestoes: [],
      truncado: false,
      duracaoMs: 1,
    });
  });
  return { previas, gravados, conversoes, consultasAtendimentos, buscasPaciente };
}

test.describe('Orçamento de exames particulares e conversão @F3.5-14', () => {
  test.setTimeout(180_000);
  test('preço da tabela na hora; validade em branco segue o padrão; conversão com o paciente confirmado; axe', async ({
    page,
  }) => {
    const { previas, gravados, conversoes, consultasAtendimentos, buscasPaciente } = await simular(
      page,
      false,
    );

    await entrar(page, 'SINT.RECEPCAO.SADT');
    await page.goto('/sadt/orcamentos');
    await expect(page.getByTestId('tela-sadt-orcamentos')).toBeVisible();

    // Novo orçamento sem cadastro: nome, fonte particular, exame e quantidade; o preço vem da tabela, sem digitar valor.
    await page.getByTestId('orcamento-nome').fill('INTERESSADO SINTETICO');
    await escolher(page.getByTestId('orcamento-convenio'), { rotulo: 'PARTICULAR SINTETICO' });
    await escolher(page.getByTestId('orcamento-exame-0'), { rotulo: /POTASSIO SINTETICO/ });
    await page.getByLabel('Qtd.').fill('3');
    const previa = page.getByTestId('orcamento-previa');
    await expect(previa).toContainText('POTASSIO SINTETICO: 3 ×');
    await expect(previa).toContainText('(tabela)');
    await expect(page.getByTestId('orcamento-total')).toContainText('120,00');
    // A validade em branco: o campo não vai ao servidor e vale o padrão do estabelecimento (7 dias nesta massa).
    await expect(page.getByTestId('orcamento-validade-dias')).toHaveValue('');
    await expect(previa).toContainText(`Válido até ${validade(7).split('-').reverse().join('/')}`);
    expect(previas.at(-1)).not.toHaveProperty('validadeDias');
    // A validade digitada prevalece e a data muda na hora.
    await page.getByTestId('orcamento-validade-dias').fill('3');
    await expect(previa).toContainText(`Válido até ${validade(3).split('-').reverse().join('/')}`);
    expect(previas.at(-1)).toMatchObject({ validadeDias: 3 });
    await page.getByTestId('orcamento-validade-dias').fill('');
    await expect(previa).toContainText(`Válido até ${validade(7).split('-').reverse().join('/')}`);
    // O valor do balcão troca a origem do preço; apagado, volta a tabela.
    await page.getByTestId('orcamento-valor-0').fill('35');
    await expect(previa).toContainText('(informado no balcão)');
    await expect(page.getByTestId('orcamento-total')).toContainText('105,00');
    await page.getByTestId('orcamento-valor-0').fill('');
    await expect(previa).toContainText('(tabela)');
    await expect(page.getByTestId('orcamento-total')).toContainText('120,00');

    await page.getByTestId('orcamento-gravar').click();
    await expect(page.getByTestId('orcamento-mensagem')).toContainText('Orçamento OP-000001 gravado');
    expect(gravados).toHaveLength(1);
    expect(gravados[0]).toMatchObject({
      nome: 'INTERESSADO SINTETICO',
      fontePagadora: 11,
      exames: [{ exame: 301, quantidade: 3, valor: null }],
    });
    expect(gravados[0]).not.toHaveProperty('validadeDias');

    // O orçamento gravado na lista, em aberto; a conversão parte dos atendimentos do paciente.
    await expect(page.getByTestId(`orcamento-situacao-${ID}`)).toContainText('Em aberto');
    await page.getByTestId(`orcamento-atendimentos-${ID}`).click();
    // Interessado sem cadastro e sem CPF: o servidor não tem de quem listar; a tela avisa e pede a busca do paciente.
    await expect(page.getByTestId('tela-sadt-orcamentos')).toContainText(
      'Nenhum atendimento ativo da mesma fonte',
    );
    await expect(page.getByTestId(`orcamento-converter-${ID}-${ATENDIMENTO}`)).toHaveCount(0);
    expect(consultasAtendimentos).toEqual([null]);
    const termo = page.getByTestId(`orcamento-conv-termo-${ID}`);
    await termo.fill('PACIENTE SINT');
    await termo.press('Enter');
    await page.getByTestId(`orcamento-conv-paciente-${ID}-${PACIENTE}`).click();
    // Escolhido o paciente, a rota leva paciente=800 e só então o atendimento dele aparece.
    await expect(page.getByTestId(`orcamento-converter-${ID}-${ATENDIMENTO}`)).toBeVisible();
    expect(buscasPaciente).toEqual(['PACIENTE SINT']);
    expect(consultasAtendimentos).toEqual([null, String(PACIENTE)]);
    await page.getByTestId(`orcamento-converter-${ID}-${ATENDIMENTO}`).click();
    const avaliacao = page.getByTestId(`orcamento-avaliacao-${ID}`);
    await expect(avaliacao).toContainText('PACIENTE SINTETICO');
    // O interessado sem cadastro só vira o paciente do atendimento com a confirmação de quem converte.
    await expect(page.getByTestId(`orcamento-converter-${ID}`)).toBeDisabled();
    await page.getByTestId(`orcamento-vinculo-${ID}`).check();
    await expect(page.getByTestId(`orcamento-converter-${ID}`)).toBeEnabled();
    await semViolacaoAxe(page, '/sadt/orcamentos');
    await page.getByTestId(`orcamento-converter-${ID}`).click();
    await expect(page.getByTestId('orcamento-mensagem')).toContainText('Orçamento convertido: 1 requisição');
    expect(conversoes).toEqual([
      { atendimento: ATENDIMENTO, confirmaPaciente: PACIENTE, confirmado: false, justificativa: null },
    ]);
    // Convertido: a situação muda na lista e a conversão some (não se converte duas vezes).
    await expect(page.getByTestId(`orcamento-situacao-${ID}`)).toContainText('Convertido');
    await expect(page.getByTestId(`orcamento-atendimentos-${ID}`)).toHaveCount(0);
    await expect(page.locator('[data-testid="tela-sadt-orcamentos"] select')).toHaveCount(0);
  });

  test('orçamento de paciente cadastrado: os atendimentos dele vêm direto e a conversão não pede confirmação de vínculo', async ({
    page,
  }) => {
    const { conversoes, consultasAtendimentos, buscasPaciente } = await simular(page, true);
    await entrar(page, 'SINT.RECEPCAO.SADT');
    await page.goto('/sadt/orcamentos');
    await expect(page.getByTestId(`orcamento-situacao-${ID}`)).toContainText('Em aberto');
    await page.getByTestId(`orcamento-atendimentos-${ID}`).click();
    // O paciente é o do orçamento: nada de busca, e a rota não leva paciente escolhido.
    await page.getByTestId(`orcamento-converter-${ID}-${ATENDIMENTO}`).click();
    expect(consultasAtendimentos).toEqual([null]);
    expect(buscasPaciente).toEqual([]);
    await expect(page.getByTestId(`orcamento-conv-termo-${ID}`)).toHaveCount(0);
    await expect(page.getByTestId(`orcamento-avaliacao-${ID}`)).toContainText('PACIENTE SINTETICO');
    // Sem vínculo a confirmar e sem aviso: o botão já vem liberado.
    await expect(page.getByTestId(`orcamento-vinculo-${ID}`)).toHaveCount(0);
    await expect(page.getByTestId(`orcamento-converter-${ID}`)).toBeEnabled();
    await page.getByTestId(`orcamento-converter-${ID}`).click();
    await expect(page.getByTestId('orcamento-mensagem')).toContainText('Orçamento convertido: 1 requisição');
    expect(conversoes).toEqual([
      { atendimento: ATENDIMENTO, confirmaPaciente: null, confirmado: false, justificativa: null },
    ]);
    await expect(page.getByTestId(`orcamento-situacao-${ID}`)).toContainText('Convertido');
    await expect(page.getByTestId(`orcamento-atendimentos-${ID}`)).toHaveCount(0);
  });
});
