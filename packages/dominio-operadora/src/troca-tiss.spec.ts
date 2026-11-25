// Regras da troca TISS recebida pela operadora (08-SGO linha 107, C2-061): leitura do cabeçalho e dos corpos
// (cancelamento, comunicação, pedido de autorização), conferência da mensagem, resultado do cancelamento guia a guia,
// comunicação, pedido da operadora a partir da guia e valores do demonstrativo de pagamento. Massa sintética.
import { describe, expect, it } from 'vitest';
import {
  ErroTrocaTiss,
  lerCabecalhoTroca,
  lerCancelamentoGuia,
  lerComunicacaoBeneficiario,
  lerSolicitacaoProcedimento,
  pedidoDaSolicitacao,
  problemasDaComunicacao,
  problemasDaSolicitacao,
  problemasDaTroca,
  protocoloDaTroca,
  resultadoDoCancelamento,
  situacaoDaComunicacao,
  situacaoDoCancelamento,
  valoresDoDemonstrativoPagamento,
} from './troca-tiss.js';

const cab = (
  tipo: string,
  origem = '<ans:codigoPrestadorNaOperadora>PR-001</ans:codigoPrestadorNaOperadora>',
) =>
  `<ans:cabecalho><ans:identificacaoTransacao><ans:tipoTransacao>${tipo}</ans:tipoTransacao>` +
  '<ans:sequencialTransacao>77</ans:sequencialTransacao><ans:dataRegistroTransacao>2026-11-20</ans:dataRegistroTransacao>' +
  '<ans:horaRegistroTransacao>10:15:00</ans:horaRegistroTransacao></ans:identificacaoTransacao>' +
  `<ans:origem><ans:identificacaoPrestador>${origem}</ans:identificacaoPrestador></ans:origem>` +
  '<ans:destino><ans:registroANS>999999</ans:registroANS></ans:destino><ans:Padrao>4.03.00</ans:Padrao></ans:cabecalho>';

const msg = (tipo: string, corpo: string) =>
  `<?xml version="1.0" encoding="ISO-8859-1"?><ans:mensagemTISS xmlns:ans="http://www.ans.gov.br/padroes/tiss/schemas">${cab(tipo)}<ans:prestadorParaOperadora>${corpo}</ans:prestadorParaOperadora><ans:epilogo><ans:hash>x</ans:hash></ans:epilogo></ans:mensagemTISS>`;

describe('cabeçalho e conferência da mensagem', () => {
  it('lê tipo, sequencial, instante, destino e prestador de origem', () => {
    const c = lerCabecalhoTroca(msg('CANCELA_GUIA', ''));
    expect(c).toMatchObject({
      transacao: 'CANCELA_GUIA',
      tipo: 'cancelamento_guia',
      sequencial: '77',
      registradaEm: '2026-11-20T10:15:00',
      registroAns: '999999',
      prestador: { tipo: 'codigo', valor: 'PR-001' },
      padrao: '4.03.00',
    });
    const cnpj = lerCabecalhoTroca(cab('CANCELA_GUIA', '<ans:CNPJ>12.345.678/0001-90</ans:CNPJ>'));
    expect(cnpj.prestador).toEqual({ tipo: 'cnpj', valor: '12345678000190' });
  });

  it('sem cabeçalho ou sem prestador, recusa', () => {
    expect(() => lerCabecalhoTroca('<x/>')).toThrow(ErroTrocaTiss);
    expect(() => lerCabecalhoTroca(cab('CANCELA_GUIA', ''))).toThrow('prestador-nao-identificado');
  });

  it('recusa transação de outra porta, outra operadora, prestador fora da rede e sequencial repetido', () => {
    const c = lerCabecalhoTroca(msg('ENVIO_LOTE_GUIAS', ''));
    expect(
      problemasDaTroca(c, {
        registroAnsOperadora: '111111',
        prestadorEncontrado: false,
        sequencialRepetido: true,
      }).map((p) => p.codigo),
    ).toEqual([
      'transacao-nao-recebida',
      'operadora-de-outro-registro',
      'prestador-nao-identificado',
      'transacao-repetida',
    ]);
    const ok = lerCabecalhoTroca(msg('COMUNICACAO_BENEFICIARIO', ''));
    expect(
      problemasDaTroca(ok, {
        registroAnsOperadora: '999999',
        prestadorEncontrado: true,
        sequencialRepetido: false,
      }),
    ).toEqual([]);
  });

  it('o protocolo tem 12 caracteres (AAMMDD e sequencial)', () => {
    expect(protocoloDaTroca('2026-11-20', 42)).toBe('261120000042');
    expect(() => protocoloDaTroca('2026-11-20', 0)).toThrow(ErroTrocaTiss);
  });
});

