// Integração da porta própria do processo de enfermagem e da vacina contra o MariaDB real (cliente f22_o2). Massa
// SINTÉTICA L0205 (nenhuma pessoa real). Contrato de efeito: o processo (versão como trava otimista), os diagnósticos
// com as características, a avaliação dos resultados e o plano; a evolução; a vacina com o evento na fila de saída, a
// retificação (registro novo ligado ao original) e o estorno; e as recusas (versão vista velha, código fora do
// catálogo, dose repetida, estorno repetido, outro estabelecimento, prescrição sem modelo). SGH_NUCLEO_SEM_BANCO=1 pula.
import { ErroOperacao, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TrilhaDaGravacao } from '../exames/public-api.js';
import {
  CLIENTE,
  contextoDe,
  garantirCliente,
  limparMassa,
  type MassaEnfermagem,
  montarMassa,
  P,
  SEM_BANCO,
} from './massa-enfermagem.spec-util.js';
import { direcaoDaMeta, PortaSaePropria, situacaoDaEvolucao } from './sae-porta-propria.js';

const codigoDe = (e: unknown) => (e instanceof ErroOperacao ? String(e.problema['codigo'] ?? '') : String(e));
const recusada = async (p: Promise<unknown>) => codigoDe(await p.then(() => null, (e: unknown) => e));

describe('regras derivadas das notas (sem banco)', () => {
  it('a direção da meta e a situação da evolução', () => {
    expect([direcaoDaMeta(2, 4), direcaoDaMeta(3, 3), direcaoDaMeta(4, 2)]).toEqual([1, 2, 3]);
    expect(situacaoDaEvolucao(4, 2, 4)).toBe('atingida');
    expect(situacaoDaEvolucao(4, 2, 3)).toBe('melhorou');
    expect(situacaoDaEvolucao(4, 2, 2)).toBe('mantida');
    expect(situacaoDaEvolucao(4, 3, 2)).toBe('piorou');
  });
});

