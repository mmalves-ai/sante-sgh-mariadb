// E2E @C2-019 (F3.4, 04-CC linha 96): descrição cirúrgica assinada e intercorrências do ato, pela tela. As rotas
// `/api/cirurgia/realizadas/:ato/descricao`, `/api/cirurgia/descricoes/:id/adendos`,
// `/api/cirurgia/realizadas/:ato/intercorrencias` e `/api/cirurgia/pacientes/:paciente/descricoes` só existem no banco
// do cliente, então este E2E as simula com um estado em memória que segue a regra do servidor (salvar e assinar num
// gesto, com a senha; assinada vira retificada com o adendo; a grave abre a notificação de evento adverso). O que fica
// no banco (descrição, achados, adendo, intercorrência ligada à notificação na mesma transação) está no contrato de
// efeito apps/api/src/modulos/cirurgia/descricao-cirurgica.int.spec.ts. Aqui se prova o fluxo: o texto padrão entra com
// um clique, o que falta para assinar aparece na hora, assinar pede a senha, o adendo entra com motivo e senha, a
// intercorrência grave avisa e mostra o protocolo, e a visão por paciente lista o ato. Axe. Massa SINTÉTICA.
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const ATO = 9019;
const PACIENTE = 77019;
const EU = 501;

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
const ok = (mensagem: string, resultado: Record<string, unknown>) => ({
  ok: true,
  resultado,
  repetida: false,
  mensagem,
});

