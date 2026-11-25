// E2E @C2-071 (F7, 05-SADT linha 18): laudos estruturados de mamografia e de anatomia patológica. As rotas
// `/api/sadt/laudos-especializados/*` só existem no banco do cliente (na fonte sintética respondem 503), então este E2E
// simula essas rotas com um estado em memória que segue a regra do servidor (versão a cada gravação; liberado não muda
// mais). O que fica no banco está no contrato de efeito
// apps/api/src/modulos/sadt/laudo-mama-patologia-propria.int.spec.ts. Aqui se prova o fluxo pela tela, entrando pelo
// menu (Diagnóstico > Mamografia e anatomia patológica):
//   - a fila da mamografia por paciente; abrir o rascunho com um achado 4B na mama direita;
//   - a validação na hora: categoria final da direita menos grave que o achado bloqueia "Salvar";
//   - a recomendação sugerida pela categoria mais grave ("Usar a sugestão") e "Salvar e liberar" num clique, que
//     grava e libera; liberado, a tela fica só leitura;
//   - a peça enviada pela cirurgia recebida no único pedido de anatomia patológica da paciente (já escolhido);
//   - as fichas do resultado de mamografia do SISCAN no período.
// Axe em cada aba. Massa SINTÉTICA.
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

const lista = (l: string[]) => l.map((id) => ({ id, rotulo: id }));
const HOJE = new Date().toISOString().slice(0, 10);
const EXAME = {
  item: 501,
  numero: 'REQ-SINT-501',
  solicitadoEm: `${HOJE}T08:00:00.000Z`,
  urgente: false,
  situacaoItem: 'em_execucao',
  paciente: 'PACIENTE FICTICIA C2071',
  pacienteId: 9001,
  prontuario: 'PR-SINT-9001',
  exame: 'Mamografia bilateral sintética',
  setor: 'Imagem sintética',
};
const OPCOES_MAMA = {
  profissionais: [{ id: 11, rotulo: 'LAUDADOR FICTICIO' }],
  categorias: [
    { categoria: '0', rotulo: 'Inconclusivo' },
    { categoria: '1', rotulo: 'Negativo' },
    { categoria: '2', rotulo: 'Achado benigno' },
    { categoria: '3', rotulo: 'Provavelmente benigno' },
    { categoria: '4B', rotulo: 'Suspeita intermediária' },
    { categoria: '5', rotulo: 'Altamente sugestivo' },
  ],
  tipos: lista(['rastreamento', 'diagnostica']),
  composicoes: lista(['adiposa', 'fibroglandular_esparsa', 'heterogeneamente_densa', 'densa']),
  recomendacoes: lista(['rotina', 'controle_radiologico', 'complementacao', 'biopsia', 'tratamento']),
  quadrantes: lista(['superior_lateral', 'superior_medial', 'inferior_lateral', 'inferior_medial']),
  tiposAchado: lista(['nodulo', 'calcificacao', 'assimetria']),
  formas: lista(['oval', 'redonda', 'irregular']),
  contornos: lista(['circunscrito', 'espiculado']),
  densidades: lista(['alta', 'igual', 'baixa']),
  distribuicoes: lista(['difusa', 'agrupada']),
};
const ACHADO = {
  id: 71,
  sequencia: 1,
  lateralidade: 'direita',
  quadrante: 'superior_lateral',
  tipo: 'nodulo',
  categoria: '4B',
  tamanhoMm: 12,
  posicaoHoraria: 10,
  distanciaMamiloMm: null,
  forma: 'irregular',
  contorno: 'espiculado',
  densidade: null,
  morfologiaCalcificacao: null,
  distribuicaoCalcificacao: null,
  correlacaoUltrassom: false,
  descricao: null,
};

