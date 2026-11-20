// Serviço do faturamento SUS, etapa 4 (AIH e retorno do gestor), sobre a porta em memória (massa SINTÉTICA): desligado
// (DP-35) recusa; ligado: faixa → laudo → autorização com o número da faixa → crítica da competência (a internação sem
// AIH, a AIH sem fechamento) → fechamento (regra 6: bloqueante recusa; o OPM pede a nota) → espelho com os valores →
// SISAIH01 com hash e download → retorno do gestor (rejeitada) → reapresentação → glosa aceita; as recusas (escopo,
// versão, máquina de estados, número fora da faixa ou em uso) e a trilha sem dado pessoal.
import { createHash } from 'node:crypto';
import { cnsValido } from '@sgh/contratos';
import { numeroAih } from '@sgh/dominio-faturamento';
import { describe, expect, it } from 'vitest';
import { armazemSusMemoria } from './armazem.js';
import { REGISTROS_AIH_SINTETICOS, SOLICITANTES_AIH_SINTETICOS } from './porta-aih-memoria.js';
import { cnsSintetico, PortaSusMemoria } from './porta-memoria.js';
import { ServicoSusAih } from './servico-aih.js';
import { ServicoSus, type SessaoSus } from './servico.js';

const HOJE = new Date().toISOString().slice(0, 10);
const COMP = `${HOJE.slice(0, 4)}${HOJE.slice(5, 7)}`;
const dia = (d: number) => `${HOJE.slice(0, 8)}${String(d).padStart(2, '0')}`;
const DIRETOR = (() => {
  for (let k = 0; k < 50; k++) {
    const c = cnsSintetico(880 + k);
    if (cnsValido(c)) return c;
  }
  throw new Error('sem CNS');
})();
const AUTORIZADOR = (() => {
  for (let k = 0; k < 50; k++) {
    const c = cnsSintetico(770 + k);
    if (cnsValido(c)) return c;
  }
  throw new Error('sem CNS');
})();