describe('cancelamento de guia', () => {
  it('lê as guias e o pedido de lote', () => {
    const g = lerCancelamentoGuia(
      msg(
        'CANCELA_GUIA',
        '<ans:cancelaGuia><ans:dadosPrestador><ans:codigoPrestadorNaOperadora>PR-001</ans:codigoPrestadorNaOperadora></ans:dadosPrestador><ans:tipoCancelamento>' +
          '<ans:tipoCancelamentoGuia><ans:tipoGuia>1</ans:tipoGuia><ans:numeroGuiaPrestador>G1</ans:numeroGuiaPrestador></ans:tipoCancelamentoGuia>' +
          '<ans:tipoCancelamentoGuia><ans:tipoGuia>2</ans:tipoGuia><ans:numeroGuiaPrestador>G2</ans:numeroGuiaPrestador><ans:numeroGuiaOperadora>O2</ans:numeroGuiaOperadora></ans:tipoCancelamentoGuia>' +
          '</ans:tipoCancelamento></ans:cancelaGuia>',
      ),
    );
    expect(g.lote).toBeNull();
    expect(g.guias).toEqual([
      {
        tipoGuia: 'solicitacao',
        numeroGuiaPrestador: 'G1',
        numeroGuiaOperadora: null,
        numeroProtocolo: null,
      },
      {
        tipoGuia: 'faturamento',
        numeroGuiaPrestador: 'G2',
        numeroGuiaOperadora: 'O2',
        numeroProtocolo: null,
      },
    ]);
    const l = lerCancelamentoGuia(
      msg(
        'CANCELA_GUIA',
        '<ans:cancelaGuia><ans:tipoCancelamento><ans:tipoCancelamentoLote><ans:numeroLote>55</ans:numeroLote></ans:tipoCancelamentoLote></ans:tipoCancelamento></ans:cancelaGuia>',
      ),
    );
    expect(l).toEqual({ lote: { numeroLote: '55', numeroProtocolo: null }, guias: [] });
  });

  it('decide guia a guia e a situação do pedido', () => {
    expect(resultadoDoCancelamento({ pedido: null, apresentadaEmConta: false }).resultado).toBe(
      'nao_localizada',
    );
    expect(
      resultadoDoCancelamento({ pedido: { situacao: 'autorizada' }, apresentadaEmConta: true }),
    ).toMatchObject({
      resultado: 'nao_cancelada',
      cancelarPedido: false,
    });
    expect(
      resultadoDoCancelamento({ pedido: { situacao: 'em_analise' }, apresentadaEmConta: false }),
    ).toMatchObject({
      resultado: 'cancelada',
      cancelarPedido: true,
    });
    expect(
      resultadoDoCancelamento({ pedido: { situacao: 'cancelada' }, apresentadaEmConta: false }),
    ).toMatchObject({
      resultado: 'cancelada',
      cancelarPedido: false,
    });
    expect(
      resultadoDoCancelamento({ pedido: { situacao: 'negada' }, apresentadaEmConta: false }).resultado,
    ).toBe('nao_cancelada');
    expect(situacaoDoCancelamento(['nao_localizada', 'cancelada'])).toBe('respondido');
    expect(situacaoDoCancelamento(['nao_localizada', 'nao_cancelada'])).toBe('recusado');
  });
});

