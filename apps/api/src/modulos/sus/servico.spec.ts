// Serviço do faturamento SUS (M51, etapa 1) sobre a porta em memória (massa sintética): abrir → criticar → corrigir o
// equivalente → criticar de novo → gerar a CIHA com hash → baixar conferindo o hash → fechar e reabrir; as recusas
// (competência futura, escopo parcial, versão, bloqueante, crítica não executada) e a trilha
// sem dado pessoal.
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { armazemSusMemoria } from './armazem.js';
import { montarCihaDaCompetencia } from './montagem.js';
import { PortaSusMemoria, PROCEDIMENTO_SEM_EQUIVALENTE_SINTETICO } from './porta-memoria.js';
import type { ContextoSus, GravacaoSus } from './porta.js';
import { ACAO_EQUIVALENCIA_SUS_REDE, ServicoSus, type SessaoSus } from './servico.js';

const LISTA = { inativas: 'nao', pagina: 0, porPagina: 50 } as const;

function sessao(extra: Partial<SessaoSus> = {}): SessaoSus {
  return {
    rede: 'rede-teste',
    hospital: 'pc',
    login: 'FATURISTA.SINT',
    hoje: '2026-10-25',
    convenios: null,
    parametros: {
      cnes: '',
      conveniosSus: [1],
      conveniosParticular: [10],
      fontePadrao: 'plano-privado',
      fontePorConvenio: new Map([[10, 'particular-pf']]),
      habilitacoes: new Set<string>(),
      bpa: {
        orgaoOrigem: 'HOSPITAL SINTETICO',
        siglaOrigem: 'HSINT',
        cnpj: '11222333000181',
        orgaoDestino: 'SECRETARIA MUNICIPAL DE SAUDE',
        indicadorDestino: 'M',
      },
      apac: { uf: '33' },
    },
    pode: (acao) => acao === ACAO_EQUIVALENCIA_SUS_REDE,
    trilha: (evento, operacao, alvo) => ({
      rede: 'rede-teste',
      hospital: 'pc',
      usuario: 'FATURISTA.SINT',
      evento,
      recurso: 'faturamento.sus',
      operacao,
      tabelaAlvo: alvo.tabela,
      idAlvo: alvo.id,
      chaveNaturalAlvo: null,
      resultado: 'sucesso',
      estacao: 'TESTE',
      correlacao: 'c',
      ...(alvo.diferenca ? { diferenca: alvo.diferenca } : {}),
    }),
    ...extra,
  };
}

const recusa = (codigo: string) => expect.objectContaining({ extras: expect.objectContaining({ codigo }) });