function sessao(extra: Partial<SessaoSus> = {}, ligado = true, uti = '3:2:0802010083'): SessaoSus {
  return {
    rede: 'rede-teste',
    hospital: 'pc',
    login: 'FATURISTA.SINT',
    hoje: HOJE,
    convenios: null,
    parametros: {
      cnes: '9999991',
      conveniosSus: [1],
      conveniosParticular: [10],
      fontePadrao: 'plano-privado',
      fontePorConvenio: new Map(),
      habilitacoes: new Set<string>(),
      bpa: {
        orgaoOrigem: 'H',
        siglaOrigem: 'H',
        cnpj: '11222333000181',
        orgaoDestino: 'SMS',
        indicadorDestino: 'M',
      },
      apac: { uf: '33' },
      aih: { utiPorAcomodacao: uti, diretorClinicoCns: DIRETOR },
    },
    liberado: async (i) => i === 'ciha' || (ligado && (i === 'aih' || i === 'bpa')),
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

function montar() {
  const porta = new PortaSusMemoria();
  const armazem = armazemSusMemoria();
  const sus = new ServicoSus(porta, armazem);
  const aih = new ServicoSusAih(
    porta,
    sus,
    armazem,
    async (s) =>
      s.parametros.aih ?? {
        utiPorAcomodacao: '',
        diretorClinicoCns: '',
      },
  );
  sus.registrarMontagem('aih', aih.montadorCritica());
  return { porta, armazem, sus, aih };
}

const LAUDO = {
  registro: REGISTROS_AIH_SINTETICOS[0],
  procedimentoSolicitado: '0406010811',
  cidPrincipal: 'I21',
  cidSecundario: null,
  carater: '02' as const,
  solicitante: SOLICITANTES_AIH_SINTETICOS[0]?.cpf ?? '',
  dataLaudo: dia(2),
  justificativa: 'DOR TORACICA SINTETICA COM SUPRA DE ST (MASSA DE TESTE)',
};
const FAIXA = { inicial: numeroAih('332510000001'), final: numeroAih('332510000003') };

describe('faturamento SUS, etapa 4: AIH', () => {
  it('desligado por estabelecimento (DP-35): o laudo, a faixa e o SISAIH01 recusam', async () => {
    const { aih } = montar();
    const s = sessao({}, false);
    await expect(aih.registrar(s, { acao: 'laudo', laudo: LAUDO })).rejects.toEqual(
      recusa('recurso-desligado'),
    );
    await expect(
      aih.registrarFaixa(s, {
        acao: 'registrar',
        ...FAIXA,
        orgaoEmissor: 'SMS SINTETICA',
        dataLiberacao: dia(1),
      }),
    ).rejects.toEqual(recusa('recurso-desligado'));
    await expect(aih.gerarSisaih(s, { competencia: COMP, versao: '0000000001' })).rejects.toEqual(
      recusa('recurso-desligado'),
    );
    expect((await aih.painel(s)).liberado).toBe(false);
  });

  it('o caminho inteiro: faixa, laudo, autorização, crítica, fechamento, espelho, SISAIH01, retorno e reapresentação', async () => {
    const { porta, armazem, sus, aih } = montar();
    const s = sessao();
    // A faixa: extremos com o dígito; a sobreposta e a inválida recusam.
    const f = await aih.registrarFaixa(s, {
      acao: 'registrar',
      ...FAIXA,
      orgaoEmissor: 'SMS SINTETICA',
      dataLiberacao: dia(1),
    });
    expect(f).toMatchObject({ total: 3, usados: 0, proximo: FAIXA.inicial, situacao: 'ativa' });
    await expect(
      aih.registrarFaixa(s, {
        acao: 'registrar',
        ...FAIXA,
        orgaoEmissor: 'SMS SINTETICA',
        dataLiberacao: dia(1),
      }),
    ).rejects.toEqual(recusa('faixa-sobreposta'));
    await expect(
      aih.registrarFaixa(s, {
        acao: 'registrar',
        inicial: FAIXA.final,
        final: FAIXA.inicial,
        orgaoEmissor: 'SMS SINTETICA',
        dataLiberacao: dia(1),
      }),
    ).rejects.toEqual(recusa('faixa-invalida'));
    // A internação para o laudo e o laudo; a segunda AIH da mesma internação recusa.
    const i = await aih.internacao(s, LAUDO.registro);
    expect(i).toMatchObject({ sus: true, carater: '02', cnsValido: true, aih: null });
    const a1 = await aih.registrar(s, { acao: 'laudo', laudo: LAUDO });
    expect(a1).toMatchObject({
      situacao: 'solicitada',
      registro: LAUDO.registro,
      procedimentoSolicitadoNome: 'PROCEDIMENTO SINTETICO DE INTERNACAO',
    });
    await expect(aih.registrar(s, { acao: 'laudo', laudo: LAUDO })).rejects.toEqual(
      recusa('aih-ja-registrada'),
    );
    // Fechar antes de autorizar recusa (máquina de estados); a autorização antes do laudo também.
    await expect(
      aih.registrar(s, {
        acao: 'fechar',
        aih: a1.id,
        versao: a1.versao,
        procedimentoRealizado: null,
        opm: [],
      }),
    ).rejects.toEqual(recusa('situacao-nao-permite'));
    await expect(
      aih.registrar(s, {
        acao: 'autorizar',
        aih: a1.id,
        versao: a1.versao,
        faixa: f.id,
        numero: null,
        autorizador: AUTORIZADOR,
        dataAutorizacao: dia(1),
      }),
    ).rejects.toEqual(recusa('autorizacao-antes-do-laudo'));
    await expect(
      aih.registrar(s, {
        acao: 'autorizar',
        aih: a1.id,
        versao: a1.versao,
        faixa: f.id,
        numero: numeroAih('332510000009'),
        autorizador: AUTORIZADOR,
        dataAutorizacao: dia(3),
      }),
    ).rejects.toEqual(recusa('numero-fora-da-faixa'));
    const a2 = await aih.registrar(s, {
      acao: 'autorizar',
      aih: a1.id,
      versao: a1.versao,
      faixa: f.id,
      numero: null,
      autorizador: AUTORIZADOR,
      dataAutorizacao: dia(3),
    });
    expect(a2).toMatchObject({ situacao: 'autorizada', numero: FAIXA.inicial, faixa: f.id });
    expect((await aih.faixas(s))[0]).toMatchObject({ usados: 1, proximo: numeroAih('332510000002') });
    // A competência AIH: a internação 7402 sem AIH (aviso) e a AIH autorizada ainda não fechada (aviso).
    await sus.abrir(s, { instrumento: 'aih', competencia: COMP });
    const c1 = await sus.criticar(s, { instrumento: 'aih', competencia: COMP });
    expect(c1.porRegra).toEqual({ 'aih-nao-fechada': 1, 'aih-sem-laudo': 1 });
    expect(c1).toMatchObject({ bloqueantes: 0, avisos: 2, registros: 2 });
    // O fechamento sem o tipo de UTI do SIH no parâmetro recusa (regra 6); com ele, o OPM pede a nota.
    await expect(
      aih.registrar(sessao({}, true, ''), {
        acao: 'fechar',
        aih: a2.id,
        versao: a2.versao,
        procedimentoRealizado: null,
        opm: [],
      }),
    ).rejects.toEqual(recusa('aih-com-bloqueante'));
    await expect(
      aih.registrar(s, {
        acao: 'fechar',
        aih: a2.id,
        versao: a2.versao,
        procedimentoRealizado: null,
        opm: [],
      }),
    ).rejects.toEqual(recusa('opm-sem-dados'));
    const antesDoFechamento = await aih.espelho(s, a2.id);
    expect(antesDoFechamento.origem).toBe('montagem');
    expect(antesDoFechamento.lotesSaida).toEqual([
      { item: 501, nome: 'STENT SINTETICO', quantidade: 1, lote: 'LOTE-SINT-1' },
    ]);
    const opm = antesDoFechamento.linhas.find((x) => x.tipo === 'opm');
    const a3 = await aih.registrar(s, {
      acao: 'fechar',
      aih: a2.id,
      versao: a2.versao,
      procedimentoRealizado: null,
      opm: [
        {
          item: opm?.item ?? 0,
          cnpjFornecedor: '00000000000191',
          notaFiscal: 'NF-SINT-1',
          registroAnvisa: '10000000001',
          serie: '',
          lote: 'LOTE-SINT-1',
        },
      ],
    });
    expect(a3).toMatchObject({ situacao: 'fechada', permanencia: 10, diariasUti: 3 });
    // O espelho do fechamento: principal, OPM, secundário e as 3 diárias de UTI com os valores da SIGTAP.
    const esp = await aih.espelho(s, a3.id);
    expect(esp.origem).toBe('fechamento');
    expect(esp.linhas.map((x) => [x.tipo, x.procedimento, x.quantidade])).toEqual([
      ['principal', '0406010811', 1],
      ['opm', '0702040061', 1],
      ['secundario', '0211020036', 2],
      ['diaria-uti', '0802010083', 3],
    ]);
    expect(esp.linhas.find((x) => x.tipo === 'diaria-uti')?.valorTotal).toBe(1436.16);
    expect(esp.linhas.find((x) => x.tipo === 'opm')?.opm?.notaFiscal).toBe('NF-SINT-1');
    expect(esp.valorTotal).toBeGreaterThan(0);
    expect(esp).toMatchObject({ itensSemSigtap: 1, permanencia: { dias: 10, media: 6 } });
    // A crítica de novo: a AIH fechada entra (sem bloqueante); o SISAIH01 com hash.
    const c2 = await sus.criticar(s, { instrumento: 'aih', competencia: COMP });
    expect(c2.porRegra).toEqual({ 'aih-sem-laudo': 1, 'item-sem-sigtap': 1 });
    const comp = (await sus.listarCompetencias(s, 'aih'))[0];
    const g = await aih.gerarSisaih(s, { competencia: COMP, versao: comp?.versao ?? '' });
    expect(g.arquivo).toMatchObject({
      instrumento: 'aih',
      leiaute: 'SISAIH01',
      registros: 1,
      procedimentos: 3,
      conferidoContraOficial: false,
      nomeArquivo: `AIH9999991${COMP}.TXT`,
    });
    const baixado = await sus.baixar(s, g.arquivo.id, 'aih');
    expect(createHash('sha256').update(baixado.conteudo).digest('hex')).toBe(g.arquivo.hash);
    const texto = new TextDecoder().decode(baixado.conteudo);
    expect(texto.startsWith(`01#SIH#${COMP}9999991`)).toBe(true);
    expect(texto).toContain(FAIXA.inicial);
    // A rota da CIHA não entrega o arquivo da AIH.
    await expect(sus.baixar(s, g.arquivo.id, 'ciha')).rejects.toMatchObject({ status: 404 });
    const apresentada = (await aih.listar(s, { pagina: 0, porPagina: 50 })).itens[0];
    expect(apresentada).toMatchObject({
      situacao: 'apresentada',
      competenciaApresentacao: COMP,
      arquivo: g.arquivo.id,
    });
    // O retorno do gestor: a AIH rejeitada (a glosa é o apresentado); a linha desconhecida fica fora.
    const conteudo = [
      'instrumento;competencia;identificacao;procedimento;situacao;motivo;valor_apresentado;valor_aprovado',
      `aih;${COMP};${FAIXA.inicial};0406010811;R;CNS do paciente;2500,00;`,
      `aih;${COMP};${numeroAih('332510000002')};;A;;100;100`,
      `aih;${COMP};123;;A;;1;1`,
    ].join('\n');
    const r = await aih.importarRetorno(s, {
      instrumento: 'aih',
      competencia: COMP,
      nomeArquivo: 'ESPELHO.CSV',
      conteudo,
    });
    expect(r).toMatchObject({
      casadas: 1,
      naoCasadas: [{ linha: 3, identificacao: numeroAih('332510000002') }],
      erros: [{ linha: 4, problema: 'identificacao-invalida' }],
      porSituacao: { rejeitada: 1 },
      valorGlosado: 2500,
      repetidas: 0,
    });
    // O mesmo arquivo de novo não duplica.
    expect(
      (
        await aih.importarRetorno(s, {
          instrumento: 'aih',
          competencia: COMP,
          nomeArquivo: 'ESPELHO.CSV',
          conteudo,
        })
      ).repetidas,
    ).toBe(1);
    expect((await aih.espelho(s, a3.id)).retorno).toMatchObject({
      situacao: 'rejeitada',
      tratamento: 'pendente',
    });
    const pr = await aih.listarRetornos(s, { instrumento: 'aih', pagina: 0, porPagina: 50 });
    expect([pr.total, pr.valorGlosado]).toEqual([1, 2500]);
    const linha = pr.itens[0];
    await expect(
      aih.tratarRetorno(s, {
        retorno: linha?.id ?? 0,
        versao: '0000000000',
        decisao: 'aceita',
        justificativa: 'GLOSA ACEITA (TESTE)',
      }),
    ).rejects.toEqual(recusa('versao-alterada'));
    const t = await aih.tratarRetorno(s, {
      retorno: linha?.id ?? 0,
      versao: linha?.versao ?? '',
      decisao: 'reapresentar',
      justificativa: 'CNS CORRIGIDO NO CADASTRO (TESTE)',
    });
    expect(t.tratamento).toBe('reapresentar');
    const reapresentada = (await aih.listar(s, { pagina: 0, porPagina: 50 })).itens[0];
    expect(reapresentada).toMatchObject({
      situacao: 'fechada',
      reapresentacoes: 1,
      competenciaApresentacao: null,
    });
    await expect(
      aih.tratarRetorno(s, {
        retorno: linha?.id ?? 0,
        versao: t.versao,
        decisao: 'aceita',
        justificativa: 'DE NOVO (TESTE)',
      }),
    ).rejects.toEqual(recusa('retorno-sem-pendencia'));
    // A trilha: só chaves, números, contagens e hash; nenhum nome nem documento do paciente.
    const trilhas = porta.trilhas.map((x) => `${x.evento} ${x.diferenca ?? ''}`).join('\n');
    expect(trilhas).toContain('faturamento.aih.registrada');
    expect(trilhas).toContain('faturamento.sisaih.gerado');
    expect(trilhas).toContain('faturamento.retornoSus.importado');
    expect(trilhas).toContain('faturamento.retornoSus.tratado');
    expect(trilhas).toContain('faturamento.faixaAih.registrada');
    expect(trilhas).not.toMatch(/PACIENTE|SINTETICO DA AIH|7\d{14}/);
    expect(armazem).toBeDefined();
  });

  it('negar, cancelar, reabrir e o número em uso; a faixa cancelada', async () => {
    const { aih } = montar();
    const s = sessao();
    const f = await aih.registrarFaixa(s, {
      acao: 'registrar',
      ...FAIXA,
      orgaoEmissor: 'SMS SINTETICA',
      dataLiberacao: dia(1),
    });
    const a = await aih.registrar(s, { acao: 'laudo', laudo: LAUDO });
    const negada = await aih.registrar(s, {
      acao: 'negar',
      aih: a.id,
      versao: a.versao,
      justificativa: 'SEM CRITERIO (TESTE)',
    });
    expect(negada.situacao).toBe('negada');
    // Negada, a internação aceita outro laudo.
    const b = await aih.registrar(s, { acao: 'laudo', laudo: LAUDO });
    const b2 = await aih.registrar(s, {
      acao: 'autorizar',
      aih: b.id,
      versao: b.versao,
      faixa: f.id,
      numero: FAIXA.final,
      autorizador: AUTORIZADOR,
      dataAutorizacao: dia(3),
    });
    expect(b2.numero).toBe(FAIXA.final);
    // O último número esgota a faixa.
    expect((await aih.faixas(s))[0]?.situacao).toBe('esgotada');
    const c = await aih.registrar(s, {
      acao: 'cancelar',
      aih: b2.id,
      versao: b2.versao,
      justificativa: 'DUPLICADA (TESTE)',
    });
    expect(c.situacao).toBe('cancelada');
    await expect(
      aih.registrar(s, { acao: 'reabrir', aih: c.id, versao: c.versao, justificativa: 'NAO PODE (TESTE)' }),
    ).rejects.toEqual(recusa('situacao-nao-permite'));
    const f2 = await aih.registrarFaixa(s, {
      acao: 'registrar',
      inicial: numeroAih('332510000010'),
      final: numeroAih('332510000020'),
      orgaoEmissor: 'SMS SINTETICA',
      dataLiberacao: dia(1),
    });
    const d = await aih.registrar(s, { acao: 'laudo', laudo: LAUDO });
    await expect(
      aih.registrar(s, {
        acao: 'autorizar',
        aih: d.id,
        versao: d.versao,
        faixa: f.id,
        numero: null,
        autorizador: AUTORIZADOR,
        dataAutorizacao: dia(3),
      }),
    ).rejects.toEqual(recusa('faixa-inativa'));
    const cancelada = await aih.registrarFaixa(s, {
      acao: 'cancelar',
      faixa: f2.id,
      versao: f2.versao,
      justificativa: 'FAIXA ERRADA (TESTE)',
    });
    expect(cancelada.situacao).toBe('cancelada');
  });

  it('o escopo: sem os convênios SUS não lê; escopo parcial não gera, não registra faixa nem importa retorno', async () => {
    const { aih } = montar();
    const fora = sessao({ convenios: [20] });
    await expect(aih.listar(fora, { pagina: 0, porPagina: 50 })).rejects.toEqual(
      recusa('fora-do-escopo-sus'),
    );
    // A internação de outro convênio (a sintética é do convênio 1; aqui o SUS é o 30): com escopo só no SUS, a leitura
    // recusa sem nenhum dado clínico; com escopo total, vem como não SUS (a tela avisa que vai na CIHA).
    const comSus30 = (convenios: readonly number[] | null) => {
      const b = sessao({ convenios });
      return { ...b, parametros: { ...b.parametros, conveniosSus: [30] } };
    };
    const lida = aih.internacao(comSus30([30]), REGISTROS_AIH_SINTETICOS[0]);
    await expect(lida).rejects.toEqual(recusa('fora-do-escopo-sus'));
    await expect(lida).rejects.not.toHaveProperty('cidPrincipal');
    expect(await aih.internacao(comSus30(null), REGISTROS_AIH_SINTETICOS[0])).toMatchObject({
      sus: false,
    });
    const parcial = sessao({ convenios: [1, 20] });
    await expect(
      aih.registrarFaixa(parcial, {
        acao: 'registrar',
        ...FAIXA,
        orgaoEmissor: 'SMS',
        dataLiberacao: dia(1),
      }),
    ).rejects.toEqual(recusa('escopo-parcial'));
    await expect(aih.gerarSisaih(parcial, { competencia: COMP, versao: '0000000001' })).rejects.toEqual(
      recusa('escopo-parcial'),
    );
    await expect(
      aih.importarRetorno(parcial, {
        instrumento: 'aih',
        competencia: COMP,
        nomeArquivo: 'R.CSV',
        conteudo: 'x',
      }),
    ).rejects.toEqual(recusa('escopo-parcial'));
    // Com os convênios SUS no escopo, lê a lista.
    expect((await aih.listar(parcial, { pagina: 0, porPagina: 50 })).total).toBe(0);
  });

  it('retorno do BPA: casa pela linha do arquivo vigente; sem arquivo, fica fora; arquivo sem linha válida recusa', async () => {
    const { aih } = montar();
    const s = sessao();
    const r = await aih.importarRetorno(s, {
      instrumento: 'bpa',
      competencia: COMP,
      nomeArquivo: 'SIA.CSV',
      conteudo: `instrumento;competencia;identificacao;procedimento;situacao;motivo;valor_apresentado;valor_aprovado\nbpa;${COMP};C-001-01;0202010295;G;Qtde;10,00;5,00`,
    });
    expect(r).toMatchObject({ casadas: 0, naoCasadas: [{ linha: 2, identificacao: 'C-001-01' }] });
    await expect(
      aih.importarRetorno(s, {
        instrumento: 'bpa',
        competencia: COMP,
        nomeArquivo: 'SIA.CSV',
        conteudo: 'a;b\n1;2',
      }),
    ).rejects.toEqual(recusa('retorno-sem-linhas'));
  });
});
