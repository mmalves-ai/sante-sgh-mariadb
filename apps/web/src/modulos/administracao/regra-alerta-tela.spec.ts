// 01-ADM L75: a regra de alerta na tela. A conferência feita enquanto se digita é a regra do domínio; o corpo da
// gravação parte da regra lida inteira (nada volta ao padrão por não ter sido mostrado). Dados SINTÉTICOS.
import { describe, expect, it } from 'vitest';
import {
  conferirRegra,
  corpoDaRegra,
  corpoDaSituacao,
  formDaRegra,
  formNovo,
  incluirUsuario,
  type RegraLida,
} from './regra-alerta-tela.js';

const lida: RegraLida = {
  id: 7,
  versao: 3,
  codigo: 'SINT.LEITO',
  nome: 'REGRA SINTETICA',
  cenario: 'SINT',
  mensagem: 'MENSAGEM SINTETICA',
  gravidade: 'critico',
  repeticao: 'intervalo',
  ativo: true,
  editavel: true,
  consolidacao: 'SINTJ',
  numeroVersao: 2,
  vigenciaInicio: '2026-11-01',
  vigenciaFim: null,
  notifica: { tela: true, email: true, sms: false, aplicativo: false },
  destinatarios: [
    { tipo: 'perfil', codigo: 'SINT_PERFIL' },
    { tipo: 'usuario', codigo: 'SINT.A' },
  ],
  descricao: 'DESCRICAO SINTETICA',
  bloqueante: true,
  exigeJustificativa: true,
  sexo: 'feminino',
  idadeMinima: 12,
  idadeMaxima: 60,
  intervaloMinutos: 30,
  global: false,
  conteudoEditavel: true,
};

describe('regra de alerta na tela', () => {
  it('a regra nova aponta o que falta, de cima para baixo, e libera quando completa', () => {
    const f = formNovo('2026-11-24');
    expect(conferirRegra(f)).toBe('codigo-invalido');
    f.codigo = 'com espaco';
    expect(conferirRegra(f)).toBe('codigo-invalido');
    f.codigo = 'SINT.NOVA';
    expect(conferirRegra(f)).toBe('nome-vazio');
    f.nome = 'NOVA';
    expect(conferirRegra(f)).toBe('cenario-vazio');
    f.cenario = 'SINT';
    expect(conferirRegra(f)).toBe('mensagem-vazia');
    f.mensagem = 'TEXTO';
    expect(conferirRegra(f)).toBe('regra-sem-destinatario');
    f.perfis = ['SINT_PERFIL'];
    expect(conferirRegra(f)).toBeNull();
    f.vigenciaFim = '2026-11-01';
    expect(conferirRegra(f)).toBe('vigencia-invertida');
    f.vigenciaFim = '';
    f.repeticao = 'intervalo';
    expect(conferirRegra(f)).toBe('intervalo-sem-minutos');
    f.intervaloMinutos = '15';
    f.idadeMinima = '40';
    f.idadeMaxima = '18';
    expect(conferirRegra(f)).toBe('idade-invertida');
    f.idadeMaxima = 'x';
    expect(conferirRegra(f)).toBe('numero-invalido');
    f.idadeMaxima = '';
    f.vigenciaInicio = '';
    expect(conferirRegra(f)).toBe('vigencia-vazia');
  });

  it('a regra inativa pode ficar sem destinatário', () => {
    const f = { ...formNovo('2026-11-24', 'SINT'), codigo: 'A', nome: 'A', mensagem: 'A', ativo: false };
    expect(conferirRegra(f)).toBeNull();
  });

  it('o corpo da regra nova não leva id, versão nem motivo, e zera o intervalo fora da repetição por intervalo', () => {
    const f = {
      ...formNovo('2026-11-24', 'SINT'),
      codigo: ' SINT.N ',
      nome: ' NOVA ',
      mensagem: ' TEXTO ',
      intervaloMinutos: '15',
      motivo: 'x',
      perfis: ['P', 'P'],
      usuarios: ['SINT.A'],
    };
    expect(corpoDaRegra(f)).toEqual({
      codigo: 'SINT.N',
      nome: 'NOVA',
      cenario: 'SINT',
      descricao: null,
      mensagem: 'TEXTO',
      gravidade: 'atencao',
      bloqueante: false,
      exigeJustificativa: false,
      sexo: 'todos',
      idadeMinima: null,
      idadeMaxima: null,
      repeticao: 'sempre',
      intervaloMinutos: null,
      notificaTela: true,
      notificaEmail: false,
      notificaSms: false,
      notificaAplicativo: false,
      consolidacao: null,
      vigenciaInicio: '2026-11-24',
      vigenciaFim: null,
      ativo: true,
      destinatarios: [
        { tipo: 'perfil', codigo: 'P' },
        { tipo: 'usuario', codigo: 'SINT.A' },
      ],
    });
  });

  it('ativar ou desativar na linha devolve a regra lida inteira, só com a situação trocada', () => {
    expect(corpoDaSituacao(lida, false)).toEqual({
      id: 7,
      versao: 3,
      codigo: 'SINT.LEITO',
      nome: 'REGRA SINTETICA',
      cenario: 'SINT',
      descricao: 'DESCRICAO SINTETICA',
      mensagem: 'MENSAGEM SINTETICA',
      gravidade: 'critico',
      bloqueante: true,
      exigeJustificativa: true,
      sexo: 'feminino',
      idadeMinima: 12,
      idadeMaxima: 60,
      repeticao: 'intervalo',
      intervaloMinutos: 30,
      notificaTela: true,
      notificaEmail: true,
      notificaSms: false,
      notificaAplicativo: false,
      consolidacao: 'SINTJ',
      vigenciaInicio: '2026-11-01',
      vigenciaFim: null,
      ativo: false,
      destinatarios: [
        { tipo: 'perfil', codigo: 'SINT_PERFIL' },
        { tipo: 'usuario', codigo: 'SINT.A' },
      ],
    });
  });

  it('a alteração leva o motivo e a versão lida', () => {
    const c = corpoDaRegra({ ...formDaRegra(lida), mensagem: 'OUTRA', motivo: ' ajuste ' });
    expect(c).toMatchObject({ id: 7, versao: 3, mensagem: 'OUTRA', motivo: 'ajuste' });
  });

  it('inclui o login em maiúsculas, sem repetir, e recusa o que não é login', () => {
    expect(incluirUsuario(['SINT.A'], ' sint.b ')).toEqual(['SINT.A', 'SINT.B']);
    expect(incluirUsuario(['SINT.A'], 'sint.a')).toEqual(['SINT.A']);
    expect(incluirUsuario([], 'com espaco')).toBeNull();
    expect(incluirUsuario([], '')).toBeNull();
  });
});
