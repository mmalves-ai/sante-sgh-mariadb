// C1-083 (05-SADT linha 12): cultura e antibiograma na digitação do resultado, e o cadastro dos painéis e dos pontos de
// corte. Fonte sintética; as rotas da microbiologia são simuladas (no ambiente em memória elas respondem 503), e o
// contrato de efeito no banco está em apps/api/src/modulos/sadt/aplicacao/microbiologia-cadastro.int.spec.ts e
// microbiologia.int.spec.ts.
// Prova: 1) na digitação, "Abrir a cultura" mostra o painel; ao escolher o germe, os antimicrobianos do painel padrão
// entram sozinhos na ordem do laudo; a cultura final sem conclusão é recusada na hora; gravar manda o corpo pelo exame
// pedido; a interpretação lida volta na tabela; axe. 2) no cadastro, o painel novo leva os itens na ordem escolhida
// (descer troca a ordem), o painel só de restritos é recusado na hora, o ponto de corte com limites invertidos é
// recusado na hora e o válido grava e avisa o encerramento da versão anterior; o cadastro lê GET /paineis
// (sadt.catalogo.ler), nunca o cadastro da cultura, e mostra o painel inativo com a situação; desativar o painel padrão
// avisa na hora e esconde a escolha do padrão; o inativo volta a valer; axe.
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const EXAME = 9083;

async function entrar(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

const json = (rota: Route, corpo: unknown) =>
  rota.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(corpo) });

const cadastro = {
  materiais: [{ id: 1, nome: 'SANGUE SINTETICO' }],
  microrganismos: [{ id: 11, nome: 'GERME SINTETICO', painel: 21 }],
  antimicrobianos: [
    { id: 31, nome: 'DROGA SINTETICA A' },
    { id: 32, nome: 'DROGA SINTETICA B' },
    { id: 33, nome: 'DROGA SINTETICA C' },
  ],
  paineis: [
    {
      id: 21,
      codigo: 'PS1',
      versao: 1,
      nome: 'PAINEL SINTETICO',
      microrganismo: 11,
      material: null,
      metodo: 'concentracao_inibitoria',
      norma: 'BrCAST',
      itens: [
        {
          antimicrobiano: 32,
          exibeNoLaudo: true,
          liberacaoRestrita: false,
          indicaMultirresistencia: false,
          sequencia: 1,
        },
        {
          antimicrobiano: 31,
          exibeNoLaudo: true,
          liberacaoRestrita: true,
          indicaMultirresistencia: true,
          sequencia: 2,
        },
      ],
    },
  ],
};

// O cadastro dos painéis (GET /paineis, sadt.catalogo.ler) traz também o painel inativo, com a situação.
const cadastroDosPaineis = {
  ...cadastro,
  paineis: [
    ...cadastro.paineis.map((p) => ({ ...p, ativo: true })),
    {
      id: 23,
      codigo: 'PS0',
      versao: 4,
      nome: 'PAINEL SINTETICO ANTIGO',
      microrganismo: 11,
      material: null,
      metodo: 'disco_difusao',
      norma: 'BrCAST',
      ativo: false,
      itens: [
        {
          antimicrobiano: 33,
          exibeNoLaudo: true,
          liberacaoRestrita: false,
          indicaMultirresistencia: false,
          sequencia: 1,
        },
      ],
    },
  ],
};

const ficha = {
  exame: {
    id: EXAME,
    chave: { data: '2026-11-25', reg: 1001, conta: 0, atend: 'I', ato: 15, exame: 'HC', sequencia: 1 },
    versao: null,
    paciente: {
      id: 1001,
      prontuario: 1001,
      nome: 'PACIENTE SINTETICO',
      sexo: 'F',
      idadeAnos: 40,
      nascimento: null,
    },
    atendimento: { cabecalho: 'Internação sintética', reg: 1001, tipo: 'I', unidade: null, leito: null },
    setor: 'laboratorio',
    ato: 15,
    atoRotulo: 'Patologia clínica',
    exame: { id: 1, codigo: 'HC', nome: 'HEMOCULTURA SINTETICA' },
    estado: 'recebido',
    estadoRotulo: 'Recebido no setor',
    urgente: false,
    origem: 'outro',
    solicitante: 'MEDICO SINTETICO',
    pedidoEm: null,
    previsaoColeta: null,
    material: null,
    recipiente: null,
    especialidade: null,
    amostra: null,
    critico: false,
  },
  elementos: [],
  variaveis: [],
  observacoes: [],
  modelos: [],
  laudo: null,
  alertaDataInvalida: false,
  bloqueado: false,
  grandezas: [],
  textosPadrao: [],
  idadePaciente: 40,
};

