// Regras da prescrição digital por plataforma externa (F8, 08-INTG L132): envio só da receita emitida e assinada em
// ICP-Brasil pelo prescritor, à plataforma ativa com parceiro de API; sem envio vivo repetido; cancelamento com motivo
// e nunca da dispensada; retorno aceito só com identificador, código e endereço https; simulador determinístico.
import { describe, expect, it } from 'vitest';
import {
  arquivoDoPedidoPrescricao,
  cancelamentoVaiAPlataforma,
  conferirCancelamentoPrescricaoDigital,
  conferirEnvioPrescricaoDigital,
  efeitoDoRetornoPrescricao,
  EVENTO_PRESCRICAO_DIGITAL_CANCELAMENTO,
  EVENTO_PRESCRICAO_DIGITAL_ENVIO,
  lerRetornoPrescricaoDigital,
  montarCorpoEntregaPrescricao,
  montarPedidoPrescricaoDigital,
  simularRetornoPrescricaoDigital,
} from './prescricao-digital.js';

const doc = {
  situacaoReceita: 'emitida',
  situacaoDocumento: 'assinado',
  nivelAssinatura: 'icp-brasil',
  assinadaPeloPrescritor: true,
  validadeAte: '2026-12-31',
  hoje: '2026-11-25',
};
const plat = { ativa: true, categoria: 'prontuario', parceiroApiAtivo: true };
const codigos = (e: readonly { codigo: string }[]) => e.map((x) => x.codigo);

describe('conferirEnvioPrescricaoDigital', () => {
  it('aceita a receita emitida, assinada em ICP-Brasil pelo prescritor, à plataforma ativa', () => {
    expect(conferirEnvioPrescricaoDigital(doc, plat, [])).toEqual([]);
  });
  it('recusa rascunho, sem assinatura, assinatura simples, de outro signatário e vencida', () => {
    expect(
      codigos(conferirEnvioPrescricaoDigital({ ...doc, situacaoReceita: 'rascunho' }, plat, [])),
    ).toEqual(['receita-nao-emitida']);
    expect(codigos(conferirEnvioPrescricaoDigital({ ...doc, situacaoDocumento: null }, plat, []))).toEqual([
      'receita-sem-assinatura',
    ]);
    expect(
      codigos(conferirEnvioPrescricaoDigital({ ...doc, nivelAssinatura: 'eletronica-avancada' }, plat, [])),
    ).toEqual(['assinatura-nao-icp']);
    expect(
      codigos(conferirEnvioPrescricaoDigital({ ...doc, assinadaPeloPrescritor: false }, plat, [])),
    ).toEqual(['assinatura-de-outro']);
    expect(codigos(conferirEnvioPrescricaoDigital({ ...doc, validadeAte: '2026-11-24' }, plat, []))).toEqual([
      'receita-vencida',
    ]);
  });
  it('recusa plataforma ausente, inativa, de categoria alheia ou sem parceiro de API', () => {
    expect(codigos(conferirEnvioPrescricaoDigital(doc, null, []))).toEqual(['plataforma-nao-encontrada']);
    expect(codigos(conferirEnvioPrescricaoDigital(doc, { ...plat, ativa: false }, []))).toEqual([
      'plataforma-inativa',
    ]);
    expect(codigos(conferirEnvioPrescricaoDigital(doc, { ...plat, categoria: 'laboratorio' }, []))).toEqual([
      'plataforma-inativa',
    ]);
    expect(codigos(conferirEnvioPrescricaoDigital(doc, { ...plat, parceiroApiAtivo: false }, []))).toEqual([
      'plataforma-sem-parceiro',
    ]);
  });
  it('recusa o envio vivo repetido à mesma plataforma; o cancelado ou rejeitado libera; outra plataforma pode', () => {
    expect(
      codigos(conferirEnvioPrescricaoDigital(doc, plat, [{ situacao: 'aceita', plataformaMesma: true }])),
    ).toEqual(['envio-repetido']);
    expect(
      conferirEnvioPrescricaoDigital(doc, plat, [
        { situacao: 'cancelada', plataformaMesma: true },
        { situacao: 'rejeitada', plataformaMesma: true },
        { situacao: 'aceita', plataformaMesma: false },
      ]),
    ).toEqual([]);
  });
});

