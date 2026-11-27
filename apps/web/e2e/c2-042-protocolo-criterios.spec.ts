// E2E @C2-042 (F7, 03-PEP linha 134): protocolos gerenciados com os critérios de entrada avaliados pelo sistema e as
// etapas com meta de tempo, pela tela própria "Protocolos: critérios e metas", com a diretoria clínica:
//   - o alerta de elegível (paciente com aferição alterada) traz "Incluir no protocolo" com o horário zero sugerido
//     (quando o critério passou a ser atendido); a inclusão vai à rota do internado com a versão vigente e os códigos
//     de critério da versão, e as etapas com meta nascem na inclusão;
//   - nas etapas do paciente: conclui com a meta atingida, conclui a vencida só com justificativa (meta perdida) e
//     cancela a opcional com o motivo;
//   - na configuração: o campo do critério de sinal vital lista o catálogo parametro_vital ativo do cliente; aplica o
//     modelo de mercado; a validação na hora desliga os botões; inclui uma etapa com meta.
// Os protocolos gerenciados gravam só no banco próprio do cliente: na fonte sintética de dev/ci a API responde 501
// (pendente-modelo-proprio), o que o teste confere primeiro. Depois as rotas respondem de uma fonte sintética PRÓPRIA
// deste spec, em memória e reiniciada a cada execução (protocolo de sepse com modelo, paciente com aferição alterada,
// inclusão aberta), que segue o formato e as regras do servidor; nada é gravado num protocolo compartilhado. O efeito
// no MariaDB está em apps/api/src/modulos/enfermagem/protocolo-criterios-propria.int.spec.ts. axe sem violação séria.
import { expect, test, type Page, type Route } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';

