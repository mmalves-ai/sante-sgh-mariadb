// 06-FAT linha 30: regra de apresentação TISS por fonte pagadora, pela tela `/faturamento/apresentacao-tiss`.
// A regra exige o banco próprio, e o E2E roda com a fonte sintética (sem núcleo): as respostas da API destas rotas são
// simuladas pelo Playwright com massa SINTÉTICA, e a sessão ganha a permissão de editar contrato (a tela só esconde;
// quem decide é o servidor). O que se prova é a tela: escolhida a fonte, a regra e os itens aparecem; a validação na
// hora segura a regra com registro ANS errado, o item sem alvo ou fora do arquivo com código, e o valor padrão fora do
// domínio TISS; as gravações saem com o corpo certo; desativar e encerrar mandam a versão, sem apagar. O efeito no
// banco está no contrato de efeito (apps/api/src/modulos/tiss/apresentacao-propria.int.spec.ts). Tag @C2-086.
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const FONTE = 8601;

const json = (rota: Route, corpo: unknown, status = 200) =>
  rota.fulfill({ status, contentType: 'application/json', body: JSON.stringify(corpo) });

async function entrar(page: Page): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill('SINT.FATURAMENTO');
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

const regra = {
  id: 31,
  versao: 1,
  versaoPadraoTissId: 2,
  tipoContaId: null,
  registroAns: '123456',
  codigoContratadoOperadora: 'SINT-86',
  limiteGuiasLote: 100,
  ordenacaoGuias: 'numero_guia',
  usaGuiaConsulta: true,
  agrupaItens: false,
  omiteGuiaSemValor: true,
  usaFaturamentoEletronico: true,
  ativo: true,
};
const item = {
  id: 41,
  versao: 1,
  regraId: 31,
  grupoId: 5,
  itemId: null,
  funcaoId: null,
  setorId: null,
  profissionalId: null,
  tipoGuia: 'sp_sadt',
  codigoApresentacao: '90000086',
  descricaoApresentacao: 'TAXA SINTETICA',
  agrupa: false,
  agrupamentoData: null,
  naoExporta: false,
  ativo: true,
};
const padrao = {
  id: 51,
  versao: 1,
  campo: 'tipoAtendimento',
  valor: '05',
  sobrepoe: false,
  estabelecimentoId: 1,
  regraId: null,
  regimeId: null,
  origemId: null,
  itemId: null,
  vigenciaInicio: '2026-01-01',
  vigenciaFim: null,
  ativo: true,
};

