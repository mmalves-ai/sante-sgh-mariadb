// Serviço do faturamento SUS, etapa 2 (BPA), sobre a porta em memória (massa SINTÉTICA): tudo ligado (F3.7);
// ligado: abrir → criticar (o validador de compatibilidade e o item sem equivalente) → equivalência do hospital → criticar
// de novo → gerar o BPA-C e o BPA-I com hash → as linhas sem dado pessoal → baixar pela rota do BPA (a da CIHA não
// entrega) → a trilha sem dado pessoal; as recusas (escopo parcial, versão, cabeçalho incompleto, sem produção).
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { armazemSusMemoria } from './armazem.js';
import {
  cnsSintetico,
  PortaSusMemoria,
  PROCEDIMENTO_BPA_SEM_EQUIVALENTE_SINTETICO,
} from './porta-memoria.js';
import { ACAO_EQUIVALENCIA_SUS_REDE, ServicoSus, type SessaoSus } from './servico.js';

function sessao(extra: Partial<SessaoSus> = {}): SessaoSus {
  return {
    rede: 'rede-teste',
    hospital: 'pc',
    login: 'FATURISTA.SINT',
    hoje: '2026-10-25',
    convenios: null,
    parametros: {
      cnes: '9999991',
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

describe('faturamento SUS, etapa 2: BPA', () => {
  it('o caminho inteiro: crítica, equivalência, BPA-C e BPA-I com hash, linhas, download e trilha', async () => {
    const porta = new PortaSusMemoria();
    const armazem = armazemSusMemoria();
    const sv = new ServicoSus(porta, armazem);
    const s = sessao();
    const aberta = await sv.abrir(s, { instrumento: 'bpa', competencia: '202609' });
    expect(aberta).toMatchObject({ instrumento: 'bpa', liberada: true });
    await expect(sv.gerarBpa(s, { competencia: '202609', versao: aberta.versao })).rejects.toEqual(
      recusa('critica-nao-executada'),
    );
    const r1 = await sv.criticar(s, { instrumento: 'bpa', competencia: '202609' });
    // A produção SUS sintética: 4 fichas; a do MAPA sem equivalente fica fora; nenhuma não SUS na massa do BPA.
    expect(r1.porRegra).toEqual({ 'sem-sigtap': 1 });
    expect(r1).toMatchObject({ registros: 3, foraPorSerSus: 0, bloqueantes: 1, avisos: 0 });
    const c1 = await sv.listarCriticas(s, {
      instrumento: 'bpa',
      competencia: '202609',
      pagina: 0,
      porPagina: 50,
    });
    expect(c1.itens.map((x) => [x.regra, x.origem.conta])).toEqual([['sem-sigtap', 810_024]]);
    // A tela mostra o procedimento do hospital sem equivalente pelo código e nome (a equivalência do hospital o corrige).
    expect(c1.itens[0]?.detalhe['procedimentosNomes']).toBe(
      '40805010 MAPA SINTETICO DE 24 HORAS (1 TABELA SINTETICA A)',
    );
    const v1 = (await sv.listarCompetencias(s, 'bpa'))[0]!;
    await expect(sv.gerarBpa(s, { competencia: '202609', versao: v1.versao })).rejects.toEqual(
      recusa('criticas-bloqueantes-abertas'),
    );

    // A equivalência do hospital do MAPA sintético para o exame (só BPA-C) corrige a crítica (D-EQUIV-BPA-51).
    await sv.registrarEquivalencia(s, {
      procedimento: PROCEDIMENTO_BPA_SEM_EQUIVALENTE_SINTETICO,
      sigtap: '0202010295',
    });
    const r2 = await sv.criticar(s, { instrumento: 'bpa', competencia: '202609' });
    expect(r2).toMatchObject({ registros: 4, bloqueantes: 0, corrigidas: 1 });

    // 06-SUS linha 54: a produção acima de um teto que bloqueia (o complemento da crítica) impede a geração, na hora.
    let tetoEstourado = true;
    sv.registrarComplementoCritica(async (_s, instrumento, competencia) =>
      tetoEstourado
        ? [
            {
              chave: `teto:1:${instrumento}:${competencia}`,
              regra: 'producao-acima-do-teto',
              gravidade: 'bloqueante' as const,
              conta: null,
              convenio: null,
              atendimento: null,
              item: null,
              detalhe: JSON.stringify({ limite: 'teto', id: 1, saldoValor: -5 }),
            },
          ]
        : [],
    );
    const r3 = await sv.criticar(s, { instrumento: 'bpa', competencia: '202609' });
    expect(r3).toMatchObject({ bloqueantes: 1 });
    expect(r3.porRegra).toMatchObject({ 'producao-acima-do-teto': 1 });
    const c3 = await sv.listarCriticas(s, {
      instrumento: 'bpa',
      competencia: '202609',
      pagina: 0,
      porPagina: 50,
    });
    expect(c3.itens.map((x) => x.regra)).toContain('producao-acima-do-teto');
    const v3 = (await sv.listarCompetencias(s, 'bpa'))[0]!;
    await expect(sv.gerarBpa(s, { competencia: '202609', versao: v3.versao })).rejects.toEqual(
      recusa('criticas-bloqueantes-abertas'),
    );
    // O teto ampliado (o complemento sem estouro): a crítica de novo libera a geração.
    tetoEstourado = false;
    expect(await sv.criticar(s, { instrumento: 'bpa', competencia: '202609' })).toMatchObject({
      bloqueantes: 0,
    });
    const comp = (await sv.listarCompetencias(s, 'bpa'))[0]!;
    await expect(sv.gerarBpa(s, { competencia: '202609', versao: '0000000001' })).rejects.toEqual(
      recusa('versao-alterada'),
    );
    const g = await sv.gerarBpa(s, { competencia: '202609', versao: comp.versao });
    expect(g.arquivo).toMatchObject({
      instrumento: 'bpa',
      leiaute: 'BPA-MAG',
      versaoLeiaute: '04.10',
      conferidoContraOficial: false,
      nomeArquivo: 'PA9999991202609.SET',
      registros: 4,
      situacao: 'gerado',
    });

    // As linhas: o exame somado no consolidado (2 + 1), a consulta sem CNS também consolidada, a com CNS individualizada.
    const linhas = await sv.listarLinhasBpa(s, { arquivo: g.arquivo.id, pagina: 0, porPagina: 50 });
    expect(linhas.porTipo).toEqual({ c: { linhas: 2, quantidade: 4 }, i: { linhas: 1, quantidade: 1 } });
    expect(linhas.itens.map((x) => [x.tipo, x.procedimento, x.quantidade, x.conta])).toEqual([
      ['c', '0202010295', 3, null],
      ['c', '0301010072', 1, null],
      ['i', '0301010072', 1, 810_021],
    ]);
    expect(JSON.stringify(linhas)).not.toContain('PACIENTE');
    const soI = await sv.listarLinhasBpa(s, { arquivo: g.arquivo.id, tipo: 'i', pagina: 0, porPagina: 50 });
    expect(soI.total).toBe(1);
    // As linhas cobrem todos os convênios SUS: quem tem escopo parcial não as lista (como não baixa o arquivo).
    await expect(
      sv.listarLinhasBpa(sessao({ convenios: [20] }), { arquivo: g.arquivo.id, pagina: 0, porPagina: 50 }),
    ).rejects.toEqual(recusa('escopo-parcial'));

    // O download pela rota do BPA confere o hash; a rota da CIHA não entrega o arquivo do BPA.
    const b = await sv.baixar(s, g.arquivo.id, 'bpa');
    expect(createHash('sha256').update(b.conteudo).digest('hex')).toBe(g.arquivo.hash);
    const texto = new TextDecoder().decode(b.conteudo);
    expect(texto.startsWith('01#BPA#202609')).toBe(true);
    expect(texto).toContain(cnsSintetico(21));
    await expect(sv.baixar(s, g.arquivo.id, 'ciha')).rejects.toMatchObject({ status: 404 });

    // A trilha: contagens, folhas, controle e hash; nenhum documento nem nome.
    const trilha = porta.trilhas.find((x) => x.operacao === 'faturamento.gerarBpa');
    expect(trilha?.diferenca).toMatch(
      /competencia=202609;bpaC=2\/4;bpaI=1\/1;folhas=2;controle=\d{4};sha256=/,
    );
    const tudo = JSON.stringify(porta.trilhas);
    expect(tudo).not.toContain('PACIENTE');
    expect(tudo).not.toContain(cnsSintetico(21));

    // Gerar de novo substitui o anterior; fechar exige as críticas tratadas (nenhuma aberta).
    const comp2 = (await sv.listarCompetencias(s, 'bpa'))[0]!;
    const g2 = await sv.gerarBpa(s, { competencia: '202609', versao: comp2.versao });
    expect(g2.substituidos).toBe(1);
    const comp3 = (await sv.listarCompetencias(s, 'bpa'))[0]!;
    const fechada = await sv.fechar(s, { instrumento: 'bpa', competencia: '202609', versao: comp3.versao });
    expect(fechada.situacao).toBe('fechada');
  });

  it('recusas: escopo parcial, cabeçalho do BPA-Mag incompleto e competência sem produção', async () => {
    const porta = new PortaSusMemoria();
    const sv = new ServicoSus(porta, armazemSusMemoria());
    const s = sessao();
    await sv.abrir(s, { instrumento: 'bpa', competencia: '202609' });
    const parcial = sessao({ convenios: [20] });
    const c = (await sv.listarCompetencias(s, 'bpa'))[0]!;
    await expect(sv.gerarBpa(parcial, { competencia: '202609', versao: c.versao })).rejects.toEqual(
      recusa('escopo-parcial'),
    );
    // Sem o CNPJ e o órgão de origem no parâmetro: crítica bloqueante do estabelecimento.
    const semCab = sessao({
      parametros: { ...s.parametros, bpa: { ...s.parametros.bpa, cnpj: '', orgaoOrigem: '' } },
    });
    const r = await sv.criticar(semCab, { instrumento: 'bpa', competencia: '202609' });
    expect(r.porRegra['dado-minimo-ausente']).toBe(2);
    // Sem convênio SUS no parâmetro, não há produção: o BPA-Mag não aceita remessa vazia.
    const semSus = sessao({ parametros: { ...s.parametros, conveniosSus: [999] } });
    await sv.criticar(semSus, { instrumento: 'bpa', competencia: '202609' });
    const c2 = (await sv.listarCompetencias(s, 'bpa'))[0]!;
    await expect(sv.gerarBpa(semSus, { competencia: '202609', versao: c2.versao })).rejects.toEqual(
      recusa('bpa-sem-producao'),
    );
  });

  it('cadastro geral de solicitantes e parâmetros do estabelecimento (consultas)', async () => {
    const sv = new ServicoSus(new PortaSusMemoria(), armazemSusMemoria());
    const s = sessao();
    expect((await sv.buscarSolicitantes(s, '52000')).map((x) => x.conselho)).toEqual([520001, 520002]);
    expect((await sv.buscarSolicitantes(s, 'sintetica')).map((x) => x.id)).toEqual([2]);
    expect(await sv.parametrosCadastro(s)).toMatchObject({ versao: 'SINTETICO' });
  });
});