const culturaGravada = {
  id: 41,
  versao: 1,
  material: 1,
  materialNome: 'SANGUE SINTETICO',
  crescimento: 'com_crescimento',
  contagemColonias: null,
  conclusao: null,
  observacao: null,
  notificaControleInfeccao: false,
  situacao: 'parcial',
  laudo: 'Material: SANGUE SINTETICO',
  isolados: [
    {
      id: 51,
      sequencia: 1,
      microrganismo: 11,
      microrganismoNome: 'GERME SINTETICO',
      contagemUfcMl: null,
      multirresistente: false,
      betalactamaseEspectroEstendido: false,
      carbapenemase: false,
      resistenteMeticilina: false,
      resistenteVancomicina: false,
      contaminanteProvavel: false,
      notificadoControleInfeccao: false,
      testes: [
        {
          antimicrobiano: 32,
          antimicrobianoNome: 'DROGA SINTETICA B',
          metodo: 'cim',
          cim: 1,
          halo: null,
          valorTexto: null,
          interpretacao: 'sensivel_dose_dependente',
          pontoCorte: 61,
          exibeNoLaudo: true,
        },
        {
          antimicrobiano: 31,
          antimicrobianoNome: 'DROGA SINTETICA A',
          metodo: 'cim',
          cim: 0.5,
          halo: null,
          valorTexto: null,
          interpretacao: 'sensivel',
          pontoCorte: 62,
          exibeNoLaudo: false,
        },
      ],
    },
  ],
};