test.describe('apresentação TISS por fonte pagadora @C2-086', () => {
  test('regra, itens por guia e valor padrão: validação na hora, gravações com o corpo certo, nada se apaga; axe', async ({
    page,
  }) => {
    const enviados: { url: string; corpo: Record<string, unknown> }[] = [];
    await page.route('**/api/sessao', async (rota) => {
      if (rota.request().method() !== 'GET') return rota.continue();
      const r = await rota.fetch();
      if (!r.ok()) return rota.fulfill({ response: r });
      const s = (await r.json()) as { permissoes?: string[] };
      s.permissoes = [...(s.permissoes ?? []), 'convenio.contrato.ler', 'convenio.contrato.editar'];
      return rota.fulfill({ response: r, json: s });
    });
    await page.route('**/api/cadastros/convenios?**', (rota) =>
      json(rota, {
        itens: [
          {
            codigo: FONTE,
            nome: 'OPERADORA SINTETICA C2086',
            situacao: 'ativo',
            aceitaAtendimento: { aceita: true, motivo: null },
            classificacao: null,
            registroAns: null,
            tabelas: { honorariosInternacao: null, honorariosExterna: null, diarias: null, matmed: null },
          },
        ],
        total: 1,
        destino: 'memoria',
      }),
    );
    await page.route('**/api/faturamento/tiss/apresentacao/opcoes', (rota) =>
      json(rota, {
        versoesTiss: [{ id: 2, rotulo: '04.03.00 — VERSAO SINTETICA' }],
        tiposConta: [{ id: 7, rotulo: 'INT — INTERNACAO SINTETICA' }],
        grupos: [{ id: 5, rotulo: 'G5 — GRUPO SINTETICO' }],
        funcoes: [{ id: 3, rotulo: 'AUX1 — AUXILIAR SINTETICO' }],
        regimes: [{ id: 1, rotulo: '1 — AMBULATORIAL SINTETICO' }],
        origens: [{ id: 4, rotulo: 'PS — ORIGEM SINTETICA' }],
      }),
    );
    await page.route(`**/api/faturamento/tiss/apresentacao?convenio=${FONTE}`, (rota) =>
      json(rota, { regras: [regra], itens: [item], padroes: [padrao] }),
    );
    await page.route('**/api/faturamento/tiss/apresentacao/**', (rota) => {
      const req = rota.request();
      if (req.method() !== 'POST') return rota.fallback();
      enviados.push({ url: req.url(), corpo: req.postDataJSON() as Record<string, unknown> });
      return json(rota, { id: 99, versao: 2 }, 201);
    });

    await entrar(page);
    await page.goto('/faturamento/apresentacao-tiss');
    await expect(page.getByTestId('apt-escolha')).toBeVisible();
    await escolher(page.getByTestId('apt-convenio'), String(FONTE));

    // A regra geral e o item da guia SP/SADT aparecem.
    await expect(page.getByTestId('apt-regra-31')).toContainText('Regra geral');
    await expect(page.getByTestId('apt-item-41')).toContainText('90000086');
    await expect(page.getByTestId('apt-item-41')).toContainText('SP/SADT');

    // Regra: registro ANS com 5 dígitos trava o envio; corrigido, a alteração sai com id e versão.
    await page.getByTestId('apt-editar-31').click();
    await page.getByTestId('apt-ans').fill('12345');
    await expect(page.getByTestId('apt-erros-regra')).toContainText('6 dígitos');
    await expect(page.getByTestId('apt-gravar-regra')).toBeDisabled();
    await page.getByTestId('apt-ans').fill('654321');
    await page.getByTestId('apt-limite').fill('50');
    await page.getByTestId('apt-gravar-regra').click();
    await expect(page.getByTestId('apt-aviso')).toContainText('Regra gravada');
    expect(enviados.at(-1)?.url).toContain('/apresentacao/regras');
    expect(enviados.at(-1)?.corpo).toMatchObject({
      id: 31,
      versao: 1,
      fontePagadoraId: FONTE,
      versaoPadraoTissId: 2,
      registroAns: '654321',
      limiteGuiasLote: 50,
      omiteGuiaSemValor: true,
    });

    // Item: sem alvo, travado; fora do arquivo com código, travado; com a função na equipe, incluído.
    await expect(page.getByTestId('apt-erros-item')).toContainText('Escolha o item, o grupo ou a função');
    await expect(page.getByTestId('apt-incluir-item')).toBeDisabled();
    await escolher(page.getByTestId('apt-item-funcao'), '3');
    await page.getByTestId('apt-item-codigo').fill('90000087');
    await page.getByTestId('apt-item-fora').check();
    await expect(page.getByTestId('apt-erros-item')).toContainText('fora do arquivo');
    await page.getByTestId('apt-item-codigo').fill('');
    await expect(page.getByTestId('apt-incluir-item')).toBeEnabled();
    await page.getByTestId('apt-incluir-item').click();
    await expect(page.getByTestId('apt-aviso')).toContainText('Item incluído');
    expect(enviados.at(-1)?.corpo).toMatchObject({
      regraId: 31,
      funcaoEquipeCobrancaId: 3,
      naoExporta: true,
      codigoApresentacao: null,
    });

    // Desativar manda a versão (o item fica no histórico).
    await page.getByTestId('apt-desativar-41').click();
    await expect(page.getByTestId('apt-aviso')).toContainText('fica no histórico');
    expect(enviados.at(-1)?.url).toContain('/apresentacao/itens/41/desativacao');
    expect(enviados.at(-1)?.corpo).toMatchObject({ versao: 1 });

    // Valor padrão: fora do domínio TISS, travado na hora; válido, incluído.
    await escolher(page.getByTestId('apt-padrao-campo'), 'caraterAtendimento');
    await page.getByTestId('apt-padrao-valor').fill('9');
    await expect(page.getByTestId('apt-erros-padrao')).toContainText('não existe no padrão TISS');
    await expect(page.getByTestId('apt-incluir-padrao')).toBeDisabled();
    await page.getByTestId('apt-padrao-valor').fill('1');
    await expect(page.getByTestId('apt-incluir-padrao')).toBeEnabled();
    await semViolacaoAxe(page, '/faturamento/apresentacao-tiss (apresentação TISS)');
    await page.getByTestId('apt-incluir-padrao').click();
    await expect(page.getByTestId('apt-aviso')).toContainText('Valor padrão incluído');
    expect(enviados.at(-1)?.corpo).toMatchObject({
      fontePagadoraId: FONTE,
      campo: 'caraterAtendimento',
      valor: '1',
      estabelecimentoProprio: true,
    });

    // Encerrar o valor padrão vigente manda a versão e a data de fim.
    await page.getByTestId('apt-encerrar-51').click();
    await expect(page.getByTestId('apt-aviso')).toContainText('encerrado');
    expect(enviados.at(-1)?.url).toContain('/apresentacao/valores-padrao/51/encerramento');
    expect(enviados.at(-1)?.corpo).toMatchObject({ versao: 1 });
  });
});