describe('cancelamento', () => {
  it('exige motivo e recusa o já cancelado e o dispensado', () => {
    expect(conferirCancelamentoPrescricaoDigital('aceita', 'Paciente trocou o tratamento')).toEqual([]);
    expect(codigos(conferirCancelamentoPrescricaoDigital('aceita', 'curto'))).toEqual(['motivo-curto']);
    expect(
      codigos(conferirCancelamentoPrescricaoDigital('cancelada', 'Paciente trocou o tratamento')),
    ).toEqual(['ja-cancelada']);
    expect(
      codigos(conferirCancelamentoPrescricaoDigital('dispensada', 'Paciente trocou o tratamento')),
    ).toEqual(['ja-dispensada']);
  });
  it('espera enquanto o worker entrega a receita (a mensagem do envio em "enviando")', () => {
    const m = 'Paciente trocou o tratamento';
    expect(codigos(conferirCancelamentoPrescricaoDigital('pendente', m, 'enviando'))).toEqual([
      'envio-em-andamento',
    ]);
    expect(conferirCancelamentoPrescricaoDigital('pendente', m, 'pendente')).toEqual([]);
    expect(conferirCancelamentoPrescricaoDigital('aceita', m, 'enviada')).toEqual([]);
  });
  it('só vai à plataforma quando ela devolveu o identificador', () => {
    expect(cancelamentoVaiAPlataforma(null)).toBe(false);
    expect(cancelamentoVaiAPlataforma('SIM-1')).toBe(true);
  });
});

describe('retorno da plataforma', () => {
  it('lê a resposta e recusa a situação desconhecida', () => {
    expect(lerRetornoPrescricaoDigital({ situacao: 'qualquer' })).toBeNull();
    expect(lerRetornoPrescricaoDigital(null)).toBeNull();
    expect(
      lerRetornoPrescricaoDigital({
        situacao: 'aceita',
        identificador: 'X1',
        codigoValidacao: '123456',
        urlValidacao: 'https://v.exemplo.invalid/X1',
      }),
    ).toMatchObject({ situacao: 'aceita', identificadorExterno: 'X1', situacaoExterna: 'aceita' });
  });
  it('aceita só completa e com https; cancelada no hospital ignora o atrasado; dispensada é final', () => {
    const aceita = {
      situacao: 'aceita' as const,
      identificadorExterno: 'X1',
      codigoValidacao: '123456',
      urlValidacao: 'https://v.exemplo.invalid/X1',
      situacaoExterna: 'emitida',
      motivo: null,
    };
    expect(efeitoDoRetornoPrescricao('pendente', aceita)).toEqual({ acao: 'aplicar', situacao: 'aceita' });
    expect(efeitoDoRetornoPrescricao('pendente', { ...aceita, urlValidacao: 'http://x/1' })).toMatchObject({
      acao: 'recusar',
      situacao: 'erro',
      erro: { codigo: 'retorno-incompleto' },
    });
    expect(efeitoDoRetornoPrescricao('pendente', { ...aceita, codigoValidacao: null }).acao).toBe('recusar');
    // A aceita atrasada de envio cancelado aqui: o cancelamento vai à plataforma (a receita não fica valendo lá).
    expect(efeitoDoRetornoPrescricao('cancelada', aceita)).toEqual({
      acao: 'cancelar-na-plataforma',
      identificadorExterno: 'X1',
    });
    expect(efeitoDoRetornoPrescricao('cancelada', { ...aceita, identificadorExterno: null }).acao).toBe(
      'ignorar',
    );
    expect(efeitoDoRetornoPrescricao('cancelada', { ...aceita, situacao: 'rejeitada' }).acao).toBe('ignorar');
    expect(efeitoDoRetornoPrescricao('pendente', { ...aceita, situacao: 'rejeitada' })).toEqual({
      acao: 'aplicar',
      situacao: 'rejeitada',
    });
    expect(efeitoDoRetornoPrescricao('cancelada', { ...aceita, situacao: 'cancelada' })).toEqual({
      acao: 'aplicar',
      situacao: 'cancelada',
    });
    expect(efeitoDoRetornoPrescricao('dispensada', { ...aceita, situacao: 'cancelada' }).acao).toBe(
      'ignorar',
    );
  });
});