describe('faturamento SUS: competência, crítica e CIHA', () => {
  it('o caminho inteiro, com a correção da equivalência e o arquivo com hash', async () => {
    const porta = new PortaSusMemoria();
    const armazem = armazemSusMemoria();
    const sv = new ServicoSus(porta, armazem);
    const s = sessao();
    const aberta = await sv.abrir(s, { instrumento: 'ciha', competencia: '202609' });
    expect(aberta).toMatchObject({ situacao: 'aberta', criticadaEm: null, liberada: true });
    await expect(sv.abrir(s, { instrumento: 'ciha', competencia: '202609' })).rejects.toEqual(
      recusa('competencia-ja-aberta'),
    );
    await expect(sv.gerarCiha(s, { competencia: '202609', versao: aberta.versao })).rejects.toEqual(
      recusa('critica-nao-executada'),
    );

    const r1 = await sv.criticar(s, { instrumento: 'ciha', competencia: '202609' });
    expect(r1).toMatchObject({ registros: 4, foraPorSerSus: 0, bloqueantes: 1, avisos: 1 });
    expect(r1.porRegra).toEqual({ 'sem-sigtap': 1, 'item-sem-sigtap': 1 });
    const pag = await sv.listarCriticas(s, {
      instrumento: 'ciha',
      competencia: '202609',
      pagina: 0,
      porPagina: 50,
    });
    expect(pag.itens.map((x) => [x.regra, x.gravidade, x.detalhe['procedimentos']])).toEqual([
      ['sem-sigtap', 'bloqueante', String(PROCEDIMENTO_SEM_EQUIVALENTE_SINTETICO)],
      ['item-sem-sigtap', 'aviso', '7002'],
    ]);
    // A tela mostra o código na tabela, o nome e a tabela do procedimento do hospital (não o ID unificado).
    expect(pag.itens.map((x) => x.detalhe['procedimentosNomes'])).toEqual([
      '40801012 ELETROCARDIOGRAMA SINTETICO (1 TABELA SINTETICA A)',
      '40801020 TESTE ERGOMETRICO SINTETICO (1 TABELA SINTETICA A)',
    ]);
    await expect(sv.gerarCiha(s, { competencia: '202609', versao: r1.competencia.versao })).rejects.toEqual(
      recusa('criticas-bloqueantes-abertas'),
    );

    await expect(
      sv.registrarEquivalencia(s, {
        procedimento: PROCEDIMENTO_SEM_EQUIVALENTE_SINTETICO,
        sigtap: '0000000000',
      }),
    ).rejects.toEqual(recusa('sigtap-inexistente'));
    await expect(sv.registrarEquivalencia(s, { procedimento: 4242, sigtap: '0211020036' })).rejects.toEqual(
      recusa('procedimento-inexistente'),
    );
    expect(await sv.buscarSigtap(s, 'eletrocardio', '202609')).toEqual([
      { id: 9004, codigo: '0211020036', nome: 'PROCEDIMENTO SINTETICO DE ELETROCARDIOGRAFIA', vigente: true },
    ]);
    // O mesmo código em duas tabelas: dois procedimentos do hospital (a busca mostra a tabela).
    expect(
      (await sv.buscarProcedimentosHospital(s, { termo: '40801012' })).map((x) => [x.id, x.tabela]),
    ).toEqual([
      [7001, '1 TABELA SINTETICA A'],
      [7101, '2 TABELA SINTETICA B'],
    ]);
    const eq = await sv.registrarEquivalencia(s, {
      procedimento: PROCEDIMENTO_SEM_EQUIVALENTE_SINTETICO,
      sigtap: '0211020036',
    });
    expect(eq).toMatchObject({
      mudou: true,
      equivalencia: {
        sigtap: '0211020036',
        procedimentoCodigo: 40801012,
        procedimentoNome: 'ELETROCARDIOGRAMA SINTETICO',
        sigtapNome: 'PROCEDIMENTO SINTETICO DE ELETROCARDIOGRAFIA',
        ativa: true,
      },
    });
    // Já existe: sem a versão lida (ou com a velha), a troca é recusada; nunca sobrescreve em silêncio.
    await expect(
      sv.registrarEquivalencia(s, {
        procedimento: PROCEDIMENTO_SEM_EQUIVALENTE_SINTETICO,
        sigtap: '0301010072',
      }),
    ).rejects.toMatchObject({ status: 409, extras: expect.objectContaining({ codigo: 'versao-alterada' }) });
    expect(
      (
        await sv.registrarEquivalencia(s, {
          procedimento: PROCEDIMENTO_SEM_EQUIVALENTE_SINTETICO,
          sigtap: '0211020036',
          versao: eq.equivalencia.versao,
        })
      ).mudou,
    ).toBe(false);
    const listadas = await sv.listarEquivalencias(s, { ...LISTA, termo: 'eletro' });
    expect(listadas.total).toBe(1);
    expect(listadas.itens[0]).toMatchObject({ procedimento: 7001, tabela: '1 TABELA SINTETICA A' });

    const r2 = await sv.criticar(s, { instrumento: 'ciha', competencia: '202609' });
    expect(r2).toMatchObject({ registros: 5, bloqueantes: 0, avisos: 1, corrigidas: 1 });
    // Ficha, seção 5: "fechamento com críticas tratadas": o aviso aberto impede o fechamento.
    await expect(
      sv.fechar(s, { instrumento: 'ciha', competencia: '202609', versao: r2.competencia.versao }),
    ).rejects.toEqual(recusa('avisos-nao-justificados'));
    const aviso = (
      await sv.listarCriticas(s, { instrumento: 'ciha', competencia: '202609', pagina: 0, porPagina: 50 })
    ).itens[0]!;
    const justificada = await sv.justificar(s, {
      critica: aviso.id,
      versao: aviso.versao,
      justificativa: 'Material sem procedimento SIGTAP equivalente',
    });
    expect(justificada).toMatchObject({ situacao: 'justificada' });
    expect((await sv.listarCompetencias(s, 'ciha'))[0]).toMatchObject({ avisos: 0 });
    await expect(
      sv.justificar(s, { critica: aviso.id, versao: aviso.versao, justificativa: 'de novo, outra vez' }),
    ).rejects.toEqual(recusa('versao-alterada'));
    const corrigidas = await sv.listarCriticas(s, {
      instrumento: 'ciha',
      competencia: '202609',
      situacao: 'corrigida',
      pagina: 0,
      porPagina: 50,
    });
    expect(corrigidas.itens.map((x) => x.regra)).toEqual(['sem-sigtap']);

    const comp = (await sv.listarCompetencias(s, 'ciha'))[0]!;
    await expect(sv.gerarCiha(s, { competencia: '202609', versao: '0000000001' })).rejects.toEqual(
      recusa('versao-alterada'),
    );
    const g = await sv.gerarCiha(s, { competencia: '202609', versao: comp.versao });
    expect(g.arquivo).toMatchObject({
      instrumento: 'ciha',
      leiaute: 'CIHA01',
      versaoLeiaute: '1.0.4.0',
      conferidoContraOficial: true,
      registros: 5,
      semMovimento: false,
      situacao: 'gerado',
      nomeArquivo: 'CIHA_9999991_202609.TXT',
    });
    // A guarda definitiva é fixada depois do COMMIT.
    expect([...armazem.fixados]).toEqual([...armazem.objetos.keys()]);
    const b = await sv.baixar(s, g.arquivo.id);
    expect(createHash('sha256').update(b.conteudo).digest('hex')).toBe(g.arquivo.hash);
    expect(Buffer.from(b.conteudo).toString('ascii').split('\r\n')[0]).toBe('199999911.0.4.0');

    const g2 = await sv.gerarCiha(s, { competencia: '202609', versao: g.competencia.versao });
    expect(g2.substituidos).toBe(1);
    expect((await sv.listarArquivos(s, 'ciha', '202609')).map((a) => a.situacao)).toEqual([
      'gerado',
      'substituido',
    ]);
    expect(g2.arquivo.hash).toBe(g.arquivo.hash);

    const fechada = await sv.fechar(s, {
      instrumento: 'ciha',
      competencia: '202609',
      versao: g2.competencia.versao,
    });
    expect(fechada).toMatchObject({ situacao: 'fechada', fechadaPor: 'FATURISTA.SINT' });
    await expect(sv.criticar(s, { instrumento: 'ciha', competencia: '202609' })).rejects.toEqual(
      recusa('competencia-ja-fechada'),
    );
    await expect(
      sv.reabrir(s, {
        instrumento: 'ciha',
        competencia: '202609',
        versao: '0000000001',
        justificativa: 'motivo longo o bastante',
      }),
    ).rejects.toEqual(recusa('versao-alterada'));
    const reaberta = await sv.reabrir(s, {
      instrumento: 'ciha',
      competencia: '202609',
      versao: fechada.versao,
      justificativa: 'Correção de CID após auditoria',
    });
    expect(reaberta).toMatchObject({ situacao: 'aberta', reabertaPor: 'FATURISTA.SINT' });
    await expect(
      sv.reabrir(s, {
        instrumento: 'ciha',
        competencia: '202609',
        versao: reaberta.versao,
        justificativa: 'motivo longo o bastante',
      }),
    ).rejects.toEqual(recusa('competencia-nao-fechada'));

    // Regra 10: a trilha leva competência, contagens e hash; nunca nome, CPF ou endereço da massa.
    const texto = JSON.stringify(porta.trilhas);
    expect(porta.trilhas.map((t) => t.evento)).toEqual(
      expect.arrayContaining([
        'faturamento.competenciaSus.aberta',
        'faturamento.criticaSus.executada',
        'faturamento.equivalenciaSus.registrada',
        'faturamento.criticaSus.justificada',
        'faturamento.ciha.gerada',
        'faturamento.arquivoSus.baixado',
        'faturamento.competenciaSus.fechada',
        'faturamento.competenciaSus.reaberta',
      ]),
    );
    expect(texto).toContain(`sha256=${g.arquivo.hash}`);
    expect(texto).not.toMatch(/PACIENTE SINTETICO|RUA SINTETICA|10000000\d{3}/);
  });

  it('recusas: competência futura, escopo parcial e competência inexistente', async () => {
    const sv = new ServicoSus(new PortaSusMemoria(), armazemSusMemoria());
    const s = sessao();
    await expect(sv.abrir(s, { instrumento: 'ciha', competencia: '202612' })).rejects.toEqual(
      recusa('competencia-futura'),
    );
    await expect(
      sv.listarCriticas(s, { instrumento: 'ciha', competencia: '202601', pagina: 0, porPagina: 10 }),
    ).rejects.toMatchObject({ tipo: 'nao-encontrado' });
    const parcial = sessao({ convenios: [20] });
    const c = await sv.abrir(parcial, { instrumento: 'ciha', competencia: '202609' });
    await sv.criticar(parcial, { instrumento: 'ciha', competencia: '202609' });
    // Só as críticas dos convênios do escopo (a do particular, 10, fica de fora).
    const lidas = await sv.listarCriticas(parcial, {
      instrumento: 'ciha',
      competencia: '202609',
      pagina: 0,
      porPagina: 10,
    });
    expect(lidas.itens.map((x) => x.regra)).toEqual(['sem-sigtap']);
    await expect(sv.gerarCiha(parcial, { competencia: '202609', versao: c.versao })).rejects.toEqual(
      recusa('escopo-parcial'),
    );
    await expect(
      sv.fechar(parcial, { instrumento: 'ciha', competencia: '202609', versao: c.versao }),
    ).rejects.toEqual(recusa('escopo-parcial'));
    await expect(sv.baixar(parcial, 1)).rejects.toEqual(recusa('escopo-parcial'));
    // A equivalência vale para todos os convênios do estabelecimento: escopo parcial não a registra nem desativa.
    await expect(
      sv.registrarEquivalencia(parcial, {
        procedimento: PROCEDIMENTO_SEM_EQUIVALENTE_SINTETICO,
        sigtap: '0211020036',
      }),
    ).rejects.toEqual(recusa('escopo-parcial'));
    await expect(
      sv.desativarEquivalencia(parcial, {
        procedimento: PROCEDIMENTO_SEM_EQUIVALENTE_SINTETICO,
        versao: '0000000001',
      }),
    ).rejects.toEqual(recusa('escopo-parcial'));
    // A equivalência vale para a rede inteira: sem a ação de nível rede, nem registra nem desativa (403).
    const semRede = sessao({ pode: () => false });
    const { pode, ...semPode } = sessao();
    void pode;
    await expect(
      sv.registrarEquivalencia(semRede, {
        procedimento: PROCEDIMENTO_SEM_EQUIVALENTE_SINTETICO,
        sigtap: '0211020036',
      }),
    ).rejects.toEqual(recusa('equivalencia-sem-acesso-rede'));
    await expect(
      sv.desativarEquivalencia(semPode, {
        procedimento: PROCEDIMENTO_SEM_EQUIVALENTE_SINTETICO,
        versao: '0000000001',
      }),
    ).rejects.toEqual(recusa('equivalencia-sem-acesso-rede'));
    await expect(sv.baixar(s, 999)).rejects.toMatchObject({ tipo: 'nao-encontrado' });
    const comp = (await sv.listarCompetencias(s, null))[0]!;
    await expect(
      sv.fechar(s, { instrumento: 'ciha', competencia: '202609', versao: comp.versao }),
    ).rejects.toEqual(recusa('criticas-bloqueantes-abertas'));
    const aberta2 = await sv.abrir(s, { instrumento: 'ciha', competencia: '202608' });
    await expect(
      sv.fechar(s, { instrumento: 'ciha', competencia: '202608', versao: aberta2.versao }),
    ).rejects.toEqual(recusa('critica-nao-executada'));
  });

  it('a montagem: CNES do parâmetro (ou do cadastro, quando é um só), convênio SUS fora e a fonte por convênio', async () => {
    const porta = new PortaSusMemoria();
    const dados = await porta.ler({ rede: 'r', hospital: 'pc' }, (l) =>
      l.dadosCiha({ inicio: '2026-09-01', fim: '2026-09-30' }, [], []),
    );
    const base = sessao().parametros;
    const m = montarCihaDaCompetencia('202609', dados, { ...base, cnes: '3132471' }, []);
    expect(m.cnes).toBe('3132471');
    expect(m.resultado.foraPorSerSus).toBe(1);
    expect(m.registros.map((r) => r.fonte)).toEqual([
      'plano-privado',
      'particular-pf',
      'plano-privado',
      'particular-pf',
    ]);
    expect(m.criticas.every((c) => c.chave.length > 0 && !/SINTETICO/.test(c.detalhe))).toBe(true);
    const semCnes = montarCihaDaCompetencia('202609', { ...dados, cnesCadastrados: [1, 2] }, base, []);
    expect(semCnes.cnes).toBeNull();
    expect(semCnes.criticas.some((c) => c.regra === 'sem-cnes')).toBe(true);
    const semFonte = montarCihaDaCompetencia(
      '202609',
      dados,
      { ...base, fontePadrao: null, fontePorConvenio: new Map([[10, 'invalida']]) },
      [],
    );
    expect(semFonte.criticas.filter((c) => c.regra === 'fonte-remuneracao-indefinida')).toHaveLength(5);
  });

  it('o arquivo guardado que não confere com o hash não é entregue', async () => {
    const armazem = armazemSusMemoria();
    const sv = new ServicoSus(new PortaSusMemoria(), armazem);
    const s = sessao();
    await sv.abrir(s, { instrumento: 'ciha', competencia: '202609' });
    await sv.registrarEquivalencia(s, {
      procedimento: PROCEDIMENTO_SEM_EQUIVALENTE_SINTETICO,
      sigtap: '0211020036',
    });
    const r = await sv.criticar(s, { instrumento: 'ciha', competencia: '202609' });
    const g = await sv.gerarCiha(s, { competencia: '202609', versao: r.competencia.versao });
    const [chave] = [...armazem.objetos.keys()];
    armazem.objetos.set(chave!, new TextEncoder().encode('adulterado'));
    await expect(sv.baixar(s, g.arquivo.id)).rejects.toMatchObject({ tipo: 'indisponivel' });
    await expect(armazem.guardar(chave!, new Uint8Array())).rejects.toThrow(/já está guardado/);
  });

  it('a equivalência é do procedimento unificado: a do 7001 não corrige o 7101 (mesmo código, outra tabela); desativar devolve a crítica', async () => {
    const porta = new PortaSusMemoria();
    const sv = new ServicoSus(porta, armazemSusMemoria());
    const s = sessao();
    await sv.abrir(s, { instrumento: 'ciha', competencia: '202609' });
    const eq = await sv.registrarEquivalencia(s, { procedimento: 7101, sigtap: '0211020036' });
    let r = await sv.criticar(s, { instrumento: 'ciha', competencia: '202609' });
    expect(r.porRegra['sem-sigtap']).toBe(1);
    await sv.desativarEquivalencia(s, { procedimento: 7101, versao: eq.equivalencia.versao });
    const e7001 = await sv.registrarEquivalencia(s, {
      procedimento: PROCEDIMENTO_SEM_EQUIVALENTE_SINTETICO,
      sigtap: '0211020036',
    });
    r = await sv.criticar(s, { instrumento: 'ciha', competencia: '202609' });
    expect(r.porRegra['sem-sigtap']).toBeUndefined();
    await expect(
      sv.desativarEquivalencia(s, { procedimento: 7001, versao: '0000000009' }),
    ).rejects.toMatchObject({ status: 409 });
    const desativada = await sv.desativarEquivalencia(s, {
      procedimento: 7001,
      versao: e7001.equivalencia.versao,
    });
    expect(desativada).toMatchObject({ ativa: false });
    r = await sv.criticar(s, { instrumento: 'ciha', competencia: '202609' });
    expect(r.porRegra['sem-sigtap']).toBe(1);
    // As desativadas só aparecem com o filtro; a reativação pede a versão lida.
    expect((await sv.listarEquivalencias(s, LISTA)).total).toBe(0);
    const todas = await sv.listarEquivalencias(s, { ...LISTA, inativas: 'sim' });
    expect(todas.itens.map((x) => [x.procedimento, x.ativa]).sort()).toEqual([
      [7001, false],
      [7101, false],
    ]);
    const reativada = await sv.registrarEquivalencia(s, {
      procedimento: 7001,
      sigtap: '0211020036',
      versao: desativada.versao,
    });
    expect(reativada).toMatchObject({ mudou: true, equivalencia: { ativa: true } });
    expect(porta.trilhas.map((t) => t.evento)).toContain('faturamento.equivalenciaSus.desativada');
  });

  it('gerarCiha: a recusa na transação não deixa objeto guardado; a falha depois de guardar remove o objeto', async () => {
    class PortaComFalha extends PortaSusMemoria {
      antesDaTransacao: (() => void) | null = null;
      falharNoArquivo = false;
      override async gravar<T>(c: ContextoSus, fn: (g: GravacaoSus) => Promise<T>): Promise<T> {
        return super.gravar(c, async (g) => {
          const antes = this.antesDaTransacao;
          this.antesDaTransacao = null;
          antes?.();
          const falhar = this.falharNoArquivo;
          return fn({
            ...g,
            gravarArquivo: async (a, r) => {
              if (falhar) throw new Error('falha simulada na gravação do arquivo');
              return g.gravarArquivo(a, r);
            },
          });
        });
      }
    }
    const porta = new PortaComFalha();
    const armazem = armazemSusMemoria();
    const sv = new ServicoSus(porta, armazem);
    const s = sessao();
    await sv.abrir(s, { instrumento: 'ciha', competencia: '202609' });
    await sv.registrarEquivalencia(s, {
      procedimento: PROCEDIMENTO_SEM_EQUIVALENTE_SINTETICO,
      sigtap: '0211020036',
    });
    const r = await sv.criticar(s, { instrumento: 'ciha', competencia: '202609' });
    // Outra pessoa muda a competência entre a montagem e a transação (a 1ª gravação é a reserva do ID).
    let chamadas = 0;
    porta.antesDaTransacao = () => {
      chamadas += 1;
    };
    const original = porta.gravar.bind(porta);
    porta.gravar = async (c, fn) => {
      if (chamadas === 1) {
        const comp = porta.estadoDe('pc').competencias[0] as { versao: number };
        comp.versao += 1;
      }
      return original(c, fn);
    };
    await expect(sv.gerarCiha(s, { competencia: '202609', versao: r.competencia.versao })).rejects.toEqual(
      recusa('versao-alterada'),
    );
    expect(armazem.objetos.size).toBe(0);
    porta.gravar = original;
    const atual = (await sv.listarCompetencias(s, 'ciha'))[0]!;
    porta.falharNoArquivo = true;
    await expect(sv.gerarCiha(s, { competencia: '202609', versao: atual.versao })).rejects.toThrow(
      'falha simulada',
    );
    expect(armazem.objetos.size).toBe(0);
    expect(porta.estadoDe('pc').arquivos).toHaveLength(0);
    porta.falharNoArquivo = false;
    const g = await sv.gerarCiha(s, { competencia: '202609', versao: atual.versao });
    expect(armazem.objetos.size).toBe(1);
    expect(armazem.fixados.size).toBe(1);
    expect(g.arquivo.situacao).toBe('gerado');
  });
});
