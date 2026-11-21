// Integração da porta própria da manutenção (M55) contra o MariaDB real, cliente f22_o3 (onda 3), com massa SINTÉTICA
// (massa.spec-util.ts). Contrato de efeito de cada gravação: as linhas em equipamento_saude, ordem_servico_manutencao
// (+ _evento e _item), plano_preventivo (+ _equipamento), execucao_preventiva, contrato_servico_terceirizado (+ _item) e
// notificacao_usuario, a `versao` e a trilha de auditoria; e as recusas (versão velha, código e número repetidos,
// outro estabelecimento em cada gravação, justificativa curta, laudo de fora, plano de vários alvos, vínculos na exclusão
// e o que ainda pede modelo); o aceite e a recusa do aceite na OS. As gravações diretas não publicam mensagem de saída
// (integracao_mensagem conferida vazia). As regras comuns rodam nas DUAS portas (memória e própria) num describe.each.
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CLIENTE_MAN,
  contextoMan,
  criarArquivoSintetico,
  encerrarMassaManutencao,
  escreverBanco,
  lerBanco,
  type MassaManutencao,
  prepararMassaManutencao,
  SEM_BANCO_MAN,
  trilhaMan,
} from './massa.spec-util.js';
import type { PortaManutencao } from './porta.js';
import { PortaManutencaoMemoria } from './porta-memoria.js';
import { PortaManutencaoPropria } from './porta-propria.js';
import type { EquipamentoParaGravar } from './tipos.js';

const codigoDe = (e: unknown) => (e as { problema?: { codigo?: string } }).problema?.codigo;

