// E2E @C2-012 (F8, 04-CC linha 106): auditoria da profilaxia antimicrobiana cirúrgica pela tela da CCIH. As rotas
// `/api/cirurgia/profilaxia/*` só existem no banco do cliente (na fonte sintética respondem 503), então este E2E simula
// essas rotas com um estado em memória que segue a regra do servidor (a nova auditoria substitui a vigente, que fica
// no histórico; protocolo desativado fica na lista). O que fica no banco está no contrato de efeito
// apps/api/src/modulos/cirurgia/profilaxia-cirurgica-propria.int.spec.ts. Aqui se prova o fluxo: o painel por
// paciente com os indicadores, o filtro das não conformes, a auditoria com um clique (uma cirurgia ou todas as sem
// auditoria), a validação do protocolo na hora (90 minutos recusados para a cefazolina; 120 aceitos para a
// vancomicina) e o protocolo desativado na lista. Axe na tela. Massa SINTÉTICA.
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
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

const CRITERIOS_OK = {
  drogaAdequada: true,
  doseAdequada: true,
  viaAdequada: true,
  momentoAdequado: true,
  repiqueAdequado: true,
  duracaoAdequada: true,
};

function simular(page: Page) {
  const corpos: Record<string, unknown>[] = [];
  let seq = 900;
  const cirurgias = [
    { ato: 81, numero: 'CC-FIC-81', atendimento: 1, prontuario: '9001', paciente: 'PACIENTE FICTICIO A' },
    { ato: 82, numero: 'CC-FIC-82', atendimento: 2, prontuario: '9002', paciente: 'PACIENTE FICTICIO B' },
  ].map((c) => ({
    ...c,
    procedimento: 'PROCEDIMENTO FICTICIO',
    incisao: '2030-03-10T11:00:00.000Z',
    fim: '2030-03-10T13:00:00.000Z',
    auditoria: null as Record<string, unknown> | null,
  }));
  // O ato 82 tem a dose 90 minutos antes da incisão: não conforme.
  const resultado = (ato: number) =>
    ato === 81
      ? { situacao: 'conforme', motivos: [], ...CRITERIOS_OK }
      : {
          situacao: 'nao_conforme',
          motivos: ['dose-fora-da-janela'],
          ...CRITERIOS_OK,
          momentoAdequado: false,
        };
  const protocolos: Record<string, unknown>[] = [];
  const opcoes = {
    procedimentos: [{ id: 9, rotulo: 'P1 - PROCEDIMENTO FICTICIO' }],
    grupos: [{ id: 4, rotulo: 'GRUPO FICTICIO' }],
    classes: [{ id: 1, rotulo: 'LIMPA' }],
    antimicrobianos: [
      { id: 10, rotulo: 'CEFAZOLINA FICTICIA', janelaLonga: false },
      { id: 20, rotulo: 'VANCOMICINA FICTICIA', janelaLonga: true },
    ],
    unidades: [{ id: 5, rotulo: 'mg' }],
    vias: [{ id: 7, rotulo: 'ENDOVENOSA' }],
  };
  const painel = () => {
    const auds = cirurgias.flatMap((c) => (c.auditoria ? [c.auditoria] : []));
    const conformes = auds.filter((a) => a['situacao'] === 'conforme').length;
    const nao = auds.filter((a) => a['situacao'] === 'nao_conforme').length;
    return {
      de: '2030-03-03',
      ate: '2030-03-10',
      indicadores: {
        cirurgias: cirurgias.length,
        auditadas: auds.length,
        conformes,
        naoConformes: nao,
        momentoAdequado: auds.filter((a) => a['momentoAdequado'] === true).length,
        duracaoAdequada: auds.filter((a) => a['duracaoAdequada'] === true).length,
        percentualConforme: conformes + nao ? Math.round((conformes / (conformes + nao)) * 1000) / 10 : null,
      },
      cirurgias,
    };
  };
  return {
    corpos,
    async ligar() {
      await page.route(/\/api\/cirurgia\/profilaxia\/painel/, (rota) => json(rota, painel()));
      await page.route('**/api/cirurgia/profilaxia/atos/*/auditar', async (rota) => {
        const ato = Number(rota.request().url().split('/atos/')[1]!.split('/')[0]);
        const c = rota.request().postDataJSON() as Record<string, unknown>;
        corpos.push({ ato, ...c });
        const r = resultado(ato);
        const alvo = cirurgias.find((x) => x.ato === ato)!;
        alvo.auditoria = {
          id: ++seq,
          versao: 1,
          avaliavel: true,
          antimicrobiano: 'CEFAZOLINA FICTICIA',
          administradoEm: '2030-03-10T10:30:00.000Z',
          avaliadoEm: '2030-03-10T15:00:00.000Z',
          justificativa: (c['justificativa'] as string | null) ?? null,
          ...r,
        };
        return json(rota, { id: seq, ato, ...r });
      });
      await page.route('**/api/cirurgia/profilaxia/protocolos', async (rota) => {
        if (rota.request().method() === 'GET') return json(rota, { protocolos, opcoes });
        const c = rota.request().postDataJSON() as Record<string, unknown>;
        corpos.push(c);
        const am = opcoes.antimicrobianos.find((a) => a.id === c['antimicrobiano'])!;
        protocolos.push({
          id: 70 + protocolos.length,
          versao: 1,
          ativo: true,
          procedimento: c['procedimento'],
          procedimentoDescricao: c['procedimento'] ? 'PROCEDIMENTO FICTICIO' : null,
          grupo: c['grupo'],
          grupoDescricao: c['grupo'] ? 'GRUPO FICTICIO' : null,
          classeDescricao: null,
          antimicrobiano: am.id,
          antimicrobianoDescricao: am.rotulo,
          dose: c['dose'],
          dosePorKg: c['dosePorKg'],
          unidadeSigla: 'mg',
          viaDescricao: null,
          janelaMaxima: (c['antesMaximo'] as number | null) ?? (am.janelaLonga ? 120 : 60),
          intervaloRepiqueHoras: c['intervaloRepiqueHoras'],
          duracaoMaximaHoras: c['duracaoMaximaHoras'],
          alternativaAlergia: c['alternativaAlergia'],
          ordem: c['ordem'],
          vigenciaInicio: c['vigenciaInicio'],
          vigenciaFim: null,
        });
        return json(rota, { id: 70 + protocolos.length - 1 });
      });
      await page.route('**/api/cirurgia/profilaxia/protocolos/*/ativo', async (rota) => {
        const id = Number(rota.request().url().split('/protocolos/')[1]!.split('/')[0]);
        const c = rota.request().postDataJSON() as { versao: number; ativo: boolean };
        corpos.push(c);
        const p = protocolos.find((x) => x['id'] === id)!;
        if (p['versao'] !== c.versao) return json(rota, { status: 409, title: 'Versão' }, 409);
        p['ativo'] = c.ativo;
        p['versao'] = c.versao + 1;
        return json(rota, { id });
      });
    },
  };
}