describe('comunicação de internação e alta', () => {
  const corpo = (ev: string, dado: string, data = '2026-11-19') =>
    msg(
      'COMUNICACAO_BENEFICIARIO',
      `<ans:comunicacaoInternacao><ans:dadosBeneficiario><ans:numeroCarteira>0000000000000001</ans:numeroCarteira><ans:atendimentoRN>S</ans:atendimentoRN></ans:dadosBeneficiario><ans:dataEvento>${data}</ans:dataEvento><ans:tipoEvento>${ev}</ans:tipoEvento><ans:dadosInternacao>${dado}</ans:dadosInternacao></ans:comunicacaoInternacao>`,
    );

  it('lê a internação com o tipo e a alta com o motivo', () => {
    expect(lerComunicacaoBeneficiario(corpo('I', '<ans:tipoInternacao>2</ans:tipoInternacao>'))).toEqual({
      carteira: '0000000000000001',
      recemNascido: true,
      dataEvento: '2026-11-19',
      tipoEvento: 'internacao',
      tipoInternacao: 'cirurgica',
      motivoEncerramento: null,
    });
    const a = lerComunicacaoBeneficiario(corpo('A', '<ans:motivoEncerramento>12</ans:motivoEncerramento>'));
    expect(a).toMatchObject({ tipoEvento: 'alta', motivoEncerramento: '12' });
    expect(problemasDaComunicacao(a, '2026-11-20')).toEqual([]);
  });

  it('recusa o evento futuro e o dado obrigatório que falta; a carteira não identificada fica recebida', () => {
    const f = lerComunicacaoBeneficiario(
      corpo('I', '<ans:tipoInternacao>9</ans:tipoInternacao>', '2026-12-01'),
    );
    expect(problemasDaComunicacao(f, '2026-11-20').map((p) => p.codigo)).toEqual([
      'evento-no-futuro',
      'internacao-sem-tipo',
    ]);
    expect(situacaoDaComunicacao(false)).toBe('recebida');
    expect(situacaoDaComunicacao(true)).toBe('aceita');
  });
});

