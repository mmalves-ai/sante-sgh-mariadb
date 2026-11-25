// E2E @C2-102 (F8, 08-SGO L115): promoção da saúde e gestão de crônicos pela tela /operadora/programas-saude, aberta
// pelo atalho da tela de beneficiários (RN ANS 264 e 265/2011). A equipe da operadora cadastra o programa (a falta do
// número do registro na ANS aparece na hora), inclui o critério de idade, inclui o elegível num clique com o motivo,
// agenda o contato, aplica a avaliação de risco e vê o risco na lista, abre a visão por beneficiário, dá baixa na
// agenda e confere a adesão que dá direito à bonificação. As rotas /api/operadora/programas-saude exigem o banco
// próprio e o E2E roda com a fonte sintética: as respostas são simuladas pelo Playwright com massa SINTÉTICA. O efeito
// no banco está em apps/api/src/modulos/operadora/programa-saude-propria.int.spec.ts.
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

const criterioIdade = {
  id: 11,
  versao: 1,
  tipo: 'idade',
  termo: null,
  grupoPatologia: null,
  ocorrenciasMinimas: null,
  periodoMeses: null,
  idadeMinima: 18,
  idadeMaxima: null,
  custoMensalMinimo: null,
  custoPeriodoMinimo: null,
  escoreMinimo: null,
  formaAlerta: 'sugerir',
  ativo: true,
};

