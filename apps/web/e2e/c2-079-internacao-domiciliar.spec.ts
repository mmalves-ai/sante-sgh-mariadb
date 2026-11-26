// C2-079 (04-INT linha 84): internação domiciliar, do orçamento à visita do chamado. As rotas de
// /api/internacao/domiciliar são simuladas (page.route com estado sintético que segue a porta própria) e o ciclo é
// exercitado pela tela:
//   - no painel (/internacao/domiciliar), a busca leva à visão do paciente;
//   - o orçamento para a operadora valida na hora pela regra do domínio (fonte pagadora, item com tipo de custo) e é
//     salvo, enviado e aprovado;
//   - a transferência para casa usa o endereço do paciente e o orçamento aprovado; iniciar a internação pede o médico
//     responsável (barra de ação);
//   - o chamado é aberto, triado (prioridade) e atribuído ao profissional, o que agenda a visita extra ligada a ele; a
//     visita é iniciada (o chamado passa a em atendimento) e realizada; concluir como atendido no domicílio só se
//     habilita com a visita realizada.
// Axe em cada passo. O que fica no banco é provado pelo contrato de efeito internacao-domiciliar-propria.int.spec.ts.
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const PACIENTE = 1001;

async function entrar(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

const dia = (deslocamento: number) =>
  new Date(Date.now() + deslocamento * 86_400_000).toISOString().slice(0, 10);

test.describe('internação domiciliar: orçamento, transferência para casa, chamado e visita @C2-079', () => {
  test.setTimeout(180_000);

  test('orçamento aprovado, transferência, início, chamado triado e atribuído, visita realizada e conclusão; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    const corpos: { url: string; corpo: Record<string, unknown> }[] = [];
    const json = (rota: Route, corpo: unknown, status = 200) =>
      rota.fulfill({ status, contentType: 'application/json', body: JSON.stringify(corpo) });

    const orcamentos: Record<string, unknown>[] = [];
    const internacoes: Record<string, unknown>[] = [];
    const chamados: Record<string, unknown>[] = [];
    const visitas: Record<string, unknown>[] = [];
    const mudar = (lista: Record<string, unknown>[], id: number, extra: Record<string, unknown>) => {
      const i = lista.findIndex((x) => x['id'] === id);
      lista[i] = { ...lista[i], ...extra, versao: Number(lista[i]!['versao']) + 1 };
      return lista[i]!;
    };
    const painel = () => ({ internacoes, chamados, visitas, orcamentos });

    await page.route('**/api/cadastros/pacientes?**', (r) =>
      json(r, {
        tipo: 'auto',
        itens: [
          {
            id: PACIENTE,
            prontuario: 900,
            nome: 'PACIENTE SINTETICO DOMICILIAR',
            nomeSocial: null,
            nascimento: '1950-01-01',
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
        duracaoMs: 3,
      }),
    );
    await page.route(/\/api\/internacao\/domiciliar\/.*/, async (r) => {
      const req = r.request();
      const caminho = new URL(req.url()).pathname.replace('/api/internacao/domiciliar', '');
      if (req.method() === 'GET') {
        if (caminho === '/opcoes')
          return json(r, {
            tiposChamado: [{ id: 2, nome: 'Intercorrência sintética', coparticipacao: false }],
            motivosChamado: [{ id: 6, nome: 'Febre sintética', tipo: 2 }],
            motivosTransferencia: [{ id: 8, nome: 'Desospitalização sintética' }],
            programas: [],
            areas: [],
            fontes: [{ id: 7, nome: 'Operadora sintética' }],
            tiposCusto: [{ id: 4, nome: 'Visita de enfermagem sintética' }],
            profissionais: [{ id: 31, nome: 'Médico sintético' }],
          });
        if (caminho === '/painel') return json(r, painel());
        if (caminho === `/pacientes/${PACIENTE}`)
          return json(r, {
            ...painel(),
            paciente: { id: PACIENTE, nome: 'PACIENTE SINTETICO DOMICILIAR' },
            enderecos: [{ id: 21, nome: 'Rua sintética, 100' }],
            hospitalares: [],
          });
        return json(r, { title: 'Não encontrado', status: 404 }, 404);
      }
      const corpo = (req.postDataJSON() ?? {}) as Record<string, unknown>;
      corpos.push({ url: caminho, corpo });
      let m: RegExpMatchArray | null;
      if (caminho === '/orcamentos') {
        const itens = (corpo['itens'] as Record<string, unknown>[]).map((i, n) => ({
          sequencia: n + 1,
          tipoItem: i['tipoItem'],
          descricao: i['descricao'],
          quantidade: i['quantidade'],
          dias: i['dias'],
          valorUnitario: i['valorUnitario'],
          valorTotal: Number(i['quantidade']) * Number(i['dias'] ?? 1) * Number(i['valorUnitario']),
        }));
        const custo = itens.reduce((s, i) => s + i.valorTotal, 0);
        orcamentos.push({
          id: 51,
          versao: 1,
          numero: 'ORC-SINT-51',
          paciente: PACIENTE,
          pacienteNome: 'PACIENTE SINTETICO DOMICILIAR',
          tipo: corpo['tipo'],
          modalidade: 'internacao',
          fontePagadora: corpo['fontePagadora'],
          fonteNome: 'Operadora sintética',
          situacao: 'rascunho',
          validade: corpo['validade'],
          periodoInicio: null,
          periodoFim: null,
          diagnostico: corpo['diagnostico'],
          percentualImpostos: corpo['percentualImpostos'],
          valorCustoTotal: custo,
          valorImpostos: 0,
          valorTotal: custo,
          criadoEm: new Date().toISOString(),
          respostaEm: null,
          itens,
        });
        return json(r, { id: 51, numero: 'ORC-SINT-51', situacao: 'rascunho' });
      }
      if ((m = caminho.match(/^\/orcamentos\/(\d+)\/(enviar|aprovar)$/))) {
        const o = mudar(orcamentos, Number(m[1]), { situacao: m[2] === 'enviar' ? 'enviado' : 'aprovado' });
        return json(r, { id: o['id'], situacao: o['situacao'] });
      }
      if (caminho === '/internacoes') {
        internacoes.push({
          id: 61,
          versao: 1,
          numero: 'DOM-SINT-61',
          paciente: PACIENTE,
          pacienteNome: 'PACIENTE SINTETICO DOMICILIAR',
          situacao: 'solicitada',
          endereco: 'Rua sintética, 100',
          origemInternacao: null,
          orcamento: corpo['orcamento'],
          orcamentoNumero: 'ORC-SINT-51',
          medico: null,
          medicoNome: null,
          porLiminar: false,
          solicitacao: new Date().toISOString(),
          prevista: corpo['dataPrevista'],
          inicio: null,
          fim: null,
          observacao: null,
        });
        return json(r, { id: 61, numero: 'DOM-SINT-61', situacao: 'solicitada' });
      }
      if ((m = caminho.match(/^\/internacoes\/(\d+)\/iniciar$/))) {
        const d = mudar(internacoes, Number(m[1]), {
          situacao: 'ativa',
          medico: corpo['medico'],
          medicoNome: 'Médico sintético',
          inicio: new Date().toISOString(),
        });
        return json(r, { id: d['id'], situacao: 'ativa' });
      }
      if (caminho === '/chamados') {
        chamados.push({
          id: 71,
          versao: 1,
          numero: 'CH-SINT-71',
          paciente: PACIENTE,
          pacienteNome: 'PACIENTE SINTETICO DOMICILIAR',
          internacao: 61,
          tipo: corpo['tipo'],
          tipoNome: 'Intercorrência sintética',
          motivoNome: 'Febre sintética',
          prioridade: null,
          situacao: 'aberto',
          chamadoEm: new Date().toISOString(),
          endereco: 'Rua sintética, 100',
          sintoma: corpo['sintoma'],
          profissional: null,
          profissionalNome: null,
          desfecho: null,
          realizadoEm: null,
          motivoAnulacao: null,
        });
        return json(r, { id: 71, numero: 'CH-SINT-71', situacao: 'aberto' });
      }
      if ((m = caminho.match(/^\/chamados\/(\d+)\/(triar|atribuir|concluir)$/))) {
        const id = Number(m[1]);
        if (m[2] === 'triar') mudar(chamados, id, { situacao: 'triado', prioridade: corpo['prioridade'] });
        if (m[2] === 'atribuir') {
          mudar(chamados, id, {
            situacao: 'atribuido',
            profissional: corpo['profissional'],
            profissionalNome: 'Médico sintético',
          });
          // A porta agenda a visita extra ligada ao chamado.
          visitas.push({
            id: 81,
            versao: 1,
            paciente: PACIENTE,
            pacienteNome: 'PACIENTE SINTETICO DOMICILIAR',
            internacao: 61,
            chamado: id,
            profissional: corpo['profissional'],
            profissionalNome: 'Médico sintético',
            tipoNome: 'Visita extra',
            agendadaPara: new Date(Date.now() - 5 * 60_000).toISOString(),
            duracao: 60,
            extra: true,
            situacao: 'agendada',
            iniciadaEm: null,
            encerradaEm: null,
            motivo: null,
          });
        }
        if (m[2] === 'concluir')
          mudar(chamados, id, {
            situacao: 'concluido',
            desfecho: corpo['desfecho'],
            realizadoEm: new Date().toISOString(),
          });
        return json(r, { id, situacao: chamados.find((c) => c['id'] === id)!['situacao'] });
      }
      if ((m = caminho.match(/^\/visitas\/(\d+)\/(iniciar|realizar)$/))) {
        const v =
          m[2] === 'iniciar'
            ? mudar(visitas, Number(m[1]), {
                situacao: 'em_andamento',
                iniciadaEm: new Date(Date.now() - 60_000).toISOString(),
              })
            : mudar(visitas, Number(m[1]), { situacao: 'realizada', encerradaEm: new Date().toISOString() });
        // Iniciada a visita, o chamado dela passa a em atendimento.
        if (m[2] === 'iniciar') mudar(chamados, Number(v['chamado']), { situacao: 'em_atendimento' });
        return json(r, { id: v['id'], situacao: v['situacao'] });
      }
      return json(r, { title: 'Não encontrado', status: 404 }, 404);
    });

    await // Equipe da internação: consulta e grava a internação (internacao.internacao.ler e .criar).
    await entrar(page, 'SINT.INTERNACAO');
    await page.goto('/internacao/domiciliar');
    await expect(page.getByTestId('tela-internacao-domiciliar')).toBeVisible();
    await semViolacaoAxe(page, '/internacao/domiciliar (painel)');

    // Busca do paciente e visão dele.
    await page.getByTestId('domiciliar-termo').fill('SINTETICO');
    await page.getByTestId('domiciliar-buscar').click();
    await page.getByTestId(`domiciliar-paciente-${PACIENTE}`).click();
    await expect(page).toHaveURL(new RegExp(`/internacao/domiciliar/paciente/${PACIENTE}$`));
    await expect(page.getByTestId('domiciliar-paciente-nome')).toBeVisible();

    // Orçamento: validação na hora (operadora sem fonte, item sem tipo de custo nem descrição).
    const salvar = page.getByTestId('domiciliar-orcamento-salvar');
    await expect(page.getByTestId('domiciliar-orcamento-problemas')).toBeVisible();
    await expect(salvar).toBeDisabled();
    await escolher(page.getByTestId('domiciliar-orcamento-fonte'), '7');
    await page.getByTestId('domiciliar-orcamento-validade').fill(dia(30));
    await escolher(page.getByTestId('domiciliar-item-0-tipo'), 'visita');
    await escolher(page.getByTestId('domiciliar-item-0-custo'), '4');
    await page.getByTestId('domiciliar-item-0-descricao').fill('Visita de enfermagem diária');
    await page.getByTestId('domiciliar-item-0-quantidade').fill('1');
    await page.getByTestId('domiciliar-item-0-dias').fill('30');
    await page.getByTestId('domiciliar-item-0-valor').fill('150');
    await expect(page.getByTestId('domiciliar-orcamento-problemas')).toHaveCount(0);
    await semViolacaoAxe(page, '/internacao/domiciliar/paciente (orçamento preenchido)');
    await salvar.click();
    await expect(page.getByTestId('domiciliar-aviso')).toBeVisible();
    expect(corpos.at(-1)).toMatchObject({
      url: '/orcamentos',
      corpo: {
        paciente: PACIENTE,
        tipo: 'operadora',
        fontePagadora: 7,
        itens: [{ tipoItem: 'visita', tipoCusto: 4, quantidade: 1, dias: 30, valorUnitario: 150 }],
      },
    });
    const linhaOrc = page.getByTestId('domiciliar-orcamento-ORC-SINT-51');
    await expect(linhaOrc.getByTestId('domiciliar-orcamento-aprovar')).toBeDisabled();
    await linhaOrc.getByTestId('domiciliar-orcamento-enviar').click();
    await expect(linhaOrc.getByTestId('domiciliar-orcamento-aprovar')).toBeEnabled();
    await linhaOrc.getByTestId('domiciliar-orcamento-aprovar').click();
    await expect(linhaOrc.getByTestId('domiciliar-orcamento-enviar')).toBeDisabled();
    expect(corpos.at(-1)).toMatchObject({ url: '/orcamentos/51/aprovar', corpo: { versao: 2 } });

    // Transferência para casa com o orçamento aprovado.
    await escolher(page.getByTestId('domiciliar-endereco'), '21');
    await escolher(page.getByTestId('domiciliar-orcamento'), '51');
    await escolher(page.getByTestId('domiciliar-motivo-transferencia'), '8');
    await escolher(page.getByTestId('domiciliar-medico'), '31');
    await page.getByTestId('domiciliar-prevista').fill(dia(1));
    await expect(page.getByTestId('domiciliar-transferir-problemas')).toHaveCount(0);
    await page.getByTestId('domiciliar-transferir').click();
    await expect.poll(() => corpos.at(-1)?.url).toBe('/internacoes');
    expect(corpos.at(-1)).toMatchObject({
      url: '/internacoes',
      corpo: { paciente: PACIENTE, endereco: 21, orcamento: 51, motivo: 8, medico: 31 },
    });
    const linhaInt = page.getByTestId('domiciliar-internacao-DOM-SINT-61');
    await expect(linhaInt).toBeVisible();
    await semViolacaoAxe(page, '/internacao/domiciliar/paciente (transferência solicitada)');

    // Iniciar pede o médico responsável na barra de ação.
    await expect(linhaInt.getByTestId('domiciliar-internacao-iniciar')).toBeDisabled();
    await escolher(page.getByTestId('domiciliar-acao-profissional'), '31');
    await linhaInt.getByTestId('domiciliar-internacao-iniciar').click();
    await expect(linhaInt.getByTestId('domiciliar-internacao-suspender')).toBeEnabled();
    expect(corpos.at(-1)).toMatchObject({ url: '/internacoes/61/iniciar', corpo: { versao: 1, medico: 31 } });

    // Chamado: abrir, triar e atribuir (agenda a visita extra).
    await escolher(page.getByTestId('domiciliar-chamado-tipo'), '2');
    await escolher(page.getByTestId('domiciliar-chamado-motivo'), '6');
    await page.getByTestId('domiciliar-chamado-sintoma').fill('Febre desde a manhã');
    await page.getByTestId('domiciliar-chamado-abrir').click();
    await expect.poll(() => corpos.at(-1)?.url).toBe('/chamados');
    expect(corpos.at(-1)).toMatchObject({
      url: '/chamados',
      corpo: { paciente: PACIENTE, tipo: 2, motivo: 6 },
    });
    const linhaCh = page.getByTestId('domiciliar-chamado-CH-SINT-71');
    await expect(linhaCh).toBeVisible();
    await expect(linhaCh.getByTestId('domiciliar-chamado-triar')).toBeDisabled();
    await escolher(page.getByTestId('domiciliar-acao-prioridade'), 'urgente');
    await linhaCh.getByTestId('domiciliar-chamado-triar').click();
    await expect.poll(() => corpos.at(-1)?.url).toBe('/chamados/71/triar');
    expect(corpos.at(-1)!.corpo).toMatchObject({ prioridade: 'urgente' });
    await linhaCh.getByTestId('domiciliar-chamado-atribuir').click();
    await expect.poll(() => corpos.at(-1)?.url).toBe('/chamados/71/atribuir');
    expect(corpos.at(-1)!.corpo).toMatchObject({ profissional: 31 });
    const linhaVis = page.getByTestId('domiciliar-visita-81');
    await expect(linhaVis).toBeVisible();
    await semViolacaoAxe(page, '/internacao/domiciliar/paciente (chamado atribuído)');

    // Concluir como atendido no domicílio só com a visita realizada.
    await escolher(page.getByTestId('domiciliar-acao-desfecho'), 'atendido_domicilio');
    await expect(linhaCh.getByTestId('domiciliar-chamado-concluir')).toBeDisabled();
    await linhaVis.getByTestId('domiciliar-visita-iniciar').click();
    await expect.poll(() => corpos.at(-1)?.url).toBe('/visitas/81/iniciar');
    await expect(linhaVis.getByTestId('domiciliar-visita-realizar')).toBeEnabled();
    await linhaVis.getByTestId('domiciliar-visita-realizar').click();
    await expect.poll(() => corpos.at(-1)?.url).toBe('/visitas/81/realizar');
    await expect(linhaCh.getByTestId('domiciliar-chamado-concluir')).toBeEnabled();
    await linhaCh.getByTestId('domiciliar-chamado-concluir').click();
    await expect.poll(() => corpos.at(-1)?.url).toBe('/chamados/71/concluir');
    expect(corpos.at(-1)!.corpo).toMatchObject({ desfecho: 'atendido_domicilio' });
    await expect(linhaCh.getByTestId('domiciliar-chamado-concluir')).toBeDisabled();
    await semViolacaoAxe(page, '/internacao/domiciliar/paciente (chamado concluído)');
    expect(externas).toEqual([]);
  });
});