async function entrar(page: Page, login: string): Promise<void> {
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

const B = '/api/enfermagem/protocolos-gerenciados';
const I = '/api/enfermagem/protocolos-internado';
const ATD = 25901;
const AGORA = '2026-11-26T10:30';
const DESDE = '2026-11-26T09:40';

type Etapa = {
  id: number;
  sequencia: number;
  nome: string;
  obrigatoria: boolean;
  metaMinutos: number | null;
  prazoMetaEm: string | null;
  concluidaEm: string | null;
  situacao: 'em_andamento' | 'meta_atingida' | 'meta_perdida' | 'cancelada';
  observacao: string | null;
  estado: string;
  minutosRestantes: number | null;
  versao: number;
};

/** A fonte sintética própria deste spec: estado em memória que segue as respostas do servidor. */
async function simular(page: Page, alvo: { id: number; nome: string }) {
  const json = (rota: Route, corpo: unknown, status = 200) =>
    rota.fulfill({ status, contentType: 'application/json', body: JSON.stringify(corpo) });
  const resumo = (id: number, nome: string, tipo: string, temModelo: boolean) => ({
    id,
    codigo: `P${id}`,
    nome,
    tipo,
    situacao: 'ativo',
    publico: 'adulto',
    formula: null,
    versao: 1,
    temModelo,
  });
  const protocolos = [
    resumo(alvo.id, alvo.nome, 'sepse', true),
    resumo(8, 'ROTINA SINTETICA SEM MODELO', 'outro', false),
  ];
  const etapasConfig: Record<string, unknown>[] = [];
  const novaEtapaConfig = (nome: string, tipo: string, metaMinutos: number | null, obrigatoria: boolean) =>
    etapasConfig.push({
      id: 100 + etapasConfig.length,
      sequencia: etapasConfig.length + 1,
      nome,
      tipo,
      metaMinutos,
      faixaEtaria: 'todas',
      obrigatoria,
      versao: 1,
    });
  const estado = {
    incluido: false,
    pedidoInclusao: null as Record<string, unknown> | null,
    etapas: [] as Etapa[],
  };
  const etapa = (
    id: number,
    sequencia: number,
    nome: string,
    obrigatoria: boolean,
    prazo: string,
    est: string,
    restantes: number | null,
  ): Etapa => ({
    id,
    sequencia,
    nome,
    obrigatoria,
    metaMinutos: 60,
    prazoMetaEm: prazo,
    concluidaEm: null,
    situacao: 'em_andamento',
    observacao: null,
    estado: est,
    minutosRestantes: restantes,
    versao: 1,
  });
  const alerta = {
    atendimento: ATD,
    paciente: 77001,
    protocolo: alvo.id,
    nome: alvo.nome,
    tipo: 'sepse',
    mensagem: 'Suspeita de sepse: avalie a inclusão.',
    criteriosAtendidos: ['Frequência cardíaca acima de 90', 'Temperatura acima de 38'],
    regraAvaliada: 'sinais',
    desde: DESDE,
    nomePaciente: 'PACIENTE SINTETICO C2042',
    numeroAtendimento: 'S-25901',
  };
  await page.route(`**${I}**`, async (rota) => {
    const req = rota.request();
    const url = new URL(req.url()).pathname;
    if (req.method() === 'GET' && url === `${I}/vigentes`)
      return json(rota, {
        vigentes: [
          {
            tipo: 'sepse',
            id: 31,
            versao: 2,
            nome: 'Sepse no internado',
            criterios: [
              { codigo: 'sirs', titulo: 'Dois ou mais sinais de resposta inflamatória' },
              { codigo: 'foco', titulo: 'Foco infeccioso suspeito' },
            ],
          },
        ],
      });
    if (req.method() === 'POST' && url === I) {
      estado.pedidoInclusao = req.postDataJSON() as Record<string, unknown>;
      estado.incluido = true;
      // As etapas com meta nascem na inclusão (a 2ª já vencida, a 3ª opcional).
      estado.etapas = [
        etapa(901, 1, 'Lactato sérico coletado', true, '2026-11-26T10:40', 'no_prazo', 10),
        etapa(902, 2, 'Hemoculturas antes do antimicrobiano', true, '2026-11-26T10:20', 'vencida', -10),
        etapa(903, 3, 'Reavaliação da volemia', false, '2026-11-26T10:50', 'no_prazo', 20),
      ];
      return json(
        rota,
        {
          ok: true,
          id: 501,
          reconhecidoEm: DESDE,
          mensagem: 'Paciente incluído no protocolo: o relógio começou às 09:40.',
        },
        201,
      );
    }
    return json(rota, { status: 404, title: 'Rota não simulada' }, 404);
  });
  await page.route(`**${B}**`, async (rota) => {
    const req = rota.request();
    const url = new URL(req.url()).pathname;
    if (req.method() === 'GET') {
      if (url === B) return json(rota, { itens: protocolos });
      if (url === `${B}/elegiveis`)
        return json(rota, { agora: AGORA, avaliados: 3, alertas: estado.incluido ? [] : [alerta] });
      if (url === `${B}/inclusoes`)
        return json(rota, {
          agora: AGORA,
          itens: estado.incluido
            ? [
                {
                  inclusao: 501,
                  atendimento: ATD,
                  numeroAtendimento: alerta.numeroAtendimento,
                  nomePaciente: alerta.nomePaciente,
                  protocolo: alvo.nome,
                  horarioZero: DESDE,
                  etapas: estado.etapas.length,
                  pendentes: estado.etapas.filter((e) => e.situacao === 'em_andamento').length,
                  vencidas: estado.etapas.filter((e) => e.estado === 'vencida').length,
                },
              ]
            : [],
        });
      if (url === `${B}/inclusoes/501/etapas`)
        return json(rota, {
          inclusao: 501,
          nomeProtocolo: alvo.nome,
          horarioZero: DESDE,
          etapas: estado.etapas,
          criterios: [],
          cumpridas: estado.etapas.filter((e) => e.situacao === 'meta_atingida').length,
          perdidas: estado.etapas.filter((e) => e.situacao === 'meta_perdida').length,
        });
      const id = Number(url.slice(B.length + 1));
      const p = protocolos.find((x) => x.id === id);
      if (!p) return json(rota, { status: 404, title: 'Protocolo' }, 404);
      return json(rota, {
        protocolo: p,
        criterios: [],
        etapas: p.id === alvo.id ? etapasConfig : [],
        formulaVigente: '',
        problemaFormula: null,
        sinaisVitais: [
          { codigo: 'freq_cardiaca', descricao: 'Frequência cardíaca' },
          { codigo: 'temperatura', descricao: 'Temperatura axilar' },
        ],
      });
    }
    const conclusao =
      /^\/api\/enfermagem\/protocolos-gerenciados\/etapas-paciente\/(\d+)\/(conclusao|cancelamento)$/.exec(
        url,
      );
    if (conclusao) {
      const e = estado.etapas.find((x) => x.id === Number(conclusao[1]));
      const c = req.postDataJSON() as { versao: number; justificativa?: string | null; motivo?: string };
      if (!e || e.versao !== c.versao) return json(rota, { status: 409, title: 'Colisão' }, 409);
      e.versao += 1;
      e.concluidaEm = AGORA;
      if (conclusao[2] === 'cancelamento') {
        e.situacao = 'cancelada';
        e.estado = 'cancelada';
        e.observacao = c.motivo ?? null;
        return json(rota, { ok: true, mensagem: 'Etapa cancelada.' });
      }
      if (e.estado === 'vencida' && !(c.justificativa ?? '').trim())
        return json(rota, { status: 422, title: 'Justifique a meta perdida' }, 422);
      e.situacao = e.estado === 'vencida' ? 'meta_perdida' : 'meta_atingida';
      e.estado = e.situacao === 'meta_perdida' ? 'perdida' : 'cumprida';
      e.observacao = c.justificativa ?? null;
      return json(rota, {
        ok: true,
        situacao: e.situacao,
        mensagem:
          e.situacao === 'meta_perdida' ? 'Etapa concluída fora da meta.' : 'Etapa concluída dentro da meta.',
      });
    }
    if (url === `${B}/${alvo.id}/modelo`) {
      const antes = etapasConfig.length;
      if (!etapasConfig.length) {
        novaEtapaConfig('Lactato sérico coletado', 'exame', 60, true);
        novaEtapaConfig('Hemoculturas antes do antimicrobiano', 'exame', 60, true);
        novaEtapaConfig('Antimicrobiano administrado', 'medicacao', 60, true);
      }
      const n = etapasConfig.length - antes;
      return json(rota, {
        ok: true,
        etapas: n,
        criterios: 0,
        mensagem: `Modelo aplicado: ${n} etapa(s) e 0 critério(s) incluídos.`,
      });
    }
    if (url === `${B}/${alvo.id}/etapas`) {
      const c = req.postDataJSON() as {
        nome: string;
        tipo: string;
        metaMinutos: number | null;
        obrigatoria: boolean;
      };
      novaEtapaConfig(c.nome, c.tipo, c.metaMinutos, c.obrigatoria);
      return json(rota, { ok: true, mensagem: 'Etapa incluída: vale para as próximas inclusões.' });
    }
    return json(rota, { status: 404, title: 'Rota não simulada' }, 404);
  });
  return estado;
}

test.describe('@C2-042 protocolos gerenciados: critérios e metas', () => {
  test.setTimeout(180_000);

  test('inclui do alerta com o horário zero sugerido, conclui e cancela etapas e configura', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.DIRETOR.CLINICO');

    // Sem o banco do cliente, a API recusa com o código próprio, sem inventar lista.
    const real = await page.request.get(B);
    expect(real.status(), await real.text()).toBe(501);
    expect(((await real.json()) as { codigo: string }).codigo).toBe('pendente-modelo-proprio');

    const alvo = { id: 7, nome: 'SEPSE SINTETICA ADULTO' };
    const estado = await simular(page, alvo);

    await page.goto('/enfermagem/protocolos-criterios');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Protocolos gerenciados');

    // Alerta de elegível → inclusão com o horário zero sugerido.
    await expect(page.getByTestId('pc-elegiveis')).toContainText('PACIENTE SINTETICO C2042');
    await page.getByTestId(`pc-incluir-${ATD}`).click();
    await expect(page.getByTestId(`pc-horario-zero-${ATD}`)).toHaveValue(DESDE);
    await semViolacaoAxe(page, '/enfermagem/protocolos-criterios (inclusão do alerta)');
    await page.getByTestId(`pc-confirmar-${ATD}`).click();
    await expect(page.getByTestId('pc-mensagem')).toContainText('Paciente incluído no protocolo');
    expect(estado.pedidoInclusao).toEqual({
      atendimento: ATD,
      tipo: 'sepse',
      versao: 31,
      origem: 'suspeita',
      reconhecidoEm: DESDE,
      criterios: ['sirs', 'foco'],
    });
    await expect(page.getByTestId('pc-sem-elegiveis')).toBeVisible();

    // Etapas já nascidas na inclusão.
    await page.getByTestId('pc-ver-501').click();
    await expect(page.getByTestId('pc-etapas')).toContainText(alvo.nome);
    await expect(page.getByTestId('pc-iniciar')).toHaveCount(0);

    // Meta atingida.
    await page.getByTestId('pc-concluir-1').click();
    await expect(page.getByTestId('pc-mensagem')).toContainText('dentro da meta');
    await expect(page.getByTestId('pc-concluir-1')).toHaveCount(0);

    // Meta perdida: só com justificativa de 10 caracteres ou mais.
    await expect(page.getByTestId('pc-concluir-2')).toBeDisabled();
    await page.getByTestId('pc-texto-2').fill('Coleta atrasada por troca de plantão');
    await page.getByTestId('pc-concluir-2').click();
    await expect(page.getByTestId('pc-mensagem')).toContainText('fora da meta');
    await expect(page.getByTestId('pc-etapa-2')).toContainText('Coleta atrasada por troca de plantão');

    // Cancelamento da opcional com o motivo.
    await expect(page.getByTestId('pc-cancelar-3')).toBeDisabled();
    await page.getByTestId('pc-texto-3').fill('Paciente sem indicação de reposição');
    await page.getByTestId('pc-cancelar-3').click();
    await expect(page.getByTestId('pc-mensagem')).toContainText('Etapa cancelada');
    await expect(page.getByTestId('pc-etapa-3')).toContainText('Paciente sem indicação de reposição');
    expect(estado.etapas.map((e) => e.situacao)).toEqual(['meta_atingida', 'meta_perdida', 'cancelada']);

    // Configuração: o campo do critério de sinal vital vem do catálogo parametro_vital do cliente.
    await escolher(page.getByTestId('pc-protocolo'), { rotulo: new RegExp(alvo.nome) });
    await escolher(page.getByTestId('pc-campo'), { rotulo: /Temperatura axilar \(temperatura\)/ });
    await page.getByTestId('pc-modelo').click();
    await expect(page.getByTestId('pc-mensagem')).toContainText('Modelo aplicado');
    await expect(page.getByTestId('pc-etapas-config').getByRole('row').first()).toBeVisible();
    await semViolacaoAxe(page, '/enfermagem/protocolos-criterios (configuração)');

    // Validação na hora: a faixa invertida e a fórmula com grupo inexistente.
    await page.getByTestId('pc-minimo').fill('100');
    await page.getByTestId('pc-maximo').fill('50');
    await expect(page.getByTestId('pc-problema-criterio')).toContainText('menor que o mínimo');
    await expect(page.getByTestId('pc-incluir-criterio')).toBeDisabled();
    await page.getByTestId('pc-formula').fill('grupo_que_nao_existe E');
    await expect(page.getByTestId('pc-problema-formula')).toBeVisible();
    await expect(page.getByTestId('pc-gravar-formula')).toBeDisabled();

    // Etapa nova com meta (só na fonte deste spec).
    const nome = 'Reavaliação sintética C2042';
    await page.getByTestId('pc-nome-etapa').fill(nome);
    await escolher(page.getByTestId('pc-tipo-etapa'), { rotulo: 'Reavaliação' });
    await page.getByTestId('pc-meta-etapa').fill('120');
    await escolher(page.getByTestId('pc-obrigatoria'), { rotulo: 'Opcional' });
    await page.getByTestId('pc-incluir-etapa').click();
    await expect(page.getByTestId('pc-mensagem')).toContainText('Etapa incluída');
    await expect(page.getByTestId('pc-etapas-config')).toContainText(nome);

    expect(externas).toEqual([]);
  });
});