test.describe('@C1-083 cultura e antibiograma', () => {
  test('na digitação: o painel do germe entra sozinho, a regra da final confere na hora e a cultura grava; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    let gravada = false;
    const corpos: unknown[] = [];
    await page.route(/\/api\/sadt\/microbiologia\/cadastro$/, (r) => json(r, cadastro));
    await page.route(new RegExp(`/api/sadt/resultados/${EXAME}/digitacao$`), (r) => json(r, ficha));
    await page.route(new RegExp(`/api/sadt/microbiologia/exames/${EXAME}/cultura$`), async (r) => {
      if (r.request().method() === 'POST') {
        corpos.push(r.request().postDataJSON());
        gravada = true;
        return json(r, {
          id: 41,
          situacao: 'parcial',
          isolados: 1,
          testes: 2,
          multirresistentes: 0,
          notificados: 0,
        });
      }
      return json(
        r,
        gravada ? { resultado: 71, cultura: culturaGravada } : { resultado: null, cultura: null },
      );
    });

    await entrar(page, 'SINT.BIOMEDICO');
    await page.goto(`/sadt/resultados/digitacao?exame=${EXAME}`);
    await expect(page.getByTestId('digitacao-ficha')).toBeVisible();
    await page.getByTestId('digitacao-cultura').click();
    await expect(page.getByTestId('cultura-painel')).toBeVisible();

    await escolher(page.getByTestId('cultura-material'), { rotulo: 'SANGUE SINTETICO' });
    await page.getByTestId('cultura-incluir-isolado').click();
    await escolher(page.getByTestId('cultura-germe-1'), { rotulo: 'GERME SINTETICO' });
    // O painel padrão do germe entra na ordem do laudo: B antes de A.
    const linhas = page.locator('[data-testid^="cultura-teste-1-"]');
    await expect(linhas).toHaveCount(2);
    await expect(linhas.nth(0)).toContainText('DROGA SINTETICA B');
    await expect(linhas.nth(1)).toContainText('DROGA SINTETICA A');
    await page.getByTestId('cultura-medida-1-32').fill('1');
    await page.getByTestId('cultura-medida-1-31').fill('0,5');

    // A cultura final sem conclusão é recusada na hora; desmarcar devolve o botão.
    await page.getByTestId('cultura-final').check();
    await expect(page.getByTestId('cultura-recusa')).toBeVisible();
    await expect(page.getByTestId('cultura-gravar')).toBeDisabled();
    await page.getByTestId('cultura-final').uncheck();
    await expect(page.getByTestId('cultura-recusa')).toHaveCount(0);
    await semViolacaoAxe(page, '/sadt/resultados/digitacao (cultura)');

    await page.getByTestId('cultura-gravar').click();
    await expect(page.getByTestId('cultura-mensagem')).toContainText('1 isolado(s), 2 teste(s)');
    expect(corpos).toHaveLength(1);
    expect(corpos[0]).toMatchObject({
      material: 1,
      crescimento: 'com_crescimento',
      final: false,
      versao: null,
      isolados: [
        {
          sequencia: 1,
          microrganismo: 11,
          testes: [
            { antimicrobiano: 32, metodo: 'cim', cim: 1, halo: null },
            { antimicrobiano: 31, metodo: 'cim', cim: 0.5, halo: null },
          ],
        },
      ],
    });
    await expect(page.getByTestId('cultura-interpretacao-1-32')).toContainText(
      'Sensível aumentando a exposição',
    );
    await expect(page.getByTestId('cultura-interpretacao-1-31')).toContainText('Oculto (cascata)');
    await expect(page.getByTestId('cultura-laudo')).toContainText('SANGUE SINTETICO');
    expect(externas).toEqual([]);
  });

  test('no cadastro: painel na ordem escolhida, recusas na hora e o ponto que encerra a versão anterior; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    const paineis: unknown[] = [];
    const pontos: unknown[] = [];
    // A tela do catálogo não lê o cadastro da cultura (sadt.resultado.ler): quem só cuida do catálogo abre a tela.
    let leiturasDaCultura = 0;
    await page.route(/\/api\/sadt\/microbiologia\/cadastro$/, (r) => {
      leiturasDaCultura++;
      return json(r, cadastro);
    });
    await page.route(/\/api\/sadt\/microbiologia\/pontos-corte(\?.*)?$/, async (r) => {
      if (r.request().method() === 'POST') {
        pontos.push(r.request().postDataJSON());
        return json(r, { id: 63, encerrados: [61] });
      }
      return json(r, []);
    });
    await page.route(/\/api\/sadt\/microbiologia\/paineis$/, async (r) => {
      if (r.request().method() === 'GET') return json(r, cadastroDosPaineis);
      paineis.push(r.request().postDataJSON());
      return json(r, { id: 22, itens: 2, retirados: 0, padrao: false, padroesLimpos: 0 });
    });
    await page.route(/\/api\/sadt\/microbiologia\/paineis\/\d+$/, async (r) => {
      paineis.push(r.request().postDataJSON());
      return json(r, { id: 21, itens: 2, retirados: 0, padrao: false, padroesLimpos: 1 });
    });

    // O cadastro dos painéis pede sadt.catalogo.editar, que o SINT.BIOMEDICO não tem; SINT.LABORATORIO tem toda a área.
    await entrar(page, 'SINT.LABORATORIO');
    await page.goto('/sadt/microbiologia/cadastro');
    await expect(page.getByTestId('tela-antibiograma-cadastro')).toBeVisible();
    await expect(page.getByTestId('antibiograma-painel-21')).toContainText('PAINEL SINTETICO');
    await expect(page.getByTestId('antibiograma-situacao-21')).toContainText('Ativo');
    await expect(page.getByTestId('antibiograma-painel-23')).toContainText('PAINEL SINTETICO ANTIGO');
    await expect(page.getByTestId('antibiograma-situacao-23')).toContainText('Inativo');

    // Desativar o painel padrão: o aviso aparece na hora e a escolha do padrão some.
    await page.getByTestId('antibiograma-editar-21').click();
    await expect(page.getByTestId('painel-ativo')).toBeChecked();
    await expect(page.getByTestId('painel-padrao')).toBeChecked();
    await page.getByTestId('painel-ativo').uncheck();
    await expect(page.getByTestId('painel-inativo-aviso')).toBeVisible();
    await expect(page.getByTestId('painel-padrao')).toHaveCount(0);
    await page.getByTestId('painel-gravar').click();
    await expect(page.getByTestId('antibiograma-mensagem')).toContainText('Painel gravado.');
    await expect.poll(() => paineis.length).toBe(1);
    expect(paineis.shift()).toMatchObject({
      codigo: 'PS1',
      versao: 1,
      ativo: false,
      padraoDoMicrorganismo: false,
    });

    // O inativo continua no cadastro e volta a valer.
    await page.getByTestId('antibiograma-editar-23').click();
    await expect(page.getByTestId('painel-ativo')).not.toBeChecked();
    await page.getByTestId('painel-ativo').check();
    await page.getByTestId('painel-gravar').click();
    await expect(page.getByTestId('antibiograma-mensagem')).toContainText('Painel gravado.');
    await expect.poll(() => paineis.length).toBe(1);
    expect(paineis.shift()).toMatchObject({ codigo: 'PS0', versao: 4, ativo: true });

    await page.getByTestId('antibiograma-novo-painel').click();
    await page.getByTestId('painel-codigo').fill('PS2');
    await page.getByTestId('painel-descricao').fill('PAINEL SINTETICO DOIS');
    await escolher(page.getByTestId('painel-incluir-am'), { rotulo: 'DROGA SINTETICA A' });
    await escolher(page.getByTestId('painel-incluir-am'), { rotulo: 'DROGA SINTETICA C' });
    await page.getByTestId('painel-restrita-31').check();
    await page.getByTestId('painel-restrita-33').check();
    await expect(page.getByTestId('painel-recusa')).toBeVisible();
    await expect(page.getByTestId('painel-gravar')).toBeDisabled();
    await page.getByTestId('painel-restrita-33').uncheck();
    await page.getByTestId('painel-descer-31').click();
    await semViolacaoAxe(page, '/sadt/microbiologia/cadastro (painel)');
    await page.getByTestId('painel-gravar').click();
    await expect(page.getByTestId('antibiograma-mensagem')).toContainText('Painel gravado.');
    await expect.poll(() => paineis.length).toBe(1);
    expect(paineis[0]).toMatchObject({
      codigo: 'PS2',
      ativo: true,
      norma: 'BrCAST',
      itens: [
        { antimicrobiano: 33, liberacaoRestrita: false },
        { antimicrobiano: 31, liberacaoRestrita: true },
      ],
    });

    await escolher(page.getByTestId('ponto-germe'), { rotulo: 'GERME SINTETICO' });
    await escolher(page.getByTestId('ponto-am'), { rotulo: 'DROGA SINTETICA B' });
    await page.getByTestId('ponto-versao').fill('2027');
    await page.getByTestId('ponto-s').fill('8');
    await page.getByTestId('ponto-r').fill('2');
    await expect(page.getByTestId('ponto-recusa')).toContainText('resistente');
    await expect(page.getByTestId('ponto-gravar')).toBeDisabled();
    await page.getByTestId('ponto-s').fill('0,5');
    await page.getByTestId('ponto-inicio').fill('2027-01-01');
    await expect(page.getByTestId('ponto-recusa')).toHaveCount(0);
    await page.getByTestId('ponto-gravar').click();
    await expect(page.getByTestId('antibiograma-mensagem')).toContainText('1 ponto(s) da versão anterior');
    expect(pontos[0]).toMatchObject({
      microrganismo: 11,
      antimicrobiano: 32,
      metodo: 'concentracao_inibitoria',
      versaoNorma: '2027',
      sensivelAte: 0.5,
      resistenteAcima: 2,
      vigenciaInicio: '2027-01-01',
    });
    await semViolacaoAxe(page, '/sadt/microbiologia/cadastro (ponto)');
    expect(leiturasDaCultura).toBe(0);
    expect(externas).toEqual([]);
  });
});