test.describe('Promoção da saúde e gestão de crônicos @C2-102 @fase8', () => {
  test.setTimeout(180_000);
  test('programa, critério, elegível incluído, contato, avaliação de risco, agenda e bonificação; axe', async ({
    page,
  }) => {
    const pedidos: { caminho: string; corpo: Record<string, unknown> }[] = [];
    let programas: Record<string, unknown>[] = [];
    let participante = {
      id: 31,
      versao: 1,
      programa: 7,
      programaNome: 'CUIDADO SINTETICO',
      beneficiario: 501,
      matricula: '0000000000000501',
      nome: 'BENEFICIARIO SINTETICO',
      grupoRisco: null,
      grupoRiscoDescricao: null,
      entrada: '2026-11-25',
      saida: null,
      motivoSaida: null,
      situacao: 'ativo',
      ultimaClassificacao: null as string | null,
      proximoContato: null as string | null,
    };
    const contato = {
      id: 41,
      versao: 1,
      participante: 31,
      nome: 'BENEFICIARIO SINTETICO',
      programaNome: 'CUIDADO SINTETICO',
      tipo: 'visita_domiciliar',
      agendadoPara: '2099-01-10T09:00:00',
      realizadoEm: null,
      situacao: 'agendado',
      resultado: null,
      proximoContato: null,
    };
    await page.route('**/api/operadora/programas-saude**', async (r) => {
      const u = new URL(r.request().url());
      const caminho = u.pathname.replace('/api/operadora/programas-saude', '');
      if (r.request().method() === 'POST') {
        const corpo = r.request().postDataJSON() as Record<string, unknown>;
        pedidos.push({ caminho, corpo });
        if (caminho === '') {
          programas = [
            {
              id: 7,
              versao: 1,
              codigo: 'DIAB',
              nome: 'CUIDADO SINTETICO',
              tipo: 'gestao_cronicos',
              objetivo: null,
              publicoAlvo: null,
              metas: null,
              grupoRisco: null,
              grupoRiscoDescricao: null,
              registradoAns: true,
              numeroRegistroAns: 'RA-SINT-1',
              isentaCoparticipacao: false,
              vigenciaInicio: '2026-01-01',
              vigenciaFim: null,
              situacao: 'ativo',
              participantesAtivos: 0,
              criterios: [],
              bonificacoes: [],
            },
          ];
          return json(r, { id: 7, versao: 1 }, 201);
        }
        if (caminho === '/7/criterios') {
          programas = [{ ...programas[0], criterios: [criterioIdade] }];
          return json(r, { id: 11, versao: 1 }, 201);
        }
        if (caminho === '/7/participantes') return json(r, { id: 31, versao: 1 }, 201);
        if (caminho === '/participantes/31/contatos') {
          participante = { ...participante, proximoContato: '2099-01-10T09:00:00' };
          return json(r, { id: 41, versao: 1 }, 201);
        }
        if (caminho === '/participantes/31/avaliacoes') {
          participante = { ...participante, ultimaClassificacao: 'muito_alto' };
          return json(r, { id: 51, versao: 1, escore: 4, maximo: 4, classificacao: 'muito_alto' }, 201);
        }
        if (caminho === '/contatos/41/baixa') return json(r, { id: 41, versao: 2 });
        return json(r, { id: 1, versao: 1 }, 201);
      }
      if (caminho === '') return json(r, programas);
      if (caminho === '/grupos-risco') return json(r, []);
      if (caminho === '/7/elegiveis')
        return json(
          r,
          pedidos.some((p) => p.caminho === '/7/participantes')
            ? []
            : [
                {
                  beneficiario: 501,
                  matricula: '0000000000000501',
                  nome: 'BENEFICIARIO SINTETICO',
                  idade: 46,
                  motivos: ['idade 46 anos'],
                  forma: 'sugerir',
                },
              ],
        );
      if (caminho === '/7/participantes') return json(r, [participante]);
      if (caminho === '/questionarios')
        return json(r, [
          {
            id: 61,
            codigo: 'RISCO',
            nome: 'RISCO SINTETICO',
            numeroVersao: 1,
            exigeTodas: false,
            perguntas: [
              {
                id: 71,
                sequencia: 1,
                enunciado: 'Fuma?',
                tipoResposta: 'sim_nao',
                obrigatoria: true,
                opcoes: [],
                respostaIndicativa: 'sim',
              },
            ],
          },
        ]);
      if (caminho === '/beneficiarios/501')
        return json(r, {
          participacoes: [participante],
          contatos: [contato],
          avaliacoes: [
            {
              id: 51,
              participante: 31,
              aplicadoEm: '2026-11-25T10:00:00',
              escore: 4,
              classificacao: 'muito_alto',
              questionario: 'RISCO SINTETICO',
            },
          ],
        });
      if (caminho === '/agenda')
        return json(r, {
          atrasados: [],
          hoje: [],
          proximos: pedidos.some((p) => p.caminho === '/contatos/41/baixa') ? [] : [contato],
        });
      if (caminho === '/7/custo')
        return json(r, {
          participantes: [
            {
              participante: 31,
              nome: 'BENEFICIARIO SINTETICO',
              matricula: '0000000000000501',
              entrada: '2026-11-25',
              situacao: 'ativo',
              antes: { total: 6000, meses: 12, media: 500 },
              depois: { total: 400, meses: 1, media: 400 },
              variacaoPercentual: -20,
            },
          ],
          antes: 500,
          depois: 400,
          variacaoPercentual: -20,
          janela: 12,
        });
      if (caminho === '/7/bonificacao')
        return json(r, [
          {
            participante: 31,
            nome: 'BENEFICIARIO SINTETICO',
            matricula: '0000000000000501',
            adesao: { realizados: 1, devidos: 1, percentual: 100 },
            bonificacoes: [
              { codigo: 'DESC5', descricao: 'Desconto sintético', direito: true, motivo: 'adesão de 100%' },
            ],
          },
        ]);
      return json(r, []);
    });

    await entrar(page, 'SINT.OPERADORA');
    await page.goto('/operadora/beneficiarios');
    await page.getByTestId('link-programas-saude').click();
    await expect(page).toHaveURL(/\/operadora\/programas-saude/);
    await expect(page.getByTestId('tela-programas-saude')).toBeVisible();

    // Programa: a falta do número do registro na ANS aparece na hora.
    await page.getByTestId('programa-novo').click();
    await page.getByTestId('prog-codigo').locator('input').fill('DIAB');
    await page.getByTestId('prog-nome').locator('input').fill('Cuidado sintético');
    await escolher(page.getByTestId('prog-registrado'), { rotulo: 'Sim' });
    await expect(page.getByTestId('prog-falta')).toContainText('registro na ANS');
    await page.getByTestId('prog-registro').locator('input').fill('RA-SINT-1');
    await expect(page.getByTestId('prog-falta')).toHaveCount(0);
    await page.getByTestId('prog-salvar').click();
    await expect(page.getByTestId('programas-aviso')).toContainText('Programa cadastrado');

    // Critério de idade (recorte do público).
    await expect(page.getByTestId('painel-criterios')).toBeVisible();
    await escolher(page.getByTestId('crit-tipo'), { rotulo: /Faixa de idade/ });
    await expect(page.getByTestId('crit-falta')).toContainText('idade');
    await page.getByTestId('crit-idade-min').locator('input').fill('18');
    await page.getByTestId('crit-salvar').click();
    await expect(page.getByTestId('criterio-11')).toContainText('a partir de 18 anos');

    // Elegível incluído num clique, com o motivo.
    await page.getByTestId('aba-elegiveis').click();
    await expect(page.getByTestId('elegivel-501')).toContainText('idade 46 anos');
    await page.getByTestId('elegivel-incluir-501').click();
    await expect(page.getByTestId('programas-aviso')).toContainText('incluído no programa');

    // Contato agendado e avaliação de risco.
    await page.getByTestId('aba-participantes').click();
    await page.getByTestId('participante-contato-31').click();
    await escolher(page.getByTestId('contato-tipo'), { rotulo: 'Visita domiciliar' });
    await page.getByTestId('contato-quando').locator('input').fill('2020-01-10T09:00');
    await expect(page.getByTestId('contato-falta')).toContainText('a partir de hoje');
    await page.getByTestId('contato-quando').locator('input').fill('2099-01-10T09:00');
    await page.getByTestId('contato-salvar').click();
    await expect(page.getByTestId('programas-aviso')).toContainText('Contato agendado');
    await page.getByTestId('participante-avaliar-31').click();
    await expect(page.getByTestId('avaliacao-falta')).toContainText('pergunta 1');
    await escolher(page.getByTestId('avaliacao-p1'), { rotulo: 'Sim' });
    await page.getByTestId('avaliacao-salvar').click();
    await expect(page.getByTestId('programas-aviso')).toContainText('escore 4 de 4');
    await expect(page.getByTestId('participante-risco-31')).toContainText('Muito alto');

    // Visão por beneficiário.
    await page.getByTestId('participante-visao-31').click();
    await expect(page.getByTestId('visao-beneficiario')).toContainText('RISCO SINTETICO');

    // Agenda: baixa no lugar.
    await page.getByTestId('aba-agenda').click();
    await expect(page.getByTestId('agenda-proximos')).toContainText('BENEFICIARIO SINTETICO');
    await page.getByTestId('agenda-realizado-41').click();
    await expect(page.getByTestId('programas-aviso')).toContainText('Contato atualizado');
    await expect(page.getByTestId('agenda-item-41')).toHaveCount(0);

    // Custo do crônico e bonificação.
    await page.getByTestId('aba-resultado').click();
    await expect(page.getByTestId('custo-resumo')).toContainText('-20%');
    await expect(page.getByTestId('bonificacao-31')).toContainText('com direito');

    const caminhos = pedidos.map((p) => p.caminho);
    expect(caminhos).toEqual([
      '',
      '/7/criterios',
      '/7/participantes',
      '/participantes/31/contatos',
      '/participantes/31/avaliacoes',
      '/contatos/41/baixa',
    ]);
    expect(pedidos[0]!.corpo).toMatchObject({ registradoAns: true, numeroRegistroAns: 'RA-SINT-1' });
    expect(pedidos[1]!.corpo).toMatchObject({ tipo: 'idade', idadeMinima: 18 });
    expect(pedidos[2]!.corpo).toMatchObject({ beneficiario: 501 });
    expect(pedidos[3]!.corpo).toMatchObject({ situacao: 'agendado', agendadoPara: '2099-01-10T09:00' });
    expect(pedidos[4]!.corpo).toMatchObject({
      questionario: 61,
      respostas: [{ pergunta: 71, opcao: 'sim' }],
    });
    expect(pedidos[5]!.corpo).toMatchObject({ situacao: 'realizado' });
    await semViolacaoAxe(page, 'programas de saúde');
  });
});