describe.skipIf(SEM_BANCO_MAN)(`porta própria da manutenção (MariaDB, cliente ${CLIENTE_MAN})`, () => {
  let m: MassaManutencao | null = null;
  let porta: PortaManutencaoPropria;
  const M = () => m!;
  const c = () => contextoMan(M());
  const trilhas = async (tabela: string, id: number) =>
    Number(
      (await lerBanco<{ n: number }>(M(), 'SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = ? AND entidade_id = ?', [tabela, id]))?.n,
    );
  const equipamento = (codigo: string, o: Partial<EquipamentoParaGravar> = {}): EquipamentoParaGravar => ({
    codigo,
    nome: 'MONITOR SINTETICO',
    tipo: 'medico',
    criticidade: 'critica',
    classeRisco: 'III',
    fabricante: 'L0303M FABRICANTE SINTETICO',
    modelo: 'MX-1',
    numeroSerie: `NS-${codigo}`,
    registroAnvisa: null,
    unidade: null,
    centroCusto: M().centro,
    localizacao: 'LEITO 1',
    recurso: null,
    bemPatrimonial: null,
    instalacao: '2020-01-10',
    garantiaAte: null,
    situacao: 'ativo',
    motivo: null,
    usuario: M().loginUsuario,
    ...o,
  });
  const novoEquipamento = (codigo: string, o: Partial<EquipamentoParaGravar> = {}) =>
    porta.gravarSgh(c(), (r: { id: number }) => trilhaMan(M(), 'equipamento_saude', r.id), (g) =>
      g.incluirEquipamento(equipamento(codigo, o)),
    );

  beforeAll(async () => {
    m = await prepararMassaManutencao('P');
    porta = new PortaManutencaoPropria(m.nucleo);
  }, 120_000);
  afterAll(async () => {
    await encerrarMassaManutencao(m);
  });

  it('cadastros lidos: setores (centro de custo com a unidade do setor), unidades, recursos, fornecedores e usuários', async () => {
    const setores = await porta.setores(c());
    expect(setores.find((s) => s.codigo === M().centro)).toMatchObject({ unidade: M().unidade, ativo: true });
    expect(setores.find((s) => s.codigo === M().centroSemSetor)).toMatchObject({ unidade: null });
    expect((await porta.unidades(c())).map((u) => u.codigo)).toContain(M().unidade);
    expect(await porta.recursos(c(), 'agendaExame')).toEqual([
      expect.objectContaining({ id: M().recurso, tipo: 'agendaExame', centroCusto: M().centro }),
    ]);
    expect(await porta.recursos(c(), 'salaCirurgica')).toEqual([]);
    expect((await porta.fornecedores(c(), 'L0303')).map((f) => f.codigo)).toContain(M().fornecedor);
    expect(await porta.nomesDosFornecedores(c(), [M().fornecedor])).toEqual([{ codigo: M().fornecedor, nome: 'ENG SINT L0303' }]);
    expect((await porta.nomesDosUsuarios(c(), [M().loginUsuario])).map((u) => u.login)).toEqual([M().loginUsuario]);
    const { hoje, agora } = await porta.relogio(c());
    expect(agora.startsWith(hoje)).toBe(true);
  });

  it('equipamento: inclusão com fabricante do cadastro, versão, trilha; código repetido; alteração pela versão vista', async () => {
    const r = await novoEquipamento('L0303-EQ1', { recurso: { tipo: 'agendaExame', id: M().recurso } });
    expect(r.versao).toBe(1);
    const linha = await lerBanco(M(), 'SELECT e.codigo, e.setor_funcional_id, e.versao, f.nome AS fabricante FROM equipamento_saude e JOIN fabricante f ON f.id = e.fabricante_id WHERE e.id = ?', [r.id]);
    expect(linha).toMatchObject({ codigo: 'L0303-EQ1', setor_funcional_id: M().setor, versao: 1, fabricante: 'L0303M FABRICANTE SINTETICO' });
    expect(await trilhas('equipamento_saude', r.id)).toBe(1);
    const lido = await porta.equipamento(c(), r.id);
    expect(lido).toMatchObject({ unidade: M().unidade, recurso: { tipo: 'agendaExame', id: M().recurso }, parado: false, osAbertas: 0 });
    expect((await porta.equipamentoPorCodigo(c(), 'l0303-eq1'))?.id).toBe(r.id);
    await expect(novoEquipamento('L0303-EQ1')).rejects.toSatisfy((e) => codigoDe(e) === 'codigo-repetido');
    const alt = await porta.gravarSgh(c(), trilhaMan(M(), 'equipamento_saude', r.id), (g) =>
      g.alterarEquipamento({ ...equipamento('L0303-EQ1', { situacao: 'desativado', motivo: 'Substituído (teste)' }), id: r.id, versaoVista: 1 }),
    );
    expect(alt.versao).toBe(2);
    expect(await porta.equipamento(c(), r.id)).toMatchObject({ situacao: 'desativado', motivo: 'Substituído (teste)' });
    await expect(
      porta.gravarSgh(c(), trilhaMan(M(), 'equipamento_saude', r.id), (g) =>
        g.alterarEquipamento({ ...equipamento('L0303-EQ1'), id: r.id, versaoVista: 1 }),
      ),
    ).rejects.toSatisfy((e) => codigoDe(e) === 'desatualizado');
    expect(await porta.equipamento(contextoMan(M(), M().outro), r.id)).toBeNull();
    const lista = await porta.equipamentos(c(), { termo: 'L0303-EQ', limite: 10 });
    expect(lista.itens.map((x) => x.id)).toContain(r.id);
  });

  it('OS: abertura com parada, assumir, concluir com causa, custos, reparo e fim da parada; histórico e recusas', async () => {
    const eq = await novoEquipamento('L0303-EQ2');
    const { agora } = await porta.relogio(c());
    const os = await porta.gravarSgh(c(), trilhaMan(M(), 'ordem_servico_manutencao'), (g) =>
      g.abrirOs({
        natureza: 'corretiva',
        equipamento: eq.id,
        centroCusto: M().centro,
        local: null,
        descricao: 'Parou durante o uso (teste sintético)',
        contato: null,
        prioridadeSugerida: 'emergencia',
        prioridade: 'emergencia',
        solicitante: M().loginUsuario,
        registro: agora,
        parado: true,
        plano: null,
        nota: 'aberta no teste',
      }),
    );
    expect(os.numero).toMatch(new RegExp(`^${agora.slice(0, 4)}-\\d{6}$`));
    expect(await porta.equipamento(c(), eq.id)).toMatchObject({ parado: true, osAbertas: 1 });
    await expect(
      porta.gravarSgh(c(), trilhaMan(M(), 'ordem_servico_manutencao', os.id), (g) =>
        g.mudarOs({ id: os.id, versaoVista: 1, de: 'emAtendimento', para: 'concluida', campos: {}, usuario: M().loginUsuario, nota: null }),
      ),
    ).rejects.toSatisfy((e) => codigoDe(e) === 'desatualizado');
    const v2 = await porta.gravarSgh(c(), trilhaMan(M(), 'ordem_servico_manutencao', os.id), (g) =>
      g.mudarOs({
        id: os.id,
        versaoVista: 1,
        de: 'aberta',
        para: 'emAtendimento',
        campos: { tecnico: M().loginUsuario, assumidaEm: agora },
        usuario: M().loginUsuario,
        nota: null,
      }),
    );
    expect(v2.versao).toBe(2);
    await expect(
      porta.gravarSgh(c(), trilhaMan(M(), 'ordem_servico_manutencao', os.id), (g) =>
        g.corrigirOs({ id: os.id, versaoVista: 2, equipamento: eq.id, centroCusto: M().centro, local: null, descricao: 'x', prioridadeSugerida: 'alta', usuario: M().loginUsuario, nota: 'correção' }),
      ),
    ).rejects.toSatisfy((e) => codigoDe(e) === 'desatualizado');
    await expect(
      porta.gravarSgh(c(), trilhaMan(M(), 'ordem_servico_manutencao', os.id), (g) =>
        g.mudarOs({ id: os.id, versaoVista: 2, de: 'emAtendimento', para: 'concluida', campos: { laudo: 99 }, usuario: M().loginUsuario, nota: null }),
      ),
    ).rejects.toSatisfy((e) => codigoDe(e) === 'laudo-invalido');
    const v3 = await porta.gravarSgh(c(), trilhaMan(M(), 'ordem_servico_manutencao', os.id), (g) =>
      g.mudarOs({
        id: os.id,
        versaoVista: 2,
        de: 'emAtendimento',
        para: 'concluida',
        campos: {
          concluidaEm: agora,
          causa: 'usoInadequado',
          solucao: 'Troca do cabo (teste)',
          inicioReparo: agora,
          fimReparo: agora,
          paradaFim: agora,
          custoPecasCent: 12_345,
          custoMaoDeObraCent: 5_000,
          custoTerceirosCent: 0,
        },
        usuario: M().loginUsuario,
        nota: 'concluída',
      }),
    );
    expect(v3.versao).toBe(3);
    const lida = await porta.os(c(), os.id);
    expect(lida).toMatchObject({
      situacao: 'concluida',
      tecnico: M().loginUsuario,
      causa: 'usoInadequado',
      custoPecasCent: 12_345,
      custoMaoDeObraCent: 5_000,
      paradaInicio: agora,
      paradaFim: agora,
      inicioReparo: agora,
      fimReparo: agora,
      laudo: null,
    });
    expect((await porta.eventos(c(), os.id)).map((e) => e.para)).toEqual(['aberta', 'emAtendimento', 'concluida']);
    expect(await porta.equipamento(c(), eq.id)).toMatchObject({ parado: false });
    expect(await trilhas('ordem_servico_manutencao', os.id)).toBe(2);
    const oc = await porta.ocorrencias(c(), { inicio: agora.slice(0, 10), fim: agora.slice(0, 10), equipamento: eq.id });
    expect(oc.paradas).toEqual([{ equipamento: eq.id, inicio: agora, fim: agora }]);
    expect(oc.corretivas).toEqual([expect.objectContaining({ equipamento: eq.id, causa: 'usoInadequado' })]);
    expect(await porta.baseObsolescencia(c(), eq.id, '2020-01-01')).toEqual({ custoCent: 17_345, corretivas: 1 });
    expect((await porta.ordens(c(), { equipamento: eq.id })).itens.map((x) => x.id)).toEqual([os.id]);
    expect((await porta.ordens(contextoMan(M(), M().outro), { equipamento: eq.id })).itens).toEqual([]);

    // Aceite: a recusa exige justificativa, fica na OS e no histórico; a nova conclusão volta o aceite a pendente.
    const mudar = (versaoVista: number, de: 'concluida' | 'emAtendimento', para: 'emAtendimento' | 'concluida' | 'encerrada', campos: object, nota: string | null) =>
      porta.gravarSgh(c(), trilhaMan(M(), 'ordem_servico_manutencao', os.id), (g) =>
        g.mudarOs({ id: os.id, versaoVista, de, para, campos, usuario: M().loginUsuario, nota }),
      );
    const aceite = () =>
      lerBanco(M(), 'SELECT aceite_resultado AS r, aceite_usuario_id AS u, aceite_justificativa AS j, aceite_em IS NOT NULL AS em, versao FROM ordem_servico_manutencao WHERE id = ?', [os.id]);
    await expect(mudar(3, 'concluida', 'emAtendimento', { concluidaEm: null }, 'curta')).rejects.toSatisfy((e) => codigoDe(e) === 'justificativa-curta');
    expect(await aceite()).toMatchObject({ r: null, versao: 3 });
    expect((await mudar(3, 'concluida', 'emAtendimento', { concluidaEm: null }, 'Ainda faz ruído ao ligar (teste)')).versao).toBe(4);
    expect(await aceite()).toMatchObject({ r: 'reprovado', u: M().usuario, j: 'Ainda faz ruído ao ligar (teste)', em: 1 });
    expect((await mudar(4, 'emAtendimento', 'concluida', { concluidaEm: agora }, null)).versao).toBe(5);
    expect(await aceite()).toMatchObject({ r: null, u: null, j: null, em: 0 });
    expect((await mudar(5, 'concluida', 'encerrada', { encerradaEm: agora }, null)).versao).toBe(6);
    expect(await aceite()).toMatchObject({ r: 'aprovado', u: M().usuario, j: null, em: 1 });
    const tipos = await M().nucleo.lerSomente({ cliente: CLIENTE_MAN, correlacao: 'int-0303-conferir' }, (l) =>
      l.consultar('SELECT tipo_evento FROM ordem_servico_manutencao_evento WHERE ordem_servico_manutencao_id = ? ORDER BY id', [os.id]),
    );
    expect(tipos.map((t) => t['tipo_evento']).slice(-3)).toEqual(['recusa_aceite', 'conclusao', 'aceite']);
  });

  it('outro estabelecimento: cada gravação com id de lá é recusada, sem resíduo e sem mensagem de saída', async () => {
    const eq = await novoEquipamento('L0303-EQ6');
    const { agora } = await porta.relogio(c());
    const os = await porta.gravarSgh(c(), trilhaMan(M(), 'ordem_servico_manutencao'), (g) =>
      g.abrirOs({ natureza: 'corretiva', equipamento: eq.id, centroCusto: M().centro, local: null, descricao: 'Falha intermitente (teste)', contato: null, prioridadeSugerida: 'media', prioridade: 'media', solicitante: M().loginUsuario, registro: agora, parado: false, plano: null, nota: null }),
    );
    const pl = await porta.gravarSgh(c(), trilhaMan(M(), 'plano_preventivo'), (g) =>
      g.incluirPlano({ equipamento: eq.id, atividade: 'preventiva', periodicidade: { quantidade: 6, unidade: 'meses' }, dataBase: '2026-01-15', antecedenciaDias: null, procedimento: null, executor: 'interno', cobertura: null, usuario: M().loginUsuario }),
    );
    const base = { fornecedor: M().fornecedor, cobertura: 'integral' as const, inicio: '2026-01-01', fim: '2026-12-31', slaHoras: 24, valorMensalCent: null, contrato: null, usuario: M().loginUsuario };
    const k = await porta.gravarSgh(c(), trilhaMan(M(), 'contrato_servico_terceirizado'), (g) => g.incluirCobertura({ ...base, numero: 'L0303-C6', equipamentos: [eq.id] }));
    // O contrato do OUTRO estabelecimento (gravado na sessão de lá), para a recusa no de cá.
    const lo = contextoMan(M(), M().outro);
    const kOutro = await porta.gravarSgh(lo, trilhaMan(M(), 'contrato_servico_terceirizado'), (g) => g.incluirCobertura({ ...base, numero: 'L0303-C7', equipamentos: [] }));
    const conta = async () =>
      lerBanco(
        M(),
        `SELECT (SELECT COUNT(*) FROM ordem_servico_manutencao WHERE estabelecimento_id = ?) AS os,
                (SELECT COUNT(*) FROM plano_preventivo WHERE estabelecimento_id = ?) AS planos,
                (SELECT COUNT(*) FROM equipamento_saude WHERE estabelecimento_id = ?) AS eqs,
                (SELECT COUNT(*) FROM contrato_servico_terceirizado WHERE estabelecimento_id = ?) AS contratos,
                (SELECT SUM(versao) FROM ordem_servico_manutencao WHERE estabelecimento_id = ?) AS vos,
                (SELECT SUM(versao) FROM plano_preventivo WHERE estabelecimento_id = ?) AS vpl,
                (SELECT SUM(versao) FROM contrato_servico_terceirizado WHERE estabelecimento_id = ?) AS vct`,
        [M().outro, M().outro, M().outro, M().outro, M().est, M().est, M().est],
      );
    const antes = await conta();
    const recusa = (ctx: typeof lo, fn: Parameters<PortaManutencaoPropria['gravarSgh']>[2]) =>
      porta.gravarSgh(ctx, trilhaMan(M(), 'ordem_servico_manutencao'), fn);
    await expect(
      recusa(lo, (g) => g.abrirOs({ natureza: 'corretiva', equipamento: eq.id, centroCusto: M().centro, local: null, descricao: 'x', contato: null, prioridadeSugerida: 'baixa', prioridade: 'baixa', solicitante: M().loginUsuario, registro: agora, parado: false, plano: null, nota: null })),
    ).rejects.toSatisfy((e) => codigoDe(e) === 'setor-invalido');
    await expect(recusa(lo, (g) => g.incluirEquipamento(equipamento('L0303-EQX')))).rejects.toSatisfy((e) => codigoDe(e) === 'setor-invalido');
    await expect(
      recusa(lo, (g) => g.incluirPlano({ equipamento: eq.id, atividade: 'preventiva', periodicidade: { quantidade: 6, unidade: 'meses' }, dataBase: '2026-01-15', antecedenciaDias: null, procedimento: null, executor: 'interno', cobertura: null, usuario: M().loginUsuario })),
    ).rejects.toSatisfy((e) => codigoDe(e) === 'equipamento-invalido');
    await expect(
      recusa(lo, (g) => g.mudarOs({ id: os.id, versaoVista: 1, de: 'aberta', para: 'emAtendimento', campos: { tecnico: M().loginUsuario, assumidaEm: agora }, usuario: M().loginUsuario, nota: null })),
    ).rejects.toSatisfy((e) => codigoDe(e) === 'desatualizado');
    await expect(
      recusa(lo, (g) => g.alterarPlano({ id: pl.id, versaoVista: 1, periodicidade: { quantidade: 3, unidade: 'meses' }, dataBase: '2026-01-15', antecedenciaDias: null, procedimento: null, executor: 'interno', cobertura: null, motivo: 'Teste de fora', usuario: M().loginUsuario })),
    ).rejects.toSatisfy((e) => codigoDe(e) === 'desatualizado');
    await expect(
      recusa(lo, (g) => g.alterarCobertura({ id: k.id, versaoVista: 1, inicio: '2026-01-01', fim: '2026-12-31', slaHoras: 8, valorMensalCent: null, equipamentos: [], motivo: 'Teste de fora', usuario: M().loginUsuario })),
    ).rejects.toSatisfy((e) => codigoDe(e) === 'desatualizado');
    await expect(
      recusa(c(), (g) => g.incluirPlano({ equipamento: eq.id, atividade: 'preventiva', periodicidade: { quantidade: 6, unidade: 'meses' }, dataBase: '2026-01-15', antecedenciaDias: null, procedimento: null, executor: 'contrato', cobertura: kOutro.id, usuario: M().loginUsuario })),
    ).rejects.toSatisfy((e) => codigoDe(e) === 'contrato-invalido');
    // Laudo: o arquivo de outro estabelecimento é recusado; o daqui fica ligado à execução.
    const laudoFora = await criarArquivoSintetico(M(), M().outro);
    await expect(
      recusa(c(), (g) => g.registrarExecucao({ plano: pl.id, versaoVista: 1, data: '2026-02-01', resultado: 'aprovado', laudo: laudoFora, certificadoPadrao: null, observacao: null, osCorretiva: null, usuario: M().loginUsuario })),
    ).rejects.toSatisfy((e) => codigoDe(e) === 'laudo-invalido');
    await expect(
      recusa(c(), (g) => g.registrarExecucao({ plano: pl.id, versaoVista: 1, data: '2026-02-01', resultado: 'aprovado', laudo: null, certificadoPadrao: null, observacao: null, osCorretiva: 987_654_321, usuario: M().loginUsuario })),
    ).rejects.toSatisfy((e) => codigoDe(e) === 'os-invalida');
    expect(await conta()).toEqual({ ...antes });
    expect((await porta.planoPorId(c(), pl.id))?.versao).toBe(1);
    const laudo = await criarArquivoSintetico(M(), M().est);
    const ex = await porta.gravarSgh(c(), trilhaMan(M(), 'execucao_preventiva'), (g) =>
      g.registrarExecucao({ plano: pl.id, versaoVista: 1, data: '2026-02-01', resultado: 'aprovado', laudo, certificadoPadrao: null, observacao: null, osCorretiva: os.id, usuario: M().loginUsuario }),
    );
    expect(await porta.execucoes(c(), pl.id)).toEqual([expect.objectContaining({ id: ex.id, laudo, osCorretiva: os.id })]);
    expect(
      await lerBanco(M(), 'SELECT COUNT(*) AS n FROM integracao_mensagem WHERE estabelecimento_id IN (?, ?)', [M().est, M().outro]),
    ).toMatchObject({ n: 0 });
  });

  it('plano com dois equipamentos (vindo de fora da tela): lido uma vez e a execução recusada', async () => {
    const a = await novoEquipamento('L0303-EQ7');
    const b = await novoEquipamento('L0303-EQ8');
    const p = await porta.gravarSgh(c(), trilhaMan(M(), 'plano_preventivo'), (g) =>
      g.incluirPlano({ equipamento: a.id, atividade: 'preventiva', periodicidade: { quantidade: 6, unidade: 'meses' }, dataBase: '2026-01-15', antecedenciaDias: null, procedimento: null, executor: 'interno', cobertura: null, usuario: M().loginUsuario }),
    );
    await escreverBanco(M(), 'INSERT INTO plano_preventivo_equipamento (plano_preventivo_id, equipamento_saude_id, criado_em) VALUES (?, ?, ?)', [p.id, b.id, new Date()]);
    expect((await porta.planos(c())).filter((x) => x.id === p.id)).toEqual([expect.objectContaining({ id: p.id, equipamento: Math.min(a.id, b.id) })]);
    expect((await porta.planos(c(), { equipamento: b.id })).map((x) => x.id)).toEqual([p.id]);
    await expect(
      porta.gravarSgh(c(), trilhaMan(M(), 'execucao_preventiva'), (g) =>
        g.registrarExecucao({ plano: p.id, versaoVista: 1, data: '2026-02-01', resultado: 'aprovado', laudo: null, certificadoPadrao: null, observacao: null, osCorretiva: null, usuario: M().loginUsuario }),
      ),
    ).rejects.toSatisfy((e) => codigoDe(e) === 'plano-varios-alvos');
    expect(await porta.execucoes(c(), p.id)).toEqual([]);
  });

  // As regras comuns nas DUAS portas: a mesma entrada, a mesma recusa.
  describe.each([
    ['memória', 'M', (): PortaManutencao => new PortaManutencaoMemoria()],
    ['própria', 'P', (): PortaManutencao => porta],
  ] as const)('regras comuns na porta %s', (_nome, sufixo, fabrica) => {
    it('versão velha, contrato repetido do mesmo fornecedor e contrato com plano dependente', async () => {
      const pt = fabrica();
      const g = <T>(fn: Parameters<PortaManutencao['gravarSgh']>[2]) =>
        pt.gravarSgh(c(), trilhaMan(M(), 'equipamento_saude'), fn) as Promise<T>;
      const eq = await g<{ id: number; versao: number }>((x) => x.incluirEquipamento(equipamento(`L0303-B${sufixo}1`)));
      await g((x) => x.alterarEquipamento({ ...equipamento(`L0303-B${sufixo}1`, { localizacao: 'LEITO 2' }), id: eq.id, versaoVista: 1 }));
      await expect(
        g((x) => x.alterarEquipamento({ ...equipamento(`L0303-B${sufixo}1`), id: eq.id, versaoVista: 1 })),
      ).rejects.toSatisfy((e) => codigoDe(e) === 'desatualizado');
      const base = { fornecedor: M().fornecedor, cobertura: 'maoDeObra' as const, inicio: '2026-01-01', fim: '2026-12-31', slaHoras: 24, valorMensalCent: null, contrato: null, usuario: M().loginUsuario };
      const k = await g<{ id: number }>((x) => x.incluirCobertura({ ...base, numero: `L0303-K${sufixo}`, equipamentos: [eq.id] }));
      await expect(g((x) => x.incluirCobertura({ ...base, numero: `L0303-K${sufixo}`, equipamentos: [] }))).rejects.toSatisfy(
        (e) => codigoDe(e) === 'contrato-repetido',
      );
      await g((x) => x.incluirPlano({ equipamento: eq.id, atividade: 'preventiva', periodicidade: { quantidade: 6, unidade: 'meses' }, dataBase: '2026-01-15', antecedenciaDias: null, procedimento: null, executor: 'contrato', cobertura: k.id, usuario: M().loginUsuario }));
      await expect(g((x) => x.excluirCobertura({ id: k.id, versaoVista: 1, motivo: 'Engano', usuario: M().loginUsuario }))).rejects.toSatisfy(
        (e) => codigoDe(e) === 'com-dependentes',
      );
    });
  });

  it('OS: correção antes de assumida; centro sem setor nem equipamento é recusado', async () => {
    const { agora } = await porta.relogio(c());
    const abrir = (centro: number) =>
      porta.gravarSgh(c(), trilhaMan(M(), 'ordem_servico_manutencao'), (g) =>
        g.abrirOs({ natureza: 'predial', equipamento: null, centroCusto: centro, local: 'CORREDOR', descricao: 'Lâmpada queimada', contato: null, prioridadeSugerida: 'baixa', prioridade: 'baixa', solicitante: M().loginUsuario, registro: agora, parado: false, plano: null, nota: null }),
      );
    await expect(abrir(M().centroSemSetor)).rejects.toSatisfy((e) => codigoDe(e) === 'setor-sem-cadastro');
    const os = await abrir(M().centro);
    const r = await porta.gravarSgh(c(), trilhaMan(M(), 'ordem_servico_manutencao', os.id), (g) =>
      g.corrigirOs({ id: os.id, versaoVista: 1, equipamento: null, centroCusto: M().centro, local: 'CORREDOR B', descricao: 'Lâmpada queimada (corrigido)', prioridadeSugerida: 'media', usuario: M().loginUsuario, nota: 'antes: CORREDOR' }),
    );
    expect(r.versao).toBe(2);
    expect(await porta.os(c(), os.id)).toMatchObject({ local: 'CORREDOR B', prioridade: 'media', situacao: 'aberta' });
  });

  it('aviso da central: uma vez por destinatário e objeto', async () => {
    const aviso = { login: M().loginAvisado, tipo: 'manutencao-parada', gravidade: 'grave' as const, modulo: 'manutencao', evento: 'manutencao.teste', titulo: 'Aviso sintético', link: null, objetoTabela: 'ordem_servico_manutencao', objetoChave: '1' };
    const ids = await porta.gravarSgh(c(), trilhaMan(M(), 'notificacao_usuario'), async (g) => [await g.avisar(aviso), await g.avisar(aviso), await g.avisar({ ...aviso, login: 'ninguem.l0303' })]);
    expect(ids[0]).toBeGreaterThan(0);
    expect(ids.slice(1)).toEqual([null, null]);
    expect(await lerBanco(M(), 'SELECT COUNT(*) AS n, MAX(gravidade) AS g FROM notificacao_usuario WHERE estabelecimento_id = ?', [M().est])).toMatchObject({ n: 1, g: 'alta' });
  });

  it('plano: inclusão (oficina padrão e código), alteração com a versão na trilha, execução e ativação', async () => {
    const eq = await novoEquipamento('L0303-EQ3');
    const p = await porta.gravarSgh(c(), (r: { id: number }) => trilhaMan(M(), 'plano_preventivo', r.id), (g) =>
      g.incluirPlano({ equipamento: eq.id, atividade: 'calibracao', periodicidade: { quantidade: 12, unidade: 'meses' }, dataBase: '2026-01-15', antecedenciaDias: 30, procedimento: 'Calibrar (teste)', executor: 'interno', cobertura: null, usuario: M().loginUsuario }),
    );
    expect(await lerBanco(M(), 'SELECT p.codigo, o.codigo AS oficina FROM plano_preventivo p JOIN oficina_manutencao o ON o.id = p.oficina_manutencao_id WHERE p.id = ?', [p.id])).toMatchObject({ oficina: 'MANUTENCAO' });
    // O plano instalado de um modelo pronto guarda o código e a versão do modelo de origem.
    const eqModelo = await novoEquipamento('L0303-EQ3M');
    const pm = await porta.gravarSgh(c(), trilhaMan(M(), 'plano_preventivo'), (g) =>
      g.incluirPlano({ equipamento: eqModelo.id, atividade: 'preventiva', periodicidade: { quantidade: 6, unidade: 'meses' }, dataBase: '2026-01-15', antecedenciaDias: null, procedimento: null, executor: 'interno', cobertura: null, modelo: { codigo: 'pmocAr', versao: 1 }, usuario: M().loginUsuario }),
    );
    expect((await porta.planoPorId(c(), pm.id))?.modelo).toEqual({ codigo: 'pmocAr', versao: 1 });
    const alt = await porta.gravarSgh(c(), trilhaMan(M(), 'plano_preventivo', p.id), (g) =>
      g.alterarPlano({ id: p.id, versaoVista: 1, periodicidade: { quantidade: 6, unidade: 'meses' }, dataBase: '2026-02-01', antecedenciaDias: 15, procedimento: 'Novo roteiro', executor: 'interno', cobertura: null, motivo: 'Exigência do fabricante', usuario: M().loginUsuario }),
    );
    expect(alt.versao).toBe(2);
    const versoes = await porta.versoesPlano(c(), p.id);
    expect(versoes).toEqual([expect.objectContaining({ versao: 1, periodicidade: { quantidade: 12, unidade: 'meses' }, dataBase: '2026-01-15', motivo: 'Exigência do fabricante', por: M().loginUsuario })]);
    await expect(
      porta.gravarSgh(c(), trilhaMan(M(), 'execucao_preventiva'), (g) =>
        g.registrarExecucao({ plano: p.id, versaoVista: 2, data: '2026-02-01', resultado: 'reprovado', laudo: null, certificadoPadrao: null, observacao: 'curta', osCorretiva: null, usuario: M().loginUsuario }),
      ),
    ).rejects.toSatisfy((e) => codigoDe(e) === 'observacao-curta');
    const ex = await porta.gravarSgh(c(), trilhaMan(M(), 'execucao_preventiva'), (g) =>
      g.registrarExecucao({ plano: p.id, versaoVista: 2, data: '2026-02-01', resultado: 'aprovadoComRestricao', laudo: null, certificadoPadrao: 'CERT-1', observacao: 'Desvio de 2% na faixa alta', osCorretiva: null, usuario: M().loginUsuario }),
    );
    expect(ex.versaoPlano).toBe(3);
    expect(await porta.planoPorId(c(), p.id)).toMatchObject({ versao: 3, equipamento: eq.id, atividade: 'calibracao', ultimaExecucao: '2026-02-01', ultimoResultado: 'aprovadoComRestricao' });
    expect(await porta.execucoes(c(), p.id)).toEqual([expect.objectContaining({ id: ex.id, resultado: 'aprovadoComRestricao', certificadoPadrao: 'CERT-1', por: M().loginUsuario })]);
    await porta.gravarSgh(c(), trilhaMan(M(), 'plano_preventivo', p.id), (g) => g.ativarPlano({ id: p.id, versaoVista: 3, ativo: false, usuario: M().loginUsuario }));
    expect((await porta.planos(c(), { equipamento: eq.id, soAtivos: true })).length).toBe(0);
    expect(await trilhas('plano_preventivo', p.id)).toBe(3);
  });

  it('contrato de manutenção: inclusão, número repetido, alteração dos equipamentos, encerramento e exclusão', async () => {
    const a = await novoEquipamento('L0303-EQ4');
    const b = await novoEquipamento('L0303-EQ5');
    const base = { fornecedor: M().fornecedor, cobertura: 'maoDeObra' as const, inicio: '2026-01-01', fim: '2026-12-31', slaHoras: 24, valorMensalCent: 150_000, contrato: null, usuario: M().loginUsuario };
    const k = await porta.gravarSgh(c(), trilhaMan(M(), 'contrato_servico_terceirizado'), (g) => g.incluirCobertura({ ...base, numero: 'L0303-C1', equipamentos: [a.id] }));
    await expect(
      porta.gravarSgh(c(), trilhaMan(M(), 'contrato_servico_terceirizado'), (g) => g.incluirCobertura({ ...base, numero: 'L0303-C1', equipamentos: [] })),
    ).rejects.toSatisfy((e) => codigoDe(e) === 'contrato-repetido');
    expect(await porta.coberturas(c(), { equipamento: a.id })).toEqual([expect.objectContaining({ id: k.id, cobertura: 'maoDeObra', valorMensalCent: 150_000, ativa: true, equipamentos: [a.id] })]);
    const alt = await porta.gravarSgh(c(), trilhaMan(M(), 'contrato_servico_terceirizado', k.id), (g) =>
      g.alterarCobertura({ id: k.id, versaoVista: 1, inicio: '2026-01-01', fim: '2027-06-30', slaHoras: 12, valorMensalCent: 160_000, equipamentos: [b.id], motivo: 'Aditivo de prazo', usuario: M().loginUsuario }),
    );
    expect(alt).toMatchObject({ versao: 2, retirados: [a.id], incluidos: [b.id] });
    expect((await porta.versoesCobertura(c(), k.id))[0]).toMatchObject({ versao: 1, operacao: 'alteracao', fim: '2026-12-31', equipamentos: [a.id], motivo: 'Aditivo de prazo' });
    const pl = await porta.gravarSgh(c(), trilhaMan(M(), 'plano_preventivo'), async (g) => {
      const r = await g.incluirPlano({ equipamento: b.id, atividade: 'preventiva', periodicidade: { quantidade: 6, unidade: 'meses' }, dataBase: '2026-01-15', antecedenciaDias: null, procedimento: null, executor: 'contrato', cobertura: k.id, usuario: M().loginUsuario });
      return { ...r, ativos: await g.planosAtivosDoContrato(k.id, [b.id]) };
    });
    expect(pl.ativos).toBe(1);
    await expect(
      porta.gravarSgh(c(), trilhaMan(M(), 'contrato_servico_terceirizado', k.id), (g) => g.excluirCobertura({ id: k.id, versaoVista: 2, motivo: 'Engano', usuario: M().loginUsuario })),
    ).rejects.toSatisfy((e) => codigoDe(e) === 'com-dependentes');
    const enc = await porta.gravarSgh(c(), trilhaMan(M(), 'contrato_servico_terceirizado', k.id), (g) => g.encerrarCobertura({ id: k.id, versaoVista: 2, data: '2026-06-30', motivo: 'Rescisão amigável', usuario: M().loginUsuario }));
    expect(enc.versao).toBe(3);
    expect((await porta.coberturas(c(), { ids: [k.id] }))[0]).toMatchObject({ ativa: false, encerradaEm: '2026-06-30', motivoEncerramento: 'Rescisão amigável' });
    const k2 = await porta.gravarSgh(c(), trilhaMan(M(), 'contrato_servico_terceirizado'), (g) => g.incluirCobertura({ ...base, numero: 'L0303-C2', equipamentos: [a.id] }));
    await porta.gravarSgh(c(), trilhaMan(M(), 'contrato_servico_terceirizado', k2.id), (g) => g.excluirCobertura({ id: k2.id, versaoVista: 1, motivo: 'Registrado por engano', usuario: M().loginUsuario }));
    expect(await porta.coberturas(c(), { ids: [k2.id] })).toEqual([]);
    expect(await lerBanco(M(), 'SELECT excluido_em IS NOT NULL AS excluido FROM contrato_servico_terceirizado WHERE id = ?', [k2.id])).toMatchObject({ excluido: 1 });
  });

  it('contrato de manutenção ligado ao contrato de suprimentos: o do mesmo fornecedor e unidade grava e é relido; outro recusa', async () => {
    const cf = (est: number, fornecedor: number, numero: string) =>
      escreverBanco(
        M(),
        `INSERT INTO contrato_fornecedor (estabelecimento_id, numero, objeto, empresa_fornecedora_id, tipo, data_emissao,
           vigencia_inicio, criado_em) VALUES (?, ?, 'Manutenção de equipamentos (teste)', ?, 'manutencao', '2026-01-01', '2026-01-01', NOW())`,
        [est, numero, fornecedor],
      );
    const outroFornecedor =
      Number((await lerBanco(M(), 'SELECT id FROM empresa_fornecedora WHERE cnpj = ?', ['99030300000200']))?.['id'] ?? 0) ||
      (await escreverBanco(
        M(),
        "INSERT INTO empresa_fornecedora (tipo_pessoa, cnpj, razao_social, nome_fantasia, criado_em) VALUES ('juridica', ?, 'OUTRA ENGENHARIA SINTETICA L0303', 'OUTRA ENG L0303', NOW())",
        ['99030300000200'],
      ));
    const doFornecedor = await cf(M().est, M().fornecedor, 'L0303-CF1');
    const deOutroFornecedor = await cf(M().est, outroFornecedor, 'L0303-CF2');
    const deOutraUnidade = await cf(M().outro, M().fornecedor, 'L0303-CF3');
    const a = await novoEquipamento('L0303-EQ12');
    const base = { fornecedor: M().fornecedor, cobertura: 'integral' as const, inicio: '2026-01-01', fim: '2026-12-31', slaHoras: 24, valorMensalCent: null, usuario: M().loginUsuario };
    const k = await porta.gravarSgh(c(), trilhaMan(M(), 'contrato_servico_terceirizado'), (g) =>
      g.incluirCobertura({ ...base, numero: 'L0303-C11', contrato: doFornecedor, equipamentos: [a.id] }),
    );
    expect(Number((await lerBanco(M(), 'SELECT contrato_fornecedor_id AS c FROM contrato_servico_terceirizado WHERE id = ?', [k.id]))?.['c'])).toBe(doFornecedor);
    expect((await porta.coberturas(c(), { ids: [k.id] }))[0]).toMatchObject({ contrato: doFornecedor });
    for (const [contrato, numero] of [
      [deOutroFornecedor, 'L0303-C12'],
      [deOutraUnidade, 'L0303-C13'],
    ] as const)
      await expect(
        porta.gravarSgh(c(), trilhaMan(M(), 'contrato_servico_terceirizado'), (g) => g.incluirCobertura({ ...base, numero, contrato, equipamentos: [] })),
      ).rejects.toSatisfy((e) => codigoDe(e) === 'contrato-fornecedor-invalido');
    expect(
      await lerBanco(M(), "SELECT COUNT(*) AS n FROM contrato_servico_terceirizado WHERE estabelecimento_id = ? AND numero IN ('L0303-C12', 'L0303-C13')", [M().est]),
    ).toMatchObject({ n: 0 });
  });

  it('recusa no meio da operação: desfaz tudo o que a mesma transação já tinha gravado', async () => {
    await expect(
      porta.gravarSgh(c(), trilhaMan(M(), 'equipamento_saude'), async (g) => {
        await g.incluirEquipamento(equipamento('L0303-EQ9'));
        return g.vincularCursoModelo({ fabricante: 'L0303M FABRICANTE SINTETICO', modelo: 'MX-1', curso: 2_000_000_000, usuario: M().loginUsuario });
      }),
    ).rejects.toSatisfy((e) => codigoDe(e) === 'curso-inativo');
    expect(await porta.equipamentoPorCodigo(c(), 'L0303-EQ9')).toBeNull();
    expect((await porta.catalogoCursos(c())).find((x) => x.id === M().curso)).toMatchObject({ codigo: 'L0303M-OPER', validadeMeses: 24, ativo: true });
    expect(await porta.conclusoesDosCursos(c(), [M().curso])).toEqual([]);
    expect(await porta.alertas(c())).toEqual([]);
  });
});
