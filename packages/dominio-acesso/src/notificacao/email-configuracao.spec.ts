import { describe, expect, it } from 'vitest';
import {
  envioConcluido,
  identificadorDaMensagem,
  marcadoresDoModelo,
  marcadoresDoTexto,
  modeloVigente,
  portaSugerida,
  preencherModelo,
  referenciaCofreValida,
  resultadoDaTentativa,
  resumoDoErro,
  TENTATIVAS_MAXIMAS_EMAIL,
  validarModeloEmail,
  validarServidorEmail,
} from './email-configuracao.js';

const modelo = {
  codigo: 'LAUDO.PRONTO',
  nome: 'Laudo pronto',
  assunto: 'Resultado disponível: {{pedido.numero}}',
  corpoHtml: '<p>Olá, {{ pessoa.nome }}. O pedido {{pedido.numero}} está pronto.</p>',
};
const servidor = {
  codigo: 'SAIDA1',
  nome: 'Saída principal',
  host: 'smtp.exemplo.invalid',
  porta: 587,
  seguranca: 'starttls',
  exigeAutenticacao: true,
  usuarioAutenticacao: 'envio',
  referenciaCofre: 'email/saida/principal',
  remetenteEmail: 'nao-responda@exemplo.invalid',
};

describe('modelo de mensagem', () => {
  it('aceita o modelo com marcadores e devolve os marcadores sem repetir, na ordem', () => {
    expect(validarModeloEmail(modelo)).toBeNull();
    expect(marcadoresDoModelo(modelo)).toEqual(['pedido.numero', 'pessoa.nome']);
  });

  it('recusa código, nome, assunto e corpo fora da regra', () => {
    expect(validarModeloEmail({ ...modelo, codigo: 'com espaço' })).toBe('codigo-invalido');
    expect(validarModeloEmail({ ...modelo, nome: '  ' })).toBe('nome-vazio');
    expect(validarModeloEmail({ ...modelo, assunto: '' })).toBe('assunto-vazio');
    expect(validarModeloEmail({ ...modelo, assunto: 'a\nBcc: x' })).toBe('assunto-com-quebra');
    expect(validarModeloEmail({ ...modelo, corpoHtml: ' ' })).toBe('corpo-vazio');
  });

  it('recusa o marcador mal escrito na gravação: nome inválido ou chave sem par', () => {
    expect(marcadoresDoTexto('{{Pessoa Nome}}').invalido).toBe(true);
    expect(marcadoresDoTexto('texto {{pessoa.nome').invalido).toBe(true);
    expect(marcadoresDoTexto('texto pessoa.nome}}').invalido).toBe(true);
    expect(marcadoresDoTexto('sem marcador { um } só').invalido).toBe(false);
    expect(validarModeloEmail({ ...modelo, corpoHtml: 'Olá {{}}' })).toBe('marcador-invalido');
    expect(validarModeloEmail({ ...modelo, corpoTexto: 'Olá {{1x}}' })).toBe('marcador-invalido');
  });

  it('recusa vigência invertida, endereço inválido e SMS sem texto', () => {
    expect(validarModeloEmail({ ...modelo, vigenciaInicio: '2026-12-01', vigenciaFim: '2026-11-30' })).toBe(
      'vigencia-invertida',
    );
    expect(
      validarModeloEmail({ ...modelo, vigenciaInicio: '2026-12-01', vigenciaFim: '2026-12-01' }),
    ).toBeNull();
    expect(validarModeloEmail({ ...modelo, responderPara: 'sem-arroba' })).toBe('endereco-invalido');
    expect(validarModeloEmail({ ...modelo, enviaSms: true, textoSms: ' ' })).toBe('sms-sem-texto');
  });

  it('preenche os marcadores, aponta o que falta e protege o valor posto em HTML', () => {
    const r = preencherModelo(modelo.corpoHtml, { 'pessoa.nome': 'A <b>' }, true);
    expect(r.texto).toBe('<p>Olá, A &lt;b&gt;. O pedido {{pedido.numero}} está pronto.</p>');
    expect(r.faltando).toEqual(['pedido.numero']);
    expect(preencherModelo(modelo.assunto, { 'pedido.numero': '123' })).toEqual({
      texto: 'Resultado disponível: 123',
      faltando: [],
    });
    // Chave herdada do objeto não é valor.
    expect(preencherModelo('{{constructor}}', {}).faltando).toEqual(['constructor']);
  });

  it('vale o modelo do estabelecimento sobre o padrão e o início mais recente; fora da vigência não vale', () => {
    const m = (
      id: number,
      estabelecimento: number | null,
      inicio: string | null,
      fim: string | null = null,
    ) => ({
      id,
      estabelecimento,
      finalidade: 7,
      ativo: true,
      vigenciaInicio: inicio,
      vigenciaFim: fim,
    });
    const lista = [m(1, null, null), m(2, 10, '2026-01-01'), m(3, 10, '2026-06-01'), m(4, 11, '2026-07-01')];
    expect(modeloVigente(lista, 7, 10, '2026-11-24')?.id).toBe(3);
    expect(modeloVigente(lista, 7, 10, '2026-03-01')?.id).toBe(2);
    expect(modeloVigente(lista, 7, 12, '2026-11-24')?.id).toBe(1);
    expect(modeloVigente(lista, 8, 10, '2026-11-24')).toBeNull();
    expect(modeloVigente([m(5, 10, '2026-01-01', '2026-02-01')], 7, 10, '2026-11-24')).toBeNull();
    expect(modeloVigente([{ ...m(6, 10, null), ativo: false }], 7, 10, '2026-11-24')).toBeNull();
  });
});