describe.skipIf(SEM_BANCO)('porta própria da SAE e da vacina (MariaDB, cliente f22_o2)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaSaePropria;
  let m: MassaEnfermagem | null = null;
  let processo = 0;
  let vacina = 0;
  const chaveSae = `l0205-sae-${Date.now()}`;
  const agora = () => new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 16);

  const contar = (sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 't-l0205' }, async (l) =>
      Number((await l.uma<{ n: number }>(sql, p))?.n ?? 0),
    );

  beforeAll(async () => {
    garantirCliente();
    nucleo = new NucleoProprio();
    m = await montarMassa(nucleo, `${P}S`, false);
    porta = new PortaSaePropria(nucleo);
  }, 60_000);

  afterAll(async () => {
    await limparMassa(nucleo, m);
    await nucleo.encerrar();
  });

  const c = () => contextoDe(m!);
  /** A linha da trilha que a tela monta pelo resultado (como o apoio da gravação). */
  const linhaTela =
    (evento: string, entidade: string) =>
    (x: { id: number }): TrilhaDaGravacao => ({
      estabelecimento: m!.est,
      usuario: m!.usuario,
      acao: 'operacao',
      entidade,
      entidadeId: x.id,
      dadosDepois: { evento, recurso: 'teste', paciente: m!.paciente, estacao: 'L0205' },
      correlacao: 't-l0205',
    });
  const trilhaDoEvento = (tabela: string, id: number, evento: string) =>
    contar(
      `SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = ? AND entidade_id = ?
          AND JSON_VALUE(dados_depois, '$.dados.evento') = ? AND JSON_VALUE(dados_depois, '$.dados.paciente') = ?`,
      [tabela, id, evento, m!.paciente],
    );
  const registrar = (
    versaoVista: number,
    chave: string | null,
    codigo = `${m!.marca}-D1`,
    trilha: ((x: { id: number }) => TrilhaDaGravacao) | null = null,
  ) =>
    porta.gravarSgh(c(), trilha, (g) =>
      g.registrarSae({
        paciente: m!.paciente,
        atendimento: m!.atendimento,
        versaoVista,
        sistema: 'NNN',
        versaoTerminologia: '2024',
        avaliacao: 'Avaliação sintética do processo.',
        diagnosticos: [
          {
            codigo,
            descricao: 'Diagnóstico sintético',
            caracteristicas: [`${m!.marca}-C1`],
            fatores: [`${m!.marca}-F1`],
            resultados: [{ codigo: `${m!.marca}-R1`, descricao: 'Resultado', escalaAtual: 2, meta: 1, escalaMeta: 4 }],
            intervencoes: [{ codigo: `${m!.marca}-I1`, descricao: 'Intervenção' }],
          },
        ],
        vinculo: m!.profissional,
        usuario: m!.login,
        chave,
      }),
    );

  it('registra o processo: linhas, versão 1, trilha; a repetição e a versão velha', async () => {
    const r = await registrar(0, chaveSae, undefined, linhaTela('L0205_SAE_REGISTRADA', 'SGH_PEP_SAE'));
    expect(r).toMatchObject({ versao: 1, itens: 3, repetida: false });
    processo = r.id;
    // A linha da tela montada pelo resultado chega à trilha da operação: o evento e o paciente.
    expect(await trilhaDoEvento('processo_enfermagem', processo, 'L0205_SAE_REGISTRADA')).toBe(1);
    expect(await contar('SELECT COUNT(*) AS n FROM diagnostico_enfermagem_paciente_caracteristica x JOIN diagnostico_enfermagem_paciente d ON d.id = x.diagnostico_enfermagem_paciente_id WHERE d.atendimento_id = ?', [m!.atendimento])).toBe(2);
    expect(await contar("SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'processo_enfermagem' AND entidade_id = ?", [processo])).toBeGreaterThanOrEqual(1);
    expect((await registrar(0, chaveSae)).repetida).toBe(true);
    expect(await recusada(registrar(0, null))).toBe('sae-mudou');
    expect(await recusada(registrar(1, null, `${m!.marca}-NAOEXISTE`))).toBe('termo-nao-cadastrado');
    const s = await porta.sae(c(), m!.atendimento);
    expect(s.cabecalho).toMatchObject({ id: processo, versao: 1, usuario: m!.login });
    expect(s.itens.map((i) => i.tipo)).toEqual(['diagnostico', 'resultado', 'intervencao']);
    expect(s.itens[0]).toMatchObject({ caracteristicas: [`${m!.marca}-C1`], fatores: [`${m!.marca}-F1`] });
    expect(s.itens[1]).toMatchObject({ escala: 2, escalaMeta: 4, meta: 1 });
    expect((await porta.sae(contextoDe(m!, m!.outroEst), m!.atendimento)).cabecalho).toBeNull();
  });

  it('nova versão substitui os diagnósticos; a evolução entra como nova avaliação', async () => {
    const r = await registrar(1, null);
    expect(r.versao).toBe(2);
    // As duas versões ficam visíveis (a anterior inativada, com o início dela).
    const vs = (await porta.sae(c(), m!.atendimento)).versoes;
    expect(vs.map((x) => x.versao)).toEqual([1, 2]);
    expect(vs.every((x) => x.id === processo && x.usuario === m!.login && x.em !== '')).toBe(true);
    expect(await contar("SELECT COUNT(*) AS n FROM diagnostico_enfermagem_paciente WHERE atendimento_id = ? AND situacao = 'inativado'", [m!.atendimento])).toBe(1);
    const resultado = (await porta.sae(c(), m!.atendimento)).itens.find((i) => i.tipo === 'resultado')!;
    const ev = await porta.gravarSgh(c(), null, (g) =>
      g.evoluir({
        sae: processo,
        paciente: m!.paciente,
        atendimento: m!.atendimento,
        nota: 'Evolução sintética',
        resultados: [{ resultado: resultado.id, descricao: 'Resultado', escala: 3, situacao: 'melhorou' }],
        vinculo: m!.profissional,
        usuario: m!.login,
        chave: `l0205-ev-${Date.now()}`,
      }),
    );
    expect(ev.ids).toHaveLength(1);
    const evolucao = (await porta.sae(c(), m!.atendimento)).itens.find((i) => i.tipo === 'evolucao');
    expect(evolucao).toMatchObject({ pai: resultado.id, escala: 3, situacao: 'melhorou', nota: 'Evolução sintética' });
    expect(
      await recusada(
        porta.gravarSgh(c(), null, (g) =>
          g.evoluir({ sae: processo + 999_999, paciente: m!.paciente, atendimento: m!.atendimento, nota: 'x', resultados: [], vinculo: 1, usuario: m!.login, chave: `l0205-ev2-${Date.now()}` }),
        ),
      ),
    ).toBe('sae-mudou');
  });

  it('vacina: o registro com o evento na fila; a dose repetida; retificação e estorno', async () => {
    const aplicar = (k: string | null) =>
      porta.gravarSgh(c(), null, (g) =>
        g.registrarVacina({
          paciente: m!.paciente,
          atendimento: m!.atendimento,
          imunobiologico: `${m!.marca}-VAC`,
          nome: 'Vacina sintética',
          lote: 'LOTE1',
          fabricante: null,
          validadeLote: '2027-12-31',
          dose: 'D1',
          via: `${m!.marca}-IM`,
          local: `${m!.marca}-DELT`,
          aplicadaEm: agora(),
          prazoEnvio: agora(),
          chaveDose: 'D1',
          vinculo: m!.profissional,
          usuario: m!.login,
          chave: k,
        }),
      );
    const r = await aplicar(`l0205-vac-${Date.now()}`);
    vacina = r.id;
    expect(await contar("SELECT COUNT(*) AS n FROM integracao_mensagem WHERE ponto = 'fato.vacina.aplicada' AND estabelecimento_id = ?", [m!.est])).toBe(1);
    expect(r.evento).not.toBe('');
    expect(await recusada(aplicar(null))).toBe('dose-ja-registrada');
    // A retificação reenviada com a mesma chave (resposta perdida) não cria outra retificação nem outro evento.
    const kRet = `l0205-ret-${Date.now()}`;
    const retificar = () =>
      porta.gravarSgh(c(), null, (g) =>
        g.corrigirVacina({ id: vacina, paciente: m!.paciente, tipo: 'retificacao', motivo: 'Lote digitado errado', dados: { lote: 'LOTE2' }, usuario: m!.login, chave: kRet }),
      );
    const ret = await retificar();
    expect(ret.versao).toBe(1);
    expect((await retificar()).versao).toBe(1);
    expect(await contar('SELECT COUNT(*) AS n FROM vacina_aplicada WHERE vacina_aplicada_original_id = ?', [vacina])).toBe(1);
    expect(await contar("SELECT COUNT(*) AS n FROM integracao_mensagem WHERE ponto = 'fato.vacina.substituida' AND estabelecimento_id = ?", [m!.est])).toBe(1);
    let [v] = await porta.vacinas(c(), m!.paciente);
    expect(v?.correcoes).toEqual([expect.objectContaining({ tipo: 'retificacao', dados: { lote: 'LOTE2' } })]);
    await porta.gravarSgh(c(), null, (g) =>
      g.corrigirVacina({ id: vacina, paciente: m!.paciente, tipo: 'estorno', motivo: 'Aplicada em outro paciente', dados: null, usuario: m!.login }),
    );
    [v] = await porta.vacinas(c(), m!.paciente);
    expect(v?.correcoes.map((x) => x.tipo)).toEqual(['retificacao', 'estorno']);
    expect(
      await recusada(
        porta.gravarSgh(c(), null, (g) =>
          g.corrigirVacina({ id: vacina, paciente: m!.paciente, tipo: 'estorno', motivo: 'De novo', dados: null, usuario: m!.login }),
        ),
      ),
    ).toBe('vacina-estornada');
    expect(await porta.vacinas(contextoDe(m!, m!.outroEst), m!.paciente)).toEqual([]);
  });

  it('a consulta, os externos do dia e o cabeçalho da receita; a prescrição aguarda o modelo', async () => {
    expect(await porta.consulta(c(), m!.atendimento)).toMatchObject({ tipo: 'I', vinculoDoAtendimento: m!.profissional, ativo: true });
    expect(await porta.consulta(contextoDe(m!, m!.outroEst), m!.atendimento)).toBeNull();
    expect((await porta.externosDoDia(c(), agora().slice(0, 10))).itens).toEqual([]);
    const cab = await porta.cabecalhoReceita(c(), { paciente: m!.paciente, vinculo: m!.profissional });
    expect(cab).toMatchObject({ paciente: `PACIENTE ${m!.marca} SINTETICO`, nascimento: '1970-05-01' });
    expect(await recusada(porta.gravarSgh(c(), null, (g) => g.prescrever({} as never)))).toBe('modelo-pendente');
  });
});