/** Estado em memória das rotas simuladas, com os corpos recebidos para conferência. */
function simular(page: Page) {
  const corpos: { rota: string; corpo: Record<string, unknown> }[] = [];
  const laudo = {
    id: 301,
    versao: 1,
    situacao: 'rascunho',
    liberadoEm: null as string | null,
    tipoMamografia: 'diagnostica',
    noduloPalpavel: false,
    historicoFamiliar: false,
    mamografiaAnterior: false,
    mamografiaAnteriorAno: null,
    composicaoDireita: 'fibroglandular_esparsa',
    composicaoEsquerda: 'fibroglandular_esparsa',
    categoriaDireita: '1' as string | null,
    categoriaEsquerda: '1' as string | null,
    recomendacao: 'rotina' as string | null,
    intervaloControleMeses: null as number | null,
    conclusao: 'Nódulo na mama direita (laudo sintético).',
    laudista: 11 as number | null,
  };
  let pecaRecebida = false;
  const P = '**/api/sadt/laudos-especializados';
  void page.route(`${P}/fila?*`, (r) =>
    json(r, {
      de: HOJE,
      ate: HOJE,
      tipo: 'mama',
      exames: [
        {
          ...EXAME,
          laudo: laudo.id,
          situacao: laudo.situacao,
          categoria: laudo.categoriaDireita,
          resultado: null,
          numeroLaudo: null,
        },
      ],
    }),
  );
  void page.route(`${P}/mama/itens/501`, async (r) => {
    if (r.request().method() === 'POST') {
      const c = r.request().postDataJSON() as Record<string, unknown>;
      corpos.push({ rota: 'salvar', corpo: c });
      if (laudo.situacao !== 'rascunho') return json(r, { title: 'laudo liberado' }, 409);
      Object.assign(laudo, {
        categoriaDireita: c['categoriaDireita'] ?? null,
        categoriaEsquerda: c['categoriaEsquerda'] ?? null,
        recomendacao: c['recomendacao'] ?? null,
        intervaloControleMeses: c['intervaloControleMeses'] ?? null,
        versao: laudo.versao + 1,
      });
      return json(r, { id: laudo.id, versao: laudo.versao });
    }
    return json(r, {
      exame: EXAME,
      laudo,
      achados: [ACHADO],
      achadosCorrigidos: 0,
      anteriores: [
        {
          id: 250,
          liberadoEm: '2025-03-10T12:00:00.000Z',
          categoriaDireita: '2',
          categoriaEsquerda: '1',
          recomendacao: 'rotina',
        },
      ],
      emExecucao: laudo.situacao === 'rascunho',
      alertas: [],
      opcoes: OPCOES_MAMA,
    });
  });
  void page.route(`${P}/mama/laudos/301/liberar`, (r) => {
    const c = r.request().postDataJSON() as Record<string, unknown>;
    corpos.push({ rota: 'liberar', corpo: c });
    if (c['versao'] !== laudo.versao) return json(r, { title: 'versão vencida' }, 409);
    Object.assign(laudo, {
      situacao: 'liberado',
      liberadoEm: new Date().toISOString(),
      versao: laudo.versao + 1,
    });
    return json(r, { id: laudo.id, versao: laudo.versao, alertas: [] });
  });
  void page.route(`${P}/pecas-enviadas?*`, (r) =>
    json(r, {
      de: HOJE,
      ate: HOJE,
      pecas: pecaRecebida
        ? []
        : [
            {
              descricao: 801,
              cirurgia: 'Setorectomia sintética',
              realizadaEm: `${HOJE}T10:00:00.000Z`,
              paciente: EXAME.paciente,
              prontuario: EXAME.prontuario,
              cirurgiao: 'CIRURGIAO FICTICIO',
              pecas: 'Segmento de mama direita',
              pedidos: [{ item: 601, numero: 'REQ-SINT-601', exame: 'Anatomopatológico de peça cirúrgica' }],
            },
          ],
    }),
  );
  void page.route(`${P}/pecas-enviadas/801/receber`, (r) => {
    corpos.push({ rota: 'receber', corpo: r.request().postDataJSON() as Record<string, unknown> });
    pecaRecebida = true;
    return json(r, { id: 401, numero: 'AP-SINT-0001', item: 601 });
  });
  void page.route(`${P}/siscan/mamografia?*`, (r) => {
    const lado = (categoria: string | null) => ({
      avaliada: true,
      composicao: 'fibroglandular_esparsa',
      categoria,
      nodulos: categoria === '4B' ? 1 : 0,
      microcalcificacoes: 0,
      assimetrias: 0,
      distorcaoArquitetural: false,
      linfonodoAxilar: false,
    });
    return json(r, {
      de: HOJE,
      ate: HOJE,
      fichas:
        laudo.situacao === 'liberado'
          ? [
              {
                laudo: laudo.id,
                paciente: EXAME.paciente,
                prontuario: EXAME.prontuario,
                indicacao: 'diagnostica',
                noduloPalpavel: false,
                riscoElevadoHistoricoFamiliar: false,
                mamografiaAnterior: false,
                mamografiaAnteriorAno: null,
                direita: lado(laudo.categoriaDireita),
                esquerda: lado(laudo.categoriaEsquerda),
                recomendacao: laudo.recomendacao,
                intervaloControleMeses: laudo.intervaloControleMeses,
                liberadoEm: laudo.liberadoEm,
              },
            ]
          : [],
    });
  });
  return { corpos, laudo };
}