describe('pedido e simulador', () => {
  const pedido = {
    evento: EVENTO_PRESCRICAO_DIGITAL_ENVIO,
    envio: 42,
    estabelecimento: 'h1',
    receita: { numero: 'R-1', emitidaEm: '2026-11-25T10:00:00.000Z', validadeAte: null },
    documento: { codigoVerificacao: 'ABC', hash: 'f'.repeat(64), arquivo: 9 },
    identificadorExterno: null,
    motivo: null,
  } as const;
  const item = {
    sequencia: 1,
    medicamento: 'Fármaco sintético',
    concentracao: '500 mg',
    formaFarmaceutica: 'comprimido',
    via: 'oral',
    posologia: '1 comprimido de 8 em 8 horas',
    quantidade: '1 caixa',
    usoContinuo: false,
  };
  it('o pedido gravado leva a receita, os itens e a referência do documento (o arquivo não fica na fila)', () => {
    const c = montarPedidoPrescricaoDigital({ ...pedido, itens: [item] });
    const j = JSON.parse(c) as Record<string, unknown>;
    expect(Object.keys(j).sort()).toEqual(
      [
        'documento',
        'envio',
        'estabelecimento',
        'evento',
        'identificadorExterno',
        'itens',
        'motivo',
        'receita',
        'versao',
      ].sort(),
    );
    expect(j['itens']).toEqual([item]);
    expect(arquivoDoPedidoPrescricao(c)).toBe(9);
    expect(
      arquivoDoPedidoPrescricao(
        montarPedidoPrescricaoDigital({ ...pedido, evento: EVENTO_PRESCRICAO_DIGITAL_CANCELAMENTO }),
      ),
    ).toBeNull();
  });
  it('o corpo da entrega anexa o documento assinado (base64 e resumo); sem o arquivo, o envio é recusado', () => {
    const c = montarPedidoPrescricaoDigital({ ...pedido, itens: [item] });
    const bytes = new TextEncoder().encode('%PDF-1.7 documento assinado sintético');
    const r = montarCorpoEntregaPrescricao(c, {
      conteudo: bytes,
      tipoMime: 'application/pdf',
      hash: 'e'.repeat(64),
    });
    if (!('corpo' in r)) throw new Error('era para montar');
    const d = (JSON.parse(r.corpo) as { documento: Record<string, unknown> }).documento;
    expect(d).toMatchObject({
      codigoVerificacao: 'ABC',
      hash: 'f'.repeat(64),
      tipoMime: 'application/pdf',
      tamanhoBytes: bytes.length,
      hashArquivo: 'e'.repeat(64),
    });
    expect(d['arquivo']).toBeUndefined();
    expect(Buffer.from(String(d['conteudoBase64']), 'base64').toString()).toBe(
      '%PDF-1.7 documento assinado sintético',
    );
    expect(montarCorpoEntregaPrescricao(c, null)).toMatchObject({
      erro: { codigo: 'documento-sem-arquivo' },
    });
    expect(
      montarCorpoEntregaPrescricao(c, {
        conteudo: new Uint8Array(),
        tipoMime: 'application/pdf',
        hash: 'e'.repeat(64),
      }),
    ).toMatchObject({ erro: { codigo: 'documento-sem-arquivo' } });
    const cancel = montarPedidoPrescricaoDigital({
      ...pedido,
      evento: EVENTO_PRESCRICAO_DIGITAL_CANCELAMENTO,
    });
    expect(montarCorpoEntregaPrescricao(cancel, null)).toEqual({ corpo: cancel });
  });
  it('o simulador devolve identificador, código de 6 dígitos e endereço reservado, iguais a cada chamada', () => {
    const c = montarPedidoPrescricaoDigital(pedido);
    const r = simularRetornoPrescricaoDigital(c);
    expect(r).toEqual(simularRetornoPrescricaoDigital(c));
    expect(r.situacao).toBe('aceita');
    expect(r.codigoValidacao).toMatch(/^\d{6}$/);
    expect(r.urlValidacao).toMatch(/^https:\/\/[^/]+\.invalid\//);
    expect(efeitoDoRetornoPrescricao('pendente', r).acao).toBe('aplicar');
    const cancel = simularRetornoPrescricaoDigital(
      montarPedidoPrescricaoDigital({
        ...pedido,
        evento: EVENTO_PRESCRICAO_DIGITAL_CANCELAMENTO,
        identificadorExterno: r.identificadorExterno,
        motivo: 'Paciente trocou o tratamento',
      }),
    );
    expect(cancel).toMatchObject({ situacao: 'cancelada', identificadorExterno: r.identificadorExterno });
  });
});