function simular(page: Page) {
  const corpos: Record<string, unknown>[] = [];
  type Desc = Record<string, unknown> & { adendos: Record<string, unknown>[]; situacao: string };
  let desc: Desc | null = null;
  const ints: Record<string, unknown>[] = [];
  const tela = () => ({
    ato: {
      id: ATO,
      numero: 'ATO-FICTICIO-1',
      paciente: PACIENTE,
      pacienteNome: 'PACIENTE SINTETICO',
      sala: 'SALA FICTICIA',
      entrada: '2026-11-25 08:00',
      saida: '2026-11-25 10:00',
    },
    eu: { profissional: EU, naEquipe: true, descreve: true },
    equipe: [
      { profissional: EU, nome: 'CIRURGIAO SINTETICO', funcao: 'Cirurgião', descreve: true },
      { profissional: 502, nome: 'ANESTESISTA SINTETICO', funcao: 'Anestesista', descreve: false },
    ],
    descricoes: desc ? [desc] : [],
    intercorrencias: ints,
    catalogos: {
      achados: [{ id: 31, rotulo: 'ACHADO FICTICIO', textoSugerido: null }],
      tipos: [
        { id: 41, rotulo: 'SANGRAMENTO FICTICIO', exigeConduta: true, eventoAdverso: false, gravidade: null },
      ],
    },
  });
  return {
    corpos,
    async ligar() {
      await page.route(`**/api/cirurgia/realizadas/${ATO}/descricao`, async (rota) => {
        if (rota.request().method() === 'GET') return json(rota, tela());
        const b = rota.request().postDataJSON() as Record<string, unknown>;
        corpos.push(b);
        if (b['assinar'] === true && b['senha'] !== SENHA)
          return json(
            rota,
            {
              type: 'about:blank',
              title: 'Confirme a senha',
              status: 401,
              codigo: 'reautenticacao-necessaria',
            },
            401,
          );
        desc = {
          id: 801,
          cirurgiao: EU,
          cirurgiaoNome: 'CIRURGIAO SINTETICO',
          situacao: b['assinar'] ? 'assinada' : 'rascunho',
          versao: desc ? Number(desc['versao']) + 1 : 1,
          descricaoTecnica: b['descricaoTecnica'] as string,
          achadosTexto: null,
          riscoCirurgico: (b['riscoCirurgico'] as string | null) ?? null,
          acidentes: null,
          orteseProtese: null,
          atoAnestesico: null,
          sangramentoMl: (b['sangramentoMl'] as number | null) ?? null,
          envioAnatomopatologico: false,
          descricaoPecas: null,
          assinadaEm: b['assinar'] ? '2026-11-25 10:30' : null,
          assinatura: b['assinar']
            ? { nivel: 'eletronica-avancada', documento: 901, envelope: null }
            : { nivel: null, documento: null, envelope: null },
          achados: ((b['achados'] as { achado: number }[]) ?? []).map((a) => ({
            achado: a.achado,
            rotulo: 'ACHADO FICTICIO',
            complemento: null,
          })),
          adendos: [],
        };
        return json(rota, ok(b['assinar'] ? 'Descrição assinada.' : 'Rascunho salvo.', { descricao: 801 }));
      });
      await page.route('**/api/cirurgia/descricoes/801/adendos', async (rota) => {
        const b = rota.request().postDataJSON() as Record<string, unknown>;
        corpos.push(b);
        desc!.adendos.push({
          sequencia: desc!.adendos.length + 1,
          texto: b['texto'],
          motivo: b['motivo'],
          registradoEm: '2026-11-25 11:00',
        });
        desc!.situacao = 'retificada';
        return json(rota, ok('Adendo registrado.', { adendo: 1, descricao: 801 }), 201);
      });
      await page.route(`**/api/cirurgia/realizadas/${ATO}/intercorrencias`, async (rota) => {
        const b = rota.request().postDataJSON() as Record<string, unknown>;
        corpos.push(b);
        const grave = b['gravidade'] === 'grave' || b['gravidade'] === 'obito';
        ints.push({
          sequencia: ints.length + 1,
          tipo: 'SANGRAMENTO FICTICIO',
          ocorridoEm: String(b['ocorridoEm']),
          fase: b['fase'],
          gravidade: b['gravidade'],
          descricao: b['descricao'],
          conduta: b['conduta'],
          registradoPor: 'CIRURGIAO SINTETICO',
          notificacao: grave ? 'NSP-2026-000001' : null,
        });
        return json(
          rota,
          ok('Intercorrência registrada.', {
            intercorrencia: ints.length,
            pedeNotificacao: grave,
            notificacao: grave ? 1 : null,
            protocoloNotificacao: grave ? 'NSP-2026-000001' : null,
          }),
          201,
        );
      });
      await page.route(`**/api/cirurgia/pacientes/${PACIENTE}/descricoes`, (rota) =>
        json(rota, [
          {
            ato: ATO,
            numero: 'ATO-FICTICIO-1',
            inicio: '2026-11-25 08:10',
            cirurgiao: 'CIRURGIAO SINTETICO',
            situacao: desc?.situacao ?? 'rascunho',
            assinadaEm: null,
            adendos: desc?.adendos.length ?? 0,
            intercorrencias: ints.length,
          },
        ]),
      );
      await page.route('**/api/cirurgia/textos-padrao/descricao*', (rota) =>
        json(rota, {
          itens: [
            {
              id: 61,
              titulo: 'TEXTO FICTICIO',
              procedimento: null,
              cirurgiao: EU,
              textoDescricao:
                'Incisão mediana, dissecção por planos, hemostasia e síntese por planos sem intercorrência.',
              textoRisco: 'Risco habitual.',
              textoIntercorrencia: null,
              ativo: true,
              versao: 1,
              procedimentoDescricao: null,
              cirurgiaoNome: 'CIRURGIAO SINTETICO',
              campos: [],
            },
          ],
        }),
      );
    },
  };
}