test.describe('diagnóstico: laudos de mamografia e anatomia patológica @C2-071', () => {
  test.setTimeout(180_000);

  test('mamografia validada na hora, liberada num clique, peça recebida e ficha do SISCAN; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    const api = simular(page);
    await entrar(page, 'SINT.LAUDADOR');
    await page.goto('/sadt/laudos/especializados');
    await expect(page.getByTestId('laudo-mama-patologia')).toBeVisible();
    await semViolacaoAxe(page, '/sadt/laudos/especializados (fila)');

    // Fila por paciente e abertura do rascunho, com os laudos anteriores ao lado.
    await expect(page.getByTestId('lmp-item-501')).toContainText('PACIENTE FICTICIA C2071');
    await page.getByTestId('lmp-abrir-501').click();
    await expect(page.getByTestId('lmp-laudo-situacao')).toHaveAttribute('data-situacao', 'rascunho');
    await expect(page.getByTestId('lmp-anteriores')).toBeAttached();

    // Validação na hora: a mama direita tem achado 4B e a categoria final 1 é menos grave.
    await expect(page.getByTestId('lmp-problema').first()).toContainText('menos grave');
    await expect(page.getByTestId('lmp-salvar')).toBeDisabled();
    await escolher(page.getByTestId('lmp-mama-cat-d'), '4B');
    await expect(page.getByTestId('lmp-problema')).toHaveCount(0);
    await expect(page.getByTestId('lmp-salvar')).toBeEnabled();

    // A recomendação gravada (rotina) não bate com a categoria 4B: liberar fica travado até usar a sugestão.
    await expect(page.getByTestId('lmp-falta')).toBeVisible();
    await expect(page.getByTestId('lmp-liberar')).toBeDisabled();
    await expect(page.getByTestId('lmp-mama-sugestao')).toBeVisible();
    await page.getByTestId('lmp-mama-usar-sugestao').click();
    await expect(page.getByTestId('lmp-falta')).toHaveCount(0);
    await semViolacaoAxe(page, '/sadt/laudos/especializados (laudo de mama)');

    // Salvar e liberar num clique: grava (com a versão lida) e libera com a versão nova.
    await page.getByTestId('lmp-liberar').click();
    await expect(page.getByTestId('lmp-mensagem')).toBeVisible();
    const salvar = api.corpos.find((c) => c.rota === 'salvar')!;
    expect(salvar.corpo).toMatchObject({ versao: 1, categoriaDireita: '4B', recomendacao: 'biopsia' });
    expect(salvar.corpo['achados']).toHaveLength(1);
    expect(api.corpos.find((c) => c.rota === 'liberar')!.corpo).toEqual({ versao: 2 });
    await expect(page.getByTestId('lmp-laudo-situacao')).toHaveAttribute('data-situacao', 'liberado');
    await expect(page.getByTestId('lmp-liberado')).toBeVisible();
    await expect(page.getByTestId('lmp-salvar')).toHaveCount(0);

    // Peça enviada pela cirurgia: o único pedido já vem escolhido; receber abre o laudo anatomopatológico.
    await page.getByTestId('lmp-aba-pecas').click();
    await expect(page.getByTestId('lmp-peca-801')).toContainText('Setorectomia sintética');
    await semViolacaoAxe(page, '/sadt/laudos/especializados (peças da cirurgia)');
    await page.getByTestId('lmp-peca-receber-801').click();
    await expect(page.getByTestId('lmp-mensagem')).toContainText('AP-SINT-0001');
    expect(api.corpos.find((c) => c.rota === 'receber')!.corpo).toEqual({ item: 601 });
    await expect(page.getByTestId('lmp-peca-801')).toHaveCount(0);

    // SISCAN: a ficha do laudo liberado no período.
    await page.getByTestId('lmp-aba-siscan').click();
    await expect(page.getByTestId('lmp-siscan-301')).toContainText('PACIENTE FICTICIA C2071');
    await semViolacaoAxe(page, '/sadt/laudos/especializados (SISCAN)');
    expect(externas).toEqual([]);
  });
});