test.describe('@C2-012 profilaxia antimicrobiana cirúrgica', () => {
  test('a CCIH audita as cirurgias do período e mantém o protocolo com a validação na hora', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    const api = simular(page);
    await api.ligar();
    await entrar(page, 'SINT.CCIH');

    await page.goto('/cirurgia/profilaxia');
    await expect(page.getByTestId('profilaxia-cirurgica')).toBeVisible();
    await expect(page.getByTestId('profilaxia-indicadores')).toContainText('2 cirurgia(s)');
    await expect(page.getByTestId('profilaxia-ato-81')).toHaveAttribute('data-situacao', 'sem');
    await expect(page.getByTestId('profilaxia-ato-81')).toContainText('PACIENTE FICTICIO A');

    // Um clique audita a cirurgia, com o parecer da comissão.
    await page
      .getByTestId('profilaxia-justificativa')
      .locator('input, textarea')
      .first()
      .fill('Parecer fictício');
    await page.getByTestId('profilaxia-auditar-81').click();
    await expect(page.getByTestId('profilaxia-mensagem')).toContainText('Conforme');
    expect(api.corpos[0]).toEqual({ ato: 81, justificativa: 'Parecer fictício' });
    await expect(page.getByTestId('profilaxia-ato-81')).toHaveAttribute('data-situacao', 'conforme');

    // As que faltam, todas de uma vez; o painel mostra a não conforme e o critério que falhou.
    await page.getByTestId('profilaxia-auditar-todas').click();
    await expect(page.getByTestId('profilaxia-ato-82')).toHaveAttribute('data-situacao', 'nao_conforme');
    await expect(page.getByTestId('profilaxia-momentoAdequado-82')).toContainText('inadequado');
    await expect(page.getByTestId('profilaxia-indicadores')).toContainText('conformidade 50%');
    await escolher(page.getByTestId('profilaxia-filtro'), 'nao_conforme');
    await expect(page.getByTestId('profilaxia-ato-81')).toHaveCount(0);
    await expect(page.getByTestId('profilaxia-ato-82')).toBeVisible();
    await semViolacaoAxe(page, '/cirurgia/profilaxia');

    // Protocolo: 90 minutos para a cefazolina é recusado na hora; 120 para a vancomicina é aceito.
    await page.getByTestId('profilaxia-aba-protocolos').click();
    await escolher(page.getByTestId('protocolo-procedimento'), '9');
    await escolher(page.getByTestId('protocolo-antimicrobiano'), '10');
    await page.getByTestId('protocolo-dose').locator('input').fill('2000');
    await escolher(page.getByTestId('protocolo-unidade'), '5');
    await page.getByTestId('protocolo-janela').locator('input').fill('90');
    await expect(page.getByTestId('protocolo-problema').first()).toContainText('60 minutos');
    await expect(page.getByTestId('protocolo-gravar')).toBeDisabled();
    await escolher(page.getByTestId('protocolo-antimicrobiano'), '20');
    await expect(page.getByTestId('protocolo-dica-janela')).toContainText('120');
    await page.getByTestId('protocolo-janela').locator('input').fill('120');
    await page.getByTestId('protocolo-dose').locator('input').fill('15');
    await page.getByTestId('protocolo-porkg').check();
    await expect(page.getByTestId('protocolo-problema')).toHaveCount(0);
    await page.getByTestId('protocolo-gravar').click();
    await expect(page.getByTestId('profilaxia-protocolo-70')).toContainText('VANCOMICINA FICTICIA');
    expect(api.corpos.at(-1)).toMatchObject({
      procedimento: 9,
      antimicrobiano: 20,
      dose: 15,
      dosePorKg: true,
      antesMaximo: 120,
      duracaoMaximaHoras: 24,
    });

    // Desativar: o protocolo fica na lista, inativo, pela versão.
    await page.getByTestId('profilaxia-protocolo-alternar-70').click();
    await expect(page.getByTestId('profilaxia-protocolo-70')).toHaveAttribute('data-ativo', 'false');
    expect(api.corpos.at(-1)).toEqual({ versao: 1, ativo: false });
    await semViolacaoAxe(page, '/cirurgia/profilaxia');
    expect(externas).toEqual([]);
  });
});