test.describe('@C2-019 descrição cirúrgica assinada e intercorrências', () => {
  test('texto padrão em um clique, assinar com senha, adendo, intercorrência grave com notificação e visão por paciente; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    const sim = simular(page);
    await sim.ligar();
    await entrar(page, 'SINT.ADMIN');
    await page.goto(`/cirurgia/descricao/${ATO}`);
    await expect(page.getByTestId('tela-descricao-cirurgica')).toBeVisible();
    await expect(page.getByTestId('descricao-equipe')).toContainText('ANESTESISTA SINTETICO');

    // O que falta para assinar aparece na hora; o botão de assinar só acende com o conteúdo e a senha.
    await expect(page.getByTestId('descricao-pendencias')).toBeVisible();
    await expect(page.getByTestId('descricao-assinar')).toBeDisabled();
    await escolher(page.getByTestId('descricao-texto-padrao'), '61');
    await page.getByTestId('descricao-usar-texto').click();
    await expect(page.getByTestId('descricao-tecnica')).toHaveValue(/Incisão mediana/);
    await expect(page.getByTestId('descricao-risco')).toHaveValue('Risco habitual.');
    await expect(page.getByTestId('descricao-pendencias')).toHaveCount(0);
    await page.getByTestId('descricao-achado-31').check();
    await page.getByTestId('descricao-sangramento').fill('150');
    await page.getByTestId('descricao-salvar').click();
    await expect(page.getByTestId('descricao-aviso')).toHaveText('Rascunho salvo.');
    await expect(page.getByTestId('descricao-assinar')).toBeDisabled();
    await page.getByTestId('descricao-senha').fill(SENHA);
    await page.getByTestId('descricao-assinar').click();
    await expect(page.getByTestId('descricao-aviso')).toHaveText('Descrição assinada.');
    // Assinada: o formulário sai e a descrição fica só para leitura, com o adendo.
    await expect(page.getByTestId('descricao-form')).toHaveCount(0);
    // Assinatura eletrônica avançada com a senha; o cirurgião com certificado segue para a fila ICP-Brasil.
    await expect(page.getByTestId('descricao-nivel-801')).toContainText('eletrônica avançada');
    await expect(page.getByTestId('descricao-assinar-icp-801')).toHaveAttribute(
      'href',
      /\/pep\/assinaturas$/,
    );
    const assinou = sim.corpos.find((c) => c['assinar'] === true)!;
    expect(assinou).toMatchObject({
      assinar: true,
      sangramentoMl: 150,
      achados: [{ achado: 31, complemento: null }],
    });

    await page.getByTestId('adendo-texto').fill('Complemento sintético da técnica.');
    await page.getByTestId('adendo-motivo').fill('Correção sintética');
    await expect(page.getByTestId('adendo-incluir')).toBeDisabled();
    await page.getByTestId('adendo-senha').fill(SENHA);
    await page.getByTestId('adendo-incluir').click();
    await expect(page.getByTestId('descricao-adendos-801')).toContainText('Correção sintética');
    await expect(page.getByTestId('descricao-lida-801')).toContainText('Retificada');

    // Intercorrência: o tipo exige conduta e a grave avisa que abre a notificação; o protocolo volta na lista.
    await escolher(page.getByTestId('intercorrencia-tipo'), '41');
    await page.getByTestId('intercorrencia-quando').fill('2026-11-25T09:15');
    await escolher(page.getByTestId('intercorrencia-gravidade'), 'grave');
    await expect(page.getByTestId('intercorrencia-abre-notificacao')).toBeVisible();
    await expect(page.getByTestId('intercorrencia-registrar')).toBeDisabled();
    await page.getByTestId('intercorrencia-descricao').fill('Sangramento sintético.');
    await page.getByTestId('intercorrencia-conduta').fill('Conduta sintética.');
    await page.getByTestId('intercorrencia-registrar').click();
    await expect(page.getByTestId('descricao-aviso')).toContainText('NSP-2026-000001');
    await expect(page.getByTestId('intercorrencia-notificacao-1')).toContainText('NSP-2026-000001');
    expect(sim.corpos.at(-1)).toMatchObject({ tipo: 41, ocorridoEm: '2026-11-25 09:15', gravidade: 'grave' });

    await expect(page.getByTestId('descricoes-do-paciente')).toContainText('ATO-FICTICIO-1');
    // A senha nunca aparece no que a tela guarda nem na lista: segue só no corpo do pedido.
    await expect(page.getByTestId('descricao-senha')).toHaveCount(0);
    await semViolacaoAxe(page, 'descrição cirúrgica');
    expect(externas).toEqual([]);
  });
});
