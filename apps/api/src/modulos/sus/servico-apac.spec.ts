// Serviço do faturamento SUS, etapa 3 (APAC), sobre a porta em memória (massa SINTÉTICA): desligada (DP-35) recusa;
// ligada: o laudo (atendimento SUS, procedimento, solicitante e o laudo de nefrologia) → a crítica da competência acusa
// a produção sem autorização → a autorização (número, validade) → a crítica sem bloqueante → o APAC-Mag com hash → as
// linhas sem dado pessoal → o download pela rota da APAC; a continuidade e o encerramento; as recusas (versão, número
// repetido, escopo parcial, atendimento não SUS, nefrologia ausente, domínio inválido) e a trilha sem dado pessoal.
import { createHash } from 'node:crypto';
import { digitoApac, LEIAUTE_APAC_MAG, conferirEstrutura } from '@sgh/dominio-faturamento';
import { describe, expect, it } from 'vitest';
import { armazemSusMemoria } from './armazem.js';
import { PortaSusMemoria, REGISTRO_APAC_SINTETICO, SOLICITANTES_APAC_SINTETICOS } from './porta-memoria.js';
import { SeloSolicitanteApac } from './selo-solicitante.js';
import { ServicoSus, type SessaoSus } from './servico.js';

const COMP = '202609';
/** O CPF sintético do solicitante (gerado pelo algoritmo) e a chave opaca que a tela recebe dele. */
const CPF_SOL = SOLICITANTES_APAC_SINTETICOS[0]!.chave;
const SELO = new SeloSolicitanteApac();
const SOL = SELO.selar(CPF_SOL);
const AUTORIZADOR = '700000000000005';
const numero = (k: number) => {
  const b = `33126000000${k}`;
  return `${b}${digitoApac(b)}`;
};