describe('pedido de autorização pela guia TISS', () => {
  const prof =
    '<ans:nomeProfissional>MEDICA SINTETICA</ans:nomeProfissional><ans:conselhoProfissional>06</ans:conselhoProfissional>' +
    '<ans:numeroConselhoProfissional>123456</ans:numeroConselhoProfissional><ans:UF>35</ans:UF><ans:CBOS>225125</ans:CBOS>';
  const proc =
    '<ans:procedimentosSolicitados><ans:procedimento><ans:codigoTabela>22</ans:codigoTabela><ans:codigoProcedimento>40304361</ans:codigoProcedimento><ans:descricaoProcedimento>HEMOGRAMA</ans:descricaoProcedimento></ans:procedimento><ans:quantidadeSolicitada>2</ans:quantidadeSolicitada></ans:procedimentosSolicitados>';

  it('SP/SADT: guia, carteira, caráter, solicitante e itens', () => {
    const s = lerSolicitacaoProcedimento(
      msg(
        'SOLICITACAO_PROCEDIMENTOS',
        `<ans:solicitacaoProcedimento><ans:solicitacaoSP-SADT><ans:cabecalhoSolicitacao><ans:registroANS>999999</ans:registroANS><ans:numeroGuiaPrestador>GP-9</ans:numeroGuiaPrestador></ans:cabecalhoSolicitacao><ans:dadosBeneficiario><ans:numeroCarteira>0000000000000001</ans:numeroCarteira><ans:atendimentoRN>N</ans:atendimentoRN></ans:dadosBeneficiario><ans:dadosSolicitante><ans:profissionalSolicitante>${prof}</ans:profissionalSolicitante></ans:dadosSolicitante><ans:caraterAtendimento>2</ans:caraterAtendimento><ans:dataSolicitacao>2026-11-20</ans:dataSolicitacao><ans:indicacaoClinica>Investigacao de anemia</ans:indicacaoClinica>${proc}</ans:solicitacaoSP-SADT></ans:solicitacaoProcedimento>`,
      ),
    );
    expect(s).toMatchObject({
      tipo: 'sp_sadt',
      numeroGuiaPrestador: 'GP-9',
      carteira: '0000000000000001',
      urgencia: true,
      cid: null,
      internacao: null,
      profissional: { nome: 'MEDICA SINTETICA', conselho: 'CRM', numero: '123456', uf: 'SP' },
      itens: [{ tabela: 22, codigo: '40304361', descricao: 'HEMOGRAMA', quantidade: 2 }],
    });
    expect(problemasDaSolicitacao(s)).toEqual([]);
    const p = pedidoDaSolicitacao(s, { prestador: 5, tipoGuia: 4, origem: 7 });
    expect(p).toMatchObject({ carater: 'U', prestador: 5, tipoGuia: 4, origem: 7, executante: null });
    expect(p.itens[0]).toEqual({ tabela: 22, codigo: '40304361', descricao: null, quantidade: 2 });
  });

  it('internação: tipo, diárias, admissão e CID; sem CID e com conselho fora da lista, recusa', () => {
    const corpo = (cid: string, conselho = '06') =>
      msg(
        'SOLICITACAO_PROCEDIMENTOS',
        `<ans:solicitacaoProcedimento><ans:solicitacaoInternacao><ans:registroANS>999999</ans:registroANS><ans:numeroGuiaPrestador>GI-1</ans:numeroGuiaPrestador><ans:dadosBeneficiario><ans:numeroCarteira>0000000000000001</ans:numeroCarteira><ans:atendimentoRN>N</ans:atendimentoRN></ans:dadosBeneficiario><ans:identificacaoSolicitante><ans:dadosProfissionalContratado>${prof.replace('>06<', `>${conselho}<`)}</ans:dadosProfissionalContratado></ans:identificacaoSolicitante><ans:dadosHospitalSolicitado><ans:dataSugeridaInternacao>2026-11-25</ans:dataSugeridaInternacao></ans:dadosHospitalSolicitado><ans:dadosInternacao><ans:caraterAtendimento>1</ans:caraterAtendimento><ans:tipoInternacao>2</ans:tipoInternacao><ans:qtDiariasSolicitadas>3</ans:qtDiariasSolicitadas><ans:indicacaoClinica>Colecistite cronica</ans:indicacaoClinica></ans:dadosInternacao><ans:hipotesesDiagnosticas>${cid}</ans:hipotesesDiagnosticas>${proc}<ans:dataSolicitacao>2026-11-20</ans:dataSolicitacao></ans:solicitacaoInternacao></ans:solicitacaoProcedimento>`,
      );
    const s = lerSolicitacaoProcedimento(corpo('<ans:diagnosticoCID>k801</ans:diagnosticoCID>'));
    expect(s).toMatchObject({
      tipo: 'internacao',
      urgencia: false,
      cid: 'K801',
      indicacaoClinica: 'Colecistite cronica',
      internacao: { tipo: 2, diarias: 3, admissaoPrevista: '2026-11-25' },
    });
    expect(problemasDaSolicitacao(s)).toEqual([]);
    const ruim = lerSolicitacaoProcedimento(corpo('', '10'));
    expect(problemasDaSolicitacao(ruim).map((p) => p.codigo)).toEqual([
      'conselho-nao-aceito',
      'internacao-sem-cid',
    ]);
  });
});

describe('demonstrativo de pagamento', () => {
  it('líquido = liberado − débitos + créditos, em centavos; negativo recusa', () => {
    expect(
      valoresDoDemonstrativoPagamento({
        informado: 300.1,
        liberado: 250.05,
        glosa: 50.05,
        debitos: 10.01,
        creditos: 0.02,
      }),
    ).toMatchObject({ processado: 300.1, liquido: 240.06 });
    expect(() =>
      valoresDoDemonstrativoPagamento({ informado: 1, liberado: 1, glosa: 0, debitos: 2 }),
    ).toThrow('valores-invalidos');
  });
});