describe('servidor de saída', () => {
  it('aceita o servidor com autenticação pela referência do cofre', () => {
    expect(validarServidorEmail(servidor)).toBeNull();
    expect(
      validarServidorEmail({
        ...servidor,
        exigeAutenticacao: false,
        usuarioAutenticacao: null,
        referenciaCofre: null,
      }),
    ).toBeNull();
  });

  it('recusa a senha no lugar da referência do cofre', () => {
    expect(referenciaCofreValida('email/saida/principal')).toBe(true);
    for (const senha of ['Segredo#2026', 'minhasenha', 'com espaco/x', 'A/B', 'email//x', '/email/x'])
      expect(referenciaCofreValida(senha)).toBe(false);
    expect(validarServidorEmail({ ...servidor, referenciaCofre: 'Segredo#2026' })).toBe(
      'referencia-cofre-invalida',
    );
  });

  it('recusa autenticação incompleta, host com protocolo ou credencial, porta e segurança fora da regra', () => {
    expect(validarServidorEmail({ ...servidor, referenciaCofre: null })).toBe('autenticacao-incompleta');
    expect(validarServidorEmail({ ...servidor, usuarioAutenticacao: ' ' })).toBe('autenticacao-incompleta');
    expect(validarServidorEmail({ ...servidor, host: 'smtp://x.invalid' })).toBe('host-invalido');
    expect(validarServidorEmail({ ...servidor, host: 'u:s@x.invalid' })).toBe('host-invalido');
    expect(validarServidorEmail({ ...servidor, porta: 0 })).toBe('porta-invalida');
    expect(validarServidorEmail({ ...servidor, porta: 70000 })).toBe('porta-invalida');
    expect(validarServidorEmail({ ...servidor, seguranca: 'tls13' })).toBe('seguranca-invalida');
    expect(validarServidorEmail({ ...servidor, remetenteEmail: 'x' })).toBe('endereco-invalido');
    expect(validarServidorEmail({ ...servidor, tempoLimiteSegundos: 2 })).toBe('tempo-limite-invalido');
    expect(validarServidorEmail({ ...servidor, limiteEnvioHora: 0 })).toBe('limite-hora-invalido');
    expect(validarServidorEmail({ ...servidor, padrao: true, ativo: false })).toBe('padrao-inativo');
  });

  it('sugere a porta habitual de cada segurança', () => {
    expect([portaSugerida('nenhuma'), portaSugerida('starttls'), portaSugerida('ssl_tls')]).toEqual([
      25, 587, 465,
    ]);
  });
});

describe('registro de envio', () => {
  it('aceito em produção é enviado; fora de produção é capturado, nunca enviado', () => {
    expect(resultadoDaTentativa({ aceito: true, producao: true, tentativasAnteriores: 0 })).toEqual({
      situacao: 'enviado',
      situacaoDestinatario: 'entregue',
      tentativas: 1,
      tentaDeNovo: false,
    });
    expect(resultadoDaTentativa({ aceito: true, producao: false, tentativasAnteriores: 1 })).toEqual({
      situacao: 'capturado',
      situacaoDestinatario: 'capturado',
      tentativas: 2,
      tentaDeNovo: false,
    });
  });

  it('a falha conta a tentativa e para de tentar no máximo', () => {
    expect(resultadoDaTentativa({ aceito: false, producao: true, tentativasAnteriores: 0 })).toMatchObject({
      situacao: 'falhou',
      situacaoDestinatario: 'rejeitado',
      tentativas: 1,
      tentaDeNovo: true,
    });
    expect(
      resultadoDaTentativa({
        aceito: false,
        producao: true,
        tentativasAnteriores: TENTATIVAS_MAXIMAS_EMAIL - 1,
      }).tentaDeNovo,
    ).toBe(false);
  });

  it('o envio concluído não é regravado', () => {
    expect(['enviado', 'capturado', 'cancelado'].map(envioConcluido)).toEqual([true, true, true]);
    expect(['pendente', 'enviando', 'falhou'].map(envioConcluido)).toEqual([false, false, false]);
  });

  it('o erro guardado traz só o tipo, o código de resposta e o motivo: nunca endereço', () => {
    expect(resumoDoErro(new Error('SMTP: resposta 550 inesperada'))).toBe('Error: resposta 550');
    expect(resumoDoErro(new Error('SMTP: tempo esgotado'))).toBe('Error: tempo esgotado');
    const r = resumoDoErro(new Error('connect ECONNREFUSED 10.1.2.3:25 para fulano@exemplo.invalid'));
    expect(r).toBe('Error: conexão recusada');
    expect(r).not.toMatch(/@|10\.1/);
    expect(resumoDoErro('texto solto')).toBe('Erro');
  });

  it('o identificador da mensagem é estável por entrega e destinatário', () => {
    expect(identificadorDaMensagem('fila:42', 1, 'cliente-x.invalid')).toBe('<fila-42.1@cliente-x.invalid>');
    expect(identificadorDaMensagem('fila:42', 1, 'cliente-x.invalid')).toBe(
      identificadorDaMensagem('fila:42', 1, 'cliente-x.invalid'),
    );
    expect(identificadorDaMensagem('fila:42', 2, 'cliente-x.invalid')).not.toBe(
      identificadorDaMensagem('fila:42', 1, 'cliente-x.invalid'),
    );
  });
});