function sessao(extra: Partial<SessaoSus> = {}, apacLigada = true): SessaoSus {
  return {
    rede: 'rede-teste',
    hospital: 'pc',
    login: 'FATURISTA.SINT',
    hoje: '2026-10-26',
    convenios: null,
    parametros: {
      cnes: '9999991',
      conveniosSus: [1],
      conveniosParticular: [10],
      fontePadrao: 'plano-privado',
      fontePorConvenio: new Map(),
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
    liberado: async (i) => i === 'ciha' || (apacLigada && i === 'apac'),
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

const NEFRO = {
  caracteristicaTratamento: 1,
  contraindicacaoTransplante: 1,
  situacaoTransplante: 2,
  acessoVascular: 1,
  inicioTratamento: '2026-01-15',
};

const laudo = (extra: Record<string, unknown> = {}) => ({
  acao: 'laudo' as const,
  laudo: {
    registro: REGISTRO_APAC_SINTETICO,
    procedimento: '0305010107',
    cidPrincipal: 'N18.0',
    cidSecundario: null,
    cidAssociado: null,
    solicitante: SOL,
    dataSolicitacao: '2026-09-01',
    justificativa: 'Doença renal crônica sintética em terapia renal substitutiva.',
    laudoEspecifico: 'nefrologia' as const,
    nefrologia: NEFRO,
    ...extra,
  },
});

describe('faturamento SUS, etapa 3: APAC', () => {
  it('desligada por estabelecimento (DP-35): a lista, o laudo, a crítica e a geração recusam', async () => {
    const sv = new ServicoSus(new PortaSusMemoria(), armazemSusMemoria(), undefined, SELO);
    const s = sessao({}, false);
    await expect(sv.listarApacs(s, { pagina: 0, porPagina: 50 })).rejects.toEqual(
      recusa('recurso-desligado'),
    );
    await expect(sv.registrarApac(s, laudo())).rejects.toEqual(recusa('recurso-desligado'));
    await expect(sv.abrir(s, { instrumento: 'apac', competencia: COMP })).rejects.toEqual(
      recusa('recurso-desligado'),
    );
    await expect(sv.gerarApac(s, { competencia: COMP, versao: '0000000001' })).rejects.toEqual(
      recusa('recurso-desligado'),
    );
  });

  it('o caminho inteiro: laudo, crítica, autorização, APAC-Mag com hash, linhas, download e trilha', async () => {
    const porta = new PortaSusMemoria();
    const armazem = armazemSusMemoria();
    const sv = new ServicoSus(porta, armazem, undefined, SELO);
    const s = sessao();
    const at = await sv.atendimentoLaudoApac(s, REGISTRO_APAC_SINTETICO);
    expect(at).toMatchObject({ registro: REGISTRO_APAC_SINTETICO, contaSus: true, cnsValido: true });
    expect(JSON.stringify(at)).not.toMatch(/\d{15}/);
    expect((await sv.buscarSolicitantesApac(s, 'apac'))[0]).toMatchObject({ chave: SOL, cnsValido: true });
    expect((await sv.dominiosApac(s)).acessoVascular.length).toBeGreaterThan(0);

    const a1 = await sv.registrarApac(s, laudo());
    expect(a1).toMatchObject({
      situacao: 'solicitada',
      procedimento: '0305010107',
      procedimentoNome: 'PROCEDIMENTO SINTETICO DE HEMODIALISE',
      cidPrincipal: 'N180',
      laudoEspecifico: 'nefrologia',
      solicitanteNome: 'MEDICO SOLICITANTE SINTETICO DA APAC',
      numero: null,
    });

    // A competência APAC: a produção de hemodiálise sem APAC autorizada é aviso.
    await sv.abrir(s, { instrumento: 'apac', competencia: COMP });
    const r0 = await sv.criticar(s, { instrumento: 'apac', competencia: COMP });
    expect(r0.porRegra).toEqual({ 'apac-sem-autorizacao': 2 });
    expect(r0).toMatchObject({ registros: 0, bloqueantes: 0, avisos: 2 });
    const v0 = (await sv.listarCompetencias(s, 'apac'))[0]!;
    await expect(sv.gerarApac(s, { competencia: COMP, versao: v0.versao })).rejects.toEqual(
      recusa('apac-sem-apresentacao'),
    );

    // A autorização: número com o verificador e validade de até três competências.
    await expect(
      sv.registrarApac(s, {
        acao: 'autorizar',
        apac: a1.id,
        versao: a1.versao,
        numero: `${numero(1).slice(0, 12)}${(Number(numero(1)[12]) + 1) % 10}`,
        tipo: 'inicial',
        autorizador: AUTORIZADOR,
        dataAutorizacao: '2026-09-02',
        competenciaInicial: COMP,
        competenciaFinal: '202611',
      }),
    ).rejects.toEqual(recusa('apac-numero-invalido'));
    await expect(
      sv.registrarApac(s, {
        acao: 'autorizar',
        apac: a1.id,
        versao: a1.versao,
        numero: numero(1),
        tipo: 'inicial',
        autorizador: AUTORIZADOR,
        dataAutorizacao: '2026-09-02',
        competenciaInicial: COMP,
        competenciaFinal: '202612',
      }),
    ).rejects.toEqual(recusa('apac-validade-invalida'));
    const a2 = await sv.registrarApac(s, {
      acao: 'autorizar',
      apac: a1.id,
      versao: a1.versao,
      numero: numero(1),
      tipo: 'inicial',
      autorizador: AUTORIZADOR,
      dataAutorizacao: '2026-09-02',
      competenciaInicial: COMP,
      competenciaFinal: '202611',
    });
    expect(a2).toMatchObject({ situacao: 'autorizada', numero: numero(1), ultimaCompetencia: COMP });
    // A versão velha é recusada.
    await expect(sv.registrarApac(s, { acao: 'continuar', apac: a1.id, versao: a1.versao })).rejects.toEqual(
      recusa('apac-alterada'),
    );

    const r1 = await sv.criticar(s, { instrumento: 'apac', competencia: COMP });
    expect(r1).toMatchObject({ registros: 1, bloqueantes: 0, avisos: 0, corrigidas: 2 });
    const v1 = (await sv.listarCompetencias(s, 'apac'))[0]!;
    const g = await sv.gerarApac(s, { competencia: COMP, versao: v1.versao });
    expect(g.arquivo).toMatchObject({
      instrumento: 'apac',
      leiaute: 'APAC-MAG',
      conferidoContraOficial: false,
      nomeArquivo: `AP9999991${COMP}.SET`,
      registros: 1,
      procedimentos: 2,
    });
    const linhas = await sv.listarLinhasApac(s, { arquivo: g.arquivo.id, pagina: 0, porPagina: 50 });
    expect(linhas).toMatchObject({ total: 2, apacs: 1, quantidade: 13 });
    expect(linhas.itens.map((x) => [x.procedimento, x.principal, x.tipoNoArquivo])).toEqual([
      ['0305010107', true, '1'],
      ['0305010166', false, '1'],
    ]);
    expect(JSON.stringify(linhas)).not.toMatch(/SINTETIC[AO] \d|\d{15}/);
    const b = await sv.baixar(s, g.arquivo.id, 'apac');
    expect(createHash('sha256').update(b.conteudo).digest('hex')).toBe(g.arquivo.hash);
    const texto = new TextDecoder().decode(b.conteudo);
    expect(conferirEstrutura(LEIAUTE_APAC_MAG, texto)).toEqual([]);
    expect(
      texto
        .split('\r\n')
        .filter(Boolean)
        .map((l) => l.slice(0, 2)),
    ).toEqual(['01', '14', '06', '13', '13']);
    // A rota da CIHA não entrega o arquivo da APAC.
    await expect(sv.baixar(s, g.arquivo.id, 'ciha')).rejects.toMatchObject({ status: 404 });

    // A continuidade na competência seguinte e o encerramento.
    const a3 = await sv.registrarApac(s, { acao: 'continuar', apac: a2.id, versao: a2.versao });
    expect(a3.ultimaCompetencia).toBe('202610');
    await expect(
      sv.registrarApac(s, {
        acao: 'encerrar',
        apac: a3.id,
        versao: a3.versao,
        motivo: '12',
        dataEncerramento: '2026-11-03',
      }),
    ).rejects.toEqual(recusa('apac-encerramento-invalido'));
    const a4 = await sv.registrarApac(s, {
      acao: 'encerrar',
      apac: a3.id,
      versao: a3.versao,
      motivo: '12',
      dataEncerramento: '2026-10-05',
    });
    expect(a4).toMatchObject({ situacao: 'encerrada', motivoSaida: '12', ultimaCompetencia: '202610' });
    await expect(sv.registrarApac(s, { acao: 'continuar', apac: a4.id, versao: a4.versao })).rejects.toEqual(
      recusa('apac-situacao-invalida'),
    );
    const lista = await sv.listarApacs(s, { competencia: '202610', pagina: 0, porPagina: 50 });
    expect([lista.total, lista.porSituacao]).toEqual([1, { encerrada: 1 }]);

    // A trilha: a ação, o procedimento, a validade e o hash; nenhum documento nem nome.
    const eventos = porta.trilhas.map((t) => t.evento);
    expect(eventos).toContain('faturamento.apac.registrada');
    expect(eventos).toContain('faturamento.apac.gerada');
    for (const t of porta.trilhas) expect(t.diferenca ?? '').not.toMatch(/\d{11,}|SINTETIC/);
  });

  it('as recusas do laudo: atendimento não SUS, nefrologia ausente, domínio inválido, solicitante e escopo', async () => {
    const sv = new ServicoSus(new PortaSusMemoria(), armazemSusMemoria(), undefined, SELO);
    const s = sessao();
    await expect(
      sv.registrarApac(sessao({ parametros: { ...s.parametros, conveniosSus: [55] } }), laudo()),
    ).rejects.toEqual(recusa('apac-atendimento-nao-sus'));
    await expect(sv.registrarApac(s, laudo({ laudoEspecifico: 'nenhum', nefrologia: null }))).rejects.toEqual(
      recusa('apac-laudo-nefrologia-ausente'),
    );
    await expect(
      sv.registrarApac(s, laudo({ nefrologia: { ...NEFRO, acessoVascular: 99 } })),
    ).rejects.toEqual(recusa('apac-dominio-invalido'));
    await expect(sv.registrarApac(s, laudo({ solicitante: '12345678909' }))).rejects.toEqual(
      recusa('apac-solicitante-desconhecido'),
    );
    await expect(sv.registrarApac(s, laudo({ registro: 1 }))).rejects.toEqual(
      recusa('apac-atendimento-nao-encontrado'),
    );
    await expect(sv.registrarApac(s, laudo({ dataSolicitacao: '2026-12-01' }))).rejects.toEqual(
      recusa('apac-data-invalida'),
    );
    await expect(sv.registrarApac(sessao({ convenios: [10] }), laudo())).rejects.toEqual(
      recusa('escopo-parcial'),
    );
    // O escopo que cobre o convênio SUS registra.
    expect((await sv.registrarApac(sessao({ convenios: [1, 10] }), laudo())).situacao).toBe('solicitada');
  });

  it('o número repetido no estabelecimento, a negativa e o cancelamento (com justificativa)', async () => {
    const sv = new ServicoSus(new PortaSusMemoria(), armazemSusMemoria(), undefined, SELO);
    const s = sessao();
    const autorizar = (a: { id: number; versao: string }) =>
      sv.registrarApac(s, {
        acao: 'autorizar',
        apac: a.id,
        versao: a.versao,
        numero: numero(2),
        tipo: 'unica',
        autorizador: AUTORIZADOR,
        dataAutorizacao: '2026-09-02',
        competenciaInicial: COMP,
        competenciaFinal: COMP,
      });
    const x = await autorizar(await sv.registrarApac(s, laudo()));
    expect(x.tipo).toBe('unica');
    await expect(autorizar(await sv.registrarApac(s, laudo()))).rejects.toEqual(
      recusa('apac-numero-duplicado'),
    );
    const y = await sv.registrarApac(s, laudo());
    const negada = await sv.registrarApac(s, {
      acao: 'negar',
      apac: y.id,
      versao: y.versao,
      justificativa: 'Negada pelo gestor (sintético).',
    });
    expect(negada).toMatchObject({
      situacao: 'negada',
      justificativaSituacao: 'Negada pelo gestor (sintético).',
    });
    await expect(
      sv.registrarApac(s, {
        acao: 'cancelar',
        apac: negada.id,
        versao: negada.versao,
        justificativa: 'Cancelamento sintético.',
      }),
    ).rejects.toEqual(recusa('apac-situacao-invalida'));
    const cancelada = await sv.registrarApac(s, {
      acao: 'cancelar',
      apac: x.id,
      versao: x.versao,
      justificativa: 'Cancelamento sintético.',
    });
    expect(cancelada.situacao).toBe('cancelada');
  });

  it('o detalhe e a correção do laudo da solicitada, com versão e trilha; a autorizada não se corrige', async () => {
    const porta = new PortaSusMemoria();
    const sv = new ServicoSus(porta, armazemSusMemoria(), undefined, SELO);
    const s = sessao();
    const a = await sv.registrarApac(s, laudo());
    const corrigir = (x: { id: number; versao: string }, extra: Record<string, unknown> = {}) =>
      sv.registrarApac(s, {
        acao: 'corrigir',
        apac: x.id,
        versao: x.versao,
        laudo: {
          cidPrincipal: 'N18.5',
          cidSecundario: 'I10',
          cidAssociado: null,
          solicitante: SOL,
          dataSolicitacao: '2026-09-02',
          justificativa: 'Justificativa corrigida: doença renal crônica sintética estágio 5.',
          laudoEspecifico: 'nefrologia',
          nefrologia: { ...NEFRO, acessoVascular: 2 },
          ...extra,
        },
      });
    const c = await corrigir(a);
    expect(c).toMatchObject({
      situacao: 'solicitada',
      procedimento: '0305010107',
      cidPrincipal: 'N185',
      cidSecundario: 'I10',
      dataSolicitacao: '2026-09-02',
      justificativa: 'Justificativa corrigida: doença renal crônica sintética estágio 5.',
      nefrologia: { ...NEFRO, acessoVascular: 2 },
      alteradaPor: 'FATURISTA.SINT',
      solicitante: SOL,
      solicitanteNome: 'MEDICO SOLICITANTE SINTETICO DA APAC',
    });
    expect(c.versao).not.toBe(a.versao);
    const t = porta.trilhas.at(-1)!;
    expect(t.diferenca).toContain('acao=corrigir');
    expect(t.diferenca).toContain(
      'corrigidos=cidPrincipal,cidSecundario,dataSolicitacao,justificativa,nefrologia',
    );
    expect(t.diferenca ?? '').not.toMatch(/N18|I10|renal/);
    // A versão velha, o procedimento de nefrologia sem o laudo, o domínio inválido e o solicitante de fora.
    await expect(corrigir(a)).rejects.toEqual(recusa('apac-alterada'));
    await expect(corrigir(c, { laudoEspecifico: 'nenhum', nefrologia: null })).rejects.toEqual(
      recusa('apac-laudo-nefrologia-ausente'),
    );
    await expect(corrigir(c, { nefrologia: { ...NEFRO, acessoVascular: 99 } })).rejects.toEqual(
      recusa('apac-dominio-invalido'),
    );
    await expect(corrigir(c, { solicitante: new SeloSolicitanteApac().selar(CPF_SOL) })).rejects.toEqual(
      recusa('apac-solicitante-desconhecido'),
    );
    await expect(corrigir(c, { dataSolicitacao: '2026-12-01' })).rejects.toEqual(
      recusa('apac-data-invalida'),
    );
    // Autorizada: o gestor já decidiu sobre o laudo; não se corrige.
    const aut = await sv.registrarApac(s, {
      acao: 'autorizar',
      apac: c.id,
      versao: c.versao,
      numero: numero(3),
      tipo: 'unica',
      autorizador: AUTORIZADOR,
      dataAutorizacao: '2026-09-03',
      competenciaInicial: COMP,
      competenciaFinal: COMP,
    });
    await expect(corrigir(aut)).rejects.toEqual(recusa('apac-situacao-invalida'));
  });

  it('nenhuma resposta da APAC traz o CPF do solicitante; a chave opaca só abre neste servidor', async () => {
    const sv = new ServicoSus(new PortaSusMemoria(), armazemSusMemoria(), undefined, SELO);
    const s = sessao();
    const sols = await sv.buscarSolicitantesApac(s, 'apac');
    const a = await sv.registrarApac(s, laudo({ solicitante: sols[0]!.chave }));
    const lista = await sv.listarApacs(s, { pagina: 0, porPagina: 50 });
    for (const r of [sols, a, lista]) {
      const j = JSON.stringify(r);
      expect(j).not.toContain(CPF_SOL);
      expect(j.replace(/"numero":"\d{13}"/g, '')).not.toMatch(/(?<![\d])\d{11}(?![\d])/);
    }
    expect(a.solicitante).toBe(SOL);
    expect(SELO.abrir(SOL)).toBe(CPF_SOL);
    expect(SELO.abrir(CPF_SOL)).toBeNull();
    expect(SELO.abrir(`${SOL.slice(0, -2)}AA`)).toBeNull();
    // A chave mestra da plataforma dá a mesma chave opaca em outra instância.
    const mestra = Buffer.alloc(32, 7);
    expect(new SeloSolicitanteApac(mestra).selar(CPF_SOL)).toBe(
      new SeloSolicitanteApac(mestra).selar(CPF_SOL),
    );
  });

  it('a busca dos solicitantes e os domínios seguem a liberação e o escopo; o atendimento não SUS é recusado sem CID', async () => {
    const sv = new ServicoSus(new PortaSusMemoria(), armazemSusMemoria(), undefined, SELO);
    const desligada = sessao({}, false);
    await expect(sv.buscarSolicitantesApac(desligada, 'apac')).rejects.toEqual(recusa('recurso-desligado'));
    await expect(sv.dominiosApac(desligada)).rejects.toEqual(recusa('recurso-desligado'));
    await expect(sv.atendimentoLaudoApac(desligada, REGISTRO_APAC_SINTETICO)).rejects.toEqual(
      recusa('recurso-desligado'),
    );
    await expect(sv.buscarSolicitantesApac(sessao({ convenios: [10] }), 'apac')).rejects.toEqual(
      recusa('escopo-parcial'),
    );
    const s = sessao();
    const naoSus = sessao({ parametros: { ...s.parametros, conveniosSus: [55] } });
    await expect(sv.atendimentoLaudoApac(naoSus, REGISTRO_APAC_SINTETICO)).rejects.toEqual(
      recusa('apac-atendimento-nao-sus'),
    );
    expect(await sv.atendimentoLaudoApac(s, REGISTRO_APAC_SINTETICO)).toMatchObject({ contaSus: true });
  });
});
